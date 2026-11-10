import { DEMO_URLS } from "./demo-data.mjs";
import { mintDemoToken } from "./demo-token.mjs";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const user = arg("user", "alice");
const method = arg("method", "GET").toUpperCase();
const path = arg("path", "/projects/proj-alpha");
const scope = arg("scope", "proj-alpha");

try {
  const token = await mintDemoToken(user);
  const response = await fetch(`${DEMO_URLS.gateway}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "x-scope-id": scope, ...(method === "GET" ? {} : { "content-type": "application/json" }) },
    ...(method === "GET" || method === "HEAD" ? {} : { body: "{}" }),
  });
  const body = await response.text();
  console.log(JSON.stringify({ status: response.status, body: body ? JSON.parse(body) : null }, null, 2));
  if (!response.ok) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
