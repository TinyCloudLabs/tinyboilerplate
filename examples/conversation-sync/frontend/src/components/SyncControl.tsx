import { useState, useEffect, useCallback, type FC } from "react";
import type { ApiClient } from "@tinyboilerplate/client";

const LAST_SYNC_KEY = "lastSyncTimestamp";
const TIMEOUT_MS = 60_000;

interface SyncResult {
  synced: number;
  skipped: number;
  failed: number;
  errors: string[];
}

interface SyncControlProps {
  api: ApiClient;
  onSyncComplete: () => void;
}

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "1 hour ago";
  return `${hours} hours ago`;
}

export const SyncControl: FC<SyncControlProps> = ({ api, onSyncComplete }) => {
  const [limit, setLimit] = useState(20);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(
    () => localStorage.getItem(LAST_SYNC_KEY),
  );

  // Refresh "X minutes ago" display
  useEffect(() => {
    if (!lastSync) return;
    const id = setInterval(() => setLastSync(localStorage.getItem(LAST_SYNC_KEY)), 60_000);
    return () => clearInterval(id);
  }, [lastSync]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setResult(null);
    setError(null);
    setTimedOut(false);

    const timer = setTimeout(() => {
      setTimedOut(true);
      setSyncing(false);
    }, TIMEOUT_MS);

    try {
      const data = await api.post<SyncResult>("/api/sync/fireflies", { limit });
      clearTimeout(timer);
      setResult(data);
      const ts = new Date().toISOString();
      localStorage.setItem(LAST_SYNC_KEY, ts);
      setLastSync(ts);
      onSyncComplete();
    } catch (err) {
      clearTimeout(timer);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }, [api, limit, onSyncComplete]);

  return (
    <section style={styles.panel}>
      <div style={styles.row}>
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          style={styles.select}
        >
          <option value="10">10</option>
          <option value="20">20</option>
          <option value="50">50</option>
        </select>
        <button
          style={{
            ...styles.button,
            ...(syncing ? styles.buttonDisabled : {}),
          }}
          disabled={syncing}
          onClick={handleSync}
        >
          {syncing ? "Syncing..." : "Sync Now"}
        </button>
      </div>

      {syncing && !timedOut && (
        <p style={styles.info}>Syncing conversations...</p>
      )}

      {timedOut && (
        <div style={styles.warning}>
          Sync is taking longer than expected. This may be due to Fireflies rate
          limits. Try again with a smaller batch.
        </div>
      )}

      {result && !timedOut && (
        <div style={result.failed > 0 ? styles.warning : styles.success}>
          Synced {result.synced} conversations.{" "}
          {result.skipped > 0 && <>{result.skipped} already up to date. </>}
          {result.failed > 0 && (
            <>
              {result.failed} failed
              {result.errors.length > 0 && (
                <> &mdash; {result.errors.join("; ")}</>
              )}
              .
            </>
          )}
        </div>
      )}

      {error && !timedOut && <div style={styles.error}>{error}</div>}

      {lastSync && (
        <p style={styles.lastSync}>Last synced: {formatTimeAgo(lastSync)}</p>
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
  row: {
    display: "flex",
    gap: 8,
    alignItems: "center",
  },
  select: {
    padding: "10px 12px",
    fontSize: 14,
    border: "1px solid #ccc",
    borderRadius: 6,
    background: "#fff",
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
  info: {
    fontSize: 14,
    color: "#555",
    marginTop: 12,
  },
  success: {
    fontSize: 14,
    color: "#166534",
    background: "#f0fdf4",
    padding: "10px 14px",
    borderRadius: 6,
    border: "1px solid #bbf7d0",
    marginTop: 12,
  },
  warning: {
    fontSize: 14,
    color: "#92400e",
    background: "#fffbeb",
    padding: "10px 14px",
    borderRadius: 6,
    border: "1px solid #fde68a",
    marginTop: 12,
  },
  error: {
    fontSize: 13,
    color: "#b91c1c",
    background: "#fef2f2",
    padding: "8px 12px",
    border: "1px solid #fecaca",
    borderRadius: 6,
    marginTop: 12,
  },
  lastSync: {
    fontSize: 12,
    color: "#888",
    marginTop: 8,
    marginBottom: 0,
  },
};
