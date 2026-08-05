export const DEMO_URLS = {
  gateway: "http://127.0.0.1:8787",
  authn: "http://127.0.0.1:8788",
  management: "http://127.0.0.1:8789",
  upstream: "http://127.0.0.1:8790",
  ui: "http://127.0.0.1:5173",
};

export const DEMO_SECRETS = {
  management: "local-management-token",
  internal: "local-internal-token",
  serviceAccount: "automation-client-secret",
};

export const demoVocabulary = {
  serviceId: "projects-api",
  version: 1,
  scopeTypes: [
    { id: "organization", name: "Organization" },
    { id: "workspace", name: "Workspace" },
    { id: "project", name: "Project" },
  ],
  scopeHierarchy: [
    { parentType: "organization", childType: "workspace" },
    { parentType: "workspace", childType: "project" },
  ],
  resourceTypes: [{ id: "Project" }, { id: "Scope" }, { id: "PathObject" }],
  pathSpaces: [
    { id: "files", name: "Service files", anchorKind: "service", routePattern: "/files/{path+}" },
    { id: "datasets", name: "Datasets", anchorKind: "service", routePattern: "/datasets/{path+}" },
    { id: "project-files", name: "Project files", anchorKind: "resource", resourceType: "Project", routePattern: "/projects/{projectId}/files/{path+}" },
  ],
  actions: [
    { id: "readProject", targetKind: "resource", resourceType: "Project", permissionProfile: "object", permissionId: "read" },
    { id: "updateProject", targetKind: "resource", resourceType: "Project", permissionProfile: "object", permissionId: "update" },
    { id: "manageBindings", targetKind: "scope", resourceType: "Scope", permissionProfile: "object", permissionId: "manage" },
    { id: "readFile", targetKind: "path", resourceType: "PathObject", pathSpace: "files", permissionProfile: "path", permissionId: "r" },
    { id: "readDataset", targetKind: "path", resourceType: "PathObject", pathSpace: "datasets", permissionProfile: "path", permissionId: "r" },
    { id: "readProjectFile", targetKind: "path", resourceType: "Project", pathSpace: "project-files", permissionProfile: "path", permissionId: "r" },
  ],
  permissionProfiles: [
    { id: "object", name: "Object", permissions: [{ id: "read" }, { id: "update" }, { id: "manage" }] },
    { id: "path", name: "Path", permissions: [{ id: "r" }, { id: "w" }] },
  ],
  roleTemplates: [
    { id: "viewer", name: "viewer", grants: [{ targetKind: "resource", resourceType: "Project", permissionProfile: "object", permissionId: "read" }] },
    { id: "member", name: "member", grants: [{ targetKind: "resource", resourceType: "Project", permissionProfile: "object", permissionId: "read" }] },
    { id: "project-manager", name: "project-manager", grants: [
      { targetKind: "resource", resourceType: "Project", permissionProfile: "object", permissionId: "read" },
      { targetKind: "resource", resourceType: "Project", permissionProfile: "object", permissionId: "update" },
    ] },
    { id: "scope-admin", name: "scope-admin", grants: [
      { targetKind: "resource", resourceType: "Project", permissionProfile: "object", permissionId: "read" },
      { targetKind: "resource", resourceType: "Project", permissionProfile: "object", permissionId: "update" },
      { targetKind: "scope", resourceType: "Scope", permissionProfile: "object", permissionId: "manage" },
    ] },
  ],
  subjectKinds: ["User", "ServiceAccount", "Group"],
  claimConventions: { scopeReference: "claimId", authorizationClaim: "azs", authorizationVersion: 1 },
  updatedAt: "2026-08-05T00:00:00.000Z",
};

export const demoOpenApi = {
  openapi: "3.1.0",
  info: { title: "Project Workspace API", version: "1.0.0" },
  paths: {
    "/projects/{projectId}": {
      get: { operationId: "getProject", "x-authz-action-id": "readProject", "x-authz-resource-type": "Project", "x-authz-permission-profile": "object", "x-authz-permission-id": "read" },
      put: { operationId: "updateProject", "x-authz-action-id": "updateProject", "x-authz-resource-type": "Project", "x-authz-permission-profile": "object", "x-authz-permission-id": "update" },
    },
    "/projects/{projectId}/bindings": {
      post: { operationId: "manageProjectBindings", "x-authz-action-id": "manageBindings", "x-authz-target-kind": "scope", "x-authz-resource-type": "Scope", "x-authz-permission-profile": "object", "x-authz-permission-id": "manage" },
    },
    "/files/{storagePath+}": {
      get: { operationId: "readFile", "x-authz-action-id": "readFile", "x-authz-target-kind": "path", "x-authz-resource-type": "PathObject", "x-authz-path-space": "files", "x-authz-path-param": "storagePath", "x-authz-permission-profile": "path", "x-authz-permission-id": "r" },
    },
    "/datasets/{storagePath+}": {
      get: { operationId: "readDataset", "x-authz-action-id": "readDataset", "x-authz-target-kind": "path", "x-authz-resource-type": "PathObject", "x-authz-path-space": "datasets", "x-authz-path-param": "storagePath", "x-authz-permission-profile": "path", "x-authz-permission-id": "r" },
    },
    "/projects/{projectId}/files/{storagePath+}": {
      get: { operationId: "readProjectFile", "x-authz-action-id": "readProjectFile", "x-authz-target-kind": "path", "x-authz-resource-type": "Project", "x-authz-path-space": "project-files", "x-authz-path-anchor-kind": "resource", "x-authz-path-param": "storagePath", "x-authz-permission-profile": "path", "x-authz-permission-id": "r" },
    },
  },
};

export const authDescriptor = {
  version: "demo-v1",
  operations: [
    { operationId: "getProject", method: "GET", pathPattern: "^/projects/(?<projectId>[^/]+)$", actionId: "readProject", permissionProfile: "object", permissionId: "read", targetKind: "resource", resourceType: "Project", resourceId: { source: "path_group", name: "projectId" } },
    { operationId: "updateProject", method: "PUT", pathPattern: "^/projects/(?<projectId>[^/]+)$", actionId: "updateProject", permissionProfile: "object", permissionId: "update", targetKind: "resource", resourceType: "Project", resourceId: { source: "path_group", name: "projectId" } },
    { operationId: "manageProjectBindings", method: "POST", pathPattern: "^/projects/(?<projectId>[^/]+)/bindings$", actionId: "manageBindings", permissionProfile: "object", permissionId: "manage", targetKind: "scope", resourceType: "Scope", resourceId: { source: "literal", value: "current" } },
    { operationId: "readFile", method: "GET", pathPattern: "^/files/(?<storagePath>.+)$", actionId: "readFile", permissionProfile: "path", permissionId: "r", targetKind: "path", resourceType: "PathObject", resourceId: { source: "path_group", name: "storagePath" }, pathSpace: { anchorKind: "service", namespace: { source: "literal", value: "files" }, path: { source: "path_group", name: "storagePath" } } },
    { operationId: "readDataset", method: "GET", pathPattern: "^/datasets/(?<storagePath>.+)$", actionId: "readDataset", permissionProfile: "path", permissionId: "r", targetKind: "path", resourceType: "PathObject", resourceId: { source: "path_group", name: "storagePath" }, pathSpace: { anchorKind: "service", namespace: { source: "literal", value: "datasets" }, path: { source: "path_group", name: "storagePath" } } },
    { operationId: "readProjectFile", method: "GET", pathPattern: "^/projects/(?<anchoredPath>(?<projectId>[^/]+)/files/(?<storagePath>.+))$", actionId: "readProjectFile", permissionProfile: "path", permissionId: "r", targetKind: "path", resourceType: "Project", resourceId: { source: "path_group", name: "projectId" }, pathSpace: { anchorKind: "resource", anchorResourceType: "Project", anchorResourceId: { source: "path_group", name: "projectId" }, namespace: { source: "literal", value: "project-files" }, path: { source: "path_group", name: "anchoredPath" } } },
  ],
};

export const projectPolicy = `
permit(principal, action == Action::"readProject", resource is Project)
when {
  resource.scope_id == principal.current_scope_id &&
  (
    principal.current_scope_role == "viewer" ||
    principal.current_scope_role == "member" ||
    principal.current_scope_role == "project-manager" ||
    principal.current_scope_role == "scope-admin"
  )
};

permit(principal, action == Action::"updateProject", resource is Project)
when {
  resource.scope_id == principal.current_scope_id &&
  (
    principal.current_scope_role == "project-manager" ||
    principal.current_scope_role == "scope-admin"
  )
};

permit(principal, action == Action::"manageBindings", resource is Scope)
when {
  principal.current_scope_role == "scope-admin"
};
`;

export const pathPolicy = `
permit(principal, action, resource)
when {
  resource.scope_id == principal.current_scope_id &&
  principal.action_target_kind == "path" &&
  principal.path_action_allowed == true
};
`;

export const globalPolicy = `
forbid(principal, action, resource)
when { principal.suspended == true };
`;
