# Authentication Service

The authentication Cloudflare Worker proves local or federated identity, owns session lifecycle, and issues audience-bound JWTs for the authorization gateway. It reads subjects and projected compact claims from the shared D1 control plane; it does not evaluate Cedar policy.

## Token Contract

Access tokens are asymmetrically signed with ES256 or RS256 and include `iss`, `aud`, `sub`, `iat`, `exp`, `azv`, `azs`, and `suspended`. The gateway validates the signature through `GET /.well-known/jwks.json`, verifies issuer and audience, and expands the current scope entry from `azs`.

Refresh tokens are opaque, hashed in D1, rotated on use, and revocable by session. Service-account credentials are also stored as hashes. Private signing JWKs, internal API tokens, and IP-hash material are Cloudflare secrets.

## Routes

- `POST /auth/login`, `/auth/refresh`, and `/auth/logout` manage local sessions.
- `POST /auth/federated/oidc` exchanges a verified upstream identity token for a local session.
- `POST /service-accounts/{id}/tokens` issues an access token from a service-account credential.
- `POST /auth/introspect` returns internal token status when called with the internal auth token.
- `GET /auth/sessions` and `DELETE /auth/sessions/{id}` expose session review and revocation.
- `POST /auth/mfa/enroll` and `/auth/mfa/verify` manage TOTP enrollment and verification.
- `GET /health` and `GET /.well-known/jwks.json` are public operational endpoints.

Federation configuration and SCIM provisioning are documented in [Identity federation](IDENTITY_FEDERATION.md).

## Local Operation

`npm run demo:up` generates local signing material, applies D1 migrations, starts the complete service graph, and seeds identities and entitlements. Run the authentication Worker alone with `npm run dev:authn` after populating `.dev.vars.authn` and applying migrations.

The default access-token lifetime is ten minutes in the example environment. Production configuration should preserve short access tokens, rotate signing keys with a JWKS overlap window, require MFA assurance for administrators, disable the bootstrap endpoint, and restrict the internal token and management API token to service-to-service use.

## Claim Freshness

Each login, refresh, or service-account token request obtains the current projected claims from the management service. Membership removal, binding changes, and break-glass approval therefore affect the next token. Existing signed access tokens remain valid until expiry unless the protected global policy denies an embedded state such as `suspended`.

## External Entitlement Source

The authentication Worker does not require this repository's management service. `MANAGEMENT_API_URL` may point to any trusted service that implements `GET /services/{serviceId}/subjects/{subjectId}/claim-preview` and returns `azv` plus compact `azs` claims. Protect it with the `MANAGEMENT_API_TOKEN` secret or a `MANAGEMENT_API` service binding.

See [Composable adoption](COMPOSABLE_ADOPTION.md) for the request and response contract, supported service combinations, and existing-issuer and existing-policy-management integration paths.
