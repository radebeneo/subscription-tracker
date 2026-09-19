# CONTRACT-01: Clerk Identity and Owned Subscriptions

**Revision:** 2  
**Status:** Owner-approved design; implementation pending credential configuration facts

This is the canonical contract for the API and Expo repositories. It records the approved first Clerk slice and does not authorize runtime changes by itself. Existing development data must be preserved.

## 1. Approved scope and decisions

The first slice resolves a Clerk identity, explicitly provisions it in the existing `User` document, and lists that user's subscriptions. Clerk remains the identity authority; MongoDB remains authoritative for the API user, association, and subscription records.

The owner-approved decisions are:

1. Verify the appropriate Clerk-issued credential directly with `jose`.
2. Prefer the ordinary Clerk session token when it satisfies the verified claims policy. A custom token template is not required without a demonstrated configuration need.
3. Do not add a default token exchange or a second API session system.
4. Store the Clerk association inline on `User`, not in a separate identity collection.
5. Do not use fake passwords, email-only linking, or implicit account linking.
6. Keep `GET /api/v1/identity` read-only; use `POST /api/v1/identity/provision` for explicit provisioning.
7. Provisioning accepts an empty request body and rejects unexpected fields. It is initially idempotent; general profile synchronization is deferred.
8. Migrate the existing `GET /api/v1/subscriptions/user/:id` route to Clerk-only authentication.
9. Do not add a dual verifier, alternate Expo subscription endpoint, or legacy-client migration for this slice.
10. Omit `workflowRunId` from the integrated subscription-list DTO.
11. Rollback preserves users, Clerk associations, and subscriptions.

Legacy auth endpoints remain outside the Expo flow and may continue their existing behavior for development data; they are not credentials for the Clerk-only subscription-list route.

## 2. Credential verification

The proposed dependency is `jose` `5.10.0`, using `jwtVerify` and a remote JWKS-backed key set. This version is compatible with ESM and Node.js 18.17+ (and current Node releases). The implementation should pin `"jose": "5.10.0"`; the later dependency change is expected to update the existing `package-lock.json` with one direct jose dependency and its transitive metadata. This documentation task does not install it.

The request must contain exactly one `Authorization: Bearer <token>` credential. Tokens, keys, and provider secrets are never logged, returned, or put in error messages. Verification uses a configured `CLERK_JWKS_URL`, exact `CLERK_ISSUER`, required `CLERK_AUDIENCE`, and a configured `CLERK_AUTHORIZED_PARTIES` allowlist. `CLERK_SECRET_KEY` is server-only and is used only for the Clerk User API profile lookup. `CLERK_API_BASE_URL` is a pinned server configuration value, never request-controlled.

The verifier must enforce the configured algorithm allowlist, exact issuer, required future `exp`, reasonable `iat`, valid optional `nbf`, required Clerk `sub`, required audience, and permitted `azp` policy. The subject is the only identity identifier read from the credential. The selected ordinary Clerk session token must satisfy this policy; missing claims are a configuration fact to verify, not a reason to add a token exchange.

Authentication outcomes are deliberately split:

- `401 AUTH_INVALID` means the credential is missing, malformed, has an unacceptable signature or claims, or has no permitted matching key after a successful JWKS retrieval and allowed bounded refresh. An unknown key ID alone is therefore not a provider outage.
- `503 AUTH_PROVIDER_UNAVAILABLE` means necessary verification infrastructure could not be obtained, such as a JWKS timeout, DNS/TLS failure, malformed provider key-set response, or exhausted provider refresh while the key set itself could not be retrieved. Never accept an unverified token.

## 3. Inline User association

Extend the existing `User` document with these server-controlled fields:

```json
{
  "identityProvider": "clerk",
  "providerSubject": "user_2abc123"
}
```

`providerSubject` is the exact Clerk `sub`; `identityProvider` is fixed to `clerk` for this slice. The pair `(identityProvider, providerSubject)` has a unique sparse/partial index that indexes only documents where both fields exist. This permits legacy users with no provider association to remain valid while preventing two API users from claiming one Clerk identity. The association fields are immutable after creation and are written only by server provisioning code. The existing unique `email` constraint remains profile data and a conflict check, never an implicit association key.

Legacy users without an association retain their existing password requirement and legacy sign-in behavior. Provider-associated users must not require a usable password for Clerk authentication; provisioning must not create a fake password. Any password validation used by legacy sign-in is conditional on the user being a legacy user, and the Clerk path never accepts a password as an alternate credential.

Public user serialization must use an explicit allowlist such as `_id`, `name`, `email`, `createdAt`, and `updatedAt`. It must exclude `password`, `identityProvider`, `providerSubject`, and any future credential or provider fields unless a separate contract explicitly exposes a non-sensitive projection. Identity endpoints may return the separately specified provider and subject values, but must never return passwords, tokens, or secrets.

## 4. Trusted provisioning

After successful credential verification, provisioning retrieves the profile server-to-server from the pinned Clerk User API using `CLERK_SECRET_KEY`. Token claims are not trusted as name or email. The provider response is schema-validated before any MongoDB write.

The profile must identify the verified primary email by matching `primary_email_address_id` to an email entry whose verification status is `verified`. No unverified primary, secondary address, or token email is accepted. Failure returns `422 PROFILE_EMAIL_UNVERIFIED`.

Name derivation is deterministic: trim `first_name`, trim `last_name`, and join the non-empty parts with one space. If that result is absent or outside the existing `User.name` constraint of 2 through 20 characters, return `422 PROFILE_INCOMPLETE`. Do not invent, truncate, or silently normalize a name beyond trimming. Email is trimmed and lowercased for the existing user constraint.

The request body must be `{}` or absent. Any unexpected field, including `name`, `email`, `userId`, `password`, or provider data, returns `400 REQUEST_INVALID`; client values are never merged.

Provisioning behavior is:

- First provision: create one `User` with the derived profile and the inline association, returning `201`.
- Repeat for the same provider subject: return the existing safe projection with `200`; do not silently synchronize changed name or email. General profile synchronization is deferred.
- Concurrent first requests: use a transaction where available plus the unique association index. A duplicate-key loser rereads the association and returns the same result only when subject, provider, and email invariants match; it never creates a second user or overwrites an association.
- Existing legacy user with the derived email and no association: return `409 LEGACY_EMAIL_CONFLICT`; do not link, merge, replace, delete, or change its password.
- Provider subject already associated with another user: return `409 IDENTITY_CONFLICT`.
- Provider timeout, rate limit, unavailable service, invalid provider response, or database failure: return `503 AUTH_PROVIDER_UNAVAILABLE` for provider dependency failure, or `500 PROVISIONING_FAILED` for an internal database failure. Leave MongoDB unchanged when no atomic write can be completed and do not expose provider/database details.

## 5. Routes and exact envelopes

All errors use this shape, with no extra sensitive fields:

```json
{"success": false, "code": "ERROR_CODE", "message": "Stable client-safe message"}
```

### `GET /api/v1/identity`

Requires a valid Clerk bearer credential. It verifies the credential and reads the inline association only. It never calls Clerk profile retrieval and never writes.

```json
{"success": true, "data": {"provider": "clerk", "clerkUserId": "user_2abc123", "userId": "665f000000000000000001", "provisioned": true}}
```

An authenticated but unprovisioned identity returns `200` with `userId: null` and `provisioned: false`. Credential and dependency errors are `401 AUTH_INVALID` or `503 AUTH_PROVIDER_UNAVAILABLE` as defined above.

### `POST /api/v1/identity/provision`

Requires a valid Clerk bearer credential and an empty request. Creation returns:

```json
{"success": true, "data": {"provider": "clerk", "clerkUserId": "user_2abc123", "userId": "665f000000000000000001", "email": "owner@example.test", "name": "Owner Example"}}
```

Creation is `201`; an unchanged idempotent repeat is `200`. Errors are `400 REQUEST_INVALID`, `401 AUTH_INVALID`, `409 LEGACY_EMAIL_CONFLICT` or `IDENTITY_CONFLICT`, `422 PROFILE_EMAIL_UNVERIFIED` or `PROFILE_INCOMPLETE`, `503 AUTH_PROVIDER_UNAVAILABLE`, and `500 PROVISIONING_FAILED`.

### `GET /api/v1/subscriptions/user/:id`

This existing route is Clerk-only for the integrated flow. It accepts only a valid Clerk bearer credential, resolves the Clerk subject, requires an existing inline association, and requires `:id` to equal the associated API `userId`. Legacy JWTs and all legacy auth endpoints are outside the Expo flow and are not alternative credentials for this route. There is no dual-verifier fallback.

An authenticated but unprovisioned Clerk identity returns `403 IDENTITY_NOT_PROVISIONED`; it does not create a user or call profile provisioning. A malformed route ID returns `422 INVALID_USER_ID`; a valid but mismatched ID returns `403 NOT_OWNER`; a missing/invalid credential returns `401 AUTH_INVALID`; verification infrastructure failure returns `503 AUTH_PROVIDER_UNAVAILABLE`; a missing associated API user returns `404 USER_NOT_FOUND`.

## 6. Owned-subscription-list DTO

An authorized request returns `200`:

```json
{
  "success": true,
  "data": [{
    "_id": "665f000000000000000010",
    "name": "Example Plus",
    "price": 12.5,
    "currency": "USD",
    "frequency": "monthly",
    "category": "entertainment",
    "paymentMethod": "card",
    "status": "active",
    "startDate": "2026-01-01T00:00:00.000Z",
    "renewalDate": "2026-02-01T00:00:00.000Z",
    "user": "665f000000000000000001",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }]
}
```

`workflowRunId` is intentionally excluded. `renewalDate` is nullable for legacy records. IDs are strings, dates are UTC ISO 8601 strings, and the current model enums remain authoritative. The complete list is ordered by `createdAt` descending then `_id` descending; an empty list is `200` with `data: []`. A safely unrepresentable legacy record returns `500 DATA_INTEGRITY_ERROR` and no partial list. Database failures are not converted to an empty list.

## 7. Workflow terminology

The subscription reminder integration uses Upstash QStash as the delivery/orchestration service and `@upstash/workflow` as the server SDK. `workflowRunId` is an internal persistence value used by the existing reminder trigger; it is not a Clerk credential, Clerk session, or public integrated list field. This contract does not change QStash callback verification or reminder behavior.

## 8. Rollback and preservation

Rollback disables the new verifier, routes, and provider calls while preserving all existing users, inline identity associations, emails, passwords, and subscriptions. Failed provisioning rolls back only its own uncommitted writes. Application rollback must not delete associations or users. Repair or unlinking requires an audited operator migration and backup.

## 9. Credential configuration facts still to verify

These are implementation facts, not architecture decisions:

- The Clerk instance's JWKS URL, issuer, signing algorithm, and effective key rotation behavior.
- Whether the ordinary Clerk session token includes the required audience and the accepted `azp` value or omission for Expo/native requests.
- The exact approved audience, authorized-party allowlist, clock-skew allowance, and bounded JWKS timeout/refresh policy.
- The pinned Clerk User API origin and the response fields/status behavior for verified primary email and profile lookup.
- The Expo client route adoption and callback/request protection details.

## 10. API-02 implementation plan

1. Add the pinned jose dependency and configuration validation without installing it as part of this contract task.
2. Implement one Clerk verifier with strict claims policy and the `401` versus `503` distinction above.
3. Add the inline `User` fields and partial unique association index, preserving legacy records and conditional password behavior.
4. Add read-only identity resolution and empty-body provisioning with validated Clerk profile retrieval, transaction/index concurrency handling, and exact error envelopes.
5. Migrate `GET /api/v1/subscriptions/user/:id` to Clerk-only authorization and map records to the DTO without `workflowRunId`.
6. Add focused tests for credentials, key retrieval outcomes, provisioning races/conflicts, unprovisioned list access, serialization, rollback behavior, and DTO ordering.

## 11. Acceptance record

The implementation is accepted only when it proves: no email-only linking; no fake passwords; empty-body rejection of unexpected provisioning fields; idempotent and concurrent-safe provisioning; no profile synchronization on repeat; Clerk-only subscription-list authentication; `403 IDENTITY_NOT_PROVISIONED`; exact error envelopes/statuses; `workflowRunId` omission; no token/secret leakage; and preservation of development users, associations, and subscriptions during rollback.
