function argument(name, required = true) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (required && !value) throw new Error(`--${name} is required`);
  return value;
}

const managementUrl = argument("management-url").replace(/\/$/, "");
const token = argument("token");
const serviceId = argument("service");
const targetVersion = argument("version");
const scopeId = argument("scope", false);
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

async function api(path, init = {}) {
  const response = await fetch(`${managementUrl}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const text = await response.text();
  const value = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${JSON.stringify(value)}`);
  return value;
}

const versionsPath = scopeId ? `/scopes/${encodeURIComponent(scopeId)}/versions` : `/services/${encodeURIComponent(serviceId)}/versions`;
const versions = await api(versionsPath);
const selected = versions.items.find((item) => item.versionId === targetVersion);
if (!selected) throw new Error(`version ${targetVersion} was not found`);

const rollbackVersion = `rollback-${targetVersion}-${Date.now()}`;
if (scopeId) {
  const artifact = selected.artifact;
  await api(`/scopes/${encodeURIComponent(scopeId)}/config`, {
    method: "PUT",
    body: JSON.stringify({
      includes: artifact.includes ?? [],
      ...(artifact.policy ? { policy: artifact.policy } : {}),
      namedPaths: artifact.namedPaths ?? {},
      staticEntities: artifact.staticEntities ?? [],
      metadata: { ...(artifact.metadata ?? {}), rollbackFrom: targetVersion },
    }),
  });
  await api(`/scopes/${encodeURIComponent(scopeId)}/publish`, { method: "POST", body: JSON.stringify({ version: rollbackVersion }) });
} else {
  const artifact = selected.artifact;
  await api(`/services/${encodeURIComponent(serviceId)}/config`, {
    method: "PUT",
    body: JSON.stringify({
      ...(artifact.openApiDocument ? { openApiDocument: artifact.openApiDocument } : {}),
      authDescriptor: artifact.authDescriptor,
      ...(artifact.schema ? { schema: artifact.schema } : {}),
      snippets: artifact.snippets ?? {},
      ...(artifact.globalPolicy ? { globalPolicy: artifact.globalPolicy } : {}),
      namedPaths: artifact.namedPaths ?? {},
      metadata: { ...(artifact.metadata ?? {}), rollbackFrom: targetVersion },
    }),
  });
  await api(`/services/${encodeURIComponent(serviceId)}/publish`, { method: "POST", body: JSON.stringify({ version: rollbackVersion }) });
}

console.log(JSON.stringify({ serviceId, ...(scopeId ? { scopeId } : {}), targetVersion, rollbackVersion }, null, 2));
