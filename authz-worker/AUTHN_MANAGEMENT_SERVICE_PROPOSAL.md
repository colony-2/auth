# Authentication And Management Service Proposal

## Summary

Build two companion services around the existing authorization Worker:

- **Authentication service**: owns login, identity proofing, session lifecycle, token issuance, JWKS, and compact `azs` authorization claims.
- **Management service**: owns scopes, subjects, groups, bindings, role assignments, path grants, policy artifact publishing, audit history, and administrative APIs.

The existing authz Worker should stay focused on request-time authorization. It verifies JWTs, resolves the current `Scope`, loads service-global and scope-local artifacts from R2, evaluates Cedar, and either allows, denies, or proxies the request. The new services should feed it trusted identity data and versioned authorization artifacts without moving policy evaluation into application services.

## Goals

- Provide a production control plane for the current authz runtime model.
- Issue JWTs that the Worker can verify through `JWKS_URL` and interpret through compact `azs` claims.
- Manage `Scope`, `User`, `ServiceAccount`, `Group`, `Binding`, role, and path grant lifecycle.
- Publish service-global and scope-local artifacts to the existing R2 layout:

```text
authz/{SERVICE_IDENTIFIER}/service/manifest.json
authz/{SERVICE_IDENTIFIER}/service/{version}/config.json
authz/{SERVICE_IDENTIFIER}/scopes/{scopeId}/manifest.json
authz/{SERVICE_IDENTIFIER}/scopes/{scopeId}/{version}/config.yaml
```

- Keep all authorization decisions centralized in the authz Worker and Cedar policies.
- Support both proxy and embedded integration modes already documented in this package.
- Ship a demo/sample application that developers can run locally to understand and test the concepts end to end.
- Define the management service with a versioned OpenAPI specification.
- Ship a reference React management UI for teams that do not already have an internal admin surface.
- Define a repeatable methodology for local development, automated testing, and Cloudflare deployment.

## Non-Goals

- Replacing the Cedar authorization Worker.
- Making every upstream application parse roles, groups, path grants, or policies.
- Building a full enterprise identity provider in v1.
- Requiring every customer to use the same login method.
- Requiring users to adopt the bundled React UI if they already have an internal control plane.

## Architecture

```text
Users / service clients
        |
        v
Authentication service ---- publishes JWKS ----> public JWKS endpoint
        |
        | issues JWT with sub, iss, aud, azv, azs
        v
Protected request
        |
        v
Authz Worker ---- reads artifacts ----> R2 policy bucket
        |
        | allow / deny
        v
Upstream service

Administrators / automation
        |
        v
React management UI / internal tools
        |
        v
Management service ---- publishes artifacts ----> R2 policy bucket
        |
        +---- optional cache invalidation ----> admin worker/control route
```

## Service Responsibilities

### Authentication Service

The authentication service is the issuer of request credentials.

Core responsibilities:

- User login and account recovery.
- Service account credential issuance.
- Session refresh and revocation.
- JWT signing and key rotation.
- JWKS publication.
- Token audience and issuer management.
- Claim construction for the authz Worker.

The JWT contract should include:

```json
{
  "iss": "https://auth.example.com/",
  "aud": "projects-api",
  "sub": "user_alice",
  "azv": 1,
  "azs": [
    "scope_alpha|r2|g7|Pr:shared_docs|pw:home/alice/drafts/"
  ],
  "suspended": false,
  "iat": 1720000000,
  "exp": 1720003600
}
```

`azs` should be generated from management-service entitlement state. The first token in each compact claim must match the scope claim reference used by the scope-local config, either `claimId` or `scopeId` by convention.

Recommended token behavior:

- Access tokens are short lived, for example 5 to 15 minutes.
- Refresh tokens are opaque, stored server-side, and revocable.
- Signing keys rotate with overlapping JWKS validity.
- Tokens are minted per target audience/service where practical.
- Suspended users should receive no new access tokens, and existing tokens should be denied by the Worker when `suspended == true` is present and enforced by global policy.

### Management Service

The management service is the system of record for authorization administration.

Core responsibilities:

- Define the service vocabulary: known scope types, resource types, path spaces, actions, permission profiles, role templates, subject kinds, and claim conventions.
- Create and manage scopes.
- Store scope metadata: `scopeId`, `scopeType`, `parentScopeId`, and optional `claimId`.
- Manage users and service accounts as authorization subjects.
- Manage groups, nested groups, and membership.
- Manage bindings from subjects to roles or direct grants.
- Manage named and inline path grants.
- Manage role template assignment and catalog changes.
- Manage service-global config updates: OpenAPI import, auth descriptor, snippets, global policy, role templates, named paths, path permission catalog.
- Manage scope-local config updates: groups, bindings, includes, policy overlays, named paths, static entities.
- Maintain a canonical OpenAPI specification for the management API.
- Validate configs before publishing.
- Write versioned artifacts and update manifests atomically enough for Worker reads.
- Keep an audit log for all admin mutations and publish events.

### Service Vocabulary

Each protected service should have an explicit vocabulary managed by the management service. This is the service-specific authorization ontology: the set of concepts administrators are allowed to use when creating scopes, policies, bindings, and claims.

The vocabulary should define:

- `scopeTypes`: allowed container types such as `organization`, `workspace`, `project`, `account`, or `environment`.
- `scopeHierarchy`: allowed parent-child relationships, for example `organization -> workspace -> project`.
- `resourceTypes`: known resource types such as `Project`, `Issue`, `Board`, `Cluster`, `Bucket`, or `PathObject`.
- `pathSpaces`: known path namespaces and anchors, for example service-rooted `files` or resource-rooted project files.
- `actions`: service actions, usually derived from OpenAPI operation IDs and the compiled auth descriptor.
- `permissionProfiles`: allowed permission profiles and permission IDs, starting with built-in `object` and `path`.
- `roleTemplates`: service-level roles that administrators can bind inside scopes.
- `subjectKinds`: allowed subject kinds, initially `User`, `ServiceAccount`, and `Group`.
- `claimConventions`: whether compact `azs` scope references use `scopeId`, explicit `claimId`, or another service-local convention.

This vocabulary should be versioned with the service-global config. Scope-local administration should validate against the active vocabulary before accepting or publishing changes. For example, a user should not be able to create a scope with an unknown `scopeType`, bind a role ID that is not in `roleTemplates`, or grant a path namespace that is not in `pathSpaces`.

OpenAPI import should populate part of the vocabulary automatically, especially `actions`, `resourceTypes`, path patterns, and action-to-permission mappings. Operators should still be able to curate the vocabulary because not every authorization concept is visible from OpenAPI alone.

The management service can initially use the existing publish functions or admin routes:

- `POST /internal/service-config/publish`
- `POST /internal/scope-config/publish`
- `POST /internal/cache/invalidate`

For production, prefer direct R2 publishing from the management service plus a small authenticated cache invalidation endpoint. The main authz Worker should remain read-only.

## Data Model

Use the existing authz domain model as the shared language.

Primary entities:

- `Identity`: login account controlled by the authentication service.
- `Subject`: authorizable actor, mapped to `User`, `ServiceAccount`, or `Group`.
- `ServiceVocabulary`: service-specific catalog of allowed authorization concepts.
- `Scope`: authorization container with `scope_id`, `scope_type`, and optional parent.
- `Group`: reusable subject collection, usually scope-local.
- `RoleTemplate`: service-global reusable role definition.
- `Binding`: entitlement edge connecting a subject to a role or direct grant in a scope.
- `PathGrant`: named or inline path grant in a namespace.
- `ServiceConfigVersion`: immutable service-global artifact version.
- `ScopeConfigVersion`: immutable scope-local artifact version.
- `AuditEvent`: append-only record of administrative or authn-sensitive changes.

The management service should store normalized records in a durable database, then compile them into the exact JSON/YAML artifacts consumed by the Worker. R2 should be treated as the runtime distribution layer, not the only source of truth.

## API Surface

### Authentication APIs

Initial endpoints:

- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/refresh`
- `GET /.well-known/jwks.json`
- `POST /service-accounts/{id}/tokens`
- `POST /auth/introspect` for internal debugging or support tooling

Optional later endpoints:

- `POST /auth/mfa/challenge`
- `POST /auth/mfa/verify`
- `POST /auth/password/reset`
- `GET /auth/sessions`
- `DELETE /auth/sessions/{id}`

### Management APIs

Initial endpoints:

- `GET /services/{serviceId}/vocabulary`
- `PUT /services/{serviceId}/vocabulary`
- `POST /services/{serviceId}/import-openapi`
- `GET /services/{serviceId}/config`
- `POST /services/{serviceId}/publish`
- `POST /scopes`
- `GET /scopes/{scopeId}`
- `PATCH /scopes/{scopeId}`
- `POST /scopes/{scopeId}/groups`
- `PUT /scopes/{scopeId}/groups/{groupId}/members/{subjectId}`
- `DELETE /scopes/{scopeId}/groups/{groupId}/members/{subjectId}`
- `POST /scopes/{scopeId}/bindings`
- `DELETE /scopes/{scopeId}/bindings/{bindingId}`
- `POST /scopes/{scopeId}/path-grants`
- `POST /scopes/{scopeId}/publish`
- `POST /services/{serviceId}/cache/invalidate`
- `GET /audit-events`

All management APIs should themselves be protected by the authz Worker. Administrative actions should have explicit `actionCatalog` entries and Cedar policies, for example `manageScope`, `publishServiceConfig`, and `manageBindings`.

### Management OpenAPI Contract

The management service should ship with a well-defined OpenAPI 3.1 specification. This specification is the public contract for internal tools, automation, the bundled React UI, generated clients, and conformance tests.

The OpenAPI contract should define:

- Every management endpoint, request body, response body, path parameter, query parameter, and header.
- Shared schemas for `ServiceVocabulary`, `Scope`, `Subject`, `Group`, `Binding`, `PathGrant`, `RoleTemplate`, `ServiceConfigVersion`, `ScopeConfigVersion`, `PublishResult`, `AuditEvent`, and structured errors.
- Authentication and authorization requirements for each route.
- Standard error responses, including validation failures, vocabulary violations, publish conflicts, authorization failures, and missing resources.
- Idempotency behavior for mutation endpoints that may be retried by automation.
- Pagination, filtering, and sorting conventions for list endpoints.
- Versioning policy for backward-compatible and breaking API changes.

The implementation should use the spec actively, not only as documentation:

- Generate or validate TypeScript types for the management service.
- Generate the React UI API client from the same spec.
- Run contract tests that verify the implementation matches the OpenAPI document.
- Publish the spec as an artifact, for example `openapi/management-service.openapi.yaml`.
- Keep examples in the spec aligned with the demo application seed data.

### Reference React UI

The management service should include a React UI that works against the OpenAPI-defined management API. This UI is the default operational surface for teams that have not built their own internal admin UI.

The UI should be a regular client of the management API. It should not rely on private database access, private R2 access, or hidden management-service internals. That keeps it replaceable and makes it a useful reference implementation for custom internal tools.

Initial UI capabilities:

- Browse and edit service vocabulary.
- Import OpenAPI and review derived actions, resources, path spaces, and permission mappings.
- Browse scopes and scope hierarchy.
- Create and edit scopes.
- Manage users, service accounts, groups, and group membership.
- Create, edit, and remove bindings.
- Create and review named path and inline path grants.
- Preview compact `azs` claims for a subject.
- Publish service-global and scope-local config versions.
- Show publish history, active versions, and audit events.
- Run an authorization simulation against a selected user, token shape, scope, method, and path.

The UI should support configurable deployment:

- `MANAGEMENT_API_BASE_URL`
- authentication settings for the chosen issuer
- read-only mode for demos or support usage
- local demo mode with seeded data

For production, the UI should be deployable as a static React application behind the same authentication and authorization controls as the management API.

## Integration With Existing Authz Worker

The authz Worker expects:

- `JWKS_URL` pointing at the authentication service JWKS endpoint.
- `JWT_ISSUER` matching authentication service `iss`.
- `SERVICE_IDENTIFIER` matching JWT `aud`.
- JWT `sub`, `azv`, and compact `azs` claims.
- Service-global and scope-local artifacts in R2.
- A scope resolver that can resolve the current request scope.

The management service should publish config versions to R2 and update manifests in this order:

1. Validate service or scope input.
2. Compile records into `ServiceGlobalConfig` or `ScopePolicyConfig`.
3. Write the immutable versioned artifact.
4. Update the manifest to point at the new active version.
5. Optionally call cache invalidation for immediate rollout.
6. Write an audit event with previous and new version IDs.

The authentication service should not directly evaluate authorization. It should ask the management data store for effective entitlements or consume an entitlement projection, then encode those entitlements into `azs`.

## Demo And Evaluation Application

The plan should include a first-party demo application that acts as the reference integration for the authn service, management service, and authz Worker. This should be more than a toy smoke test: it should be the executable tutorial for the concepts in this system.

Recommended sample domain: a project workspace service with fixed resources and path resources.

Concepts to include:

- Scope types: `organization`, `workspace`, and `project`.
- Scope hierarchy: `organization -> workspace -> project`.
- Resource types: `Project`, `Issue`, `Board`, and `PathObject`.
- Path spaces: service-rooted `/files/{path+}`, service-rooted `/datasets/{path+}`, and resource-rooted `/projects/{projectId}/files/{path+}`.
- Roles: `viewer`, `member`, `project-manager`, and `scope-admin`.
- Groups: `ops-team`, `contractors`, and `project-leads`.
- Users: `alice`, `bob`, `carol`, and one suspended user.
- Service accounts: at least one automation client with narrow permissions.
- Path grants: named paths, inline prefixes, default namespace grants, and namespaced grants.

The demo should run locally with one command and include:

- A protected sample API behind the authz Worker.
- A minimal authentication service that signs JWTs and exposes JWKS.
- A minimal management service that edits scopes, groups, bindings, path grants, and vocabulary.
- Seed data for service vocabulary, service-global config, scope-local configs, users, groups, and bindings.
- Scripted request scenarios that print allow/deny decisions and relevant injected authz headers.
- A small test suite that verifies behavior after management changes and republishing.

The developer workflow should support:

```bash
npm run demo:up
npm run demo:seed
npm run demo:token -- --user alice --aud projects-api
npm run demo:request -- --user alice --method GET --path /projects/proj_a
npm run demo:test
```

The exact command names can change, but the workflow should make these behaviors obvious:

- A viewer can read a project but cannot update it.
- A project manager can read and update project resources inside the current scope.
- A scope admin can manage bindings for that scope.
- A named path grant allows access to a shared prefix.
- A namespaced path grant for `datasets` does not accidentally grant access to `files`.
- A resource-rooted project file grant only applies inside the anchored project.
- Removing a group membership changes the next minted token's `azs`.
- Publishing a scope-local config changes Worker behavior after cache expiration or invalidation.
- A suspended user is denied even if their compact grants would otherwise allow the request.
- An invalid management update, such as an unknown scope type or path namespace, is rejected by vocabulary validation.

This demo should live under an `examples/` or `samples/` directory and should be kept in CI as a regression harness. The goal is for new developers to learn the system by changing a binding, minting a token, publishing config, and seeing the resulting authorization decision change.

## Local Testing And Cloudflare Deployment

The project should include a documented methodology for running the full system locally, testing behavior, and deploying the same components to Cloudflare.

### Local Development Topology

The local stack should run the same logical services used in production:

- Authz Worker enforcing protected sample API requests.
- Authentication service exposing login/token endpoints and JWKS.
- Management API serving the OpenAPI-defined control plane.
- React management UI pointed at the local management API.
- Demo protected API behind the authz Worker.
- Local R2-compatible policy artifact storage through Wrangler development bindings.
- Seed data for users, service accounts, scopes, vocabulary, groups, bindings, and path grants.

Recommended local commands:

```bash
npm run dev:authz
npm run dev:authn
npm run dev:management
npm run dev:management-ui
npm run dev:demo-api
npm run demo:up
```

`npm run demo:up` should be the preferred onboarding command. It should start all required local processes, print service URLs, seed the demo state, publish initial artifacts, and verify the authz Worker can reach the local JWKS endpoint.

### Local Test Methodology

Local testing should be layered so failures are easy to isolate:

- Unit tests for claim construction, compact `azs` parsing, vocabulary validation, group expansion, binding compilation, path grant normalization, and OpenAPI descriptor compilation.
- Management API contract tests generated from or validated against `openapi/management-service.openapi.yaml`.
- React UI tests with mocked API responses generated from the OpenAPI schemas.
- Integration tests that start authn, management, authz, and demo API services locally.
- End-to-end demo tests that mint real local JWTs, publish local R2 artifacts, call protected routes, and assert allow/deny behavior.
- Regression tests for cache invalidation and manifest version switching.

Recommended verification commands:

```bash
npm run typecheck
npm run test
npm run test:contract
npm run test:integration
npm run demo:test
```

The demo test suite should assert both API behavior and management behavior. For example, it should verify that changing group membership affects the next minted JWT, publishing a scope config changes Worker decisions, and invalid vocabulary updates are rejected before publish.

### Cloudflare Deployment Methodology

Cloudflare deployment should use the same artifact model as local development, with separate environments for development, staging, and production.

Recommended Cloudflare components:

- Authz Worker deployed with `POLICY_BUCKET`, `SERVICE_IDENTIFIER`, `JWKS_URL`, `JWT_ISSUER`, `UPSTREAM_ORIGIN`, and `SCOPE_RESOLUTION`.
- Authentication Worker or service deployed with signing-key secrets and a public JWKS route.
- Management API Worker deployed with access to its source-of-truth database, the policy R2 bucket, and cache invalidation credentials.
- React management UI deployed as a static site or Worker-served assets.
- R2 bucket per environment for versioned authz artifacts.
- Durable database per environment for management source-of-truth records.
- Cloudflare secrets for JWT signing keys, refresh-token secrets, admin bootstrap credentials, and service-to-service credentials.

Deployment should be environment-scoped. Each environment should have its own:

- R2 policy bucket.
- management database.
- JWT issuer URL.
- JWKS URL.
- Worker routes or custom domains.
- service identifiers and audiences.
- secrets and key material.

Recommended deployment order:

1. Create or migrate the management database.
2. Create the environment R2 policy bucket.
3. Deploy the authentication service and verify JWKS.
4. Deploy the management API.
5. Seed service vocabulary and initial service-global config.
6. Publish initial service-global and scope-local artifacts to R2.
7. Deploy the protected demo API or configure the real upstream origin.
8. Deploy the authz Worker with the final `JWKS_URL`, `JWT_ISSUER`, `SERVICE_IDENTIFIER`, and `UPSTREAM_ORIGIN`.
9. Deploy the React management UI pointed at the deployed management API.
10. Run deployment smoke tests.

Recommended deployment commands:

```bash
npm run deploy:authn -- --env staging
npm run deploy:management -- --env staging
npm run deploy:management-ui -- --env staging
npm run deploy:authz -- --env staging
npm run smoke:staging
```

The exact commands can vary by package layout, but the repository should include scripts or runbooks for creating buckets, applying database migrations, setting secrets, deploying Workers, deploying the UI, and rolling back to previous artifact versions.

### Deployment Smoke Tests

Every Cloudflare deployment should run smoke tests against the deployed URLs:

- Fetch the authentication service JWKS endpoint.
- Mint or retrieve a test token for a seeded subject.
- Fetch management service health and OpenAPI spec endpoints.
- Publish or validate a non-production scope config.
- Confirm the authz Worker can load service and scope manifests from R2.
- Call a known allowed demo route and assert `200`.
- Call a known denied demo route and assert `403`.
- Confirm expected authz headers are injected on allow.
- Confirm the React UI can load configuration and call the management API.

Production promotion should require the staging smoke suite to pass and should preserve a rollback path by keeping previous service and scope artifact versions available in R2.

## Security Requirements

- Use asymmetric JWT signing for production, preferably `RS256` or `ES256`.
- Keep private signing keys in a managed secret store or KMS-backed environment.
- Rotate signing keys and expose multiple active public keys through JWKS during rollout.
- Store refresh tokens as hashed opaque secrets.
- Require MFA for human administrators.
- Require scoped service-account credentials for automation.
- Make management mutations authorization-protected and audit logged.
- Validate group graphs for cycles and bounded nesting before publish.
- Validate role and binding references before publish.
- Treat R2 artifacts as immutable once versioned.
- Avoid logging bearer tokens, refresh tokens, or private key material.

## Phased Delivery

### Phase 1: Minimal Production Path

- Authentication service with login, refresh, JWKS, JWT signing, and service account tokens.
- Management service with scope, group, binding, role assignment, and publish APIs.
- OpenAPI 3.1 specification for the management service API.
- Reference React UI for vocabulary, scope, group, binding, path grant, publish, audit, and simulation workflows.
- Direct generation of compact `azs` claims from stored bindings.
- Direct R2 publishing for scope-local artifacts.
- Manual or CLI-assisted service-global publishing.
- Audit log for all entitlement and publish changes.
- Runnable demo application with seeded users, scopes, groups, bindings, path grants, token minting, and scripted allow/deny checks.
- Local run/test scripts for authn, management API, React UI, authz Worker, and demo API.
- Initial Cloudflare deployment runbook for staging.

### Phase 2: Service Config Control Plane

- OpenAPI import and auth descriptor compilation.
- Service-global role template, snippet, named path, and path permission management.
- Policy validation before publish.
- Diff and approval workflow for service-global changes.
- Cache invalidation integrated with publish.
- Demo coverage for service vocabulary editing, OpenAPI re-import, service-global publishing, and policy simulation.
- Generated client and server-side validation flow from the management OpenAPI contract.
- React UI support for service-global config editing and publish approval workflows.
- Environment-scoped Cloudflare deployment scripts, migrations, secret setup, smoke tests, and rollback procedure.

### Phase 3: Enterprise Hardening

- MFA, SSO/SAML/OIDC federation, and SCIM-style provisioning.
- Event-driven entitlement projection for fast token minting.
- Break-glass admin flow.
- Advanced admin UI workflows for approvals, impact analysis, and support/debug views.
- Policy simulation and impact analysis before publish.
- Cross-region artifact replication and operational dashboards.

## Open Questions

- Should scope claim refs always equal `scopeId`, or should `claimId` be mandatory for compactness and portability?
- Should JWTs carry all scope entitlements, or should the authn service mint audience and scope narrowed tokens by default?
- What database should be the management source of truth?
- Do we need near-real-time revocation beyond short token lifetimes and the existing `suspended` global policy?
- Should service-global publishing require human approval while scope-local entitlement changes publish automatically?

## Recommended Initial Decision

Start with separate authentication and management services, but share one normalized entitlement database or entitlement projection between them. The management service remains the source of truth for authorization state. The authentication service reads that state only to mint compact claims. The authz Worker remains read-only and continues to be the only request-time policy enforcement point.
