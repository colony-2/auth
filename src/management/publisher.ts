import type { PublishScopeConfigRequest, PublishServiceConfigRequest } from "../lib";

export interface PublishResult {
  ok: true;
  serviceId: string;
  version: string;
  manifestKey: string;
  configKey: string;
}

export interface ManagementPublisher {
  publishService(serviceId: string, config: PublishServiceConfigRequest): Promise<PublishResult>;
  publishScope(serviceId: string, config: PublishScopeConfigRequest): Promise<PublishResult>;
  invalidate(serviceId: string, scopeId?: string): Promise<void>;
}

export class MemoryManagementPublisher implements ManagementPublisher {
  readonly serviceArtifacts = new Map<string, PublishServiceConfigRequest>();
  readonly scopeArtifacts = new Map<string, PublishScopeConfigRequest>();
  readonly invalidations: Array<{ serviceId: string; scopeId?: string }> = [];

  async publishService(serviceId: string, config: PublishServiceConfigRequest): Promise<PublishResult> {
    const version = config.version ?? new Date().toISOString();
    this.serviceArtifacts.set(`${serviceId}:${version}`, structuredClone(config));
    return {
      ok: true,
      serviceId,
      version,
      manifestKey: `authz/${serviceId}/service/manifest.json`,
      configKey: `authz/${serviceId}/service/${version}/config.json`,
    };
  }

  async publishScope(serviceId: string, config: PublishScopeConfigRequest): Promise<PublishResult> {
    const version = config.version ?? new Date().toISOString();
    this.scopeArtifacts.set(`${serviceId}:${config.scopeId}:${version}`, structuredClone(config));
    return {
      ok: true,
      serviceId,
      version,
      manifestKey: `authz/${serviceId}/scopes/${config.scopeId}/manifest.json`,
      configKey: `authz/${serviceId}/scopes/${config.scopeId}/${version}/config.yaml`,
    };
  }

  async invalidate(serviceId: string, scopeId?: string): Promise<void> {
    this.invalidations.push({ serviceId, ...(scopeId ? { scopeId } : {}) });
  }
}

export interface R2PublisherConfig {
  bucket: R2Bucket;
  authzAdminUrl?: string;
  authzAdminToken?: string;
  authzAdminFetcher?: Fetcher;
  publishRemotely?: boolean;
  replicas?: Array<{ name: string; bucket: R2Bucket }>;
  onReplication?: (event: {
    serviceId: string;
    scopeId?: string;
    version: string;
    replica: string;
    status: "succeeded" | "failed";
    error?: string;
  }) => Promise<void>;
}

export class R2ManagementPublisher implements ManagementPublisher {
  constructor(private readonly config: R2PublisherConfig) {}

  async publishService(serviceId: string, config: PublishServiceConfigRequest): Promise<PublishResult> {
    if (this.config.publishRemotely && this.config.authzAdminUrl && this.config.authzAdminToken) {
      return this.remotePublish(serviceId, "/internal/service-config/publish", config);
    }
    const { publishServiceConfig } = await import("../lib");
    const response = await publishServiceConfig(config, this.runtime(serviceId));
    const result = await this.result(response, serviceId);
    await this.replicate(result);
    return result;
  }

  async publishScope(serviceId: string, config: PublishScopeConfigRequest): Promise<PublishResult> {
    if (this.config.publishRemotely && this.config.authzAdminUrl && this.config.authzAdminToken) {
      return this.remotePublish(serviceId, "/internal/scope-config/publish", config);
    }
    const { publishScopeConfig } = await import("../lib");
    const response = await publishScopeConfig(config, this.runtime(serviceId));
    const result = await this.result(response, serviceId);
    await this.replicate(result, config.scopeId);
    return result;
  }

  async invalidate(serviceId: string, scopeId?: string): Promise<void> {
    if (!this.config.authzAdminUrl || !this.config.authzAdminToken) return;
    const response = await this.fetch(`${this.config.authzAdminUrl.replace(/\/$/, "")}/internal/cache/invalidate`, {
      method: "POST",
      headers: { "x-admin-token": this.config.authzAdminToken, "content-type": "application/json" },
      body: JSON.stringify(scopeId ? { scopeId } : { service: true }),
    });
    if (!response.ok) throw new Error(`cache invalidation failed with ${response.status}`);
  }

  private runtime(serviceId: string) {
    return {
      POLICY_BUCKET: this.config.bucket,
      SERVICE_IDENTIFIER: serviceId,
      POLICY_ROOT: `authz/${serviceId}`,
      JWT_VERIFIER: JSON.stringify({ type: "jwks", jwksUrl: "https://management.invalid/jwks" }),
      SCOPE_RESOLUTION: "[]",
      MANIFEST_TTL_SECONDS: "30",
      SERVICE_CONFIG_TTL_SECONDS: "30",
      SCOPE_CONFIG_TTL_SECONDS: "30",
      EFFECTIVE_POLICY_TTL_SECONDS: "30",
      MAX_MANIFEST_CACHE_ENTRIES: "32",
      MAX_SERVICE_CONFIG_CACHE_ENTRIES: "16",
      MAX_SCOPE_CONFIG_CACHE_ENTRIES: "32",
      MAX_EFFECTIVE_POLICY_CACHE_ENTRIES: "16",
      ADMIN_TOKEN: "internal",
    };
  }

  private async result(response: Response, serviceId: string): Promise<PublishResult> {
    const body = await response.json<Record<string, unknown>>();
    if (!response.ok) throw new Error(`${body.error ?? "publish_failed"}: ${body.message ?? response.status}`);
    return {
      ok: true,
      serviceId,
      version: String(body.version),
      manifestKey: String(body.manifestKey),
      configKey: String(body.configKey),
    };
  }

  private async remotePublish(
    serviceId: string,
    path: string,
    config: PublishServiceConfigRequest | PublishScopeConfigRequest,
  ): Promise<PublishResult> {
    const response = await this.fetch(`${this.config.authzAdminUrl!.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "x-admin-token": this.config.authzAdminToken!, "content-type": "application/json" },
      body: JSON.stringify(config),
    });
    return this.result(response, serviceId);
  }

  private fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return this.config.authzAdminFetcher
      ? this.config.authzAdminFetcher.fetch(input, init)
      : fetch(input, init);
  }

  private async replicate(result: PublishResult, scopeId?: string): Promise<void> {
    for (const replica of this.config.replicas ?? []) {
      try {
        for (const key of [result.configKey, result.manifestKey]) {
          const source = await this.config.bucket.get(key);
          if (!source) throw new Error(`primary artifact ${key} is missing`);
          await replica.bucket.put(key, await source.arrayBuffer(), { httpMetadata: source.httpMetadata });
        }
        await this.config.onReplication?.({
          serviceId: result.serviceId,
          ...(scopeId ? { scopeId } : {}),
          version: result.version,
          replica: replica.name,
          status: "succeeded",
        });
      } catch (error) {
        await this.config.onReplication?.({
          serviceId: result.serviceId,
          ...(scopeId ? { scopeId } : {}),
          version: result.version,
          replica: replica.name,
          status: "failed",
          error: error instanceof Error ? error.message : "replication failed",
        });
      }
    }
  }
}
