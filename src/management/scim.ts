import type { Subject } from "../control-plane/domain";
import type { ManagementRepository } from "./repository";
import { ManagementError, ManagementService } from "./service";

const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";

interface ScimUserInput {
  id?: string;
  externalId?: string;
  userName: string;
  displayName?: string;
  active?: boolean;
  emails?: Array<{ value: string; primary?: boolean }>;
}

interface ScimGroupInput {
  id?: string;
  externalId?: string;
  displayName: string;
  scopeId: string;
  members?: Array<{ value: string; display?: string }>;
}

interface ScimPatch {
  Operations?: Array<{ op: "add" | "remove" | "replace"; path?: string; value?: unknown }>;
}

function scimResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "content-type": "application/scim+json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function scimError(error: unknown): Response {
  const status = error instanceof ManagementError ? error.status : 500;
  return scimResponse({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: String(status),
    detail: error instanceof Error ? error.message : "SCIM request failed",
  }, status);
}

function primaryEmail(input: ScimUserInput): string | undefined {
  return input.emails?.find((email) => email.primary)?.value ?? input.emails?.[0]?.value;
}

function userResource(subject: Subject) {
  const userName = typeof subject.metadata?.scimUserName === "string"
    ? subject.metadata.scimUserName
    : subject.email ?? subject.subjectId;
  const externalId = typeof subject.metadata?.scimExternalId === "string"
    ? subject.metadata.scimExternalId
    : undefined;
  return {
    schemas: [USER_SCHEMA],
    id: subject.subjectId,
    ...(externalId ? { externalId } : {}),
    userName,
    displayName: subject.displayName,
    active: subject.status === "active",
    ...(subject.email ? { emails: [{ value: subject.email, primary: true }] } : {}),
    meta: { resourceType: "User", created: subject.createdAt, lastModified: subject.updatedAt },
  };
}

function listResponse(resources: unknown[], startIndex: number, totalResults = resources.length) {
  return {
    schemas: [LIST_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

function parsePage(url: URL): { start: number; count: number } {
  return {
    start: Math.max(1, Number(url.searchParams.get("startIndex") ?? 1) || 1),
    count: Math.min(200, Math.max(1, Number(url.searchParams.get("count") ?? 100) || 100)),
  };
}

function matchesUserFilter(subject: Subject, filter: string | null): boolean {
  if (!filter) return true;
  const match = filter.match(/^\s*(userName|externalId|id)\s+eq\s+"([^"]+)"\s*$/i);
  if (!match) throw new ManagementError("invalid_filter", "supported SCIM filters use userName, externalId, or id with eq", 400);
  const [, field, expected] = match;
  if (field!.toLowerCase() === "id") return subject.subjectId === expected;
  const metadataKey = field!.toLowerCase() === "username" ? "scimUserName" : "scimExternalId";
  return subject.metadata?.[metadataKey] === expected;
}

async function parseJson<T>(request: Request): Promise<T> {
  try { return await request.json<T>(); }
  catch { throw new ManagementError("invalidSyntax", "SCIM request body must be valid JSON", 400); }
}

async function putScimUser(
  input: ScimUserInput,
  repository: ManagementRepository,
  service: ManagementService,
  actorId: string,
  existing?: Subject,
) {
  if (!input.userName) throw new ManagementError("invalidValue", "userName is required", 400);
  const duplicate = (await repository.listSubjects()).find(
    (subject) => subject.subjectId !== existing?.subjectId && subject.metadata?.scimUserName === input.userName,
  );
  if (duplicate) throw new ManagementError("uniqueness", "userName already exists", 409);
  const email = primaryEmail(input);
  return service.putSubject({
    subjectId: existing?.subjectId ?? input.id ?? `user-${crypto.randomUUID()}`,
    kind: "User",
    displayName: input.displayName ?? input.userName,
    ...(email ? { email: email.toLowerCase() } : {}),
    status: input.active === false ? "disabled" : "active",
    metadata: {
      ...(existing?.metadata ?? {}),
      scimUserName: input.userName,
      ...(input.externalId ? { scimExternalId: input.externalId } : {}),
      provisionedBy: "scim",
    },
  }, actorId);
}

async function patchScimUser(
  existing: Subject,
  patch: ScimPatch,
  service: ManagementService,
  actorId: string,
) {
  const input: ScimUserInput = {
    userName: typeof existing.metadata?.scimUserName === "string"
      ? existing.metadata.scimUserName
      : existing.email ?? existing.subjectId,
    displayName: existing.displayName,
    active: existing.status === "active",
    ...(existing.email ? { emails: [{ value: existing.email, primary: true }] } : {}),
    ...(typeof existing.metadata?.scimExternalId === "string" ? { externalId: existing.metadata.scimExternalId } : {}),
  };
  for (const operation of patch.Operations ?? []) {
    const path = operation.path?.toLowerCase();
    if (path === "active") input.active = operation.op === "remove" ? false : Boolean(operation.value);
    else if (path === "displayname") input.displayName = operation.op === "remove" ? input.userName : String(operation.value);
    else if (path === "username") input.userName = String(operation.value ?? "");
    else if (path?.startsWith("emails")) {
      input.emails = operation.op === "remove" ? [] : Array.isArray(operation.value)
        ? operation.value as ScimUserInput["emails"]
        : [{ value: String(operation.value), primary: true }];
    } else if (!path && operation.value && typeof operation.value === "object") {
      Object.assign(input, operation.value);
    } else throw new ManagementError("invalidPath", `unsupported SCIM user path ${operation.path ?? ""}`, 400);
  }
  return service.putSubject({
    ...existing,
    displayName: input.displayName ?? input.userName,
    ...(primaryEmail(input) ? { email: primaryEmail(input)!.toLowerCase() } : {}),
    status: input.active === false ? "disabled" : "active",
    metadata: { ...existing.metadata, scimUserName: input.userName },
  }, actorId);
}

interface ScimGroupRow {
  scim_id: string;
  group_id: string;
  scope_id: string;
  external_id: string | null;
  created_at: string;
  updated_at: string;
  name: string;
}

async function groupResource(row: ScimGroupRow, repository: ManagementRepository) {
  const members = (await repository.listGroupMembers(row.scope_id))
    .filter((member) => member.groupId === row.group_id)
    .map((member) => ({ value: member.memberId, type: member.memberKind }));
  return {
    schemas: [GROUP_SCHEMA], id: row.scim_id, ...(row.external_id ? { externalId: row.external_id } : {}),
    displayName: row.name, scopeId: row.scope_id, members,
    meta: { resourceType: "Group", created: row.created_at, lastModified: row.updated_at },
  };
}

async function findGroup(db: D1Database, scimId: string): Promise<ScimGroupRow | undefined> {
  return await db.prepare(`SELECT m.*, g.name FROM scim_group_mappings m
    JOIN scope_groups g ON g.group_id = m.group_id WHERE m.scim_id = ?`).bind(scimId).first<ScimGroupRow>() ?? undefined;
}

async function createScimGroup(
  input: ScimGroupInput,
  db: D1Database,
  repository: ManagementRepository,
  service: ManagementService,
  actorId: string,
) {
  if (!input.scopeId || !input.displayName) throw new ManagementError("invalidValue", "scopeId and displayName are required", 400);
  const groupId = input.id ?? `group-${crypto.randomUUID()}`;
  const scimId = crypto.randomUUID();
  const group = await service.putGroup(input.scopeId, { groupId, name: input.displayName }, actorId);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO scim_group_mappings
    (scim_id, group_id, scope_id, external_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(scimId, group.groupId, input.scopeId, input.externalId ?? null, now, now).run();
  for (const member of input.members ?? []) {
    await service.putGroupMember(input.scopeId, groupId, member.value, "User", actorId);
  }
  return (await findGroup(db, scimId))!;
}

export async function handleScimRequest(
  request: Request,
  db: D1Database,
  repository: ManagementRepository,
  service: ManagementService,
  actorId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const userMatch = url.pathname.match(/^\/scim\/v2\/Users\/([^/]+)$/);
  if (url.pathname === "/scim/v2/Users" && request.method === "GET") {
    const { start, count } = parsePage(url);
    const all = (await repository.listSubjects()).filter(
      (subject) => subject.kind === "User" && matchesUserFilter(subject, url.searchParams.get("filter")),
    );
    return scimResponse(listResponse(all.slice(start - 1, start - 1 + count).map(userResource), start, all.length));
  }
  if (url.pathname === "/scim/v2/Users" && request.method === "POST") {
    return scimResponse(userResource(await putScimUser(await parseJson(request), repository, service, actorId)), 201);
  }
  if (userMatch) {
    const existing = await repository.getSubject(decodeURIComponent(userMatch[1]!));
    if (!existing || existing.kind !== "User") throw new ManagementError("not_found", "SCIM user not found", 404);
    if (request.method === "GET") return scimResponse(userResource(existing));
    if (request.method === "PUT") return scimResponse(userResource(await putScimUser(await parseJson(request), repository, service, actorId, existing)));
    if (request.method === "PATCH") return scimResponse(userResource(await patchScimUser(existing, await parseJson(request), service, actorId)));
    if (request.method === "DELETE") {
      await service.putSubject({ ...existing, status: "disabled" }, actorId);
      return new Response(null, { status: 204 });
    }
  }

  const groupMatch = url.pathname.match(/^\/scim\/v2\/Groups\/([^/]+)$/);
  if (url.pathname === "/scim/v2/Groups" && request.method === "GET") {
    const { start, count } = parsePage(url);
    const scopeId = url.searchParams.get("scopeId");
    const rows = await db.prepare(`SELECT m.*, g.name FROM scim_group_mappings m
      JOIN scope_groups g ON g.group_id = m.group_id
      WHERE (? IS NULL OR m.scope_id = ?) ORDER BY m.updated_at DESC`).bind(scopeId, scopeId).all<ScimGroupRow>();
    const page = rows.results.slice(start - 1, start - 1 + count);
    return scimResponse(listResponse(await Promise.all(page.map((row) => groupResource(row, repository))), start, rows.results.length));
  }
  if (url.pathname === "/scim/v2/Groups" && request.method === "POST") {
    const row = await createScimGroup(await parseJson(request), db, repository, service, actorId);
    return scimResponse(await groupResource(row, repository), 201);
  }
  if (groupMatch) {
    const row = await findGroup(db, decodeURIComponent(groupMatch[1]!));
    if (!row) throw new ManagementError("not_found", "SCIM group not found", 404);
    if (request.method === "GET") return scimResponse(await groupResource(row, repository));
    if (request.method === "DELETE") {
      await service.deleteGroup(row.scope_id, row.group_id, actorId);
      return new Response(null, { status: 204 });
    }
    if (request.method === "PATCH") {
      const patch = await parseJson<ScimPatch>(request);
      for (const operation of patch.Operations ?? []) {
        if (operation.path?.toLowerCase() === "displayname") {
          await service.putGroup(row.scope_id, { groupId: row.group_id, name: String(operation.value) }, actorId);
        } else if (operation.path?.toLowerCase().startsWith("members")) {
          const members = Array.isArray(operation.value) ? operation.value as Array<{ value: string }> : [];
          for (const member of members) {
            if (operation.op === "remove") await service.deleteGroupMember(row.scope_id, row.group_id, member.value, actorId);
            else await service.putGroupMember(row.scope_id, row.group_id, member.value, "User", actorId);
          }
        } else throw new ManagementError("invalidPath", `unsupported SCIM group path ${operation.path ?? ""}`, 400);
      }
      await db.prepare("UPDATE scim_group_mappings SET updated_at = ? WHERE scim_id = ?")
        .bind(new Date().toISOString(), row.scim_id).run();
      return scimResponse(await groupResource((await findGroup(db, row.scim_id))!, repository));
    }
  }
  throw new ManagementError("not_found", "SCIM route not found", 404);
}
