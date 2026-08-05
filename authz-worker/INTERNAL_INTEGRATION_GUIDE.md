# Internal Integration Guide

Use this mode when the protected application is already a Cloudflare Worker and you want to embed authz as a library inside that worker.

This is the lowest-boilerplate pattern for:

- existing Worker APIs
- apps that should keep their own routing/response logic
- teams that want authz enforced before their handler runs

## When To Use This

Use embedded mode when:

- your app is already running as a Worker
- you do not want a separate proxy hop
- your app should keep full control of routing and response shaping

Do not use this mode when the protected service is an external HTTP service. Use the external guide for that.

## Minimal Pattern

The smallest integration is:

```ts
import { withAuthorization } from "./lib";

interface WorkerEnv {
  AUTHZ_BUCKET: R2Bucket;
}

export default withAuthorization<WorkerEnv>(
  async (request, env, ctx, decision) => {
    if (!decision) {
      return new Response("not found", { status: 404 });
    }

    return new Response(JSON.stringify({
      ok: true,
      scopeId: decision.scopeId,
      action: decision.action,
      resource: decision.resource,
    }), {
      headers: { "content-type": "application/json" },
    });
  },
  {
    runtime: ({ env }) => ({
      policyBucket: env.AUTHZ_BUCKET,
      serviceIdentifier: "projects-api",
      jwksUrl: "https://issuer.example.com/.well-known/jwks.json",
      jwtIssuer: "https://issuer.example.com/",
      scopeResolution: [
        {
          type: "header",
          header: "x-scope-id",
          pattern: "^(?<scopeId>[A-Za-z0-9_-]+)$",
        },
      ],
    }),
  },
);
```

What this does:

- protected allow decisions continue into your handler
- protected deny decisions return `403` before your handler runs
- unresolved routes call your handler with `decision = null`

Reference example: [embedded-example.ts](/src/authz-worker/src/embedded-example.ts)

## Typical Real Integration

In a real Worker, you usually keep your own routes and only use `decision` when a route is protected:

```ts
import { withAuthorization } from "./lib";

interface WorkerEnv {
  AUTHZ_BUCKET: R2Bucket;
}

export default withAuthorization<WorkerEnv>(
  async (request, env, ctx, decision) => {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok");
    }

    if (!decision) {
      return new Response("not found", { status: 404 });
    }

    if (url.pathname === "/projects" && request.method === "GET") {
      return Response.json({
        ok: true,
        scopeId: decision.scopeId,
      });
    }

    return new Response("not found", { status: 404 });
  },
  {
    runtime: ({ env }) => ({
      policyBucket: env.AUTHZ_BUCKET,
      serviceIdentifier: "projects-api",
      jwksUrl: "https://issuer.example.com/.well-known/jwks.json",
    }),
  },
);
```

## What You Need

Your Worker needs:

- an R2 binding to the authz artifact bucket
- a `runtime` config that supplies `serviceIdentifier` and `jwksUrl`
- optional `jwtIssuer`
- optional structured `scopeResolution`

You also need:

- service config already present in R2
- scope config already present in R2
- a compiled auth descriptor for the protected routes

## Minimal Request Contract

For a protected request to succeed, the runtime needs:

1. a request that matches the compiled auth descriptor
2. a scope ID resolved from the configured scope resolution chain
3. a valid bearer JWT
4. a matching scope claim in `azs`

## Boilerplate To Avoid

Do not:

- write your own route-to-action mapping in application code
- parse JWT claims manually in the handler
- implement your own path-prefix matching in the handler

Let the library do those things and keep your Worker focused on business logic.

## Best Fit

This mode is best when:

- the app and authz live in the same Worker deployment
- you want the smallest operational footprint
- you want no extra network hop between authz and app
