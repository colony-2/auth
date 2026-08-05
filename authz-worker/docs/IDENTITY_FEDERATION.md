# Identity Federation And Provisioning

## OIDC Federation

The authentication Worker accepts verified upstream identity tokens at:

```text
POST /auth/federated/oidc
```

Configure providers with `OIDC_PROVIDERS_JSON`. Each provider has this shape:

```json
[
  {
    "providerId": "workforce",
    "issuer": "https://identity.example.com/",
    "clientId": "authz-platform",
    "jwksUrl": "https://identity.example.com/.well-known/jwks.json",
    "algorithms": ["ES256"],
    "requireVerifiedEmail": true,
    "requiredAcrValues": ["urn:example:mfa"],
    "jitProvisioning": false
  }
]
```

The request body contains `providerId`, upstream `idToken`, and the local target `audience`. The Worker verifies the upstream signature, issuer, client audience, allowed algorithm, expiration, issued-at age, verified email requirement, and configured `acr` assurance. It then links `(providerId, upstream sub)` to a local identity and mints the normal short-lived local token with compact `azs` claims.

With JIT disabled, the upstream verified email must match a subject provisioned ahead of time. This is the recommended production mode with SCIM. With JIT enabled, the Worker may create an active user subject on first login.

Identity providers that originate in SAML should terminate SAML at a trusted identity broker and issue an OIDC identity token to this endpoint. Native SAML assertion parsing is intentionally excluded because accepting XML assertions without complete XML signature, audience, recipient, time, and replay validation would weaken the authentication boundary.

## SCIM Provisioning

The management service exposes SCIM-style endpoints:

```text
GET, POST              /scim/v2/Users
GET, PUT, PATCH, DELETE /scim/v2/Users/{id}
GET, POST              /scim/v2/Groups
GET, PATCH, DELETE      /scim/v2/Groups/{id}
```

Use a dedicated high-entropy `SCIM_BEARER_TOKEN`; normal management tokens are not accepted on these routes. User deletion is a soft deactivation so existing subject and audit references remain valid. Group resources require `scopeId` because groups in this authorization model are scope-local. Group members reference provisioned subject IDs.

All SCIM mutations use the same management service methods as the regular API and therefore produce audit events and undergo group graph validation. Rotate provisioning tokens through the Cloudflare secret API and update the identity provider before retiring the old integration.
