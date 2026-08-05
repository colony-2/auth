import type {
  Binding,
  GroupMember,
  PathGrant,
  Scope,
  ServiceVocabulary,
} from "./domain";

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export class DomainValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "DomainValidationError";
    this.issues = issues;
  }
}

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;

function requiredIdentifier(value: string, path: string, issues: ValidationIssue[]): void {
  if (!IDENTIFIER.test(value)) {
    issues.push({
      path,
      code: "invalid_identifier",
      message: "must start with a letter and contain only letters, digits, '.', '_' or '-'",
    });
  }
}

function uniqueIds(
  values: Array<{ id: string }>,
  path: string,
  issues: ValidationIssue[],
): Set<string> {
  const ids = new Set<string>();
  values.forEach((value, index) => {
    requiredIdentifier(value.id, `${path}/${index}/id`, issues);
    if (ids.has(value.id)) {
      issues.push({ path: `${path}/${index}/id`, code: "duplicate", message: `duplicate id '${value.id}'` });
    }
    ids.add(value.id);
  });
  return ids;
}

export function validateVocabulary(vocabulary: ServiceVocabulary): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  requiredIdentifier(vocabulary.serviceId, "/serviceId", issues);
  if (!Number.isInteger(vocabulary.version) || vocabulary.version < 1) {
    issues.push({ path: "/version", code: "invalid_version", message: "must be a positive integer" });
  }

  const scopeTypes = uniqueIds(vocabulary.scopeTypes, "/scopeTypes", issues);
  const resources = uniqueIds(vocabulary.resourceTypes, "/resourceTypes", issues);
  const pathSpaces = uniqueIds(vocabulary.pathSpaces, "/pathSpaces", issues);
  const profiles = uniqueIds(vocabulary.permissionProfiles, "/permissionProfiles", issues);
  const roles = uniqueIds(vocabulary.roleTemplates, "/roleTemplates", issues);
  uniqueIds(vocabulary.actions, "/actions", issues);

  if (vocabulary.subjectKinds.length === 0) {
    issues.push({ path: "/subjectKinds", code: "required", message: "at least one subject kind is required" });
  }
  if (new Set(vocabulary.subjectKinds).size !== vocabulary.subjectKinds.length) {
    issues.push({ path: "/subjectKinds", code: "duplicate", message: "subject kinds must be unique" });
  }

  vocabulary.scopeHierarchy.forEach((edge, index) => {
    if (!scopeTypes.has(edge.parentType)) {
      issues.push({ path: `/scopeHierarchy/${index}/parentType`, code: "unknown_reference", message: "unknown scope type" });
    }
    if (!scopeTypes.has(edge.childType)) {
      issues.push({ path: `/scopeHierarchy/${index}/childType`, code: "unknown_reference", message: "unknown scope type" });
    }
    if (edge.parentType === edge.childType) {
      issues.push({ path: `/scopeHierarchy/${index}`, code: "cycle", message: "a scope type cannot contain itself" });
    }
  });

  const hierarchy = new Map<string, string[]>();
  for (const edge of vocabulary.scopeHierarchy) {
    hierarchy.set(edge.parentType, [...(hierarchy.get(edge.parentType) ?? []), edge.childType]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const cyclic = (hierarchy.get(id) ?? []).some(visit);
    visiting.delete(id);
    visited.add(id);
    return cyclic;
  };
  if ([...scopeTypes].some(visit)) {
    issues.push({ path: "/scopeHierarchy", code: "cycle", message: "scope hierarchy must be acyclic" });
  }

  vocabulary.resourceTypes.forEach((resource, index) => {
    resource.scopeTypes?.forEach((scopeType, scopeIndex) => {
      if (!scopeTypes.has(scopeType)) {
        issues.push({ path: `/resourceTypes/${index}/scopeTypes/${scopeIndex}`, code: "unknown_reference", message: "unknown scope type" });
      }
    });
  });

  vocabulary.pathSpaces.forEach((space, index) => {
    if (space.anchorKind === "resource" && !space.resourceType) {
      issues.push({ path: `/pathSpaces/${index}/resourceType`, code: "required", message: "resource-anchored path spaces require a resource type" });
    }
    if (space.resourceType && !resources.has(space.resourceType)) {
      issues.push({ path: `/pathSpaces/${index}/resourceType`, code: "unknown_reference", message: "unknown resource type" });
    }
  });

  const permissionIds = new Map<string, Set<string>>();
  vocabulary.permissionProfiles.forEach((profile, index) => {
    const ids = uniqueIds(profile.permissions, `/permissionProfiles/${index}/permissions`, issues);
    permissionIds.set(profile.id, ids);
  });

  const validateGrant = (
    grant: { permissionProfile: string; permissionId: string; targetKind: string; resourceType?: string; pathSpace?: string },
    path: string,
  ): void => {
    if (!profiles.has(grant.permissionProfile)) {
      issues.push({ path: `${path}/permissionProfile`, code: "unknown_reference", message: "unknown permission profile" });
    } else if (!permissionIds.get(grant.permissionProfile)?.has(grant.permissionId)) {
      issues.push({ path: `${path}/permissionId`, code: "unknown_reference", message: "unknown permission id" });
    }
    if (grant.resourceType && !resources.has(grant.resourceType)) {
      issues.push({ path: `${path}/resourceType`, code: "unknown_reference", message: "unknown resource type" });
    }
    if (grant.pathSpace && !pathSpaces.has(grant.pathSpace)) {
      issues.push({ path: `${path}/pathSpace`, code: "unknown_reference", message: "unknown path space" });
    }
    if (grant.targetKind === "path" && !grant.pathSpace) {
      issues.push({ path: `${path}/pathSpace`, code: "required", message: "path grants require a path space" });
    }
  };

  vocabulary.actions.forEach((action, index) => validateGrant(action, `/actions/${index}`));
  vocabulary.roleTemplates.forEach((role, roleIndex) => {
    role.grants.forEach((grant, grantIndex) => validateGrant(grant, `/roleTemplates/${roleIndex}/grants/${grantIndex}`));
  });

  if (!roles.size) {
    issues.push({ path: "/roleTemplates", code: "required", message: "at least one role template is required" });
  }
  if (vocabulary.claimConventions.authorizationClaim !== "azs" || vocabulary.claimConventions.authorizationVersion !== 1) {
    issues.push({ path: "/claimConventions", code: "unsupported", message: "only compact azs version 1 is supported" });
  }
  return issues;
}

export function assertValidVocabulary(vocabulary: ServiceVocabulary): void {
  const issues = validateVocabulary(vocabulary);
  if (issues.length) throw new DomainValidationError(issues);
}

export function validateScope(scope: Scope, vocabulary: ServiceVocabulary, parent?: Scope): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (scope.serviceId !== vocabulary.serviceId) {
    issues.push({ path: "/serviceId", code: "service_mismatch", message: "scope must belong to the vocabulary service" });
  }
  if (!vocabulary.scopeTypes.some((candidate) => candidate.id === scope.scopeType)) {
    issues.push({ path: "/scopeType", code: "unknown_reference", message: "unknown scope type" });
  }
  if (scope.parentScopeId && !parent) {
    issues.push({ path: "/parentScopeId", code: "unknown_reference", message: "parent scope does not exist" });
  }
  if (parent) {
    if (parent.serviceId !== scope.serviceId) {
      issues.push({ path: "/parentScopeId", code: "service_mismatch", message: "parent must belong to the same service" });
    }
    const allowed = vocabulary.scopeHierarchy.some(
      (edge) => edge.parentType === parent.scopeType && edge.childType === scope.scopeType,
    );
    if (!allowed) {
      issues.push({ path: "/parentScopeId", code: "invalid_hierarchy", message: `'${parent.scopeType}' cannot contain '${scope.scopeType}'` });
    }
  }
  if (vocabulary.claimConventions.scopeReference === "claimId" && !scope.claimId) {
    issues.push({ path: "/claimId", code: "required", message: "claimId is required by this service's claim conventions" });
  }
  return issues;
}

export function validateBinding(binding: Binding, vocabulary: ServiceVocabulary): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!vocabulary.subjectKinds.includes(binding.subjectKind)) {
    issues.push({ path: "/subjectKind", code: "unknown_reference", message: "subject kind is not allowed" });
  }
  if (!binding.roleId && !(binding.permissionProfile && binding.permissionId)) {
    issues.push({ path: "/", code: "required", message: "a role or direct permission is required" });
  }
  if (binding.roleId && !vocabulary.roleTemplates.some((role) => role.id === binding.roleId)) {
    issues.push({ path: "/roleId", code: "unknown_reference", message: "unknown role template" });
  }
  if (binding.permissionProfile) {
    const profile = vocabulary.permissionProfiles.find((candidate) => candidate.id === binding.permissionProfile);
    if (!profile) {
      issues.push({ path: "/permissionProfile", code: "unknown_reference", message: "unknown permission profile" });
    } else if (!binding.permissionId || !profile.permissions.some((permission) => permission.id === binding.permissionId)) {
      issues.push({ path: "/permissionId", code: "unknown_reference", message: "unknown permission id" });
    }
  }
  if (binding.pathSpace && !vocabulary.pathSpaces.some((space) => space.id === binding.pathSpace)) {
    issues.push({ path: "/pathSpace", code: "unknown_reference", message: "unknown path space" });
  }
  return issues;
}

export function validatePathGrant(grant: PathGrant, vocabulary: ServiceVocabulary): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pathSpace = vocabulary.pathSpaces.find((space) => space.id === grant.pathSpace);
  if (!pathSpace) {
    issues.push({ path: "/pathSpace", code: "unknown_reference", message: "unknown path space" });
  }
  if (!grant.prefix || grant.prefix.startsWith("/") || grant.prefix.includes("..")) {
    issues.push({ path: "/prefix", code: "invalid_path", message: "prefix must be relative and cannot contain '..'" });
  }
  const pathPermissions = vocabulary.permissionProfiles.find((profile) => profile.id === "path")?.permissions ?? [];
  for (const permission of grant.permissions) {
    if (!pathPermissions.some((candidate) => candidate.id === permission)) {
      issues.push({ path: "/permissions", code: "unknown_reference", message: `unknown path permission '${permission}'` });
    }
  }
  if (pathSpace?.anchorKind === "resource" && (!grant.anchorResourceType || !grant.anchorResourceId)) {
    issues.push({ path: "/anchorResourceId", code: "required", message: "resource-anchored grants require a resource type and id" });
  }
  return issues;
}

export function validateGroupGraph(members: GroupMember[]): ValidationIssue[] {
  const edges = new Map<string, string[]>();
  for (const member of members) {
    if (member.memberKind === "Group") {
      edges.set(member.groupId, [...(edges.get(member.groupId) ?? []), member.memberId]);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (groupId: string, depth: number): boolean => {
    if (depth > 16 || visiting.has(groupId)) return true;
    if (visited.has(groupId)) return false;
    visiting.add(groupId);
    const invalid = (edges.get(groupId) ?? []).some((child) => visit(child, depth + 1));
    visiting.delete(groupId);
    visited.add(groupId);
    return invalid;
  };
  return [...edges.keys()].some((groupId) => visit(groupId, 0))
    ? [{ path: "/members", code: "cycle", message: "group nesting must be acyclic and no deeper than 16 levels" }]
    : [];
}
