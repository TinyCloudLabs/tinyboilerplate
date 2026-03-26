import { useState, type FC } from "react";
import type { ApiClient } from "@tinyboilerplate/client";

type Step = "welcome" | "instructions" | "input" | "test" | "webhook" | "done";

interface SetupWizardProps {
  api: ApiClient;
  onComplete: () => void;
  backendUrl?: string;
}

interface UserInfo {
  name: string;
  email: string;
}

export const SetupWizard: FC<SetupWizardProps> = ({ api, onComplete, backendUrl = "" }) => {
  const [step, setStep] = useState<Step>("welcome");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);

  // Webhook state
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [webhookSaved, setWebhookSaved] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);

  const webhookUrl = `${backendUrl}/api/webhooks/fireflies`;

  const handleSave = async () => {
    setSaving(true);
    setTestError(null);
    try {
      await api.put("/api/config/fireflies-key", { apiKey });
      const user = await api.get<UserInfo>("/api/fireflies/user");
      setUserInfo(user);
      setStep("test");
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
      setStep("test");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section style={styles.panel}>
      <h2 style={styles.heading}>Setup</h2>

      {step === "welcome" && (
        <>
          <p style={styles.description}>
            Connect your Fireflies.ai account to sync meeting transcripts to
            your TinyCloud space.
          </p>
          <button style={styles.button} onClick={() => setStep("instructions")}>
            Next
          </button>
        </>
      )}

      {step === "instructions" && (
        <>
          <p style={styles.description}>
            Go to{" "}
            <a
              href="https://app.fireflies.ai/integrations"
              target="_blank"
              rel="noreferrer"
              aria-label="Fireflies Integrations"
              style={styles.link}
            >
              app.fireflies.ai
            </a>{" "}
            &rarr; Integrations &rarr; Fireflies API &rarr; Copy your API key.
          </p>
          <div style={styles.buttonRow}>
            <button
              style={styles.buttonSecondary}
              onClick={() => setStep("welcome")}
            >
              Back
            </button>
            <button style={styles.button} onClick={() => setStep("input")}>
              Next
            </button>
          </div>
        </>
      )}

      {step === "input" && (
        <>
          <p style={styles.description}>Paste your Fireflies API key below.</p>
          <input
            type="text"
            placeholder="Paste your API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={styles.input}
          />
          <div style={styles.buttonRow}>
            <button
              style={styles.buttonSecondary}
              onClick={() => setStep("instructions")}
            >
              Back
            </button>
            <button
              style={{
                ...styles.button,
                ...(apiKey.trim() === "" || saving
                  ? styles.buttonDisabled
                  : {}),
              }}
              disabled={apiKey.trim() === "" || saving}
              onClick={handleSave}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </>
      )}

      {step === "test" && (
        <>
          {userInfo ? (
            <>
              <p style={styles.success}>
                Connected as {userInfo.name} ({userInfo.email})
              </p>
              <button
                style={styles.button}
                onClick={() => setStep("webhook")}
              >
                Continue
              </button>
            </>
          ) : (
            <>
              <div style={styles.error}>{testError}</div>
              <button
                style={styles.buttonSecondary}
                onClick={() => {
                  setTestError(null);
                  setStep("input");
                }}
              >
                Try Again
              </button>
            </>
          )}
        </>
      )}

      {step === "webhook" && (
        <>
          <p style={styles.description}>
            <strong>Webhook Setup</strong> (optional) — Get notified automatically
            when new transcripts are ready.
          </p>

          <p style={styles.label}>Webhook URL</p>
          <div style={styles.urlRow}>
            <code style={styles.urlCode}>{webhookUrl}</code>
            <button
              style={styles.buttonSmall}
              onClick={() => {
                navigator.clipboard.writeText(webhookUrl);
                setUrlCopied(true);
                setTimeout(() => setUrlCopied(false), 2000);
              }}
            >
              {urlCopied ? "Copied!" : "Copy URL"}
            </button>
          </div>

          {backendUrl.includes("localhost") && (
            <p style={styles.hint}>
              For local development, use ngrok or a similar tunnel to make this
              URL reachable from the internet.
            </p>
          )}

          <p style={styles.label}>Webhook Secret</p>
          <div style={styles.buttonRow}>
            <input
              type="text"
              placeholder="Webhook secret (16-32 chars)"
              value={webhookSecret}
              onChange={(e) => {
                setWebhookSecret(e.target.value);
                setWebhookError(null);
                setWebhookSaved(false);
              }}
              style={{ ...styles.input, flex: 1, marginBottom: 0 }}
            />
            <button
              style={styles.buttonSecondary}
              onClick={() => {
                const arr = new Uint8Array(24);
                crypto.getRandomValues(arr);
                const secret = Array.from(arr, (b) =>
                  b.toString(36).padStart(2, "0"),
                )
                  .join("")
                  .slice(0, 32);
                setWebhookSecret(secret);
                setWebhookError(null);
                setWebhookSaved(false);
              }}
            >
              Generate Random
            </button>
          </div>

          {webhookSaved && (
            <p style={styles.success}>Secret saved successfully!</p>
          )}
          {webhookError && <div style={styles.error}>{webhookError}</div>}

          <div style={{ ...styles.instructions, marginTop: 12 }}>
            <p style={styles.label}>Fireflies Dashboard Instructions</p>
            <ol style={styles.instructionsList}>
              <li>Go to app.fireflies.ai &rarr; Settings &rarr; Webhooks</li>
              <li>Paste the webhook URL above</li>
              <li>Set the secret to the same value you saved here</li>
              <li>Select "Transcription completed" event</li>
              <li>Save the webhook</li>
            </ol>
          </div>

          <div style={styles.buttonRow}>
            <button
              style={styles.buttonSecondary}
              onClick={() => setStep("done")}
            >
              Skip
            </button>
            <button
              style={{
                ...styles.button,
                ...(webhookSecret.length < 16 || webhookSaving
                  ? styles.buttonDisabled
                  : {}),
              }}
              disabled={webhookSecret.length < 16 || webhookSaving}
              onClick={async () => {
                setWebhookSaving(true);
                setWebhookError(null);
                try {
                  await api.put("/api/config/webhook-secret", {
                    secret: webhookSecret,
                  });
                  setWebhookSaved(true);
                } catch (err) {
                  setWebhookError(
                    err instanceof Error ? err.message : String(err),
                  );
                } finally {
                  setWebhookSaving(false);
                }
              }}
            >
              {webhookSaving ? "Saving..." : "Save Secret"}
            </button>
            {webhookSaved && (
              <button
                style={styles.button}
                onClick={() => setStep("done")}
              >
                Continue
              </button>
            )}
          </div>
        </>
      )}

      {step === "done" && (
        <>
          <p style={styles.success}>
            You're all set! Your first sync is ready.
          </p>
          <button style={styles.button} onClick={onComplete}>
            Sync Now
          </button>
        </>
      )}
    </section>
  );
};

// ── Styles ──────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    border: "1px solid #e0e0e0",
    borderRadius: 8,
    padding: 20,
    background: "#fafafa",
  },
  heading: {
    fontSize: 16,
    fontWeight: 600,
    margin: "0 0 12px",
  },
  description: {
    fontSize: 14,
    color: "#555",
    margin: "0 0 16px",
  },
  button: {
    display: "inline-block",
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 600,
    color: "#fff",
    background: "#2563eb",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  },
  buttonSecondary: {
    display: "inline-block",
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 500,
    color: "#555",
    background: "#fff",
    border: "1px solid #ccc",
    borderRadius: 6,
    cursor: "pointer",
  },
  buttonRow: {
    display: "flex",
    gap: 8,
  },
  input: {
    display: "block",
    width: "100%",
    padding: "10px 12px",
    fontSize: 14,
    border: "1px solid #ccc",
    borderRadius: 6,
    marginBottom: 12,
    boxSizing: "border-box",
  },
  link: {
    color: "#2563eb",
    textDecoration: "underline",
  },
  success: {
    fontSize: 14,
    color: "#166534",
    background: "#f0fdf4",
    padding: "10px 14px",
    borderRadius: 6,
    border: "1px solid #bbf7d0",
    marginBottom: 12,
  },
  error: {
    fontSize: 13,
    color: "#b91c1c",
    background: "#fef2f2",
    padding: "8px 12px",
    border: "1px solid #fecaca",
    borderRadius: 6,
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "#333",
    margin: "0 0 6px",
  },
  urlRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  urlCode: {
    fontSize: 13,
    background: "#f3f4f6",
    padding: "6px 10px",
    borderRadius: 4,
    border: "1px solid #e0e0e0",
    wordBreak: "break-all",
    flex: 1,
  },
  buttonSmall: {
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 500,
    color: "#555",
    background: "#fff",
    border: "1px solid #ccc",
    borderRadius: 4,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  hint: {
    fontSize: 12,
    color: "#888",
    fontStyle: "italic",
    margin: "0 0 12px",
  },
  instructions: {
    fontSize: 13,
    color: "#555",
    background: "#f9fafb",
    padding: "10px 14px",
    borderRadius: 6,
    border: "1px solid #e5e7eb",
  },
  instructionsList: {
    margin: "6px 0 0",
    paddingLeft: 20,
    lineHeight: 1.8,
  },
};
