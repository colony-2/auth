import { DEMO_SECRETS, DEMO_URLS } from "./demo-data.mjs";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export async function mintDemoToken(user = "alice", audience = "projects-api") {
  const response = user === "automation"
    ? await fetch(`${DEMO_URLS.authn}/service-accounts/service-automation/tokens`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientSecret: DEMO_SECRETS.serviceAccount, audience }),
    })
    : await fetch(`${DEMO_URLS.authn}/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: user, password: `${user}-password`, audience }),
    });
  const value = await response.json();
  if (!response.ok) throw new Error(`token request failed (${response.status}): ${JSON.stringify(value)}`);
  return value.accessToken;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mintDemoToken(arg("user", "alice"), arg("aud", "projects-api"))
    .then((token) => console.log(token))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
