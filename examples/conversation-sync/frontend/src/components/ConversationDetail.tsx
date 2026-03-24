import { useState, useEffect, type FC } from "react";
import type { ApiClient } from "@tinyboilerplate/client";

// ── Types ────────────────────────────────────────────────────────────

interface Sentence {
  index: number;
  speaker_id: string;
  speaker_name: string;
  text: string;
  start_time: number;
  end_time: number;
}

interface Participant {
  id: string;
  name: string;
  email: string | null;
  speaker_label: string;
}

interface ConversationData {
  id: string;
  title: string;
  source: string;
  source_url: string | null;
  started_at: string;
  duration_secs: number;
  summary: string | null;
  metadata: Record<string, unknown>;
}

interface DetailResponse {
  conversation: ConversationData;
  participants: Participant[];
  transcript: Sentence[] | null;
}

interface ConversationDetailProps {
  api: ApiClient;
  conversationId: string;
  onBack: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatDuration(secs: number): string {
<<<<<<< HEAD
  if (secs >= 3600) return `${Math.round(secs / 3600)} hr`;
  return `${Math.round(secs / 60)} min`;
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-US", {
    weekday: "short",
=======
  if (secs >= 3600) {
    const hours = Math.round(secs / 3600);
    return `${hours} hr`;
  }
  const minutes = Math.round(secs / 60);
  return `${minutes} min`;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("en-US", {
>>>>>>> ab0248b (TC-1308: Build ConversationDetail component with transcript view and speaker labels)
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimestamp(seconds: number): string {
<<<<<<< HEAD
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${mins}:${String(secs).padStart(2, "0")}`;
=======
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
>>>>>>> ab0248b (TC-1308: Build ConversationDetail component with transcript view and speaker labels)
}

interface TranscriptBlock {
  speakerName: string;
  startTime: number;
  text: string;
}

function groupSentences(sentences: Sentence[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  for (const s of sentences) {
    const last = blocks[blocks.length - 1];
<<<<<<< HEAD
    if (last && last.speakerName === (s.speaker_name || "")) {
      last.text += " " + s.text;
    } else {
      blocks.push({ speakerName: s.speaker_name || "", startTime: s.start_time, text: s.text });
=======
    if (last && last.speakerName === s.speaker_name) {
      last.text += " " + s.text;
    } else {
      blocks.push({
        speakerName: s.speaker_name,
        startTime: s.start_time,
        text: s.text,
      });
>>>>>>> ab0248b (TC-1308: Build ConversationDetail component with transcript view and speaker labels)
    }
  }
  return blocks;
}

<<<<<<< HEAD
/** Render markdown-ish summary text (newlines, bullets, bold) as HTML. */
function renderSummary(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^[-*]\s+/gm, "\u2022 ")
    .replace(/\n/g, "<br />");
}

const SPEAKER_COLORS = [
  "#6366f1",
  "#06b6d4",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
];

function getSpeakerColor(name: string, map: Map<string, number>): string {
  if (!name) return "#d1d5db";
  if (!map.has(name)) map.set(name, map.size);
  return SPEAKER_COLORS[map.get(name)! % SPEAKER_COLORS.length];
=======
// Speaker colors for alternating backgrounds
const SPEAKER_COLORS = [
  "#f8f9fa",
  "#f0f4ff",
  "#faf5ff",
  "#f0fdf4",
  "#fefce8",
  "#fdf2f8",
];

function getSpeakerColor(speakerName: string, speakerMap: Map<string, number>): string {
  if (!speakerMap.has(speakerName)) {
    speakerMap.set(speakerName, speakerMap.size);
  }
  return SPEAKER_COLORS[speakerMap.get(speakerName)! % SPEAKER_COLORS.length];
>>>>>>> ab0248b (TC-1308: Build ConversationDetail component with transcript view and speaker labels)
}

// ── Component ────────────────────────────────────────────────────────

export const ConversationDetail: FC<ConversationDetailProps> = ({
  api,
  conversationId,
  onBack,
}) => {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get<DetailResponse>(`/api/conversations/${conversationId}`)
      .then((res) => setData(res))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [api, conversationId]);

  if (loading) {
<<<<<<< HEAD
    return (
      <div style={s.loadingCard}>
        <div style={s.loadingDots}>
          <span style={{ ...s.loadingDot, animationDelay: "0s" }} />
          <span style={{ ...s.loadingDot, animationDelay: "0.15s" }} />
          <span style={{ ...s.loadingDot, animationDelay: "0.3s" }} />
        </div>
        <p style={s.loadingText}>Loading conversation</p>
      </div>
    );
=======
    return <p style={styles.info}>Loading conversation...</p>;
>>>>>>> ab0248b (TC-1308: Build ConversationDetail component with transcript view and speaker labels)
  }

  if (error) {
    return (
      <div>
<<<<<<< HEAD
        <button style={s.backBtn} onClick={onBack}>
          &larr; Back
        </button>
        <div style={s.errorCard}>{error}</div>
=======
        <button style={styles.backButton} onClick={onBack}>
          &larr; Back
        </button>
        <div style={styles.error}>{error}</div>
>>>>>>> ab0248b (TC-1308: Build ConversationDetail component with transcript view and speaker labels)
      </div>
    );
  }

  if (!data) return null;

  const { conversation, participants, transcript } = data;
  const blocks = transcript ? groupSentences(transcript) : [];
  const speakerMap = new Map<string, number>();

  return (
<<<<<<< HEAD
    <section style={s.container}>
      <button style={s.backBtn} onClick={onBack}>
        &larr; Back to conversations
      </button>

      {/* Header */}
      <div style={s.header}>
        <h2 style={s.title}>{conversation.title}</h2>
        <div style={s.metaRow}>
          <span style={s.metaMono}>{formatDate(conversation.started_at)}</span>
          <span style={s.metaDot}>&middot;</span>
          <span style={s.metaMono}>{formatDuration(conversation.duration_secs)}</span>
          {participants.length > 0 && (
            <>
              <span style={s.metaDot}>&middot;</span>
              <span style={s.metaText}>
                {participants.length} participant{participants.length !== 1 ? "s" : ""}
              </span>
            </>
          )}
        </div>

        {participants.length > 0 && (
          <div style={s.chipRow}>
            {participants.map((p) => {
              const color = getSpeakerColor(p.name, speakerMap);
              return (
                <span key={p.id} style={s.chip}>
                  <span style={{ ...s.chipDot, backgroundColor: color }} />
                  {p.name}
                  {p.email && <span style={s.chipEmail}> ({p.email})</span>}
                </span>
              );
            })}
          </div>
        )}

        {conversation.source_url && (
          <a href={conversation.source_url} target="_blank" rel="noreferrer" style={s.externalLink}>
=======
    <section>
      <button style={styles.backButton} onClick={onBack}>
        &larr; Back
      </button>

      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.title}>{conversation.title}</h2>
        <div style={styles.meta}>
          <span>{formatDate(conversation.started_at)}</span>
          <span>{formatDuration(conversation.duration_secs)}</span>
        </div>
        <div style={styles.participants}>
          {participants.map((p) => p.name).join(", ")}
        </div>
        {conversation.source_url && (
          <a
            href={conversation.source_url}
            target="_blank"
            rel="noreferrer"
            style={styles.externalLink}
          >
>>>>>>> ab0248b (TC-1308: Build ConversationDetail component with transcript view and speaker labels)
            View on Fireflies &rarr;
          </a>
        )}
      </div>

      {/* Summary */}
      {conversation.summary && (
<<<<<<< HEAD
        <div style={s.summaryCard}>
          <h3 style={s.sectionLabel}>Summary</h3>
          <div
            style={s.summaryText}
            dangerouslySetInnerHTML={{ __html: renderSummary(conversation.summary) }}
          />
=======
        <div style={styles.summary}>
          <h3 style={styles.sectionTitle}>Summary</h3>
          <p style={styles.summaryText}>{conversation.summary}</p>
>>>>>>> ab0248b (TC-1308: Build ConversationDetail component with transcript view and speaker labels)
        </div>
      )}

      {/* Transcript */}
<<<<<<< HEAD
      <div style={s.transcriptSection}>
        <h3 style={s.sectionLabel}>Transcript</h3>
        {blocks.length === 0 ? (
          <p style={s.noTranscript}>No transcript available.</p>
        ) : (
          <div style={s.blockList}>
            {blocks.map((block, i) => {
              const color = getSpeakerColor(block.speakerName, speakerMap);
              return (
                <div
                  key={i}
                  data-testid="transcript-block"
                  style={{ ...s.block, borderLeftColor: color }}
                >
                  <div style={s.blockHeader}>
                    {block.speakerName && (
                      <span style={{ ...s.speakerName, color }}>{block.speakerName}</span>
                    )}
                    <span style={s.timestamp}>{formatTimestamp(block.startTime)}</span>
                  </div>
                  <p style={s.blockText}>{block.text}</p>
                </div>
              );
            })}
          </div>
=======
      <div style={styles.transcript}>
        <h3 style={styles.sectionTitle}>Transcript</h3>
        {blocks.length === 0 ? (
          <p style={styles.noTranscript}>No transcript available.</p>
        ) : (
          blocks.map((block, i) => (
            <div
              key={i}
              data-testid="transcript-block"
              style={{
                ...styles.block,
                backgroundColor: getSpeakerColor(block.speakerName, speakerMap),
              }}
            >
              <div style={styles.blockHeader}>
                <span style={styles.speakerName}>{block.speakerName}</span>
                <span style={styles.timestamp}>
                  {formatTimestamp(block.startTime)}
                </span>
              </div>
              <p style={styles.blockText}>{block.text}</p>
            </div>
          ))
>>>>>>> ab0248b (TC-1308: Build ConversationDetail component with transcript view and speaker labels)
        )}
      </div>
    </section>
  );
};

<<<<<<< HEAD
// ── Styles ──────────────────────────────────────────────────────────

const FONT = "'Outfit', -apple-system, sans-serif";
const MONO = "'IBM Plex Mono', 'SF Mono', monospace";

const s: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: FONT,
    animation: "fadeSlideIn 0.3s ease-out",
  },
  loadingCard: {
    fontFamily: FONT,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 14,
    padding: "40px 20px",
    background: "#fff",
    border: "1px solid #e2e4e9",
    borderRadius: 12,
    animation: "fadeSlideIn 0.3s ease-out",
  },
  loadingDots: {
    display: "flex",
    gap: 6,
  },
  loadingDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#6366f1",
    animation: "syncPulse 1s ease-in-out infinite",
  },
  loadingText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: 500,
    color: "#6b7280",
    margin: 0,
  },
  backBtn: {
    fontFamily: FONT,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: 500,
    color: "#6b7280",
    background: "transparent",
    border: "1px solid #e2e4e9",
    borderRadius: 8,
=======
// ── Styles ────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  info: {
    fontSize: 14,
    color: "#555",
    textAlign: "center",
    padding: 20,
  },
  error: {
    fontSize: 13,
    color: "#b91c1c",
    background: "#fef2f2",
    padding: "8px 12px",
    border: "1px solid #fecaca",
    borderRadius: 6,
  },
  backButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 12px",
    fontSize: 14,
    color: "#2563eb",
    background: "transparent",
    border: "1px solid #e0e0e0",
    borderRadius: 6,
>>>>>>> ab0248b (TC-1308: Build ConversationDetail component with transcript view and speaker labels)
    cursor: "pointer",
    marginBottom: 16,
  },
  header: {
    marginBottom: 20,
<<<<<<< HEAD
    paddingBottom: 16,
    borderBottom: "1px solid #e2e4e9",
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    margin: "0 0 8px",
    color: "#18181b",
    letterSpacing: "-0.02em",
  },
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    color: "#6b7280",
    marginBottom: 10,
  },
  metaMono: {
    fontFamily: MONO,
    fontSize: 12,
    color: "#6b7280",
  },
  metaText: {},
  metaDot: { color: "#d1d5db" },
  chipRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 8,
    marginBottom: 10,
  },
  chip: {
    fontFamily: FONT,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    color: "#374151",
    background: "#f3f4f6",
    padding: "3px 10px",
    borderRadius: 12,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    display: "inline-block",
  },
  chipEmail: {
    color: "#9ca3af",
    fontSize: 11,
  },
  externalLink: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: 500,
    color: "#6366f1",
    textDecoration: "none",
  },
  summaryCard: {
    marginBottom: 20,
    padding: "14px 16px",
    background: "#fff",
    border: "1px solid #e2e4e9",
    borderLeft: "3px solid #6366f1",
    borderRadius: 10,
  },
  sectionLabel: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: 700,
    color: "#9ca3af",
    margin: "0 0 8px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  },
  summaryText: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 1.6,
    margin: 0,
  },
  transcriptSection: {
    marginBottom: 20,
  },
  noTranscript: {
    fontSize: 13,
    color: "#9ca3af",
    fontStyle: "italic",
  },
  blockList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  block: {
    padding: "10px 16px",
    borderLeft: "3px solid #d1d5db",
    background: "#fff",
    borderRadius: "0 6px 6px 0",
  },
  blockHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    marginBottom: 3,
  },
  speakerName: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: 700,
  },
  timestamp: {
    fontFamily: MONO,
    fontSize: 11,
    color: "#9ca3af",
  },
  blockText: {
    fontFamily: FONT,
    fontSize: 14,
    color: "#1f2937",
    lineHeight: 1.6,
    margin: 0,
  },
  errorCard: {
    fontFamily: FONT,
    fontSize: 13,
    color: "#991b1b",
    background: "#fef2f2",
    padding: "10px 14px",
    border: "1px solid #fecaca",
    borderRadius: 8,
  },
=======
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    margin: "0 0 6px",
    color: "#1a1a1a",
  },
  meta: {
    display: "flex",
    gap: 12,
    fontSize: 14,
    color: "#666",
    marginBottom: 4,
  },
  participants: {
    fontSize: 14,
    color: "#555",
    marginBottom: 8,
  },
  externalLink: {
    fontSize: 13,
    color: "#2563eb",
    textDecoration: "none",
  },
  summary: {
    marginBottom: 20,
    padding: "12px 16px",
    background: "#f9fafb",
    borderRadius: 8,
    border: "1px solid #e5e7eb",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "#444",
    margin: "0 0 8px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  },
  summaryText: {
    fontSize: 14,
    color: "#333",
    lineHeight: 1.5,
    margin: 0,
  },
  transcript: {
    marginBottom: 20,
  },
  noTranscript: {
    fontSize: 14,
    color: "#888",
    fontStyle: "italic",
  },
  block: {
    padding: "10px 14px",
    borderRadius: 6,
    marginBottom: 4,
  },
  blockHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 2,
  },
  speakerName: {
    fontSize: 13,
    fontWeight: 700,
    color: "#1a1a1a",
  },
  timestamp: {
    fontSize: 12,
    color: "#999",
  },
  blockText: {
    fontSize: 14,
    color: "#333",
    lineHeight: 1.5,
    margin: 0,
  },
>>>>>>> ab0248b (TC-1308: Build ConversationDetail component with transcript view and speaker labels)
};
