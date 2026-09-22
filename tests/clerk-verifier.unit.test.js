import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {
    exportJWK,
    errors,
    generateKeyPair,
    SignJWT,
} from 'jose';

const { JWKSNoMatchingKey, JWKSTimeout } = errors;

import { createClerkVerifierConfig } from '../config/clerk.js';
import { createClerkVerifier, ClerkAuthError } from '../services/clerk-verifier.js';

const issuer = 'https://issuer.example.test';
const audience = 'subscription-tracker-test';
const authorizedParty = 'https://app.example.test';

const config = {
    jwksUrl: new URL('https://jwks.example.test/.well-known/jwks.json'),
    issuer,
    audience: [audience],
    algorithms: ['RS256'],
    authorizedPartyPolicy: 'required',
    authorizedParties: [authorizedParty],
    clockTolerance: 0,
    jwksTimeout: 100,
    jwksCooldown: 100,
    jwksCacheMaxAge: 1000,
};

const expectAuthError = async (promise, statusCode, code) => {
    await assert.rejects(promise, (error) => {
        assert.ok(error instanceof ClerkAuthError);
        assert.equal(error.statusCode, statusCode);
        assert.equal(error.code, code);
        return true;
    });
};

const makeToken = async (privateKey, claims = {}, kid = 'test-key') => new SignJWT({
    sub: 'user_test_subject',
    aud: audience,
    iss: issuer,
    azp: authorizedParty,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60,
    ...claims,
})
    .setProtectedHeader({ alg: 'RS256', kid })
    .sign(privateKey);

const startJwksServer = async (keys, { delay = 0, statusCode = 200 } = {}) => {
    let retrievals = 0;
    const server = http.createServer(async (request, response) => {
        retrievals += 1;
        if (delay) {
            await new Promise((resolve) => setTimeout(resolve, delay));
        }

        response.statusCode = statusCode;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ keys: typeof keys === 'function' ? keys() : keys }));
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    return {
        url: new URL(`http://127.0.0.1:${port}/.well-known/jwks.json`),
        get retrievals() {
            return retrievals;
        },
        close: () => new Promise((resolve) => server.close(resolve)),
    };
};

const publicJwk = async (publicKey, kid) => ({
    ...(await exportJWK(publicKey)),
    kid,
    alg: 'RS256',
    use: 'sig',
});

test('configuration requires explicit live policy inputs and keeps profile secrets separate', () => {
    const verified = createClerkVerifierConfig({
        CLERK_JWKS_URL: 'https://clerk.example.test/.well-known/jwks.json',
        CLERK_ISSUER: issuer,
        CLERK_AUDIENCE: audience,
        CLERK_ALLOWED_ALGORITHMS: 'RS256',
        CLERK_AUTHORIZED_PARTY_POLICY: 'required',
        CLERK_AUTHORIZED_PARTIES: authorizedParty,
        CLERK_CLOCK_SKEW_SECONDS: '5',
        CLERK_JWKS_TIMEOUT_MS: '100',
        CLERK_JWKS_REFRESH_COOLDOWN_MS: '1000',
        CLERK_JWKS_CACHE_MAX_AGE_MS: '5000',
        CLERK_SECRET_KEY: 'must-not-be-read-by-verifier',
    });

    assert.deepEqual(verified.audience, [audience]);
    assert.deepEqual(verified.authorizedParties, [authorizedParty]);
    assert.equal(verified.profileSecret, undefined);
    assert.throws(() => createClerkVerifierConfig({}), /CLERK_JWKS_URL/);
});

test('valid credential exposes only the Clerk provider identity', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const verifier = createClerkVerifier(config, {
        jwks: async () => publicKey,
    });
    const identity = await verifier(`Bearer ${await makeToken(privateKey)}`);

    assert.deepEqual(identity, { provider: 'clerk', subject: 'user_test_subject' });
});

test('missing, malformed, duplicate, and empty credentials are rejected', async () => {
    const verifier = createClerkVerifier(config, { jwks: async () => null });

    for (const header of [undefined, '', 'Token value', 'Bearer', 'Bearer one two', ['Bearer one', 'Bearer two']]) {
        await expectAuthError(verifier(header), 401, 'AUTH_INVALID');
    }
});

test('invalid signature and wrong issuer are rejected without fallback', async () => {
    const first = await generateKeyPair('RS256');
    const second = await generateKeyPair('RS256');
    let fallbackCalled = false;
    const verifier = createClerkVerifier(config, {
        jwks: async () => {
            fallbackCalled = true;
            return first.publicKey;
        },
    });

    await expectAuthError(verifier(`Bearer ${await makeToken(second.privateKey)}`), 401, 'AUTH_INVALID');
    await expectAuthError(
        verifier(`Bearer ${await makeToken(first.privateKey, { iss: 'https://other.example.test' })}`),
        401,
        'AUTH_INVALID',
    );
    assert.equal(fallbackCalled, true);
});

test('expired, not-yet-valid, missing-claim, and unauthorized-party credentials are rejected', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const verifier = createClerkVerifier(config, { jwks: async () => publicKey });

    for (const claims of [
        { exp: Math.floor(Date.now() / 1000) - 1 },
        { nbf: Math.floor(Date.now() / 1000) + 60 },
        { exp: undefined },
        { azp: 'https://other.example.test' },
        { azp: undefined },
    ]) {
        await expectAuthError(verifier(`Bearer ${await makeToken(privateKey, claims)}`), 401, 'AUTH_INVALID');
    }
});

test('no azp policy is explicit and does not accept a supplied azp', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const verifier = createClerkVerifier({ ...config, authorizedPartyPolicy: 'absent', authorizedParties: [] }, {
        jwks: async () => publicKey,
    });

    await expectAuthError(verifier(`Bearer ${await makeToken(privateKey)}`), 401, 'AUTH_INVALID');
    const token = await makeToken(privateKey, { azp: undefined });
    assert.deepEqual(await verifier(`Bearer ${token}`), { provider: 'clerk', subject: 'user_test_subject' });
});

test('successful JWKS retrieval without a matching key is invalid, not unavailable', async () => {
    const verifier = createClerkVerifier(config, {
        jwks: async () => {
            throw new JWKSNoMatchingKey();
        },
    });

    await expectAuthError(verifier('Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IngifQ.invalid.token'), 401, 'AUTH_INVALID');
});

test('JWKS outage is unavailable and does not leak provider details or token material', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const verifier = createClerkVerifier(config, {
        jwks: async () => {
            throw new JWKSTimeout();
        },
    });
    const token = 'secret-test-token';
    const signedToken = await makeToken(privateKey);

    await assert.rejects(verifier(`Bearer ${signedToken}`), (error) => {
        assert.equal(error.statusCode, 503);
        assert.equal(error.code, 'AUTH_PROVIDER_UNAVAILABLE');
        assert.equal(error.message.includes(token), false);
        return true;
    });
});

test('network and fetch failures while fetching the JWKS are treated as provider unavailable', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const signedToken = await makeToken(privateKey);

    const fetchFailureVerifier = createClerkVerifier(config, {
        jwks: async () => {
            throw new TypeError('fetch failed');
        },
    });

    const dnsFailureVerifier = createClerkVerifier(config, {
        jwks: async () => {
            const error = new Error('getaddrinfo ENOTFOUND jwks.example.test');
            error.name = 'Error';
            throw error;
        },
    });

    await expectAuthError(fetchFailureVerifier(`Bearer ${signedToken}`), 503, 'AUTH_PROVIDER_UNAVAILABLE');
    await expectAuthError(dnsFailureVerifier(`Bearer ${signedToken}`), 503, 'AUTH_PROVIDER_UNAVAILABLE');
});

test('cached-key behavior can verify repeatedly without another JWKS retrieval', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    let retrievals = 0;
    let cachedKey;
    const verifier = createClerkVerifier(config, {
        jwks: async () => {
            if (!cachedKey) {
                retrievals += 1;
                cachedKey = publicKey;
            }
            return cachedKey;
        },
    });
    const token = await makeToken(privateKey);

    assert.deepEqual(await verifier(`Bearer ${token}`), { provider: 'clerk', subject: 'user_test_subject' });
    assert.deepEqual(await verifier(`Bearer ${token}`), { provider: 'clerk', subject: 'user_test_subject' });
    assert.equal(retrievals, 1);
});

test('rejection prevents downstream execution in the middleware boundary', async () => {
    const verifier = createClerkVerifier(config, { jwks: async () => null });
    let downstreamCalled = false;
    const req = { headers: { authorization: 'Bearer invalid' } };
    let error;

    try {
        await verifier(req.headers.authorization);
    } catch (caught) {
        error = caught;
    }

    if (!error) downstreamCalled = true;
    assert.equal(downstreamCalled, false);
    assert.equal(error.code, 'AUTH_INVALID');
});

test('generated public key material is never exposed by the identity result', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const exported = await exportJWK(publicKey);
    const verifier = createClerkVerifier(config, { jwks: async () => publicKey });
    const result = await verifier(`Bearer ${await makeToken(privateKey)}`);

    assert.deepEqual(Object.keys(result), ['provider', 'subject']);
    assert.equal(JSON.stringify(result).includes(exported.n), false);
});

test('production resolver reuses a successfully retrieved JWKS', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await publicJwk(publicKey, 'test-key');
    const server = await startJwksServer([jwk]);
    const verifier = createClerkVerifier({ ...config, jwksUrl: server.url });
    const token = await makeToken(privateKey);

    try {
        await verifier(`Bearer ${token}`);
        await verifier(`Bearer ${token}`);
        assert.equal(server.retrievals, 1);
    } finally {
        await server.close();
    }
});

test('production resolver keeps an unknown key invalid after successful retrieval', async () => {
    const first = await generateKeyPair('RS256');
    const unknown = await generateKeyPair('RS256');
    const server = await startJwksServer([await publicJwk(first.publicKey, 'test-key')]);
    const verifier = createClerkVerifier({ ...config, jwksUrl: server.url });

    try {
        await verifier(`Bearer ${await makeToken(first.privateKey)}`);
        await expectAuthError(
            verifier(`Bearer ${await makeToken(unknown.privateKey)}`),
            401,
            'AUTH_INVALID',
        );
    } finally {
        await server.close();
    }
});

test('production resolver permits key rotation through bounded refresh', async () => {
    const first = await generateKeyPair('RS256');
    const rotated = await generateKeyPair('RS256');
    let keys = [await publicJwk(first.publicKey, 'test-key')];
    const server = await startJwksServer(() => keys);
    const verifier = createClerkVerifier({
        ...config,
        jwksUrl: server.url,
        jwksCooldown: 0,
        jwksCacheMaxAge: 1000,
    });

    try {
        await verifier(`Bearer ${await makeToken(first.privateKey)}`);
            keys = [await publicJwk(rotated.publicKey, 'rotated-key')];
            await verifier(`Bearer ${await makeToken(rotated.privateKey, {}, 'rotated-key')}`);
        assert.equal(server.retrievals, 2);
    } finally {
        await server.close();
    }
});

test('production resolver maps required JWKS fetch failure to provider unavailable', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const server = await startJwksServer([], { statusCode: 503 });
    const verifier = createClerkVerifier({ ...config, jwksUrl: server.url });

    try {
        await expectAuthError(
            verifier(`Bearer ${await makeToken(privateKey)}`),
            503,
            'AUTH_PROVIDER_UNAVAILABLE',
        );
    } finally {
        await server.close();
    }
});

test('production resolver uses a cached key without another retrieval after an outage', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const server = await startJwksServer([await publicJwk(publicKey, 'test-key')]);
    const verifier = createClerkVerifier({ ...config, jwksUrl: server.url });
    const token = await makeToken(privateKey);

    try {
        await verifier(`Bearer ${token}`);
        await verifier(`Bearer ${token}`);
        assert.equal(server.retrievals, 1);
    } finally {
        await server.close();
    }
});

test('production resolver enforces its bounded JWKS timeout', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const server = await startJwksServer([], { delay: 100 });
    const verifier = createClerkVerifier({
        ...config,
        jwksUrl: server.url,
        jwksTimeout: 10,
    });

    try {
        await expectAuthError(
            verifier(`Bearer ${await makeToken(privateKey)}`),
            503,
            'AUTH_PROVIDER_UNAVAILABLE',
        );
    } finally {
        await server.close();
    }
});