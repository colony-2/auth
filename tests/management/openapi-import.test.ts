import { describe, expect, it } from "vitest";

import { importOpenApiVocabulary } from "../../src/management/openapi-import";
import type { ServiceVocabulary } from "../../src/control-plane/domain";

const now = "2026-08-05T00:00:00.000Z";

function baseVocabulary(): ServiceVocabulary {
  return {
    serviceId: "projects-api",
    version: 1,
    scopeTypes: [{ id: "project" }],
    scopeHierarchy: [],
    resourceTypes: [],
    pathSpaces: [],
    actions: [],
    permissionProfiles: [
      { id: "object", permissions: [{ id: "read" }, { id: "update" }] },
      { id: "path", permissions: [{ id: "r" }, { id: "w" }] },
    ],
    roleTemplates: [{ id: "viewer", name: "Viewer", grants: [] }],
    subjectKinds: ["User", "ServiceAccount", "Group"],
    claimConventions: { scopeReference: "claimId", authorizationClaim: "azs", authorizationVersion: 1 },
    updatedAt: now,
  };
}

describe("OpenAPI vocabulary import", () => {
  it("derives actions, resources, path spaces, and runtime descriptors", () => {
    const result = importOpenApiVocabulary({
      openapi: "3.1.0",
      info: { title: "Projects", version: "1" },
      paths: {
        "/projects/{projectId}": {
          get: {
            operationId: "getProject",
            "x-authz-action-id": "readProject",
            "x-authz-resource-type": "Project",
            "x-authz-permission-profile": "object",
            "x-authz-permission-id": "read",
          },
        },
        "/files/{path+}": {
          get: {
            operationId: "readFile",
            "x-authz-target-kind": "path",
            "x-authz-resource-type": "PathObject",
            "x-authz-path-space": "files",
            "x-authz-path-param": "path",
            "x-authz-permission-profile": "path",
            "x-authz-permission-id": "r",
          },
        },
      },
    }, baseVocabulary(), now);

    expect(result.vocabulary.version).toBe(2);
    expect(result.vocabulary.resourceTypes.map((value) => value.id)).toEqual(["Project", "PathObject"]);
    expect(result.vocabulary.pathSpaces).toEqual([
      expect.objectContaining({ id: "files", anchorKind: "service" }),
    ]);
    expect(result.authDescriptor.operations).toEqual([
      expect.objectContaining({ operationId: "getProject", pathPattern: "^/projects/(?<projectId>[^/]+)$" }),
      expect.objectContaining({ operationId: "readFile", pathPattern: "^/files/(?<path>.+)$" }),
    ]);
  });
});
