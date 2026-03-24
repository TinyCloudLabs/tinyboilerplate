import { useState, useEffect, useCallback, type FC } from "react";
import type { ApiClient } from "@tinyboilerplate/client";

interface Conversation {
  id: string;
  title: string;
  source: string;
  source_url: string | null;
  started_at: string;
  duration_secs: number;
  summary: string | null;
  created_at: string;
  participant_count: number;
}

interface ConversationsResponse {
  conversations: Conversation[];
  total: number;
}

interface ConversationListProps {
  api: ApiClient;
  onSelectConversation: (id: string) => void;
  refreshKey?: number;
}

const PAGE_SIZE = 20;

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
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function truncateSummary(summary: string, maxLen = 100): string {
  if (summary.length <= maxLen) return summary;
  return summary.slice(0, maxLen) + "\u2026";
}

export const ConversationList: FC<ConversationListProps> = ({
  api,
  onSelectConversation,
  refreshKey,
}) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConversations = useCallback(
    async (offset: number, append: boolean) => {
      try {
        const data = await api.get<ConversationsResponse>(
          `/api/conversations?limit=${PAGE_SIZE}&offset=${offset}`,
        );
        if (append) {
          setConversations((prev) => [...prev, ...data.conversations]);
        } else {
          setConversations(data.conversations);
        }
        setTotal(data.total);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [api],
  );

  // Initial fetch + refresh on refreshKey change
  useEffect(() => {
    setLoading(true);
    setConversations([]);
    fetchConversations(0, false).finally(() => setLoading(false));
  }, [fetchConversations, refreshKey]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    await fetchConversations(conversations.length, true);
    setLoadingMore(false);
  };

  if (loading) {
    return <p style={styles.info}>Loading conversations...</p>;
  }

  if (error) {
    return <div style={styles.error}>{error}</div>;
  }

  if (conversations.length === 0) {
    return (
      <div style={styles.empty}>
        <p style={styles.emptyTitle}>No conversations yet.</p>
        <p style={styles.emptySubtitle}>
          Click Sync to import from Fireflies.
        </p>
      </div>
    );
  }

  const hasMore = conversations.length < total;

  return (
    <section>
      <ul style={styles.list}>
        {conversations.map((c) => (
          <li
            key={c.id}
            style={styles.row}
            onClick={() => onSelectConversation(c.id)}
          >
            <div style={styles.rowHeader}>
              <span style={styles.title}>{c.title}</span>
              <span style={styles.date}>{formatDate(c.started_at)}</span>
            </div>
            <div style={styles.meta}>
              <span>{formatDuration(c.duration_secs)}</span>
              <span>{c.participant_count} participants</span>
            </div>
            {c.summary && (
              <p style={styles.summary}>{truncateSummary(c.summary)}</p>
            )}
          </li>
        ))}
      </ul>

      {hasMore && (
        <button
          style={{
            ...styles.loadMore,
            ...(loadingMore ? styles.loadMoreDisabled : {}),
          }}
          disabled={loadingMore}
          onClick={handleLoadMore}
        >
          {loadingMore ? "Loading..." : "Load More"}
        </button>
      )}
    </section>
  );
};

// ── Styles ──────────────────────────────────────────────────────────

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
  empty: {
    textAlign: "center",
    padding: "32px 16px",
    color: "#666",
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 600,
    margin: "0 0 4px",
  },
  emptySubtitle: {
    fontSize: 14,
    margin: 0,
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
  row: {
    padding: "12px 16px",
    borderBottom: "1px solid #e5e7eb",
    cursor: "pointer",
  },
  rowHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    color: "#1a1a1a",
  },
  date: {
    fontSize: 13,
    color: "#888",
  },
  meta: {
    display: "flex",
    gap: 12,
    fontSize: 13,
    color: "#666",
    marginBottom: 4,
  },
  summary: {
    fontSize: 13,
    color: "#777",
    margin: "4px 0 0",
    lineHeight: 1.4,
  },
  loadMore: {
    display: "block",
    width: "100%",
    padding: "10px 0",
    fontSize: 14,
    fontWeight: 500,
    color: "#2563eb",
    background: "transparent",
    border: "1px solid #e0e0e0",
    borderRadius: 6,
    cursor: "pointer",
    marginTop: 8,
  },
  loadMoreDisabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  },
};
