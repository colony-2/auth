const required = ["AUTHN_URL", "MANAGEMENT_URL", "GATEWAY_URL", "MANAGEMENT_UI_URL"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`missing smoke-test environment variables: ${missing.join(", ")}`);

const urls = Object.fromEntries(required.map((name) => [name, process.env[name].replace(/\/$/, "")]));

async function check(name, action) {
  try {
    await action();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

async function expectStatus(url, expected, init) {
  const response = await fetch(url, init);
  if (response.status !== expected) {
    throw new Error(`${url} returned ${response.status}; expected ${expected}: ${await response.text()}`);
  }
  return response;
}

await check("authentication health", () => expectStatus(`${urls.AUTHN_URL}/health`, 200));
await check("public JWKS", async () => {
  const value = await (await expectStatus(`${urls.AUTHN_URL}/.well-known/jwks.json`, 200)).json();
  if (!Array.isArray(value.keys) || !value.keys.length) throw new Error("JWKS contains no keys");
});
await check("management health", () => expectStatus(`${urls.MANAGEMENT_URL}/health`, 200));
await check("management OpenAPI", () => expectStatus(`${urls.MANAGEMENT_URL}/openapi/management-service.openapi.yaml`, 200));
await check("management UI", () => expectStatus(urls.MANAGEMENT_UI_URL, 200));

if (process.env.SMOKE_USERNAME && process.env.SMOKE_PASSWORD) {
  let token;
  await check("mint smoke token", async () => {
    const response = await expectStatus(`${urls.AUTHN_URL}/auth/login`, 200, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: process.env.SMOKE_USERNAME,
        password: process.env.SMOKE_PASSWORD,
        audience: process.env.SMOKE_AUDIENCE ?? "projects-api",
      }),
    });
    token = (await response.json()).accessToken;
    if (!token) throw new Error("login response contains no access token");
  });
  if (token) {
    const headers = { authorization: `Bearer ${token}`, "x-scope-id": process.env.SMOKE_SCOPE_ID ?? "proj-alpha" };
    await check("known allowed route", async () => {
      const response = await expectStatus(`${urls.GATEWAY_URL}/projects/${process.env.SMOKE_PROJECT_ID ?? "proj-alpha"}`, 200, { headers });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("upstream response is not JSON");
    });
    await check("known denied route", () => expectStatus(
      `${urls.GATEWAY_URL}/projects/${process.env.SMOKE_PROJECT_ID ?? "proj-alpha"}`,
      403,
      { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: "{}" },
    ));
  }
} else {
  console.log("SKIP protected-route checks; set SMOKE_USERNAME and SMOKE_PASSWORD to enable them");
}

if (process.exitCode) throw new Error("deployment smoke tests failed");
