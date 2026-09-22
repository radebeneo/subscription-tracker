const required = (value, name) => {
    if (!value) {
        throw new Error(`${name} is required for Clerk verification`);
    }

    return value;
};

const positiveInteger = (value, name) => {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${name} must be a non-negative integer`);
    }

    return parsed;
};

const splitList = (value, name) => {
    const values = required(value, name).split(',').map((item) => item.trim()).filter(Boolean);

    if (!values.length) {
        throw new Error(`${name} must contain at least one value`);
    }

    return values;
};

export const createClerkVerifierConfig = (source = process.env) => {
    const jwksUrl = required(source.CLERK_JWKS_URL, 'CLERK_JWKS_URL');

    let parsedJwksUrl;
    try {
        parsedJwksUrl = new URL(jwksUrl);
    } catch {
        throw new Error('CLERK_JWKS_URL must be a valid URL');
    }

    if (parsedJwksUrl.protocol !== 'https:') {
        throw new Error('CLERK_JWKS_URL must use HTTPS');
    }

    const authorizedPartyPolicy = required(
        source.CLERK_AUTHORIZED_PARTY_POLICY,
        'CLERK_AUTHORIZED_PARTY_POLICY',
    );

    if (!['required', 'absent'].includes(authorizedPartyPolicy)) {
        throw new Error('CLERK_AUTHORIZED_PARTY_POLICY must be required or absent');
    }

    const authorizedParties = authorizedPartyPolicy === 'required'
        ? splitList(source.CLERK_AUTHORIZED_PARTIES, 'CLERK_AUTHORIZED_PARTIES')
        : [];

    return {
        jwksUrl: parsedJwksUrl,
        issuer: required(source.CLERK_ISSUER, 'CLERK_ISSUER'),
        audience: splitList(source.CLERK_AUDIENCE, 'CLERK_AUDIENCE'),
        algorithms: splitList(source.CLERK_ALLOWED_ALGORITHMS, 'CLERK_ALLOWED_ALGORITHMS'),
        authorizedPartyPolicy,
        authorizedParties,
        clockTolerance: positiveInteger(source.CLERK_CLOCK_SKEW_SECONDS, 'CLERK_CLOCK_SKEW_SECONDS'),
        jwksTimeout: positiveInteger(source.CLERK_JWKS_TIMEOUT_MS, 'CLERK_JWKS_TIMEOUT_MS'),
        jwksCooldown: positiveInteger(source.CLERK_JWKS_REFRESH_COOLDOWN_MS, 'CLERK_JWKS_REFRESH_COOLDOWN_MS'),
        jwksCacheMaxAge: positiveInteger(source.CLERK_JWKS_CACHE_MAX_AGE_MS, 'CLERK_JWKS_CACHE_MAX_AGE_MS'),
    };
};
