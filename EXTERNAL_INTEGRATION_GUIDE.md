# External Integration Guide

Use this mode when the protected application is an external HTTP service and authz should sit in front of it as a proxy.

This is the lowest-boilerplate pattern for:

- existing HTTP services
- non-Worker backends
- services that should not know Cedar or policy details

## When To Use This

Use proxy mode when:

- your protected service is outside the authz Worker
- you want authz enforcement at the edge before traffic reaches the service
- you want the upstream service to stay mostly unaware of policy logic

## Minimal Pattern

The smallest integration is:

```ts
import { createAuthzProxy, type AuthzProxyEnv } from "./lib";

export interface WorkerEnv extends AuthzProxyEnv {
  UPSTREAM_ORIGIN: string;
}

export default createAuthzProxy<WorkerEnv>();
```

Reference entrypoint: [index.ts](src/index.ts)

This does the following:

- protected allow decisions are proxied to `UPSTREAM_ORIGIN`
- protected deny decisions return `403`
- unresolved routes pass through to the upstream by default

## What The Upstream Sees

On allow, the proxy injects authz headers such as:

- `x-authz-scope-id`
- `x-authz-scope-type`
- `x-authz-resource-scope-id`
- `x-authz-operation-id`
- `x-authz-action`
- `x-authz-service-version`
- `x-authz-scope-version`
- `x-authz-principal-id`

That gives the upstream optional visibility into the evaluated decision without making it re-run authorization.

## Custom Upstream Mapping

If the upstream URL needs custom routing logic, use `resolveUpstreamUrl`:

```ts
import { createAuthzProxy, type AuthzProxyEnv } from "./lib";

interface WorkerEnv extends AuthzProxyEnv {
  UPSTREAM_ORIGIN: string;
}

export default createAuthzProxy<WorkerEnv>({
  async resolveUpstreamUrl({ request, env, decision }) {
    const url = new URL(request.url);
    return new URL(url.pathname + url.search, env.UPSTREAM_ORIGIN);
  },
});
```

Most users should not need this. Start with the default proxy behavior first.

## What You Need

The proxy Worker needs:

- `UPSTREAM_ORIGIN`
- `POLICY_BUCKET`
- `SERVICE_IDENTIFIER`
- `JWKS_URL`
- optional `JWT_ISSUER`
- optional `SCOPE_RESOLUTION`
- service config in R2
- scope config in R2
- compiled auth descriptor for the protected routes

## Minimal Integration Steps

1. Point `UPSTREAM_ORIGIN` at the protected service.
2. Publish the service config through separate tooling or a separate admin/publisher surface.
3. Publish the needed scope configs the same way.
4. Put the Worker in front of the upstream service.
5. Send requests with bearer JWTs and resolvable scope IDs.

That is the whole integration.

## Boilerplate To Avoid

Do not:

- duplicate authorization logic in the upstream
- hand-code route-to-action mapping in the proxy
- add app-specific auth middleware to every upstream service

Let the authz Worker enforce policy once at the edge and keep the upstream focused on application behavior.

## Best Fit

This mode is best when:

- the backend is not a Worker
- you want a single authorization front door
- you want to protect multiple HTTP services with the same runtime pattern
