# Updated Implementation Plan

## Goal

Ship the worker on a cleaner authorization model:

- `Scope` instead of separate `tenant` and `organization` runtime concepts
- compact per-scope JWT claims
- first-class path and path-prefix permissions
- optional path namespaces with implicit `default`
- opinionated permission profiles, roles, groups, and bindings
- explicit `PathSpace` modeling for service-rooted and resource-rooted path systems
- service-global config plus scope-local policy overlays

## Implemented

### 1. Scope Model

The runtime now uses:

- `scopeId`
- `scopeType`
- optional `parentScopeId`

`organization` is treated as a valid `scopeType`, not a special built-in object.

### 2. Declarative Scope Resolution

The worker now uses `SCOPE_RESOLUTION`, not `TENANT_RESOLUTION`.

Supported resolvers:

- path regex
- header regex
- JSON body pointer
- text body regex

### 3. Service + Scope Artifact Split

R2 is now split into:

- service-global config
- scope-local config

Service-global config owns:

- auth descriptor
- permission profiles
- action catalog
- global policy
- snippets
- role templates
- path permission catalog
- global named paths

Scope-local config owns:

- scope identity metadata
- scope-local named paths
- optional scope-local groups
- optional scope-local bindings
- snippet includes
- scope-local policy overlay

### 4. Compact Scope Claims

The runtime now parses compact `azs` claim strings.

Current grammar:

- first token is the scope claim ref
- `r<id>` for role IDs
- `g<id>` for effective group IDs used for audit/explanation
- `P<perm>:<name>` for named path grants
- `p<perm>:<prefix>` for inline path grants
- `P<perm>:<namespace>:<name>` for namespaced named path grants
- `p<perm>:<namespace>:<prefix>` for namespaced inline path grants

### 5. Path Authorization

`PathObject` and `PathSpace` are now built-in models.

For path-aware operations, the runtime:

1. canonicalizes the incoming path
2. expands named and inline path grants
3. resolves `PathSpace` metadata from the compiled auth descriptor
4. matches namespace and prefix outside Cedar
5. compares matching grants against the resolved permission ID
6. injects normalized path facts into the Cedar principal/resource model

Built-in common path permission IDs are supported:

- `l`, `t`, `i`, `r`, `w`, `c`, `d`, `m`, `x`, `a`

Custom path permission IDs are supported through the service `pathPermissionCatalog`.

Path grants also support:

- default namespace when omitted
- explicit namespace when multiple path systems exist

`PathSpace` now supports:

- service-rooted path systems
- resource-rooted path systems
- explicit anchor metadata in authorization output

### 6. Permission Profiles And Action Catalog

The runtime now supports:

- built-in `object` and `path` permission profiles
- explicit `actionCatalog` entries in service config
- per-operation `permissionProfile`, `permissionId`, and `targetKind`
- default permission inference when those values are omitted

### 7. Roles, Groups, And Bindings

The runtime/config surface now supports:

- `roleTemplates` in service-global config
- global and scope-local `groups`
- scope-local `bindings`
- `g<id>` group references in compact claims

Group graphs are validated for cycles at publish time. Bindings are validated against known role templates.

### 8. Proxy and Embedded Modes

Both runtime modes continue to work after the model refactor.

### 9. Integration Tests

The test harness now verifies:

- scope resolution from header, JSON body, text body, and path
- compact scope claims
- group IDs in compact claims
- fixed-resource authorization
- named path grants
- inline path grants
- built-in path permissions
- custom path permissions
- resource-rooted path spaces
- scope update staleness and invalidation
- proxy mode and embedded mode

## Current Runtime Layout

```text
authz/
  {serviceIdentifier}/service/manifest.json
  {serviceIdentifier}/service/{version}/config.json
  {serviceIdentifier}/scopes/{scopeId}/manifest.json
  {serviceIdentifier}/scopes/{scopeId}/{version}/config.yaml
```

## Remaining Work

The main next steps are:

1. Add a build/publish tool that manages R2 artifacts without relying on the test-only admin surface.
2. Add a build/publish tool that compiles OpenAPI into the auth descriptor automatically.
3. Tighten the compiler rules for default HTTP method to permission inference.
4. Decide whether scope claim refs should always be configured explicitly or can default from `scopeId`.
5. Decide whether path grant lists should eventually support external references in addition to named and inline forms.
6. Tighten the schema around catalogs and action naming conventions.

## Why This Model

This version is simpler without being reductionist:

- one container primitive: `Scope`
- one compact claim pattern: `azs`
- one opinionated permission model
- one formal role/group/binding model
- one built-in answer for filesystem-like authorization
- one explicit `PathSpace` model for hierarchical routes
- one config split: service-global plus scope-local
