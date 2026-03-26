<<<<<<< HEAD
import { useState, useEffect, useCallback, useRef, type FC } from "react";
import type { ApiClient } from "@tinyboilerplate/client";

const LAST_SYNC_KEY = "lastSyncTimestamp";
=======
import { useState, useEffect, useCallback, type FC } from "react";
import type { ApiClient } from "@tinyboilerplate/client";

const LAST_SYNC_KEY = "lastSyncTimestamp";
const TIMEOUT_MS = 60_000;
>>>>>>> ffd94d9 (TC-1306: Build SyncControl component (sync button, progress, limit selector))

interface SyncResult {
  synced: number;
  skipped: number;
  failed: number;
  errors: string[];
}

<<<<<<< HEAD
<<<<<<< HEAD
interface SyncProgress {
  phase: "listing" | "syncing";
  totalListed?: number;
  current?: number;
  total?: number;
  synced?: number;
  failed?: number;
  lastTitle?: string;
}

=======
>>>>>>> fa5f0e1 (TC-1316: Frontend auto-process pending on load + webhook status in SyncControl)
interface WebhookStatus {
  configured: boolean;
  pendingCount: number;
  webhookUrl: string;
}

<<<<<<< HEAD
interface SyncControlProps {
  api: ApiClient;
  backendUrl: string;
  getAccessToken: () => string | null;
  onSyncComplete: () => void;
}

// ── SSE parsing ─────────────────────────────────────────────────────

interface SSEEvent {
  type: string;
  data: string;
}

function parseSSEChunk(buffer: string): { events: SSEEvent[]; remaining: string } {
  const events: SSEEvent[] = [];
  const blocks = buffer.split("\n\n");
  const remaining = blocks.pop() ?? "";

  for (const block of blocks) {
    if (!block.trim()) continue;
    let type = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) type = line.slice(7);
      else if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (data) events.push({ type, data });
  }

  return { events, remaining };
}

// ── Helpers ─────────────────────────────────────────────────────────

=======
=======
>>>>>>> fa5f0e1 (TC-1316: Frontend auto-process pending on load + webhook status in SyncControl)
interface SyncControlProps {
  api: ApiClient;
  onSyncComplete: () => void;
}

>>>>>>> ffd94d9 (TC-1306: Build SyncControl component (sync button, progress, limit selector))
function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
<<<<<<< HEAD
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "1 hr ago";
  if (hours < 24) return `${hours} hrs ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}

// ── Component ───────────────────────────────────────────────────────

export const SyncControl: FC<SyncControlProps> = ({
  api,
  backendUrl,
  getAccessToken,
  onSyncComplete,
}) => {
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(() =>
    localStorage.getItem(LAST_SYNC_KEY),
  );
  const [webhookStatus, setWebhookStatus] = useState<WebhookStatus | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    api
      .get<WebhookStatus>("/api/config/webhook-status")
      .then((status) => setWebhookStatus(status))
      .catch(() => {});
  }, [api]);

=======
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
  const [webhookStatus, setWebhookStatus] = useState<WebhookStatus | null>(null);

  // ── Fetch webhook status on mount ──────────────────────────────────
  useEffect(() => {
    api
      .get<WebhookStatus>("/api/config/webhook-status")
      .then((status) => setWebhookStatus(status))
      .catch(() => {});
  }, [api]);

  // Refresh "X minutes ago" display
>>>>>>> ffd94d9 (TC-1306: Build SyncControl component (sync button, progress, limit selector))
  useEffect(() => {
    if (!lastSync) return;
    const id = setInterval(() => setLastSync(localStorage.getItem(LAST_SYNC_KEY)), 60_000);
    return () => clearInterval(id);
  }, [lastSync]);

<<<<<<< HEAD
<<<<<<< HEAD
  // ── SSE sync handler ──────────────────────────────────────────────

  const startStreamSync = useCallback(
    async (mode: "incremental" | "full") => {
      setSyncing(true);
      setResult(null);
      setError(null);
      setProgress({ phase: "listing" });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const token = getAccessToken() ?? "";
        const url = `${backendUrl}/api/sync/fireflies/stream?mode=${mode}`;
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Stream failed: ${response.status} ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const { events, remaining } = parseSSEChunk(buffer);
          buffer = remaining;

          for (const event of events) {
            const data = JSON.parse(event.data);

            switch (event.type) {
              case "status":
                setProgress((prev) => ({ ...prev, phase: data.phase, total: data.total }));
                break;
              case "progress":
                if (data.phase === "listing") {
                  setProgress((prev) => ({
                    ...prev,
                    phase: "listing",
                    totalListed: data.totalListed,
                  }));
                } else {
                  setProgress({
                    phase: "syncing",
                    current: data.current,
                    total: data.total,
                    synced: data.synced,
                    failed: data.failed,
                    lastTitle: data.lastTitle,
                  });
                }
                break;
              case "complete": {
                setResult({
                  synced: data.synced,
                  skipped: data.skipped,
                  failed: data.failed,
                  errors: data.errors,
                });
                setProgress(null);
                const ts = new Date().toISOString();
                localStorage.setItem(LAST_SYNC_KEY, ts);
                setLastSync(ts);
                onSyncComplete();
                break;
              }
              case "error":
                setError(data.message);
                setProgress(null);
                break;
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : String(err));
        }
        setProgress(null);
      } finally {
        setSyncing(false);
        abortRef.current = null;
      }
    },
    [backendUrl, getAccessToken, onSyncComplete],
  );

  const handleSync = useCallback(() => startStreamSync("incremental"), [startStreamSync]);

=======
>>>>>>> fa5f0e1 (TC-1316: Frontend auto-process pending on load + webhook status in SyncControl)
  const handleClearAndResync = useCallback(async () => {
    setSyncing(true);
    setResult(null);
    setError(null);
    try {
      await api.del("/api/sync/conversations");
<<<<<<< HEAD
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSyncing(false);
      return;
    }
    setSyncing(false);
    startStreamSync("full");
  }, [api, startStreamSync]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const pct =
    progress?.phase === "syncing" && progress.total
      ? Math.round(((progress.current ?? 0) / progress.total) * 100)
      : 0;

  // ── Render ────────────────────────────────────────────────────────

  return (
    <section style={s.panel}>
      {/* Header row */}
      <div style={s.headerRow}>
        <div style={s.titleGroup}>
          <h3 style={s.heading}>Sync</h3>
          {lastSync && <span style={s.lastSyncBadge}>{formatTimeAgo(lastSync)}</span>}
          {webhookStatus?.configured && (
            <span style={s.webhookBadge}>
              <span style={s.webhookDot} />
              Live
            </span>
          )}
        </div>

        <div style={s.buttonGroup}>
          {!syncing ? (
            <>
              <button style={s.btnPrimary} onClick={handleSync}>
                Sync All
              </button>
              <button style={s.btnDanger} onClick={handleClearAndResync}>
                Reset
              </button>
            </>
          ) : (
            <button style={s.btnCancel} onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Listing phase */}
      {progress?.phase === "listing" && (
        <div style={s.phaseCard}>
          <div style={s.phaseRow}>
            <span style={s.phaseDot} />
            <span style={s.phaseLabel}>Scanning Fireflies</span>
          </div>
          <p style={s.phaseDetail}>
            {progress.totalListed != null ? (
              <>
                <span style={s.statNum}>{progress.totalListed}</span> transcripts found
              </>
            ) : (
              "Fetching transcript list\u2026"
            )}
          </p>
        </div>
      )}

      {/* Syncing phase */}
      {progress?.phase === "syncing" && progress.total != null && (
        <div style={s.syncCard}>
          {/* Progress bar */}
          <div style={s.barOuter}>
            <div style={{ ...s.barFill, width: `${pct}%` }} />
            {pct < 100 && <div style={{ ...s.barScanline, left: `${pct}%` }} />}
          </div>

          {/* Stats row */}
          <div style={s.statsRow}>
            <div style={s.stat}>
              <span style={s.statNum}>{progress.current ?? 0}</span>
              <span style={s.statDenom}>/{progress.total}</span>
            </div>
            <div style={s.statDivider} />
            <div style={s.stat}>
              <span style={{ ...s.statNum, color: "#10b981" }}>{progress.synced ?? 0}</span>
              <span style={s.statLabel}>synced</span>
            </div>
            {(progress.failed ?? 0) > 0 && (
              <>
                <div style={s.statDivider} />
                <div style={s.stat}>
                  <span style={{ ...s.statNum, color: "#ef4444" }}>{progress.failed}</span>
                  <span style={s.statLabel}>failed</span>
                </div>
              </>
            )}
          </div>

          {/* Current transcript */}
          {progress.lastTitle && <p style={s.currentTitle}>{truncate(progress.lastTitle, 52)}</p>}
        </div>
      )}

      {/* Result */}
      {result && (
        <div
          style={{
            ...s.resultCard,
            borderLeftColor: result.failed > 0 ? "#f59e0b" : "#10b981",
          }}
        >
          <div style={s.resultStatsRow}>
            <div style={s.resultStat}>
              <span style={{ ...s.resultNum, color: "#10b981" }}>{result.synced}</span>
              <span style={s.resultLabel}>synced</span>
            </div>
            {result.skipped > 0 && (
              <div style={s.resultStat}>
                <span style={{ ...s.resultNum, color: "#6b7280" }}>{result.skipped}</span>
                <span style={s.resultLabel}>skipped</span>
              </div>
            )}
            {result.failed > 0 && (
              <div style={s.resultStat}>
                <span style={{ ...s.resultNum, color: "#ef4444" }}>{result.failed}</span>
                <span style={s.resultLabel}>failed</span>
              </div>
            )}
          </div>
          {result.errors.length > 0 && (
            <div style={s.errorList}>
              {result.errors.map((e, i) => (
                <p key={i} style={s.errorItem}>
                  {e}
                </p>
              ))}
            </div>
=======
=======
      const data = await api.post<SyncResult>("/api/sync/fireflies", { limit });
      setResult(data);
      const ts = new Date().toISOString();
      localStorage.setItem(LAST_SYNC_KEY, ts);
      setLastSync(ts);
      onSyncComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }, [api, limit, onSyncComplete]);

>>>>>>> fa5f0e1 (TC-1316: Frontend auto-process pending on load + webhook status in SyncControl)
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
        <button
          style={{
            ...styles.button,
            background: "#dc2626",
            ...(syncing ? styles.buttonDisabled : {}),
          }}
          disabled={syncing}
          onClick={handleClearAndResync}
        >
          Clear & Re-sync
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
>>>>>>> ffd94d9 (TC-1306: Build SyncControl component (sync button, progress, limit selector))
          )}
        </div>
      )}

<<<<<<< HEAD
      {/* Error */}
      {error && (
        <div style={s.errorBanner}>
          <span style={s.errorIcon}>!</span>
          {error}
        </div>
      )}

      {/* Webhook pending */}
      {webhookStatus && webhookStatus.pendingCount > 0 && (
        <div style={s.pendingBanner}>
          <span style={s.statNum}>{webhookStatus.pendingCount}</span>
          <span style={s.pendingText}>transcripts queued from webhook</span>
        </div>
=======
      {error && !timedOut && <div style={styles.error}>{error}</div>}

      {lastSync && (
        <p style={styles.lastSync}>Last synced: {formatTimeAgo(lastSync)}</p>
>>>>>>> ffd94d9 (TC-1306: Build SyncControl component (sync button, progress, limit selector))
      )}

      {webhookStatus && (
        <div style={styles.webhookStatus}>
          <span style={webhookStatus.configured ? styles.webhookActive : styles.webhookInactive}>
            {webhookStatus.configured ? "Webhook active" : "Webhook not configured"}
          </span>
          {webhookStatus.pendingCount > 0 && (
            <span style={styles.pendingCount}>
              {webhookStatus.pendingCount} transcripts waiting
            </span>
          )}
        </div>
      )}
    </section>
  );
};

// ── Styles ──────────────────────────────────────────────────────────

<<<<<<< HEAD
const FONT = "'Outfit', -apple-system, sans-serif";
const MONO = "'IBM Plex Mono', 'SF Mono', monospace";

const s: Record<string, React.CSSProperties> = {
  panel: {
    fontFamily: FONT,
    background: "#fff",
    border: "1px solid #e2e4e9",
    borderRadius: 12,
    padding: "20px 24px",
  },

  // Header
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 0,
  },
  titleGroup: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  heading: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: 600,
    color: "#1a1a1a",
    margin: 0,
    letterSpacing: "-0.01em",
  },
  lastSyncBadge: {
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: 500,
    color: "#9ca3af",
    background: "#f3f4f6",
    padding: "2px 8px",
    borderRadius: 4,
    letterSpacing: "0.02em",
  },
  webhookBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    fontWeight: 500,
    color: "#059669",
    background: "#ecfdf5",
    padding: "2px 8px",
    borderRadius: 4,
  },
  webhookDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#10b981",
    display: "inline-block",
    animation: "syncPulse 2s ease-in-out infinite",
  },

  // Buttons
  buttonGroup: {
    display: "flex",
    gap: 6,
  },
  btnPrimary: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: 600,
    color: "#fff",
    background: "#18181b",
    border: "none",
    borderRadius: 8,
    padding: "8px 18px",
    cursor: "pointer",
    letterSpacing: "-0.01em",
    transition: "background 0.15s, transform 0.1s",
  },
  btnDanger: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: 500,
    color: "#6b7280",
    background: "transparent",
    border: "1px solid #e2e4e9",
    borderRadius: 8,
    padding: "7px 14px",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  btnCancel: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: 500,
    color: "#ef4444",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    padding: "7px 14px",
    cursor: "pointer",
  },

  // Listing phase
  phaseCard: {
    marginTop: 16,
    padding: "14px 16px",
    background: "#fff",
    border: "1px solid #e2e4e9",
    borderRadius: 10,
    animation: "fadeSlideIn 0.25s ease-out",
  },
  phaseRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  phaseDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#6366f1",
    display: "inline-block",
    animation: "syncPulse 1.5s ease-in-out infinite",
  },
  phaseLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "#374151",
    letterSpacing: "-0.01em",
  },
  phaseDetail: {
    fontFamily: FONT,
    fontSize: 13,
    color: "#6b7280",
    margin: "4px 0 0",
  },

  // Syncing phase
  syncCard: {
    marginTop: 16,
    padding: "16px 18px",
    background: "#fff",
    border: "1px solid #e2e4e9",
    borderRadius: 10,
    animation: "fadeSlideIn 0.25s ease-out",
  },

  // Progress bar
  barOuter: {
    position: "relative" as const,
    height: 6,
    background: "#f3f4f6",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 14,
  },
  barFill: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    height: "100%",
    background: "linear-gradient(90deg, #6366f1, #8b5cf6)",
    borderRadius: 3,
    transition: "width 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
  },
  barScanline: {
    position: "absolute" as const,
    top: 0,
    width: 2,
    height: "100%",
    background: "#c4b5fd",
    opacity: 0.8,
    animation: "syncPulse 1s ease-in-out infinite",
  },

  // Stats
  statsRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 16,
  },
  stat: {
    display: "flex",
    alignItems: "baseline",
    gap: 4,
  },
  statNum: {
    fontFamily: MONO,
    fontSize: 20,
    fontWeight: 600,
    color: "#18181b",
    lineHeight: 1,
    letterSpacing: "-0.03em",
  },
  statDenom: {
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: 400,
    color: "#9ca3af",
  },
  statLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: "#9ca3af",
    letterSpacing: "0.01em",
  },
  statDivider: {
    width: 1,
    height: 16,
    background: "#e5e7eb",
  },
  currentTitle: {
    fontFamily: FONT,
    fontSize: 12,
    color: "#9ca3af",
    margin: "10px 0 0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },

  // Result
  resultCard: {
    marginTop: 16,
    padding: "16px 18px",
    background: "#fff",
    border: "1px solid #e2e4e9",
    borderLeft: "3px solid #10b981",
    borderRadius: 10,
    animation: "fadeSlideIn 0.3s ease-out",
  },
  resultStatsRow: {
    display: "flex",
    gap: 24,
  },
  resultStat: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  resultNum: {
    fontFamily: MONO,
    fontSize: 24,
    fontWeight: 600,
    lineHeight: 1,
    letterSpacing: "-0.03em",
  },
  resultLabel: {
    fontSize: 11,
    fontWeight: 500,
    color: "#9ca3af",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  },
  errorList: {
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px solid #f3f4f6",
  },
  errorItem: {
    fontFamily: MONO,
    fontSize: 11,
    color: "#b91c1c",
    margin: "0 0 4px",
    lineHeight: 1.4,
  },

  // Error banner
  errorBanner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 16,
    padding: "12px 14px",
    fontSize: 13,
    color: "#991b1b",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 10,
    lineHeight: 1.4,
  },
  errorIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    borderRadius: "50%",
    background: "#ef4444",
    color: "#fff",
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
  },

  // Pending
  pendingBanner: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    marginTop: 12,
    padding: "10px 14px",
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: 10,
    fontSize: 13,
    color: "#92400e",
  },
  pendingText: {
    fontSize: 13,
    color: "#92400e",
  },
=======
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
<<<<<<< HEAD
>>>>>>> ffd94d9 (TC-1306: Build SyncControl component (sync button, progress, limit selector))
=======
  webhookStatus: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    marginTop: 8,
    fontSize: 12,
  },
  webhookActive: {
    color: "#166534",
  },
  webhookInactive: {
    color: "#888",
  },
  pendingCount: {
    color: "#92400e",
  },
>>>>>>> fa5f0e1 (TC-1316: Frontend auto-process pending on load + webhook status in SyncControl)
};
