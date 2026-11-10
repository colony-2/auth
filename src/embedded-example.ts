import { jsonResponse, withAuthorization } from "./lib";

interface WorkerEnv {
  AUTHZ_BUCKET: R2Bucket;
}

export default withAuthorization<WorkerEnv>(
  async (request, env, _ctx, decision) => {
    if (!decision) {
      return new Response("not found", { status: 404 });
    }

    return jsonResponse({
      ok: true,
      mode: "embedded",
      service: decision.service,
      scopeId: decision.scopeId,
      scopeType: decision.scopeType,
      action: decision.action,
      resource: decision.resource,
      decision: decision.decision,
      serviceVersion: decision.serviceVersion,
      scopeVersion: decision.scopeVersion,
      principal: decision.principal,
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
