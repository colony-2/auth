import { jsonResponse, maybeHandleAdminRoute, withAuthorization, type AuthzAdminEnv } from "./lib";

const embedded = withAuthorization<AuthzAdminEnv>(
  async (_request, _env, _ctx, decision) => {
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
      policyBucket: env.POLICY_BUCKET,
      serviceIdentifier: env.SERVICE_IDENTIFIER,
      jwksUrl: env.JWKS_URL,
      jwtIssuer: env.JWT_ISSUER,
      scopeResolution: [
        {
          type: "header",
          header: "x-scope-id",
          pattern: "^(?<scopeId>[A-Za-z0-9_-]+)$",
        },
        {
          type: "body_json",
          pointer: "/scopeId",
          contentTypes: ["application/json"],
        },
        {
          type: "body_regex",
          pattern: "(?:^|[&\\s])scopeId=(?<scopeId>[^&\\s]+)",
          contentTypes: ["text/plain", "application/x-www-form-urlencoded"],
        },
        {
          type: "path",
          pattern: "^/scope-path/(?<scopeId>[^/]+)/",
        },
      ],
    }),
  },
);

export default {
  async fetch(request: Request, env: AuthzAdminEnv, ctx: ExecutionContext): Promise<Response> {
    const adminResponse = await maybeHandleAdminRoute(request, env);
    if (adminResponse) {
      return adminResponse;
    }
    return await embedded.fetch!(request as never, env, ctx);
  },
} satisfies ExportedHandler<AuthzAdminEnv>;
