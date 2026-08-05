# Authz Worker Cookbook

This cookbook shows the current opinionated model:

- `Scope` is the only container concept
- compact `azs` strings carry per-scope effective grants
- `object` and `path` are the built-in permission profiles
- role templates, groups, and bindings are first-class config concepts
- path authorization can be service-rooted or resource-rooted through `PathSpace`

The examples use:

- Jira-like fixed resources: `Project`, `Issue`, `Board`
- filesystem-like resources: `PathObject`
- a second path system under a `datasets` namespace
- a resource-rooted path space under `/projects/{projectId}/files/{path+}`

## 1. Example Service-Global Config

```json
{
  "version": "svc_v4",
  "globalPolicy": "forbid(principal, action, resource) when { principal.suspended == true };",
  "permissionProfiles": {
    "object": {
      "name": "object",
      "permissions": ["l", "r", "c", "u", "d", "a", "x"]
    },
    "path": {
      "name": "path",
      "permissions": ["l", "t", "i", "r", "w", "c", "d", "m", "x", "a"]
    }
  },
  "actionCatalog": {
    "readProject": {
      "permissionProfile": "object",
      "permissionId": "r",
      "targetKind": "resource"
    },
    "readIssue": {
      "permissionProfile": "object",
      "permissionId": "r",
      "targetKind": "resource"
    },
    "readPath": {
      "permissionProfile": "path",
      "permissionId": "r",
      "targetKind": "path"
    },
    "writePath": {
      "permissionProfile": "path",
      "permissionId": "w",
      "targetKind": "path"
    },
    "readProjectFile": {
      "permissionProfile": "path",
      "permissionId": "r",
      "targetKind": "path"
    },
    "archivePath": {
      "permissionProfile": "path",
      "permissionId": "42",
      "targetKind": "path"
    }
  },
  "roleTemplates": {
    "1": { "name": "viewer" },
    "2": { "name": "member" },
    "3": { "name": "project-manager" },
    "4": { "name": "scope-admin" }
  },
  "groups": {
    "7": { "name": "ops-team" }
  },
  "pathPermissionCatalog": {
    "42": {
      "name": "archive_documents",
      "actions": ["archivePath"]
    }
  },
  "namedPaths": {
    "shared_docs": "shared/docs/",
    "vendor_docs": "shared/vendors/acme/",
    "archive_area": "shared/archive/",
    "files": {
      "project_docs": "shared/docs/"
    },
    "datasets": {
      "customer_raw": "customers/acme/raw/"
    }
  },
  "snippets": {
    "scope.admin_all": "permit(principal, action, resource) when { resource.scope_id == principal.current_scope_id && principal.current_scope_role == \"scope-admin\" };",
    "jira.member_read_project": "permit(principal, action == Action::\"readProject\", resource is Project) when { resource.scope_id == principal.current_scope_id && (principal.current_scope_role == \"member\" || principal.current_scope_role == \"project-manager\" || principal.current_scope_role == \"scope-admin\") };",
    "jira.member_read_issue": "permit(principal, action == Action::\"readIssue\", resource is Issue) when { resource.scope_id == principal.current_scope_id && (principal.current_scope_role == \"member\" || principal.current_scope_role == \"project-manager\" || principal.current_scope_role == \"scope-admin\") };",
    "path.scope_grants": "permit(principal, action, resource) when { resource.scope_id == principal.current_scope_id && principal.action_target_kind == \"path\" && principal.path_action_allowed == true };"
  }
}
```

## 2. OpenAPI Source And Compiled Auth Descriptor

OpenAPI is the source contract. The worker runtime uses a compiled auth descriptor derived from it.

Example source OpenAPI:

```yaml
openapi: 3.1.0
info:
  title: Mixed Resource API
  version: 1.0.0
paths:
  /projects/{projectId}:
    get:
      operationId: readProject
  /files/{storagePath}:
    get:
      operationId: readPath
  /datasets/{storagePath}:
    get:
      operationId: readPath
  /projects/{projectId}/files/{storagePath}:
    get:
      operationId: readProjectFile
```

Example compiled auth descriptor:

```json
{
  "version": "descriptor_v4",
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
      "operationId": "readFilePathFromHeader",
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
    },
    {
      "operationId": "readProjectFileFromHeader",
      "method": "GET",
      "pathPattern": "^/projects/(?<projectId>[^/]+)/files/(?<storagePath>.+)$",
      "actionId": "readProjectFile",
      "permissionProfile": "path",
      "permissionId": "r",
      "targetKind": "path",
      "resourceType": "Project",
      "resourceId": {
        "source": "path_group",
        "name": "projectId"
      },
      "pathSpace": {
        "anchorKind": "resource",
        "namespace": {
          "source": "literal",
          "value": "files"
        },
        "path": {
          "source": "path_group",
          "name": "storagePath"
        }
      }
    }
  ]
}
```

Important patterns:

- the descriptor carries `permissionProfile`, `permissionId`, and `targetKind`
- service-rooted path spaces use `anchorKind = "service"`
- resource-rooted path spaces use `anchorKind = "resource"`
- `pathSpace.namespace` distinguishes multiple hierarchical path systems

## 3. Compact JWT Structure

Example:

```json
{
  "sub": "user_alice",
  "azv": 1,
  "azs": [
    "sa|r3|g7|Pr:shared_docs|Pr:files:project_docs|Pr:datasets:customer_raw|pw:home/alice/drafts/|P42:archive_area",
    "sb|r4|Pr:shared_docs"
  ],
  "suspended": false
}
```

Interpretation:

- `sa` and `sb` are scope claim refs
- `r3` is role ID `3`
- `g7` is effective group ID `7`
- `Pr:shared_docs` is a named path grant in the default namespace
- `Pr:files:project_docs` is a named path grant in the resource-rooted `files` path space
- `Pr:datasets:customer_raw` is a named path grant in the `datasets` namespace
- `pw:home/alice/drafts/` is an inline path grant using built-in write permission `w`
- `P42:archive_area` is a named path grant using custom permission `42`

## 4. Path Grant Grammar

Named path grant:

```text
P<perm>:<name>
```

Inline path grant:

```text
p<perm>:<prefix>
```

Namespaced named path grant:

```text
P<perm>:<namespace>:<name>
```

Namespaced inline path grant:

```text
p<perm>:<namespace>:<prefix>
```

Examples:

- `Pr:shared_docs`
- `Pr:files:project_docs`
- `pw:home/alice/drafts/`
- `Pr:datasets:customer_raw`
- `P42:archive_area`

Built-in path permission IDs:

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

## 5. Scope-Local Config With Groups And Bindings

```yaml
scopeId: scope_alpha
claimId: sa
version: v7
scopeType: project
parentScopeId: scope_root
includes:
  - scope.admin_all
  - jira.member_read_project
  - jira.member_read_issue
  - path.scope_grants
namedPaths:
  workspace_docs: shared/workspace-alpha/
  files:
    workspace_docs: shared/workspace-alpha/
groups:
  "9":
    name: alpha-admins
bindings:
  - subjectKind: Group
    subjectId: "9"
    roleId: "4"
policy: |
  permit(principal, action == Action::"transitionIssue", resource is Issue)
  when {
    resource.scope_id == principal.current_scope_id &&
    (
      principal.current_scope_role == "project-manager" ||
      principal.current_scope_role == "scope-admin"
    )
  };
```

Important point:

- groups and bindings are management-layer config
- the runtime JWT should still carry flattened effective roles and path grants for the current scope

## 6. What The Worker Evaluates For Path Requests

For a request like:

```text
GET /projects/project_1/files/shared/docs/runbook.md
```

the runtime resolves:

- current scope from the configured scope resolution chain
- action `readProjectFile`
- permission profile `path`
- permission ID `r`
- target kind `path`
- anchor resource `Project("project_1")`
- path space namespace `files`
- current path `shared/docs/runbook.md`

The Worker then:

1. expands named and inline path grants from the current scope claim
2. filters them by `namespace == "files"`
3. checks whether any matching grant also has permission `r`
4. injects normalized facts like `path_action_allowed` into the principal
5. lets Cedar decide using those normalized facts

## 7. Useful Principal Attributes In Cedar

The runtime injects useful normalized fields into the principal:

- `current_scope_role`
- `current_scope_roles`
- `current_scope_group`
- `current_scope_groups`
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

That means policy can stay simple.

## 8. Two Path Systems In One Service

If a service has multiple hierarchical path systems, use namespaces.

Example:

- default namespace for normal files
- `datasets` namespace for dataset trees
- `files` namespace for resource-rooted project files

All three use the same path-grant grammar, but grants only match when both:

- the namespace matches
- the prefix matches

## 9. Scope Type Instead Of Organization

If one scope is an organization and another is a project:

- `scope_alpha` may have `scopeType: project`
- `scope_beta` may have `scopeType: organization`

That keeps the framework small while still supporting hierarchy with `parentScopeId`.
