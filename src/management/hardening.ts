import { decodeCompactScopeClaim, encodeCompactScopeClaim } from "../authn/claims";
import type { ManagementRepository } from "./repository";
import { ManagementError, ManagementService } from "./service";

export interface ChangeRequest {
  requestId: string;
  targetType: "service" | "scope";
  serviceId: string;
  scopeId?: string;
  requestedVersion: string;
  summary: string;
  diff: Array<{ path: string; before?: unknown; after?: unknown }>;
  impact: { affectedSubjects: number; changedAreas: string[] };
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  requestedBy: string;
  reviewedBy?: string;
  reviewNote?: string;
  requestedAt: string;
  reviewedAt?: string;
  executedAt?: string;
}

export interface BreakGlassGrant {
  grantId: string;
  subjectId: string;
  serviceId: string;
  scopeId: string;
  roleId: string;
  reason: string;
  durationSeconds: number;
  status: "pending" | "active" | "rejected" | "revoked" | "expired";
  requestedBy: string;
  approvedBy?: string;
  requestedAt: string;
  approvedAt?: string;
  expiresAt: string;
  revokedAt?: string;
}

interface ChangeRow {
  request_id: string; target_type: ChangeRequest["targetType"]; service_id: string; scope_id: string | null;
  requested_version: string; summary: string; diff_json: string; impact_json: string; status: ChangeRequest["status"];
  requested_by: string; reviewed_by: string | null; review_note: string | null; requested_at: string;
  reviewed_at: string | null; executed_at: string | null;
}

interface BreakGlassRow {
  grant_id: string; subject_id: string; service_id: string; scope_id: string; role_id: string; reason: string;
  status: BreakGlassGrant["status"]; requested_by: string; approved_by: string | null; requested_at: string;
  approved_at: string | null; expires_at: string; revoked_at: string | null;
}

function changeFromRow(row: ChangeRow): ChangeRequest {
  return {
    requestId: row.request_id, targetType: row.target_type, serviceId: row.service_id,
    ...(row.scope_id ? { scopeId: row.scope_id } : {}), requestedVersion: row.requested_version,
    summary: row.summary, diff: JSON.parse(row.diff_json), impact: JSON.parse(row.impact_json), status: row.status,
    requestedBy: row.requested_by, ...(row.reviewed_by ? { reviewedBy: row.reviewed_by } : {}),
    ...(row.review_note ? { reviewNote: row.review_note } : {}), requestedAt: row.requested_at,
    ...(row.reviewed_at ? { reviewedAt: row.reviewed_at } : {}), ...(row.executed_at ? { executedAt: row.executed_at } : {}),
  };
}

function grantFromRow(row: BreakGlassRow): BreakGlassGrant {
  const durationStart = row.approved_at ?? row.requested_at;
  return {
    grantId: row.grant_id, subjectId: row.subject_id, serviceId: row.service_id, scopeId: row.scope_id,
    roleId: row.role_id, reason: row.reason, status: row.status, requestedBy: row.requested_by,
    durationSeconds: Math.max(0, Math.round((Date.parse(row.expires_at) - Date.parse(durationStart)) / 1000)),
    ...(row.approved_by ? { approvedBy: row.approved_by } : {}), requestedAt: row.requested_at,
    ...(row.approved_at ? { approvedAt: row.approved_at } : {}), expiresAt: row.expires_at,
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
  };
}

function topLevelDiff(before: unknown, after: unknown): ChangeRequest["diff"] {
  const left = before && typeof before === "object" ? before as Record<string, unknown> : {};
  const right = after && typeof after === "object" ? after as Record<string, unknown> : {};
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap((key) => {
    if (JSON.stringify(left[key]) === JSON.stringify(right[key])) return [];
    return [{ path: `/${key}`, ...(key in left ? { before: left[key] } : {}), ...(key in right ? { after: right[key] } : {}) }];
  });
}

async function writeAudit(
  db: D1Database,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  serviceId?: string,
  scopeId?: string,
  detail?: unknown,
) {
  await db.prepare(`INSERT INTO audit_events
    (event_id, actor_id, action, target_type, target_id, service_id, scope_id, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), actorId, action, targetType, targetId, serviceId ?? null, scopeId ?? null,
      detail ? JSON.stringify(detail) : null, new Date().toISOString()).run();
}

export async function createChangeRequest(
  db: D1Database,
  repository: ManagementRepository,
  input: { targetType: "service" | "scope"; serviceId: string; scopeId?: string; requestedVersion?: string; summary: string },
  actorId: string,
): Promise<ChangeRequest> {
  const service = await repository.getService(input.serviceId);
  if (!service) throw new ManagementError("not_found", "service not found", 404);
  let draft: unknown;
  let before: unknown;
  let affectedSubjects = 0;
  if (input.targetType === "scope") {
    if (!input.scopeId) throw new ManagementError("invalid_request", "scopeId is required for a scope change", 400);
    const scope = await repository.getScope(input.scopeId);
    if (!scope || scope.serviceId !== input.serviceId) throw new ManagementError("not_found", "scope not found", 404);
    draft = await repository.getScopeDraft(input.scopeId) ?? {};
    before = (await repository.listConfigVersions(input.serviceId, input.scopeId)).find(
      (version) => version.versionId === scope.activeVersion,
    )?.artifact;
    const count = await db.prepare(`SELECT COUNT(DISTINCT subject_id) AS count FROM bindings WHERE scope_id = ?`)
      .bind(input.scopeId).first<{ count: number }>();
    affectedSubjects = Number(count?.count ?? 0);
  } else {
    draft = await repository.getServiceDraft(input.serviceId) ?? {};
    before = (await repository.listConfigVersions(input.serviceId)).find(
      (version) => version.versionId === service.activeServiceVersion,
    )?.artifact;
    affectedSubjects = Number((await db.prepare("SELECT COUNT(*) AS count FROM subjects").first<{ count: number }>())?.count ?? 0);
  }
  const diff = topLevelDiff(before, draft);
  if (!diff.length) throw new ManagementError("conflict", "draft has no changes from the active version", 409);
  const now = new Date().toISOString();
  const requestId = crypto.randomUUID();
  const requestedVersion = input.requestedVersion ?? `approved-${Date.now()}`;
  const impact = { affectedSubjects, changedAreas: diff.map((entry) => entry.path.slice(1)) };
  await db.prepare(`INSERT INTO change_requests
    (request_id, target_type, service_id, scope_id, requested_version, summary, diff_json, impact_json,
     status, requested_by, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .bind(requestId, input.targetType, input.serviceId, input.scopeId ?? null, requestedVersion, input.summary,
      JSON.stringify(diff), JSON.stringify(impact), actorId, now).run();
  await writeAudit(db, actorId, "change_request.create", "change_request", requestId, input.serviceId, input.scopeId, { requestedVersion });
  return (await getChangeRequest(db, requestId))!;
}

export async function listChangeRequests(db: D1Database, status?: string): Promise<ChangeRequest[]> {
  const rows = await db.prepare(`SELECT * FROM change_requests WHERE (? IS NULL OR status = ?)
    ORDER BY requested_at DESC LIMIT 200`).bind(status ?? null, status ?? null).all<ChangeRow>();
  return rows.results.map(changeFromRow);
}

export async function getChangeRequest(db: D1Database, requestId: string): Promise<ChangeRequest | undefined> {
  const row = await db.prepare("SELECT * FROM change_requests WHERE request_id = ?").bind(requestId).first<ChangeRow>();
  return row ? changeFromRow(row) : undefined;
}

export async function reviewChangeRequest(
  db: D1Database,
  service: ManagementService,
  requestId: string,
  decision: "approve" | "reject",
  actorId: string,
  note?: string,
): Promise<ChangeRequest> {
  const request = await getChangeRequest(db, requestId);
  if (!request) throw new ManagementError("not_found", "change request not found", 404);
  if (request.status !== "pending") throw new ManagementError("conflict", "change request is not pending", 409);
  if (request.requestedBy === actorId) throw new ManagementError("forbidden", "requester cannot review their own change", 403);
  const now = new Date().toISOString();
  if (decision === "reject") {
    await db.prepare(`UPDATE change_requests SET status = 'rejected', reviewed_by = ?, review_note = ?, reviewed_at = ?
      WHERE request_id = ?`).bind(actorId, note ?? null, now, requestId).run();
    await writeAudit(db, actorId, "change_request.reject", "change_request", requestId, request.serviceId, request.scopeId, { note });
    return (await getChangeRequest(db, requestId))!;
  }
  const currentDraft = request.targetType === "scope"
    ? await service.repository.getScopeDraft(request.scopeId!) ?? {}
    : await service.repository.getServiceDraft(request.serviceId) ?? {};
  const versions = await service.repository.listConfigVersions(request.serviceId, request.scopeId);
  const activeVersion = request.targetType === "scope"
    ? (await service.repository.getScope(request.scopeId!))?.activeVersion
    : (await service.repository.getService(request.serviceId))?.activeServiceVersion;
  const currentDiff = topLevelDiff(versions.find((version) => version.versionId === activeVersion)?.artifact, currentDraft);
  if (JSON.stringify(currentDiff) !== JSON.stringify(request.diff)) {
    throw new ManagementError("change_request_stale", "draft or active version changed after review was requested", 409);
  }
  await db.prepare(`UPDATE change_requests SET status = 'approved', reviewed_by = ?, review_note = ?, reviewed_at = ?
    WHERE request_id = ?`).bind(actorId, note ?? null, now, requestId).run();
  try {
    if (request.targetType === "scope") await service.publishScope(request.scopeId!, actorId, request.requestedVersion);
    else await service.publishService(request.serviceId, actorId, request.requestedVersion);
    await db.prepare("UPDATE change_requests SET status = 'executed', executed_at = ? WHERE request_id = ?")
      .bind(new Date().toISOString(), requestId).run();
    await writeAudit(db, actorId, "change_request.execute", "change_request", requestId, request.serviceId, request.scopeId, { version: request.requestedVersion });
  } catch (error) {
    await db.prepare("UPDATE change_requests SET status = 'failed' WHERE request_id = ?").bind(requestId).run();
    throw error;
  }
  return (await getChangeRequest(db, requestId))!;
}

export async function createBreakGlassGrant(
  db: D1Database,
  repository: ManagementRepository,
  input: { subjectId: string; serviceId: string; scopeId: string; roleId: string; reason: string; durationSeconds: number },
  actorId: string,
  maxDurationSeconds: number,
): Promise<BreakGlassGrant> {
  const subject = await repository.getSubject(input.subjectId);
  const service = await repository.getService(input.serviceId);
  const scope = await repository.getScope(input.scopeId);
  if (!subject || !service || !scope || scope.serviceId !== input.serviceId) {
    throw new ManagementError("not_found", "break-glass subject, service, or scope not found", 404);
  }
  if (!service.vocabulary.roleTemplates.some((role) => role.id === input.roleId)) {
    throw new ManagementError("vocabulary_violation", "break-glass role is not in the service vocabulary", 422);
  }
  if (!input.reason.trim()) throw new ManagementError("invalid_request", "break-glass reason is required", 400);
  if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 60 || input.durationSeconds > maxDurationSeconds) {
    throw new ManagementError("invalid_request", `durationSeconds must be between 60 and ${maxDurationSeconds}`, 400);
  }
  const requestedAt = new Date().toISOString();
  const grantId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + input.durationSeconds * 1000).toISOString();
  await db.prepare(`INSERT INTO break_glass_grants
    (grant_id, subject_id, service_id, scope_id, role_id, reason, status, requested_by, requested_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
    .bind(grantId, input.subjectId, input.serviceId, input.scopeId, input.roleId, input.reason, actorId, requestedAt, expiresAt).run();
  await writeAudit(db, actorId, "break_glass.request", "break_glass", grantId, input.serviceId, input.scopeId, { subjectId: input.subjectId, expiresAt });
  return (await getBreakGlassGrant(db, grantId))!;
}

export async function listBreakGlassGrants(db: D1Database, status?: string): Promise<BreakGlassGrant[]> {
  await expireBreakGlass(db);
  const rows = await db.prepare(`SELECT * FROM break_glass_grants WHERE (? IS NULL OR status = ?)
    ORDER BY requested_at DESC LIMIT 200`).bind(status ?? null, status ?? null).all<BreakGlassRow>();
  return rows.results.map(grantFromRow);
}

async function getBreakGlassGrant(db: D1Database, grantId: string): Promise<BreakGlassGrant | undefined> {
  const row = await db.prepare("SELECT * FROM break_glass_grants WHERE grant_id = ?").bind(grantId).first<BreakGlassRow>();
  return row ? grantFromRow(row) : undefined;
}

export async function reviewBreakGlassGrant(
  db: D1Database,
  grantId: string,
  decision: "approve" | "reject" | "revoke",
  actorId: string,
): Promise<BreakGlassGrant> {
  const grant = await getBreakGlassGrant(db, grantId);
  if (!grant) throw new ManagementError("not_found", "break-glass grant not found", 404);
  if (decision === "revoke") {
    if (grant.status !== "active") throw new ManagementError("conflict", "only active grants can be revoked", 409);
    await db.prepare("UPDATE break_glass_grants SET status = 'revoked', revoked_at = ? WHERE grant_id = ?")
      .bind(new Date().toISOString(), grantId).run();
  } else {
    if (grant.status !== "pending") throw new ManagementError("conflict", "break-glass grant is not pending", 409);
    if (grant.requestedBy === actorId) throw new ManagementError("forbidden", "requester cannot approve their own break-glass grant", 403);
    const reviewedAt = new Date();
    const expiresAt = decision === "approve"
      ? new Date(reviewedAt.getTime() + grant.durationSeconds * 1000).toISOString()
      : grant.expiresAt;
    await db.prepare(`UPDATE break_glass_grants SET status = ?, approved_by = ?, approved_at = ?, expires_at = ? WHERE grant_id = ?`)
      .bind(decision === "approve" ? "active" : "rejected", actorId, reviewedAt.toISOString(), expiresAt, grantId).run();
  }
  await invalidateProjections(db, `/break-glass-grants/${grantId}/${decision}`, "break_glass.change");
  await writeAudit(db, actorId, `break_glass.${decision}`, "break_glass", grantId, grant.serviceId, grant.scopeId, { subjectId: grant.subjectId });
  return (await getBreakGlassGrant(db, grantId))!;
}

async function expireBreakGlass(db: D1Database): Promise<void> {
  const now = new Date().toISOString();
  const result = await db.prepare(`UPDATE break_glass_grants SET status = 'expired'
    WHERE status = 'active' AND expires_at <= ?`).bind(now).run();
  if ((result.meta.changes ?? 0) > 0) await invalidateProjections(db, "/scheduled/break-glass-expiry", "break_glass.expired");
}

async function withBreakGlass(
  db: D1Database,
  repository: ManagementRepository,
  preview: { subjectId: string; serviceId: string; azv: 1; azs: string[] },
): Promise<{ preview: typeof preview; validUntil?: string }> {
  await expireBreakGlass(db);
  const rows = await db.prepare(`SELECT * FROM break_glass_grants
    WHERE subject_id = ? AND service_id = ? AND status = 'active' AND expires_at > ?`)
    .bind(preview.subjectId, preview.serviceId, new Date().toISOString()).all<BreakGlassRow>();
  const claims = new Map(preview.azs.map((raw) => {
    const decoded = decodeCompactScopeClaim(raw);
    return [decoded.claimId ?? decoded.scopeId, decoded] as const;
  }));
  for (const row of rows.results) {
    const scope = await repository.getScope(row.scope_id);
    if (!scope) continue;
    const ref = scope.claimId ?? scope.scopeId;
    const current = claims.get(ref) ?? { scopeId: scope.scopeId, ...(scope.claimId ? { claimId: scope.claimId } : {}), roleIds: [], groupIds: [], pathGrants: [] };
    if (!current.roleIds.includes(row.role_id)) current.roleIds.push(row.role_id);
    claims.set(ref, current);
  }
  const validUntil = rows.results.map((row) => row.expires_at).sort()[0];
  return {
    preview: { ...preview, azs: [...claims.values()].map(encodeCompactScopeClaim).sort() },
    ...(validUntil ? { validUntil } : {}),
  };
}

interface ProjectionRow { azs_json: string; dirty: number; generated_at: string; valid_until: string | null }

export async function projectedClaims(
  db: D1Database,
  repository: ManagementRepository,
  service: ManagementService,
  serviceId: string,
  subjectId: string,
) {
  const now = new Date().toISOString();
  const cached = await db.prepare(`SELECT azs_json, dirty, generated_at, valid_until FROM entitlement_projections
    WHERE service_id = ? AND subject_id = ?`).bind(serviceId, subjectId).first<ProjectionRow>();
  if (cached && !cached.dirty && (!cached.valid_until || cached.valid_until > now)) {
    return { subjectId, serviceId, azv: 1 as const, azs: JSON.parse(cached.azs_json) as string[], generatedAt: cached.generated_at, cached: true };
  }
  const result = await withBreakGlass(db, repository, await service.claimPreview(serviceId, subjectId));
  const generatedAt = new Date().toISOString();
  await db.prepare(`INSERT INTO entitlement_projections
    (service_id, subject_id, azs_json, dirty, generated_at, valid_until) VALUES (?, ?, ?, 0, ?, ?)
    ON CONFLICT(service_id, subject_id) DO UPDATE SET azs_json = excluded.azs_json, dirty = 0,
    generated_at = excluded.generated_at, valid_until = excluded.valid_until`)
    .bind(serviceId, subjectId, JSON.stringify(result.preview.azs), generatedAt, result.validUntil ?? null).run();
  return { ...result.preview, generatedAt, cached: false };
}

export async function invalidateProjections(db: D1Database, path: string, reason = "management.mutation"): Promise<void> {
  await db.prepare("UPDATE entitlement_projections SET dirty = 1").run();
  await db.prepare(`INSERT INTO entitlement_projection_events
    (event_id, reason, path, status, created_at) VALUES (?, ?, ?, 'pending', ?)`)
    .bind(crypto.randomUUID(), reason, path, new Date().toISOString()).run();
}

export async function rebuildDirtyProjections(
  db: D1Database,
  repository: ManagementRepository,
  service: ManagementService,
  limit = 50,
): Promise<{ rebuilt: number; failed: number }> {
  await expireBreakGlass(db);
  const rows = await db.prepare(`SELECT service_id, subject_id FROM entitlement_projections
    WHERE dirty = 1 ORDER BY generated_at LIMIT ?`).bind(limit).all<{ service_id: string; subject_id: string }>();
  let rebuilt = 0;
  let failed = 0;
  for (const row of rows.results) {
    try { await projectedClaims(db, repository, service, row.service_id, row.subject_id); rebuilt += 1; }
    catch { failed += 1; }
  }
  await db.prepare(`UPDATE entitlement_projection_events SET status = ?, processed_at = ? WHERE status = 'pending'`)
    .bind(failed ? "failed" : "processed", new Date().toISOString()).run();
  return { rebuilt, failed };
}

export async function recordReplication(
  db: D1Database,
  input: { serviceId: string; scopeId?: string; version: string; replica: string; status: "succeeded" | "failed"; error?: string },
) {
  await db.prepare(`INSERT INTO artifact_replication_events
    (event_id, service_id, scope_id, version, replica, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), input.serviceId, input.scopeId ?? null, input.version, input.replica,
      input.status, input.error ?? null, new Date().toISOString()).run();
}

export async function operationsStatus(db: D1Database) {
  const scalar = async (query: string) => Number((await db.prepare(query).first<{ count: number }>())?.count ?? 0);
  const activeBreakGlass = Number((await db.prepare(`SELECT COUNT(*) AS count FROM break_glass_grants
    WHERE status = 'active' AND expires_at > ?`).bind(new Date().toISOString()).first<{ count: number }>())?.count ?? 0);
  const replication = await db.prepare(`SELECT service_id, scope_id, version, replica, status, error, created_at
    FROM artifact_replication_events ORDER BY sequence DESC LIMIT 20`).all<Record<string, unknown>>();
  return {
    pendingChangeRequests: await scalar("SELECT COUNT(*) AS count FROM change_requests WHERE status = 'pending'"),
    activeBreakGlassGrants: activeBreakGlass,
    dirtyProjections: await scalar("SELECT COUNT(*) AS count FROM entitlement_projections WHERE dirty = 1"),
    pendingProjectionEvents: await scalar("SELECT COUNT(*) AS count FROM entitlement_projection_events WHERE status = 'pending'"),
    failedReplications: await scalar("SELECT COUNT(*) AS count FROM artifact_replication_events WHERE status = 'failed'"),
    recentReplications: replication.results,
    checkedAt: new Date().toISOString(),
  };
}
