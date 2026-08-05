import {
  checkParsePolicySet,
  initSync,
  preparsePolicySet,
  preparseSchema,
  statefulIsAuthorized,
  type AuthorizationAnswer,
  type CedarValueJson,
  type CheckParseAnswer,
  type Context,
  type Entities,
  type EntityJson,
  type PolicySet,
  type Schema,
  type StatefulAuthorizationCall,
} from "@cedar-policy/cedar-wasm/web";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import cedarWasmModule from "./cedar_wasm_bg.wasm";

export type MaybePromise<T> = T | Promise<T>;
export type CaptureSelector = string | number;
export type ManifestScopeType = "service" | "scope";
export type NamedPathCatalogInput = Record<string, string | Record<string, string>>;
export type NamedPathCatalog = Record<string, Record<string, string>>;
export type TargetKind = "scope" | "resource" | "path";
export type SubjectKind = "User" | "ServiceAccount" | "Group";
export type PathSpaceAnchorKind = "service" | "resource";
export type JwtVerifierConfig =
  | {
      type: "hs256";
      secret: string;
      issuer?: string;
      audience?: string | string[];
      algorithms?: string[];
    }
  | {
      type: "jwks";
      jwksUrl: string;
      issuer?: string;
      audience?: string | string[];
      algorithms?: string[];
    };

export interface ActionCatalogEntry {
  name?: string;
  permissionProfile?: string;
  permissionId?: string;
  targetKind?: TargetKind;
}

export interface RoleTemplateGrant {
  permissionProfile?: string;
  permissionId?: string;
  targetKind?: TargetKind;
  resourceType?: string;
  pathNamespace?: string;
}

export interface RoleTemplate {
  name?: string;
  grants?: RoleTemplateGrant[];
  metadata?: Record<string, CedarValueJson>;
}

export interface GroupDefinition {
  name?: string;
  scopeId?: string;
  parentGroupIds?: string[];
  members?: string[];
  metadata?: Record<string, CedarValueJson>;
}

export interface BindingTargetConstraint {
  resourceType?: string;
  pathNamespace?: string;
  namedPath?: string;
  inlinePathPrefix?: string;
}

export interface BindingDefinition {
  bindingId?: string;
  subjectKind: SubjectKind;
  subjectId: string;
  roleId?: string;
  permissionProfile?: string;
  permissionId?: string;
  targetConstraint?: BindingTargetConstraint;
  metadata?: Record<string, CedarValueJson>;
}

interface ResolvedAuthzRuntimeEnv {
  POLICY_BUCKET: R2Bucket;
  SERVICE_IDENTIFIER: string;
  POLICY_ROOT: string;
  JWT_VERIFIER: string;
  SCOPE_RESOLUTION: string;
  MANIFEST_TTL_SECONDS: string;
  SERVICE_CONFIG_TTL_SECONDS: string;
  SCOPE_CONFIG_TTL_SECONDS: string;
  EFFECTIVE_POLICY_TTL_SECONDS: string;
  MAX_MANIFEST_CACHE_ENTRIES: string;
  MAX_SERVICE_CONFIG_CACHE_ENTRIES: string;
  MAX_SCOPE_CONFIG_CACHE_ENTRIES: string;
  MAX_EFFECTIVE_POLICY_CACHE_ENTRIES: string;
}

interface ResolvedAuthzAdminEnv extends ResolvedAuthzRuntimeEnv {
  ADMIN_TOKEN: string;
}

export interface AuthzProxyEnv {
  POLICY_BUCKET: R2Bucket;
  SERVICE_IDENTIFIER: string;
  JWKS_URL: string;
  JWT_ISSUER?: string;
  SCOPE_RESOLUTION?: string;
  MANIFEST_TTL_SECONDS?: string;
  SERVICE_CONFIG_TTL_SECONDS?: string;
  SCOPE_CONFIG_TTL_SECONDS?: string;
  EFFECTIVE_POLICY_TTL_SECONDS?: string;
  MAX_MANIFEST_CACHE_ENTRIES?: string;
  MAX_SERVICE_CONFIG_CACHE_ENTRIES?: string;
  MAX_SCOPE_CONFIG_CACHE_ENTRIES?: string;
  MAX_EFFECTIVE_POLICY_CACHE_ENTRIES?: string;
}

export interface AuthzAdminEnv extends AuthzProxyEnv {
  ADMIN_TOKEN: string;
}

export interface AuthzEmbeddedRuntime {
  policyBucket: R2Bucket;
  serviceIdentifier: string;
  jwksUrl: string;
  jwtIssuer?: string;
  scopeResolution?: ScopeResolver[];
  manifestTtlSeconds?: number;
  serviceConfigTtlSeconds?: number;
  scopeConfigTtlSeconds?: number;
  effectivePolicyTtlSeconds?: number;
  maxManifestCacheEntries?: number;
  maxServiceConfigCacheEntries?: number;
  maxScopeConfigCacheEntries?: number;
  maxEffectivePolicyCacheEntries?: number;
}

export interface VersionManifest {
  service: string;
  scopeType: ManifestScopeType;
  scopeId: string;
  activeVersion: string;
  generatedAt: string;
}

export interface PathPermissionCatalogEntry {
  name?: string;
  actions?: string[];
}

export interface ServiceGlobalConfig {
  version: string;
  schemaVersion: string;
  schema?: Schema;
  openApiDocument?: unknown;
  authDescriptor: CompiledAuthDescriptor;
  permissionProfiles?: Record<string, { name?: string; permissions?: string[] }>;
  actionCatalog?: Record<string, ActionCatalogEntry>;
  snippets: Record<string, string>;
  globalPolicy?: string;
  staticEntities: EntityJson[];
  roleTemplates?: Record<string, RoleTemplate>;
  pathPermissionCatalog?: Record<string, PathPermissionCatalogEntry>;
  namedPaths?: NamedPathCatalogInput;
  groups?: Record<string, GroupDefinition>;
  metadata?: Record<string, CedarValueJson>;
}

export interface ScopePolicyConfig {
  version: string;
  scopeId: string;
  claimId?: string;
  scopeType?: string;
  parentScopeId?: string;
  includes: string[];
  policy?: string;
  namedPaths?: NamedPathCatalog;
  groups?: Record<string, GroupDefinition>;
  bindings?: BindingDefinition[];
  staticEntities: EntityJson[];
  metadata?: Record<string, CedarValueJson>;
}

export interface PublishServiceConfigRequest {
  version?: string;
  schemaVersion?: string;
  schema?: Schema;
  openApiDocument?: unknown;
  authDescriptor: CompiledAuthDescriptor;
  permissionProfiles?: Record<string, { name?: string; permissions?: string[] }>;
  actionCatalog?: Record<string, ActionCatalogEntry>;
  snippets?: Record<string, string>;
  globalPolicy?: string;
  staticEntities?: EntityJson[];
  roleTemplates?: Record<string, RoleTemplate>;
  pathPermissionCatalog?: Record<string, PathPermissionCatalogEntry>;
  namedPaths?: NamedPathCatalogInput;
  groups?: Record<string, GroupDefinition>;
  metadata?: Record<string, CedarValueJson>;
}

export interface PublishScopeConfigRequest {
  scopeId: string;
  version?: string;
  claimId?: string;
  scopeType?: string;
  parentScopeId?: string;
  includes?: string[];
  policy?: string;
  namedPaths?: NamedPathCatalogInput;
  groups?: Record<string, GroupDefinition>;
  bindings?: BindingDefinition[];
  staticEntities?: EntityJson[];
  metadata?: Record<string, CedarValueJson>;
}

export interface InvalidateCacheRequest {
  scopeId?: string;
  service?: boolean;
}

export interface RequestBodyAccessor {
  text(): Promise<string | undefined>;
  json<T = unknown>(): Promise<T | undefined>;
}

export type ScopeResolver =
  | {
      type: "path";
      pattern: string;
      group?: CaptureSelector;
    }
  | {
      type: "header";
      header: string;
      pattern?: string;
      group?: CaptureSelector;
    }
  | {
      type: "body_json";
      pointer: string;
      contentTypes?: string[];
    }
  | {
      type: "body_regex";
      pattern: string;
      group?: CaptureSelector;
      contentTypes?: string[];
    };

export type ValueExtractor =
  | {
      source: "literal";
      value: CedarValueJson;
    }
  | {
      source: "path_group";
      name: string;
    }
  | {
      source: "header";
      name: string;
      pattern?: string;
      group?: CaptureSelector;
    }
  | {
      source: "body_json";
      pointer: string;
      contentTypes?: string[];
    }
  | {
      source: "body_regex";
      pattern: string;
      group?: CaptureSelector;
      contentTypes?: string[];
    };

export interface PathSpaceDescriptor {
  path?: ValueExtractor;
  namespace?: ValueExtractor;
  kind?: ValueExtractor | CedarValueJson;
  anchorKind?: PathSpaceAnchorKind;
  anchorResourceType?: string;
  anchorResourceId?: ValueExtractor;
}

export interface CompiledAuthOperation {
  operationId: string;
  method: string;
  pathPattern: string;
  actionId?: string;
  permissionProfile?: string;
  permissionId?: string;
  targetKind?: TargetKind;
  resourceType: string;
  resourceId: ValueExtractor;
  resourceScopeId?: ValueExtractor;
  resourceScopeType?: ValueExtractor | CedarValueJson;
  resourceAttributes?: Record<string, ValueExtractor>;
  context?: Record<string, ValueExtractor | CedarValueJson>;
  resourceParents?: Array<{ type: string; id: string }>;
  pathSpace?: PathSpaceDescriptor;
  pathResource?: PathSpaceDescriptor;
}

export interface CompiledAuthDescriptor {
  version: string;
  operations: CompiledAuthOperation[];
}

export interface AuthorizationTarget {
  operationId: string;
  scopeId: string;
  scopeType: string;
  parentScopeId?: string;
  actionId: string;
  permissionProfile: string;
  permissionId: string;
  targetKind: TargetKind;
  resourceType: string;
  resourceId: string;
  resourceScopeId: string;
  resourceScopeType: string;
  resourceAttributes?: Record<string, CedarValueJson>;
  resourceParents?: Array<{ type: string; id: string }>;
  context?: Context;
  pathResource?: ResolvedPathResource;
  pathSpace?: ResolvedPathSpace;
}

export interface AuthorizationDecisionDetails {
  service: string;
  operationId: string;
  scopeId: string;
  scopeType: string;
  parentScopeId?: string;
  action: string;
  resource: {
    type: string;
    id: string;
    scopeId: string;
    scopeType: string;
  };
  decision: "allow" | "deny";
  reasons: string[];
  serviceVersion: string;
  scopeVersion: string;
  principal: {
    id: string;
    currentScopeRole: CedarValueJson;
    currentScopeRoles: CedarValueJson;
    currentScopeGroups: CedarValueJson;
    pathActionAllowed: boolean;
    matchedPathPermissions: CedarValueJson;
  };
  serviceManifest: VersionManifest;
  scopeManifest: VersionManifest;
  target: AuthorizationTarget;
  claims: JWTPayload;
  injectedHeaders: Record<string, string>;
}

export interface NormalizedPrincipal {
  uid: {
    type: string;
    id: string;
  };
  attrs: Record<string, CedarValueJson>;
}

export interface AuthzRuntimeOptions<Env = unknown> {
  includeControlRoutes?: boolean;
  passThroughIfUnresolved?: boolean;
  resolveUpstreamUrl?: (input: {
    request: Request;
    env: Env & { UPSTREAM_ORIGIN?: string };
    decision: AuthorizationDecisionDetails;
  }) => MaybePromise<string | URL>;
  injectAuthzHeaders?:
    | boolean
    | ((decision: AuthorizationDecisionDetails) => Record<string, string>);
  onUnauthorized?: (response: Response) => MaybePromise<Response>;
  onForbidden?: (decision: AuthorizationDecisionDetails) => MaybePromise<Response>;
  onError?: (response: Response) => MaybePromise<Response>;
}

export interface AuthzEmbeddedOptions<Env = unknown> extends AuthzRuntimeOptions<Env> {
  runtime:
    | AuthzEmbeddedRuntime
    | ((input: { request: Request; env: Env }) => MaybePromise<AuthzEmbeddedRuntime>);
}

interface PreparedServiceGlobalConfig {
  config: ServiceGlobalConfig;
  compiledOperations: PreparedAuthOperation[];
}

interface PreparedAuthOperation {
  operation: CompiledAuthOperation;
  pathRegex: RegExp;
}

interface PreparedEffectivePolicy {
  policySetId: string;
  schemaName?: string;
  serviceConfig: ServiceGlobalConfig;
  scopeConfig: ScopePolicyConfig;
}

interface LoadBehavior {
  bypassInMemoryCache?: boolean;
  bypassEdgeCache?: boolean;
}

interface ParsedScopeClaim {
  claimId: string;
  roleIds: string[];
  groupIds: string[];
  pathGrants: ParsedPathGrant[];
}

interface ParsedPathGrant {
  source: "named" | "inline";
  permissionId: string;
  namespace: string;
  target: string;
}

interface ExpandedPathGrant {
  source: "named" | "inline";
  permissionId: string;
  namespace: string;
  prefix: string;
  ref: string;
}

interface ResolvedScopeClaim {
  claimId: string;
  roleIds: string[];
  roles: string[];
  groupIds: string[];
  groups: string[];
  pathGrants: ExpandedPathGrant[];
}

interface ResolvedPathSpace {
  namespace: string;
  anchorKind: PathSpaceAnchorKind;
  anchorResourceType?: string;
  anchorResourceId?: string;
}

interface ResolvedPathResource {
  path: string;
  namespace: string;
  kind?: CedarValueJson;
  ancestorPrefixes: string[];
  pathSpace: ResolvedPathSpace;
  matchedGrants: ExpandedPathGrant[];
  matchedPermissionIds: string[];
  actionAllowed: boolean;
  actionPermissionIds: string[];
}

class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

class TtlLruCache<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();

  constructor(private maxEntries: number) {}

  setMaxEntries(nextMaxEntries: number): void {
    if (nextMaxEntries <= 0) {
      return;
    }
    this.maxEntries = nextMaxEntries;
    this.trim();
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, ttlMs: number): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
    this.trim();
  }

  delete(key: K): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  deleteWhere(predicate: (key: K, value: V) => boolean): void {
    for (const [key, entry] of this.entries) {
      if (predicate(key, entry.value)) {
        this.entries.delete(key);
      }
    }
  }

  size(): number {
    return this.entries.size;
  }

  private trim(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }
}

const BUILTIN_PATH_PERMISSION_ACTIONS: Record<string, string[]> = {
  l: ["listPath"],
  t: ["traversePath"],
  i: ["inspectPath"],
  r: ["readPath"],
  w: ["writePath"],
  c: ["createPath"],
  d: ["deletePath"],
  m: ["movePath"],
  x: ["executePath"],
  a: ["administerPath"],
};

const BUILTIN_PERMISSION_PROFILES: Record<string, string[]> = {
  object: ["l", "r", "c", "u", "d", "a", "x"],
  path: ["l", "t", "i", "r", "w", "c", "d", "m", "x", "a"],
};

const DEFAULT_SCOPE_RESOLUTION: ScopeResolver[] = [
  {
    type: "header",
    header: "x-scope-id",
    pattern: "^(?<scopeId>[A-Za-z0-9_-]+)$",
  },
  {
    type: "body_json",
    pointer: "/scopeId",
    contentTypes: ["application/json"],
  },
  {
    type: "body_regex",
    pattern: "(?:^|[&\\s])scopeId=(?<scopeId>[^&\\s]+)",
    contentTypes: ["text/plain", "application/x-www-form-urlencoded"],
  },
  {
    type: "path",
    pattern: "^/scope-path/(?<scopeId>[^/]+)/",
  },
];

const manifestCache = new TtlLruCache<string, VersionManifest>(64);
const serviceConfigCache = new TtlLruCache<string, PreparedServiceGlobalConfig>(16);
const scopeConfigCache = new TtlLruCache<string, ScopePolicyConfig>(64);
const effectivePolicyCache = new TtlLruCache<string, PreparedEffectivePolicy>(64);

let cedarReady = false;
let scopeResolutionCache:
  | {
      raw: string;
      parsed: ScopeResolver[];
    }
  | undefined;
let jwtVerifierConfigCache:
  | {
      raw: string;
      parsed: JwtVerifierConfig;
      jwks?: ReturnType<typeof createRemoteJWKSet>;
    }
  | undefined;

function ensureCedarReady(): void {
  if (cedarReady) {
    return;
  }
  initSync({ module: cedarWasmModule });
  cedarReady = true;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNamedPathCatalog(input: unknown): NamedPathCatalog {
  const normalized: NamedPathCatalog = {};
  if (!isObjectRecord(input)) {
    return normalized;
  }

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      normalized.default ??= {};
      normalized.default[key] = value;
      continue;
    }

    if (!isObjectRecord(value)) {
      continue;
    }

    const namespaceEntries = Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string",
    );
    if (namespaceEntries.length === 0) {
      continue;
    }

    normalized[key] = {
      ...(normalized[key] ?? {}),
      ...Object.fromEntries(namespaceEntries),
    };
  }

  return normalized;
}

function normalizePermissionProfiles(
  input: unknown,
): Record<string, { name?: string; permissions?: string[] }> {
  if (!isObjectRecord(input)) {
    return {
      object: { name: "object", permissions: [...BUILTIN_PERMISSION_PROFILES.object] },
      path: { name: "path", permissions: [...BUILTIN_PERMISSION_PROFILES.path] },
    };
  }

  const normalized: Record<string, { name?: string; permissions?: string[] }> = {
    object: { name: "object", permissions: [...BUILTIN_PERMISSION_PROFILES.object] },
    path: { name: "path", permissions: [...BUILTIN_PERMISSION_PROFILES.path] },
  };

  for (const [profileId, value] of Object.entries(input)) {
    if (!isObjectRecord(value)) {
      continue;
    }

    const permissions = Array.isArray(value.permissions)
      ? value.permissions.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : undefined;

    normalized[profileId] = {
      ...(typeof value.name === "string" && value.name.trim() ? { name: value.name.trim() } : {}),
      ...(permissions ? { permissions } : {}),
    };
  }

  return normalized;
}

function normalizeActionCatalog(input: unknown): Record<string, ActionCatalogEntry> {
  if (!isObjectRecord(input)) {
    return {};
  }

  const normalized: Record<string, ActionCatalogEntry> = {};
  for (const [actionId, value] of Object.entries(input)) {
    if (!isObjectRecord(value)) {
      continue;
    }

    const targetKind =
      value.targetKind === "scope" || value.targetKind === "resource" || value.targetKind === "path"
        ? value.targetKind
        : undefined;

    normalized[actionId] = {
      ...(typeof value.name === "string" && value.name.trim() ? { name: value.name.trim() } : {}),
      ...(typeof value.permissionProfile === "string" && value.permissionProfile.trim()
        ? { permissionProfile: value.permissionProfile.trim() }
        : {}),
      ...(typeof value.permissionId === "string" && value.permissionId.trim()
        ? { permissionId: value.permissionId.trim() }
        : {}),
      ...(targetKind ? { targetKind } : {}),
    };
  }

  return normalized;
}

function normalizeRoleTemplates(input: unknown): Record<string, RoleTemplate> {
  if (!isObjectRecord(input)) {
    return {};
  }

  const normalized: Record<string, RoleTemplate> = {};
  for (const [roleId, value] of Object.entries(input)) {
    if (typeof value === "string") {
      normalized[roleId] = { name: value };
      continue;
    }
    if (!isObjectRecord(value)) {
      continue;
    }

    const grants = Array.isArray(value.grants)
      ? value.grants
          .filter(isObjectRecord)
          .map((grant): RoleTemplateGrant => {
            const targetKind =
              grant.targetKind === "scope" || grant.targetKind === "resource" || grant.targetKind === "path"
                ? grant.targetKind
                : undefined;
            return {
              ...(typeof grant.permissionProfile === "string" && grant.permissionProfile.trim()
                ? { permissionProfile: grant.permissionProfile.trim() }
                : {}),
              ...(typeof grant.permissionId === "string" && grant.permissionId.trim()
                ? { permissionId: grant.permissionId.trim() }
                : {}),
              ...(targetKind ? { targetKind } : {}),
              ...(typeof grant.resourceType === "string" && grant.resourceType.trim()
                ? { resourceType: grant.resourceType.trim() }
                : {}),
              ...(typeof grant.pathNamespace === "string" && grant.pathNamespace.trim()
                ? { pathNamespace: grant.pathNamespace.trim() }
                : {}),
            };
          })
      : undefined;

    normalized[roleId] = {
      ...(typeof value.name === "string" && value.name.trim() ? { name: value.name.trim() } : {}),
      ...(grants ? { grants } : {}),
      ...(isObjectRecord(value.metadata) ? { metadata: value.metadata as Record<string, CedarValueJson> } : {}),
    };
  }

  return normalized;
}

function normalizeGroups(input: unknown): Record<string, GroupDefinition> {
  if (!isObjectRecord(input)) {
    return {};
  }

  const normalized: Record<string, GroupDefinition> = {};
  for (const [groupId, value] of Object.entries(input)) {
    if (typeof value === "string") {
      normalized[groupId] = { name: value };
      continue;
    }
    if (!isObjectRecord(value)) {
      continue;
    }

    const parentGroupIds = Array.isArray(value.parentGroupIds)
      ? value.parentGroupIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : undefined;
    const members = Array.isArray(value.members)
      ? value.members.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : undefined;

    normalized[groupId] = {
      ...(typeof value.name === "string" && value.name.trim() ? { name: value.name.trim() } : {}),
      ...(typeof value.scopeId === "string" && value.scopeId.trim() ? { scopeId: value.scopeId.trim() } : {}),
      ...(parentGroupIds ? { parentGroupIds } : {}),
      ...(members ? { members } : {}),
      ...(isObjectRecord(value.metadata) ? { metadata: value.metadata as Record<string, CedarValueJson> } : {}),
    };
  }

  return normalized;
}

function normalizeBindings(input: unknown): BindingDefinition[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const normalized: BindingDefinition[] = [];
  for (const value of input) {
    if (!isObjectRecord(value)) {
      continue;
    }
    if (
      value.subjectKind !== "User" &&
      value.subjectKind !== "ServiceAccount" &&
      value.subjectKind !== "Group"
    ) {
      continue;
    }
    if (typeof value.subjectId !== "string" || !value.subjectId.trim()) {
      continue;
    }

    const targetConstraint = isObjectRecord(value.targetConstraint)
      ? {
          ...(typeof value.targetConstraint.resourceType === "string" && value.targetConstraint.resourceType.trim()
            ? { resourceType: value.targetConstraint.resourceType.trim() }
            : {}),
          ...(typeof value.targetConstraint.pathNamespace === "string" && value.targetConstraint.pathNamespace.trim()
            ? { pathNamespace: value.targetConstraint.pathNamespace.trim() }
            : {}),
          ...(typeof value.targetConstraint.namedPath === "string" && value.targetConstraint.namedPath.trim()
            ? { namedPath: value.targetConstraint.namedPath.trim() }
            : {}),
          ...(typeof value.targetConstraint.inlinePathPrefix === "string" &&
          value.targetConstraint.inlinePathPrefix.trim()
            ? { inlinePathPrefix: value.targetConstraint.inlinePathPrefix.trim() }
            : {}),
        }
      : undefined;

    normalized.push({
      ...(typeof value.bindingId === "string" && value.bindingId.trim() ? { bindingId: value.bindingId.trim() } : {}),
      subjectKind: value.subjectKind,
      subjectId: value.subjectId.trim(),
      ...(typeof value.roleId === "string" && value.roleId.trim() ? { roleId: value.roleId.trim() } : {}),
      ...(typeof value.permissionProfile === "string" && value.permissionProfile.trim()
        ? { permissionProfile: value.permissionProfile.trim() }
        : {}),
      ...(typeof value.permissionId === "string" && value.permissionId.trim()
        ? { permissionId: value.permissionId.trim() }
        : {}),
      ...(targetConstraint ? { targetConstraint } : {}),
      ...(isObjectRecord(value.metadata) ? { metadata: value.metadata as Record<string, CedarValueJson> } : {}),
    });
  }

  return normalized;
}

function configureCaches(env: ResolvedAuthzRuntimeEnv): void {
  manifestCache.setMaxEntries(parsePositiveInt(env.MAX_MANIFEST_CACHE_ENTRIES, 64));
  serviceConfigCache.setMaxEntries(parsePositiveInt(env.MAX_SERVICE_CONFIG_CACHE_ENTRIES, 16));
  scopeConfigCache.setMaxEntries(parsePositiveInt(env.MAX_SCOPE_CONFIG_CACHE_ENTRIES, 64));
  effectivePolicyCache.setMaxEntries(parsePositiveInt(env.MAX_EFFECTIVE_POLICY_CACHE_ENTRIES, 64));
}

export function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

function buildPolicyCacheRequest(key: string): Request {
  return new Request(`https://policy-cache.internal/${key}`);
}

function getEdgeCache(): Cache {
  return (caches as unknown as { default: Cache }).default;
}

function normalizePolicyRoot(root: string): string {
  return root.trim().replace(/^\/+|\/+$/g, "");
}

function buildPolicyRoot(serviceIdentifier: string): string {
  return normalizePolicyRoot(`authz/${serviceIdentifier}`);
}

function buildServiceManifestKey(policyRoot: string): string {
  return `${normalizePolicyRoot(policyRoot)}/service/manifest.json`;
}

function buildServiceConfigKey(policyRoot: string, version: string): string {
  return `${normalizePolicyRoot(policyRoot)}/service/${version}/config.json`;
}

function buildScopeManifestKey(policyRoot: string, scopeId: string): string {
  return `${normalizePolicyRoot(policyRoot)}/scopes/${scopeId}/manifest.json`;
}

function buildScopeConfigKey(policyRoot: string, scopeId: string, version: string): string {
  return `${normalizePolicyRoot(policyRoot)}/scopes/${scopeId}/${version}/config.yaml`;
}

function stringifyScopeResolution(resolvers: ScopeResolver[] | undefined): string {
  return JSON.stringify(resolvers ?? DEFAULT_SCOPE_RESOLUTION);
}

function resolveProxyRuntimeEnv(env: AuthzProxyEnv): ResolvedAuthzRuntimeEnv {
  return {
    POLICY_BUCKET: env.POLICY_BUCKET,
    SERVICE_IDENTIFIER: env.SERVICE_IDENTIFIER,
    POLICY_ROOT: buildPolicyRoot(env.SERVICE_IDENTIFIER),
    JWT_VERIFIER: JSON.stringify({
      type: "jwks",
      jwksUrl: env.JWKS_URL,
      audience: env.SERVICE_IDENTIFIER,
      ...(env.JWT_ISSUER ? { issuer: env.JWT_ISSUER } : {}),
    } satisfies JwtVerifierConfig),
    SCOPE_RESOLUTION: env.SCOPE_RESOLUTION ?? stringifyScopeResolution(undefined),
    MANIFEST_TTL_SECONDS: env.MANIFEST_TTL_SECONDS ?? "2",
    SERVICE_CONFIG_TTL_SECONDS: env.SERVICE_CONFIG_TTL_SECONDS ?? "30",
    SCOPE_CONFIG_TTL_SECONDS: env.SCOPE_CONFIG_TTL_SECONDS ?? "30",
    EFFECTIVE_POLICY_TTL_SECONDS: env.EFFECTIVE_POLICY_TTL_SECONDS ?? "30",
    MAX_MANIFEST_CACHE_ENTRIES: env.MAX_MANIFEST_CACHE_ENTRIES ?? "32",
    MAX_SERVICE_CONFIG_CACHE_ENTRIES: env.MAX_SERVICE_CONFIG_CACHE_ENTRIES ?? "16",
    MAX_SCOPE_CONFIG_CACHE_ENTRIES: env.MAX_SCOPE_CONFIG_CACHE_ENTRIES ?? "32",
    MAX_EFFECTIVE_POLICY_CACHE_ENTRIES: env.MAX_EFFECTIVE_POLICY_CACHE_ENTRIES ?? "16",
  };
}

function resolveAdminRuntimeEnv(env: AuthzAdminEnv): ResolvedAuthzAdminEnv {
  return {
    ...resolveProxyRuntimeEnv(env),
    ADMIN_TOKEN: env.ADMIN_TOKEN,
  };
}

function resolveEmbeddedRuntimeEnv(runtime: AuthzEmbeddedRuntime): ResolvedAuthzRuntimeEnv {
  return {
    POLICY_BUCKET: runtime.policyBucket,
    SERVICE_IDENTIFIER: runtime.serviceIdentifier,
    POLICY_ROOT: buildPolicyRoot(runtime.serviceIdentifier),
    JWT_VERIFIER: JSON.stringify({
      type: "jwks",
      jwksUrl: runtime.jwksUrl,
      audience: runtime.serviceIdentifier,
      ...(runtime.jwtIssuer ? { issuer: runtime.jwtIssuer } : {}),
    } satisfies JwtVerifierConfig),
    SCOPE_RESOLUTION: stringifyScopeResolution(runtime.scopeResolution),
    MANIFEST_TTL_SECONDS: String(runtime.manifestTtlSeconds ?? 2),
    SERVICE_CONFIG_TTL_SECONDS: String(runtime.serviceConfigTtlSeconds ?? 30),
    SCOPE_CONFIG_TTL_SECONDS: String(runtime.scopeConfigTtlSeconds ?? 30),
    EFFECTIVE_POLICY_TTL_SECONDS: String(runtime.effectivePolicyTtlSeconds ?? 30),
    MAX_MANIFEST_CACHE_ENTRIES: String(runtime.maxManifestCacheEntries ?? 32),
    MAX_SERVICE_CONFIG_CACHE_ENTRIES: String(runtime.maxServiceConfigCacheEntries ?? 16),
    MAX_SCOPE_CONFIG_CACHE_ENTRIES: String(runtime.maxScopeConfigCacheEntries ?? 32),
    MAX_EFFECTIVE_POLICY_CACHE_ENTRIES: String(runtime.maxEffectivePolicyCacheEntries ?? 16),
  };
}

async function loadJsonDocument<T>(
  env: ResolvedAuthzRuntimeEnv,
  key: string,
  ttlSeconds: number,
  behavior: LoadBehavior = {},
): Promise<T> {
  const cacheRequest = buildPolicyCacheRequest(key);
  if (!behavior.bypassEdgeCache) {
    const cached = await getEdgeCache().match(cacheRequest);
    if (cached) {
      return (await cached.json()) as T;
    }
  }

  const object = await env.POLICY_BUCKET.get(key);
  if (!object) {
    throw new NotFoundError(`R2 object not found: ${key}`);
  }

  const body = await object.text();
  const etag = "httpEtag" in object ? object.httpEtag : undefined;
  const response = new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `max-age=${ttlSeconds}`,
      ...(etag ? { etag } : {}),
    },
  });
  if (!behavior.bypassEdgeCache) {
    await getEdgeCache().put(cacheRequest, response.clone());
  }
  return JSON.parse(body) as T;
}

async function loadTextDocument(
  env: ResolvedAuthzRuntimeEnv,
  key: string,
  ttlSeconds: number,
  contentType: string,
  behavior: LoadBehavior = {},
): Promise<string> {
  const cacheRequest = buildPolicyCacheRequest(key);
  if (!behavior.bypassEdgeCache) {
    const cached = await getEdgeCache().match(cacheRequest);
    if (cached) {
      return await cached.text();
    }
  }

  const object = await env.POLICY_BUCKET.get(key);
  if (!object) {
    throw new NotFoundError(`R2 object not found: ${key}`);
  }

  const body = await object.text();
  const etag = "httpEtag" in object ? object.httpEtag : undefined;
  const response = new Response(body, {
    headers: {
      "content-type": contentType,
      "cache-control": `max-age=${ttlSeconds}`,
      ...(etag ? { etag } : {}),
    },
  });
  if (!behavior.bypassEdgeCache) {
    await getEdgeCache().put(cacheRequest, response.clone());
  }
  return body;
}

function manifestTtlMs(env: ResolvedAuthzRuntimeEnv): number {
  return parsePositiveInt(env.MANIFEST_TTL_SECONDS, 2) * 1000;
}

function serviceConfigTtlMs(env: ResolvedAuthzRuntimeEnv): number {
  return parsePositiveInt(env.SERVICE_CONFIG_TTL_SECONDS, 30) * 1000;
}

function scopeConfigTtlMs(env: ResolvedAuthzRuntimeEnv): number {
  return parsePositiveInt(env.SCOPE_CONFIG_TTL_SECONDS, 30) * 1000;
}

function effectivePolicyTtlMs(env: ResolvedAuthzRuntimeEnv): number {
  return parsePositiveInt(env.EFFECTIVE_POLICY_TTL_SECONDS, 30) * 1000;
}

async function loadVersionManifest(
  env: ResolvedAuthzRuntimeEnv,
  cacheKey: string,
  key: string,
  behavior: LoadBehavior = {},
): Promise<VersionManifest> {
  if (!behavior.bypassInMemoryCache) {
    const cached = manifestCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const ttlMs = manifestTtlMs(env);
  const manifest = await loadJsonDocument<VersionManifest>(
    env,
    key,
    Math.ceil(ttlMs / 1000),
    behavior,
  );
  if (!behavior.bypassInMemoryCache) {
    manifestCache.set(cacheKey, manifest, ttlMs);
  }
  return manifest;
}

async function loadServiceManifest(
  env: ResolvedAuthzRuntimeEnv,
  behavior?: LoadBehavior,
): Promise<VersionManifest> {
  return await loadVersionManifest(
    env,
    `${normalizePolicyRoot(env.POLICY_ROOT)}:service-manifest`,
    buildServiceManifestKey(env.POLICY_ROOT),
    behavior,
  );
}

async function loadScopeManifest(
  env: ResolvedAuthzRuntimeEnv,
  scopeId: string,
  behavior?: LoadBehavior,
): Promise<VersionManifest> {
  return await loadVersionManifest(
    env,
    `${normalizePolicyRoot(env.POLICY_ROOT)}:${scopeId}:scope-manifest`,
    buildScopeManifestKey(env.POLICY_ROOT, scopeId),
    behavior,
  );
}

function validateDescriptor(descriptor: CompiledAuthDescriptor): void {
  if (!Array.isArray(descriptor.operations) || descriptor.operations.length === 0) {
    throw new Error("authDescriptor.operations must contain at least one operation");
  }

  for (const operation of descriptor.operations) {
    if (!operation.operationId || !operation.method || !operation.pathPattern || !operation.resourceType) {
      throw new Error("compiled auth descriptor operation is missing required fields");
    }
    new RegExp(operation.pathPattern);

    const pathSpace = operation.pathSpace ?? operation.pathResource;
    if (pathSpace?.anchorKind && pathSpace.anchorKind !== "service" && pathSpace.anchorKind !== "resource") {
      throw new Error(`operation ${operation.operationId} has invalid pathSpace.anchorKind`);
    }
    if (operation.targetKind && operation.targetKind !== "scope" && operation.targetKind !== "resource" && operation.targetKind !== "path") {
      throw new Error(`operation ${operation.operationId} has invalid targetKind`);
    }
  }
}

function prepareServiceGlobalConfig(config: ServiceGlobalConfig): PreparedServiceGlobalConfig {
  const normalized: ServiceGlobalConfig = {
    ...config,
    permissionProfiles: normalizePermissionProfiles(config.permissionProfiles),
    actionCatalog: normalizeActionCatalog(config.actionCatalog),
    roleTemplates: normalizeRoleTemplates((config as ServiceGlobalConfig & { roleCatalog?: Record<string, string> }).roleTemplates ?? (config as ServiceGlobalConfig & { roleCatalog?: Record<string, string> }).roleCatalog),
    pathPermissionCatalog: config.pathPermissionCatalog ?? {},
    namedPaths: normalizeNamedPathCatalog(config.namedPaths),
    groups: normalizeGroups(config.groups),
    metadata: config.metadata ?? {},
  };

  validateDescriptor(normalized.authDescriptor);
  return {
    config: normalized,
    compiledOperations: normalized.authDescriptor.operations.map((operation) => ({
      operation,
      pathRegex: new RegExp(operation.pathPattern),
    })),
  };
}

async function loadServiceConfig(
  env: ResolvedAuthzRuntimeEnv,
  behavior: LoadBehavior = {},
): Promise<PreparedServiceGlobalConfig> {
  const manifest = await loadServiceManifest(env, behavior);
  const cacheKey = `${normalizePolicyRoot(env.POLICY_ROOT)}:${manifest.activeVersion}:service-config`;
  if (!behavior.bypassInMemoryCache) {
    const cached = serviceConfigCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const ttlMs = serviceConfigTtlMs(env);
  const config = await loadJsonDocument<ServiceGlobalConfig>(
    env,
    buildServiceConfigKey(env.POLICY_ROOT, manifest.activeVersion),
    Math.ceil(ttlMs / 1000),
    behavior,
  );
  const prepared = prepareServiceGlobalConfig(config);
  if (!behavior.bypassInMemoryCache) {
    serviceConfigCache.set(cacheKey, prepared, ttlMs);
  }
  return prepared;
}

function parseScopePolicyConfig(text: string): ScopePolicyConfig {
  const parsed = parseYaml(text) as ScopePolicyConfig | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("scope policy config is invalid");
  }

  return {
    version: parsed.version,
    scopeId: parsed.scopeId,
    claimId: parsed.claimId,
    scopeType: parsed.scopeType,
    parentScopeId: parsed.parentScopeId,
    includes: Array.isArray(parsed.includes) ? parsed.includes : [],
    policy: parsed.policy,
    namedPaths: normalizeNamedPathCatalog(parsed.namedPaths),
    groups: normalizeGroups(parsed.groups),
    bindings: normalizeBindings(parsed.bindings),
    staticEntities: Array.isArray(parsed.staticEntities) ? parsed.staticEntities : [],
    metadata: parsed.metadata ?? {},
  };
}

async function loadScopeConfig(
  env: ResolvedAuthzRuntimeEnv,
  scopeId: string,
  behavior: LoadBehavior = {},
): Promise<ScopePolicyConfig> {
  const manifest = await loadScopeManifest(env, scopeId, behavior);
  const cacheKey = `${normalizePolicyRoot(env.POLICY_ROOT)}:${scopeId}:${manifest.activeVersion}:scope-config`;
  if (!behavior.bypassInMemoryCache) {
    const cached = scopeConfigCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const ttlMs = scopeConfigTtlMs(env);
  const text = await loadTextDocument(
    env,
    buildScopeConfigKey(env.POLICY_ROOT, scopeId, manifest.activeVersion),
    Math.ceil(ttlMs / 1000),
    "application/yaml; charset=utf-8",
    behavior,
  );
  const config = parseScopePolicyConfig(text);
  if (!behavior.bypassInMemoryCache) {
    scopeConfigCache.set(cacheKey, config, ttlMs);
  }
  return config;
}

function assembleEffectivePolicySource(
  serviceConfig: ServiceGlobalConfig,
  scopeConfig: ScopePolicyConfig,
): string {
  const sources: string[] = [];

  if (serviceConfig.globalPolicy?.trim()) {
    sources.push(serviceConfig.globalPolicy.trim());
  }

  for (const includeId of scopeConfig.includes) {
    const snippet = serviceConfig.snippets[includeId];
    if (!snippet) {
      throw new Error(`unknown policy snippet include: ${includeId}`);
    }
    if (snippet.trim()) {
      sources.push(snippet.trim());
    }
  }

  if (scopeConfig.policy?.trim()) {
    sources.push(scopeConfig.policy.trim());
  }

  return sources.join("\n\n");
}

function cedarFailureMessage(answer: CheckParseAnswer | AuthorizationAnswer): string {
  if (answer.type === "success") {
    return "unknown cedar success state";
  }
  const issues = "errors" in answer ? answer.errors : [];
  return issues.map((issue) => issue.message).join("; ");
}

function prepareEffectivePolicy(
  serviceName: string,
  serviceVersion: string,
  scopeConfig: ScopePolicyConfig,
  serviceConfig: ServiceGlobalConfig,
): PreparedEffectivePolicy {
  ensureCedarReady();

  const policySource = assembleEffectivePolicySource(serviceConfig, scopeConfig);
  const policySet: PolicySet = {
    staticPolicies: policySource,
  };
  const policySetId = `policy-set:${serviceName}:${serviceVersion}:${scopeConfig.scopeId}:${scopeConfig.version}`;

  const policyParseResult = preparsePolicySet(policySetId, policySet);
  if (policyParseResult.type !== "success") {
    throw new Error(`failed to preparse policy set: ${cedarFailureMessage(policyParseResult)}`);
  }

  let schemaName: string | undefined;
  if (serviceConfig.schema) {
    schemaName = `schema:${serviceName}:${serviceVersion}`;
    const schemaParseResult = preparseSchema(schemaName, serviceConfig.schema);
    if (schemaParseResult.type !== "success") {
      throw new Error(`failed to preparse schema: ${cedarFailureMessage(schemaParseResult)}`);
    }
  }

  return {
    policySetId,
    schemaName,
    serviceConfig,
    scopeConfig,
  };
}

async function loadEffectivePolicy(
  env: ResolvedAuthzRuntimeEnv,
  scopeConfig: ScopePolicyConfig,
  preparedServiceConfig: PreparedServiceGlobalConfig,
): Promise<PreparedEffectivePolicy> {
  const cacheKey = [
    normalizePolicyRoot(env.POLICY_ROOT),
    preparedServiceConfig.config.version,
    scopeConfig.scopeId,
    scopeConfig.version,
    "effective",
  ].join(":");
  const cached = effectivePolicyCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const ttlMs = effectivePolicyTtlMs(env);
  const prepared = prepareEffectivePolicy(
    env.SERVICE_IDENTIFIER,
    preparedServiceConfig.config.version,
    scopeConfig,
    preparedServiceConfig.config,
  );
  effectivePolicyCache.set(cacheKey, prepared, ttlMs);
  return prepared;
}

function parseBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) {
    return null;
  }

  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) {
    return null;
  }
  return value;
}

async function verifyJwt(request: Request, env: ResolvedAuthzRuntimeEnv): Promise<JWTPayload> {
  const token = parseBearerToken(request);
  if (!token) {
    throw jsonResponse({ error: "missing bearer token" }, { status: 401 });
  }

  const verifier = parseJwtVerifierConfig(env.JWT_VERIFIER);
  const jwtOptions = {
    ...(verifier.parsed.issuer ? { issuer: verifier.parsed.issuer } : {}),
    ...(verifier.parsed.audience ? { audience: verifier.parsed.audience } : {}),
    ...(verifier.parsed.algorithms ? { algorithms: verifier.parsed.algorithms } : {}),
  };
  try {
    const verified =
      verifier.parsed.type === "hs256"
        ? await jwtVerify(token, new TextEncoder().encode(verifier.parsed.secret), {
            ...jwtOptions,
            algorithms: verifier.parsed.algorithms ?? ["HS256"],
          })
        : await jwtVerify(token, verifier.jwks!, {
            ...jwtOptions,
            algorithms: verifier.parsed.algorithms ?? ["RS256", "ES256"],
          });
    return verified.payload;
  } catch {
    throw jsonResponse({ error: "invalid bearer token" }, { status: 401 });
  }
}

function resolveOauthScopes(payload: JWTPayload): string[] {
  const { scope, scopes } = payload;
  if (typeof scope === "string") {
    return scope.split(" ").filter(Boolean);
  }

  if (Array.isArray(scopes)) {
    return scopes.filter((value): value is string => typeof value === "string");
  }

  return [];
}

function parseCompactScopeClaim(raw: string): ParsedScopeClaim {
  const tokens = raw
    .split("|")
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    throw new Error("invalid empty scope claim");
  }

  const [claimId, ...rest] = tokens;
  const roleIds: string[] = [];
  const groupIds: string[] = [];
  const pathGrants: ParsedPathGrant[] = [];

  for (const token of rest) {
    if (token.startsWith("r")) {
      const encoded = token.slice(1);
      if (!encoded) {
        continue;
      }
      roleIds.push(...encoded.split(",").map((value) => value.trim()).filter(Boolean));
      continue;
    }

    if (token.startsWith("g")) {
      const encoded = token.slice(1);
      if (!encoded) {
        continue;
      }
      groupIds.push(...encoded.split(",").map((value) => value.trim()).filter(Boolean));
      continue;
    }

    if (token.startsWith("P") || token.startsWith("p")) {
      const separatorIndex = token.indexOf(":");
      if (separatorIndex <= 1 || separatorIndex === token.length - 1) {
        continue;
      }
      const source = token.startsWith("P") ? "named" : "inline";
      const permissionId = token.slice(1, separatorIndex).trim();
      const encodedTarget = token.slice(separatorIndex + 1).trim();
      if (!permissionId || !encodedTarget) {
        continue;
      }
      const namespaceSeparatorIndex = encodedTarget.indexOf(":");
      const hasNamespace = namespaceSeparatorIndex > 0 && namespaceSeparatorIndex < encodedTarget.length - 1;
      const namespace = hasNamespace
        ? encodedTarget.slice(0, namespaceSeparatorIndex).trim()
        : "default";
      const target = hasNamespace
        ? encodedTarget.slice(namespaceSeparatorIndex + 1).trim()
        : encodedTarget;
      if (!namespace || !target) {
        continue;
      }
      pathGrants.push({
        source,
        permissionId,
        namespace,
        target,
      });
    }
  }

  return {
    claimId,
    roleIds,
    groupIds,
    pathGrants,
  };
}

function parseCompactScopeClaims(payload: JWTPayload): ParsedScopeClaim[] {
  const rawClaims = payload.azs;
  if (Array.isArray(rawClaims)) {
    return rawClaims
      .filter((value): value is string => typeof value === "string")
      .map((value) => parseCompactScopeClaim(value));
  }

  if (typeof rawClaims === "string" && rawClaims.trim().length > 0) {
    return [parseCompactScopeClaim(rawClaims)];
  }

  return [];
}

function resolveRoleNames(
  roleIds: string[],
  serviceConfig: ServiceGlobalConfig,
): string[] {
  return roleIds.map((roleId) => serviceConfig.roleTemplates?.[roleId]?.name ?? roleId);
}

function resolveGroupNames(
  groupIds: string[],
  serviceConfig: ServiceGlobalConfig,
  scopeConfig: ScopePolicyConfig,
): string[] {
  return groupIds.map((groupId) => scopeConfig.groups?.[groupId]?.name ?? serviceConfig.groups?.[groupId]?.name ?? groupId);
}

function mergePathPermissionCatalog(
  serviceConfig: ServiceGlobalConfig,
): Record<string, PathPermissionCatalogEntry> {
  const merged: Record<string, PathPermissionCatalogEntry> = {};

  for (const [permissionId, actions] of Object.entries(BUILTIN_PATH_PERMISSION_ACTIONS)) {
    merged[permissionId] = {
      name: permissionId,
      actions,
    };
  }

  for (const [permissionId, entry] of Object.entries(serviceConfig.pathPermissionCatalog ?? {})) {
    merged[permissionId] = {
      ...(merged[permissionId] ?? {}),
      ...entry,
    };
  }

  return merged;
}

function splitPathSegments(input: string): string[] {
  const rawSegments = input
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .split("/");
  const normalized: string[] = [];

  for (const segment of rawSegments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }

  return normalized;
}

function normalizePathValue(input: string): { path: string; directoryHint: boolean } {
  const trimmed = input.trim();
  const directoryHint = /[\\/]$/.test(trimmed);
  const path = splitPathSegments(trimmed).join("/");
  return {
    path,
    directoryHint,
  };
}

function canonicalizePathPrefix(input: string): string {
  const normalized = normalizePathValue(input).path;
  if (!normalized) {
    return "";
  }
  return `${normalized.replace(/\/+$/g, "")}/`;
}

function buildAncestorPrefixes(path: string, includeSelf: boolean): string[] {
  const segments = splitPathSegments(path);
  const prefixes: string[] = [];
  const upperBound = includeSelf ? segments.length : Math.max(segments.length - 1, 0);

  for (let index = 0; index < upperBound; index += 1) {
    prefixes.push(`${segments.slice(0, index + 1).join("/")}/`);
  }

  return prefixes;
}

function matchesCanonicalPrefix(path: string, prefix: string): boolean {
  if (!prefix) {
    return false;
  }
  const barePrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return path === barePrefix || path.startsWith(prefix);
}

function resolveNamedPathCatalog(
  serviceConfig: ServiceGlobalConfig,
  scopeConfig: ScopePolicyConfig,
): NamedPathCatalog {
  const merged: NamedPathCatalog = {};

  const serviceCatalog = normalizeNamedPathCatalog(serviceConfig.namedPaths);
  const scopeCatalog = scopeConfig.namedPaths ?? {};

  for (const [namespace, entries] of Object.entries(serviceCatalog)) {
    merged[namespace] = {
      ...(merged[namespace] ?? {}),
      ...entries,
    };
  }

  for (const [namespace, entries] of Object.entries(scopeCatalog)) {
    merged[namespace] = {
      ...(merged[namespace] ?? {}),
      ...entries,
    };
  }

  return merged;
}

function expandPathGrants(
  claims: ParsedPathGrant[],
  serviceConfig: ServiceGlobalConfig,
  scopeConfig: ScopePolicyConfig,
): ExpandedPathGrant[] {
  const namedPaths = resolveNamedPathCatalog(serviceConfig, scopeConfig);
  const expanded: ExpandedPathGrant[] = [];

  for (const claim of claims) {
    if (claim.source === "named") {
      const mapped = namedPaths[claim.namespace]?.[claim.target];
      if (!mapped) {
        continue;
      }
      const prefix = canonicalizePathPrefix(mapped);
      if (!prefix) {
        continue;
      }
      expanded.push({
        source: "named",
        permissionId: claim.permissionId,
        namespace: claim.namespace,
        prefix,
        ref: claim.target,
      });
      continue;
    }

    const prefix = canonicalizePathPrefix(claim.target);
    if (!prefix) {
      continue;
    }
    expanded.push({
      source: "inline",
      permissionId: claim.permissionId,
      namespace: claim.namespace,
      prefix,
      ref: claim.target,
    });
  }

  return expanded;
}

function resolveCurrentScopeClaim(
  payload: JWTPayload,
  scopeConfig: ScopePolicyConfig,
  serviceConfig: ServiceGlobalConfig,
): ResolvedScopeClaim {
  const expectedClaimId = scopeConfig.claimId ?? scopeConfig.scopeId;
  const parsedClaims = parseCompactScopeClaims(payload);
  const matched = parsedClaims.find((claim) => claim.claimId === expectedClaimId);
  const roleIds = matched?.roleIds ?? [];
  const roles = resolveRoleNames(roleIds, serviceConfig);
  const groupIds = matched?.groupIds ?? [];
  const groups = resolveGroupNames(groupIds, serviceConfig, scopeConfig);
  const pathGrants = expandPathGrants(matched?.pathGrants ?? [], serviceConfig, scopeConfig);

  return {
    claimId: expectedClaimId,
    roleIds,
    roles,
    groupIds,
    groups,
    pathGrants,
  };
}

function inferTargetKind(operation: CompiledAuthOperation): TargetKind {
  if (operation.targetKind) {
    return operation.targetKind;
  }
  if (operation.pathSpace || operation.pathResource || operation.resourceType === "PathObject") {
    return "path";
  }
  return "resource";
}

function inferPermissionProfile(operation: CompiledAuthOperation, targetKind: TargetKind): string {
  if (operation.permissionProfile?.trim()) {
    return operation.permissionProfile.trim();
  }
  return targetKind === "path" ? "path" : "object";
}

function inferPermissionId(operation: CompiledAuthOperation, profile: string): string {
  if (operation.permissionId?.trim()) {
    return operation.permissionId.trim();
  }

  const method = operation.method.toUpperCase();
  if (profile === "path") {
    if (method === "GET" || method === "HEAD") {
      return "r";
    }
    if (method === "PUT" || method === "PATCH") {
      return "w";
    }
    if (method === "POST") {
      return "x";
    }
    if (method === "DELETE") {
      return "d";
    }
    return "x";
  }

  if (method === "GET" || method === "HEAD") {
    return "r";
  }
  if (method === "POST") {
    return "c";
  }
  if (method === "PUT" || method === "PATCH") {
    return "u";
  }
  if (method === "DELETE") {
    return "d";
  }
  return "x";
}

function resolveOperationSemantics(
  operation: CompiledAuthOperation,
  serviceConfig: ServiceGlobalConfig,
): { actionId: string; permissionProfile: string; permissionId: string; targetKind: TargetKind } {
  const actionId = operation.actionId ?? operation.operationId;
  const catalogEntry = serviceConfig.actionCatalog?.[actionId];
  const targetKind = catalogEntry?.targetKind ?? inferTargetKind(operation);
  const permissionProfile =
    catalogEntry?.permissionProfile?.trim() || inferPermissionProfile(operation, targetKind);
  const permissionId = catalogEntry?.permissionId?.trim() || inferPermissionId(operation, permissionProfile);

  return {
    actionId,
    permissionProfile,
    permissionId,
    targetKind,
  };
}

function isPathPermissionAllowedForTarget(
  permissionId: string,
  target: AuthorizationTarget,
  serviceConfig: ServiceGlobalConfig,
): boolean {
  if (target.permissionProfile === "path" && target.permissionId) {
    return permissionId === target.permissionId;
  }

  if (permissionId === target.actionId) {
    return true;
  }

  const catalog = mergePathPermissionCatalog(serviceConfig);
  const actions = catalog[permissionId]?.actions ?? [];
  return actions.includes(target.actionId);
}

function resolvePathAccess(
  target: AuthorizationTarget,
  currentScopeClaim: ResolvedScopeClaim,
  serviceConfig: ServiceGlobalConfig,
): ResolvedPathResource | undefined {
  const pathResource = target.pathResource;
  if (!pathResource) {
    return undefined;
  }

  const matchedGrants = currentScopeClaim.pathGrants.filter((grant) =>
    grant.namespace === pathResource.namespace &&
    matchesCanonicalPrefix(pathResource.path, grant.prefix),
  );
  const matchedPermissionIds = Array.from(
    new Set(matchedGrants.map((grant) => grant.permissionId)),
  );
  const actionPermissionIds = matchedPermissionIds.filter((permissionId) =>
    isPathPermissionAllowedForTarget(permissionId, target, serviceConfig),
  );

  return {
    ...pathResource,
    matchedGrants,
    matchedPermissionIds,
    actionAllowed: actionPermissionIds.length > 0,
    actionPermissionIds,
  };
}

function buildPrincipal(
  payload: JWTPayload,
  target: AuthorizationTarget,
  scopeConfig: ScopePolicyConfig,
  serviceConfig: ServiceGlobalConfig,
): NormalizedPrincipal {
  const principalId = typeof payload.sub === "string" ? payload.sub : "anonymous";
  const currentScopeClaim = resolveCurrentScopeClaim(payload, scopeConfig, serviceConfig);
  const pathAccess = resolvePathAccess(target, currentScopeClaim, serviceConfig);

  return {
    uid: {
      type: "Principal",
      id: principalId,
    },
    attrs: {
      current_scope_id: target.scopeId,
      current_scope_type: target.scopeType,
      current_scope_claim_id: currentScopeClaim.claimId,
      current_scope_role: currentScopeClaim.roles[0] ?? "",
      current_scope_roles: currentScopeClaim.roles,
      current_scope_role_ids: currentScopeClaim.roleIds,
      current_scope_group: currentScopeClaim.groups[0] ?? "",
      current_scope_groups: currentScopeClaim.groups,
      current_scope_group_ids: currentScopeClaim.groupIds,
      parent_scope_id: target.parentScopeId ?? "",
      suspended: payload.suspended === true,
      oauth_scopes: resolveOauthScopes(payload),
      action_permission_profile: target.permissionProfile,
      action_permission_id: target.permissionId,
      action_target_kind: target.targetKind,
      path_permission_ids: pathAccess?.matchedPermissionIds ?? [],
      path_action_permission_ids: pathAccess?.actionPermissionIds ?? [],
      path_permission_prefixes: pathAccess?.matchedGrants.map((grant) => grant.prefix) ?? [],
      path_action_allowed: pathAccess?.actionAllowed ?? false,
      path_namespace: target.pathSpace?.namespace ?? "",
      path_anchor_kind: target.pathSpace?.anchorKind ?? "",
      path_anchor_resource_type: target.pathSpace?.anchorResourceType ?? "",
      path_anchor_resource_id: target.pathSpace?.anchorResourceId ?? "",
    },
  };
}

function entity(
  type: string,
  id: string,
  attrs: Record<string, CedarValueJson>,
  parents: Array<{ type: string; id: string }> = [],
): EntityJson {
  return {
    uid: { type, id },
    attrs,
    parents,
  };
}

function buildEntities(
  principal: NormalizedPrincipal,
  target: AuthorizationTarget,
  effectivePolicy: PreparedEffectivePolicy,
): Entities {
  const resourceParents =
    target.resourceParents ??
    [{ type: "Scope", id: target.resourceScopeId }];
  const entities: Entities = [
    entity(principal.uid.type, principal.uid.id, principal.attrs),
    entity(
      target.resourceType,
      target.resourceId,
      {
        scope_id: target.resourceScopeId,
        scope_type: target.resourceScopeType,
        ...(target.resourceAttributes ?? {}),
      },
      resourceParents,
    ),
    entity(
      "Scope",
      target.scopeId,
      {
        scope_type: target.scopeType,
        parent_scope_id: target.parentScopeId ?? "",
      },
      target.parentScopeId ? [{ type: "Scope", id: target.parentScopeId }] : [],
    ),
  ];

  if (target.resourceScopeId !== target.scopeId) {
    entities.push(
      entity(
        "Scope",
        target.resourceScopeId,
        {
          scope_type: target.resourceScopeType,
        },
        [],
      ),
    );
  }

  if (target.parentScopeId) {
    entities.push(
      entity("Scope", target.parentScopeId, {
        scope_type: "",
      }),
    );
  }

  if (effectivePolicy.serviceConfig.staticEntities.length > 0) {
    entities.push(...effectivePolicy.serviceConfig.staticEntities);
  }
  if (effectivePolicy.scopeConfig.staticEntities.length > 0) {
    entities.push(...effectivePolicy.scopeConfig.staticEntities);
  }

  return entities;
}

function buildContext(request: Request, service: string, target: AuthorizationTarget): Context {
  const url = new URL(request.url);
  return {
    service,
    http_method: request.method,
    http_path: url.pathname,
    current_scope_id: target.scopeId,
    current_scope_type: target.scopeType,
    action_id: target.actionId,
    permission_profile: target.permissionProfile,
    permission_id: target.permissionId,
    target_kind: target.targetKind,
    path_namespace: target.pathSpace?.namespace ?? "",
    path_anchor_kind: target.pathSpace?.anchorKind ?? "",
    path_anchor_resource_type: target.pathSpace?.anchorResourceType ?? "",
    path_anchor_resource_id: target.pathSpace?.anchorResourceId ?? "",
    ...(target.context ?? {}),
  };
}

function authorizeWithCedar(
  request: Request,
  target: AuthorizationTarget,
  principal: NormalizedPrincipal,
  effectivePolicy: PreparedEffectivePolicy,
  service: string,
): AuthorizationAnswer {
  ensureCedarReady();

  const call: StatefulAuthorizationCall = {
    principal: principal.uid,
    action: {
      type: "Action",
      id: target.actionId,
    },
    resource: {
      type: target.resourceType,
      id: target.resourceId,
    },
    context: buildContext(request, service, target),
    preparsedPolicySetId: effectivePolicy.policySetId,
    entities: buildEntities(principal, target, effectivePolicy),
    validateRequest: false,
    ...(effectivePolicy.schemaName ? { preparsedSchemaName: effectivePolicy.schemaName } : {}),
  };

  return statefulIsAuthorized(call);
}

function buildInjectedAuthzHeaders(decision: AuthorizationDecisionDetails): Record<string, string> {
  return {
    "x-authz-decision": decision.decision,
    "x-authz-service": decision.service,
    "x-authz-operation-id": decision.operationId,
    "x-authz-scope-id": decision.scopeId,
    "x-authz-scope-type": decision.scopeType,
    "x-authz-action": decision.action,
    "x-authz-permission-profile": decision.target.permissionProfile,
    "x-authz-permission-id": decision.target.permissionId,
    "x-authz-target-kind": decision.target.targetKind,
    "x-authz-resource-type": decision.resource.type,
    "x-authz-resource-id": decision.resource.id,
    "x-authz-resource-scope-id": decision.resource.scopeId,
    "x-authz-resource-scope-type": decision.resource.scopeType,
    "x-authz-path-namespace": decision.target.pathSpace?.namespace ?? "",
    "x-authz-path-anchor-kind": decision.target.pathSpace?.anchorKind ?? "",
    "x-authz-path-anchor-resource-type": decision.target.pathSpace?.anchorResourceType ?? "",
    "x-authz-path-anchor-resource-id": decision.target.pathSpace?.anchorResourceId ?? "",
    "x-authz-principal-id": decision.principal.id,
    "x-authz-service-version": decision.serviceVersion,
    "x-authz-scope-version": decision.scopeVersion,
  };
}

function createRequestBodyAccessor(request: Request): RequestBodyAccessor {
  let textPromise: Promise<string | undefined> | undefined;

  const getText = async (): Promise<string | undefined> => {
    if (!textPromise) {
      const cloned = request.clone();
      textPromise = (async () => {
        if (request.method === "GET" || request.method === "HEAD") {
          return undefined;
        }
        const text = await cloned.text();
        return text.length > 0 ? text : undefined;
      })();
    }
    return await textPromise;
  };

  return {
    text: getText,
    async json<T = unknown>(): Promise<T | undefined> {
      const text = await getText();
      if (!text) {
        return undefined;
      }
      return JSON.parse(text) as T;
    },
  };
}

function parseScopeResolution(raw: string): ScopeResolver[] {
  if (scopeResolutionCache && scopeResolutionCache.raw === raw) {
    return scopeResolutionCache.parsed;
  }

  const parsed = JSON.parse(raw) as ScopeResolver[];
  if (!Array.isArray(parsed)) {
    throw new Error("SCOPE_RESOLUTION must be a JSON array");
  }

  scopeResolutionCache = {
    raw,
    parsed,
  };
  return parsed;
}

function parseJwtVerifierConfig(raw: string): {
  parsed: JwtVerifierConfig;
  jwks?: ReturnType<typeof createRemoteJWKSet>;
} {
  if (jwtVerifierConfigCache && jwtVerifierConfigCache.raw === raw) {
    return jwtVerifierConfigCache;
  }

  const parsed = JSON.parse(raw) as JwtVerifierConfig;
  if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
    throw new Error("JWT_VERIFIER must be a JSON object with a type");
  }

  let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
  if (parsed.type === "hs256") {
    if (!parsed.secret || typeof parsed.secret !== "string") {
      throw new Error("JWT_VERIFIER hs256 config must include secret");
    }
  } else if (parsed.type === "jwks") {
    if (!parsed.jwksUrl || typeof parsed.jwksUrl !== "string") {
      throw new Error("JWT_VERIFIER jwks config must include jwksUrl");
    }
    jwks = createRemoteJWKSet(new URL(parsed.jwksUrl));
  } else {
    throw new Error("JWT_VERIFIER type must be hs256 or jwks");
  }

  jwtVerifierConfigCache = {
    raw,
    parsed,
    ...(jwks ? { jwks } : {}),
  };
  return jwtVerifierConfigCache;
}

function matchesContentType(contentTypeHeader: string | null, allowed: string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) {
    return true;
  }
  if (!contentTypeHeader) {
    return false;
  }
  const normalized = contentTypeHeader.toLowerCase();
  return allowed.some((value) => normalized.startsWith(value.toLowerCase()));
}

function selectRegexCapture(
  match: RegExpMatchArray,
  group: CaptureSelector | undefined,
  defaultNamedGroup?: string,
): string | undefined {
  if (typeof group === "number") {
    return match[group];
  }
  if (typeof group === "string") {
    return match.groups?.[group];
  }
  if (defaultNamedGroup && match.groups?.[defaultNamedGroup]) {
    return match.groups[defaultNamedGroup];
  }
  return match[1] ?? match[0];
}

function resolveJsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === "" || pointer === "/") {
    return root;
  }

  if (!pointer.startsWith("/")) {
    throw new Error(`invalid JSON pointer: ${pointer}`);
  }

  const parts = pointer
    .slice(1)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));

  let current: unknown = root;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(part, 10);
      if (Number.isNaN(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (!isObjectRecord(current)) {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

async function extractValue(
  extractor: ValueExtractor,
  input: {
    request: Request;
    body: RequestBodyAccessor;
    pathGroups: Record<string, string>;
  },
): Promise<CedarValueJson | undefined> {
  switch (extractor.source) {
    case "literal":
      return extractor.value;
    case "path_group":
      return input.pathGroups[extractor.name];
    case "header": {
      const headerValue = input.request.headers.get(extractor.name);
      if (headerValue === null) {
        return undefined;
      }
      if (!extractor.pattern) {
        return headerValue;
      }
      const match = headerValue.match(new RegExp(extractor.pattern));
      if (!match) {
        return undefined;
      }
      return selectRegexCapture(match, extractor.group);
    }
    case "body_json": {
      if (!matchesContentType(input.request.headers.get("content-type"), extractor.contentTypes)) {
        return undefined;
      }
      try {
        const bodyJson = await input.body.json();
        if (bodyJson === undefined) {
          return undefined;
        }
        return resolveJsonPointer(bodyJson, extractor.pointer) as CedarValueJson | undefined;
      } catch {
        return undefined;
      }
    }
    case "body_regex": {
      if (!matchesContentType(input.request.headers.get("content-type"), extractor.contentTypes)) {
        return undefined;
      }
      const text = await input.body.text();
      if (!text) {
        return undefined;
      }
      const match = text.match(new RegExp(extractor.pattern));
      if (!match) {
        return undefined;
      }
      return selectRegexCapture(match, extractor.group);
    }
  }
}

function isExtractor(value: ValueExtractor | CedarValueJson): value is ValueExtractor {
  return (
    isObjectRecord(value) &&
    "source" in value &&
    typeof (value as { source?: unknown }).source === "string"
  );
}

function coerceString(value: CedarValueJson | undefined, fieldName: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw new Error(`unable to resolve required string field: ${fieldName}`);
}

async function resolveScopeId(
  env: ResolvedAuthzRuntimeEnv,
  request: Request,
  url: URL,
  body: RequestBodyAccessor,
): Promise<string | null> {
  const resolvers = parseScopeResolution(env.SCOPE_RESOLUTION);

  for (const resolver of resolvers) {
    switch (resolver.type) {
      case "path": {
        const match = url.pathname.match(new RegExp(resolver.pattern));
        const scopeId = match ? selectRegexCapture(match, resolver.group, "scopeId") : undefined;
        if (scopeId) {
          return scopeId;
        }
        break;
      }
      case "header": {
        const headerValue = request.headers.get(resolver.header);
        if (headerValue === null) {
          break;
        }
        const pattern = resolver.pattern ?? "^(.*)$";
        const match = headerValue.match(new RegExp(pattern));
        const scopeId = match ? selectRegexCapture(match, resolver.group, "scopeId") : undefined;
        if (scopeId) {
          return scopeId;
        }
        break;
      }
      case "body_json": {
        if (!matchesContentType(request.headers.get("content-type"), resolver.contentTypes)) {
          break;
        }
        try {
          const bodyJson = await body.json();
          if (bodyJson === undefined) {
            break;
          }
          const scopeId = resolveJsonPointer(bodyJson, resolver.pointer);
          if (typeof scopeId === "string" && scopeId.length > 0) {
            return scopeId;
          }
        } catch {
          break;
        }
        break;
      }
      case "body_regex": {
        if (!matchesContentType(request.headers.get("content-type"), resolver.contentTypes)) {
          break;
        }
        const text = await body.text();
        if (!text) {
          break;
        }
        const match = text.match(new RegExp(resolver.pattern));
        const scopeId = match ? selectRegexCapture(match, resolver.group, "scopeId") : undefined;
        if (scopeId) {
          return scopeId;
        }
        break;
      }
    }
  }

  return null;
}

function matchOperation(
  descriptor: PreparedServiceGlobalConfig,
  request: Request,
  url: URL,
): { prepared: PreparedAuthOperation; pathGroups: Record<string, string> } | null {
  const method = request.method.toUpperCase();

  for (const prepared of descriptor.compiledOperations) {
    if (prepared.operation.method.toUpperCase() !== method) {
      continue;
    }

    const match = url.pathname.match(prepared.pathRegex);
    if (!match) {
      continue;
    }

    return {
      prepared,
      pathGroups: match.groups ?? {},
    };
  }

  return null;
}

async function resolveOptionalStringExtractor(
  extractor: ValueExtractor | undefined,
  input: {
    request: Request;
    body: RequestBodyAccessor;
    pathGroups: Record<string, string>;
  },
  fieldName: string,
): Promise<string | undefined> {
  if (!extractor) {
    return undefined;
  }
  const resolved = await extractValue(extractor, input);
  if (resolved === undefined) {
    return undefined;
  }
  return coerceString(resolved, fieldName);
}

async function resolveOptionalExtractorValue(
  extractor: ValueExtractor | CedarValueJson | undefined,
  input: {
    request: Request;
    body: RequestBodyAccessor;
    pathGroups: Record<string, string>;
  },
): Promise<CedarValueJson | undefined> {
  if (extractor === undefined) {
    return undefined;
  }
  if (isExtractor(extractor)) {
    return await extractValue(extractor, input);
  }
  return extractor;
}

function buildPathResource(
  operation: CompiledAuthOperation,
  resourceId: string,
  attributes: Record<string, CedarValueJson>,
  pathValue: string | undefined,
  pathSpace: ResolvedPathSpace,
  kind: CedarValueJson | undefined,
): ResolvedPathResource | undefined {
  if (!pathValue && operation.resourceType !== "PathObject") {
    return undefined;
  }

  const rawPath = pathValue ?? resourceId;
  const normalized = normalizePathValue(rawPath);
  const computedKind =
    kind ?? (normalized.directoryHint ? "directory" : "file");

  attributes.path = normalized.path;
  attributes.path_prefixes = buildAncestorPrefixes(normalized.path, normalized.directoryHint);
  attributes.path_kind = computedKind;
  attributes.path_namespace = pathSpace.namespace;
  attributes.path_anchor_kind = pathSpace.anchorKind;
  attributes.path_anchor_resource_type = pathSpace.anchorResourceType ?? "";
  attributes.path_anchor_resource_id = pathSpace.anchorResourceId ?? "";

  return {
    path: normalized.path,
    ancestorPrefixes: buildAncestorPrefixes(normalized.path, normalized.directoryHint),
    namespace: pathSpace.namespace,
    ...(computedKind !== undefined ? { kind: computedKind } : {}),
    pathSpace,
    matchedGrants: [],
    matchedPermissionIds: [],
    actionAllowed: false,
    actionPermissionIds: [],
  };
}

async function resolvePathSpace(
  operation: CompiledAuthOperation,
  extractionInput: {
    request: Request;
    body: RequestBodyAccessor;
    pathGroups: Record<string, string>;
  },
  resourceType: string,
  resourceId: string,
): Promise<ResolvedPathSpace | undefined> {
  const descriptor = operation.pathSpace ?? operation.pathResource;
  if (!descriptor && operation.resourceType !== "PathObject") {
    return undefined;
  }

  const namespace = await resolveOptionalStringExtractor(
    descriptor?.namespace,
    extractionInput,
    "namespace",
  );
  const resolvedNamespace = namespace?.trim() ? namespace.trim() : "default";
  const anchorKind = descriptor?.anchorKind ?? (operation.resourceType === "PathObject" ? "service" : "resource");

  if (anchorKind === "resource") {
    const anchorResourceId = await resolveOptionalStringExtractor(
      descriptor?.anchorResourceId,
      extractionInput,
      "anchorResourceId",
    );
    return {
      namespace: resolvedNamespace,
      anchorKind,
      anchorResourceType: descriptor?.anchorResourceType ?? resourceType,
      anchorResourceId: anchorResourceId ?? resourceId,
    };
  }

  return {
    namespace: resolvedNamespace,
    anchorKind: "service",
  };
}

async function buildAuthorizationTarget(
  request: Request,
  body: RequestBodyAccessor,
  matched: { prepared: PreparedAuthOperation; pathGroups: Record<string, string> },
  scopeConfig: ScopePolicyConfig,
  serviceConfig: ServiceGlobalConfig,
): Promise<AuthorizationTarget> {
  const extractionInput = {
    request,
    body,
    pathGroups: matched.pathGroups,
  };

  const resourceId = coerceString(
    await extractValue(matched.prepared.operation.resourceId, extractionInput),
    "resourceId",
  );
  const resourceScopeId = await resolveOptionalStringExtractor(
    matched.prepared.operation.resourceScopeId,
    extractionInput,
    "resourceScopeId",
  );
  const resourceScopeTypeValue = await resolveOptionalExtractorValue(
    matched.prepared.operation.resourceScopeType,
    extractionInput,
  );

  const resourceAttributes: Record<string, CedarValueJson> = {};
  for (const [name, extractor] of Object.entries(matched.prepared.operation.resourceAttributes ?? {})) {
    const resolved = await extractValue(extractor, extractionInput);
    if (resolved !== undefined) {
      resourceAttributes[name] = resolved;
    }
  }

  const semantics = resolveOperationSemantics(matched.prepared.operation, serviceConfig);
  const pathSpace = await resolvePathSpace(
    matched.prepared.operation,
    extractionInput,
    matched.prepared.operation.resourceType,
    resourceId,
  );

  let pathResource: ResolvedPathResource | undefined;
  const pathDescriptor = matched.prepared.operation.pathSpace ?? matched.prepared.operation.pathResource;
  if (pathDescriptor && pathSpace) {
    const pathValue = await resolveOptionalStringExtractor(
      pathDescriptor.path,
      extractionInput,
      "path",
    );
    const kind = await resolveOptionalExtractorValue(
      pathDescriptor.kind,
      extractionInput,
    );
    pathResource = buildPathResource(
      matched.prepared.operation,
      resourceId,
      resourceAttributes,
      pathValue,
      pathSpace,
      kind,
    );
  } else if (matched.prepared.operation.resourceType === "PathObject" && pathSpace) {
    pathResource = buildPathResource(
      matched.prepared.operation,
      resourceId,
      resourceAttributes,
      resourceId,
      pathSpace,
      undefined,
    );
  }

  const context: Context = {};
  for (const [name, value] of Object.entries(matched.prepared.operation.context ?? {})) {
    if (isExtractor(value)) {
      const resolved = await extractValue(value, extractionInput);
      if (resolved !== undefined) {
        context[name] = resolved;
      }
      continue;
    }
    context[name] = value;
  }

  return {
    operationId: matched.prepared.operation.operationId,
    scopeId: scopeConfig.scopeId,
    scopeType: scopeConfig.scopeType ?? "",
    parentScopeId: scopeConfig.parentScopeId,
    actionId: semantics.actionId,
    permissionProfile: semantics.permissionProfile,
    permissionId: semantics.permissionId,
    targetKind: semantics.targetKind,
    resourceType: matched.prepared.operation.resourceType,
    resourceId,
    resourceScopeId: resourceScopeId ?? scopeConfig.scopeId,
    resourceScopeType:
      typeof resourceScopeTypeValue === "string"
        ? resourceScopeTypeValue
        : scopeConfig.scopeType ?? "",
    ...(Object.keys(resourceAttributes).length > 0 ? { resourceAttributes } : {}),
    ...(matched.prepared.operation.resourceParents
      ? { resourceParents: matched.prepared.operation.resourceParents }
      : {}),
    ...(Object.keys(context).length > 0 ? { context } : {}),
    ...(pathSpace ? { pathSpace } : {}),
    ...(pathResource ? { pathResource } : {}),
  };
}

export async function authorizeRequest(
  request: Request,
  env: ResolvedAuthzRuntimeEnv,
): Promise<AuthorizationDecisionDetails | null> {
  configureCaches(env);

  const preparedServiceConfig = await loadServiceConfig(env);
  const body = createRequestBodyAccessor(request);
  const url = new URL(request.url);
  const matched = matchOperation(preparedServiceConfig, request, url);
  if (!matched) {
    return null;
  }

  const scopeId = await resolveScopeId(env, request, url, body);
  if (!scopeId) {
    throw jsonResponse(
      {
        error: "scope_resolution_failed",
        message: "no scope resolver matched the protected request",
      },
      { status: 400 },
    );
  }

  const payload = await verifyJwt(request, env);
  const scopeManifest = await loadScopeManifest(env, scopeId);
  const scopeConfig = await loadScopeConfig(env, scopeId);
  const effectivePolicy = await loadEffectivePolicy(env, scopeConfig, preparedServiceConfig);
  const target = await buildAuthorizationTarget(request, body, matched, scopeConfig, preparedServiceConfig.config);
  const principal = buildPrincipal(payload, target, scopeConfig, preparedServiceConfig.config);
  const serviceId = env.SERVICE_IDENTIFIER;
  const answer = authorizeWithCedar(request, target, principal, effectivePolicy, serviceId);

  if (answer.type !== "success") {
    throw jsonResponse(
      {
        error: "authorization_evaluation_failed",
        details: answer.errors.map((issue) => issue.message),
      },
      { status: 500 },
    );
  }

  const serviceManifest = await loadServiceManifest(env);
  const decision: AuthorizationDecisionDetails = {
    service: serviceId,
    operationId: target.operationId,
    scopeId: target.scopeId,
    scopeType: target.scopeType,
    ...(target.parentScopeId ? { parentScopeId: target.parentScopeId } : {}),
    action: target.actionId,
    resource: {
      type: target.resourceType,
      id: target.resourceId,
      scopeId: target.resourceScopeId,
      scopeType: target.resourceScopeType,
    },
    decision: answer.response.decision,
    reasons: answer.response.diagnostics.reason,
    serviceVersion: serviceManifest.activeVersion,
    scopeVersion: scopeManifest.activeVersion,
    principal: {
      id: principal.uid.id,
      currentScopeRole: principal.attrs.current_scope_role,
      currentScopeRoles: principal.attrs.current_scope_roles,
      currentScopeGroups: principal.attrs.current_scope_groups,
      pathActionAllowed: principal.attrs.path_action_allowed === true,
      matchedPathPermissions: principal.attrs.path_action_permission_ids,
    },
    serviceManifest,
    scopeManifest,
    target,
    claims: payload,
    injectedHeaders: {},
  };

  decision.injectedHeaders = buildInjectedAuthzHeaders(decision);
  return decision;
}

async function handleUnauthorized<Env>(
  response: Response,
  options: AuthzRuntimeOptions<Env>,
): Promise<Response> {
  if (options.onUnauthorized) {
    return await options.onUnauthorized(response);
  }
  return response;
}

async function handleError<Env>(
  response: Response,
  options: AuthzRuntimeOptions<Env>,
): Promise<Response> {
  if (options.onError) {
    return await options.onError(response);
  }
  return response;
}

async function buildForbiddenResponse<Env>(
  decision: AuthorizationDecisionDetails,
  options: AuthzRuntimeOptions<Env>,
): Promise<Response> {
  if (options.onForbidden) {
    return await options.onForbidden(decision);
  }

  return jsonResponse(
    {
      ok: false,
      error: "forbidden",
      service: decision.service,
      operationId: decision.operationId,
      scopeId: decision.scopeId,
      scopeType: decision.scopeType,
      action: decision.action,
      resource: decision.resource,
      decision: decision.decision,
      reasons: decision.reasons,
      serviceVersion: decision.serviceVersion,
      scopeVersion: decision.scopeVersion,
      principal: decision.principal,
    },
    { status: 403 },
  );
}

function applyInjectedHeaders<Env>(
  request: Request,
  decision: AuthorizationDecisionDetails,
  options: AuthzRuntimeOptions<Env>,
): Headers {
  const headers = new Headers(request.headers);
  headers.delete("host");

  const headerSetting = options.injectAuthzHeaders;
  if (headerSetting === false) {
    return headers;
  }

  const extraHeaders =
    typeof headerSetting === "function"
      ? headerSetting(decision)
      : decision.injectedHeaders;

  for (const [name, value] of Object.entries(extraHeaders)) {
    headers.set(name, value);
  }

  return headers;
}

async function resolveUpstreamUrl<Env extends { UPSTREAM_ORIGIN?: string }>(
  request: Request,
  env: Env,
  options: AuthzRuntimeOptions<Env>,
  decision: AuthorizationDecisionDetails,
): Promise<URL> {
  if (options.resolveUpstreamUrl) {
    const resolved = await options.resolveUpstreamUrl({
      request,
      env,
      decision,
    });
    return resolved instanceof URL ? resolved : new URL(String(resolved));
  }

  if (!env.UPSTREAM_ORIGIN) {
    throw new Error("UPSTREAM_ORIGIN is not configured");
  }

  return new URL(new URL(request.url).pathname + new URL(request.url).search, env.UPSTREAM_ORIGIN);
}

async function proxyRequest<Env extends { UPSTREAM_ORIGIN?: string }>(
  request: Request,
  env: Env,
  options: AuthzRuntimeOptions<Env>,
  decision: AuthorizationDecisionDetails,
): Promise<Response> {
  const upstreamUrl = await resolveUpstreamUrl(request, env, options, decision);
  const forwarded = new Request(upstreamUrl.toString(), request);
  const headers = applyInjectedHeaders(forwarded, decision, options);
  const proxiedRequest = new Request(forwarded, {
    headers,
  });
  return await fetch(proxiedRequest);
}

async function passthroughRequest<Env extends { UPSTREAM_ORIGIN?: string }>(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.UPSTREAM_ORIGIN) {
    return new Response("not found", { status: 404 });
  }

  return await fetch(
    new Request(
      new URL(new URL(request.url).pathname + new URL(request.url).search, env.UPSTREAM_ORIGIN).toString(),
      request,
    ),
  );
}

export function createAuthzProxy<Env extends AuthzProxyEnv & { UPSTREAM_ORIGIN?: string }>(
  options: AuthzRuntimeOptions<Env> = {},
): ExportedHandler<Env> {
  return {
    async fetch(request, env): Promise<Response> {
      try {
        const runtimeEnv = resolveProxyRuntimeEnv(env);
        if (options.includeControlRoutes !== false) {
          const controlResponse = await maybeHandleControlRoute(request, runtimeEnv);
          if (controlResponse) {
            return controlResponse;
          }
        }

        const decision = await authorizeRequest(request, runtimeEnv);
        if (!decision) {
          if (options.passThroughIfUnresolved === false) {
            return new Response("not found", { status: 404 });
          }
          return await passthroughRequest(request, env);
        }

        if (decision.decision !== "allow") {
          return await buildForbiddenResponse(decision, options);
        }

        return await proxyRequest(request, env, options, decision);
      } catch (error) {
        if (error instanceof Response) {
          if (error.status === 401) {
            return await handleUnauthorized(error, options);
          }
          return await handleError(error, options);
        }

        return jsonResponse(
          {
            error: "internal_error",
            message: error instanceof Error ? error.message : String(error),
          },
          { status: 500 },
        );
      }
    },
  };
}

export function withAuthorization<Env>(
  next: (
    request: Request,
    env: Env,
    ctx: ExecutionContext,
    decision: AuthorizationDecisionDetails | null,
  ) => MaybePromise<Response>,
  options: AuthzEmbeddedOptions<Env>,
): ExportedHandler<Env> {
  return {
    async fetch(request, env, ctx): Promise<Response> {
      try {
        const runtimeConfig =
          typeof options.runtime === "function"
            ? await options.runtime({ request, env })
            : options.runtime;
        const runtimeEnv = resolveEmbeddedRuntimeEnv(runtimeConfig);
        if (options.includeControlRoutes !== false) {
          const controlResponse = await maybeHandleControlRoute(request, runtimeEnv);
          if (controlResponse) {
            return controlResponse;
          }
        }

        const decision = await authorizeRequest(request, runtimeEnv);
        if (!decision) {
          if (options.passThroughIfUnresolved === false) {
            return new Response("not found", { status: 404 });
          }
          return await next(request, env, ctx, null);
        }

        if (decision.decision !== "allow") {
          return await buildForbiddenResponse(decision, options);
        }

        return await next(request, env, ctx, decision);
      } catch (error) {
        if (error instanceof Response) {
          if (error.status === 401) {
            return await handleUnauthorized(error, options);
          }
          return await handleError(error, options);
        }

        return jsonResponse(
          {
            error: "internal_error",
            message: error instanceof Error ? error.message : String(error),
          },
          { status: 500 },
        );
      }
    },
  };
}

function requireAdmin(request: Request, env: ResolvedAuthzAdminEnv): Response | null {
  const token = request.headers.get("x-admin-token");
  if (token !== env.ADMIN_TOKEN) {
    return new Response("forbidden", { status: 403 });
  }
  return null;
}

export function healthPayload(): Record<string, unknown> {
  return {
    cedarReady,
    manifestCacheSize: manifestCache.size(),
    serviceConfigCacheSize: serviceConfigCache.size(),
    scopeConfigCacheSize: scopeConfigCache.size(),
    effectivePolicyCacheSize: effectivePolicyCache.size(),
  };
}

function validatePolicyText(policySource: string): void {
  const policySet: PolicySet = {
    staticPolicies: policySource,
  };
  const result = checkParsePolicySet(policySet);
  if (result.type !== "success") {
    throw new Error(`invalid policy text: ${cedarFailureMessage(result)}`);
  }
}

function validateGroupGraph(groups: Record<string, GroupDefinition>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (groupId: string): void => {
    if (visited.has(groupId)) {
      return;
    }
    if (visiting.has(groupId)) {
      throw new Error(`group hierarchy contains a cycle at ${groupId}`);
    }
    visiting.add(groupId);
    for (const parentId of groups[groupId]?.parentGroupIds ?? []) {
      if (groups[parentId]) {
        visit(parentId);
      }
    }
    visiting.delete(groupId);
    visited.add(groupId);
  };

  for (const groupId of Object.keys(groups)) {
    visit(groupId);
  }
}

function validateActionCatalog(
  actionCatalog: Record<string, ActionCatalogEntry>,
  permissionProfiles: Record<string, { name?: string; permissions?: string[] }>,
): void {
  for (const [actionId, entry] of Object.entries(actionCatalog)) {
    if (entry.permissionProfile && !permissionProfiles[entry.permissionProfile]) {
      throw new Error(`action ${actionId} references unknown permission profile ${entry.permissionProfile}`);
    }
  }
}

function validateBindings(
  bindings: BindingDefinition[],
  roleTemplates: Record<string, RoleTemplate>,
): void {
  for (const binding of bindings) {
    if (!binding.roleId && !binding.permissionId) {
      throw new Error(`binding for ${binding.subjectKind}:${binding.subjectId} must define roleId or permissionId`);
    }
    if (binding.roleId && !roleTemplates[binding.roleId]) {
      throw new Error(`binding references unknown role template ${binding.roleId}`);
    }
  }
}

export async function publishServiceConfig(
  body: PublishServiceConfigRequest,
  env: ResolvedAuthzAdminEnv,
): Promise<Response> {
  ensureCedarReady();

  if (!body.authDescriptor) {
    return jsonResponse({ error: "authDescriptor is required" }, { status: 400 });
  }

  try {
    validateDescriptor(body.authDescriptor);
  } catch (error) {
    return jsonResponse(
      {
        error: "invalid_auth_descriptor",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }

  const serviceConfig: ServiceGlobalConfig = {
    version: body.version ?? new Date().toISOString(),
    schemaVersion: body.schemaVersion ?? "1",
    ...(body.schema ? { schema: body.schema } : {}),
    ...(body.openApiDocument !== undefined ? { openApiDocument: body.openApiDocument } : {}),
    authDescriptor: body.authDescriptor,
    permissionProfiles: normalizePermissionProfiles(body.permissionProfiles),
    actionCatalog: normalizeActionCatalog(body.actionCatalog),
    snippets: body.snippets ?? {},
    ...(body.globalPolicy ? { globalPolicy: body.globalPolicy } : {}),
    staticEntities: body.staticEntities ?? [],
    roleTemplates: normalizeRoleTemplates((body as PublishServiceConfigRequest & { roleCatalog?: Record<string, string> }).roleTemplates ?? (body as PublishServiceConfigRequest & { roleCatalog?: Record<string, string> }).roleCatalog),
    pathPermissionCatalog: body.pathPermissionCatalog ?? {},
    namedPaths: normalizeNamedPathCatalog(body.namedPaths),
    groups: normalizeGroups(body.groups),
    metadata: body.metadata ?? {},
  };

  try {
    validateActionCatalog(serviceConfig.actionCatalog ?? {}, serviceConfig.permissionProfiles ?? {});
    validateGroupGraph(serviceConfig.groups ?? {});
  } catch (error) {
    return jsonResponse(
      {
        error: "invalid_service_config",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }

  const validationSource = [
    ...(serviceConfig.globalPolicy?.trim() ? [serviceConfig.globalPolicy.trim()] : []),
    ...Object.values(serviceConfig.snippets)
      .map((value) => value.trim())
      .filter(Boolean),
  ].join("\n\n");

  if (validationSource) {
    try {
      validatePolicyText(validationSource);
    } catch (error) {
      return jsonResponse(
        {
          error: "invalid_global_policy",
          message: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      );
    }
  }

  const serviceId = env.SERVICE_IDENTIFIER;
  const manifest: VersionManifest = {
    service: serviceId,
    scopeType: "service",
    scopeId: serviceId,
    activeVersion: serviceConfig.version,
    generatedAt: new Date().toISOString(),
  };

  await env.POLICY_BUCKET.put(
    buildServiceConfigKey(env.POLICY_ROOT, serviceConfig.version),
    JSON.stringify(serviceConfig, null, 2),
    {
      httpMetadata: { contentType: "application/json" },
    },
  );
  await env.POLICY_BUCKET.put(buildServiceManifestKey(env.POLICY_ROOT), JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });

  return jsonResponse({
    ok: true,
    service: serviceId,
    version: serviceConfig.version,
    manifestKey: buildServiceManifestKey(env.POLICY_ROOT),
    configKey: buildServiceConfigKey(env.POLICY_ROOT, serviceConfig.version),
  });
}

export async function publishScopeConfig(
  body: PublishScopeConfigRequest,
  env: ResolvedAuthzAdminEnv,
): Promise<Response> {
  ensureCedarReady();

  if (!body.scopeId) {
    return jsonResponse({ error: "scopeId is required" }, { status: 400 });
  }

  let preparedServiceConfig: PreparedServiceGlobalConfig;
  try {
    preparedServiceConfig = await loadServiceConfig(env, {
      bypassInMemoryCache: true,
      bypassEdgeCache: true,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: "service_config_missing",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 404 },
    );
  }

  const scopeConfig: ScopePolicyConfig = {
    version: body.version ?? new Date().toISOString(),
    scopeId: body.scopeId,
    claimId: body.claimId,
    scopeType: body.scopeType,
    parentScopeId: body.parentScopeId,
    includes: body.includes ?? [],
    policy: body.policy,
    namedPaths: normalizeNamedPathCatalog(body.namedPaths),
    groups: normalizeGroups(body.groups),
    bindings: normalizeBindings(body.bindings),
    staticEntities: body.staticEntities ?? [],
    metadata: body.metadata ?? {},
  };

  try {
    validateGroupGraph(scopeConfig.groups ?? {});
    validateBindings(scopeConfig.bindings ?? [], preparedServiceConfig.config.roleTemplates ?? {});
  } catch (error) {
    return jsonResponse(
      {
        error: "invalid_scope_config",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }

  for (const includeId of scopeConfig.includes) {
    if (!preparedServiceConfig.config.snippets[includeId]) {
      return jsonResponse(
        {
          error: "unknown_policy_include",
          includeId,
        },
        { status: 400 },
      );
    }
  }

  try {
    const validationSource = assembleEffectivePolicySource(preparedServiceConfig.config, scopeConfig);
    if (validationSource) {
      validatePolicyText(validationSource);
    }
  } catch (error) {
    return jsonResponse(
      {
        error: "invalid_scope_policy",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }

  const serviceId = env.SERVICE_IDENTIFIER;
  const manifest: VersionManifest = {
    service: serviceId,
    scopeType: "scope",
    scopeId: scopeConfig.scopeId,
    activeVersion: scopeConfig.version,
    generatedAt: new Date().toISOString(),
  };

  await env.POLICY_BUCKET.put(
    buildScopeConfigKey(env.POLICY_ROOT, scopeConfig.scopeId, scopeConfig.version),
    stringifyYaml(scopeConfig),
    {
      httpMetadata: { contentType: "application/yaml" },
    },
  );
  await env.POLICY_BUCKET.put(
    buildScopeManifestKey(env.POLICY_ROOT, scopeConfig.scopeId),
    JSON.stringify(manifest, null, 2),
    {
      httpMetadata: { contentType: "application/json" },
    },
  );

  return jsonResponse({
    ok: true,
    scopeId: scopeConfig.scopeId,
    version: scopeConfig.version,
    manifestKey: buildScopeManifestKey(env.POLICY_ROOT, scopeConfig.scopeId),
    configKey: buildScopeConfigKey(env.POLICY_ROOT, scopeConfig.scopeId, scopeConfig.version),
  });
}

export async function invalidateCaches(
  body: InvalidateCacheRequest,
  env: ResolvedAuthzAdminEnv,
): Promise<Response> {
  const cacheNamespace = normalizePolicyRoot(env.POLICY_ROOT);
  if (body.service) {
    manifestCache.delete(`${cacheNamespace}:service-manifest`);
    serviceConfigCache.deleteWhere((key) => key.startsWith(`${cacheNamespace}:`));
    effectivePolicyCache.clear();
    await getEdgeCache().delete(buildPolicyCacheRequest(buildServiceManifestKey(env.POLICY_ROOT)));
  }

  if (body.scopeId) {
    manifestCache.delete(`${cacheNamespace}:${body.scopeId}:scope-manifest`);
    scopeConfigCache.deleteWhere((key) => key.startsWith(`${cacheNamespace}:${body.scopeId}:`));
    effectivePolicyCache.deleteWhere((key) => key.includes(`:${body.scopeId}:`));
    await getEdgeCache().delete(
      buildPolicyCacheRequest(buildScopeManifestKey(env.POLICY_ROOT, body.scopeId)),
    );
  }

  return jsonResponse({
    ok: true,
    serviceCleared: body.service === true,
    scopeId: body.scopeId ?? null,
    manifestCacheSize: manifestCache.size(),
    serviceConfigCacheSize: serviceConfigCache.size(),
    scopeConfigCacheSize: scopeConfigCache.size(),
    effectivePolicyCacheSize: effectivePolicyCache.size(),
  });
}

export async function maybeHandleAdminRoute(
  request: Request,
  env: AuthzAdminEnv,
): Promise<Response | null> {
  const runtimeEnv = resolveAdminRuntimeEnv(env);
  configureCaches(runtimeEnv);

  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/internal/service-config/publish") {
    const adminError = requireAdmin(request, runtimeEnv);
    if (adminError) {
      return adminError;
    }
    const body = await readJson<PublishServiceConfigRequest>(request);
    return await publishServiceConfig(body, runtimeEnv);
  }

  if (request.method === "POST" && url.pathname === "/internal/scope-config/publish") {
    const adminError = requireAdmin(request, runtimeEnv);
    if (adminError) {
      return adminError;
    }
    const body = await readJson<PublishScopeConfigRequest>(request);
    return await publishScopeConfig(body, runtimeEnv);
  }

  if (request.method === "POST" && url.pathname === "/internal/cache/invalidate") {
    const adminError = requireAdmin(request, runtimeEnv);
    if (adminError) {
      return adminError;
    }
    const body = await readJson<InvalidateCacheRequest>(request);
    return await invalidateCaches(body, runtimeEnv);
  }

  return null;
}

export async function maybeHandleControlRoute(
  request: Request,
  env: ResolvedAuthzRuntimeEnv,
): Promise<Response | null> {
  configureCaches(env);

  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse(healthPayload());
  }

  return null;
}
