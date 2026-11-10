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
} from "../control-plane/domain";
import type { ControlPlaneStore } from "../control-plane/store";
import { MemoryControlPlaneStore } from "../control-plane/store";

function json<T>(value: string | null, fallback: T): T {
  return value ? JSON.parse(value) as T : fallback;
}

function optional<T, K extends keyof T>(
  key: K,
  value: T[K] | null,
): Pick<T, K> | Record<string, never> {
  return value === null ? {} : { [key]: value } as Pick<T, K>;
}

export interface ServiceDraft {
  serviceId: string;
  openApiDocument?: unknown;
  authDescriptor?: unknown;
  schema?: unknown;
  snippets: Record<string, string>;
  globalPolicy?: string;
  namedPaths: Record<string, string | Record<string, string>>;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

export interface ScopeDraft {
  scopeId: string;
  includes: string[];
  policy?: string;
  namedPaths: Record<string, string | Record<string, string>>;
  staticEntities: unknown[];
  metadata: Record<string, unknown>;
  updatedAt: string;
}

export interface ManagementRepository extends ControlPlaneStore {
  getServiceDraft(serviceId: string): Promise<ServiceDraft | undefined>;
  putServiceDraft(draft: ServiceDraft): Promise<void>;
  getScopeDraft(scopeId: string): Promise<ScopeDraft | undefined>;
  putScopeDraft(draft: ScopeDraft): Promise<void>;
  updateServiceActiveVersion(serviceId: string, versionId: string, at: string): Promise<void>;
  updateScopeActiveVersion(scopeId: string, versionId: string, at: string): Promise<void>;
}

export class MemoryManagementRepository extends MemoryControlPlaneStore implements ManagementRepository {
  private readonly serviceDrafts = new Map<string, ServiceDraft>();
  private readonly scopeDrafts = new Map<string, ScopeDraft>();

  async getServiceDraft(serviceId: string): Promise<ServiceDraft | undefined> {
    const value = this.serviceDrafts.get(serviceId);
    return value && structuredClone(value);
  }

  async putServiceDraft(draft: ServiceDraft): Promise<void> {
    this.serviceDrafts.set(draft.serviceId, structuredClone(draft));
  }

  async getScopeDraft(scopeId: string): Promise<ScopeDraft | undefined> {
    const value = this.scopeDrafts.get(scopeId);
    return value && structuredClone(value);
  }

  async putScopeDraft(draft: ScopeDraft): Promise<void> {
    this.scopeDrafts.set(draft.scopeId, structuredClone(draft));
  }

  async updateServiceActiveVersion(serviceId: string, versionId: string, at: string): Promise<void> {
    const service = await this.getService(serviceId);
    if (!service) return;
    service.activeServiceVersion = versionId;
    service.updatedAt = at;
    await this.putService(service);
  }

  async updateScopeActiveVersion(scopeId: string, versionId: string, at: string): Promise<void> {
    const scope = await this.getScope(scopeId);
    if (!scope) return;
    scope.activeVersion = versionId;
    scope.updatedAt = at;
    await this.putScope(scope);
  }
}

interface ServiceRow {
  service_id: string;
  name: string;
  description: string | null;
  vocabulary_json: string;
  active_service_version: string | null;
  created_at: string;
  updated_at: string;
}

interface SubjectRow {
  subject_id: string;
  kind: Subject["kind"];
  display_name: string;
  email: string | null;
  status: Subject["status"];
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

interface ScopeRow {
  scope_id: string;
  service_id: string;
  scope_type: string;
  name: string;
  parent_scope_id: string | null;
  claim_id: string | null;
  active_version: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

interface GroupRow {
  group_id: string;
  scope_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  group_id: string;
  member_id: string;
  member_kind: GroupMember["memberKind"];
  created_at: string;
}

interface BindingRow {
  binding_id: string;
  scope_id: string;
  subject_id: string;
  subject_kind: Binding["subjectKind"];
  role_id: string | null;
  permission_profile: string | null;
  permission_id: string | null;
  resource_type: string | null;
  path_space: string | null;
  named_path: string | null;
  inline_path_prefix: string | null;
  created_at: string;
  updated_at: string;
}

interface PathGrantRow {
  path_grant_id: string;
  scope_id: string;
  name: string;
  path_space: string;
  prefix: string;
  permissions_json: string;
  anchor_resource_type: string | null;
  anchor_resource_id: string | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  version_id: string;
  service_id: string;
  scope_id?: string;
  artifact_key: string;
  artifact_json: string;
  status: ConfigVersion["status"];
  created_by: string;
  created_at: string;
  published_at: string | null;
}

interface AuditRow {
  event_id: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  service_id: string | null;
  scope_id: string | null;
  detail_json: string | null;
  created_at: string;
}

function mapService(row: ServiceRow): ManagedService {
  return {
    serviceId: row.service_id,
    name: row.name,
    ...optional<ManagedService, "description">("description", row.description),
    vocabulary: JSON.parse(row.vocabulary_json) as ManagedService["vocabulary"],
    ...optional<ManagedService, "activeServiceVersion">("activeServiceVersion", row.active_service_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSubject(row: SubjectRow): Subject {
  return {
    subjectId: row.subject_id,
    kind: row.kind,
    displayName: row.display_name,
    ...optional<Subject, "email">("email", row.email),
    status: row.status,
    ...(row.metadata_json ? { metadata: json(row.metadata_json, {}) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapScope(row: ScopeRow): Scope {
  return {
    scopeId: row.scope_id,
    serviceId: row.service_id,
    scopeType: row.scope_type,
    name: row.name,
    ...optional<Scope, "parentScopeId">("parentScopeId", row.parent_scope_id),
    ...optional<Scope, "claimId">("claimId", row.claim_id),
    ...optional<Scope, "activeVersion">("activeVersion", row.active_version),
    ...(row.metadata_json ? { metadata: json(row.metadata_json, {}) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapGroup(row: GroupRow): Group {
  return {
    groupId: row.group_id,
    scopeId: row.scope_id,
    name: row.name,
    ...optional<Group, "description">("description", row.description),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBinding(row: BindingRow): Binding {
  return {
    bindingId: row.binding_id,
    scopeId: row.scope_id,
    subjectId: row.subject_id,
    subjectKind: row.subject_kind,
    ...optional<Binding, "roleId">("roleId", row.role_id),
    ...optional<Binding, "permissionProfile">("permissionProfile", row.permission_profile),
    ...optional<Binding, "permissionId">("permissionId", row.permission_id),
    ...optional<Binding, "resourceType">("resourceType", row.resource_type),
    ...optional<Binding, "pathSpace">("pathSpace", row.path_space),
    ...optional<Binding, "namedPath">("namedPath", row.named_path),
    ...optional<Binding, "inlinePathPrefix">("inlinePathPrefix", row.inline_path_prefix),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapGrant(row: PathGrantRow): PathGrant {
  return {
    pathGrantId: row.path_grant_id,
    scopeId: row.scope_id,
    name: row.name,
    pathSpace: row.path_space,
    prefix: row.prefix,
    permissions: json<string[]>(row.permissions_json, []),
    ...optional<PathGrant, "anchorResourceType">("anchorResourceType", row.anchor_resource_type),
    ...optional<PathGrant, "anchorResourceId">("anchorResourceId", row.anchor_resource_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVersion(row: VersionRow): ConfigVersion {
  return {
    versionId: row.version_id,
    serviceId: row.service_id,
    ...(row.scope_id ? { scopeId: row.scope_id } : {}),
    artifactKey: row.artifact_key,
    artifact: JSON.parse(row.artifact_json) as unknown,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    ...optional<ConfigVersion, "publishedAt">("publishedAt", row.published_at),
  };
}

export class D1ManagementRepository implements ManagementRepository {
  constructor(private readonly db: D1Database) {}

  async getService(id: string): Promise<ManagedService | undefined> {
    const row = await this.db.prepare("SELECT * FROM services WHERE service_id = ?").bind(id).first<ServiceRow>();
    return row ? mapService(row) : undefined;
  }

  async listServices(): Promise<ManagedService[]> {
    return (await this.db.prepare("SELECT * FROM services ORDER BY service_id").all<ServiceRow>()).results.map(mapService);
  }

  async putService(value: ManagedService): Promise<void> {
    await this.db.prepare(`INSERT INTO services
      (service_id, name, description, vocabulary_json, vocabulary_version, active_service_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(service_id) DO UPDATE SET name=excluded.name, description=excluded.description,
      vocabulary_json=excluded.vocabulary_json, vocabulary_version=excluded.vocabulary_version,
      active_service_version=excluded.active_service_version, updated_at=excluded.updated_at`).bind(
      value.serviceId, value.name, value.description ?? null, JSON.stringify(value.vocabulary), value.vocabulary.version,
      value.activeServiceVersion ?? null, value.createdAt, value.updatedAt,
    ).run();
  }

  async getSubject(id: string): Promise<Subject | undefined> {
    const row = await this.db.prepare("SELECT * FROM subjects WHERE subject_id = ?").bind(id).first<SubjectRow>();
    return row ? mapSubject(row) : undefined;
  }

  async listSubjects(): Promise<Subject[]> {
    return (await this.db.prepare("SELECT * FROM subjects ORDER BY subject_id").all<SubjectRow>()).results.map(mapSubject);
  }

  async putSubject(value: Subject): Promise<void> {
    await this.db.prepare(`INSERT INTO subjects
      (subject_id, kind, display_name, email, status, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(subject_id) DO UPDATE SET display_name=excluded.display_name, email=excluded.email,
      status=excluded.status, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`).bind(
      value.subjectId, value.kind, value.displayName, value.email ?? null, value.status,
      value.metadata ? JSON.stringify(value.metadata) : null, value.createdAt, value.updatedAt,
    ).run();
  }

  async getScope(id: string): Promise<Scope | undefined> {
    const row = await this.db.prepare("SELECT * FROM scopes WHERE scope_id = ?").bind(id).first<ScopeRow>();
    return row ? mapScope(row) : undefined;
  }

  async listScopes(serviceId: string): Promise<Scope[]> {
    return (await this.db.prepare("SELECT * FROM scopes WHERE service_id = ? ORDER BY scope_id").bind(serviceId).all<ScopeRow>()).results.map(mapScope);
  }

  async putScope(value: Scope): Promise<void> {
    await this.db.prepare(`INSERT INTO scopes
      (scope_id, service_id, scope_type, name, parent_scope_id, claim_id, active_version, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_id) DO UPDATE SET scope_type=excluded.scope_type, name=excluded.name,
      parent_scope_id=excluded.parent_scope_id, claim_id=excluded.claim_id,
      active_version=excluded.active_version, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`).bind(
      value.scopeId, value.serviceId, value.scopeType, value.name, value.parentScopeId ?? null,
      value.claimId ?? null, value.activeVersion ?? null, value.metadata ? JSON.stringify(value.metadata) : null,
      value.createdAt, value.updatedAt,
    ).run();
  }

  async getGroup(id: string): Promise<Group | undefined> {
    const row = await this.db.prepare("SELECT * FROM scope_groups WHERE group_id = ?").bind(id).first<GroupRow>();
    return row ? mapGroup(row) : undefined;
  }

  async listGroups(scopeId: string): Promise<Group[]> {
    return (await this.db.prepare("SELECT * FROM scope_groups WHERE scope_id = ? ORDER BY group_id").bind(scopeId).all<GroupRow>()).results.map(mapGroup);
  }

  async putGroup(value: Group): Promise<void> {
    await this.db.prepare(`INSERT INTO scope_groups (group_id, scope_id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(group_id) DO UPDATE SET name=excluded.name,
      description=excluded.description, updated_at=excluded.updated_at`).bind(
      value.groupId, value.scopeId, value.name, value.description ?? null, value.createdAt, value.updatedAt,
    ).run();
  }

  async deleteGroup(id: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM scope_groups WHERE group_id = ?").bind(id).run();
    return (result.meta.changes ?? 0) > 0;
  }

  async listGroupMembers(scopeId: string): Promise<GroupMember[]> {
    const rows = await this.db.prepare(`SELECT gm.* FROM group_members gm
      JOIN scope_groups sg ON sg.group_id = gm.group_id WHERE sg.scope_id = ?
      ORDER BY gm.group_id, gm.member_id`).bind(scopeId).all<MemberRow>();
    return rows.results.map((row) => ({ groupId: row.group_id, memberId: row.member_id, memberKind: row.member_kind, createdAt: row.created_at }));
  }

  async putGroupMember(value: GroupMember): Promise<void> {
    await this.db.prepare(`INSERT INTO group_members (group_id, member_id, member_kind, created_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(group_id, member_id) DO UPDATE SET member_kind=excluded.member_kind`).bind(
      value.groupId, value.memberId, value.memberKind, value.createdAt,
    ).run();
  }

  async deleteGroupMember(groupId: string, memberId: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM group_members WHERE group_id = ? AND member_id = ?").bind(groupId, memberId).run();
    return (result.meta.changes ?? 0) > 0;
  }

  async listBindings(scopeId: string): Promise<Binding[]> {
    return (await this.db.prepare("SELECT * FROM bindings WHERE scope_id = ? ORDER BY binding_id").bind(scopeId).all<BindingRow>()).results.map(mapBinding);
  }

  async putBinding(value: Binding): Promise<void> {
    await this.db.prepare(`INSERT INTO bindings
      (binding_id, scope_id, subject_id, subject_kind, role_id, permission_profile, permission_id,
       resource_type, path_space, named_path, inline_path_prefix, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(binding_id) DO UPDATE SET subject_id=excluded.subject_id, subject_kind=excluded.subject_kind,
      role_id=excluded.role_id, permission_profile=excluded.permission_profile, permission_id=excluded.permission_id,
      resource_type=excluded.resource_type, path_space=excluded.path_space, named_path=excluded.named_path,
      inline_path_prefix=excluded.inline_path_prefix, updated_at=excluded.updated_at`).bind(
      value.bindingId, value.scopeId, value.subjectId, value.subjectKind, value.roleId ?? null,
      value.permissionProfile ?? null, value.permissionId ?? null, value.resourceType ?? null,
      value.pathSpace ?? null, value.namedPath ?? null, value.inlinePathPrefix ?? null,
      value.createdAt, value.updatedAt,
    ).run();
  }

  async deleteBinding(id: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM bindings WHERE binding_id = ?").bind(id).run();
    return (result.meta.changes ?? 0) > 0;
  }

  async listPathGrants(scopeId: string): Promise<PathGrant[]> {
    return (await this.db.prepare("SELECT * FROM path_grants WHERE scope_id = ? ORDER BY path_grant_id").bind(scopeId).all<PathGrantRow>()).results.map(mapGrant);
  }

  async putPathGrant(value: PathGrant): Promise<void> {
    await this.db.prepare(`INSERT INTO path_grants
      (path_grant_id, scope_id, name, path_space, prefix, permissions_json, anchor_resource_type,
       anchor_resource_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path_grant_id) DO UPDATE SET name=excluded.name, path_space=excluded.path_space,
      prefix=excluded.prefix, permissions_json=excluded.permissions_json,
      anchor_resource_type=excluded.anchor_resource_type, anchor_resource_id=excluded.anchor_resource_id,
      updated_at=excluded.updated_at`).bind(
      value.pathGrantId, value.scopeId, value.name, value.pathSpace, value.prefix,
      JSON.stringify(value.permissions), value.anchorResourceType ?? null, value.anchorResourceId ?? null,
      value.createdAt, value.updatedAt,
    ).run();
  }

  async deletePathGrant(id: string): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM path_grants WHERE path_grant_id = ?").bind(id).run();
    return (result.meta.changes ?? 0) > 0;
  }

  async putConfigVersion(value: ConfigVersion): Promise<void> {
    const table = value.scopeId ? "scope_config_versions" : "service_config_versions";
    const columns = value.scopeId
      ? "version_id, service_id, scope_id, artifact_key, artifact_json, status, created_by, created_at, published_at"
      : "version_id, service_id, artifact_key, artifact_json, status, created_by, created_at, published_at";
    const placeholders = value.scopeId ? "?, ?, ?, ?, ?, ?, ?, ?, ?" : "?, ?, ?, ?, ?, ?, ?, ?";
    const values = value.scopeId
      ? [value.versionId, value.serviceId, value.scopeId, value.artifactKey, JSON.stringify(value.artifact), value.status, value.createdBy, value.createdAt, value.publishedAt ?? null]
      : [value.versionId, value.serviceId, value.artifactKey, JSON.stringify(value.artifact), value.status, value.createdBy, value.createdAt, value.publishedAt ?? null];
    await this.db.prepare(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`).bind(...values).run();
  }

  async listConfigVersions(serviceId: string, scopeId?: string): Promise<ConfigVersion[]> {
    const table = scopeId ? "scope_config_versions" : "service_config_versions";
    const statement = scopeId
      ? this.db.prepare(`SELECT * FROM ${table} WHERE service_id = ? AND scope_id = ? ORDER BY created_at DESC`).bind(serviceId, scopeId)
      : this.db.prepare(`SELECT * FROM ${table} WHERE service_id = ? ORDER BY created_at DESC`).bind(serviceId);
    return (await statement.all<VersionRow>()).results.map(mapVersion);
  }

  async appendAudit(value: AuditEvent): Promise<void> {
    await this.db.prepare(`INSERT INTO audit_events
      (event_id, actor_id, action, target_type, target_id, service_id, scope_id, detail_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      value.eventId, value.actorId, value.action, value.targetType, value.targetId,
      value.serviceId ?? null, value.scopeId ?? null, value.detail ? JSON.stringify(value.detail) : null, value.createdAt,
    ).run();
  }

  async listAudit(serviceId?: string): Promise<AuditEvent[]> {
    const statement = serviceId
      ? this.db.prepare("SELECT * FROM audit_events WHERE service_id = ? ORDER BY sequence DESC LIMIT 200").bind(serviceId)
      : this.db.prepare("SELECT * FROM audit_events ORDER BY sequence DESC LIMIT 200");
    return (await statement.all<AuditRow>()).results.map((row) => ({
      eventId: row.event_id, actorId: row.actor_id, action: row.action, targetType: row.target_type,
      targetId: row.target_id, ...optional<AuditEvent, "serviceId">("serviceId", row.service_id),
      ...optional<AuditEvent, "scopeId">("scopeId", row.scope_id),
      ...(row.detail_json ? { detail: json(row.detail_json, {}) } : {}), createdAt: row.created_at,
    }));
  }

  async getServiceDraft(serviceId: string): Promise<ServiceDraft | undefined> {
    const row = await this.db.prepare("SELECT * FROM service_drafts WHERE service_id = ?").bind(serviceId).first<{
      service_id: string; openapi_json: string | null; auth_descriptor_json: string | null; schema_json: string | null;
      snippets_json: string; global_policy: string | null; named_paths_json: string; metadata_json: string; updated_at: string;
    }>();
    return row ? {
      serviceId: row.service_id, ...(row.openapi_json ? { openApiDocument: JSON.parse(row.openapi_json) as unknown } : {}),
      ...(row.auth_descriptor_json ? { authDescriptor: JSON.parse(row.auth_descriptor_json) as unknown } : {}),
      ...(row.schema_json ? { schema: JSON.parse(row.schema_json) as unknown } : {}), snippets: json(row.snippets_json, {}),
      ...optional<ServiceDraft, "globalPolicy">("globalPolicy", row.global_policy), namedPaths: json(row.named_paths_json, {}),
      metadata: json(row.metadata_json, {}), updatedAt: row.updated_at,
    } : undefined;
  }

  async putServiceDraft(value: ServiceDraft): Promise<void> {
    await this.db.prepare(`INSERT INTO service_drafts
      (service_id, openapi_json, auth_descriptor_json, schema_json, snippets_json, global_policy, named_paths_json, metadata_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(service_id) DO UPDATE SET
      openapi_json=excluded.openapi_json, auth_descriptor_json=excluded.auth_descriptor_json,
      schema_json=excluded.schema_json, snippets_json=excluded.snippets_json, global_policy=excluded.global_policy,
      named_paths_json=excluded.named_paths_json, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`).bind(
      value.serviceId, value.openApiDocument ? JSON.stringify(value.openApiDocument) : null,
      value.authDescriptor ? JSON.stringify(value.authDescriptor) : null, value.schema ? JSON.stringify(value.schema) : null,
      JSON.stringify(value.snippets), value.globalPolicy ?? null, JSON.stringify(value.namedPaths),
      JSON.stringify(value.metadata), value.updatedAt,
    ).run();
  }

  async getScopeDraft(scopeId: string): Promise<ScopeDraft | undefined> {
    const row = await this.db.prepare("SELECT * FROM scope_drafts WHERE scope_id = ?").bind(scopeId).first<{
      scope_id: string; includes_json: string; policy: string | null; named_paths_json: string;
      static_entities_json: string; metadata_json: string; updated_at: string;
    }>();
    return row ? { scopeId: row.scope_id, includes: json(row.includes_json, []),
      ...optional<ScopeDraft, "policy">("policy", row.policy), namedPaths: json(row.named_paths_json, {}),
      staticEntities: json(row.static_entities_json, []), metadata: json(row.metadata_json, {}), updatedAt: row.updated_at } : undefined;
  }

  async putScopeDraft(value: ScopeDraft): Promise<void> {
    await this.db.prepare(`INSERT INTO scope_drafts
      (scope_id, includes_json, policy, named_paths_json, static_entities_json, metadata_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(scope_id) DO UPDATE SET includes_json=excluded.includes_json,
      policy=excluded.policy, named_paths_json=excluded.named_paths_json,
      static_entities_json=excluded.static_entities_json, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`).bind(
      value.scopeId, JSON.stringify(value.includes), value.policy ?? null, JSON.stringify(value.namedPaths),
      JSON.stringify(value.staticEntities), JSON.stringify(value.metadata), value.updatedAt,
    ).run();
  }

  async updateServiceActiveVersion(serviceId: string, versionId: string, at: string): Promise<void> {
    await this.db.prepare("UPDATE services SET active_service_version = ?, updated_at = ? WHERE service_id = ?").bind(versionId, at, serviceId).run();
  }

  async updateScopeActiveVersion(scopeId: string, versionId: string, at: string): Promise<void> {
    await this.db.prepare("UPDATE scopes SET active_version = ?, updated_at = ? WHERE scope_id = ?").bind(versionId, at, scopeId).run();
  }
}
