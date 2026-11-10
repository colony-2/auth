# Cloudflare Worker Authorization Gateway Proposal

Status: historical gateway design proposal. This records the original Worker runtime and domain model. See [README.md](README.md) for the implemented system and the current planning documents. This proposal does not establish production readiness.

## Executive Summary

Build the authorization gateway as a TypeScript Cloudflare Worker that:

- validates JWTs,
- resolves exactly one current `Scope` for each protected request,
- maps HTTP requests to canonical `principal + action + resource + context`,
- evaluates Cedar policy loaded from R2,
- uses edge caching plus isolate-local caching to keep policy retrieval off the hot path after warmup,
- supports both fixed resources and filesystem-like path-prefix authorization.

The recommended stack remains:

- Cloudflare Workers
- TypeScript
- Cedar
- JWT / JWKS / OIDC
- R2 for policy/config artifacts
- OpenAPI as the source for action/resource metadata

The important model change is:

- use `Scope` as the single container primitive,
- treat `organization` as a `scope_type`, not as a separate first-class runtime object,
- use compact per-scope JWT claims,
- make path-prefix permissions a built-in framework pattern,
- standardize built-in permission profiles, role templates, groups, and bindings,
- formalize `PathSpace` so service-rooted and resource-rooted path models are explicit,
- support optional path namespaces with an implicit `default` namespace.

## Goals

- Centralize API authorization in a Worker gateway.
- Keep the runtime edge-friendly and lightweight.
- Store policy/config artifacts in R2.
- Avoid deployment-specific authz code for normal request mapping.
- Support APIs with both object-style resources and path-style resources.
- Keep JWT claims compact enough for header limits.

## Non-Goals

- Building a full IAM product.
- Making the gateway the source of authentication truth.
- Doing large graph traversal on the hot path.
- Storing huge arbitrary entitlement lists directly in JWTs.

## Recommendation

Use:

- Cedar for authorization decisions
- a compiled auth descriptor derived from OpenAPI
- compact per-scope claim strings in JWTs
- service-global config plus scope-local config in R2

The opinionated target model is described in [AUTHZ_DOMAIN_MODEL.md](AUTHZ_DOMAIN_MODEL.md).

This keeps the runtime open, explicit, and small without inventing a new policy language.

## Cedar Runtime Constraints

The runtime should continue to assume the `cedar-wasm` path proven in the handoff:

- import from `@cedar-policy/cedar-wasm/web`
- import the wasm file explicitly
- call `initSync({ module })`
- preparse policy sets once per isolate
- use `statefulIsAuthorized()` on the hot path
- never parse policy source per request

## Core Domain Model

### Scope

`Scope` is the primary authorization container.

A scope has:

- `scope_id`
- `scope_type`
- optional `parent_scope_id`

Examples:

- `project`
- `workspace`
- `organization`

This keeps the framework simple:

- no separate `tenant` runtime primitive
- no separate `organization` runtime primitive
- hierarchy still works through parent scopes

### Principal

Authenticated identity from the JWT.

The runtime should normalize:

- principal ID from `sub`
- current scope role(s)
- path grants for the current scope
- security/session facts such as `suspended`

### Resource

Every resource belongs to exactly one owning scope.

Examples:

- `Project`
- `Issue`
- `Board`
- `PathObject`

Resource attrs should use:

- `scope_id`
- `scope_type`

not special `tenant_id` or `organization_id` attrs.

### PathObject

Filesystem-like resources should be first-class.

Examples:

- `shared/docs/guide.txt`
- `home/alice/drafts/note.txt`

The framework should canonicalize paths and treat prefix grants as a built-in concept.
It should also support `path_namespace` so one service can host multiple independent path systems.

### PathSpace

`PathSpace` should be a first-class framework concept.

It represents a hierarchical path namespace that is either:

- service-rooted
- resource-rooted

Examples:

- `/files/{path+}`
- `/datasets/{path+}`
- `/projects/{projectId}/files/{path+}`

This makes the following explicit:

- where the current path comes from
- which namespace it belongs to
- whether the path is anchored under a resource URL

## Permission Model

The framework should be more opinionated than a raw action catalog.

It should standardize two built-in permission profiles:

- `object`
- `path`

### Object Profile

Canonical object permissions:

- `l` list
- `r` read
- `c` create
- `u` update
- `d` delete
- `a` administer
- `x` execute

### Path Profile

Canonical path permissions:

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

Custom permission IDs should still be allowed, but only as an explicit escape hatch.

## Roles, Groups, And Bindings

The framework should formalize:

- `Role`: named bundle of permissions
- `Group`: reusable subject collection
- `Binding`: assignment of a role or permission to a subject within a scope

Recommended rules:

- roles should usually be global templates
- groups should be first-class
- group nesting may be allowed, but must be acyclic and bounded
- bindings may target a whole scope, a resource class, or a path space
- the Worker should not traverse group graphs on the hot path

The runtime JWT should normally carry flattened effective grants for the resolved scope, not raw entitlement graphs.

## Compact Claims Model

All authorization claims should be scoped.

Recommended JWT structure:

```json
{
  "sub": "user_alice",
  "azv": 1,
  "azs": [
    "sa|r2|Pr:shared_docs|Pr:workspace_docs|pw:home/alice/drafts/|P42:archive_area"
  ],
  "suspended": false
}
```

### Per-Scope Claim String

Each `azs` entry is one scope-local entitlement string.

Current grammar:

- first token: scope claim ref
- `r<id>`: role IDs
- `g<id>`: effective group IDs for audit/explanation
- `P<perm>:<name>`: named path grant
- `p<perm>:<prefix>`: inline path grant
- `P<perm>:<namespace>:<name>`: namespaced named path grant
- `p<perm>:<namespace>:<prefix>`: namespaced inline path grant

Examples:

- `sa|r2`
- `sa|r2|Pr:shared_docs`
- `sa|r2|pw:home/alice/drafts/`
- `sa|r2|P42:archive_area`
- `sa|r2|Pr:datasets:customer_raw`

This keeps claims compact while still letting the runtime authorize one resolved scope precisely.

Important rule:

- groups and nested groups should be flattened before JWT minting
- the runtime should evaluate effective grants, not discover them recursively

## Path Permissions

Path grants should be first-class concepts.

### Two Grant Types

- named path grants
- inline path grants

Named grant:

```text
P<perm>:<name>
```

Inline grant:

```text
p<perm>:<prefix>
```

Namespaced forms:

```text
P<perm>:<namespace>:<name>
p<perm>:<namespace>:<prefix>
```

### Built-In Common Filesystem Permission IDs

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

Custom permission IDs should also be allowed through config.

### Why This Model

Roles and path permissions behave differently:

- roles are compact and stable
- path prefixes may be arbitrary

So the system should support both:

- named prefixes from service/scope config
- inline canonical prefixes in the JWT when the grant set is small
- optional namespaces when more than one path system exists

If a namespace is omitted, the runtime should use `default`.

## Service and Scope Config

### Service-Global Config

Stored once per service, versioned by manifest.

It should include:

- Cedar schema
- raw OpenAPI document
- compiled auth descriptor
- permission profiles
- action catalog
- global policy
- reusable snippets
- role templates
- path permission catalog
- global named paths
- optional global groups

Named paths should support:

- a flat default-namespace map
- nested namespace maps for additional path systems

### Scope-Local Config

Stored per scope, versioned by manifest.

It should include:

- `scopeId`
- optional `claimId`
- optional `scopeType`
- optional `parentScopeId`
- optional scope-local groups
- optional scope-local bindings
- snippet includes
- scope-local policy overlay
- scope-local named paths

## Request Flow

For each protected request:

1. Match the request against the compiled auth descriptor.
2. Resolve exactly one `scopeId` from the configured scope resolution chain.
3. Verify the JWT.
4. Load the active service config and scope config.
5. Find the compact scope claim for the current scope.
6. Expand roles and path grants from catalogs and inline values.
7. Resolve path-space metadata when the operation is path-aware.
8. Normalize principal, resource, and context.
9. Assemble or reuse the effective Cedar policy state.
10. Evaluate with Cedar.
11. Allow and proxy, or deny.

## Path Authorization Flow

For `PathObject` resources:

1. Canonicalize the requested path.
2. Expand named path grants from service/scope config.
3. Merge named grants with inline path grants from the current scope claim.
4. Resolve the current `PathSpace` from the compiled descriptor.
5. Match namespace and prefix outside Cedar.
6. Map permission IDs to action IDs.
7. Inject normalized facts such as `path_action_allowed` into the principal.

This keeps Cedar focused on authorization logic, not raw string processing.

For proxy mode, the path-aware operation must define where the current path comes from. The framework should not infer this generically.

Recommended path-space pattern:

- everything below a configured resource URL segment is the current path expression

Example:

- `/projects/{projectId}/files/{path+}` means `Project(projectId)` is the anchor resource and `{path+}` is the current path in the `files` path space.

## Caching

Use layered caching:

- isolate-local LRU caches for manifests, service config, scope config, and effective policy state
- `caches.default` for raw R2 object fetches

Key point:

- publishing a new scope version updates the manifest pointer
- cached manifests may continue to point at the old version until TTL expiry or explicit invalidation

That is acceptable as long as the propagation model is explicit.

## R2 Layout

```text
authz/
  services/{service}/manifest.json
  services/{service}/{version}/config.json
  scopes/{service}/{scopeId}/manifest.json
  scopes/{service}/{scopeId}/{version}/config.yaml
```

## Why Scope Is Better Than Tenant + Organization

This proposal should be explicit here.

`Scope` is better because:

- it avoids two overlapping container concepts
- it keeps the framework small
- it still supports hierarchy
- it lets products use `organization`, `project`, `workspace`, or other container types without a special-case runtime branch

So the model is simple without being reductionist.

## Why Path Prefixes Must Be Built In

Filesystem-like authorization is common enough that it should not be left to ad hoc per-product policy design.

The framework should prescribe:

- canonical path normalization
- named prefixes
- inline prefixes
- optional namespaces with implicit defaulting
- permission-to-action mapping
- prefix matching before Cedar evaluation

Without this, every product ends up re-inventing path authorization differently.

## Current Implementation Direction

The implementation should:

- use `Scope` throughout the runtime
- use compact `azs` scope claims
- standardize built-in permission profiles
- formalize roles, groups, and bindings
- flatten entitlement graphs before JWT issuance
- support built-in and custom path permissions
- formalize `PathSpace`
- support named and inline path grants
- support default and explicit path namespaces
- keep OpenAPI-derived action/resource mapping in the auth descriptor
- keep policy/config in service-global and scope-local artifacts

## Next Steps

1. Add JWKS/OIDC verification for production identity integration.
2. Add a build/publish tool that compiles OpenAPI into the auth descriptor.
3. Decide whether scope claim refs should always be explicit or can default from `scopeId`.
4. Decide whether very large path grant sets need an external reference format in addition to named and inline forms.
5. Extend the compiled auth descriptor to represent `PathSpace` anchors explicitly.
