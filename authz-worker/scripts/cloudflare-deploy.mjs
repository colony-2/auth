import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const envIndex = process.argv.indexOf("--env");
const environment = envIndex >= 0 ? process.argv[envIndex + 1] : undefined;
const dryRun = args.has("--dry-run");
const skipMigrations = args.has("--skip-migrations");

if (!environment || !["staging", "production"].includes(environment)) {
  throw new Error("usage: cloudflare-deploy.mjs --env staging|production [--dry-run] [--skip-migrations]");
}

const required = dryRun ? [] : [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "VITE_MANAGEMENT_API_BASE_URL",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`missing deployment environment variables: ${missing.join(", ")}`);

function run(command, commandArgs, extraEnv = {}) {
  console.log(`> ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const wrangler = ["--no-install", "wrangler"];
if (!dryRun && !skipMigrations) {
  run("npx", [
    ...wrangler, "d1", "migrations", "apply", `authz-control-plane-${environment}`,
    "--remote", "--env", environment, "--config", "wrangler.management.jsonc",
  ]);
}

const deployments = [
  ["examples/project-workspace/wrangler.jsonc"],
  ["wrangler.authn.jsonc"],
  ["wrangler.demo-authz.jsonc"],
  ["wrangler.management.jsonc"],
];
for (const [config] of deployments) {
  run("npx", [
    ...wrangler, "deploy", "--config", config, "--env", environment,
    ...(dryRun ? ["--dry-run"] : []),
  ]);
}

run("npm", ["run", "build:management-ui"], {
  VITE_MANAGEMENT_API_BASE_URL: process.env.VITE_MANAGEMENT_API_BASE_URL ?? "https://management.example.invalid",
});
run("npx", [
  ...wrangler, "deploy", "--config", "wrangler.ui.jsonc", "--env", environment,
  ...(dryRun ? ["--dry-run"] : []),
]);

console.log(`${environment} deployment ${dryRun ? "dry run" : "completed"}`);
