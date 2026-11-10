import type {
  AuditEvent,
  Binding,
  ConfigVersion,
  Group,
  GroupMember,
  ManagedService,
  PathGrant,
  Scope,
  Subject,
} from "./domain";

export interface ControlPlaneStore {
  getService(serviceId: string): Promise<ManagedService | undefined>;
  listServices(): Promise<ManagedService[]>;
  putService(service: ManagedService): Promise<void>;

  getSubject(subjectId: string): Promise<Subject | undefined>;
  listSubjects(): Promise<Subject[]>;
  putSubject(subject: Subject): Promise<void>;

  getScope(scopeId: string): Promise<Scope | undefined>;
  listScopes(serviceId: string): Promise<Scope[]>;
  putScope(scope: Scope): Promise<void>;

  getGroup(groupId: string): Promise<Group | undefined>;
  listGroups(scopeId: string): Promise<Group[]>;
  putGroup(group: Group): Promise<void>;
  deleteGroup(groupId: string): Promise<boolean>;
  listGroupMembers(scopeId: string): Promise<GroupMember[]>;
  putGroupMember(member: GroupMember): Promise<void>;
  deleteGroupMember(groupId: string, memberId: string): Promise<boolean>;

  listBindings(scopeId: string): Promise<Binding[]>;
  putBinding(binding: Binding): Promise<void>;
  deleteBinding(bindingId: string): Promise<boolean>;

  listPathGrants(scopeId: string): Promise<PathGrant[]>;
  putPathGrant(grant: PathGrant): Promise<void>;
  deletePathGrant(pathGrantId: string): Promise<boolean>;

  putConfigVersion(version: ConfigVersion): Promise<void>;
  listConfigVersions(serviceId: string, scopeId?: string): Promise<ConfigVersion[]>;
  appendAudit(event: AuditEvent): Promise<void>;
  listAudit(serviceId?: string): Promise<AuditEvent[]>;
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryControlPlaneStore implements ControlPlaneStore {
  private readonly services = new Map<string, ManagedService>();
  private readonly subjects = new Map<string, Subject>();
  private readonly scopes = new Map<string, Scope>();
  private readonly groups = new Map<string, Group>();
  private readonly members = new Map<string, GroupMember>();
  private readonly bindings = new Map<string, Binding>();
  private readonly pathGrants = new Map<string, PathGrant>();
  private readonly versions = new Map<string, ConfigVersion>();
  private readonly audit: AuditEvent[] = [];

  async getService(serviceId: string): Promise<ManagedService | undefined> {
    const value = this.services.get(serviceId);
    return value && copy(value);
  }

  async listServices(): Promise<ManagedService[]> {
    return [...this.services.values()].sort((a, b) => a.serviceId.localeCompare(b.serviceId)).map(copy);
  }

  async putService(service: ManagedService): Promise<void> {
    this.services.set(service.serviceId, copy(service));
  }

  async getSubject(subjectId: string): Promise<Subject | undefined> {
    const value = this.subjects.get(subjectId);
    return value && copy(value);
  }

  async listSubjects(): Promise<Subject[]> {
    return [...this.subjects.values()].sort((a, b) => a.subjectId.localeCompare(b.subjectId)).map(copy);
  }

  async putSubject(subject: Subject): Promise<void> {
    this.subjects.set(subject.subjectId, copy(subject));
  }

  async getScope(scopeId: string): Promise<Scope | undefined> {
    const value = this.scopes.get(scopeId);
    return value && copy(value);
  }

  async listScopes(serviceId: string): Promise<Scope[]> {
    return [...this.scopes.values()]
      .filter((scope) => scope.serviceId === serviceId)
      .sort((a, b) => a.scopeId.localeCompare(b.scopeId))
      .map(copy);
  }

  async putScope(scope: Scope): Promise<void> {
    this.scopes.set(scope.scopeId, copy(scope));
  }

  async getGroup(groupId: string): Promise<Group | undefined> {
    const value = this.groups.get(groupId);
    return value && copy(value);
  }

  async listGroups(scopeId: string): Promise<Group[]> {
    return [...this.groups.values()]
      .filter((group) => group.scopeId === scopeId)
      .sort((a, b) => a.groupId.localeCompare(b.groupId))
      .map(copy);
  }

  async putGroup(group: Group): Promise<void> {
    this.groups.set(group.groupId, copy(group));
  }

  async deleteGroup(groupId: string): Promise<boolean> {
    for (const [key, member] of this.members) {
      if (member.groupId === groupId || (member.memberKind === "Group" && member.memberId === groupId)) {
        this.members.delete(key);
      }
    }
    return this.groups.delete(groupId);
  }

  async listGroupMembers(scopeId: string): Promise<GroupMember[]> {
    const groupIds = new Set((await this.listGroups(scopeId)).map((group) => group.groupId));
    return [...this.members.values()]
      .filter((member) => groupIds.has(member.groupId))
      .sort((a, b) => `${a.groupId}:${a.memberId}`.localeCompare(`${b.groupId}:${b.memberId}`))
      .map(copy);
  }

  async putGroupMember(member: GroupMember): Promise<void> {
    this.members.set(`${member.groupId}:${member.memberId}`, copy(member));
  }

  async deleteGroupMember(groupId: string, memberId: string): Promise<boolean> {
    return this.members.delete(`${groupId}:${memberId}`);
  }

  async listBindings(scopeId: string): Promise<Binding[]> {
    return [...this.bindings.values()]
      .filter((binding) => binding.scopeId === scopeId)
      .sort((a, b) => a.bindingId.localeCompare(b.bindingId))
      .map(copy);
  }

  async putBinding(binding: Binding): Promise<void> {
    this.bindings.set(binding.bindingId, copy(binding));
  }

  async deleteBinding(bindingId: string): Promise<boolean> {
    return this.bindings.delete(bindingId);
  }

  async listPathGrants(scopeId: string): Promise<PathGrant[]> {
    return [...this.pathGrants.values()]
      .filter((grant) => grant.scopeId === scopeId)
      .sort((a, b) => a.pathGrantId.localeCompare(b.pathGrantId))
      .map(copy);
  }

  async putPathGrant(grant: PathGrant): Promise<void> {
    this.pathGrants.set(grant.pathGrantId, copy(grant));
  }

  async deletePathGrant(pathGrantId: string): Promise<boolean> {
    return this.pathGrants.delete(pathGrantId);
  }

  async putConfigVersion(version: ConfigVersion): Promise<void> {
    this.versions.set(`${version.scopeId ?? "service"}:${version.versionId}`, copy(version));
  }

  async listConfigVersions(serviceId: string, scopeId?: string): Promise<ConfigVersion[]> {
    return [...this.versions.values()]
      .filter((version) => version.serviceId === serviceId && version.scopeId === scopeId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(copy);
  }

  async appendAudit(event: AuditEvent): Promise<void> {
    this.audit.push(copy(event));
  }

  async listAudit(serviceId?: string): Promise<AuditEvent[]> {
    return this.audit
      .filter((event) => !serviceId || event.serviceId === serviceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(copy);
  }
}

export async function resolveSubjectGroups(
  store: ControlPlaneStore,
  scopeId: string,
  subjectId: string,
): Promise<string[]> {
  const members = await store.listGroupMembers(scopeId);
  const resolved = new Set<string>();
  let frontier = new Set([subjectId]);
  for (let depth = 0; depth < 16 && frontier.size > 0; depth += 1) {
    const next = new Set<string>();
    for (const member of members) {
      if (frontier.has(member.memberId) && !resolved.has(member.groupId)) {
        resolved.add(member.groupId);
        next.add(member.groupId);
      }
    }
    frontier = next;
  }
  return [...resolved].sort();
}

export async function resolveSubjectBindings(
  store: ControlPlaneStore,
  scopeId: string,
  subjectId: string,
): Promise<Binding[]> {
  const groupIds = new Set(await resolveSubjectGroups(store, scopeId, subjectId));
  return (await store.listBindings(scopeId)).filter(
    (binding) => binding.subjectId === subjectId || (binding.subjectKind === "Group" && groupIds.has(binding.subjectId)),
  );
}
