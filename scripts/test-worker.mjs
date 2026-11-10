import assert from "node:assert/strict";
import { createServer } from "node:http";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { unstable_dev } from "wrangler";

const BASE_URL = "http://127.0.0.1";
const ADMIN_TOKEN = "local-admin-token";
const JWT_ISSUER = "https://auth.example.test/";
const SERVICE_IDENTIFIER = "projects-api";

const globalPolicy = `
forbid(principal, action, resource)
when {
  principal.suspended == true
};
`;

const memberReadProjectSnippet = `
permit(principal, action == Action::"readProject", resource is Project)
when {
  resource.scope_id == principal.current_scope_id &&
  (
    principal.current_scope_role == "member" ||
    principal.current_scope_role == "scope-admin"
  )
};
`;

const pathGrantSnippet = `
permit(principal, action, resource)
when {
  resource.scope_id == principal.current_scope_id &&
  principal.action_target_kind == "path" &&
  principal.path_action_allowed == true
};
`;

const scopeBetaV1Policy = `
permit(principal, action == Action::"readProject", resource is Project)
when {
  resource.scope_id == principal.current_scope_id &&
  principal.current_scope_role == "scope-admin"
};
`;

const scopeBetaV2Policy = `
permit(principal, action == Action::"readProject", resource is Project)
when {
  resource.scope_id == principal.current_scope_id &&
  (
    principal.current_scope_role == "scope-admin" ||
    principal.current_scope_role == "viewer"
  )
};
`;

async function signToken(privateKey, claims) {
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
    .setIssuer(JWT_ISSUER)
    .setAudience(SERVICE_IDENTIFIER)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(privateKey);
}

function buildServiceConfig(version = "svc_v2") {
  return {
    version,
    schemaVersion: "1",
    openApiDocument: {
      openapi: "3.1.0",
      info: {
        title: "Projects API",
        version: "2.0.0",
      },
    },
    authDescriptor: {
      version: "descriptor_v2",
      operations: [
        {
          operationId: "readProjectFromHeader",
          method: "GET",
          pathPattern: "^/projects/(?<projectId>[^/]+)$",
          actionId: "readProject",
          resourceType: "Project",
          resourceId: {
            source: "path_group",
            name: "projectId",
          },
          context: {
            scope_source: "header",
          },
        },
        {
          operationId: "readProjectFromJsonBody",
          method: "POST",
          pathPattern: "^/project-access$",
          actionId: "readProject",
          resourceType: "Project",
          resourceId: {
            source: "body_json",
            pointer: "/projectId",
            contentTypes: ["application/json"],
          },
          context: {
            scope_source: "body_json",
          },
        },
        {
          operationId: "readProjectFromTextBody",
          method: "POST",
          pathPattern: "^/project-access-text$",
          actionId: "readProject",
          resourceType: "Project",
          resourceId: {
            source: "body_regex",
            pattern: "(?:^|[&\\s])projectId=(?<projectId>[^&\\s]+)",
            group: "projectId",
            contentTypes: ["text/plain", "application/x-www-form-urlencoded"],
          },
          context: {
            scope_source: "body_regex",
          },
        },
        {
          operationId: "readProjectFromPathScope",
          method: "GET",
          pathPattern: "^/scope-path/(?<scopeId>[^/]+)/projects/(?<projectId>[^/]+)$",
          actionId: "readProject",
          resourceType: "Project",
          resourceId: {
            source: "path_group",
            name: "projectId",
          },
          context: {
            scope_source: "path",
          },
        },
        {
          operationId: "readPathFromHeader",
          method: "GET",
          pathPattern: "^/files/(?<storagePath>.+)$",
          actionId: "readPath",
          targetKind: "path",
          permissionProfile: "path",
          permissionId: "r",
          resourceType: "PathObject",
          resourceId: {
            source: "path_group",
            name: "storagePath",
          },
          pathSpace: {
            anchorKind: "service",
            path: {
              source: "path_group",
              name: "storagePath",
            },
          },
          context: {
            scope_source: "header",
          },
        },
        {
          operationId: "readDatasetPathFromHeader",
          method: "GET",
          pathPattern: "^/datasets/(?<storagePath>.+)$",
          actionId: "readPath",
          targetKind: "path",
          permissionProfile: "path",
          permissionId: "r",
          resourceType: "PathObject",
          resourceId: {
            source: "path_group",
            name: "storagePath",
          },
          pathSpace: {
            anchorKind: "service",
            path: {
              source: "path_group",
              name: "storagePath",
            },
            namespace: {
              source: "literal",
              value: "datasets",
            },
          },
          context: {
            scope_source: "header",
          },
        },
        {
          operationId: "readProjectFileFromHeader",
          method: "GET",
          pathPattern: "^/projects/(?<projectId>[^/]+)/files/(?<storagePath>.+)$",
          actionId: "readProjectFile",
          targetKind: "path",
          permissionProfile: "path",
          permissionId: "r",
          resourceType: "Project",
          resourceId: {
            source: "path_group",
            name: "projectId",
          },
          pathSpace: {
            anchorKind: "resource",
            namespace: {
              source: "literal",
              value: "files",
            },
            path: {
              source: "path_group",
              name: "storagePath",
            },
          },
          context: {
            scope_source: "header",
          },
        },
        {
          operationId: "writePathFromHeader",
          method: "PUT",
          pathPattern: "^/files/(?<storagePath>.+)$",
          actionId: "writePath",
          targetKind: "path",
          permissionProfile: "path",
          permissionId: "w",
          resourceType: "PathObject",
          resourceId: {
            source: "path_group",
            name: "storagePath",
          },
          pathSpace: {
            anchorKind: "service",
            path: {
              source: "path_group",
              name: "storagePath",
            },
          },
          context: {
            scope_source: "header",
          },
        },
        {
          operationId: "archivePathFromHeader",
          method: "POST",
          pathPattern: "^/archive-files/(?<storagePath>.+)$",
          actionId: "archivePath",
          targetKind: "path",
          permissionProfile: "path",
          permissionId: "42",
          resourceType: "PathObject",
          resourceId: {
            source: "path_group",
            name: "storagePath",
          },
          pathSpace: {
            anchorKind: "service",
            path: {
              source: "path_group",
              name: "storagePath",
            },
          },
          context: {
            scope_source: "header",
          },
        },
      ],
    },
    snippets: {
      "scope.member_read_project": memberReadProjectSnippet,
      "path.scope_grants": pathGrantSnippet,
    },
    globalPolicy,
    roleTemplates: {
      "1": { name: "viewer" },
      "2": { name: "member" },
      "3": { name: "scope-admin" },
    },
    groups: {
      "7": { name: "ops-team" },
      "8": { name: "dataset-team" },
    },
    pathPermissionCatalog: {
      "42": {
        name: "archive_documents",
        actions: ["archivePath"],
      },
    },
    namedPaths: {
      shared_docs: "shared/docs/",
      archive_area: "shared/archive/",
      files: {
        shared_docs: "shared/docs/",
      },
      datasets: {
        customer_raw: "customers/acme/raw/",
      },
    },
    staticEntities: [],
  };
}

function buildScopeAlphaConfig() {
  return {
    scopeId: "scope_alpha",
    claimId: "sa",
    version: "v1",
    scopeType: "project",
    parentScopeId: "scope_root",
    includes: ["scope.member_read_project", "path.scope_grants"],
    namedPaths: {
      workspace_docs: "shared/workspace-alpha/",
      files: {
        workspace_docs: "shared/workspace-alpha/",
      },
      analytics: {
        workspace_raw: "workspaces/alpha/raw/",
      },
    },
    groups: {
      "9": {
        name: "alpha-admins",
      },
    },
    bindings: [
      {
        subjectKind: "Group",
        subjectId: "9",
        roleId: "3",
      },
    ],
    staticEntities: [],
  };
}

function buildScopeBetaV1Config() {
  return {
    scopeId: "scope_beta",
    claimId: "sb",
    version: "v1",
    scopeType: "organization",
    includes: ["path.scope_grants"],
    policy: scopeBetaV1Policy,
    staticEntities: [],
  };
}

function buildScopeBetaV2Config() {
  return {
    scopeId: "scope_beta",
    claimId: "sb",
    version: "v2",
    scopeType: "organization",
    includes: ["path.scope_grants"],
    policy: scopeBetaV2Policy,
    staticEntities: [],
  };
}

async function startUpstreamServer(jwksBody) {
  const server = createServer((req, res) => {
    if (req.url === "/.well-known/jwks.json") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(jwksBody));
      return;
    }

    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      let bodyJson = null;
      if (bodyText.length > 0) {
        try {
          bodyJson = JSON.parse(bodyText);
        } catch {
          bodyJson = null;
        }
      }

      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          ok: true,
          upstream: true,
          method: req.method,
          path: req.url,
          authz: {
            scopeId: req.headers["x-authz-scope-id"] ?? "",
            scopeType: req.headers["x-authz-scope-type"] ?? "",
            principalId: req.headers["x-authz-principal-id"] ?? "",
            action: req.headers["x-authz-action"] ?? "",
            permissionProfile: req.headers["x-authz-permission-profile"] ?? "",
            permissionId: req.headers["x-authz-permission-id"] ?? "",
            targetKind: req.headers["x-authz-target-kind"] ?? "",
            operationId: req.headers["x-authz-operation-id"] ?? "",
            serviceVersion: req.headers["x-authz-service-version"] ?? "",
            scopeVersion: req.headers["x-authz-scope-version"] ?? "",
            resourceScopeId: req.headers["x-authz-resource-scope-id"] ?? "",
            pathNamespace: req.headers["x-authz-path-namespace"] ?? "",
            pathAnchorKind: req.headers["x-authz-path-anchor-kind"] ?? "",
            pathAnchorResourceType: req.headers["x-authz-path-anchor-resource-type"] ?? "",
            pathAnchorResourceId: req.headers["x-authz-path-anchor-resource-id"] ?? "",
          },
          bodyText,
          bodyJson,
        }),
      );
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve(undefined));
    server.once("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to get upstream server address");
  }

  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(undefined);
        });
      });
    },
  };
}

async function readResponse(response) {
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { response, text, json };
}

async function request(worker, path, options = {}) {
  const response = await worker.fetch(`${BASE_URL}${path}`, options);
  return await readResponse(response);
}

async function postJson(worker, path, body, headers = {}) {
  return await request(worker, path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function putText(worker, path, body, headers = {}, contentType = "text/plain") {
  return await request(worker, path, {
    method: "PUT",
    headers: {
      "content-type": contentType,
      ...headers,
    },
    body,
  });
}

async function postText(worker, path, body, headers = {}, contentType = "text/plain") {
  return await request(worker, path, {
    method: "POST",
    headers: {
      "content-type": contentType,
      ...headers,
    },
    body,
  });
}

async function publishServiceConfig(worker, body) {
  const result = await postJson(worker, "/internal/service-config/publish", body, {
    "x-admin-token": ADMIN_TOKEN,
  });
  assert.equal(result.response.status, 200, `service publish failed: ${result.text}`);
  return result.json;
}

async function publishScopeConfig(worker, body) {
  const result = await postJson(worker, "/internal/scope-config/publish", body, {
    "x-admin-token": ADMIN_TOKEN,
  });
  assert.equal(result.response.status, 200, `scope publish failed: ${result.text}`);
  return result.json;
}

async function invalidateScope(worker, scopeId) {
  const result = await postJson(
    worker,
    "/internal/cache/invalidate",
    { scopeId },
    {
      "x-admin-token": ADMIN_TOKEN,
    },
  );
  assert.equal(result.response.status, 200, `invalidate for ${scopeId} failed: ${result.text}`);
  return result.json;
}

async function seedWorker(worker) {
  await publishServiceConfig(worker, buildServiceConfig());
  await publishScopeConfig(worker, buildScopeAlphaConfig());
  await publishScopeConfig(worker, buildScopeBetaV1Config());
}

async function startWorker(script, upstreamOrigin) {
  return await unstable_dev(script, {
    config: "wrangler.jsonc",
    local: true,
    logLevel: "error",
    vars: {
      UPSTREAM_ORIGIN: upstreamOrigin,
    },
    experimental: {
      disableExperimentalWarning: true,
      testMode: true,
    },
  });
}

async function runProxyTests(upstreamOrigin, tokens) {
  const proxyWorker = await unstable_dev("src/test-proxy.ts", {
    config: "wrangler.jsonc",
    local: true,
    logLevel: "error",
    vars: {
      SERVICE_IDENTIFIER,
      JWKS_URL: `${upstreamOrigin}/.well-known/jwks.json`,
      JWT_ISSUER,
      UPSTREAM_ORIGIN: upstreamOrigin,
      ADMIN_TOKEN,
    },
    experimental: {
      disableExperimentalWarning: true,
      testMode: true,
    },
  });
  try {
    await seedWorker(proxyWorker);

    const health = await request(proxyWorker, "/health");
    assert.equal(health.response.status, 200, "health route failed");
    assert.equal(health.json.cedarReady, true);

    const aliceReadAlpha = await request(proxyWorker, "/projects/project_1", {
      headers: {
        authorization: `Bearer ${tokens.aliceToken}`,
        "x-scope-id": "scope_alpha",
      },
    });
    assert.equal(aliceReadAlpha.response.status, 200, aliceReadAlpha.text);
    assert.equal(aliceReadAlpha.json.authz.scopeId, "scope_alpha");
    assert.equal(aliceReadAlpha.json.authz.scopeType, "project");
    assert.equal(aliceReadAlpha.json.authz.principalId, "user_alice");
    assert.equal(aliceReadAlpha.json.authz.operationId, "readProjectFromHeader");
    assert.equal(aliceReadAlpha.json.authz.permissionProfile, "object");
    assert.equal(aliceReadAlpha.json.authz.permissionId, "r");
    assert.equal(aliceReadAlpha.json.authz.targetKind, "resource");
    assert.equal(aliceReadAlpha.json.authz.scopeVersion, "v1");

    const bobReadAlpha = await request(proxyWorker, "/projects/project_1", {
      headers: {
        authorization: `Bearer ${tokens.bobToken}`,
        "x-scope-id": "scope_alpha",
      },
    });
    assert.equal(bobReadAlpha.response.status, 403, bobReadAlpha.text);
    assert.equal(bobReadAlpha.json.scopeVersion, "v1");

    const daveReadAlpha = await request(proxyWorker, "/projects/project_1", {
      headers: {
        authorization: `Bearer ${tokens.daveToken}`,
        "x-scope-id": "scope_alpha",
      },
    });
    assert.equal(daveReadAlpha.response.status, 403, daveReadAlpha.text);

    const scopeResolutionFailed = await request(proxyWorker, "/projects/project_1", {
      headers: {
        authorization: `Bearer ${tokens.aliceToken}`,
      },
    });
    assert.equal(scopeResolutionFailed.response.status, 400, scopeResolutionFailed.text);
    assert.equal(scopeResolutionFailed.json.error, "scope_resolution_failed");

    const adminReadBetaFromJson = await postJson(
      proxyWorker,
      "/project-access",
      {
        scopeId: "scope_beta",
        projectId: "project_2",
      },
      {
        authorization: `Bearer ${tokens.carolToken}`,
      },
    );
    assert.equal(adminReadBetaFromJson.response.status, 200, adminReadBetaFromJson.text);
    assert.equal(adminReadBetaFromJson.json.authz.scopeId, "scope_beta");
    assert.equal(adminReadBetaFromJson.json.bodyJson.scopeId, "scope_beta");

    const bobReadBetaV1 = await postJson(
      proxyWorker,
      "/project-access",
      {
        scopeId: "scope_beta",
        projectId: "project_2",
      },
      {
        authorization: `Bearer ${tokens.bobToken}`,
      },
    );
    assert.equal(bobReadBetaV1.response.status, 403, bobReadBetaV1.text);
    assert.equal(bobReadBetaV1.json.scopeVersion, "v1");

    await publishScopeConfig(proxyWorker, buildScopeBetaV2Config());

    const bobReadBetaStillStale = await postJson(
      proxyWorker,
      "/project-access",
      {
        scopeId: "scope_beta",
        projectId: "project_2",
      },
      {
        authorization: `Bearer ${tokens.bobToken}`,
      },
    );
    assert.equal(
      bobReadBetaStillStale.response.status,
      403,
      "manifest cache should keep the old scope config active until invalidation or TTL expiry",
    );
    assert.equal(bobReadBetaStillStale.json.scopeVersion, "v1");

    await invalidateScope(proxyWorker, "scope_beta");

    const bobReadBetaV2 = await postJson(
      proxyWorker,
      "/project-access",
      {
        scopeId: "scope_beta",
        projectId: "project_2",
      },
      {
        authorization: `Bearer ${tokens.bobToken}`,
      },
    );
    assert.equal(bobReadBetaV2.response.status, 200, bobReadBetaV2.text);
    assert.equal(bobReadBetaV2.json.authz.scopeVersion, "v2");

    const bobReadBetaFromText = await postText(
      proxyWorker,
      "/project-access-text",
      "scopeId=scope_beta projectId=project_2",
      {
        authorization: `Bearer ${tokens.bobToken}`,
      },
    );
    assert.equal(bobReadBetaFromText.response.status, 200, bobReadBetaFromText.text);
    assert.equal(bobReadBetaFromText.json.authz.operationId, "readProjectFromTextBody");

    const aliceReadAlphaFromPath = await request(
      proxyWorker,
      "/scope-path/scope_alpha/projects/project_1",
      {
        headers: {
          authorization: `Bearer ${tokens.aliceToken}`,
        },
      },
    );
    assert.equal(aliceReadAlphaFromPath.response.status, 200, aliceReadAlphaFromPath.text);
    assert.equal(aliceReadAlphaFromPath.json.authz.operationId, "readProjectFromPathScope");
    assert.equal(aliceReadAlphaFromPath.json.authz.scopeId, "scope_alpha");

    const bobReadGlobalNamedPath = await request(
      proxyWorker,
      "/files/shared/docs/guide.txt",
      {
        headers: {
          authorization: `Bearer ${tokens.bobToken}`,
          "x-scope-id": "scope_alpha",
        },
      },
    );
    assert.equal(bobReadGlobalNamedPath.response.status, 200, bobReadGlobalNamedPath.text);
    assert.equal(bobReadGlobalNamedPath.json.authz.action, "readPath");
    assert.equal(bobReadGlobalNamedPath.json.authz.permissionProfile, "path");
    assert.equal(bobReadGlobalNamedPath.json.authz.permissionId, "r");
    assert.equal(bobReadGlobalNamedPath.json.authz.targetKind, "path");
    assert.equal(bobReadGlobalNamedPath.json.authz.pathNamespace, "default");
    assert.equal(bobReadGlobalNamedPath.json.authz.pathAnchorKind, "service");

    const bobReadScopeNamedPath = await request(
      proxyWorker,
      "/files/shared/workspace-alpha/spec.txt",
      {
        headers: {
          authorization: `Bearer ${tokens.bobToken}`,
          "x-scope-id": "scope_alpha",
        },
      },
    );
    assert.equal(bobReadScopeNamedPath.response.status, 200, bobReadScopeNamedPath.text);

    const aliceReadProjectFile = await request(
      proxyWorker,
      "/projects/project_1/files/shared/docs/guide.txt",
      {
        headers: {
          authorization: `Bearer ${tokens.aliceToken}`,
          "x-scope-id": "scope_alpha",
        },
      },
    );
    assert.equal(aliceReadProjectFile.response.status, 200, aliceReadProjectFile.text);
    assert.equal(aliceReadProjectFile.json.authz.operationId, "readProjectFileFromHeader");
    assert.equal(aliceReadProjectFile.json.authz.permissionProfile, "path");
    assert.equal(aliceReadProjectFile.json.authz.permissionId, "r");
    assert.equal(aliceReadProjectFile.json.authz.targetKind, "path");
    assert.equal(aliceReadProjectFile.json.authz.pathNamespace, "files");
    assert.equal(aliceReadProjectFile.json.authz.pathAnchorKind, "resource");
    assert.equal(aliceReadProjectFile.json.authz.pathAnchorResourceType, "Project");
    assert.equal(aliceReadProjectFile.json.authz.pathAnchorResourceId, "project_1");

    const bobWriteInlinePath = await putText(
      proxyWorker,
      "/files/home/bob/drafts/note.txt",
      "draft=1",
      {
        authorization: `Bearer ${tokens.bobToken}`,
        "x-scope-id": "scope_alpha",
      },
    );
    assert.equal(bobWriteInlinePath.response.status, 200, bobWriteInlinePath.text);

    const bobWriteForeignInlinePath = await putText(
      proxyWorker,
      "/files/home/alice/drafts/note.txt",
      "draft=1",
      {
        authorization: `Bearer ${tokens.bobToken}`,
        "x-scope-id": "scope_alpha",
      },
    );
    assert.equal(bobWriteForeignInlinePath.response.status, 403, bobWriteForeignInlinePath.text);

    const aliceReadDatasetPath = await request(
      proxyWorker,
      "/datasets/customers/acme/raw/report.csv",
      {
        headers: {
          authorization: `Bearer ${tokens.aliceToken}`,
          "x-scope-id": "scope_alpha",
        },
      },
    );
    assert.equal(aliceReadDatasetPath.response.status, 200, aliceReadDatasetPath.text);
    assert.equal(aliceReadDatasetPath.json.authz.action, "readPath");

    const bobReadDatasetPath = await request(
      proxyWorker,
      "/datasets/customers/acme/raw/report.csv",
      {
        headers: {
          authorization: `Bearer ${tokens.bobToken}`,
          "x-scope-id": "scope_alpha",
        },
      },
    );
    assert.equal(bobReadDatasetPath.response.status, 403, bobReadDatasetPath.text);

    const aliceArchiveCustomPath = await postText(
      proxyWorker,
      "/archive-files/shared/archive/release.zip",
      "",
      {
        authorization: `Bearer ${tokens.aliceToken}`,
        "x-scope-id": "scope_alpha",
      },
    );
    assert.equal(aliceArchiveCustomPath.response.status, 200, aliceArchiveCustomPath.text);

    const bobArchiveWithoutCustomGrant = await postText(
      proxyWorker,
      "/archive-files/shared/archive/release.zip",
      "",
      {
        authorization: `Bearer ${tokens.bobToken}`,
        "x-scope-id": "scope_alpha",
      },
    );
    assert.equal(bobArchiveWithoutCustomGrant.response.status, 403, bobArchiveWithoutCustomGrant.text);

    const missingToken = await request(proxyWorker, "/projects/project_1", {
      headers: {
        "x-scope-id": "scope_alpha",
      },
    });
    assert.equal(missingToken.response.status, 401, missingToken.text);

    const passthrough = await request(proxyWorker, "/public/echo");
    assert.equal(passthrough.response.status, 200, passthrough.text);
    assert.equal(passthrough.json.path, "/public/echo");
    assert.equal(passthrough.json.authz.scopeId, "");
  } finally {
    await proxyWorker.stop();
  }
}

async function runEmbeddedTests(upstreamOrigin, tokens) {
  const embeddedWorker = await unstable_dev("src/test-embedded.ts", {
    config: "wrangler.jsonc",
    local: true,
    logLevel: "error",
    vars: {
      SERVICE_IDENTIFIER,
      JWKS_URL: `${upstreamOrigin}/.well-known/jwks.json`,
      JWT_ISSUER,
      UPSTREAM_ORIGIN: upstreamOrigin,
      ADMIN_TOKEN,
    },
    experimental: {
      disableExperimentalWarning: true,
      testMode: true,
    },
  });
  try {
    await seedWorker(embeddedWorker);

    const embeddedAllow = await request(embeddedWorker, "/projects/project_1", {
      headers: {
        authorization: `Bearer ${tokens.aliceToken}`,
        "x-scope-id": "scope_alpha",
      },
    });
    assert.equal(embeddedAllow.response.status, 200, embeddedAllow.text);
    assert.equal(embeddedAllow.json.mode, "embedded");
    assert.equal(embeddedAllow.json.scopeId, "scope_alpha");
    assert.equal(embeddedAllow.json.scopeVersion, "v1");

    const embeddedDeny = await request(embeddedWorker, "/projects/project_1", {
      headers: {
        authorization: `Bearer ${tokens.bobToken}`,
        "x-scope-id": "scope_alpha",
      },
    });
    assert.equal(embeddedDeny.response.status, 403, embeddedDeny.text);

    const unresolvedRoute = await request(embeddedWorker, "/public/echo");
    assert.equal(unresolvedRoute.response.status, 404, unresolvedRoute.text);
  } finally {
    await embeddedWorker.stop();
  }
}

async function main() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const upstream = await startUpstreamServer({
    keys: [
      {
        ...jwk,
        kid: "test-key-1",
        use: "sig",
        alg: "RS256",
      },
    ],
  });

  const tokens = {
    aliceToken: await signToken(privateKey, {
      sub: "user_alice",
      azv: 1,
      azs: [
        "sa|r2|g7|Pr:shared_docs|Pr:files:shared_docs|Pr:workspace_docs|Pr:datasets:customer_raw|pw:home/alice/drafts/|P42:archive_area",
      ],
      suspended: false,
    }),
    bobToken: await signToken(privateKey, {
      sub: "user_bob",
      azv: 1,
      azs: [
        "sa|r1|g9|Pr:shared_docs|Pr:workspace_docs|pw:home/bob/drafts/",
        "sb|r1|Pr:shared_docs",
      ],
      suspended: false,
    }),
    carolToken: await signToken(privateKey, {
      sub: "user_carol",
      azv: 1,
      azs: [
        "sb|r3|Pr:shared_docs",
      ],
      suspended: false,
    }),
    daveToken: await signToken(privateKey, {
      sub: "user_dave",
      azv: 1,
      azs: [
        "sa|r2|Pr:shared_docs",
      ],
      suspended: true,
    }),
  };

  try {
    await runProxyTests(upstream.origin, tokens);
    await runEmbeddedTests(upstream.origin, tokens);
    console.log("integration test passed");
  } finally {
    await upstream.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
