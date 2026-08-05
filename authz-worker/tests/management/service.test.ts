import { describe, expect, it } from "vitest";

import type { ServiceVocabulary } from "../../src/control-plane/domain";
import { MemoryManagementPublisher } from "../../src/management/publisher";
import { MemoryManagementRepository } from "../../src/management/repository";
import { ManagementError, ManagementService } from "../../src/management/service";

const at = "2026-08-05T12:00:00.000Z";
const now = () => Date.parse(at);

function vocabulary(): ServiceVocabulary {
  return {
    serviceId: "projects-api",
    version: 1,
    scopeTypes: [{ id: "organization" }, { id: "workspace" }, { id: "project" }],
    scopeHierarchy: [
      { parentType: "organization", childType: "workspace" },
      { parentType: "workspace", childType: "project" },
    ],
    resourceTypes: [{ id: "Project" }, { id: "PathObject" }],
    pathSpaces: [{ id: "files", anchorKind: "service" }, { id: "datasets", anchorKind: "service" }],
    actions: [
      { id: "readProject", targetKind: "resource", resourceType: "Project", permissionProfile: "object", permissionId: "read" },
      { id: "updateProject", targetKind: "resource", resourceType: "Project", permissionProfile: "object", permissionId: "update" },
      { id: "readFile", targetKind: "path", resourceType: "PathObject", pathSpace: "files", permissionProfile: "path", permissionId: "r" },
    ],
    permissionProfiles: [
      { id: "object", permissions: [{ id: "read" }, { id: "update" }, { id: "manage" }] },
      { id: "path", permissions: [{ id: "r" }, { id: "w" }] },
    ],
    roleTemplates: [
      { id: "viewer", name: "Viewer", grants: [{ targetKind: "resource", resourceType: "Project", permissionProfile: "object", permissionId: "read" }] },
      { id: "project-manager", name: "Project manager", grants: [
        { targetKind: "resource", resourceType: "Project", permissionProfile: "object", permissionId: "read" },
        { targetKind: "resource", resourceType: "Project", permissionProfile: "object", permissionId: "update" },
      ] },
    ],
    subjectKinds: ["User", "ServiceAccount", "Group"],
    claimConventions: { scopeReference: "claimId", authorizationClaim: "azs", authorizationVersion: 1 },
    updatedAt: at,
  };
}

async function setup() {
  const repository = new MemoryManagementRepository();
  const publisher = new MemoryManagementPublisher();
  let sequence = 0;
  const service = new ManagementService(repository, publisher, { now, id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
  await service.createService({ serviceId: "projects-api", name: "Projects", vocabulary: vocabulary() }, "admin");
  return { repository, publisher, service };
}

describe("ManagementService", () => {
  it("validates scopes and rejects unknown vocabulary concepts", async () => {
    const { service } = await setup();
    await expect(service.createScope({
      scopeId: "bad-scope", serviceId: "projects-api", scopeType: "unknown", name: "Bad", claimId: "bad",
    }, "admin")).rejects.toEqual(expect.objectContaining({ code: "vocabulary_violation", status: 422 }));
  });

  it("manages nested groups, previews claims, simulates, and publishes immutable artifacts", async () => {
    const { repository, publisher, service } = await setup();
    await service.importOpenApi("projects-api", {
      openapi: "3.1.0",
      info: { title: "Projects", version: "1" },
      paths: {
        "/projects/{projectId}": {
          get: { operationId: "getProject", "x-authz-action-id": "readProject", "x-authz-resource-type": "Project", "x-authz-permission-profile": "object", "x-authz-permission-id": "read" },
          put: { operationId: "putProject", "x-authz-action-id": "updateProject", "x-authz-resource-type": "Project", "x-authz-permission-profile": "object", "x-authz-permission-id": "update" },
        },
      },
    }, "admin");
    await service.putSubject({ subjectId: "user-alice", kind: "User", displayName: "Alice", status: "active" }, "admin");
    await service.createScope({ scopeId: "org-acme", serviceId: "projects-api", scopeType: "organization", name: "Acme", claimId: "oa" }, "admin");
    await service.createScope({ scopeId: "workspace-main", serviceId: "projects-api", scopeType: "workspace", name: "Main", parentScopeId: "org-acme", claimId: "wm" }, "admin");
    await service.createScope({ scopeId: "project-alpha", serviceId: "projects-api", scopeType: "project", name: "Alpha", parentScopeId: "workspace-main", claimId: "pa" }, "admin");
    await service.putGroup("project-alpha", { groupId: "ops-team", name: "Ops" }, "admin");
    await service.putGroup("project-alpha", { groupId: "project-leads", name: "Project leads" }, "admin");
    await service.putGroupMember("project-alpha", "ops-team", "user-alice", "User", "admin");
    await service.putGroupMember("project-alpha", "project-leads", "ops-team", "Group", "admin");
    await service.putBinding("project-alpha", {
      bindingId: "lead-binding", subjectId: "project-leads", subjectKind: "Group", roleId: "project-manager",
    }, "admin");
    await service.putPathGrant("project-alpha", {
      pathGrantId: "shared-docs", name: "shared-docs", pathSpace: "files", prefix: "shared/docs/", permissions: ["r"],
    }, "admin");
    await service.putBinding("project-alpha", {
      bindingId: "docs-binding", subjectId: "user-alice", subjectKind: "User",
      permissionProfile: "path", permissionId: "r", pathSpace: "files", namedPath: "shared-docs",
    }, "admin");

    expect(await service.claimPreview("projects-api", "user-alice")).toEqual({
      subjectId: "user-alice", serviceId: "projects-api", azv: 1,
      azs: ["pa|rproject-manager|gops-team,project-leads|Pr:files:shared-docs"],
    });
    expect(await service.simulate({ serviceId: "projects-api", scopeId: "project-alpha", subjectId: "user-alice", actionId: "updateProject" }))
      .toMatchObject({ decision: "allow", matchedBindingIds: ["lead-binding"] });

    const servicePublish = await service.publishService("projects-api", "admin", "svc-1");
    const scopePublish = await service.publishScope("project-alpha", "admin", "scope-1");
    expect(servicePublish.configKey).toBe("authz/projects-api/service/svc-1/config.json");
    expect(scopePublish.configKey).toBe("authz/projects-api/scopes/project-alpha/scope-1/config.yaml");
    expect(publisher.invalidations).toEqual([{ serviceId: "projects-api" }, { serviceId: "projects-api", scopeId: "project-alpha" }]);
    expect((await repository.listAudit("projects-api")).some((event) => event.action === "scope.publish")).toBe(true);
  });

  it("prevents cyclic nested groups", async () => {
    const { service } = await setup();
    await service.createScope({ scopeId: "project-alpha", serviceId: "projects-api", scopeType: "project", name: "Alpha", claimId: "pa" }, "admin");
    await service.putGroup("project-alpha", { groupId: "a-group", name: "A" }, "admin");
    await service.putGroup("project-alpha", { groupId: "b-group", name: "B" }, "admin");
    await service.putGroupMember("project-alpha", "a-group", "b-group", "Group", "admin");
    await expect(service.putGroupMember("project-alpha", "b-group", "a-group", "Group", "admin"))
      .rejects.toBeInstanceOf(ManagementError);
  });
});
