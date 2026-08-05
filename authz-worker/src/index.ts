import { createAuthzProxy, type AuthzProxyEnv } from "./lib";

export interface WorkerEnv extends AuthzProxyEnv {
  UPSTREAM_ORIGIN: string;
}

export default createAuthzProxy<WorkerEnv>();
