import { createAuthzProxy, maybeHandleAdminRoute, type AuthzAdminEnv } from "./lib";

const proxy = createAuthzProxy<AuthzAdminEnv>();

export default {
  async fetch(request: Request, env: AuthzAdminEnv, ctx: ExecutionContext): Promise<Response> {
    const adminResponse = await maybeHandleAdminRoute(request, env);
    if (adminResponse) {
      return adminResponse;
    }
    return await proxy.fetch!(request as never, env, ctx);
  },
} satisfies ExportedHandler<AuthzAdminEnv>;
