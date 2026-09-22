import {
    createRemoteJWKSet,
    errors,
    jwtVerify,
} from 'jose';

const { JOSEError, JWKSNoMatchingKey } = errors;

const unavailableNames = new Set([
    'JWKSTimeout',
    'JWKSInvalid',
    'JWKSMultipleMatchingKeys',
]);

export class ClerkAuthError extends Error {
    constructor(statusCode, code, message) {
        super(message);
        this.name = 'ClerkAuthError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

const invalidCredential = () => new ClerkAuthError(
    401,
    'AUTH_INVALID',
    'The authentication credential is invalid',
);

const unavailable = () => new ClerkAuthError(
    503,
    'AUTH_PROVIDER_UNAVAILABLE',
    'Authentication verification is temporarily unavailable',
);

const isUnavailable = (error) => {
    if (error?.providerUnavailable === true) {
        return true;
    }

    if (unavailableNames.has(error?.name)) {
        return true;
    }

    const message = String(error?.message || '');
    const code = String(error?.code || '');

    if (error instanceof JOSEError && /expected 200|failed to parse|unsupported url protocol/i.test(message)) {
        return true;
    }

    if ((error instanceof TypeError && /fetch failed|network|failed to fetch/i.test(message))
        || /ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|socket hang up|fetch failed|network/i.test(`${message} ${code}`)) {
        return true;
    }

    return false;
};

const validateAuthorizationHeader = (authorization) => {
    if (Array.isArray(authorization) || typeof authorization !== 'string') {
        throw invalidCredential();
    }

    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    if (!match) {
        throw invalidCredential();
    }

    return match[1];
};

const validateConfig = (config) => {
    if (!config?.jwksUrl || !config.issuer || !config.audience?.length || !config.algorithms?.length) {
        throw new Error('Complete Clerk verifier configuration is required');
    }

    if (!['required', 'absent'].includes(config.authorizedPartyPolicy)) {
        throw new Error('Clerk authorized-party policy must be required or absent');
    }

    if (config.authorizedPartyPolicy === 'required' && !config.authorizedParties?.length) {
        throw new Error('Clerk authorized-party allowlist is required by policy');
    }
};

export const createClerkVerifier = (config, { jwks } = {}) => {
    validateConfig(config);

    const keySet = jwks || createRemoteJWKSet(config.jwksUrl, {
        timeoutDuration: config.jwksTimeout,
        cooldownDuration: config.jwksCooldown,
        cacheMaxAge: config.jwksCacheMaxAge,
    });

    return async (authorization) => {
        const token = validateAuthorizationHeader(authorization);

        try {
            const { payload } = await jwtVerify(token, keySet, {
                algorithms: config.algorithms,
                issuer: config.issuer,
                audience: config.audience,
                clockTolerance: config.clockTolerance,
                requiredClaims: ['exp', 'sub'],
            });

            if (typeof payload.sub !== 'string' || !payload.sub) {
                throw invalidCredential();
            }

            if (payload.iat !== undefined
                && (typeof payload.iat !== 'number' || payload.iat > (Date.now() / 1000) + config.clockTolerance)) {
                throw invalidCredential();
            }

            if (config.authorizedPartyPolicy === 'required'
                && (typeof payload.azp !== 'string' || !config.authorizedParties.includes(payload.azp))) {
                throw invalidCredential();
            }

            if (config.authorizedPartyPolicy === 'absent' && payload.azp !== undefined) {
                throw invalidCredential();
            }

            return { provider: 'clerk', subject: payload.sub };
        } catch (error) {
            if (error instanceof ClerkAuthError) {
                throw error;
            }

            if (isUnavailable(error)) {
                throw unavailable();
            }

            if (error instanceof JWKSNoMatchingKey) {
                throw invalidCredential();
            }

            throw invalidCredential();
        }
    };
};
