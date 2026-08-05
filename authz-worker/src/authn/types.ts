import type { Subject } from "../control-plane/domain";

export interface Identity {
  identityId: string;
  subjectId: string;
  username: string;
  passwordHash: string;
  mfaSecret?: string;
  mfaEnabled: boolean;
  recoveryCodes?: string[];
  externalProvider?: string;
  externalSubject?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceAccountCredential {
  credentialId: string;
  subjectId: string;
  secretHash: string;
  label: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface RefreshSession {
  sessionId: string;
  subjectId: string;
  tokenHash: string;
  audience: string;
  expiresAt: string;
  revokedAt?: string;
  rotatedFrom?: string;
  userAgent?: string;
  ipHash?: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface CompactPathGrant {
  source: "named" | "inline";
  permissionId: string;
  namespace: string;
  target: string;
}

export interface EffectiveScopeEntitlement {
  scopeId: string;
  claimId?: string;
  roleIds: string[];
  groupIds: string[];
  pathGrants: CompactPathGrant[];
}

export interface AuthnPrincipal {
  subject: Subject;
  identity?: Identity;
}

export interface TokenPair {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshToken?: string;
  refreshExpiresIn?: number;
}

export interface PublicJwk {
  kty: string;
  kid: string;
  alg: string;
  use: "sig";
  [key: string]: unknown;
}

export interface AuthnConfig {
  issuer: string;
  privateJwk: Record<string, unknown>;
  publicJwks: PublicJwk[];
  keyId: string;
  algorithm: "RS256" | "ES256";
  accessTokenSeconds: number;
  refreshTokenSeconds: number;
  allowedAudiences: string[];
  maxScopeClaims: number;
}

export interface RequestMetadata {
  userAgent?: string;
  ipHash?: string;
}
