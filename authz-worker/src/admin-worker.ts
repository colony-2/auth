import { maybeHandleAdminRoute, type AuthzAdminEnv } from "./lib";

export default {
  async fetch(request: Request, env: AuthzAdminEnv): Promise<Response> {
    const response = await maybeHandleAdminRoute(request, env);
    return response ?? new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<AuthzAdminEnv>;
