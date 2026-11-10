/// <reference types="vite/client" />

interface Window {
  __AUTHZ_CONFIG__?: {
    managementApiBaseUrl?: string;
    authnBaseUrl?: string;
    audience?: string;
    readOnly?: boolean;
    demoMode?: boolean;
    accessToken?: string;
  };
}
