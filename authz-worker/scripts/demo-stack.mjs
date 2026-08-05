import { execFileSync, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

import { exportJWK, generateKeyPair } from "jose";
import { unstable_startWorker } from "wrangler";

import { DEMO_SECRETS, DEMO_URLS } from "./demo-data.mjs";
import { seedDemo } from "./demo-seed.mjs";
import { runDemoTests } from "./demo-tests.mjs";

const testMode = process.argv.includes("--test");
const children = [];
const workers = [];

async function prepareSecrets() {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const privateJwk = { ...await exportJWK(privateKey), kid: "local-es256-1", alg: "ES256", use: "sig" };
  const publicJwk = { ...await exportJWK(publicKey), kid: "local-es256-1", alg: "ES256", use: "sig" };
  await mkdir(".wrangler", { recursive: true });
  await writeFile(".wrangler/demo-private-jwk.json", JSON.stringify(privateJwk), { mode: 0o600 });
  await writeFile(".dev.vars.authn", [
    `JWT_PRIVATE_JWK=${JSON.stringify(privateJwk)}`,
    `JWT_PUBLIC_JWKS=${JSON.stringify({ keys: [publicJwk] })}`,
    `INTERNAL_AUTH_TOKEN=${DEMO_SECRETS.internal}`,
    "IP_HASH_SECRET=local-ip-hash-secret",
    "BOOTSTRAP_ENABLED=true",
    `MANAGEMENT_API_URL=${DEMO_URLS.management}`,
    `MANAGEMENT_API_TOKEN=${DEMO_SECRETS.management}`,
  ].join("\n") + "\n", { mode: 0o600 });
  await writeFile(".dev.vars.management", [
    `MANAGEMENT_BOOTSTRAP_TOKEN=${DEMO_SECRETS.management}`,
    "AUTHZ_ADMIN_TOKEN=local-authz-admin-token",
    `AUTHZ_ADMIN_URL=${DEMO_URLS.gateway}`,
  ].join("\n") + "\n", { mode: 0o600 });
}

function runMigrations() {
  for (const [config, state] of [
    ["wrangler.management.jsonc", ".wrangler/state-management"],
    ["wrangler.authn.jsonc", ".wrangler/state-authn"],
  ]) {
    execFileSync("npx", ["--no-install", "wrangler", "d1", "migrations", "apply", "authz-control-plane", "--local", "--config", config, "--persist-to", state], { stdio: "inherit" });
  }
}

function start(name, command, args, env = {}) {
  const child = spawn(command, args, { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const recent = [];
  const consume = (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
      recent.push(line);
      if (recent.length > 20) recent.shift();
      if (!testMode && (/ready|http:\/\//i.test(line))) console.log(`[${name}] ${line}`);
    }
  };
  child.stdout.on("data", consume);
  child.stderr.on("data", consume);
  child.on("exit", (code) => {
    if (code && !child.killed) console.error(`${name} exited with ${code}\n${recent.join("\n")}`);
  });
  children.push(child);
  return child;
}

async function waitFor(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function stop() {
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(children.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3_000).unref();
  })));
  await Promise.allSettled(workers.reverse().map((worker) => worker.dispose()));
}

async function startTestWorker(config, persist, bindings) {
  const worker = await unstable_startWorker({
    config,
    bindings,
    envFiles: config === "wrangler.authn.jsonc"
      ? [".dev.vars.authn"]
      : config === "wrangler.management.jsonc" ? [".dev.vars.management"] : undefined,
    sendMetrics: false,
    dev: {
      watch: false,
      inspector: false,
      persist,
      server: { port: 0 },
    },
  });
  workers.push(worker);
  await worker.ready;
  const health = await worker.fetch("http://demo.local/health");
  if (!health.ok) throw new Error(`${config} failed its startup health check (${health.status})`);
  return worker;
}

async function forward(worker, input, init) {
  const request = typeof input === "object" && input !== null && "url" in input && "method" in input
    ? input
    : new Request(input, init);
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();
  return worker.fetch(request.url, {
    method: request.method,
    headers: request.headers,
    ...(body ? { body } : {}),
  });
}

async function relay(worker, input, init) {
  const result = await forward(worker, input, init);
  return new Response(await result.arrayBuffer(), {
    status: result.status,
    statusText: result.statusText,
    headers: [...result.headers.entries()],
  });
}

function tracedOutbound(name, handler) {
  return async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      console.error(`demo outbound ${name} failed`, error);
      throw error;
    }
  };
}

async function runProgrammaticTestStack() {
  let authn;
  let management;
  const upstream = await startTestWorker(
    "examples/project-workspace/wrangler.jsonc",
    ".wrangler/state-upstream",
  );
  const gateway = await startTestWorker(
    "wrangler.demo-authz.jsonc",
    ".wrangler/state-gateway",
    {
      AUTHN: { type: "fetcher", fetcher: tracedOutbound("gateway-authn", (request) => relay(authn, request)) },
      UPSTREAM: { type: "fetcher", fetcher: tracedOutbound("gateway-upstream", (request) => relay(upstream, request)) },
    },
  );
  management = await startTestWorker(
    "wrangler.management.jsonc",
    ".wrangler/state-management",
    { AUTHZ_ADMIN: { type: "fetcher", fetcher: tracedOutbound("management", (request) => relay(gateway, request)) } },
  );
  authn = await startTestWorker(
    "wrangler.authn.jsonc",
    ".wrangler/state-authn",
    { MANAGEMENT_API: { type: "fetcher", fetcher: tracedOutbound("authn", (request) => relay(management, request)) } },
  );

  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    switch (new URL(request.url).port) {
      case "8787": return forward(gateway, request);
      case "8788": return forward(authn, request);
      case "8789": return forward(management, request);
      case "8790": return forward(upstream, request);
      default: return nativeFetch(request);
    }
  };
  try {
    const seeded = await seedDemo();
    console.log(`Demo test data ready: ${JSON.stringify(seeded)}`);
    await runDemoTests();
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

async function main() {
  await prepareSecrets();
  runMigrations();
  if (testMode) {
    await runProgrammaticTestStack();
    await stop();
    return;
  }
  const wrangler = ["--no-install", "wrangler", "dev"];
  start("upstream", "npx", [...wrangler, "--config", "examples/project-workspace/wrangler.jsonc", "--port", "8790", "--inspector-port", "9230", "--persist-to", ".wrangler/state-upstream", "--log-level", "warn"]);
  start("authn", "npx", [...wrangler, "--config", "wrangler.authn.jsonc", "--port", "8788", "--inspector-port", "9231", "--persist-to", ".wrangler/state-authn", "--env-file", ".dev.vars.authn", "--log-level", "warn"]);
  start("management", "npx", [...wrangler, "--config", "wrangler.management.jsonc", "--port", "8789", "--inspector-port", "9232", "--persist-to", ".wrangler/state-management", "--env-file", ".dev.vars.management", "--log-level", "warn"]);
  start("gateway", "npx", [...wrangler, "--config", "wrangler.demo-authz.jsonc", "--port", "8787", "--inspector-port", "9233", "--persist-to", ".wrangler/state-gateway", "--log-level", "warn"]);
  start("ui", "npx", ["--no-install", "vite", "--config", "vite.config.ts", "--host", "127.0.0.1", "--port", "5173"], { VITE_MANAGEMENT_ACCESS_TOKEN: DEMO_SECRETS.management, VITE_DEMO_MODE: "true" });

  await Promise.all([
    waitFor(`${DEMO_URLS.upstream}/health`), waitFor(`${DEMO_URLS.authn}/health`),
    waitFor(`${DEMO_URLS.management}/health`), waitFor(`${DEMO_URLS.gateway}/health`), waitFor(DEMO_URLS.ui),
  ]);
  const seeded = await seedDemo();
  console.log(`Demo ready: ${JSON.stringify(seeded)}`);
  console.log(`Gateway       ${DEMO_URLS.gateway}`);
  console.log(`Authentication ${DEMO_URLS.authn}`);
  console.log(`Management    ${DEMO_URLS.management}`);
  console.log(`Console       ${DEMO_URLS.ui}`);
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await stop();
}

main().catch(async (error) => {
  console.error(error.stack ?? error.message);
  await stop();
  process.exitCode = 1;
});
