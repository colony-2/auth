# Cedar on Cloudflare Workers Handoff

Status: historical benchmark report from 2026-04-04. The original benchmark Worker, baseline Worker, and benchmark/probe scripts are not present in this checkout. File names, routes, and commands below describe that experiment and cannot be used to reproduce it from the current tree. The measurements have not been rerun for the current gateway.

The current implementation uses the same initialization approach in [src/lib.ts](src/lib.ts); see [README.md](README.md) for supported commands.

## Goal

Evaluate the best-case performance and viability of doing edge request validation on Cloudflare Workers using Cedar via `cedar-wasm`.

Test date: `2026-04-04`

Environment used:

- Node: `v25.8.1`
- npm: `11.12.0`
- Wrangler: `4.80.0`
- `@cedar-policy/cedar-wasm`: `4.9.1`

## Bottom Line

Best-case Cedar evaluation on a Cloudflare Worker looks viable if all of the following are true:

- you use the `@cedar-policy/cedar-wasm/web` entrypoint
- you explicitly initialize the wasm module with `initSync({ module })`
- you preparse the policy set once per isolate with `preparsePolicySet()`
- you evaluate requests with `statefulIsAuthorized()`
- you avoid parsing policies on every request

Observed local-runtime numbers:

- Hot `statefulIsAuthorized()` eval inside the Worker: about `12.5-13 µs` per authorization
- Hot end-to-end auth request in local Wrangler runtime: about `2.4-4.6 ms`
- One-time Cedar init + policy preparse: about `13-14 ms`
- First auth request on a fresh Worker: about `67-78 ms`
- Raw parse-on-every-call path: about `70-80 µs` hot, roughly `5-6x` slower than the preparsed/stateful path

Interpretation:

- Cedar evaluation itself is cheap in the best case.
- Request overhead and isolate startup matter more than the authorization operation once warm.
- Cold start is real, but the main one-time Cedar cost measured here was on the order of tens of milliseconds, not hundreds.

## Important Findings

### 1. Default Cedar ESM import path did not work in local Workers

This failed:

- importing from `@cedar-policy/cedar-wasm`

Observed failure during Worker startup:

```text
Uncaught TypeError: wasm2.__wbindgen_start is not a function
```

Why this likely happened:

- The default Cedar ESM build expects a different wasm loading shape than the local Worker runtime provided here.
- Cloudflare Workers treat imported `.wasm` files as `WebAssembly.Module`s, not already-instantiated exports.

What worked:

- import from `@cedar-policy/cedar-wasm/web`
- import the wasm binary separately
- call `initSync({ module: wasmModule })`

Working initialization is in `src/index.ts`.

### 2. Preparsed/stateful Cedar is the only path worth considering

Best-case path:

- `preparsePolicySet(policySetId, policies)` once
- `statefulIsAuthorized(...)` per request

Comparison from local measurements:

- `stateful`: about `12.5-13 µs` per eval hot
- `raw isAuthorized` with inline policy parsing: about `70-80 µs` per eval hot

That makes the raw path materially worse even with a trivial policy and empty entities/context.

### 3. Lazy initialization matters

The Worker lazily loads Cedar only on the authorization route, not on the baseline route.

This lets you separate:

- baseline Worker overhead
- Cedar startup overhead
- steady-state Cedar authorization cost

Without lazy init, first-request timing gets polluted by module-load cost before request handling.

### 4. Direct HTTP to `wrangler dev --local` was not reliable in this sandbox

Requests to the port exposed by `wrangler dev --local` timed out in this environment, even for a one-line baseline Worker.

This turned out to be an environment/runtime access issue for this sandbox, not a Worker logic issue.

Reliable workaround:

- use Wrangler's programmatic `unstable_dev()` API
- call `worker.fetch(...)` directly

This still exercises Wrangler's local development runtime path and produced stable results.

### 5. Bundle size is non-trivial

`npx wrangler deploy --dry-run` reported:

- Total Upload: `4142.64 KiB`
- gzip: `1388.31 KiB`

Inference:

- `cedar-wasm` is large enough that artifact size and cold-start behavior should be treated as first-class concerns.
- This matters if the auth Worker is on a latency-critical path or if isolates churn heavily.

## What Was Built

### Cedar benchmark Worker

File: `src/index.ts`

Routes:

- `/baseline`
  - returns `"ok"`
  - does not touch Cedar
- `/authorize-best-case`
  - lazy-inits Cedar if needed
  - uses `statefulIsAuthorized()`
- `/authorize-raw`
  - lazy-inits Cedar if needed
  - uses `isAuthorized()` with inline policies
- `/loop?variant=...&iterations=...`
  - runs repeated authorizations inside the Worker
  - used to separate Worker HTTP overhead from Cedar eval cost
- `/health`
  - exposes `cedarReady` and `cedarInitElapsedMs`

Policy shape used:

- single static permit policy
- principal: `User::"alice"`
- action: `Action::"read"`
- resource: `Document::"doc-1"`
- empty entities
- empty context
- `validateRequest: false`

This is intentionally close to a lower-bound benchmark.

### Baseline Worker

File: `src/baseline.ts`

Purpose:

- measure non-Cedar local Worker overhead

### Benchmark harness

File: `scripts/bench.mjs`

What it does:

- starts Workers with `unstable_dev()`
- measures:
  - pure baseline Worker requests
  - Cedar Worker baseline requests
  - Cedar auth requests
  - in-Worker stateful loop
  - in-Worker raw loop

### Direct probe helper

File: `scripts/probe-unstable.mjs`

Purpose:

- one-off route probing with configurable script, config, path, request count, and timeout

## Config and Packaging

Files:

- `package.json`
- `wrangler.jsonc`
- `wrangler.baseline.jsonc`
- `src/wasm.d.ts`

Notable packaging detail:

- `postinstall` copies Cedar's wasm binary into `src/cedar_wasm_bg.wasm`

Reason:

- the Worker imports the wasm file directly from project source
- this keeps the Cloudflare bundling path explicit and compatible with `initSync({ module })`

## Measured Results

Final benchmark run from `npm run bench`:

### Baseline Worker

- first request: `21.053792 ms`
- second request: `1.551875 ms`
- third request: `1.139875 ms`

### Cedar Worker, baseline route

- first request: `50.84375 ms`
- second request: `1.39975 ms`

Meaning:

- Cedar Worker module/bundle is heavier than the plain baseline Worker even when the request does not use Cedar.
- The steady-state baseline route overhead is still low once warm.

### Cedar Worker, best-case auth route

- first request: `67.571042 ms`
- second request: `4.633833 ms`

Meaning:

- first auth request includes Cedar init + preparse + normal Worker request cost
- hot request is in low-single-digit milliseconds locally

### In-Worker loop, stateful path

Request 1 body:

```json
{"variant":"stateful","iterations":2000,"elapsedMs":57,"perEvalUs":28.5,"lastDecision":"allow","cedarInitElapsedMs":14}
```

Request 2 body:

```json
{"variant":"stateful","iterations":2000,"elapsedMs":25,"perEvalUs":12.5,"lastDecision":"allow","cedarInitElapsedMs":14}
```

Meaning:

- first loop still carries warm-up effects
- steady-state best-case Cedar eval cost was about `12.5 µs`

### In-Worker loop, raw path

Request 1 body:

```json
{"variant":"raw","iterations":100,"elapsedMs":26,"perEvalUs":260,"lastDecision":"allow","cedarInitElapsedMs":13}
```

Request 2 body:

```json
{"variant":"raw","iterations":100,"elapsedMs":8,"perEvalUs":80,"lastDecision":"allow","cedarInitElapsedMs":13}
```

Meaning:

- raw parse-on-every-call is much worse than stateful/preparsed
- on the warmed measurement it was about `80 µs` vs `12.5 µs`

## Original reproduction commands (historical)

Install:

```bash
npm install
```

Run the canned benchmark:

```bash
npm run bench
```

Run a focused probe:

```bash
npm run probe -- --script src/index.ts --config wrangler.jsonc --path /authorize-best-case --requests 2 --timeout-ms 60000
```

Probe baseline Worker:

```bash
npm run probe -- --script src/baseline.ts --config wrangler.baseline.jsonc --path / --requests 3 --timeout-ms 5000
```

Dry-run build:

```bash
npx wrangler deploy --dry-run
```

## Recommended Design Guidance

If another agent is building on this, assume the following:

- Do not use `@cedar-policy/cedar-wasm` default import path in the Worker until proven otherwise.
- Use `@cedar-policy/cedar-wasm/web`.
- Import the wasm binary explicitly and initialize with `initSync({ module })`.
- Keep Cedar initialization lazy unless startup cost is irrelevant.
- Preparse policy sets at isolate startup or first use.
- Use `statefulIsAuthorized()` for request-time checks.
- Avoid request parsing/validation work unless you need it.
- Treat `validateRequest: false` as part of the measured lower bound. Enabling validation will cost more.
- Assume real workloads with schemas, non-empty entities, or larger context payloads will be slower than these numbers.

## What This Benchmark Does Not Cover

This is important. The benchmark is intentionally optimistic.

It does not measure:

- Cedar schemas
- `preparseSchema()`
- request validation against schema
- non-empty entity graphs
- large request context payloads
- complex policies
- multiple policies
- template-linked policies
- partial evaluation
- remote Cloudflare edge behavior
- isolate eviction frequency under load

So these results should be treated as:

- a lower bound for simple, hot, preparsed policy evaluation
- not a production latency guarantee

## Suggested Next Experiments

Highest-value follow-ups:

1. Add schema parsing and request validation.
2. Benchmark with realistic entity sets and context size.
3. Benchmark multiple policies, not just one trivial permit.
4. Measure impact of template links if your design uses them.
5. Deploy to an actual Cloudflare Worker and compare cold/warm timings against local `unstable_dev`.
6. Measure isolate churn scenarios if low-traffic cold starts matter.
7. Evaluate whether a separate auth Worker or shared library layout changes startup behavior.

## Known References

Cloudflare docs showing `unstable_dev()` usage:

- https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-from-unstable-dev/

Cloudflare docs for non-JS modules in Workers/Vite plugin, relevant to `.wasm` module import behavior:

- https://developers.cloudflare.com/workers/vite-plugin/reference/non-javascript-modules/

Note:

- The `.wasm` import behavior point above is partly an inference from Cloudflare's module model plus the observed Cedar failure mode. The practical result was confirmed locally by the working `web` + explicit `initSync({ module })` path and the failing default import path.

## Files To Look At First

If another agent continues this work, start here:

- `src/index.ts`
- `scripts/bench.mjs`
- `scripts/probe-unstable.mjs`
- `package.json`
- `wrangler.jsonc`
