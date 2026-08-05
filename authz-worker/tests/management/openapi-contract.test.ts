import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { MANAGEMENT_ROUTES } from "../../src/management/routes";

const METHODS = new Set(["get", "put", "post", "delete", "patch", "head", "options"]);

describe("management OpenAPI contract", () => {
  it("is valid YAML and stays in route parity with the Worker", async () => {
    const source = await readFile(resolve("openapi/management-service.openapi.yaml"), "utf8");
    const document = parse(source) as { openapi: string; paths: Record<string, Record<string, unknown>> };
    expect(document.openapi).toBe("3.1.0");
    const contractRoutes = Object.entries(document.paths).flatMap(([path, item]) =>
      Object.keys(item).filter((key) => METHODS.has(key)).map((method) => [method.toUpperCase(), path]),
    );
    expect(contractRoutes.sort()).toEqual(MANAGEMENT_ROUTES.map((route) => [...route]).sort());
  });

  it("defines operation IDs, structured errors, and auth for protected operations", async () => {
    const document = parse(await readFile(resolve("openapi/management-service.openapi.yaml"), "utf8")) as {
      paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown>; security?: unknown[] }>>;
      components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
      security: unknown[];
    };
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!METHODS.has(method)) continue;
        expect(operation.operationId, `${method.toUpperCase()} ${path}`).toBeTruthy();
        expect(operation.responses, `${method.toUpperCase()} ${path}`).toBeTruthy();
      }
    }
    expect(document.components.schemas.ErrorResponse).toBeTruthy();
    expect(document.components.schemas.ServiceVocabulary).toBeTruthy();
    expect(document.components.schemas.AuditEvent).toBeTruthy();
    expect(document.components.securitySchemes.bearerAuth).toBeTruthy();
    expect(document.security).toEqual([{ bearerAuth: [] }]);
  });
});
