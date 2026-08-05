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

export function decodeCompactScopeClaim(value: string): EffectiveScopeEntitlement {
  const [claimId, ...tokens] = value.split("|").map((token) => token.trim()).filter(Boolean);
  if (!claimId) throw new Error("compact scope claim is empty");
  const entitlement: EffectiveScopeEntitlement = {
    scopeId: claimId,
    roleIds: [],
    groupIds: [],
    pathGrants: [],
  };
  for (const token of tokens) {
    if (token.startsWith("r")) entitlement.roleIds.push(...token.slice(1).split(",").filter(Boolean));
    else if (token.startsWith("g")) entitlement.groupIds.push(...token.slice(1).split(",").filter(Boolean));
    else if (token.startsWith("P") || token.startsWith("p")) {
      const separator = token.indexOf(":");
      if (separator <= 1) continue;
      const permissionId = token.slice(1, separator);
      const targetValue = token.slice(separator + 1);
      const namespaceSeparator = targetValue.indexOf(":");
      entitlement.pathGrants.push({
        source: token.startsWith("P") ? "named" : "inline",
        permissionId,
        namespace: namespaceSeparator > 0 ? targetValue.slice(0, namespaceSeparator) : "default",
        target: namespaceSeparator > 0 ? targetValue.slice(namespaceSeparator + 1) : targetValue,
      });
    }
  }
  return entitlement;
}
