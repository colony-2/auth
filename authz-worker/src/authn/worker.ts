import { D1AuthnRepository } from "./repository";
import { AuthenticationService, AuthnError } from "./service";
import { sha256 } from "./crypto";
import type { AuthnConfig, PublicJwk, RequestMetadata } from "./types";

export interface AuthnWorkerEnv {
  CONTROL_DB: D1Database;
  JWT_ISSUER: string;
  JWT_PRIVATE_JWK: string;
  JWT_PUBLIC_JWKS: string;
  JWT_KEY_ID: string;
  JWT_ALGORITHM?: "RS256" | "ES256";
  ALLOWED_AUDIENCES: string;
  ACCESS_TOKEN_SECONDS?: string;
  REFRESH_TOKEN_SECONDS?: string;
  MAX_SCOPE_CLAIMS?: string;
  INTERNAL_AUTH_TOKEN: string;
  IP_HASH_SECRET: string;
  CORS_ORIGIN?: string;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function configFromEnv(env: AuthnWorkerEnv): AuthnConfig {
  const jwks = JSON.parse(env.JWT_PUBLIC_JWKS) as { keys?: PublicJwk[] } | PublicJwk[];
  const publicJwks = Array.isArray(jwks) ? jwks : jwks.keys;
  if (!publicJwks?.length) throw new Error("JWT_PUBLIC_JWKS must contain at least one public key");
  return {
    issuer: env.JWT_ISSUER,
    privateJwk: JSON.parse(env.JWT_PRIVATE_JWK) as Record<string, unknown>,
    publicJwks,
    keyId: env.JWT_KEY_ID,
    algorithm: env.JWT_ALGORITHM ?? "ES256",
    allowedAudiences: env.ALLOWED_AUDIENCES.split(",").map((value) => value.trim()).filter(Boolean),
    accessTokenSeconds: parsePositiveInt(env.ACCESS_TOKEN_SECONDS, 600),
    refreshTokenSeconds: parsePositiveInt(env.REFRESH_TOKEN_SECONDS, 2_592_000),
    maxScopeClaims: parsePositiveInt(env.MAX_SCOPE_CLAIMS, 64),
  };
}

async function jsonBody<T>(request: Request): Promise<T> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 64 * 1024) throw new AuthnError("invalid_request", "request body is too large", 413);
  try {
    return await request.json<T>();
  } catch {
    throw new AuthnError("invalid_request", "request body must be valid JSON", 400);
  }
}

function bearer(request: Request): string | undefined {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function json(value: unknown, init: ResponseInit = {}, origin = ""): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-headers", "authorization, content-type");
    headers.set("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  }
  return Response.json(value, { ...init, headers });
}

async function metadata(request: Request, env: AuthnWorkerEnv): Promise<RequestMetadata> {
  const ip = request.headers.get("cf-connecting-ip");
  return {
    ...(request.headers.get("user-agent") ? { userAgent: request.headers.get("user-agent")! } : {}),
    ...(ip ? { ipHash: await sha256(`${env.IP_HASH_SECRET}:${ip}`) } : {}),
  };
}

async function authenticatedSubject(request: Request, service: AuthenticationService): Promise<string> {
  const token = bearer(request);
  if (!token) throw new AuthnError("invalid_token", "bearer token is required", 401);
  const payload = await service.verifyAccessToken(token);
  if (!payload.sub) throw new AuthnError("invalid_token", "token subject is missing", 401);
  return payload.sub;
}

export async function handleAuthnRequest(request: Request, env: AuthnWorkerEnv): Promise<Response> {
  const origin = env.CORS_ORIGIN ?? "";
  if (request.method === "OPTIONS") return json({}, { status: 204 }, origin);
  const url = new URL(request.url);
  const repository = new D1AuthnRepository(env.CONTROL_DB);
  const service = new AuthenticationService(repository, configFromEnv(env));

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", service: "authentication" }, {}, origin);
    }
    if (request.method === "GET" && url.pathname === "/.well-known/jwks.json") {
      const response = json(service.jwks(), {}, origin);
      response.headers.set("cache-control", "public, max-age=300, stale-while-revalidate=3600");
      return response;
    }
    if (request.method === "POST" && url.pathname === "/auth/login") {
      const body = await jsonBody<{ username?: string; password?: string; audience?: string; mfaCode?: string }>(request);
      if (!body.username || !body.password || !body.audience) throw new AuthnError("invalid_request", "username, password, and audience are required");
      return json(await service.login({ username: body.username, password: body.password, audience: body.audience, ...(body.mfaCode ? { mfaCode: body.mfaCode } : {}) }, await metadata(request, env)), {}, origin);
    }
    if (request.method === "POST" && url.pathname === "/auth/refresh") {
      const body = await jsonBody<{ refreshToken?: string }>(request);
      if (!body.refreshToken) throw new AuthnError("invalid_request", "refreshToken is required");
      return json(await service.refresh(body.refreshToken, await metadata(request, env)), {}, origin);
    }
    if (request.method === "POST" && url.pathname === "/auth/logout") {
      const body = await jsonBody<{ refreshToken?: string }>(request);
      if (!body.refreshToken) throw new AuthnError("invalid_request", "refreshToken is required");
      await service.logout(body.refreshToken);
      return new Response(null, { status: 204, headers: origin ? { "access-control-allow-origin": origin } : {} });
    }
    if (request.method === "POST" && url.pathname === "/auth/introspect") {
      if (request.headers.get("x-internal-auth-token") !== env.INTERNAL_AUTH_TOKEN) {
        throw new AuthnError("invalid_token", "internal authentication is required", 401);
      }
      const body = await jsonBody<{ token?: string }>(request);
      if (!body.token) throw new AuthnError("invalid_request", "token is required");
      return json(await service.introspect(body.token), {}, origin);
    }
    const serviceAccountMatch = url.pathname.match(/^\/service-accounts\/([^/]+)\/tokens$/);
    if (request.method === "POST" && serviceAccountMatch) {
      const body = await jsonBody<{ clientSecret?: string; audience?: string }>(request);
      if (!body.clientSecret || !body.audience) throw new AuthnError("invalid_request", "clientSecret and audience are required");
      return json(await service.serviceAccountToken(decodeURIComponent(serviceAccountMatch[1]!), body.clientSecret, body.audience), {}, origin);
    }
    if (url.pathname === "/auth/sessions" && request.method === "GET") {
      const subjectId = await authenticatedSubject(request, service);
      return json({ items: await service.listSessions(subjectId) }, {}, origin);
    }
    const sessionMatch = url.pathname.match(/^\/auth\/sessions\/([^/]+)$/);
    if (request.method === "DELETE" && sessionMatch) {
      const subjectId = await authenticatedSubject(request, service);
      const revoked = await service.revokeSession(subjectId, decodeURIComponent(sessionMatch[1]!));
      if (!revoked) throw new AuthnError("not_found", "session not found", 404);
      return new Response(null, { status: 204, headers: origin ? { "access-control-allow-origin": origin } : {} });
    }
    if (request.method === "POST" && url.pathname === "/auth/mfa/enroll") {
      return json(await service.beginMfaEnrollment(await authenticatedSubject(request, service)), {}, origin);
    }
    if (request.method === "POST" && url.pathname === "/auth/mfa/verify") {
      const subjectId = await authenticatedSubject(request, service);
      const body = await jsonBody<{ code?: string }>(request);
      if (!body.code) throw new AuthnError("invalid_request", "code is required");
      return json(await service.confirmMfaEnrollment(subjectId, body.code), {}, origin);
    }
    return json({ error: { code: "not_found", message: "route not found" } }, { status: 404 }, origin);
  } catch (error) {
    if (error instanceof AuthnError) {
      return json({ error: { code: error.code, message: error.message } }, { status: error.status }, origin);
    }
    console.error("authentication request failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: { code: "internal_error", message: "request failed" } }, { status: 500 }, origin);
  }
}

export default {
  fetch: handleAuthnRequest,
} satisfies ExportedHandler<AuthnWorkerEnv>;
