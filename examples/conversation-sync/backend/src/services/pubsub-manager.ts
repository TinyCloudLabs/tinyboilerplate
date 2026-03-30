import { PubSub } from "@google-cloud/pubsub";

const TOPIC_NAME = "conversation-sync-events";
const SUBSCRIPTION_NAME = "conversation-sync-push";

export interface PubSubConfig {
  projectId: string;
  serviceAccountEmail: string;
  pushUrl: string;
  credentials: Record<string, unknown>;
}

/**
 * Parse Pub/Sub configuration from environment variables.
 * Returns null if required env vars are missing or invalid.
 */
export function parsePubSubConfig(): PubSubConfig | null {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const pushUrl = process.env.GOOGLE_PUBSUB_PUSH_URL;

  if (!keyJson || !pushUrl) {
    console.warn("[pubsub] Missing GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_PUBSUB_PUSH_URL — Pub/Sub disabled");
    return null;
  }

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(keyJson);
  } catch {
    console.warn("[pubsub] Invalid JSON in GOOGLE_SERVICE_ACCOUNT_KEY — Pub/Sub disabled");
    return null;
  }

  const projectId = credentials.project_id;
  const serviceAccountEmail = credentials.client_email;

  if (typeof projectId !== "string" || typeof serviceAccountEmail !== "string") {
    console.warn("[pubsub] Service account JSON missing project_id or client_email — Pub/Sub disabled");
    return null;
  }

  return { projectId, serviceAccountEmail, pushUrl, credentials };
}

/**
 * Ensure Pub/Sub topic and push subscription exist. Idempotent —
 * ignores "already exists" errors (gRPC code 6).
 *
 * @param config - Parsed config, or null to skip. Defaults to parsePubSubConfig().
 * @param client - PubSub client instance. Created from config if not provided.
 */
export async function ensurePubSubInfra(
  config?: PubSubConfig | null,
  client?: PubSub,
): Promise<void> {
  const cfg = config === undefined ? parsePubSubConfig() : config;
  if (!cfg) return;

  const pubsub = client ?? new PubSub({ projectId: cfg.projectId, credentials: cfg.credentials });

  // Create topic (idempotent)
  try {
    await pubsub.createTopic(TOPIC_NAME);
    console.log(`[pubsub] Created topic: ${TOPIC_NAME}`);
  } catch (err: any) {
    if (err.code === 6) {
      console.log(`[pubsub] Topic already exists: ${TOPIC_NAME}`);
    } else {
      throw err;
    }
  }

  // Create push subscription with OIDC auth (idempotent)
  try {
    const topic = pubsub.topic(TOPIC_NAME);
    await topic.createSubscription(SUBSCRIPTION_NAME, {
      pushConfig: {
        pushEndpoint: cfg.pushUrl,
        oidcToken: {
          serviceAccountEmail: cfg.serviceAccountEmail,
          audience: cfg.pushUrl,
        },
      },
    });
    console.log(`[pubsub] Created push subscription: ${SUBSCRIPTION_NAME}`);
  } catch (err: any) {
    if (err.code === 6) {
      console.log(`[pubsub] Push subscription already exists: ${SUBSCRIPTION_NAME}`);
    } else {
      throw err;
    }
  }
}
