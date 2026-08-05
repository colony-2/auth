function authzHeaders(request: Request): Record<string, string> {
  const names = [
    "x-authz-principal-id",
    "x-authz-action",
    "x-authz-scope-id",
    "x-authz-operation-id",
    "x-authz-target-kind",
    "x-authz-path-namespace",
    "x-authz-service-version",
    "x-authz-scope-version",
  ];
  return Object.fromEntries(names.map((name) => [name, request.headers.get(name) ?? ""]));
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ status: "ok", service: "project-workspace-api" });
    if (/^\/projects\/[^/]+$/.test(url.pathname) && ["GET", "PUT"].includes(request.method)) {
      const projectId = url.pathname.split("/")[2];
      return Response.json({
        project: { projectId, name: projectId === "proj-alpha" ? "Atlas" : "Beacon" },
        mutation: request.method === "PUT",
        authorization: authzHeaders(request),
      });
    }
    if (/^\/projects\/[^/]+\/bindings$/.test(url.pathname) && request.method === "POST") {
      return Response.json({ managed: true, authorization: authzHeaders(request) });
    }
    if (/^\/(files|datasets)\/.+/.test(url.pathname) && request.method === "GET") {
      return Response.json({ path: url.pathname, authorization: authzHeaders(request) });
    }
    if (/^\/projects\/[^/]+\/files\/.+/.test(url.pathname) && request.method === "GET") {
      return Response.json({ path: url.pathname, authorization: authzHeaders(request) });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  },
} satisfies ExportedHandler;
