import { SignJWT, decodeJwt, exportJWK, generateKeyPair, importJWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { hashPassword } from "../../src/authn/crypto";
import { MemoryAuthnRepository } from "../../src/authn/repository";
import { AuthenticationService, AuthnError } from "../../src/authn/service";
import type { AuthnConfig, Identity } from "../../src/authn/types";
import type { Subject } from "../../src/control-plane/domain";

let config: AuthnConfig;
let providerPrivateJwk: JsonWebKey;
let providerPublicJwk: JsonWebKey;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const privateJwk = await exportJWK(privateKey);
  const publicJwk = await exportJWK(publicKey);
  const providerKeys = await generateKeyPair("ES256", { extractable: true });
  providerPrivateJwk = await exportJWK(providerKeys.privateKey);
  providerPublicJwk = await exportJWK(providerKeys.publicKey);
  config = {
    issuer: "https://auth.example.test/",
    privateJwk: { ...privateJwk, kid: "test-key", alg: "ES256", use: "sig" },
    publicJwks: [{ ...publicJwk, kty: publicJwk.kty!, kid: "test-key", alg: "ES256", use: "sig" }],
    keyId: "test-key",
    algorithm: "ES256",
    accessTokenSeconds: 600,
    refreshTokenSeconds: 3_600,
    allowedAudiences: ["projects-api"],
    maxScopeClaims: 64,
    oidcProviders: [],
  };
});

async function setup(status: Subject["status"] = "active") {
  const repository = new MemoryAuthnRepository();
  const now = new Date().toISOString();
  const subject: Subject = {
    subjectId: "user-alice",
    kind: "User",
    displayName: "Alice",
    email: "alice@example.test",
    status,
    createdAt: now,
    updatedAt: now,
  };
  const identity: Identity = {
    identityId: "identity-alice",
    subjectId: subject.subjectId,
    username: "alice",
    passwordHash: await hashPassword("alice-password", 1_000),
    mfaEnabled: false,
    createdAt: now,
    updatedAt: now,
  };
  await repository.putSubject(subject);
  await repository.putIdentity(identity);
  repository.setEntitlements(subject.subjectId, "projects-api", [{
    scopeId: "project-alpha",
    claimId: "pa",
    roleIds: ["viewer"],
    groupIds: ["ops-team"],
    pathGrants: [{ source: "named", permissionId: "r", namespace: "files", target: "shared-docs" }],
  }]);
  return { repository, service: new AuthenticationService(repository, config) };
}

describe("AuthenticationService", () => {
  it("logs in, emits Worker-compatible claims, and rotates refresh sessions", async () => {
    const { repository, service } = await setup();
    const first = await service.login({ username: "alice", password: "alice-password", audience: "projects-api" });
    const payload = decodeJwt(first.accessToken);
    expect(payload).toMatchObject({
      iss: config.issuer,
      aud: "projects-api",
      sub: "user-alice",
      azv: 1,
      suspended: false,
      azs: ["pa|rviewer|gops-team|Pr:files:shared-docs"],
    });
    expect((await service.introspect(first.accessToken)).active).toBe(true);

    repository.setEntitlements("user-alice", "projects-api", [{
      scopeId: "project-alpha",
      claimId: "pa",
      roleIds: ["project-manager"],
      groupIds: [],
      pathGrants: [],
    }]);
    const rotated = await service.refresh(first.refreshToken!);
    expect(decodeJwt(rotated.accessToken).azs).toEqual(["pa|rproject-manager"]);
    await expect(service.refresh(first.refreshToken!)).rejects.toMatchObject({ code: "session_expired" });
  });

  it("uses a generic error for invalid credentials", async () => {
    const { service } = await setup();
    await expect(service.login({ username: "alice", password: "wrong-password", audience: "projects-api" }))
      .rejects.toEqual(expect.objectContaining({ code: "invalid_credentials", status: 401 }));
  });

  it("does not mint tokens for suspended subjects", async () => {
    const { service } = await setup("suspended");
    await expect(service.login({ username: "alice", password: "alice-password", audience: "projects-api" }))
      .rejects.toBeInstanceOf(AuthnError);
  });

  it("links a verified OIDC identity to a provisioned subject", async () => {
    const { repository } = await setup();
    const providerConfig: AuthnConfig = {
      ...config,
      oidcProviders: [{
        providerId: "workforce",
        issuer: "https://idp.example.test/",
        clientId: "authz-console",
        jwks: [{ ...providerPublicJwk, kty: providerPublicJwk.kty!, kid: "idp-key", alg: "ES256", use: "sig" }],
        requireVerifiedEmail: true,
        requiredAcrValues: ["urn:mfa"],
      }],
    };
    const idToken = await new SignJWT({
      email: "alice@example.test",
      email_verified: true,
      preferred_username: "alice@example.test",
      acr: "urn:mfa",
    })
      .setProtectedHeader({ alg: "ES256", kid: "idp-key" })
      .setIssuer("https://idp.example.test/")
      .setAudience("authz-console")
      .setSubject("external-alice")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(await importJWK(providerPrivateJwk, "ES256"));
    const service = new AuthenticationService(repository, providerConfig);
    const pair = await service.federatedOidcLogin({ providerId: "workforce", idToken, audience: "projects-api" });
    expect(decodeJwt(pair.accessToken).sub).toBe("user-alice");
    expect(await repository.findIdentityByExternal("workforce", "external-alice"))
      .toMatchObject({ subjectId: "user-alice", externalProvider: "workforce" });
  });
});
