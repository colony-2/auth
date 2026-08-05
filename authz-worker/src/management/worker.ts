import managementOpenApi from "../../openapi/management-service.openapi.yaml";

import type { Binding, PathGrant, Scope, ServiceVocabulary, Subject } from "../control-plane/domain";
import { sha256 } from "../authn/crypto";
import { R2ManagementPublisher } from "./publisher";
import { D1ManagementRepository, type ScopeDraft, type ServiceDraft } from "./repository";
import { ManagementError, ManagementService } from "./service";
export { MANAGEMENT_ROUTES } from "./routes";

export interface ManagementWorkerEnv {
  CONTROL_DB: D1Database;
  POLICY_BUCKET: R2Bucket;
  MANAGEMENT_BOOTSTRAP_TOKEN: string;
  AUTHZ_ADMIN_URL?: string;
  AUTHZ_ADMIN_TOKEN?: string;
  AUTHZ_ADMIN?: Fetcher;
  CORS_ORIGIN?: string;
}

function response(value: unknown, status = 200, origin = ""): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-headers", "authorization, content-type, idempotency-key, if-match");
    headers.set("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  }
  return Response.json(value, { status, headers });
}

function empty(status: number, origin = ""): Response {
  return new Response(null, { status, headers: origin ? { "access-control-allow-origin": origin } : {} });
}

async function body<T>(request: Request): Promise<T> {
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > 1024 * 1024) throw new ManagementError("invalid_request", "request body is too large", 413);
  try { return await request.json<T>(); }
  catch { throw new ManagementError("invalid_request", "request body must be valid JSON", 400); }
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
  const gatewayActor = request.headers.get("x-authz-decision") === "allow"
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
  const publisher = new R2ManagementPublisher({
    bucket: env.POLICY_BUCKET,
    ...(env.AUTHZ_ADMIN_URL ? { authzAdminUrl: env.AUTHZ_ADMIN_URL } : {}),
    ...(env.AUTHZ_ADMIN_TOKEN ? { authzAdminToken: env.AUTHZ_ADMIN_TOKEN } : {}),
    ...(env.AUTHZ_ADMIN ? { authzAdminFetcher: env.AUTHZ_ADMIN } : {}),
  });
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
    const input = await body<{ version?: string }>(request);
    return response(await service.publishService(values.serviceId!, actorId, input.version), 201, origin);
  }
  values = match(pathname, "/services/{serviceId}/cache/invalidate");
  if (values && request.method === "POST") {
    const input = await body<{ scopeId?: string }>(request);
    await publisher.invalidate(values.serviceId!, input.scopeId);
    return response({ ok: true }, 200, origin);
  }
  values = match(pathname, "/services/{serviceId}/subjects/{subjectId}/claim-preview");
  if (values && request.method === "GET") return response(await service.claimPreview(values.serviceId!, values.subjectId!), 200, origin);

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
    const input = await body<{ version?: string }>(request);
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
    return new Response(managementOpenApi, { headers: { "content-type": "application/yaml; charset=utf-8", "cache-control": "public, max-age=300" } });
  }
  try {
    const actorId = actor(request, env);
    return await idempotent(request, env, actorId, () => route(request, env, actorId, origin));
  } catch (error) {
    if (error instanceof ManagementError) {
      return response({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }, error.status, origin);
    }
    console.error("management request failed", error instanceof Error ? error.message : "unknown error");
    return response({ error: { code: "internal_error", message: "request failed" } }, 500, origin);
  }
}

export default { fetch: handleManagementRequest } satisfies ExportedHandler<ManagementWorkerEnv>;
