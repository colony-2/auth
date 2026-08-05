# `c2a` CLI Proposal

## Summary

Build a Go CLI named `c2a` using Cobra as the main operator and developer interface for the authz system.

The CLI should make the current model easy to work with:

- service-global config
- scope-local config
- compact JWT scope claims
- OpenAPI-derived auth descriptors
- opinionated permission profiles
- role templates, groups, and bindings
- path spaces
- Cedar policy snippets and overlays
- local and remote evaluation workflows

The top priorities are:

1. generate and edit service-global config
2. generate and edit scope-local config
3. import OpenAPI into service-global config
4. mint and validate JWTs
5. adjust policies and snippet includes
6. evaluate a JWT and request against a set of policies

Assumption:

- “importing openai into global config” is intended to mean importing `OpenAPI`

## Goals

- Provide one low-friction tool for operators and developers.
- Minimize boilerplate for the common path.
- Keep the file model aligned with the runtime model.
- Reuse official Cedar implementations instead of creating a custom evaluator.
- Make local workflows easy before introducing remote publish workflows.

## Non-Goals

- Reimplementing Cedar from scratch in Go.
- Becoming a full policy IDE.
- Managing every possible identity provider in v1.

## Design Principles

### File-First

The CLI should work primarily against local files, then optionally publish those files.

That means:

- easy diffs
- easy code review
- easy CI usage
- no mandatory control plane dependency

### Runtime Parity

The local evaluation path should match the Worker runtime as closely as possible.

That means:

- same compact claim parsing
- same scope resolution model
- same OpenAPI/auth descriptor model
- same Cedar assembly semantics

### Minimal Boilerplate

The common workflow should be:

1. `c2a init`
2. `c2a service openapi import openapi.yaml`
3. `c2a scope init scope_alpha`
4. `c2a jwt mint ...`
5. `c2a eval ...`

without requiring users to hand-build many files from scratch.

## Recommended Workspace Layout

```text
.c2a/
  workspace.yaml
  service.json
  scopes/
    scope_alpha.yaml
    scope_beta.yaml
  jwt/
    alice.yaml
    bob.yaml
  requests/
    read_project.yaml
    read_dataset.yaml
```

### `workspace.yaml`

This should hold the small amount of shared local metadata:

- service name
- issuer/audience defaults
- local publish endpoint
- local bucket or worker target metadata
- default signing algorithm

Example:

```yaml
serviceName: projects-api
jwt:
  issuer: https://auth.example.test/
  audience: projects-api
  algorithm: RS256
paths:
  serviceConfig: .c2a/service.json
  scopesDir: .c2a/scopes
  jwtDir: .c2a/jwt
  requestsDir: .c2a/requests
remote:
  baseUrl: http://127.0.0.1:8787
```

## Artifact Model

### Service-Global Config

`c2a` should manage:

- raw OpenAPI
- compiled auth descriptor
- permission profiles
- action catalog
- global policy
- snippets
- role templates
- path permission catalog
- named paths
- optional global groups

### Scope-Local Config

`c2a` should manage:

- `scopeId`
- `claimId`
- `scopeType`
- `parentScopeId`
- groups
- bindings
- `includes`
- `policy`
- `namedPaths`

### JWT Inputs

`c2a` should treat JWT generation as structured input, not raw token hacking.

It should let the user declare:

- `sub`
- `azv`
- `azs`
- `suspended`
- expiry/issuer/audience data

## Command Structure

Recommended top-level command tree:

```text
c2a
  init
  service
  scope
  jwt
  eval
  publish
  cache
```

## `c2a init`

Initialize a minimal workspace.

Example:

```bash
c2a init --service projects-api
```

Expected result:

- create `.c2a/workspace.yaml`
- create starter `.c2a/service.json`
- create `.c2a/scopes/`
- create `.c2a/jwt/`
- create `.c2a/requests/`

## `c2a service`

Manage service-global config.

Recommended commands:

```text
c2a service init
c2a service edit
c2a service show
c2a service validate
c2a service openapi import
c2a service openapi compile
c2a service role add
c2a service role edit
c2a service group add
c2a service snippet add
c2a service snippet edit
c2a service path-permission add
```

### Minimal examples

Create starter config:

```bash
c2a service init
```

Open the config in `$EDITOR`:

```bash
c2a service edit
```

Import OpenAPI and update the service config:

```bash
c2a service openapi import ./openapi.yaml
```

This should:

- store the raw OpenAPI document in `service.json`
- derive or update the compiled auth descriptor
- derive default action-to-permission mappings
- keep user-managed policy and catalogs intact

Optional explicit compile step:

```bash
c2a service openapi compile
```

Validate service config:

```bash
c2a service validate
```

That should validate:

- JSON/YAML structure
- auth descriptor route patterns
- permission-profile shape
- action catalog shape
- role template shape
- snippet references
- named path namespace shape
- path permission catalog shape

## `c2a scope`

Manage scope-local config.

Recommended commands:

```text
c2a scope init <scope-id>
c2a scope edit <scope-id>
c2a scope show <scope-id>
c2a scope validate <scope-id>
c2a scope group add <scope-id> <group-id>
c2a scope binding add <scope-id>
c2a scope include add <scope-id> <snippet-id>
c2a scope include rm <scope-id> <snippet-id>
c2a scope policy append <scope-id> --file rule.cedar
```

### Minimal examples

Create a new scope:

```bash
c2a scope init scope_alpha --claim-id sa --type project
```

Open it in `$EDITOR`:

```bash
c2a scope edit scope_alpha
```

Add a snippet include:

```bash
c2a scope include add scope_alpha path.scope_grants
```

Append Cedar policy text:

```bash
c2a scope policy append scope_alpha --file ./rules/manage_board.cedar
```

Validate the scope overlay against the current service config:

```bash
c2a scope validate scope_alpha
```

## `c2a jwt`

Manage compact JWT generation and validation.

Recommended commands:

```text
c2a jwt init <name>
c2a jwt edit <name>
c2a jwt mint <name>
c2a jwt validate --token <jwt>
c2a jwt inspect --token <jwt>
```

### JWT template shape

Example local JWT spec:

```yaml
sub: user_alice
azv: 1
azs:
  - sa|r2|Pr:shared_docs|Pr:datasets:customer_raw|pw:home/alice/drafts/
suspended: false
exp: 15m
```

### Minimal examples

Create a template:

```bash
c2a jwt init alice
```

Mint a token:

```bash
c2a jwt mint alice
```

Validate a token:

```bash
c2a jwt validate --token "$TOKEN"
```

Inspect decoded claims and parsed scope grants:

```bash
c2a jwt inspect --token "$TOKEN"
```

`inspect` should show:

- raw claims
- parsed `azs` entries
- role IDs
- path grants
- namespaces

## `c2a eval`

Evaluate a JWT and request against local policy/config.

Recommended commands:

```text
c2a eval request --token <jwt> --method GET --path /projects/p1 --scope-id scope_alpha
c2a eval fixture <request-name> --token <jwt>
```

### Request fixture shape

```yaml
method: GET
path: /datasets/customers/acme/raw/report.csv
headers:
  x-scope-id: scope_alpha
body: ""
```

### Minimal examples

Direct request eval:

```bash
c2a eval request \
  --token "$TOKEN" \
  --method GET \
  --path /projects/project_1 \
  --header x-scope-id=scope_alpha
```

Fixture eval:

```bash
c2a eval fixture read_dataset --token "$TOKEN"
```

Expected output should include:

- matched operation
- derived permission profile and permission ID
- resolved scope
- expanded roles
- expanded groups
- expanded named/inline path grants
- resolved path space
- namespace-aware path match info
- decision
- reasons

`c2a eval` should run locally in-process using `cedar-go`, not by shelling out to Node.

## `c2a publish`

Publish local artifacts to the authz worker.

Recommended commands:

```text
c2a publish service
c2a publish scope <scope-id>
```

These should call the existing control routes:

- `POST /internal/service-config/publish`
- `POST /internal/scope-config/publish`

Minimal examples:

```bash
c2a publish service
c2a publish scope scope_alpha
```

## `c2a cache`

Invalidate remote caches when needed.

Recommended commands:

```text
c2a cache invalidate service
c2a cache invalidate scope <scope-id>
```

## Editing Experience

To minimize boilerplate, `c2a` should support two edit styles:

### 1. Full-File Edit

Open a file in `$EDITOR`.

Best for:

- policy edits
- named path changes
- descriptor review

### 2. Focused Mutation Commands

Small commands for common operations.

Best for:

- adding snippet includes
- adding path permissions
- setting scope type
- importing OpenAPI

This keeps users from hand-editing large JSON blobs for simple changes.

## OpenAPI Integration

This is one of the top priorities and should be first-class.

`c2a service openapi import` should:

1. read an OpenAPI file
2. store it in the service config
3. derive or update the compiled auth descriptor
4. derive default action-to-permission mappings
5. preserve user-managed policy, snippets, roles, groups, and catalogs

The descriptor generation should focus on:

- method + path matching
- `operationId`
- action ID mapping
- permission profile mapping
- permission ID mapping
- resource type mapping
- resource ID extraction
- path namespace extraction when needed
- path-space anchor extraction when needed

In v1, this should be deterministic and convention-driven, not LLM-driven.

## Local Evaluation Strategy

This is the key architecture decision.

### Recommendation

Use `github.com/cedar-policy/cedar-go` for local Cedar parsing and authorization evaluation.

Instead:

- keep the CLI in Go
- use `cedar-go` for `c2a eval`
- keep a parity test harness against the Worker runtime so the CLI and Worker stay aligned

Why:

- `cedar-go` is an official Cedar implementation
- it includes the core authorizer and JSON support
- it keeps the CLI self-contained and removes the Node dependency from local workflows
- the remaining drift risk is mainly around our own authz framework normalization, not Cedar itself

So the proposed split is:

- Go owns UX, files, commands, parsing, validation, local authorization evaluation, and remote publish
- the existing Worker runtime remains the deployment target and parity reference

This is the lowest-friction path, provided it is backed by parity tests.

### Parity Rule

Because the deployed Worker uses `cedar-wasm` and the CLI would use `cedar-go`, `c2a` should ship with golden parity tests that run the same request fixtures against:

1. local `cedar-go` evaluation
2. the existing Worker runtime

That parity suite should cover:

- compact `azs` claim parsing
- scope resolution
- named and inline path grants
- namespaced path systems
- policy snippet expansion
- fixed-resource authorization
- deny and error cases

This keeps the semantics honest even though the language runtime differs.

## Recommended Go Package Layout

```text
cmd/c2a/
  main.go
  root.go
  service.go
  scope.go
  jwt.go
  eval.go
  publish.go
  cache.go

internal/workspace/
internal/config/
internal/openapi/
internal/jwt/
internal/editor/
internal/httpclient/
internal/eval/
internal/parity/
```

## Recommended Dependencies

- `github.com/spf13/cobra`
- `gopkg.in/yaml.v3`
- `github.com/getkin/kin-openapi/openapi3`
- `github.com/cedar-policy/cedar-go`
- `github.com/golang-jwt/jwt/v5` or `github.com/lestrrat-go/jwx/v2`

Optional:

- `github.com/adrg/xdg` for config path handling
- `github.com/charmbracelet/glamour` or similar only if rich output is actually useful

## Output Modes

Support:

- human-readable default output
- `--json` for scripts and CI

This is especially important for:

- `jwt inspect`
- `service validate`
- `scope validate`
- `eval`

## Phased Delivery

### Phase 1

Ship:

- `init`
- `service init/edit/show/validate/openapi import`
- `scope init/edit/show/validate/include add`
- `jwt init/mint/validate/inspect`
- `eval request`
- `eval fixture`
- `publish service`
- `publish scope`
- `cache invalidate`

### Phase 2

Ship:

- parity test harness against the existing Worker runtime
- richer evaluation explanations
- stronger Cedar/schema validation where supported by `cedar-go`

### Phase 3

Ship:

- richer focused mutations
- better diffs and explanations
- bulk import/export helpers

## Why This Proposal

This design keeps the CLI pragmatic:

- Go + Cobra for the user-facing tool
- file-first for easy review and CI
- minimal boilerplate for common tasks
- OpenAPI import as a first-class command
- native local evaluation via `cedar-go`
- parity checks against the deployed Worker semantics

That is the fastest path to a useful operator/developer CLI without creating a second inconsistent auth system.
