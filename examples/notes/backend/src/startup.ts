import {
  createBackendIdentity,
  type BackendIdentity,
  type BackendIdentityConfig,
} from "@tinyboilerplate/server";
import { APP_ID } from "./manifest.js";

export const NOTES_BACKEND_KV_PREFIX = `${APP_ID}-backend`;

type NotesBackendIdentityInput = Pick<BackendIdentityConfig, "privateKey" | "host">;

export function notesBackendIdentityConfig(
  config: NotesBackendIdentityInput,
): BackendIdentityConfig {
  return {
    privateKey: config.privateKey,
    host: config.host,
    prefix: NOTES_BACKEND_KV_PREFIX,
  };
}

export function createNotesBackendIdentity(
  config: NotesBackendIdentityInput,
): Promise<BackendIdentity> {
  return createBackendIdentity(notesBackendIdentityConfig(config));
}
