import managementOpenApi from "../../openapi/management-service.openapi.yaml";

import type { Binding, PathGrant, Scope, ServiceVocabulary, Subject } from "../control-plane/domain";
import { sha256 } from "../authn/crypto";
import { R2ManagementPublisher } from "./publisher";
import { D1ManagementRepository, type ScopeDraft, type ServiceDraft } from "./repository";
import { ManagementError, ManagementService } from "./service";
import { handleScimRequest, scimError } from "./scim";
import {
  createBreakGlassGrant,
  createChangeRequest,
  invalidateProjections,
  listBreakGlassGrants,
  listChangeRequests,
  operationsStatus,
  projectedClaims,
  rebuildDirtyProjections,
  recordReplication,
  reviewBreakGlassGrant,
  reviewChangeRequest,
} from "./hardening";
export { MANAGEMENT_ROUTES } from "./routes";

export interface ManagementWorkerEnv {
  CONTROL_DB: D1Database;
  POLICY_BUCKET: R2Bucket;
  MANAGEMENT_BOOTSTRAP_TOKEN: string;
  AUTHZ_ADMIN_URL?: string;
  AUTHZ_ADMIN_TOKEN?: string;
  AUTHZ_ADMIN?: Fetcher;
  CORS_ORIGIN?: string;
  SCIM_BEARER_TOKEN?: string;
  AUTHZ_REMOTE_PUBLISH?: string;
  POLICY_REPLICA_BUCKET?: R2Bucket;
  ENTITLEMENT_EVENTS?: Queue;
  REQUIRE_PUBLISH_APPROVAL?: string;
  BREAK_GLASS_MAX_SECONDS?: string;
  AUTHZ_GATEWAY_TOKEN?: string;
}

function publisherFor(env: ManagementWorkerEnv): R2ManagementPublisher {
  return new R2ManagementPublisher({
    bucket: env.POLICY_BUCKET,
    ...(env.AUTHZ_ADMIN_URL ? { authzAdminUrl: env.AUTHZ_ADMIN_URL } : {}),
    ...(env.AUTHZ_ADMIN_TOKEN ? { authzAdminToken: env.AUTHZ_ADMIN_TOKEN } : {}),
    ...(env.AUTHZ_ADMIN ? { authzAdminFetcher: env.AUTHZ_ADMIN } : {}),
    publishRemotely: env.AUTHZ_REMOTE_PUBLISH === "true",
    ...(env.POLICY_REPLICA_BUCKET ? { replicas: [{ name: "secondary", bucket: env.POLICY_REPLICA_BUCKET }] } : {}),
    onReplication: (event) => recordReplication(env.CONTROL_DB, event),
  });
}

function applyCors(headers: Headers, origin: string): Headers {
  if (!origin) return headers;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-headers", "authorization, content-type, idempotency-key, if-match");
  headers.set("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  return headers;
}

function response(value: unknown, status = 200, origin = ""): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  return Response.json(value, { status, headers: applyCors(headers, origin) });
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function empty(status: number, origin = ""): Response {
  return new Response(null, { status, headers: applyCors(new Headers(), origin) });
}

async function body<T>(request: Request): Promise<T> {
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > 1024 * 1024) throw new ManagementError("invalid_request", "request body is too large", 413);
  try { return await request.json<T>(); }
  catch { throw new ManagementError("invalid_request", "request body must be valid JSON", 400); }
}

async function optionalBody<T>(request: Request, fallback: T): Promise<T> {
  const text = await request.clone().text();
  if (!text.trim()) return fallback;
  return body<T>(request);
}

function match(path: string, pattern: string): Record<string, string> | undefined {
  const names: string[] = [];
  const regex = new RegExp(`^${pattern.replace(/\{([^}]+)\}/g, (_token, name: string) => {
    names.push(name);
    return "([^/]+)";
  })}$`);
  const result = path.match(regex);
  if (!result) return undefined;
  return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(result[index + 1]!)]));
}

function actor(request: Request, env: ManagementWorkerEnv): string {
  const trustedGateway = !!env.AUTHZ_GATEWAY_TOKEN &&
    request.headers.get("x-authz-gateway-token") === env.AUTHZ_GATEWAY_TOKEN;
  const gatewayActor = trustedGateway && request.headers.get("x-authz-decision") === "allow"
    ? request.headers.get("x-authz-principal-id")
    : undefined;
  if (gatewayActor) return gatewayActor;
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (token && token === env.MANAGEMENT_BOOTSTRAP_TOKEN) return "bootstrap-admin";
  throw new ManagementError("unauthorized", "management authentication is required", 401);
}

async function idempotent(
  request: Request,
  env: ManagementWorkerEnv,
  actorId: string,
  execute: () => Promise<Response>,
): Promise<Response> {
  const key = request.headers.get("idempotency-key");
  if (!key || ["GET", "HEAD", "DELETE"].includes(request.method)) return execute();
  if (key.length > 128) throw new ManagementError("invalid_request", "idempotency key is too long", 400);
  const requestHash = await sha256(await request.clone().text());
  const existing = await env.CONTROL_DB.prepare(`SELECT * FROM idempotency_keys
    WHERE idempotency_key = ? AND actor_id = ? AND expires_at > ?`).bind(key, actorId, new Date().toISOString()).first<{
      method: string; path: string; request_hash: string; response_status: number; response_json: string;
    }>();
  const path = new URL(request.url).pathname;
  if (existing) {
    if (existing.method !== request.method || existing.path !== path || existing.request_hash !== requestHash) {
      throw new ManagementError("idempotency_conflict", "idempotency key was used for a different request", 409);
    }
    return new Response(existing.response_json, { status: existing.response_status, headers: { "content-type": "application/json; charset=utf-8", "x-idempotent-replay": "true" } });
  }
  const result = await execute();
  if (result.status >= 200 && result.status < 300 && result.headers.get("content-type")?.includes("application/json")) {
    const serialized = await result.clone().text();
    const now = new Date();
    await env.CONTROL_DB.prepare(`INSERT INTO idempotency_keys
      (idempotency_key, actor_id, method, path, request_hash, response_status, response_json, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      key, actorId, request.method, path, requestHash, result.status, serialized,
      now.toISOString(), new Date(now.getTime() + 86_400_000).toISOString(),
    ).run();
  }
  return result;
}

async function route(request: Request, env: ManagementWorkerEnv, actorId: string, origin: string): Promise<Response> {
  const url = new URL(request.url);
  const repository = new D1ManagementRepository(env.CONTROL_DB);
  const publisher = publisherFor(env);
  const service = new ManagementService(repository, publisher);
  const { pathname } = url;

  if (request.method === "GET" && pathname === "/services") return response({ items: await repository.listServices() }, 200, origin);
  if (request.method === "POST" && pathname === "/services") {
    const input = await body<{ serviceId: string; name: string; description?: string; vocabulary: ServiceVocabulary }>(request);
    return response(await service.createService(input, actorId), 201, origin);
  }
  let values = match(pathname, "/services/{serviceId}/vocabulary");
  if (values && request.method === "GET") {
    const item = await repository.getService(values.serviceId!);
    if (!item) throw new ManagementError("not_found", "service not found", 404);
    return response(item.vocabulary, 200, origin);
  }
  if (values && request.method === "PUT") {
    const expected = request.headers.get("if-match");
    return response(await service.putVocabulary(values.serviceId!, await body<ServiceVocabulary>(request), actorId, expected ? Number(expected.replace(/\D/g, "")) : undefined), 200, origin);
  }
  values = match(pathname, "/services/{serviceId}/import-openapi");
  if (values && request.method === "POST") {
    const input = await body<{ document: unknown }>(request);
    return response(await service.importOpenApi(values.serviceId!, input.document, actorId), 200, origin);
  }
  values = match(pathname, "/services/{serviceId}/config");
  if (values && request.method === "GET") return response(await repository.getServiceDraft(values.serviceId!) ?? null, 200, origin);
  if (values && request.method === "PUT") return response(await service.putServiceDraft(values.serviceId!, await body<Omit<ServiceDraft, "serviceId" | "updatedAt">>(request), actorId), 200, origin);
  values = match(pathname, "/services/{serviceId}/versions");
  if (values && request.method === "GET") return response({ items: await repository.listConfigVersions(values.serviceId!) }, 200, origin);
  values = match(pathname, "/services/{serviceId}/publish");
  if (values && request.method === "POST") {
    if (env.REQUIRE_PUBLISH_APPROVAL === "true") {
      throw new ManagementError("approval_required", "service publication requires an approved change request", 409);
    }
    const input = await optionalBody<{ version?: string }>(request, {});
    return response(await service.publishService(values.serviceId!, actorId, input.version), 201, origin);
  }
  values = match(pathname, "/services/{serviceId}/cache/invalidate");
  if (values && request.method === "POST") {
    const input = await optionalBody<{ scopeId?: string }>(request, {});
    await publisher.invalidate(values.serviceId!, input.scopeId);
    return response({ ok: true }, 200, origin);
  }
  values = match(pathname, "/services/{serviceId}/subjects/{subjectId}/claim-preview");
  if (values && request.method === "GET") {
    return response(await projectedClaims(env.CONTROL_DB, repository, service, values.serviceId!, values.subjectId!), 200, origin);
  }

  if (pathname === "/change-requests" && request.method === "GET") {
    return response({ items: await listChangeRequests(env.CONTROL_DB, url.searchParams.get("status") ?? undefined) }, 200, origin);
  }
  if (pathname === "/change-requests" && request.method === "POST") {
    return response(await createChangeRequest(env.CONTROL_DB, repository, await body(request), actorId), 201, origin);
  }
  values = match(pathname, "/change-requests/{requestId}/approve");
  if (values && request.method === "POST") {
    const input = await optionalBody<{ note?: string }>(request, {});
    return response(await reviewChangeRequest(env.CONTROL_DB, service, values.requestId!, "approve", actorId, input.note), 200, origin);
  }
  values = match(pathname, "/change-requests/{requestId}/reject");
  if (values && request.method === "POST") {
    const input = await optionalBody<{ note?: string }>(request, {});
    return response(await reviewChangeRequest(env.CONTROL_DB, service, values.requestId!, "reject", actorId, input.note), 200, origin);
  }

  if (pathname === "/break-glass-grants" && request.method === "GET") {
    return response({ items: await listBreakGlassGrants(env.CONTROL_DB, url.searchParams.get("status") ?? undefined) }, 200, origin);
  }
  if (pathname === "/break-glass-grants" && request.method === "POST") {
    return response(await createBreakGlassGrant(
      env.CONTROL_DB,
      repository,
      await body(request),
      actorId,
      parsePositiveInt(env.BREAK_GLASS_MAX_SECONDS, 3600),
    ), 201, origin);
  }
  values = match(pathname, "/break-glass-grants/{grantId}/approve");
  if (values && request.method === "POST") return response(await reviewBreakGlassGrant(env.CONTROL_DB, values.grantId!, "approve", actorId), 200, origin);
  values = match(pathname, "/break-glass-grants/{grantId}/reject");
  if (values && request.method === "POST") return response(await reviewBreakGlassGrant(env.CONTROL_DB, values.grantId!, "reject", actorId), 200, origin);
  values = match(pathname, "/break-glass-grants/{grantId}/revoke");
  if (values && request.method === "POST") return response(await reviewBreakGlassGrant(env.CONTROL_DB, values.grantId!, "revoke", actorId), 200, origin);

  if (pathname === "/operations/status" && request.method === "GET") {
    return response(await operationsStatus(env.CONTROL_DB), 200, origin);
  }
  if (pathname === "/operations/projections/rebuild" && request.method === "POST") {
    return response(await rebuildDirtyProjections(env.CONTROL_DB, repository, service), 200, origin);
  }

  if (pathname === "/subjects" && request.method === "GET") return response({ items: await repository.listSubjects() }, 200, origin);
  if (pathname === "/subjects" && request.method === "POST") {
    const input = await body<Omit<Subject, "createdAt" | "updatedAt">>(request);
    return response(await service.putSubject(input, actorId), 201, origin);
  }
  values = match(pathname, "/subjects/{subjectId}");
  if (values && request.method === "GET") {
    const item = await repository.getSubject(values.subjectId!);
    if (!item) throw new ManagementError("not_found", "subject not found", 404);
    return response(item, 200, origin);
  }
  if (values && request.method === "PATCH") {
    const existing = await repository.getSubject(values.subjectId!);
    if (!existing) throw new ManagementError("not_found", "subject not found", 404);
    const patch = await body<Partial<Subject>>(request);
    return response(await service.putSubject({ ...existing, ...patch, subjectId: existing.subjectId }, actorId), 200, origin);
  }

  if (pathname === "/scopes" && request.method === "GET") {
    const serviceId = url.searchParams.get("serviceId");
    if (!serviceId) throw new ManagementError("invalid_request", "serviceId query parameter is required");
    return response({ items: await repository.listScopes(serviceId) }, 200, origin);
  }
  if (pathname === "/scopes" && request.method === "POST") {
    return response(await service.createScope(await body<Omit<Scope, "createdAt" | "updatedAt" | "activeVersion">>(request), actorId), 201, origin);
  }
  values = match(pathname, "/scopes/{scopeId}");
  if (values && request.method === "GET") {
    const item = await repository.getScope(values.scopeId!);
    if (!item) throw new ManagementError("not_found", "scope not found", 404);
    return response(item, 200, origin);
  }
  if (values && request.method === "PATCH") return response(await service.updateScope(values.scopeId!, await body(request), actorId), 200, origin);
  values = match(pathname, "/scopes/{scopeId}/config");
  if (values && request.method === "GET") return response(await repository.getScopeDraft(values.scopeId!) ?? null, 200, origin);
  if (values && request.method === "PUT") return response(await service.putScopeDraft(values.scopeId!, await body<Omit<ScopeDraft, "scopeId" | "updatedAt">>(request), actorId), 200, origin);
  values = match(pathname, "/scopes/{scopeId}/versions");
  if (values && request.method === "GET") {
    const scope = await repository.getScope(values.scopeId!);
    if (!scope) throw new ManagementError("not_found", "scope not found", 404);
    return response({ items: await repository.listConfigVersions(scope.serviceId, scope.scopeId) }, 200, origin);
  }
  values = match(pathname, "/scopes/{scopeId}/groups");
  if (values && request.method === "GET") return response({ items: await repository.listGroups(values.scopeId!), members: await repository.listGroupMembers(values.scopeId!) }, 200, origin);
  if (values && request.method === "POST") return response(await service.putGroup(values.scopeId!, await body(request), actorId), 201, origin);
  values = match(pathname, "/scopes/{scopeId}/groups/{groupId}");
  if (values && request.method === "DELETE") { await service.deleteGroup(values.scopeId!, values.groupId!, actorId); return empty(204, origin); }
  values = match(pathname, "/scopes/{scopeId}/groups/{groupId}/members/{subjectId}");
  if (values && request.method === "PUT") {
    const input = await body<{ memberKind: "User" | "ServiceAccount" | "Group" }>(request);
    return response(await service.putGroupMember(values.scopeId!, values.groupId!, values.subjectId!, input.memberKind, actorId), 200, origin);
  }
  if (values && request.method === "DELETE") { await service.deleteGroupMember(values.scopeId!, values.groupId!, values.subjectId!, actorId); return empty(204, origin); }
  values = match(pathname, "/scopes/{scopeId}/bindings");
  if (values && request.method === "GET") return response({ items: await repository.listBindings(values.scopeId!) }, 200, origin);
  if (values && request.method === "POST") return response(await service.putBinding(values.scopeId!, await body<Omit<Binding, "scopeId" | "createdAt" | "updatedAt">>(request), actorId), 201, origin);
  values = match(pathname, "/scopes/{scopeId}/bindings/{bindingId}");
  if (values && request.method === "DELETE") { await service.deleteBinding(values.scopeId!, values.bindingId!, actorId); return empty(204, origin); }
  values = match(pathname, "/scopes/{scopeId}/path-grants");
  if (values && request.method === "GET") return response({ items: await repository.listPathGrants(values.scopeId!) }, 200, origin);
  if (values && request.method === "POST") return response(await service.putPathGrant(values.scopeId!, await body<Omit<PathGrant, "scopeId" | "createdAt" | "updatedAt">>(request), actorId), 201, origin);
  values = match(pathname, "/scopes/{scopeId}/path-grants/{pathGrantId}");
  if (values && request.method === "DELETE") { await service.deletePathGrant(values.scopeId!, values.pathGrantId!, actorId); return empty(204, origin); }
  values = match(pathname, "/scopes/{scopeId}/publish");
  if (values && request.method === "POST") {
    if (env.REQUIRE_PUBLISH_APPROVAL === "true") {
      throw new ManagementError("approval_required", "scope publication requires an approved change request", 409);
    }
    const input = await optionalBody<{ version?: string }>(request, {});
    return response(await service.publishScope(values.scopeId!, actorId, input.version), 201, origin);
  }
  if (pathname === "/simulations" && request.method === "POST") return response(await service.simulate(await body(request)), 200, origin);
  if (pathname === "/audit-events" && request.method === "GET") return response({ items: await repository.listAudit(url.searchParams.get("serviceId") ?? undefined) }, 200, origin);
  throw new ManagementError("not_found", "route not found", 404);
}

export async function handleManagementRequest(request: Request, env: ManagementWorkerEnv): Promise<Response> {
  const origin = env.CORS_ORIGIN ?? "";
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return empty(204, origin);
  if (request.method === "GET" && url.pathname === "/health") return response({ status: "ok", service: "management" }, 200, origin);
  if (request.method === "GET" && url.pathname === "/openapi/management-service.openapi.yaml") {
    return new Response(managementOpenApi, { headers: applyCors(new Headers({
      "content-type": "application/yaml; charset=utf-8",
      "cache-control": "public, max-age=300",
    }), origin) });
  }
  if (url.pathname.startsWith("/scim/v2/")) {
    try {
      const token = bearerToken(request);
      if (!env.SCIM_BEARER_TOKEN || token !== env.SCIM_BEARER_TOKEN) {
        throw new ManagementError("unauthorized", "SCIM bearer token is required", 401);
      }
      const repository = new D1ManagementRepository(env.CONTROL_DB);
      const publisher = publisherFor(env);
      const result = await handleScimRequest(
        request,
        env.CONTROL_DB,
        repository,
        new ManagementService(repository, publisher),
        "scim-provisioner",
      );
      if (!["GET", "HEAD"].includes(request.method) && result.status < 400) {
        await recordManagementMutation(env, request);
      }
      return result;
    } catch (error) {
      return scimError(error);
    }
  }
  try {
    const actorId = actor(request, env);
    const result = await idempotent(request, env, actorId, () => route(request, env, actorId, origin));
    if (!["GET", "HEAD"].includes(request.method) && result.status < 400) {
      await recordManagementMutation(env, request);
    }
    return result;
  } catch (error) {
    if (error instanceof ManagementError) {
      return response({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }, error.status, origin);
    }
    console.error("management request failed", error instanceof Error ? error.message : "unknown error");
    return response({ error: { code: "internal_error", message: "request failed" } }, 500, origin);
  }
}

function bearerToken(request: Request): string | undefined {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
}

async function recordManagementMutation(env: ManagementWorkerEnv, request: Request): Promise<void> {
  const path = new URL(request.url).pathname;
  if (path === "/simulations" || path.endsWith("/cache/invalidate") || path === "/operations/projections/rebuild") return;
  await invalidateProjections(env.CONTROL_DB, path);
  await env.ENTITLEMENT_EVENTS?.send({ reason: "management.mutation", path, at: new Date().toISOString() });
}

export default {
  fetch: handleManagementRequest,
  async scheduled(_controller: ScheduledController, env: ManagementWorkerEnv, ctx: ExecutionContext) {
    const repository = new D1ManagementRepository(env.CONTROL_DB);
    const service = new ManagementService(repository, publisherFor(env));
    ctx.waitUntil(rebuildDirtyProjections(env.CONTROL_DB, repository, service, 100));
  },
} satisfies ExportedHandler<ManagementWorkerEnv>;
