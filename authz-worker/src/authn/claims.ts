import type { EffectiveScopeEntitlement } from "./types";

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function encodeCompactScopeClaim(entitlement: EffectiveScopeEntitlement): string {
  const tokens = [entitlement.claimId ?? entitlement.scopeId];
  const roleIds = unique(entitlement.roleIds);
  const groupIds = unique(entitlement.groupIds);
  if (roleIds.length) tokens.push(`r${roleIds.join(",")}`);
  if (groupIds.length) tokens.push(`g${groupIds.join(",")}`);
  for (const grant of [...entitlement.pathGrants].sort((a, b) =>
    `${a.source}:${a.permissionId}:${a.namespace}:${a.target}`.localeCompare(
      `${b.source}:${b.permissionId}:${b.namespace}:${b.target}`,
    ))) {
    const source = grant.source === "named" ? "P" : "p";
    const namespace = grant.namespace === "default" ? "" : `${grant.namespace}:`;
    tokens.push(`${source}${grant.permissionId}:${namespace}${grant.target}`);
  }
  return tokens.join("|");
}

export function buildCompactScopeClaims(
  entitlements: EffectiveScopeEntitlement[],
  maxScopeClaims = 64,
): string[] {
  if (entitlements.length > maxScopeClaims) {
    throw new Error(`subject has ${entitlements.length} scope claims; maximum is ${maxScopeClaims}`);
  }
  return [...entitlements]
    .sort((a, b) => (a.claimId ?? a.scopeId).localeCompare(b.claimId ?? b.scopeId))
    .map(encodeCompactScopeClaim);
}
