import { describe, expect, it } from "vitest";

import { handleAuthnRequest, type AuthnWorkerEnv } from "../src/authn/worker";

const origin = "http://127.0.0.1:5173";

function preflight(url: string, method: string, headers: string): Request {
  return new Request(url, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": method,
      "access-control-request-headers": headers,
    },
  });
}

function expectCors(response: Response, methods: string[], headers: string[]) {
  expect(response.status).toBe(204);
  expect(response.headers.get("access-control-allow-origin")).toBe(origin);
  const allowedMethods = response.headers.get("access-control-allow-methods")?.toLowerCase().split(/,\s*/) ?? [];
  const allowedHeaders = response.headers.get("access-control-allow-headers")?.toLowerCase().split(/,\s*/) ?? [];
  expect(allowedMethods).toEqual(expect.arrayContaining(methods.map((value) => value.toLowerCase())));
  expect(allowedHeaders).toEqual(expect.arrayContaining(headers.map((value) => value.toLowerCase())));
}

describe("Worker CORS preflight", () => {
  it("allows login and authenticated session requests on authn routes", async () => {
    const response = await handleAuthnRequest(
      preflight("http://authn.local/auth/login", "POST", "authorization,content-type"),
      { CORS_ORIGIN: origin } as AuthnWorkerEnv,
    );
    expectCors(response, ["GET", "POST", "DELETE"], ["authorization", "content-type"]);
  });
});
