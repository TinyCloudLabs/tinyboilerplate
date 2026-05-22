import {
  createBackendIdentity,
  type BackendIdentity,
  type BackendIdentityConfig,
} from "@tinyboilerplate/server";
import { APP_ID } from "./manifest.js";

export const APP_STARTER_BACKEND_KV_PREFIX = `${APP_ID}-backend`;

type AppStarterBackendIdentityInput = Pick<BackendIdentityConfig, "privateKey" | "host">;

export function appStarterBackendIdentityConfig(
  config: AppStarterBackendIdentityInput,
): BackendIdentityConfig {
  return {
    privateKey: config.privateKey,
    host: config.host,
    prefix: APP_STARTER_BACKEND_KV_PREFIX,
  };
}

export function createAppStarterBackendIdentity(
  config: AppStarterBackendIdentityInput,
): Promise<BackendIdentity> {
  return createBackendIdentity(appStarterBackendIdentityConfig(config));
}
