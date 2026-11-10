# Authz Domain Model

## Goal

Make the authz framework more opinionated so different PaaS, IaaS, and SaaS systems can adopt the same shapes instead of inventing their own.

The framework should standardize:

- permission profiles
- action-to-permission mapping
- roles
- groups
- bindings
- scopes
- path spaces
- compact JWT claim structure

## Core Primitives

### Scope

`Scope` is the only container primitive.

A scope has:

- `scope_id`
- `scope_type`
- optional `parent_scope_id`

Examples:

- `project`
- `workspace`
- `organization`
- `account`

`organization` is not a separate framework concept. It is just a `scope_type`.

### Subject

`Subject` is an actor that can receive permissions.

Supported subject kinds:

- `User`
- `ServiceAccount`
- `Group`

### Principal

`Principal` is the authenticated request identity after JWT normalization.

The runtime should treat the principal as a flattened, request-ready view of the subject's effective entitlements for one current scope.

### Resource

`Resource` is any non-path object being authorized.

Examples:

- `Project`
- `Issue`
- `Board`
- `Cluster`
- `Bucket`

Every resource belongs to exactly one owning scope.

### PathSpace

`PathSpace` is the framework primitive for hierarchical paths.

A path space has:

- `namespace`
- `anchor_kind`
- optional anchor metadata

Supported anchor kinds:

- `service`
- `resource`

Examples:

- service-rooted files: `/files/{path+}`
- resource-rooted files: `/projects/{projectId}/files/{path+}`
- service-rooted datasets: `/datasets/{path+}`

### PathObject

`PathObject` is a concrete path inside a `PathSpace`.

It should carry:

- `path`
- `path_namespace`
- `path_kind`
- normalized ancestor prefixes
- optional path-space anchor metadata

## Permission Profiles

The framework should not make every adopter invent its own permission language.

It should ship with built-in permission profiles.

### Object Profile

Use for fixed resources such as projects, boards, issues, clusters, secrets, or queues.

Canonical permissions:

- `l` list
- `r` read
- `c` create
- `u` update
- `d` delete
- `a` administer
- `x` execute

### Path Profile

Use for filesystem-like or tree-like resources.

Canonical permissions:

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

### Custom Permissions

Custom permissions should be allowed, but they should be the exception.

Good rule:

- use built-in profile permissions by default
- introduce custom IDs only when product semantics genuinely do not fit

## Action Mapping

OpenAPI should remain the source contract for HTTP operations, but the framework should compile each operation into a canonical action record with an implied permission shape.

Each compiled action should define:

- `action_id`
- `permission_profile`
- `permission_id`
- `target_kind`
- resource extraction rules
- optional path-space extraction rules

Recommended target kinds:

- `scope`
- `resource`
- `path`

Examples:

- `GET /projects/{projectId}` -> `action_id=readProject`, `profile=object`, `permission=r`, `target=resource`
- `POST /projects` -> `action_id=createProject`, `profile=object`, `permission=c`, `target=resource`
- `GET /projects/{projectId}/files/{path+}` -> `action_id=readProjectFile`, `profile=path`, `permission=r`, `target=path`
- `GET /datasets/{path+}` -> `action_id=readDatasetPath`, `profile=path`, `permission=r`, `target=path`

Default HTTP mapping should be opinionated:

- collection `GET` -> `l`
- item `GET` -> `r`
- collection `POST` -> `c`
- `PUT` / `PATCH` -> `u`
- `DELETE` -> `d`
- custom action `POST` -> `x`

Explicit overrides should still be allowed.

## Roles

`Role` is a named bundle of permissions.

Roles should be first-class and usually global to a service.

Recommended role shape:

- `role_id`
- `name`
- `grants`

Grant targets may be:

- whole scope
- resource type
- action family
- path space

Examples:

- `viewer`
- `editor`
- `scope-admin`
- `dataset-operator`

The framework should strongly prefer:

- global role templates
- optional scope-local extension only when necessary

## Groups

`Group` is a reusable subject collection.

Groups should be first-class because many systems grant by team, not just by individual user.

Recommended group shape:

- `group_id`
- `name`
- `scope_id`
- optional `parent_group_ids`
- `members`

Rules:

- group nesting is allowed
- nesting must be acyclic
- nesting depth should be bounded
- groups should usually be scope-local
- global groups should be explicit, not implicit

## Bindings

`Binding` is the actual authorization edge.

It assigns a role or permission to a subject within a scope.

Recommended binding shape:

- `binding_id`
- `scope_id`
- `subject_kind`
- `subject_id`
- either `role_id` or direct permission grant
- optional target constraint

Target constraints may be:

- full scope
- resource type
- path space
- named path
- inline path prefix

Examples:

- user `u1` has role `viewer` in scope `project_alpha`
- group `g_ops` has role `dataset-operator` in scope `workspace_data`
- user `u2` has permission `r` on named path `vendor_docs` in scope `project_alpha`

## Flattening Rule

The runtime should not walk rich group graphs on the hot path.

The system should separate:

- management model
- runtime model

The management model may contain:

- groups
- nested groups
- bindings
- role templates

The runtime JWT should normally contain only flattened effective grants for the current scope.

That means:

- group expansion should happen before JWT minting
- nested-group closure should happen before JWT minting
- path grants should already be effective grants by the time the Worker evaluates the request

Optional group IDs may still be included in the JWT for explainability, but authorization should not depend on runtime group traversal.

## Compact JWT Model

The compact claim should stay per-scope.

Recommended top-level shape:

```json
{
  "sub": "user_alice",
  "azv": 1,
  "azs": [
    "sa|r2|g7|Pr:project_docs|pw:home/alice/drafts/|Pr:datasets:customer_raw"
  ]
}
```

Recommended token grammar inside one scope string:

- first token: scope claim ref
- `r<id>`: effective role ID
- `g<id>`: effective group ID for explanation and audit
- `P<perm>:<name>`: named path grant
- `p<perm>:<prefix>`: inline path grant
- `P<perm>:<namespace>:<name>`: namespaced named path grant
- `p<perm>:<namespace>:<prefix>`: namespaced inline path grant

Important rule:

- roles and groups are compact references
- arbitrary path prefixes may be inline when needed
- named paths should be preferred for reusable grants

## Resource And Path Interaction

Resources and paths should not be treated as competing models.

They interact through `PathSpace`.

### Service-Rooted Path Space

Example route:

```text
/files/{path+}
```

Interpretation:

- no anchor resource
- namespace defaults to `default`
- everything after `/files/` is the current path expression

### Resource-Rooted Path Space

Example route:

```text
/projects/{projectId}/files/{path+}
```

Interpretation:

- primary anchor resource is `Project(projectId)`
- path space is namespace `files`
- everything below the anchor URL is the current path expression

This is the pattern the framework should formalize:

- "everything below this resource URL is a path expression"

That lets policy reason about both:

- the owning resource or scope
- the specific path grant inside that resource's path space

## Proxy Mode Path Evaluation

In proxy mode, namespaced path evaluation should not guess the current path.

It should come from the compiled auth descriptor.

For a path-aware operation, the compiled descriptor should define:

- the action
- the owning scope or resource
- the path space namespace
- the path extractor
- whether the path space is service-rooted or resource-rooted

Examples:

- `/files/{path+}` -> namespace `default`, service-rooted
- `/datasets/{path+}` -> namespace `datasets`, service-rooted
- `/projects/{projectId}/files/{path+}` -> namespace `files`, resource-rooted on `Project(projectId)`

So the hot-path logic becomes:

1. match the request to the compiled descriptor
2. resolve the current scope
3. resolve the current resource if any
4. resolve the current path space and current path
5. match grants by namespace and prefix
6. evaluate Cedar with normalized facts

## Config Ownership

### Service-Global Config

Service-global config should own:

- Cedar schema
- raw OpenAPI
- compiled auth descriptor
- permission profiles
- action catalog
- role templates
- reusable snippets
- global named paths
- optional global groups

### Scope-Local Config

Scope-local config should own:

- scope identity metadata
- scope-local named paths
- optional scope-local groups
- optional scope-local bindings
- snippet includes
- scope policy overlay

## Guardrails

The framework should be opinionated in these ways:

- built-in permission profiles should cover the common cases
- OpenAPI compilation should assign default permissions automatically
- custom permissions should be rare and explicit
- role templates should be preferred over direct grants
- groups should be first-class, but flattened before runtime
- path spaces should be explicit in the compiled auth descriptor
- the Worker should never do deep entitlement graph traversal on the hot path

## Summary

The recommended framework shape is:

- one container primitive: `Scope`
- one subject model: `User`, `ServiceAccount`, `Group`
- one binding model for assigning roles or permissions
- built-in `object` and `path` permission profiles
- one compact per-scope JWT pattern
- one first-class `PathSpace` model for path authorization

That is opinionated enough to be adoptable across many systems without collapsing into a custom IAM product for every deployment.
