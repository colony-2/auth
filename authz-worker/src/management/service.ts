import type {
  Binding,
  Group,
  GroupMember,
  ManagedService,
  PathGrant,
  Scope,
  ServiceVocabulary,
  Subject,
} from "../control-plane/domain";
import { resolveSubjectBindings, resolveSubjectGroups } from "../control-plane/store";
import {
  DomainValidationError,
  assertValidVocabulary,
  validateBinding,
  validateGroupGraph,
  validatePathGrant,
  validateScope,
} from "../control-plane/validation";
import type { CompiledAuthDescriptor, PublishScopeConfigRequest, PublishServiceConfigRequest } from "../lib";
import { encodeCompactScopeClaim } from "../authn/claims";
import type { CompactPathGrant } from "../authn/types";
import { importOpenApiVocabulary } from "./openapi-import";
import type { ManagementPublisher, PublishResult } from "./publisher";
import type { ManagementRepository, ScopeDraft, ServiceDraft } from "./repository";

export class ManagementError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ManagementError";
  }
}

export interface ManagementServiceOptions {
  now?: () => number;
  id?: () => string;
}

export class ManagementService {
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(
    readonly repository: ManagementRepository,
    readonly publisher: ManagementPublisher,
    options: ManagementServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? (() => crypto.randomUUID());
  }

  async createService(input: { serviceId: string; name: string; description?: string; vocabulary: ServiceVocabulary }, actorId: string): Promise<ManagedService> {
    if (await this.repository.getService(input.serviceId)) throw new ManagementError("conflict", "service already exists", 409);
    if (input.vocabulary.serviceId !== input.serviceId) throw new ManagementError("validation_failed", "vocabulary serviceId must match serviceId", 422);
    this.validate(() => assertValidVocabulary(input.vocabulary));
    const now = this.isoNow();
    const service: ManagedService = { ...input, createdAt: now, updatedAt: now };
    await this.repository.putService(service);
    await this.audit(actorId, "service.create", "service", service.serviceId, service.serviceId);
    return service;
  }

  async putVocabulary(serviceId: string, vocabulary: ServiceVocabulary, actorId: string, expectedVersion?: number): Promise<ServiceVocabulary> {
    const service = await this.requireService(serviceId);
    if (expectedVersion !== undefined && service.vocabulary.version !== expectedVersion) {
      throw new ManagementError("version_conflict", `active vocabulary version is ${service.vocabulary.version}`, 409);
    }
    if (vocabulary.serviceId !== serviceId) throw new ManagementError("validation_failed", "vocabulary serviceId must match route serviceId", 422);
    this.validate(() => assertValidVocabulary(vocabulary));
    service.vocabulary = { ...vocabulary, version: Math.max(vocabulary.version, service.vocabulary.version + 1), updatedAt: this.isoNow() };
    service.updatedAt = service.vocabulary.updatedAt;
    await this.repository.putService(service);
    await this.audit(actorId, "vocabulary.update", "service", serviceId, serviceId, undefined, { version: service.vocabulary.version });
    return service.vocabulary;
  }

  async importOpenApi(serviceId: string, document: unknown, actorId: string) {
    const service = await this.requireService(serviceId);
    let imported;
    try {
      imported = importOpenApiVocabulary(document, service.vocabulary, this.isoNow());
      assertValidVocabulary(imported.vocabulary);
    } catch (error) {
      this.throwValidation(error);
    }
    service.vocabulary = imported!.vocabulary;
    service.updatedAt = this.isoNow();
    await this.repository.putService(service);
    const existing = await this.repository.getServiceDraft(serviceId);
    const draft: ServiceDraft = {
      serviceId,
      openApiDocument: document,
      authDescriptor: imported!.authDescriptor,
      snippets: existing?.snippets ?? {},
      namedPaths: existing?.namedPaths ?? {},
      metadata: existing?.metadata ?? {},
      ...(existing?.schema ? { schema: existing.schema } : {}),
      ...(existing?.globalPolicy ? { globalPolicy: existing.globalPolicy } : {}),
      updatedAt: this.isoNow(),
    };
    await this.repository.putServiceDraft(draft);
    await this.audit(actorId, "service.openapi_import", "service", serviceId, serviceId, undefined, {
      operationCount: imported!.authDescriptor.operations.length,
      warnings: imported!.warnings,
    });
    return imported;
  }

  async putServiceDraft(serviceId: string, input: Omit<ServiceDraft, "serviceId" | "updatedAt">, actorId: string): Promise<ServiceDraft> {
    await this.requireService(serviceId);
    const draft: ServiceDraft = { serviceId, ...input, updatedAt: this.isoNow() };
    await this.repository.putServiceDraft(draft);
    await this.audit(actorId, "service.config_update", "service", serviceId, serviceId);
    return draft;
  }

  async putSubject(input: Omit<Subject, "createdAt" | "updatedAt">, actorId: string): Promise<Subject> {
    const existing = await this.repository.getSubject(input.subjectId);
    const now = this.isoNow();
    const subject: Subject = { ...input, createdAt: existing?.createdAt ?? now, updatedAt: now };
    await this.repository.putSubject(subject);
    await this.audit(actorId, existing ? "subject.update" : "subject.create", "subject", subject.subjectId);
    return subject;
  }

  async createScope(input: Omit<Scope, "createdAt" | "updatedAt" | "activeVersion">, actorId: string): Promise<Scope> {
    if (await this.repository.getScope(input.scopeId)) throw new ManagementError("conflict", "scope already exists", 409);
    const service = await this.requireService(input.serviceId);
    const parent = input.parentScopeId ? await this.repository.getScope(input.parentScopeId) : undefined;
    const now = this.isoNow();
    const scope: Scope = { ...input, createdAt: now, updatedAt: now };
    const issues = validateScope(scope, service.vocabulary, parent);
    if (issues.length) throw new ManagementError("vocabulary_violation", "scope violates service vocabulary", 422, issues);
    await this.repository.putScope(scope);
    await this.audit(actorId, "scope.create", "scope", scope.scopeId, scope.serviceId, scope.scopeId);
    return scope;
  }

  async updateScope(scopeId: string, patch: Partial<Pick<Scope, "name" | "scopeType" | "parentScopeId" | "claimId" | "metadata">>, actorId: string): Promise<Scope> {
    const existing = await this.requireScope(scopeId);
    const service = await this.requireService(existing.serviceId);
    const updated: Scope = { ...existing, ...patch, updatedAt: this.isoNow() };
    const parent = updated.parentScopeId ? await this.repository.getScope(updated.parentScopeId) : undefined;
    const issues = validateScope(updated, service.vocabulary, parent);
    if (issues.length) throw new ManagementError("vocabulary_violation", "scope violates service vocabulary", 422, issues);
    await this.repository.putScope(updated);
    await this.audit(actorId, "scope.update", "scope", scopeId, existing.serviceId, scopeId);
    return updated;
  }

  async putGroup(scopeId: string, input: { groupId: string; name: string; description?: string }, actorId: string): Promise<Group> {
    const scope = await this.requireScope(scopeId);
    const existing = await this.repository.getGroup(input.groupId);
    if (existing && existing.scopeId !== scopeId) throw new ManagementError("conflict", "group id belongs to another scope", 409);
    const now = this.isoNow();
    const group: Group = { ...input, scopeId, createdAt: existing?.createdAt ?? now, updatedAt: now };
    await this.repository.putGroup(group);
    await this.audit(actorId, existing ? "group.update" : "group.create", "group", group.groupId, scope.serviceId, scopeId);
    return group;
  }

  async putGroupMember(scopeId: string, groupId: string, memberId: string, memberKind: GroupMember["memberKind"], actorId: string): Promise<GroupMember> {
    const scope = await this.requireScope(scopeId);
    const group = await this.repository.getGroup(groupId);
    if (!group || group.scopeId !== scopeId) throw new ManagementError("not_found", "group not found", 404);
    if (memberKind === "Group") {
      const memberGroup = await this.repository.getGroup(memberId);
      if (!memberGroup || memberGroup.scopeId !== scopeId) throw new ManagementError("not_found", "member group not found in scope", 404);
    } else if (!(await this.repository.getSubject(memberId))) {
      throw new ManagementError("not_found", "subject not found", 404);
    }
    const member: GroupMember = { groupId, memberId, memberKind, createdAt: this.isoNow() };
    const graph = [...await this.repository.listGroupMembers(scopeId)].filter(
      (value) => !(value.groupId === groupId && value.memberId === memberId),
    );
    graph.push(member);
    const issues = validateGroupGraph(graph);
    if (issues.length) throw new ManagementError("vocabulary_violation", "group membership graph is invalid", 422, issues);
    await this.repository.putGroupMember(member);
    await this.audit(actorId, "group.member_add", "group", groupId, scope.serviceId, scopeId, { memberId, memberKind });
    return member;
  }

  async deleteGroup(scopeId: string, groupId: string, actorId: string): Promise<void> {
    const scope = await this.requireScope(scopeId);
    const group = await this.repository.getGroup(groupId);
    if (!group || group.scopeId !== scopeId) throw new ManagementError("not_found", "group not found", 404);
    await this.repository.deleteGroup(groupId);
    await this.audit(actorId, "group.delete", "group", groupId, scope.serviceId, scopeId);
  }

  async deleteGroupMember(scopeId: string, groupId: string, memberId: string, actorId: string): Promise<void> {
    const scope = await this.requireScope(scopeId);
    if (!(await this.repository.deleteGroupMember(groupId, memberId))) {
      throw new ManagementError("not_found", "group membership not found", 404);
    }
    await this.audit(actorId, "group.member_remove", "group", groupId, scope.serviceId, scopeId, { memberId });
  }

  async putBinding(scopeId: string, input: Omit<Binding, "scopeId" | "createdAt" | "updatedAt">, actorId: string): Promise<Binding> {
    const scope = await this.requireScope(scopeId);
    const service = await this.requireService(scope.serviceId);
    if (input.subjectKind === "Group") {
      if (!(await this.repository.getGroup(input.subjectId))) throw new ManagementError("not_found", "group subject not found", 404);
    } else if (!(await this.repository.getSubject(input.subjectId))) {
      throw new ManagementError("not_found", "subject not found", 404);
    }
    const existing = (await this.repository.listBindings(scopeId)).find((value) => value.bindingId === input.bindingId);
    const now = this.isoNow();
    const binding: Binding = { ...input, scopeId, createdAt: existing?.createdAt ?? now, updatedAt: now };
    const issues = validateBinding(binding, service.vocabulary);
    if (issues.length) throw new ManagementError("vocabulary_violation", "binding violates service vocabulary", 422, issues);
    await this.repository.putBinding(binding);
    await this.audit(actorId, existing ? "binding.update" : "binding.create", "binding", binding.bindingId, scope.serviceId, scopeId);
    return binding;
  }

  async putPathGrant(scopeId: string, input: Omit<PathGrant, "scopeId" | "createdAt" | "updatedAt">, actorId: string): Promise<PathGrant> {
    const scope = await this.requireScope(scopeId);
    const service = await this.requireService(scope.serviceId);
    const existing = (await this.repository.listPathGrants(scopeId)).find((value) => value.pathGrantId === input.pathGrantId);
    const now = this.isoNow();
    const grant: PathGrant = { ...input, scopeId, createdAt: existing?.createdAt ?? now, updatedAt: now };
    const issues = validatePathGrant(grant, service.vocabulary);
    if (issues.length) throw new ManagementError("vocabulary_violation", "path grant violates service vocabulary", 422, issues);
    await this.repository.putPathGrant(grant);
    await this.audit(actorId, existing ? "path_grant.update" : "path_grant.create", "path_grant", grant.pathGrantId, scope.serviceId, scopeId);
    return grant;
  }

  async deleteBinding(scopeId: string, bindingId: string, actorId: string): Promise<void> {
    const scope = await this.requireScope(scopeId);
    const binding = (await this.repository.listBindings(scopeId)).find((value) => value.bindingId === bindingId);
    if (!binding || !(await this.repository.deleteBinding(bindingId))) {
      throw new ManagementError("not_found", "binding not found", 404);
    }
    await this.audit(actorId, "binding.delete", "binding", bindingId, scope.serviceId, scopeId);
  }

  async deletePathGrant(scopeId: string, pathGrantId: string, actorId: string): Promise<void> {
    const scope = await this.requireScope(scopeId);
    const grant = (await this.repository.listPathGrants(scopeId)).find((value) => value.pathGrantId === pathGrantId);
    if (!grant || !(await this.repository.deletePathGrant(pathGrantId))) {
      throw new ManagementError("not_found", "path grant not found", 404);
    }
    await this.audit(actorId, "path_grant.delete", "path_grant", pathGrantId, scope.serviceId, scopeId);
  }

  async putScopeDraft(scopeId: string, input: Omit<ScopeDraft, "scopeId" | "updatedAt">, actorId: string): Promise<ScopeDraft> {
    const scope = await this.requireScope(scopeId);
    const draft: ScopeDraft = { scopeId, ...input, updatedAt: this.isoNow() };
    await this.repository.putScopeDraft(draft);
    await this.audit(actorId, "scope.config_update", "scope", scopeId, scope.serviceId, scopeId);
    return draft;
  }

  async publishService(serviceId: string, actorId: string, requestedVersion?: string): Promise<PublishResult> {
    const service = await this.requireService(serviceId);
    const draft = await this.repository.getServiceDraft(serviceId);
    if (!draft?.authDescriptor) throw new ManagementError("config_incomplete", "import OpenAPI or provide an auth descriptor before publishing", 422);
    const version = requestedVersion ?? `svc-${service.vocabulary.version}-${this.now()}`;
    const config = this.compileServiceConfig(service, draft, version);
    let result: PublishResult;
    try {
      result = await this.publisher.publishService(serviceId, config);
    } catch (error) {
      throw new ManagementError("publish_failed", error instanceof Error ? error.message : "publish failed", 422);
    }
    const now = this.isoNow();
    await this.repository.putConfigVersion({
      versionId: version, serviceId, artifactKey: result.configKey, artifact: config,
      status: "published", createdBy: actorId, createdAt: now, publishedAt: now,
    });
    await this.repository.updateServiceActiveVersion(serviceId, version, now);
    await this.publisher.invalidate(serviceId);
    await this.audit(actorId, "service.publish", "service", serviceId, serviceId, undefined, { version, previousVersion: service.activeServiceVersion });
    return result;
  }

  async publishScope(scopeId: string, actorId: string, requestedVersion?: string): Promise<PublishResult> {
    const scope = await this.requireScope(scopeId);
    const service = await this.requireService(scope.serviceId);
    if (!service.activeServiceVersion) throw new ManagementError("publish_conflict", "publish the service config before scope configs", 409);
    const draft = await this.repository.getScopeDraft(scopeId) ?? {
      scopeId, includes: [], namedPaths: {}, staticEntities: [], metadata: {}, updatedAt: this.isoNow(),
    };
    const version = requestedVersion ?? `scope-${this.now()}`;
    const config = await this.compileScopeConfig(scope, draft, version);
    let result: PublishResult;
    try {
      result = await this.publisher.publishScope(scope.serviceId, config);
    } catch (error) {
      throw new ManagementError("publish_failed", error instanceof Error ? error.message : "publish failed", 422);
    }
    const now = this.isoNow();
    await this.repository.putConfigVersion({
      versionId: version, serviceId: scope.serviceId, scopeId, artifactKey: result.configKey,
      artifact: config, status: "published", createdBy: actorId, createdAt: now, publishedAt: now,
    });
    await this.repository.updateScopeActiveVersion(scopeId, version, now);
    await this.publisher.invalidate(scope.serviceId, scopeId);
    await this.audit(actorId, "scope.publish", "scope", scopeId, scope.serviceId, scopeId, { version, previousVersion: scope.activeVersion });
    return result;
  }

  async claimPreview(serviceId: string, subjectId: string): Promise<{ subjectId: string; serviceId: string; azv: 1; azs: string[] }> {
    await this.requireService(serviceId);
    if (!(await this.repository.getSubject(subjectId))) throw new ManagementError("not_found", "subject not found", 404);
    const claims: string[] = [];
    for (const scope of await this.repository.listScopes(serviceId)) {
      const groupIds = await resolveSubjectGroups(this.repository, scope.scopeId, subjectId);
      const bindings = await resolveSubjectBindings(this.repository, scope.scopeId, subjectId);
      const roleIds = bindings.flatMap((binding) => binding.roleId ? [binding.roleId] : []);
      const pathGrants: CompactPathGrant[] = [];
      for (const binding of bindings) {
        if (!binding.permissionId) continue;
        if (binding.namedPath) {
          pathGrants.push({ source: "named", permissionId: binding.permissionId, namespace: binding.pathSpace ?? "default", target: binding.namedPath });
        } else if (binding.inlinePathPrefix) {
          pathGrants.push({ source: "inline", permissionId: binding.permissionId, namespace: binding.pathSpace ?? "default", target: binding.inlinePathPrefix });
        }
      }
      if (roleIds.length || groupIds.length || pathGrants.length) {
        claims.push(encodeCompactScopeClaim({ scopeId: scope.scopeId, ...(scope.claimId ? { claimId: scope.claimId } : {}), roleIds, groupIds, pathGrants }));
      }
    }
    return { subjectId, serviceId, azv: 1, azs: claims.sort() };
  }

  async simulate(input: { serviceId: string; scopeId: string; subjectId: string; actionId: string; path?: string }): Promise<{ decision: "allow" | "deny"; reasons: string[]; matchedBindingIds: string[] }> {
    const service = await this.requireService(input.serviceId);
    const scope = await this.requireScope(input.scopeId);
    if (scope.serviceId !== input.serviceId) throw new ManagementError("validation_failed", "scope does not belong to service", 422);
    const action = service.vocabulary.actions.find((value) => value.id === input.actionId);
    if (!action) throw new ManagementError("vocabulary_violation", "unknown action", 422);
    const bindings = await resolveSubjectBindings(this.repository, input.scopeId, input.subjectId);
    const pathDefinitions = await this.repository.listPathGrants(input.scopeId);
    const matched = bindings.filter((binding) => {
      if (binding.roleId) {
        return service.vocabulary.roleTemplates.find((role) => role.id === binding.roleId)?.grants.some(
          (grant) => grant.permissionProfile === action.permissionProfile && grant.permissionId === action.permissionId &&
            grant.targetKind === action.targetKind && (!action.pathSpace || grant.pathSpace === action.pathSpace),
        );
      }
      if (binding.permissionProfile !== action.permissionProfile || binding.permissionId !== action.permissionId) return false;
      if (action.targetKind !== "path") return true;
      if (binding.pathSpace !== action.pathSpace || !input.path) return false;
      if (binding.inlinePathPrefix) return input.path.startsWith(binding.inlinePathPrefix);
      const definition = pathDefinitions.find((grant) => grant.name === binding.namedPath && grant.pathSpace === binding.pathSpace);
      return !!definition && input.path.startsWith(definition.prefix);
    });
    return {
      decision: matched.length ? "allow" : "deny",
      reasons: matched.length ? ["effective binding grants the action"] : ["no effective binding grants the action"],
      matchedBindingIds: matched.map((binding) => binding.bindingId),
    };
  }

  private compileServiceConfig(service: ManagedService, draft: ServiceDraft, version: string): PublishServiceConfigRequest {
    return {
      version,
      schemaVersion: String(service.vocabulary.version),
      ...(draft.schema ? { schema: draft.schema as PublishServiceConfigRequest["schema"] } : {}),
      ...(draft.openApiDocument ? { openApiDocument: draft.openApiDocument } : {}),
      authDescriptor: draft.authDescriptor as CompiledAuthDescriptor,
      permissionProfiles: Object.fromEntries(service.vocabulary.permissionProfiles.map((profile) => [profile.id, {
        name: profile.name ?? profile.id, permissions: profile.permissions.map((permission) => permission.id),
      }])),
      actionCatalog: Object.fromEntries(service.vocabulary.actions.map((action) => [action.id, {
        name: action.name ?? action.id, permissionProfile: action.permissionProfile,
        permissionId: action.permissionId, targetKind: action.targetKind,
      }])),
      roleTemplates: Object.fromEntries(service.vocabulary.roleTemplates.map((role) => [role.id, {
        name: role.name,
        grants: role.grants.map((grant) => ({ ...grant })),
      }])),
      snippets: draft.snippets,
      ...(draft.globalPolicy ? { globalPolicy: draft.globalPolicy } : {}),
      namedPaths: draft.namedPaths,
      staticEntities: [],
      metadata: {
        ...draft.metadata,
        vocabularyVersion: service.vocabulary.version,
        vocabularyUpdatedAt: service.vocabulary.updatedAt,
      } as PublishServiceConfigRequest["metadata"],
    };
  }

  private async compileScopeConfig(scope: Scope, draft: ScopeDraft, version: string): Promise<PublishScopeConfigRequest> {
    const groups = await this.repository.listGroups(scope.scopeId);
    const members = await this.repository.listGroupMembers(scope.scopeId);
    const bindings = await this.repository.listBindings(scope.scopeId);
    const pathGrants = await this.repository.listPathGrants(scope.scopeId);
    const namedPaths = structuredClone(draft.namedPaths);
    for (const grant of pathGrants) {
      const namespace = namedPaths[grant.pathSpace];
      if (!namespace || typeof namespace === "string") namedPaths[grant.pathSpace] = {};
      (namedPaths[grant.pathSpace] as Record<string, string>)[grant.name] = grant.prefix;
    }
    return {
      scopeId: scope.scopeId,
      version,
      ...(scope.claimId ? { claimId: scope.claimId } : {}),
      scopeType: scope.scopeType,
      ...(scope.parentScopeId ? { parentScopeId: scope.parentScopeId } : {}),
      includes: draft.includes,
      ...(draft.policy ? { policy: draft.policy } : {}),
      namedPaths,
      groups: Object.fromEntries(groups.map((group) => [group.groupId, {
        name: group.name,
        parentGroupIds: members.filter((member) => member.memberKind === "Group" && member.memberId === group.groupId).map((member) => member.groupId),
        members: members.filter((member) => member.groupId === group.groupId && member.memberKind !== "Group").map((member) => member.memberId),
      }])),
      bindings: bindings.map((binding) => ({
        bindingId: binding.bindingId, subjectKind: binding.subjectKind, subjectId: binding.subjectId,
        ...(binding.roleId ? { roleId: binding.roleId } : {}),
        ...(binding.permissionProfile ? { permissionProfile: binding.permissionProfile } : {}),
        ...(binding.permissionId ? { permissionId: binding.permissionId } : {}),
        ...((binding.resourceType || binding.pathSpace || binding.namedPath || binding.inlinePathPrefix) ? {
          targetConstraint: {
            ...(binding.resourceType ? { resourceType: binding.resourceType } : {}),
            ...(binding.pathSpace ? { pathNamespace: binding.pathSpace } : {}),
            ...(binding.namedPath ? { namedPath: binding.namedPath } : {}),
            ...(binding.inlinePathPrefix ? { inlinePathPrefix: binding.inlinePathPrefix } : {}),
          },
        } : {}),
      })),
      staticEntities: draft.staticEntities as PublishScopeConfigRequest["staticEntities"],
      metadata: draft.metadata as PublishScopeConfigRequest["metadata"],
    };
  }

  private async requireService(serviceId: string): Promise<ManagedService> {
    const service = await this.repository.getService(serviceId);
    if (!service) throw new ManagementError("not_found", "service not found", 404);
    return service;
  }

  private async requireScope(scopeId: string): Promise<Scope> {
    const scope = await this.repository.getScope(scopeId);
    if (!scope) throw new ManagementError("not_found", "scope not found", 404);
    return scope;
  }

  private validate(action: () => void): void {
    try { action(); } catch (error) { this.throwValidation(error); }
  }

  private throwValidation(error: unknown): never {
    if (error instanceof DomainValidationError) {
      throw new ManagementError("vocabulary_violation", "service vocabulary is invalid", 422, error.issues);
    }
    throw new ManagementError("validation_failed", error instanceof Error ? error.message : "validation failed", 422);
  }

  private async audit(
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
    serviceId?: string,
    scopeId?: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    await this.repository.appendAudit({
      eventId: this.id(), actorId, action, targetType, targetId,
      ...(serviceId ? { serviceId } : {}), ...(scopeId ? { scopeId } : {}),
      ...(detail ? { detail } : {}), createdAt: this.isoNow(),
    });
  }

  private isoNow(): string {
    return new Date(this.now()).toISOString();
  }
}
