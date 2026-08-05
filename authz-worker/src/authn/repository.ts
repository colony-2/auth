import type { Subject, SubjectKind } from "../control-plane/domain";
import type {
  CompactPathGrant,
  EffectiveScopeEntitlement,
  Identity,
  RefreshSession,
  ServiceAccountCredential,
} from "./types";
import { decodeCompactScopeClaim } from "./claims";

export interface AuthnRepository {
  findIdentityByUsername(username: string): Promise<Identity | undefined>;
  getIdentityBySubject(subjectId: string): Promise<Identity | undefined>;
  putIdentity(identity: Identity): Promise<void>;
  getSubject(subjectId: string): Promise<Subject | undefined>;
  putSubject(subject: Subject): Promise<void>;
  listServiceAccountCredentials(subjectId: string): Promise<ServiceAccountCredential[]>;
  putServiceAccountCredential(credential: ServiceAccountCredential): Promise<void>;
  putRefreshSession(session: RefreshSession): Promise<void>;
  findRefreshSession(tokenHash: string): Promise<RefreshSession | undefined>;
  listRefreshSessions(subjectId: string): Promise<RefreshSession[]>;
  revokeRefreshSession(sessionId: string, at: string): Promise<boolean>;
  revokeRefreshSessionByHash(tokenHash: string, at: string): Promise<boolean>;
  entitlementsFor(subjectId: string, serviceId: string): Promise<EffectiveScopeEntitlement[]>;
  recordAuthEvent(subjectId: string, action: string, detail?: Record<string, unknown>): Promise<void>;
}

export class RemoteEntitlementAuthnRepository implements AuthnRepository {
  constructor(
    private readonly delegate: AuthnRepository,
    private readonly managementUrl: string,
    private readonly managementToken: string,
    private readonly managementFetcher?: Fetcher,
  ) {}

  findIdentityByUsername = (username: string) => this.delegate.findIdentityByUsername(username);
  getIdentityBySubject = (subjectId: string) => this.delegate.getIdentityBySubject(subjectId);
  putIdentity = (identity: Identity) => this.delegate.putIdentity(identity);
  getSubject = (subjectId: string) => this.delegate.getSubject(subjectId);
  putSubject = (subject: Subject) => this.delegate.putSubject(subject);
  listServiceAccountCredentials = (subjectId: string) => this.delegate.listServiceAccountCredentials(subjectId);
  putServiceAccountCredential = (credential: ServiceAccountCredential) => this.delegate.putServiceAccountCredential(credential);
  putRefreshSession = (session: RefreshSession) => this.delegate.putRefreshSession(session);
  findRefreshSession = (tokenHash: string) => this.delegate.findRefreshSession(tokenHash);
  listRefreshSessions = (subjectId: string) => this.delegate.listRefreshSessions(subjectId);
  revokeRefreshSession = (sessionId: string, at: string) => this.delegate.revokeRefreshSession(sessionId, at);
  revokeRefreshSessionByHash = (tokenHash: string, at: string) => this.delegate.revokeRefreshSessionByHash(tokenHash, at);
  recordAuthEvent = (subjectId: string, action: string, detail?: Record<string, unknown>) => this.delegate.recordAuthEvent(subjectId, action, detail);

  async entitlementsFor(subjectId: string, serviceId: string): Promise<EffectiveScopeEntitlement[]> {
    const response = await (this.managementFetcher?.fetch.bind(this.managementFetcher) ?? fetch)(
      `${this.managementUrl.replace(/\/$/, "")}/services/${encodeURIComponent(serviceId)}/subjects/${encodeURIComponent(subjectId)}/claim-preview`,
      { headers: { authorization: `Bearer ${this.managementToken}` } },
    );
    if (!response.ok) throw new Error(`management claim projection failed with ${response.status}`);
    const value = await response.json<{ azs?: string[] }>();
    return (value.azs ?? []).map(decodeCompactScopeClaim);
  }
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryAuthnRepository implements AuthnRepository {
  private readonly identities = new Map<string, Identity>();
  private readonly subjects = new Map<string, Subject>();
  private readonly credentials = new Map<string, ServiceAccountCredential>();
  private readonly sessions = new Map<string, RefreshSession>();
  private readonly entitlements = new Map<string, EffectiveScopeEntitlement[]>();
  readonly events: Array<{ subjectId: string; action: string; detail?: Record<string, unknown> }> = [];

  async findIdentityByUsername(username: string): Promise<Identity | undefined> {
    const identity = [...this.identities.values()].find(
      (candidate) => candidate.username.toLowerCase() === username.toLowerCase(),
    );
    return identity && copy(identity);
  }

  async getIdentityBySubject(subjectId: string): Promise<Identity | undefined> {
    const identity = [...this.identities.values()].find((candidate) => candidate.subjectId === subjectId);
    return identity && copy(identity);
  }

  async putIdentity(identity: Identity): Promise<void> {
    this.identities.set(identity.identityId, copy(identity));
  }

  async getSubject(subjectId: string): Promise<Subject | undefined> {
    const subject = this.subjects.get(subjectId);
    return subject && copy(subject);
  }

  async putSubject(subject: Subject): Promise<void> {
    this.subjects.set(subject.subjectId, copy(subject));
  }

  async listServiceAccountCredentials(subjectId: string): Promise<ServiceAccountCredential[]> {
    return [...this.credentials.values()]
      .filter((credential) => credential.subjectId === subjectId)
      .map(copy);
  }

  async putServiceAccountCredential(credential: ServiceAccountCredential): Promise<void> {
    this.credentials.set(credential.credentialId, copy(credential));
  }

  async putRefreshSession(session: RefreshSession): Promise<void> {
    this.sessions.set(session.sessionId, copy(session));
  }

  async findRefreshSession(tokenHash: string): Promise<RefreshSession | undefined> {
    const session = [...this.sessions.values()].find((candidate) => candidate.tokenHash === tokenHash);
    return session && copy(session);
  }

  async listRefreshSessions(subjectId: string): Promise<RefreshSession[]> {
    return [...this.sessions.values()]
      .filter((session) => session.subjectId === subjectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(copy);
  }

  async revokeRefreshSession(sessionId: string, at: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.revokedAt = at;
    return true;
  }

  async revokeRefreshSessionByHash(tokenHash: string, at: string): Promise<boolean> {
    const session = [...this.sessions.values()].find((candidate) => candidate.tokenHash === tokenHash);
    if (!session) return false;
    session.revokedAt = at;
    return true;
  }

  async entitlementsFor(subjectId: string, serviceId: string): Promise<EffectiveScopeEntitlement[]> {
    return copy(this.entitlements.get(`${subjectId}:${serviceId}`) ?? []);
  }

  setEntitlements(subjectId: string, serviceId: string, values: EffectiveScopeEntitlement[]): void {
    this.entitlements.set(`${subjectId}:${serviceId}`, copy(values));
  }

  async recordAuthEvent(subjectId: string, action: string, detail?: Record<string, unknown>): Promise<void> {
    this.events.push(copy({ subjectId, action, ...(detail ? { detail } : {}) }));
  }
}

interface IdentityRow {
  identity_id: string;
  subject_id: string;
  username: string;
  password_hash: string;
  mfa_secret: string | null;
  mfa_enabled: number;
  recovery_codes_json: string | null;
  external_provider: string | null;
  external_subject: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SubjectRow {
  subject_id: string;
  kind: "User" | "ServiceAccount";
  display_name: string;
  email: string | null;
  status: "active" | "suspended" | "disabled";
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

interface CredentialRow {
  credential_id: string;
  subject_id: string;
  secret_hash: string;
  label: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface SessionRow {
  session_id: string;
  subject_id: string;
  token_hash: string;
  audience: string;
  expires_at: string;
  revoked_at: string | null;
  rotated_from: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  created_at: string;
  last_used_at: string;
}

function parseJson<T>(value: string | null, fallback: T): T {
  return value ? JSON.parse(value) as T : fallback;
}

function identityFromRow(row: IdentityRow): Identity {
  return {
    identityId: row.identity_id,
    subjectId: row.subject_id,
    username: row.username,
    passwordHash: row.password_hash,
    mfaEnabled: row.mfa_enabled === 1,
    ...(row.mfa_secret ? { mfaSecret: row.mfa_secret } : {}),
    ...(row.recovery_codes_json ? { recoveryCodes: parseJson<string[]>(row.recovery_codes_json, []) } : {}),
    ...(row.external_provider ? { externalProvider: row.external_provider } : {}),
    ...(row.external_subject ? { externalSubject: row.external_subject } : {}),
    ...(row.last_login_at ? { lastLoginAt: row.last_login_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function subjectFromRow(row: SubjectRow): Subject {
  return {
    subjectId: row.subject_id,
    kind: row.kind,
    displayName: row.display_name,
    ...(row.email ? { email: row.email } : {}),
    status: row.status,
    ...(row.metadata_json ? { metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function credentialFromRow(row: CredentialRow): ServiceAccountCredential {
  return {
    credentialId: row.credential_id,
    subjectId: row.subject_id,
    secretHash: row.secret_hash,
    label: row.label,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
    createdAt: row.created_at,
  };
}

function sessionFromRow(row: SessionRow): RefreshSession {
  return {
    sessionId: row.session_id,
    subjectId: row.subject_id,
    tokenHash: row.token_hash,
    audience: row.audience,
    expiresAt: row.expires_at,
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
    ...(row.rotated_from ? { rotatedFrom: row.rotated_from } : {}),
    ...(row.user_agent ? { userAgent: row.user_agent } : {}),
    ...(row.ip_hash ? { ipHash: row.ip_hash } : {}),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export class D1AuthnRepository implements AuthnRepository {
  constructor(private readonly db: D1Database) {}

  async findIdentityByUsername(username: string): Promise<Identity | undefined> {
    const row = await this.db.prepare("SELECT * FROM identities WHERE username = ? COLLATE NOCASE").bind(username).first<IdentityRow>();
    return row ? identityFromRow(row) : undefined;
  }

  async getIdentityBySubject(subjectId: string): Promise<Identity | undefined> {
    const row = await this.db.prepare("SELECT * FROM identities WHERE subject_id = ?").bind(subjectId).first<IdentityRow>();
    return row ? identityFromRow(row) : undefined;
  }

  async putIdentity(value: Identity): Promise<void> {
    await this.db.prepare(`
      INSERT INTO identities (
        identity_id, subject_id, username, password_hash, mfa_secret, mfa_enabled,
        recovery_codes_json, external_provider, external_subject, last_login_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(identity_id) DO UPDATE SET
        username = excluded.username, password_hash = excluded.password_hash,
        mfa_secret = excluded.mfa_secret, mfa_enabled = excluded.mfa_enabled,
        recovery_codes_json = excluded.recovery_codes_json,
        external_provider = excluded.external_provider, external_subject = excluded.external_subject,
        last_login_at = excluded.last_login_at, updated_at = excluded.updated_at
    `).bind(
      value.identityId, value.subjectId, value.username, value.passwordHash, value.mfaSecret ?? null,
      value.mfaEnabled ? 1 : 0, value.recoveryCodes ? JSON.stringify(value.recoveryCodes) : null,
      value.externalProvider ?? null, value.externalSubject ?? null, value.lastLoginAt ?? null,
      value.createdAt, value.updatedAt,
    ).run();
  }

  async getSubject(subjectId: string): Promise<Subject | undefined> {
    const row = await this.db.prepare("SELECT * FROM subjects WHERE subject_id = ?").bind(subjectId).first<SubjectRow>();
    return row ? subjectFromRow(row) : undefined;
  }

  async putSubject(value: Subject): Promise<void> {
    await this.db.prepare(`
      INSERT INTO subjects (subject_id, kind, display_name, email, status, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(subject_id) DO UPDATE SET display_name = excluded.display_name, email = excluded.email,
        status = excluded.status, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
    `).bind(
      value.subjectId, value.kind, value.displayName, value.email ?? null, value.status,
      value.metadata ? JSON.stringify(value.metadata) : null, value.createdAt, value.updatedAt,
    ).run();
  }

  async listServiceAccountCredentials(subjectId: string): Promise<ServiceAccountCredential[]> {
    const result = await this.db.prepare("SELECT * FROM service_account_credentials WHERE subject_id = ?").bind(subjectId).all<CredentialRow>();
    return result.results.map(credentialFromRow);
  }

  async putServiceAccountCredential(value: ServiceAccountCredential): Promise<void> {
    await this.db.prepare(`
      INSERT INTO service_account_credentials
        (credential_id, subject_id, secret_hash, label, expires_at, revoked_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(credential_id) DO UPDATE SET secret_hash = excluded.secret_hash,
        label = excluded.label, expires_at = excluded.expires_at, revoked_at = excluded.revoked_at
    `).bind(
      value.credentialId, value.subjectId, value.secretHash, value.label,
      value.expiresAt ?? null, value.revokedAt ?? null, value.createdAt,
    ).run();
  }

  async putRefreshSession(value: RefreshSession): Promise<void> {
    await this.db.prepare(`
      INSERT INTO refresh_sessions (
        session_id, subject_id, token_hash, audience, expires_at, revoked_at, rotated_from,
        user_agent, ip_hash, created_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET token_hash = excluded.token_hash,
        expires_at = excluded.expires_at, revoked_at = excluded.revoked_at,
        last_used_at = excluded.last_used_at
    `).bind(
      value.sessionId, value.subjectId, value.tokenHash, value.audience, value.expiresAt,
      value.revokedAt ?? null, value.rotatedFrom ?? null, value.userAgent ?? null,
      value.ipHash ?? null, value.createdAt, value.lastUsedAt,
    ).run();
  }

  async findRefreshSession(tokenHash: string): Promise<RefreshSession | undefined> {
    const row = await this.db.prepare("SELECT * FROM refresh_sessions WHERE token_hash = ?").bind(tokenHash).first<SessionRow>();
    return row ? sessionFromRow(row) : undefined;
  }

  async listRefreshSessions(subjectId: string): Promise<RefreshSession[]> {
    const result = await this.db.prepare("SELECT * FROM refresh_sessions WHERE subject_id = ? ORDER BY created_at DESC").bind(subjectId).all<SessionRow>();
    return result.results.map(sessionFromRow);
  }

  async revokeRefreshSession(sessionId: string, at: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE refresh_sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL").bind(at, sessionId).run();
    return (result.meta.changes ?? 0) > 0;
  }

  async revokeRefreshSessionByHash(tokenHash: string, at: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE refresh_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").bind(at, tokenHash).run();
    return (result.meta.changes ?? 0) > 0;
  }

  async entitlementsFor(subjectId: string, serviceId: string): Promise<EffectiveScopeEntitlement[]> {
    const scopes = await this.db.prepare(`
      SELECT scope_id, claim_id FROM scopes WHERE service_id = ? ORDER BY scope_id
    `).bind(serviceId).all<{ scope_id: string; claim_id: string | null }>();
    const entitlements: EffectiveScopeEntitlement[] = [];
    for (const scope of scopes.results) {
      const memberRows = await this.db.prepare(`
        SELECT gm.group_id, gm.member_id, gm.member_kind
        FROM group_members gm JOIN scope_groups sg ON sg.group_id = gm.group_id
        WHERE sg.scope_id = ?
      `).bind(scope.scope_id).all<{ group_id: string; member_id: string; member_kind: SubjectKind }>();
      const groupIds = new Set<string>();
      let frontier = new Set([subjectId]);
      for (let depth = 0; depth < 16 && frontier.size; depth += 1) {
        const next = new Set<string>();
        for (const member of memberRows.results) {
          if (frontier.has(member.member_id) && !groupIds.has(member.group_id)) {
            groupIds.add(member.group_id);
            next.add(member.group_id);
          }
        }
        frontier = next;
      }
      const bindingRows = await this.db.prepare("SELECT * FROM bindings WHERE scope_id = ?").bind(scope.scope_id).all<{
        subject_id: string;
        subject_kind: SubjectKind;
        role_id: string | null;
        permission_id: string | null;
        path_space: string | null;
        named_path: string | null;
        inline_path_prefix: string | null;
      }>();
      const effective = bindingRows.results.filter(
        (binding) => binding.subject_id === subjectId || (binding.subject_kind === "Group" && groupIds.has(binding.subject_id)),
      );
      const roleIds = [...new Set(effective.flatMap((binding) => binding.role_id ? [binding.role_id] : []))];
      const pathGrants: CompactPathGrant[] = [];
      for (const binding of effective) {
        if (!binding.permission_id) continue;
        const namespace = binding.path_space ?? "default";
        if (binding.named_path) {
          pathGrants.push({ source: "named", permissionId: binding.permission_id, namespace, target: binding.named_path });
        } else if (binding.inline_path_prefix) {
          pathGrants.push({ source: "inline", permissionId: binding.permission_id, namespace, target: binding.inline_path_prefix });
        }
      }
      if (roleIds.length || groupIds.size || pathGrants.length) {
        entitlements.push({
          scopeId: scope.scope_id,
          ...(scope.claim_id ? { claimId: scope.claim_id } : {}),
          roleIds,
          groupIds: [...groupIds],
          pathGrants,
        });
      }
    }
    return entitlements;
  }

  async recordAuthEvent(subjectId: string, action: string, detail?: Record<string, unknown>): Promise<void> {
    const now = new Date().toISOString();
    await this.db.prepare(`
      INSERT INTO audit_events (event_id, actor_id, action, target_type, target_id, detail_json, created_at)
      VALUES (?, ?, ?, 'subject', ?, ?, ?)
    `).bind(crypto.randomUUID(), subjectId, action, subjectId, detail ? JSON.stringify(detail) : null, now).run();
  }
}
