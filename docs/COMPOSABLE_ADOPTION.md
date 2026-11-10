# Composable Service Adoption

Authentication, authorization, and management have explicit contracts and can be adopted independently. The authorization gateway is the only component required on a protected request path.

## Supported Combinations

| Authentication | Authorization | Management | Integration |
| --- | --- | --- | --- |
| Existing | This project | Existing | Mint compatible JWTs and publish runtime artifacts directly to R2. |
| This project | This project | Existing | Expose the entitlement projection endpoint described below. |
| Existing | This project | This project | Mint the documented JWT contract and use management to publish artifacts. |
| This project | This project | This project | Use the complete D1, R2, authn, Cedar, and React console workflow. |

## Authn With External Entitlements

`MANAGEMENT_API_URL` is the base URL of a compatible entitlement service. It does not require deployment of this repository's management Worker. Authn requests effective compact claims whenever it issues a user or service-account access token:

```http
GET {MANAGEMENT_API_URL}/services/{serviceId}/subjects/{subjectId}/claim-preview
Authorization: Bearer {MANAGEMENT_API_TOKEN}
```

The successful response is:

```json
{
  "subjectId": "user-alice",
  "serviceId": "projects-api",
  "azv": 1,
  "azs": [
    "pa|rviewer|Pr:files:shared-docs"
  ]
}
```

Set `MANAGEMENT_API_TOKEN` as a Worker secret. A Cloudflare service binding named `MANAGEMENT_API` can carry the same request without public Internet routing. The external service owns entitlement calculation and should validate the requested subject and service. Authn continues to own identities, credentials, refresh sessions, signing keys, and token issuance.

An unavailable or invalid entitlement response fails token issuance. Authn does not mint a token with silently missing authorization state.

## Authz With An Existing Issuer

Configure `JWKS_URL`, `JWT_ISSUER`, and `SERVICE_IDENTIFIER`. Tokens must contain the expected issuer, service audience, subject, expiry, authorization version, and compact scope claims:

```json
{
  "iss": "https://issuer.example.com/",
  "aud": "projects-api",
  "sub": "user-alice",
  "azv": 1,
  "azs": ["pa|rviewer"],
  "suspended": false
}
```

## Authz With Existing Policy Management

An existing control plane can publish directly to the runtime R2 layout:

```text
authz/{serviceId}/service/{version}/config.json
authz/{serviceId}/service/manifest.json
authz/{serviceId}/scopes/{scopeId}/{version}/config.yaml
authz/{serviceId}/scopes/{scopeId}/manifest.json
```

Validate new immutable versions before writing them. Write the versioned object first and update its manifest last. Use the authenticated cache-invalidation endpoint when activation cannot wait for normal cache expiry.

## Application Integration

Use proxy mode for an external HTTP backend. Allowed requests are forwarded to `UPSTREAM_ORIGIN` with trusted `x-authz-*` context. Use embedded mode when the protected application is already a Cloudflare Worker and should retain its own routing without an additional proxy hop.

The React console Help section includes the same adoption matrix, proxy and embedded examples, runtime diagram, configuration reference, demo walkthrough, and troubleshooting checks.
