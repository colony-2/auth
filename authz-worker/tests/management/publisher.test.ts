import { describe, expect, it, vi } from "vitest";

import { R2ManagementPublisher, type PublishResult } from "../../src/management/publisher";

interface ReplicationHarness {
  replicate(result: PublishResult, scopeId?: string): Promise<void>;
}

describe("R2ManagementPublisher replication", () => {
  it("copies immutable config and manifest objects and records success", async () => {
    const objects = new Map([
      ["authz/projects-api/scopes/proj-alpha/v1/config.yaml", "scope config"],
      ["authz/projects-api/scopes/proj-alpha/manifest.json", "manifest"],
    ]);
    const primary = {
      get: vi.fn(async (key: string) => {
        const value = objects.get(key);
        return value === undefined ? null : {
          httpMetadata: { contentType: key.endsWith(".json") ? "application/json" : "application/yaml" },
          arrayBuffer: async () => new TextEncoder().encode(value).buffer,
        };
      }),
    } as unknown as R2Bucket;
    const put = vi.fn(async (_key: string, _value: ArrayBuffer, _options?: unknown) => undefined);
    const replica = { put } as unknown as R2Bucket;
    const onReplication = vi.fn(async () => undefined);
    const publisher = new R2ManagementPublisher({
      bucket: primary,
      replicas: [{ name: "secondary", bucket: replica }],
      onReplication,
    });
    const result: PublishResult = {
      ok: true,
      serviceId: "projects-api",
      version: "v1",
      configKey: "authz/projects-api/scopes/proj-alpha/v1/config.yaml",
      manifestKey: "authz/projects-api/scopes/proj-alpha/manifest.json",
    };

    await (publisher as unknown as ReplicationHarness).replicate(result, "proj-alpha");

    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls.map(([key]) => key)).toEqual([result.configKey, result.manifestKey]);
    expect(onReplication).toHaveBeenCalledWith({
      serviceId: "projects-api",
      scopeId: "proj-alpha",
      version: "v1",
      replica: "secondary",
      status: "succeeded",
    });
  });

  it("records a failed replica without failing primary publication", async () => {
    const primary = { get: vi.fn(async () => null) } as unknown as R2Bucket;
    const onReplication = vi.fn(async () => undefined);
    const publisher = new R2ManagementPublisher({
      bucket: primary,
      replicas: [{ name: "secondary", bucket: {} as R2Bucket }],
      onReplication,
    });
    const result: PublishResult = {
      ok: true,
      serviceId: "projects-api",
      version: "v2",
      configKey: "missing-config",
      manifestKey: "missing-manifest",
    };

    await expect((publisher as unknown as ReplicationHarness).replicate(result)).resolves.toBeUndefined();
    expect(onReplication).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: "projects-api",
      version: "v2",
      replica: "secondary",
      status: "failed",
      error: "primary artifact missing-config is missing",
    }));
  });
});
