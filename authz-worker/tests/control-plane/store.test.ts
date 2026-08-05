import { describe, expect, it } from "vitest";

import type { Binding, Group, GroupMember } from "../../src/control-plane/domain";
import {
  MemoryControlPlaneStore,
  resolveSubjectBindings,
  resolveSubjectGroups,
} from "../../src/control-plane/store";

const now = "2026-08-05T00:00:00.000Z";

describe("MemoryControlPlaneStore", () => {
  it("expands nested group membership and effective bindings", async () => {
    const store = new MemoryControlPlaneStore();
    const groups: Group[] = [
      { groupId: "contractors", scopeId: "project-a", name: "Contractors", createdAt: now, updatedAt: now },
      { groupId: "project-leads", scopeId: "project-a", name: "Project leads", createdAt: now, updatedAt: now },
    ];
    for (const group of groups) await store.putGroup(group);
    const members: GroupMember[] = [
      { groupId: "contractors", memberId: "user-bob", memberKind: "User", createdAt: now },
      { groupId: "project-leads", memberId: "contractors", memberKind: "Group", createdAt: now },
    ];
    for (const member of members) await store.putGroupMember(member);
    const binding: Binding = {
      bindingId: "binding-leads",
      scopeId: "project-a",
      subjectId: "project-leads",
      subjectKind: "Group",
      roleId: "project-manager",
      createdAt: now,
      updatedAt: now,
    };
    await store.putBinding(binding);

    expect(await resolveSubjectGroups(store, "project-a", "user-bob")).toEqual([
      "contractors",
      "project-leads",
    ]);
    expect(await resolveSubjectBindings(store, "project-a", "user-bob")).toEqual([binding]);
  });

  it("returns copies so callers cannot mutate persisted records", async () => {
    const store = new MemoryControlPlaneStore();
    const group: Group = {
      groupId: "ops-team",
      scopeId: "project-a",
      name: "Ops",
      createdAt: now,
      updatedAt: now,
    };
    await store.putGroup(group);
    const result = await store.getGroup(group.groupId);
    result!.name = "Changed";
    expect((await store.getGroup(group.groupId))?.name).toBe("Ops");
  });
});
