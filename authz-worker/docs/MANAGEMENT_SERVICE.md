# Management Service

The management Cloudflare Worker is the source of truth and API control plane for authorization configuration. Its canonical contract is [management-service.openapi.yaml](../openapi/management-service.openapi.yaml), currently OpenAPI 3.1 version 1.2.0.

## Managed Model

Each protected service owns a versioned vocabulary of allowed scope types and hierarchy, resource types, actions, permission profiles, path spaces, role templates, subject kinds, and compact-claim conventions. Scope, group, binding, and path-grant mutations are validated against that vocabulary before they are accepted or published.

D1 stores normalized drafts, subjects, entitlements, immutable version records, audit events, approvals, break-glass grants, projection state, and replication events. R2 is the runtime distribution layer. The authorization gateway remains read-only and evaluates the published service-global and scope-local artifacts.

## API Contract

The API covers:

- services, vocabulary, OpenAPI import, service drafts, versions, and publication;
- subjects plus SCIM-style user and group provisioning;
- scopes, groups, membership, bindings, and path grants;
- compact-claim previews backed by entitlement projections;
- Cedar authorization simulations;
- audit events, change requests, approval, and rejection;
- break-glass request, review, revocation, and expiry;
- projection rebuild and primary/replica publication status.

The Worker serves the same contract at `GET /openapi/management-service.openapi.yaml`. `src/management/generated-api.ts` is generated from it with `npm run generate:management-client`; contract tests check route parity and schema importability.

## Authentication

Routine browser and automation calls should enter through an authorization gateway. The management Worker accepts gateway actor headers only with the server-side `AUTHZ_GATEWAY_TOKEN`. A dedicated `SCIM_BEARER_TOKEN` protects provisioning routes. `MANAGEMENT_BOOTSTRAP_TOKEN` is limited to initial provisioning and controlled recovery.

See [Operational hardening](OPERATIONAL_HARDENING.md) for approval, emergency access, projections, replication, and alerting.

## React Console

The console in `ui/` is a replaceable OpenAPI client. It supports service vocabulary, scopes, identities, bindings, path grants, claim previews, simulations, publication review, audit, break-glass, and operational status. Configure its API URL at build time with `VITE_MANAGEMENT_API_BASE_URL`; pass user authentication to the management gateway rather than embedding server secrets.

Run it locally with `npm run dev:management-ui` or build static assets with `npm run build:management-ui`.
