import { readFile } from "node:fs/promises";

import { SignJWT, importJWK } from "jose";

import { DEMO_SECRETS, DEMO_URLS } from "./demo-data.mjs";
import { mintDemoToken } from "./demo-token.mjs";

const results = [];

async function check(name, action) {
  try {
    await action();
    results.push({ name, status: "pass" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "fail", error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

function equal(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, received ${actual}`);
}

async function gateway(token, path, method = "GET", scope = "proj-alpha") {
  return fetch(`${DEMO_URLS.gateway}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "x-scope-id": scope, ...(method === "GET" ? {} : { "content-type": "application/json" }) },
    ...(method === "GET" ? {} : { body: "{}" }),
  });
}

async function management(path, method = "GET", body, actor) {
  const response = await fetch(`${DEMO_URLS.management}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${DEMO_SECRETS.management}`,
      ...(actor ? {
        "x-authz-decision": "allow",
        "x-authz-principal-id": actor,
        "x-authz-gateway-token": "local-management-gateway-token",
      } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : undefined };
}

export async function runDemoTests() {
  const alice = await mintDemoToken("alice");
  const carol = await mintDemoToken("carol");
  const admin = await mintDemoToken("admin");
  const automation = await mintDemoToken("automation");

  await check("viewer reads a project", async () => equal((await gateway(alice, "/projects/proj-alpha")).status, 200, "status"));
  await check("viewer cannot update a project", async () => equal((await gateway(alice, "/projects/proj-alpha", "PUT")).status, 403, "status"));
  await check("project manager updates a project", async () => equal((await gateway(carol, "/projects/proj-alpha", "PUT")).status, 200, "status"));
  await check("scope admin manages bindings", async () => equal((await gateway(admin, "/projects/proj-alpha/bindings", "POST")).status, 200, "status"));
  await check("named path grants shared file access", async () => equal((await gateway(alice, "/files/shared/docs/guide.pdf")).status, 200, "status"));
  await check("named path does not grant sibling prefixes", async () => equal((await gateway(alice, "/files/private/plan.pdf")).status, 403, "status"));
  await check("dataset namespace does not grant files", async () => {
    equal((await gateway(automation, "/datasets/customers/acme/raw/events.json")).status, 200, "dataset status");
    equal((await gateway(automation, "/files/customers/acme/raw/events.json")).status, 403, "files status");
  });
  await check("resource-rooted project path stays anchored", async () => {
    equal((await gateway(alice, "/projects/proj-alpha/files/shared/readme.md")).status, 200, "alpha status");
    equal((await gateway(alice, "/projects/proj-beta/files/shared/readme.md")).status, 403, "beta status");
  });
  await check("suspended claim is denied globally", async () => {
    const privateJwk = JSON.parse(await readFile(".wrangler/demo-private-jwk.json", "utf8"));
    const key = await importJWK(privateJwk, "ES256");
    const token = await new SignJWT({ azv: 1, azs: ["pa|rviewer"], suspended: true })
      .setProtectedHeader({ alg: "ES256", kid: "local-es256-1" })
      .setIssuer(`${DEMO_URLS.authn}/`).setAudience("projects-api").setSubject("user-suspended")
      .setIssuedAt().setExpirationTime("10m").sign(key);
    equal((await gateway(token, "/projects/proj-alpha")).status, 403, "status");
  });
  await check("suspended account cannot log in", async () => {
    const response = await fetch(`${DEMO_URLS.authn}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "suspended", password: "suspended-password", audience: "projects-api" }) });
    equal(response.status, 403, "status");
  });
  await check("membership removal changes the next token", async () => {
    const before = await mintDemoToken("bob");
    equal((await gateway(before, "/projects/proj-alpha")).status, 200, "before removal");
    equal((await management("/scopes/proj-alpha/groups/contractors/members/user-bob", "DELETE")).response.status, 204, "remove membership");
    const after = await mintDemoToken("bob");
    equal((await gateway(after, "/projects/proj-alpha")).status, 403, "after removal");
    equal((await management("/scopes/proj-alpha/groups/contractors/members/user-bob", "PUT", { memberKind: "User" })).response.status, 200, "restore membership");
  });
  await check("invalid scope type is rejected by vocabulary", async () => {
    const value = await management("/scopes/proj-alpha", "PATCH", { scopeType: "unknown-type" });
    equal(value.response.status, 422, "status");
    equal(value.body.error.code, "vocabulary_violation", "error code");
  });
  await check("forged gateway actor headers are rejected", async () => {
    const response = await fetch(`${DEMO_URLS.management}/services`, {
      headers: {
        "x-authz-decision": "allow",
        "x-authz-principal-id": "forged-admin",
      },
    });
    equal(response.status, 401, "status");
  });
  await check("break-glass access requires a second actor and is revocable", async () => {
    const created = await management("/break-glass-grants", "POST", {
      subjectId: "user-alice", serviceId: "projects-api", scopeId: "proj-alpha",
      roleId: "scope-admin", reason: "demo incident response", durationSeconds: 300,
    }, "requester-admin");
    equal(created.response.status, 201, "request status");
    equal((await management(`/break-glass-grants/${created.body.grantId}/approve`, "POST", {}, "requester-admin")).response.status, 403, "self-approval status");
    equal((await management(`/break-glass-grants/${created.body.grantId}/approve`, "POST", {}, "reviewer-admin")).response.status, 200, "approval status");
    equal((await gateway(await mintDemoToken("alice"), "/projects/proj-alpha/bindings", "POST")).status, 200, "active grant");
    equal((await management(`/break-glass-grants/${created.body.grantId}/revoke`, "POST", {}, "reviewer-admin")).response.status, 200, "revoke status");
    equal((await gateway(await mintDemoToken("alice"), "/projects/proj-alpha/bindings", "POST")).status, 403, "revoked grant");
  });
  await check("publication approval rejects a stale reviewed diff", async () => {
    const draft = await management("/scopes/proj-beta/config");
    await management("/scopes/proj-beta/config", "PUT", {
      ...draft.body,
      metadata: { ...(draft.body.metadata ?? {}), staleReviewDemo: "reviewed" },
    }, "requester-admin");
    const created = await management("/change-requests", "POST", {
      targetType: "scope", serviceId: "projects-api", scopeId: "proj-beta",
      requestedVersion: `demo-stale-${Date.now()}`, summary: "Verify stale review rejection",
    }, "requester-admin");
    await management("/scopes/proj-beta/config", "PUT", {
      ...draft.body,
      metadata: { ...(draft.body.metadata ?? {}), staleReviewDemo: "changed-after-review" },
    }, "requester-admin");
    const stale = await management(`/change-requests/${created.body.requestId}/approve`, "POST", {}, "reviewer-admin");
    equal(stale.response.status, 409, "stale approval status");
    equal(stale.body.error.code, "change_request_stale", "stale approval code");
    equal((await management(`/change-requests/${created.body.requestId}/reject`, "POST", {}, "reviewer-admin")).response.status, 200, "cleanup rejection");
  });
  await check("scope publication supports two-person approval with impact preview", async () => {
    const draft = await management("/scopes/proj-beta/config");
    await management("/scopes/proj-beta/config", "PUT", {
      ...draft.body,
      metadata: { ...(draft.body.metadata ?? {}), approvalDemo: Date.now() },
    }, "requester-admin");
    const created = await management("/change-requests", "POST", {
      targetType: "scope", serviceId: "projects-api", scopeId: "proj-beta",
      requestedVersion: `demo-approved-${Date.now()}`, summary: "Exercise two-person scope publication",
    }, "requester-admin");
    equal(created.response.status, 201, "request status");
    equal(created.body.status, "pending", "pending status");
    if (!created.body.diff.length) throw new Error("change request has no diff");
    equal((await management(`/change-requests/${created.body.requestId}/approve`, "POST", {}, "requester-admin")).response.status, 403, "self-approval status");
    const approved = await management(`/change-requests/${created.body.requestId}/approve`, "POST", { note: "demo review" }, "reviewer-admin");
    equal(approved.response.status, 200, "approval status");
    equal(approved.body.status, "executed", "executed status");
  });
  await check("scope publication changes runtime behavior", async () => {
    const disabled = await management("/scopes/proj-alpha/config", "PUT", { includes: ["path.grants"], namedPaths: {}, staticEntities: [], metadata: {} });
    equal(disabled.response.status, 200, "update draft");
    equal((await management("/scopes/proj-alpha/publish", "POST", { version: `demo-disabled-${Date.now()}` })).response.status, 201, "publish disabled");
    await new Promise((resolve) => setTimeout(resolve, 1_250));
    equal((await gateway(await mintDemoToken("alice"), "/projects/proj-alpha")).status, 403, "after disabled publish");
    await management("/scopes/proj-alpha/config", "PUT", { includes: ["project.roles", "path.grants"], namedPaths: {}, staticEntities: [], metadata: {} });
    await management("/scopes/proj-alpha/publish", "POST", { version: `demo-restored-${Date.now()}` });
    await new Promise((resolve) => setTimeout(resolve, 1_250));
    equal((await gateway(await mintDemoToken("alice"), "/projects/proj-alpha")).status, 200, "after restore");
  });
  await check("operations status reports projection and replication health", async () => {
    const status = await management("/operations/status");
    equal(status.response.status, 200, "status");
    if (typeof status.body.dirtyProjections !== "number") throw new Error("dirty projection count is missing");
    if (!Array.isArray(status.body.recentReplications)) throw new Error("replication status is missing");
  });

  const failures = results.filter((result) => result.status === "fail");
  if (failures.length) throw new Error(`${failures.length} demo scenario(s) failed`);
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDemoTests().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
