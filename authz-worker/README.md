# Authz Worker

`authz-worker` is a Cloudflare Worker authorization gateway built around:

- TypeScript
- `@cedar-policy/cedar-wasm/web`
- Cloudflare Workers + R2
- Cedar policy
- compact JWT scope claims
- a service auth descriptor compiled from OpenAPI

It follows the Cedar runtime path from [CEDAR_CLOUDFLARE_HANDOFF.md](/src/CEDAR_CLOUDFLARE_HANDOFF.md): explicit wasm import, `initSync({ module })`, `preparsePolicySet()`, optional `preparseSchema()`, and `statefulIsAuthorized()` on the hot path.

The package supports:

- proxy mode for protecting existing HTTP services
- embedded mode for decorating an existing Worker handler

OpenAPI is still the source contract for actions and resources, but the runtime uses the compiled auth descriptor derived from that contract.

## Core Model

The framework now uses one container concept:

- `Scope`

A scope has:

- `scope_id`
- `scope_type`
- optional `parent_scope_id`

Examples:

- `scope_type = "project"`
- `scope_type = "workspace"`
- `scope_type = "organization"`

This avoids separate first-class `tenant` and `organization` concepts in the runtime. An organization is just another scope type.

Other first-class concepts are:

- `Principal`
- `Subject`
- `Resource`
- `Action`
- `Context`
- `PathSpace`
- `PathObject`
- `RoleTemplate`
- `Group`
- `Binding`
- named and inline path grants

## What The Runtime Does

For a protected request, the worker:

1. matches the request against the compiled auth descriptor
2. resolves one current scope from the configured scope resolution chain
3. verifies the bearer JWT
4. loads service-global config from R2
5. loads scope-local policy config from R2
6. expands the current scope claim from compact `azs` claim strings
7. resolves `action + permission_profile + permission_id + target_kind`
8. resolves `PathSpace` metadata for path-aware operations
9. expands named and inline path grants
10. assembles effective Cedar policy from global policy + snippets + scope overlay
11. evaluates authorization with Cedar
12. proxies upstream or continues to the embedded handler on allow

## Config Model

### Service-Global Config

Stored once per service in R2 as JSON.

It owns:

- optional Cedar schema
- optional raw OpenAPI document
- compiled auth descriptor
- permission profiles
- action catalog
- global Cedar policy
- reusable policy snippets
- role templates
- path permission catalog
- global named paths
- optional global groups
- optional static entities

`namedPaths` supports:

- a flat map for the default namespace
- nested namespace maps for multiple path systems

Example:

```json
{
  "namedPaths": {
    "shared_docs": "shared/docs/",
    "datasets": {
      "customer_raw": "customers/acme/raw/"
    }
  }
}
```

### Scope-Local Config

Stored per scope in R2 as YAML.

It owns:

- `scopeId`
- optional `claimId`
- optional `scopeType`
- optional `parentScopeId`
- optional scope-local groups
- optional scope-local bindings
- snippet includes
- scope-local Cedar policy
- scope-local named paths
- optional static entities

### Effective Policy Assembly

At load time, the runtime assembles:

1. `globalPolicy`
2. included snippets
3. scope-local `policy`

That combined Cedar source is what gets preparsed and evaluated.

## Compact Claims

The current model is built around a compact per-scope claim list in the JWT:

```json
{
  "sub": "user_alice",
  "azv": 1,
  "azs": [
    "sa|r2|g7|Pr:shared_docs|Pr:files:shared_docs|Pr:workspace_docs|pw:home/alice/drafts/|P42:archive_area"
  ]
}
```

Meaning:

- `sa` is the scope claim reference
- `r2` means role ID `2`
- `g7` means effective group ID `7`
- `Pr:shared_docs` is a named path grant
- `pw:home/alice/drafts/` is an inline path grant
- `P42:archive_area` is a named path grant using custom permission `42`

### Path Grant Format

Path grants are first-class.

- `P<perm>:<name>` = named path grant
- `p<perm>:<prefix>` = inline path grant
- `P<perm>:<namespace>:<name>` = namespaced named path grant
- `p<perm>:<namespace>:<prefix>` = namespaced inline path grant

Examples:

- `Pr:shared_docs`
- `pw:home/alice/drafts/`
- `P42:archive_area`
- `Pr:datasets:customer_raw`
- `pw:datasets:customers/acme/tmp/`

Built-in common filesystem permission IDs are:

- `l` list
- `t` traverse
- `i` inspect
- `r` read
- `w` write
- `c` create
- `d` delete
- `m` move
- `x` execute
- `a` administer

Custom permission IDs are supported through the service `pathPermissionCatalog`.

If no namespace is present, the runtime uses the implicit `default` namespace.

## Scope Resolution

In proxy mode, `SCOPE_RESOLUTION` is an ordered JSON resolver list. In embedded mode, pass the same structure as `scopeResolution` in the `runtime` argument.

If no explicit scope resolution config is provided, the runtime uses a built-in default chain. The first resolver that yields a scope wins.

Supported resolver types:

- `path`
- `header`
- `body_json`
- `body_regex`

The default local config in [wrangler.jsonc](/src/authz-worker/wrangler.jsonc) checks:

1. `x-scope-id`
2. JSON body `/scopeId`
3. regex over text/form body
4. `/scope-path/{scopeId}/...`

If a protected route matches but no resolver yields a scope, the worker returns `400 scope_resolution_failed`.

## Path Authorization Model

Path permissions are built into the runtime.

For path-aware targets, the worker:

1. canonicalizes the requested path
2. expands named and inline path grants from the current scope claim
3. resolves `PathSpace` metadata from the compiled descriptor
4. matches grants by namespace and prefix
5. compares grants against the resolved permission ID
6. injects normalized facts into the Cedar principal

Important principal attrs include:

- `action_permission_profile`
- `action_permission_id`
- `action_target_kind`
- `path_permission_ids`
- `path_action_permission_ids`
- `path_permission_prefixes`
- `path_action_allowed`
- `path_namespace`
- `path_anchor_kind`
- `path_anchor_resource_type`
- `path_anchor_resource_id`

This means Cedar policy does not need to parse arbitrary path syntax itself. The gateway does the prefix work, and Cedar evaluates the normalized result.

This is how a single service can support multiple path systems cleanly:

- default namespace for the common case
- explicit namespaces like `datasets` when a second hierarchical path space exists
- service-rooted path spaces like `/files/{path+}`
- resource-rooted path spaces like `/projects/{projectId}/files/{path+}`

## Worker Modes

### Proxy Mode

[src/index.ts](/src/authz-worker/src/index.ts) exports `createAuthzProxy()`.

Allowed requests are proxied to `UPSTREAM_ORIGIN`. The worker injects headers such as:

- `x-authz-scope-id`
- `x-authz-scope-type`
- `x-authz-resource-scope-id`
- `x-authz-operation-id`
- `x-authz-action`
- `x-authz-permission-profile`
- `x-authz-permission-id`
- `x-authz-target-kind`
- `x-authz-path-namespace`
- `x-authz-path-anchor-kind`
- `x-authz-path-anchor-resource-type`
- `x-authz-path-anchor-resource-id`
- `x-authz-service-version`
- `x-authz-scope-version`

### Embedded Mode

[src/embedded-example.ts](/src/authz-worker/src/embedded-example.ts) shows `withAuthorization()`.

Allowed requests continue to the wrapped handler with a `decision` object. Unresolved routes pass `decision = null`.

## Integration Guides

There are two intended integration modes:

- [INTERNAL_INTEGRATION_GUIDE.md](/src/authz-worker/INTERNAL_INTEGRATION_GUIDE.md): embed authz as a library inside an existing Worker
- [EXTERNAL_INTEGRATION_GUIDE.md](/src/authz-worker/EXTERNAL_INTEGRATION_GUIDE.md): front an external HTTP service with the authz proxy
- [C2A_CLI_PROPOSAL.md](/src/authz-worker/C2A_CLI_PROPOSAL.md): proposed Go + Cobra CLI for config, JWT, policy, evaluation, and publish workflows

## Design Docs

- [AUTHZ_DOMAIN_MODEL.md](/src/authz-worker/AUTHZ_DOMAIN_MODEL.md): opinionated model for scopes, permissions, roles, groups, bindings, and path spaces
- [AUTHN_MANAGEMENT_SERVICE_PROPOSAL.md](/src/authz-worker/AUTHN_MANAGEMENT_SERVICE_PROPOSAL.md): initial proposal for companion authentication and management services
- [cloudflare-worker-authz-gateway-proposal.md](/src/cloudflare-worker-authz-gateway-proposal.md): broader gateway proposal and implementation direction

## R2 Layout

Service-global artifacts:

```text
authz/{SERVICE_IDENTIFIER}/service/manifest.json
authz/{SERVICE_IDENTIFIER}/service/{version}/config.json
```

Scope-local artifacts:

```text
authz/{SERVICE_IDENTIFIER}/scopes/{scopeId}/manifest.json
authz/{SERVICE_IDENTIFIER}/scopes/{scopeId}/{version}/config.yaml
```

## Control Routes

### `GET /health`

Returns Cedar readiness and cache sizes.

The authz worker is read-only. It does not expose publish or cache-invalidation routes.

Out-of-band tooling or a separate admin surface should manage R2 artifacts.

## Runtime Config

### Proxy Mode

Proxy mode reads config from env:

- `POLICY_BUCKET`: R2 binding for policy/config artifacts
- `SERVICE_IDENTIFIER`: canonical service key, used for both the R2 root and the default JWT audience
- `JWKS_URL`: issuer JWKS endpoint
- `UPSTREAM_ORIGIN`: proxy target for allowed requests
- optional `JWT_ISSUER`: expected `iss` value
- optional `SCOPE_RESOLUTION`: ordered scope resolver chain

### Embedded Mode

Embedded mode takes a structured `runtime` argument, not env vars:

- `policyBucket`
- `serviceIdentifier`
- `jwksUrl`
- optional `jwtIssuer`
- optional `scopeResolution`

That keeps the embedded library API typed and avoids JSON env blobs except where proxy mode needs them.

## Local Development

Commands from [package.json](/src/authz-worker/package.json):

- `npm run dev`
- `npm run test:integration`
- `npm run deploy:dry-run`
- `npx tsc --noEmit`

The integration harness in [scripts/test-worker.mjs](/src/authz-worker/scripts/test-worker.mjs) covers:

- scope resolution from header, JSON body, text body, and path
- compact `azs` scope claims
- fixed-resource authorization
- named and inline path grants
- built-in and custom path permissions
- scope update staleness and explicit invalidation through the test-only admin surface
- proxy mode and embedded mode

## Package Layout

- [src/lib.ts](/src/authz-worker/src/lib.ts): core runtime
- [src/index.ts](/src/authz-worker/src/index.ts): proxy entrypoint
- [src/embedded-example.ts](/src/authz-worker/src/embedded-example.ts): embedded example
- [scripts/test-worker.mjs](/src/authz-worker/scripts/test-worker.mjs): integration harness
- [COOKBOOK.md](/src/authz-worker/COOKBOOK.md): concrete policy and claim examples
- [USER_GUIDE.md](/src/authz-worker/USER_GUIDE.md): local usage guide
- [INTERNAL_INTEGRATION_GUIDE.md](/src/authz-worker/INTERNAL_INTEGRATION_GUIDE.md): embedded/library integration
- [EXTERNAL_INTEGRATION_GUIDE.md](/src/authz-worker/EXTERNAL_INTEGRATION_GUIDE.md): proxy/front-door integration
- [UPDATED_IMPLEMENTATION_PLAN.md](/src/authz-worker/UPDATED_IMPLEMENTATION_PLAN.md): current plan/state

## Current Limits

This is still a prototype:

- auth descriptor generation from OpenAPI is still external to this package
- publishing/updating R2 artifacts is still external to the main authz worker
- the public runtime surface assumes JWKS-backed verification
- path grants are normalized at request time; there is no separate shared entitlement store yet
- the principal/entity model is opinionated around `Scope`, `Principal`, and `PathObject`

## Verification

Latest local verification:

- `npx tsc --noEmit`
- `npm run test:integration`
- `npm run deploy:dry-run`
