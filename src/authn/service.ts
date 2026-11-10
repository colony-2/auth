import {
  SignJWT,
  createLocalJWKSet,
  createRemoteJWKSet,
  importJWK,
  jwtVerify,
  type JWTPayload,
} from "jose";

import { buildCompactScopeClaims } from "./claims";
import {
  randomToken,
  randomTotpSecret,
  hashPassword,
  sha256,
  verifyPassword,
  verifyTotp,
} from "./crypto";
import type { AuthnRepository } from "./repository";
import type { AuthnConfig, RequestMetadata, TokenPair } from "./types";

export type AuthnErrorCode =
  | "invalid_request"
  | "invalid_credentials"
  | "invalid_token"
  | "mfa_required"
  | "invalid_mfa"
  | "account_unavailable"
  | "audience_not_allowed"
  | "session_expired"
  | "not_found";

export class AuthnError extends Error {
  constructor(
    readonly code: AuthnErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "AuthnError";
  }
}

export interface LoginInput {
  username: string;
  password: string;
  audience: string;
  mfaCode?: string;
}

export interface FederatedOidcInput {
  providerId: string;
  idToken: string;
  audience: string;
}

export class AuthenticationService {
  private readonly now: () => number;

  constructor(
    private readonly repository: AuthnRepository,
    private readonly config: AuthnConfig,
    options: { now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  jwks(): { keys: AuthnConfig["publicJwks"] } {
    return { keys: this.config.publicJwks };
  }

  async login(input: LoginInput, metadata: RequestMetadata = {}): Promise<TokenPair> {
    this.assertAudience(input.audience);
    const identity = await this.repository.findIdentityByUsername(input.username);
    if (!identity || !(await verifyPassword(input.password, identity.passwordHash))) {
      throw new AuthnError("invalid_credentials", "username or password is invalid", 401);
    }
    const subject = await this.requireActiveSubject(identity.subjectId);
    if (identity.mfaEnabled) {
      if (!input.mfaCode) throw new AuthnError("mfa_required", "multi-factor code is required", 401);
      const validTotp = identity.mfaSecret ? await verifyTotp(identity.mfaSecret, input.mfaCode, this.now()) : false;
      let validRecovery = false;
      if (!validTotp && identity.recoveryCodes?.length) {
        const codeHash = await sha256(input.mfaCode);
        const index = identity.recoveryCodes.indexOf(codeHash);
        if (index >= 0) {
          validRecovery = true;
          identity.recoveryCodes.splice(index, 1);
          identity.updatedAt = this.isoNow();
          await this.repository.putIdentity(identity);
        }
      }
      if (!validTotp && !validRecovery) throw new AuthnError("invalid_mfa", "multi-factor code is invalid", 401);
    }
    identity.lastLoginAt = this.isoNow();
    identity.updatedAt = identity.lastLoginAt;
    await this.repository.putIdentity(identity);
    await this.repository.recordAuthEvent(subject.subjectId, "auth.login", { audience: input.audience });
    return this.issueTokenPair(subject.subjectId, input.audience, metadata);
  }

  async federatedOidcLogin(input: FederatedOidcInput, metadata: RequestMetadata = {}): Promise<TokenPair> {
    this.assertAudience(input.audience);
    const provider = this.config.oidcProviders.find((candidate) => candidate.providerId === input.providerId);
    if (!provider) throw new AuthnError("invalid_request", "OIDC provider is not configured", 404);
    if (!provider.jwksUrl && !provider.jwks?.length) {
      throw new AuthnError("invalid_request", "OIDC provider has no JWKS configuration", 500);
    }
    let payload: JWTPayload;
    try {
      const keySet = provider.jwks?.length
        ? createLocalJWKSet({ keys: provider.jwks })
        : createRemoteJWKSet(new URL(provider.jwksUrl!));
      payload = (await jwtVerify(input.idToken, keySet, {
        issuer: provider.issuer,
        audience: provider.clientId,
        algorithms: provider.algorithms ?? ["RS256", "ES256"],
        maxTokenAge: "10m",
      })).payload;
    } catch {
      throw new AuthnError("invalid_credentials", "federated identity token is invalid", 401);
    }
    if (!payload.sub) throw new AuthnError("invalid_credentials", "federated identity has no subject", 401);
    if (provider.requireVerifiedEmail && (typeof payload.email !== "string" || payload.email_verified !== true)) {
      throw new AuthnError("invalid_credentials", "federated identity requires a verified email", 401);
    }
    if (provider.requiredAcrValues?.length && (
      typeof payload.acr !== "string" || !provider.requiredAcrValues.includes(payload.acr)
    )) {
      throw new AuthnError("invalid_credentials", "federated identity assurance is insufficient", 401);
    }

    let identity = await this.repository.findIdentityByExternal(provider.providerId, payload.sub);
    if (!identity) {
      const email = typeof payload.email === "string" ? payload.email.toLowerCase() : undefined;
      let subject = email ? await this.repository.findSubjectByEmail(email) : undefined;
      if (!subject && provider.jitProvisioning) {
        const now = this.isoNow();
        subject = {
          subjectId: `user-${crypto.randomUUID()}`,
          kind: "User",
          displayName: typeof payload.name === "string" ? payload.name : email ?? payload.sub,
          ...(email ? { email } : {}),
          status: "active",
          metadata: { provisionedBy: provider.providerId },
          createdAt: now,
          updatedAt: now,
        };
        await this.repository.putSubject(subject);
      }
      if (!subject) throw new AuthnError("account_unavailable", "federated identity is not provisioned", 403);
      identity = await this.repository.getIdentityBySubject(subject.subjectId);
      if (identity?.externalProvider && (
        identity.externalProvider !== provider.providerId || identity.externalSubject !== payload.sub
      )) {
        throw new AuthnError("account_unavailable", "subject is linked to another federated identity", 409);
      }
      if (identity) {
        identity.externalProvider = provider.providerId;
        identity.externalSubject = payload.sub;
      } else {
        const now = this.isoNow();
        const preferred = typeof payload.preferred_username === "string" ? payload.preferred_username : email;
        const username = preferred && !(await this.repository.findIdentityByUsername(preferred))
          ? preferred
          : `${provider.providerId}:${payload.sub}`;
        identity = {
          identityId: `identity-${crypto.randomUUID()}`,
          subjectId: subject.subjectId,
          username,
          passwordHash: await hashPassword(randomToken()),
          mfaEnabled: false,
          externalProvider: provider.providerId,
          externalSubject: payload.sub,
          createdAt: now,
          updatedAt: now,
        };
      }
    }
    const subject = await this.requireActiveSubject(identity.subjectId);
    identity.lastLoginAt = this.isoNow();
    identity.updatedAt = identity.lastLoginAt;
    await this.repository.putIdentity(identity);
    await this.repository.recordAuthEvent(subject.subjectId, "auth.federated_login", {
      providerId: provider.providerId,
      audience: input.audience,
    });
    return this.issueTokenPair(subject.subjectId, input.audience, metadata);
  }

  async serviceAccountToken(subjectId: string, clientSecret: string, audience: string): Promise<TokenPair> {
    this.assertAudience(audience);
    const subject = await this.requireActiveSubject(subjectId);
    if (subject.kind !== "ServiceAccount") {
      throw new AuthnError("invalid_credentials", "service account credentials are invalid", 401);
    }
    const now = this.isoNow();
    const credentials = await this.repository.listServiceAccountCredentials(subjectId);
    let valid = false;
    for (const credential of credentials) {
      if (!credential.revokedAt && (!credential.expiresAt || credential.expiresAt > now)) {
        valid ||= await verifyPassword(clientSecret, credential.secretHash);
      }
    }
    if (!valid) throw new AuthnError("invalid_credentials", "service account credentials are invalid", 401);
    await this.repository.recordAuthEvent(subjectId, "auth.service_account_token", { audience });
    return this.issueAccessToken(subjectId, audience);
  }

  async refresh(refreshToken: string, metadata: RequestMetadata = {}): Promise<TokenPair> {
    const tokenHash = await sha256(refreshToken);
    const session = await this.repository.findRefreshSession(tokenHash);
    const now = this.isoNow();
    if (!session || session.revokedAt || session.expiresAt <= now) {
      throw new AuthnError("session_expired", "refresh session is expired or revoked", 401);
    }
    await this.requireActiveSubject(session.subjectId);
    await this.repository.revokeRefreshSession(session.sessionId, now);
    await this.repository.recordAuthEvent(session.subjectId, "auth.refresh", { audience: session.audience });
    return this.issueTokenPair(session.subjectId, session.audience, metadata, session.sessionId);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = await sha256(refreshToken);
    const session = await this.repository.findRefreshSession(tokenHash);
    await this.repository.revokeRefreshSessionByHash(tokenHash, this.isoNow());
    if (session) await this.repository.recordAuthEvent(session.subjectId, "auth.logout");
  }

  async introspect(token: string): Promise<{ active: boolean; payload?: JWTPayload }> {
    try {
      const keySet = createLocalJWKSet({ keys: this.config.publicJwks });
      const result = await jwtVerify(token, keySet, {
        issuer: this.config.issuer,
        audience: this.config.allowedAudiences,
        algorithms: [this.config.algorithm],
      });
      const subject = result.payload.sub && await this.repository.getSubject(result.payload.sub);
      if (!subject || subject.status !== "active") return { active: false };
      return { active: true, payload: result.payload };
    } catch {
      return { active: false };
    }
  }

  async listSessions(subjectId: string): Promise<Array<Omit<Awaited<ReturnType<AuthnRepository["listRefreshSessions"]>>[number], "tokenHash">>> {
    return (await this.repository.listRefreshSessions(subjectId)).map(({ tokenHash: _tokenHash, ...session }) => session);
  }

  async revokeSession(subjectId: string, sessionId: string): Promise<boolean> {
    const session = (await this.repository.listRefreshSessions(subjectId)).find((candidate) => candidate.sessionId === sessionId);
    if (!session) return false;
    const revoked = await this.repository.revokeRefreshSession(sessionId, this.isoNow());
    if (revoked) await this.repository.recordAuthEvent(subjectId, "auth.session_revoke", { sessionId });
    return revoked;
  }

  async beginMfaEnrollment(subjectId: string): Promise<{ secret: string; otpauthUri: string }> {
    const subject = await this.requireActiveSubject(subjectId);
    const identity = await this.repository.getIdentityBySubject(subjectId);
    if (!identity) throw new AuthnError("not_found", "identity not found", 404);
    const secret = randomTotpSecret();
    identity.mfaSecret = secret;
    identity.mfaEnabled = false;
    identity.updatedAt = this.isoNow();
    await this.repository.putIdentity(identity);
    const label = encodeURIComponent(`${this.config.issuer}:${identity.username}`);
    const issuer = encodeURIComponent(this.config.issuer);
    await this.repository.recordAuthEvent(subject.subjectId, "auth.mfa_enrollment_started");
    return { secret, otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}` };
  }

  async confirmMfaEnrollment(subjectId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const identity = await this.repository.getIdentityBySubject(subjectId);
    if (!identity?.mfaSecret || !(await verifyTotp(identity.mfaSecret, code, this.now()))) {
      throw new AuthnError("invalid_mfa", "multi-factor code is invalid", 400);
    }
    const recoveryCodes = Array.from({ length: 8 }, () => randomToken(9));
    identity.recoveryCodes = await Promise.all(recoveryCodes.map(sha256));
    identity.mfaEnabled = true;
    identity.updatedAt = this.isoNow();
    await this.repository.putIdentity(identity);
    await this.repository.recordAuthEvent(subjectId, "auth.mfa_enabled");
    return { recoveryCodes };
  }

  async verifyAccessToken(token: string): Promise<JWTPayload> {
    const result = await this.introspect(token);
    if (!result.active || !result.payload) throw new AuthnError("invalid_token", "access token is invalid", 401);
    return result.payload;
  }

  private async issueTokenPair(
    subjectId: string,
    audience: string,
    metadata: RequestMetadata,
    rotatedFrom?: string,
  ): Promise<TokenPair> {
    const access = await this.issueAccessToken(subjectId, audience);
    const refreshToken = randomToken();
    const now = this.isoNow();
    const sessionId = crypto.randomUUID();
    await this.repository.putRefreshSession({
      sessionId,
      subjectId,
      tokenHash: await sha256(refreshToken),
      audience,
      expiresAt: new Date(this.now() + this.config.refreshTokenSeconds * 1000).toISOString(),
      ...(rotatedFrom ? { rotatedFrom } : {}),
      ...metadata,
      createdAt: now,
      lastUsedAt: now,
    });
    return {
      ...access,
      refreshToken,
      refreshExpiresIn: this.config.refreshTokenSeconds,
    };
  }

  private async issueAccessToken(subjectId: string, audience: string): Promise<TokenPair> {
    const subject = await this.requireActiveSubject(subjectId);
    const entitlements = await this.repository.entitlementsFor(subjectId, audience);
    const azs = buildCompactScopeClaims(entitlements, this.config.maxScopeClaims);
    const key = await importJWK(this.config.privateJwk, this.config.algorithm);
    const accessToken = await new SignJWT({ azv: 1, azs, suspended: subject.status === "suspended" })
      .setProtectedHeader({ alg: this.config.algorithm, kid: this.config.keyId, typ: "JWT" })
      .setIssuer(this.config.issuer)
      .setAudience(audience)
      .setSubject(subjectId)
      .setJti(crypto.randomUUID())
      .setIssuedAt(Math.floor(this.now() / 1000))
      .setExpirationTime(Math.floor(this.now() / 1000) + this.config.accessTokenSeconds)
      .sign(key);
    if (accessToken.length > 12_000) throw new AuthnError("invalid_request", "effective entitlements exceed token size limit", 422);
    return { accessToken, tokenType: "Bearer", expiresIn: this.config.accessTokenSeconds };
  }

  private assertAudience(audience: string): void {
    if (!this.config.allowedAudiences.includes(audience)) {
      throw new AuthnError("audience_not_allowed", "token audience is not allowed", 400);
    }
  }

  private async requireActiveSubject(subjectId: string) {
    const subject = await this.repository.getSubject(subjectId);
    if (!subject || subject.status !== "active") {
      throw new AuthnError("account_unavailable", "account is not active", 403);
    }
    return subject;
  }

  private isoNow(): string {
    return new Date(this.now()).toISOString();
  }
}
