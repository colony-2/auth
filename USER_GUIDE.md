# Authz Worker User Guide

This guide explains how to run the worker locally, seed service and scope config for dev/test, mint compact JWTs, and call protected APIs.

## Quick Start

From the repository root:

```bash
cd /path/to/c2a
npm install
npm run test:integration
```

That integration run is the fastest proof that the current package works. It starts a local upstream, publishes config, signs JWTs, and exercises both proxy and embedded modes.

If you want to drive the worker manually, follow the rest of this guide.

## Local Defaults

[wrangler.jsonc](wrangler.jsonc) defines:

- `SERVICE_IDENTIFIER=projects-api`
- `JWKS_URL=https://issuer.example.com/.well-known/jwks.json`
- optional `JWT_ISSUER=https://issuer.example.com/`
- `UPSTREAM_ORIGIN=http://127.0.0.1:9000`

It also defines `SCOPE_RESOLUTION` with four ordered resolvers:

1. `x-scope-id`
2. JSON body `/scopeId`
3. text/form regex
4. `/scope-path/{scopeId}/...`

## Mental Model

For every protected request, the worker answers:

- may this principal perform this action on this resource in this scope?

The model is:

- scope comes from the configured scope resolution chain
- action and resource come from the service auth descriptor
- policy comes from service-global config plus scope-local config
- path permissions come from compact scope claims plus named/inline prefixes
- multiple path systems are handled by optional path namespaces with implicit `default`

Important:

- the authz worker itself is read-only
- publish and invalidation are out-of-band concerns
- the package does not yet ship a production publisher
- local end-to-end seeding is handled today by the integration harness or a separate admin tool

## Step 1: Start a Local Upstream

Proxy mode forwards allowed requests to `UPSTREAM_ORIGIN`. For the default config, start a small upstream on port `9000`.

```bash
node --input-type=module <<'EOF'
import http from 'node:http';

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  req.on('end', () => {
    const bodyText = Buffer.concat(chunks).toString('utf8');
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      ok: true,
      upstream: true,
      method: req.method,
      path: req.url,
      authz: {
        scopeId: req.headers['x-authz-scope-id'] ?? '',
        scopeType: req.headers['x-authz-scope-type'] ?? '',
        principalId: req.headers['x-authz-principal-id'] ?? '',
        action: req.headers['x-authz-action'] ?? '',
        operationId: req.headers['x-authz-operation-id'] ?? '',
        serviceVersion: req.headers['x-authz-service-version'] ?? '',
        scopeVersion: req.headers['x-authz-scope-version'] ?? ''
      },
      bodyText
    }));
  });
}).listen(9000, '127.0.0.1', () => {
  console.log('upstream listening on http://127.0.0.1:9000');
});
EOF
```

## Step 2: Start the Worker

```bash
cd /path/to/c2a
npm run dev
```

For real requests to succeed, `JWKS_URL` must point at a reachable issuer JWKS endpoint. The checked-in `wrangler.jsonc` value is only a placeholder; the integration harness overrides it with a temporary local JWKS server.

## Step 3: Prepare Service Config

The service config owns:

- compiled auth descriptor
- global policy
- snippets
- permission profiles
- action catalog
- role templates
- path permission catalog
- global named paths

The authz worker does not accept write requests. Instead, write this JSON to the R2 location derived from `SERVICE_IDENTIFIER`:

```text
authz/{SERVICE_IDENTIFIER}/service/{version}/config.json
authz/{SERVICE_IDENTIFIER}/service/manifest.json
```

Example config payload:

```json
{
  "version": "svc_v2",
  "schemaVersion": "1",
  "authDescriptor": {
    "version": "descriptor_v2",
    "operations": [
      {
        "operationId": "readProjectFromHeader",
        "method": "GET",
        "pathPattern": "^/projects/(?<projectId>[^/]+)$",
        "actionId": "readProject",
        "permissionProfile": "object",
        "permissionId": "r",
        "targetKind": "resource",
        "resourceType": "Project",
        "resourceId": {
          "source": "path_group",
          "name": "projectId"
        }
      },
      {
        "operationId": "readPathFromHeader",
        "method": "GET",
        "pathPattern": "^/files/(?<storagePath>.+)$",
        "actionId": "readPath",
        "permissionProfile": "path",
        "permissionId": "r",
        "targetKind": "path",
        "resourceType": "PathObject",
        "resourceId": {
          "source": "path_group",
          "name": "storagePath"
        },
        "pathSpace": {
          "anchorKind": "service",
          "path": {
            "source": "path_group",
            "name": "storagePath"
          }
        }
      },
      {
        "operationId": "readDatasetPathFromHeader",
        "method": "GET",
        "pathPattern": "^/datasets/(?<storagePath>.+)$",
        "actionId": "readPath",
        "permissionProfile": "path",
        "permissionId": "r",
        "targetKind": "path",
        "resourceType": "PathObject",
        "resourceId": {
          "source": "path_group",
          "name": "storagePath"
        },
        "pathSpace": {
          "anchorKind": "service",
          "path": {
            "source": "path_group",
            "name": "storagePath"
          },
          "namespace": {
            "source": "literal",
            "value": "datasets"
          }
        }
      }
    ]
  },
  "globalPolicy": "forbid(principal, action, resource) when { principal.suspended == true };",
  "actionCatalog": {
    "readProject": {
      "permissionProfile": "object",
      "permissionId": "r",
      "targetKind": "resource"
    },
    "readPath": {
      "permissionProfile": "path",
      "permissionId": "r",
      "targetKind": "path"
    }
  },
  "snippets": {
    "scope.member_read_project": "permit(principal, action == Action::\"readProject\", resource is Project) when { resource.scope_id == principal.current_scope_id && (principal.current_scope_role == \"member\" || principal.current_scope_role == \"scope-admin\") };",
    "path.scope_grants": "permit(principal, action, resource) when { resource.scope_id == principal.current_scope_id && principal.action_target_kind == \"path\" && principal.path_action_allowed == true };"
  },
  "roleTemplates": {
    "1": { "name": "viewer" },
    "2": { "name": "member" },
    "3": { "name": "scope-admin" }
  },
  "pathPermissionCatalog": {
    "42": {
      "name": "archive_documents",
      "actions": ["archivePath"]
    }
  },
  "namedPaths": {
    "shared_docs": "shared/docs/",
    "archive_area": "shared/archive/",
    "datasets": {
      "customer_raw": "customers/acme/raw/"
    }
  },
  "groups": {
    "7": { "name": "ops-team" }
  }
}
```

The manifest should point at the active version:

```json
{
  "service": "projects-api",
  "scopeType": "service",
  "scopeId": "projects-api",
  "activeVersion": "svc_v2",
  "generatedAt": "2026-04-09T00:00:00.000Z"
}
```

## Step 4: Prepare Scope Config

Scope config selects snippets and adds scope-local policy.

Write each scope config to:

```text
authz/{SERVICE_IDENTIFIER}/scopes/{scopeId}/{version}/config.yaml
authz/{SERVICE_IDENTIFIER}/scopes/{scopeId}/manifest.json
```

Example config:

```yaml
scopeId: scope_alpha
claimId: sa
version: v1
scopeType: project
parentScopeId: scope_root
includes:
  - scope.member_read_project
  - path.scope_grants
namedPaths:
  workspace_docs: shared/workspace-alpha/
  analytics:
    workspace_raw: workspaces/alpha/raw/
groups:
  "9":
    name: alpha-admins
bindings:
  - subjectKind: Group
    subjectId: "9"
    roleId: "3"
```

## Step 5: Mint a Compact JWT

The runtime expects a JWT that can be verified via `JWKS_URL`. The important part for authz is the payload shape.

Example payload:

```javascript
{
  sub: "user_alice",
  azv: 1,
  azs: [
    "sa|r2|g7|Pr:shared_docs|Pr:workspace_docs|Pr:datasets:customer_raw|pw:home/alice/drafts/|P42:archive_area"
  ],
  suspended: false
}
```

The token should normally be minted by your existing identity system or by separate tooling. The package integration test uses a local RSA keypair and serves the public key through a temporary JWKS endpoint.

### Compact Claim Format

Each `azs` string is one scope claim.

Example:

```text
sa|r2|g7|Pr:shared_docs|pw:home/alice/drafts/|P42:archive_area
```

Meaning:

- `sa`: scope claim reference
- `r2`: role ID `2`
- `g7`: effective group ID `7`
- `Pr:shared_docs`: built-in read permission on named path `shared_docs`
- `pw:home/alice/drafts/`: built-in write permission on inline prefix
- `P42:archive_area`: custom permission `42` on named path `archive_area`
- `Pr:datasets:customer_raw`: built-in read permission on named path `customer_raw` in namespace `datasets`

If the namespace is omitted, the worker uses the implicit `default` namespace.

## Step 6: Call Protected APIs

### Header-Based Scope Resolution

```bash
curl -sS \
  http://127.0.0.1:8787/projects/project_1 \
  -H "authorization: Bearer $TOKEN" \
  -H 'x-scope-id: scope_alpha'
```

### JSON Body Scope Resolution

```bash
curl -sS \
  -X POST http://127.0.0.1:8787/project-access \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "scopeId": "scope_beta",
    "projectId": "project_2"
  }'
```

### Text Body Scope Resolution

```bash
curl -sS \
  -X POST http://127.0.0.1:8787/project-access-text \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: text/plain' \
  --data-raw 'scopeId=scope_beta projectId=project_2'
```

### Path-Based Scope Resolution

```bash
curl -sS \
  http://127.0.0.1:8787/scope-path/scope_alpha/projects/project_1 \
  -H "authorization: Bearer $TOKEN"
```

### Named Path Grant

```bash
curl -sS \
  http://127.0.0.1:8787/files/shared/docs/guide.txt \
  -H "authorization: Bearer $TOKEN" \
  -H 'x-scope-id: scope_alpha'
```

### Namespaced Path Grant

This simulates a second path system, separate from the default file namespace:

```bash
curl -sS \
  http://127.0.0.1:8787/datasets/customers/acme/raw/report.csv \
  -H "authorization: Bearer $TOKEN" \
  -H 'x-scope-id: scope_alpha'
```

The matching grant is `Pr:datasets:customer_raw`, not `Pr:shared_docs`.

### Inline Path Grant

```bash
curl -sS \
  -X PUT http://127.0.0.1:8787/files/home/alice/drafts/note.txt \
  -H "authorization: Bearer $TOKEN" \
  -H 'x-scope-id: scope_alpha' \
  --data-raw 'draft=1'
```

### Custom Path Permission

```bash
curl -sS \
  -X POST http://127.0.0.1:8787/archive-files/shared/archive/release.zip \
  -H "authorization: Bearer $TOKEN" \
  -H 'x-scope-id: scope_alpha'
```

## Multiple Path Systems

If a service has more than one hierarchical path model, use namespaces.

Examples:

- default namespace for normal file paths
- `datasets` namespace for dataset storage
- `packages` namespace for artifact trees

Use default namespace when you do not need to distinguish path systems. Add explicit namespaces only when two different path spaces would otherwise collide.

## Step 7: Understand Failures

### Missing Token

```json
{
  "error": "missing bearer token"
}
```

### Protected Route With No Scope Match

```json
{
  "error": "scope_resolution_failed",
  "message": "no scope resolver matched the protected request"
}
```

### Forbidden

```json
{
  "ok": false,
  "error": "forbidden",
  "scopeId": "scope_alpha",
  "scopeType": "project",
  "action": "readProject",
  "scopeVersion": "v1"
}
```

## Step 8: Update Scope Policy Safely

Write a new scope config version to the versioned R2 key and then update that scope's manifest to point at the new version.

The authz worker is read-only, so immediate cache invalidation must also happen through out-of-band tooling if you need it. Otherwise the new manifest becomes active when caches expire or revalidate.

## Embedded Mode

See [src/embedded-example.ts](src/embedded-example.ts).

The wrapped handler receives:

- `decision = null` for unresolved routes
- an allow decision object for protected authorized routes
- no call for deny responses, because the middleware returns `403`

## Troubleshooting

### `service_config_missing`

You tried to publish or evaluate scope config before a service config existed.

### `unknown_policy_include`

The scope `includes` list references a snippet that is not present in the active service config.

### `invalid_global_policy` or `invalid_scope_policy`

The Cedar text failed `checkParsePolicySet()`.

### `scope_resolution_failed`

The route matched a protected operation, but no scope resolver yielded a scope ID.

### `invalid bearer token`

The JWT signature, issuer, or audience did not match local config.

## Useful Commands

- `npm run dev`
- `npm run test:integration`
- `npm run deploy:dry-run`
- `npx tsc --noEmit`
