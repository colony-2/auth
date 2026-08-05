import {
  DEMO_SECRETS,
  DEMO_URLS,
  authDescriptor,
  demoOpenApi,
  demoVocabulary,
  globalPolicy,
  pathPolicy,
  projectPolicy,
} from "./demo-data.mjs";

async function api(base, path, { method = "GET", token, internalToken, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(internalToken ? { "x-internal-auth-token": internalToken } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(value)}`);
  return value;
}

export async function seedDemo() {
  const management = (path, options = {}) => api(DEMO_URLS.management, path, { ...options, token: DEMO_SECRETS.management });
  await api(DEMO_URLS.authn, "/internal/bootstrap", {
    method: "POST",
    internalToken: DEMO_SECRETS.internal,
    body: {
      users: [
        { subjectId: "user-alice", username: "alice", password: "alice-password", displayName: "Alice Viewer", email: "alice@example.test" },
        { subjectId: "user-bob", username: "bob", password: "bob-password", displayName: "Bob Contractor", email: "bob@example.test" },
        { subjectId: "user-carol", username: "carol", password: "carol-password", displayName: "Carol Manager", email: "carol@example.test" },
        { subjectId: "user-admin", username: "admin", password: "admin-password", displayName: "Scope Admin", email: "admin@example.test" },
        { subjectId: "user-suspended", username: "suspended", password: "suspended-password", displayName: "Suspended User", status: "suspended" },
      ],
      serviceAccounts: [{ subjectId: "service-automation", clientSecret: DEMO_SECRETS.serviceAccount, displayName: "Dataset automation" }],
    },
  });

  for (const subject of [
    { subjectId: "user-alice", kind: "User", displayName: "Alice Viewer", email: "alice@example.test", status: "active" },
    { subjectId: "user-bob", kind: "User", displayName: "Bob Contractor", email: "bob@example.test", status: "active" },
    { subjectId: "user-carol", kind: "User", displayName: "Carol Manager", email: "carol@example.test", status: "active" },
    { subjectId: "user-admin", kind: "User", displayName: "Scope Admin", email: "admin@example.test", status: "active" },
    { subjectId: "user-suspended", kind: "User", displayName: "Suspended User", status: "suspended" },
    { subjectId: "service-automation", kind: "ServiceAccount", displayName: "Dataset automation", status: "active" },
  ]) await management("/subjects", { method: "POST", body: subject });

  const services = await management("/services");
  if (!services.items.some((service) => service.serviceId === "projects-api")) {
    await management("/services", { method: "POST", body: { serviceId: "projects-api", name: "Project Workspace", description: "Reference project and path authorization service", vocabulary: demoVocabulary } });
    await management("/services/projects-api/import-openapi", { method: "POST", body: { document: demoOpenApi } });
  }
  const draft = await management("/services/projects-api/config");
  await management("/services/projects-api/config", {
    method: "PUT",
    body: {
      openApiDocument: demoOpenApi,
      authDescriptor,
      snippets: { "project.roles": projectPolicy, "path.grants": pathPolicy },
      globalPolicy,
      namedPaths: {},
      metadata: { sample: "project-workspace" },
      ...(draft?.schema ? { schema: draft.schema } : {}),
    },
  });

  const scopeInputs = [
    { scopeId: "org-acme", serviceId: "projects-api", scopeType: "organization", name: "Acme", claimId: "oa" },
    { scopeId: "workspace-main", serviceId: "projects-api", scopeType: "workspace", name: "Main workspace", claimId: "wm", parentScopeId: "org-acme" },
    { scopeId: "proj-alpha", serviceId: "projects-api", scopeType: "project", name: "Atlas", claimId: "pa", parentScopeId: "workspace-main" },
    { scopeId: "proj-beta", serviceId: "projects-api", scopeType: "project", name: "Beacon", claimId: "pb", parentScopeId: "workspace-main" },
  ];
  const currentScopes = await management("/scopes?serviceId=projects-api");
  for (const scope of scopeInputs) {
    if (!currentScopes.items.some((value) => value.scopeId === scope.scopeId)) {
      await management("/scopes", { method: "POST", body: scope });
    }
  }

  for (const group of [
    { groupId: "ops-team", name: "Ops team" },
    { groupId: "contractors", name: "Contractors" },
    { groupId: "project-leads", name: "Project leads" },
  ]) await management("/scopes/proj-alpha/groups", { method: "POST", body: group });
  await management("/scopes/proj-alpha/groups/contractors/members/user-bob", { method: "PUT", body: { memberKind: "User" } });
  await management("/scopes/proj-alpha/groups/project-leads/members/user-carol", { method: "PUT", body: { memberKind: "User" } });
  await management("/scopes/proj-alpha/groups/ops-team/members/project-leads", { method: "PUT", body: { memberKind: "Group" } });

  const bindings = [
    { bindingId: "alice-viewer", subjectId: "user-alice", subjectKind: "User", roleId: "viewer" },
    { bindingId: "contractor-viewer", subjectId: "contractors", subjectKind: "Group", roleId: "viewer" },
    { bindingId: "lead-manager", subjectId: "project-leads", subjectKind: "Group", roleId: "project-manager" },
    { bindingId: "admin-scope", subjectId: "user-admin", subjectKind: "User", roleId: "scope-admin" },
    { bindingId: "suspended-viewer", subjectId: "user-suspended", subjectKind: "User", roleId: "viewer" },
    { bindingId: "alice-shared-files", subjectId: "user-alice", subjectKind: "User", permissionProfile: "path", permissionId: "r", pathSpace: "files", namedPath: "shared-docs" },
    { bindingId: "automation-datasets", subjectId: "service-automation", subjectKind: "ServiceAccount", permissionProfile: "path", permissionId: "r", pathSpace: "datasets", namedPath: "customer-raw" },
    { bindingId: "alice-project-files", subjectId: "user-alice", subjectKind: "User", permissionProfile: "path", permissionId: "r", pathSpace: "project-files", namedPath: "alpha-shared" },
  ];
  for (const binding of bindings) await management("/scopes/proj-alpha/bindings", { method: "POST", body: binding });

  for (const grant of [
    { pathGrantId: "shared-docs", name: "shared-docs", pathSpace: "files", prefix: "shared/docs/", permissions: ["r"] },
    { pathGrantId: "customer-raw", name: "customer-raw", pathSpace: "datasets", prefix: "customers/acme/raw/", permissions: ["r"] },
    { pathGrantId: "alpha-shared", name: "alpha-shared", pathSpace: "project-files", prefix: "proj-alpha/files/shared/", permissions: ["r"], anchorResourceType: "Project", anchorResourceId: "proj-alpha" },
  ]) await management("/scopes/proj-alpha/path-grants", { method: "POST", body: grant });

  for (const scopeId of scopeInputs.map((scope) => scope.scopeId)) {
    await management(`/scopes/${scopeId}/config`, { method: "PUT", body: { includes: ["project.roles", "path.grants"], namedPaths: {}, staticEntities: [], metadata: {} } });
  }
  const stamp = Date.now();
  await management("/services/projects-api/publish", { method: "POST", body: { version: `demo-svc-${stamp}` } });
  for (const scopeId of scopeInputs.map((scope) => scope.scopeId)) {
    await management(`/scopes/${scopeId}/publish`, { method: "POST", body: { version: `demo-${scopeId}-${stamp}` } });
  }
  return { service: "projects-api", scopes: scopeInputs.length, users: 5, serviceAccounts: 1 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDemo().then((value) => console.log(JSON.stringify(value, null, 2))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
