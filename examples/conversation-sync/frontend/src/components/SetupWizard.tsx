import { useState, type FC } from "react";
import type { ApiClient } from "@tinyboilerplate/client";

type Step = "welcome" | "instructions" | "input" | "test" | "done";

interface SetupWizardProps {
  api: ApiClient;
  onComplete: () => void;
}

interface UserInfo {
  name: string;
  email: string;
}

export const SetupWizard: FC<SetupWizardProps> = ({ api, onComplete }) => {
  const [step, setStep] = useState<Step>("welcome");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);

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
                onClick={() => setStep("done")}
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
};
