export type SubjectKind = "User" | "ServiceAccount" | "Group";
export type SubjectStatus = "active" | "suspended" | "disabled";
export type TargetKind = "scope" | "resource" | "path";
export type PathAnchorKind = "service" | "resource";

export interface ScopeTypeDefinition {
  id: string;
  name?: string;
  description?: string;
}

export interface ScopeHierarchyEdge {
  parentType: string;
  childType: string;
}

export interface ResourceTypeDefinition {
  id: string;
  name?: string;
  scopeTypes?: string[];
}

export interface PathSpaceDefinition {
  id: string;
  name?: string;
  anchorKind: PathAnchorKind;
  resourceType?: string;
  routePattern?: string;
}

export interface ActionDefinition {
  id: string;
  name?: string;
  targetKind: TargetKind;
  resourceType?: string;
  pathSpace?: string;
  permissionProfile: string;
  permissionId: string;
  operations?: Array<{ method: string; path: string; operationId?: string }>;
}

export interface PermissionProfileDefinition {
  id: string;
  name?: string;
  permissions: Array<{ id: string; name?: string }>;
}

export interface RoleGrantDefinition {
  permissionProfile: string;
  permissionId: string;
  targetKind: TargetKind;
  resourceType?: string;
  pathSpace?: string;
}

export interface RoleTemplateDefinition {
  id: string;
  name: string;
  description?: string;
  grants: RoleGrantDefinition[];
}

export interface ClaimConventions {
  scopeReference: "scopeId" | "claimId";
  authorizationClaim: "azs";
  authorizationVersion: 1;
}

export interface ServiceVocabulary {
  serviceId: string;
  version: number;
  scopeTypes: ScopeTypeDefinition[];
  scopeHierarchy: ScopeHierarchyEdge[];
  resourceTypes: ResourceTypeDefinition[];
  pathSpaces: PathSpaceDefinition[];
  actions: ActionDefinition[];
  permissionProfiles: PermissionProfileDefinition[];
  roleTemplates: RoleTemplateDefinition[];
  subjectKinds: SubjectKind[];
  claimConventions: ClaimConventions;
  updatedAt: string;
}

export interface ManagedService {
  serviceId: string;
  name: string;
  description?: string;
  vocabulary: ServiceVocabulary;
  activeServiceVersion?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Subject {
  subjectId: string;
  kind: Exclude<SubjectKind, "Group">;
  displayName: string;
  email?: string;
  status: SubjectStatus;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Scope {
  scopeId: string;
  serviceId: string;
  scopeType: string;
  name: string;
  parentScopeId?: string;
  claimId?: string;
  activeVersion?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Group {
  groupId: string;
  scopeId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  groupId: string;
  memberId: string;
  memberKind: SubjectKind;
  createdAt: string;
}

export interface Binding {
  bindingId: string;
  scopeId: string;
  subjectId: string;
  subjectKind: SubjectKind;
  roleId?: string;
  permissionProfile?: string;
  permissionId?: string;
  resourceType?: string;
  pathSpace?: string;
  namedPath?: string;
  inlinePathPrefix?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PathGrant {
  pathGrantId: string;
  scopeId: string;
  name: string;
  pathSpace: string;
  prefix: string;
  permissions: string[];
  anchorResourceType?: string;
  anchorResourceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigVersion {
  versionId: string;
  serviceId: string;
  scopeId?: string;
  artifactKey: string;
  artifact: unknown;
  status: "draft" | "pending" | "published" | "rejected" | "superseded";
  createdBy: string;
  createdAt: string;
  publishedAt?: string;
}

export interface AuditEvent {
  eventId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  serviceId?: string;
  scopeId?: string;
  detail?: Record<string, unknown>;
  createdAt: string;
}

export interface ListOptions {
  limit?: number;
  cursor?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export const DEFAULT_CLAIM_CONVENTIONS: ClaimConventions = {
  scopeReference: "claimId",
  authorizationClaim: "azs",
  authorizationVersion: 1,
};
