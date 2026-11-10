import { describe, expect, it } from "vitest";

import type { GroupMember, ServiceVocabulary } from "../../src/control-plane/domain";
import { validateGroupGraph, validateVocabulary } from "../../src/control-plane/validation";

function vocabulary(): ServiceVocabulary {
  return {
    serviceId: "projects-api",
    version: 1,
    scopeTypes: [{ id: "organization" }, { id: "workspace" }, { id: "project" }],
    scopeHierarchy: [
      { parentType: "organization", childType: "workspace" },
      { parentType: "workspace", childType: "project" },
    ],
    resourceTypes: [{ id: "Project", scopeTypes: ["project"] }, { id: "PathObject" }],
    pathSpaces: [
      { id: "files", anchorKind: "service", routePattern: "/files/{path+}" },
      { id: "project-files", anchorKind: "resource", resourceType: "Project" },
    ],
    permissionProfiles: [
      { id: "object", permissions: [{ id: "read" }, { id: "update" }] },
      { id: "path", permissions: [{ id: "r" }, { id: "w" }] },
    ],
    actions: [
      {
        id: "readProject",
        targetKind: "resource",
        resourceType: "Project",
        permissionProfile: "object",
        permissionId: "read",
      },
    ],
    roleTemplates: [
      {
        id: "viewer",
        name: "Viewer",
        grants: [
          {
            targetKind: "resource",
            resourceType: "Project",
            permissionProfile: "object",
            permissionId: "read",
          },
        ],
      },
    ],
    subjectKinds: ["User", "ServiceAccount", "Group"],
    claimConventions: {
      scopeReference: "claimId",
      authorizationClaim: "azs",
      authorizationVersion: 1,
    },
    updatedAt: "2026-08-05T00:00:00.000Z",
  };
}

describe("validateVocabulary", () => {
  it("accepts a coherent service vocabulary", () => {
    expect(validateVocabulary(vocabulary())).toEqual([]);
  });

  it("rejects unknown references and hierarchy cycles", () => {
    const value = vocabulary();
    value.scopeHierarchy.push({ parentType: "project", childType: "organization" });
    value.actions[0]!.permissionId = "delete";
    value.pathSpaces[1]!.resourceType = "Missing";

    const issues = validateVocabulary(value);
    expect(issues.map((issue) => issue.code)).toContain("cycle");
    expect(issues.some((issue) => issue.path.endsWith("permissionId"))).toBe(true);
    expect(issues.some((issue) => issue.path.endsWith("resourceType"))).toBe(true);
  });
});

describe("validateGroupGraph", () => {
  it("rejects nested group cycles", () => {
    const members: GroupMember[] = [
      { groupId: "ops-team", memberId: "project-leads", memberKind: "Group", createdAt: "now" },
      { groupId: "project-leads", memberId: "ops-team", memberKind: "Group", createdAt: "now" },
    ];
    expect(validateGroupGraph(members)).toEqual([
      expect.objectContaining({ code: "cycle" }),
    ]);
  });
});
