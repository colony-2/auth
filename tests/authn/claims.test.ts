import { describe, expect, it } from "vitest";

import { buildCompactScopeClaims, encodeCompactScopeClaim } from "../../src/authn/claims";

describe("compact azs claims", () => {
  it("encodes sorted roles, groups, and namespaced path grants", () => {
    expect(encodeCompactScopeClaim({
      scopeId: "scope-alpha",
      claimId: "sa",
      roleIds: ["viewer", "admin", "viewer"],
      groupIds: ["ops-team"],
      pathGrants: [
        { source: "inline", permissionId: "w", namespace: "default", target: "home/alice/" },
        { source: "named", permissionId: "r", namespace: "datasets", target: "customer-raw" },
      ],
    })).toBe("sa|radmin,viewer|gops-team|pw:home/alice/|Pr:datasets:customer-raw");
  });

  it("enforces a configurable scope-claim limit", () => {
    const values = ["a", "b"].map((scopeId) => ({ scopeId, roleIds: ["viewer"], groupIds: [], pathGrants: [] }));
    expect(() => buildCompactScopeClaims(values, 1)).toThrow(/maximum is 1/);
  });
});
