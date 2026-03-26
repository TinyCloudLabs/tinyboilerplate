import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
<<<<<<< HEAD
import { render, screen, waitFor, cleanup } from "@testing-library/react";
=======
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
>>>>>>> ffd94d9 (TC-1306: Build SyncControl component (sync button, progress, limit selector))
import { SyncControl } from "../components/SyncControl";
import type { ApiClient } from "@tinyboilerplate/client";

function mockApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
<<<<<<< HEAD
<<<<<<< HEAD
    get: vi.fn().mockResolvedValue({ configured: false, pendingCount: 0, webhookUrl: "" }),
=======
    get: vi.fn(),
>>>>>>> ffd94d9 (TC-1306: Build SyncControl component (sync button, progress, limit selector))
=======
    get: vi.fn().mockResolvedValue({ configured: false, pendingCount: 0, webhookUrl: "" }),
>>>>>>> fa5f0e1 (TC-1316: Frontend auto-process pending on load + webhook status in SyncControl)
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    ...overrides,
  };
}

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
}

describe("SyncControl", () => {
  let api: ApiClient;
  let onSyncComplete: ReturnType<typeof vi.fn>;
<<<<<<< HEAD
  const getAccessToken = vi.fn().mockReturnValue("test-token");
=======
>>>>>>> ffd94d9 (TC-1306: Build SyncControl component (sync button, progress, limit selector))

  beforeEach(() => {
    api = mockApi();
    onSyncComplete = vi.fn();
    vi.stubGlobal("localStorage", createMockStorage());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

<<<<<<< HEAD
  it("renders Sync All and Reset buttons", () => {
    render(
      <SyncControl
        api={api}
        backendUrl="http://localhost:3001"
        getAccessToken={getAccessToken}
        onSyncComplete={onSyncComplete}
      />,
    );
    expect(screen.getByRole("button", { name: /sync all/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
  });

  it("fetches webhook status on mount", async () => {
    const getMock = vi.fn().mockResolvedValue({
      configured: true,
      pendingCount: 0,
      webhookUrl: "http://localhost:3001/api/webhooks/fireflies",
    });
    api = mockApi({ get: getMock });

    render(
      <SyncControl
        api={api}
        backendUrl="http://localhost:3001"
        getAccessToken={getAccessToken}
        onSyncComplete={onSyncComplete}
      />,
    );

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith("/api/config/webhook-status");
    });
  });

  it("shows 'Live' badge when webhook is configured", async () => {
    const getMock = vi.fn().mockResolvedValue({
      configured: true,
      pendingCount: 0,
      webhookUrl: "http://localhost:3001/api/webhooks/fireflies",
    });
    api = mockApi({ get: getMock });

    render(
      <SyncControl
        api={api}
        backendUrl="http://localhost:3001"
        getAccessToken={getAccessToken}
        onSyncComplete={onSyncComplete}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/live/i)).toBeInTheDocument();
    });
  });

  it("does not show Live badge when webhook is not configured", async () => {
    const getMock = vi.fn().mockResolvedValue({
      configured: false,
      pendingCount: 0,
      webhookUrl: "http://localhost:3001/api/webhooks/fireflies",
    });
    api = mockApi({ get: getMock });

    render(
      <SyncControl
        api={api}
        backendUrl="http://localhost:3001"
        getAccessToken={getAccessToken}
        onSyncComplete={onSyncComplete}
      />,
    );

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith("/api/config/webhook-status");
    });

    expect(screen.queryByText(/live/i)).not.toBeInTheDocument();
  });

  it("shows pending count when there are pending items", async () => {
    const getMock = vi.fn().mockResolvedValue({
      configured: true,
      pendingCount: 3,
      webhookUrl: "http://localhost:3001/api/webhooks/fireflies",
    });
    api = mockApi({ get: getMock });

    render(
      <SyncControl
        api={api}
        backendUrl="http://localhost:3001"
        getAccessToken={getAccessToken}
        onSyncComplete={onSyncComplete}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/transcripts queued from webhook/i)).toBeInTheDocument();
    });
  });

  it("does not show webhook badge if fetch fails", async () => {
    const getMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    api = mockApi({ get: getMock });

    render(
      <SyncControl
        api={api}
        backendUrl="http://localhost:3001"
        getAccessToken={getAccessToken}
        onSyncComplete={onSyncComplete}
      />,
    );

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith("/api/config/webhook-status");
    });

    expect(screen.queryByText(/live/i)).not.toBeInTheDocument();
=======
  it("renders Sync Now button and limit selector", () => {
    render(<SyncControl api={api} onSyncComplete={onSyncComplete} />);
    expect(
      screen.getByRole("button", { name: /sync now/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("has limit options 10, 20, 50 with 20 as default", () => {
    render(<SyncControl api={api} onSyncComplete={onSyncComplete} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("20");
    const options = screen.getAllByRole("option");
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
      "10",
      "20",
      "50",
    ]);
  });

  it("calls POST /api/sync/fireflies with selected limit on click", async () => {
    const postMock = vi
      .fn()
      .mockResolvedValue({ synced: 5, skipped: 3, failed: 0, errors: [] });
    api = mockApi({ post: postMock });

    render(<SyncControl api={api} onSyncComplete={onSyncComplete} />);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith("/api/sync/fireflies", {
        limit: 50,
      });
    });
  });

  it("shows syncing message during sync", async () => {
    let resolveSync!: (v: any) => void;
    const postMock = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveSync = resolve;
      }),
    );
    api = mockApi({ post: postMock });

    render(<SyncControl api={api} onSyncComplete={onSyncComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));

    expect(screen.getByText(/syncing conversations/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /syncing/i })).toBeDisabled();

    // Resolve to clean up
    await act(async () => {
      resolveSync({ synced: 0, skipped: 0, failed: 0, errors: [] });
    });
  });

  it("shows success message on completed sync", async () => {
    const postMock = vi
      .fn()
      .mockResolvedValue({ synced: 5, skipped: 3, failed: 0, errors: [] });
    api = mockApi({ post: postMock });

    render(<SyncControl api={api} onSyncComplete={onSyncComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/synced 5 conversations/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/3 already up to date/i)).toBeInTheDocument();
    });
  });

  it("shows partial failure message with details", async () => {
    const postMock = vi.fn().mockResolvedValue({
      synced: 3,
      skipped: 1,
      failed: 2,
      errors: ["abc123: timeout", "def456: rate limit"],
    });
    api = mockApi({ post: postMock });

    render(<SyncControl api={api} onSyncComplete={onSyncComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));

    await waitFor(() => {
      expect(screen.getByText(/synced 3/i)).toBeInTheDocument();
      expect(screen.getByText(/2 failed/i)).toBeInTheDocument();
      expect(screen.getByText(/abc123: timeout/i)).toBeInTheDocument();
    });
  });

  it("shows timeout message after 60 seconds", async () => {
    vi.useFakeTimers();
    const postMock = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves
    api = mockApi({ post: postMock });

    render(<SyncControl api={api} onSyncComplete={onSyncComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(
      screen.getByText(/sync is taking longer than expected/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/try again with a smaller batch/i),
    ).toBeInTheDocument();
  });

  it("calls onSyncComplete after successful sync", async () => {
    const postMock = vi
      .fn()
      .mockResolvedValue({ synced: 2, skipped: 0, failed: 0, errors: [] });
    api = mockApi({ post: postMock });

    render(<SyncControl api={api} onSyncComplete={onSyncComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));

    await waitFor(() => {
      expect(onSyncComplete).toHaveBeenCalledOnce();
    });
  });

  it("does not call onSyncComplete on full failure", async () => {
    const postMock = vi
      .fn()
      .mockRejectedValue(new Error("Server error"));
    api = mockApi({ post: postMock });

    render(<SyncControl api={api} onSyncComplete={onSyncComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));

    await waitFor(() => {
      expect(screen.getByText(/server error/i)).toBeInTheDocument();
    });
    expect(onSyncComplete).not.toHaveBeenCalled();
  });

  it("stores last sync timestamp in localStorage on success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-24T15:00:00Z"));
    const postMock = vi.fn().mockImplementation(
      () => Promise.resolve({ synced: 1, skipped: 0, failed: 0, errors: [] }),
    );
    api = mockApi({ post: postMock });

    render(<SyncControl api={api} onSyncComplete={onSyncComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));

    // Advance timers to allow microtasks + setTimeout in waitFor to resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(localStorage.getItem("lastSyncTimestamp")).toBe(
      "2026-03-24T15:00:00.000Z",
    );
>>>>>>> ffd94d9 (TC-1306: Build SyncControl component (sync button, progress, limit selector))
  });

  it("displays last synced time from localStorage", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-24T15:10:00Z"));
<<<<<<< HEAD
    localStorage.setItem("lastSyncTimestamp", new Date("2026-03-24T15:00:00Z").toISOString());

    render(
      <SyncControl
        api={api}
        backendUrl="http://localhost:3001"
        getAccessToken={getAccessToken}
        onSyncComplete={onSyncComplete}
      />,
    );
    expect(screen.getByText(/10 min ago/i)).toBeInTheDocument();
=======
    localStorage.setItem(
      "lastSyncTimestamp",
      new Date("2026-03-24T15:00:00Z").toISOString(),
    );

    render(<SyncControl api={api} onSyncComplete={onSyncComplete} />);
    expect(screen.getByText(/last synced: 10 minutes ago/i)).toBeInTheDocument();
  });

  it("shows error message on API error", async () => {
    const postMock = vi
      .fn()
      .mockRejectedValue(new Error("Network failure"));
    api = mockApi({ post: postMock });

    render(<SyncControl api={api} onSyncComplete={onSyncComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));

    await waitFor(() => {
      expect(screen.getByText(/network failure/i)).toBeInTheDocument();
    });
>>>>>>> ffd94d9 (TC-1306: Build SyncControl component (sync button, progress, limit selector))
  });

  // ── Webhook status tests ───────────────────────────────────────────

  it("fetches webhook status on mount", async () => {
    const getMock = vi.fn().mockResolvedValue({
      configured: true,
      pendingCount: 0,
      webhookUrl: "http://localhost:3001/api/webhooks/fireflies",
    });
    api = mockApi({ get: getMock });

    render(<SyncControl api={api} onSyncComplete={onSyncComplete} />);

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith("/api/config/webhook-status");
    });
  });

  it("shows 'Webhook active' when configured with no pending", async () => {
    const getMock = vi.fn().mockResolvedValue({
      configured: true,
      pendingCount: 0,
      webhookUrl: "http://localhost:3001/api/webhooks/fireflies",
    });
    api = mockApi({ get: getMock });

    render(<SyncControl api={api} onSyncComplete={onSyncComplete} />);

    await waitFor(() => {
      expect(screen.getByText(/webhook active/i)).toBeInTheDocument();
    });
  });

  it("shows 'Webhook not configured' when not configured", async () => {
    const getMock = vi.fn().mockResolvedValue({
      configured: false,
      pendingCount: 0,
      webhookUrl: "http://localhost:3001/api/webhooks/fireflies",
    });
    api = mockApi({ get: getMock });

    render(<SyncControl api={api} onSyncComplete={onSyncComplete} />);

    await waitFor(() => {
      expect(screen.getByText(/webhook not configured/i)).toBeInTheDocument();
    });
  });

  it("shows pending count when there are pending items", async () => {
    const getMock = vi.fn().mockResolvedValue({
      configured: true,
      pendingCount: 3,
      webhookUrl: "http://localhost:3001/api/webhooks/fireflies",
    });
    api = mockApi({ get: getMock });

    render(<SyncControl api={api} onSyncComplete={onSyncComplete} />);

    await waitFor(() => {
      expect(screen.getByText(/3 transcripts waiting/i)).toBeInTheDocument();
    });
  });

  it("does not show webhook status if fetch fails", async () => {
    const getMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    api = mockApi({ get: getMock });

    render(<SyncControl api={api} onSyncComplete={onSyncComplete} />);

    // Wait for fetch to complete
    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith("/api/config/webhook-status");
    });

    // Should not show webhook status
    expect(screen.queryByText(/webhook active/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/webhook not configured/i)).not.toBeInTheDocument();
  });
});
