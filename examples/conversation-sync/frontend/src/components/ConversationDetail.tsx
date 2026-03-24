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
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
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
    if (last && last.speakerName === s.speaker_name) {
      last.text += " " + s.text;
    } else {
      blocks.push({
        speakerName: s.speaker_name,
        startTime: s.start_time,
        text: s.text,
      });
    }
  }
  return blocks;
}

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
    return <p style={styles.info}>Loading conversation...</p>;
  }

  if (error) {
    return (
      <div>
        <button style={styles.backButton} onClick={onBack}>
          &larr; Back
        </button>
        <div style={styles.error}>{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const { conversation, participants, transcript } = data;
  const blocks = transcript ? groupSentences(transcript) : [];
  const speakerMap = new Map<string, number>();

  return (
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
            View on Fireflies &rarr;
          </a>
        )}
      </div>

      {/* Summary */}
      {conversation.summary && (
        <div style={styles.summary}>
          <h3 style={styles.sectionTitle}>Summary</h3>
          <p style={styles.summaryText}>{conversation.summary}</p>
        </div>
      )}

      {/* Transcript */}
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
        )}
      </div>
    </section>
  );
};

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
    cursor: "pointer",
    marginBottom: 16,
  },
  header: {
    marginBottom: 20,
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
};
