import createClient from "openapi-fetch";

import type { paths } from "../../src/management/generated-api";

export interface UiConfig {
  managementApiBaseUrl: string;
  authnBaseUrl: string;
  audience: string;
  readOnly: boolean;
  demoMode: boolean;
  accessToken?: string;
}

function bool(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

export function loadConfig(): UiConfig {
  const runtime = window.__AUTHZ_CONFIG__ ?? {};
  return {
    managementApiBaseUrl: runtime.managementApiBaseUrl ?? import.meta.env.VITE_MANAGEMENT_API_BASE_URL ?? "http://127.0.0.1:8789",
    authnBaseUrl: runtime.authnBaseUrl ?? import.meta.env.VITE_AUTHN_BASE_URL ?? "http://127.0.0.1:8788",
    audience: runtime.audience ?? import.meta.env.VITE_AUTH_AUDIENCE ?? "management-api",
    readOnly: bool(runtime.readOnly ?? import.meta.env.VITE_READ_ONLY),
    demoMode: bool(runtime.demoMode ?? import.meta.env.VITE_DEMO_MODE),
    accessToken: runtime.accessToken ?? import.meta.env.VITE_MANAGEMENT_ACCESS_TOKEN,
  };
}

export function managementClient(config: UiConfig, token: string) {
  return createClient<paths>({
    baseUrl: config.managementApiBaseUrl,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

export async function result<T>(call: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const value = await call;
  if (value.error !== undefined || !value.response.ok) {
    const error = value.error as { error?: { message?: string } } | undefined;
    throw new Error(error?.error?.message ?? `Request failed with ${value.response.status}`);
  }
  return value.data as T;
}
