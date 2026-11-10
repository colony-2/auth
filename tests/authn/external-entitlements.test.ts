import { describe, expect, it, vi } from "vitest";

import { MemoryAuthnRepository, RemoteEntitlementAuthnRepository } from "../../src/authn/repository";

describe("external entitlement projection", () => {
  it("requests and decodes compatible compact claims", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      subjectId: "user-alice",
      serviceId: "projects-api",
      azv: 1,
      azs: ["pa|rviewer|Pr:files:shared-docs"],
    }));
    const repository = new RemoteEntitlementAuthnRepository(
      new MemoryAuthnRepository(),
      "https://entitlements.example.test/",
      "projection-token",
      { fetch } as unknown as Fetcher,
    );

    await expect(repository.entitlementsFor("user-alice", "projects-api")).resolves.toEqual([{
      scopeId: "pa",
      roleIds: ["viewer"],
      groupIds: [],
      pathGrants: [{ source: "named", permissionId: "r", namespace: "files", target: "shared-docs" }],
    }]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe("https://entitlements.example.test/services/projects-api/subjects/user-alice/claim-preview");
    expect(fetch.mock.calls[0]?.[1]).toEqual({ headers: { authorization: "Bearer projection-token" } });
  });

  it("fails token projection when the external service rejects the request", async () => {
    const repository = new RemoteEntitlementAuthnRepository(
      new MemoryAuthnRepository(),
      "https://entitlements.example.test",
      "projection-token",
      {
        fetch: vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
          new Response(null, { status: 503 })
        )),
      } as unknown as Fetcher,
    );

    await expect(repository.entitlementsFor("user-alice", "projects-api"))
      .rejects.toThrow("management claim projection failed with 503");
  });
});
