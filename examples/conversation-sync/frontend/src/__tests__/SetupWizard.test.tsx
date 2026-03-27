import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { SetupWizard } from "../components/SetupWizard";
import type { ApiClient } from "@tinyboilerplate/client";

function mockApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    ...overrides,
  };
}

describe("SetupWizard", () => {
  let api: ApiClient;
  let onComplete: ReturnType<typeof vi.fn>;

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    api = mockApi();
    onComplete = vi.fn();
  });

  // Step 1: Welcome
  it("renders welcome step initially", () => {
    render(<SetupWizard api={api} onComplete={onComplete} />);
<<<<<<< HEAD
<<<<<<< HEAD
    expect(screen.getByText(/connect fireflies/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /get started/i })).toBeInTheDocument();
  });

  // Step 2: Instructions
  it("advances to instructions step on Get Started click", () => {
    render(<SetupWizard api={api} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    expect(screen.getByText(/app\.fireflies\.ai/i)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
=======
    expect(
      screen.getByText(/connect your fireflies\.ai account/i),
    ).toBeInTheDocument();
=======
    expect(screen.getByText(/connect your fireflies\.ai account/i)).toBeInTheDocument();
>>>>>>> 4ccbd94 (style: run Prettier on all conversation-sync files)
    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
  });

  // Step 2: Instructions
  it("advances to instructions step on Next click", () => {
    render(<SetupWizard api={api} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText(/app\.fireflies\.ai/i)).toBeInTheDocument();
<<<<<<< HEAD
    expect(
      screen.getByRole("link", { name: /fireflies integrations/i }),
    ).toHaveAttribute(
>>>>>>> 6a82158 (TC-1305: Build SetupWizard component (5-step guided API key onboarding))
=======
    expect(screen.getByRole("link", { name: /fireflies integrations/i })).toHaveAttribute(
>>>>>>> 4ccbd94 (style: run Prettier on all conversation-sync files)
      "href",
      "https://app.fireflies.ai/integrations",
    );
  });

  // Step 3: Input
  it("advances to input step and shows API key field", () => {
    render(<SetupWizard api={api} onComplete={onComplete} />);
<<<<<<< HEAD
    // Step 1 -> 2
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    // Step 2 -> 3
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByPlaceholderText(/paste your fireflies api key/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save & verify/i })).toBeInTheDocument();
  });

  it("disables Save & Verify button when API key input is empty", () => {
    render(<SetupWizard api={api} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByRole("button", { name: /save & verify/i })).toBeDisabled();
  });

  it("calls PUT /api/config/fireflies-key on Save & Verify and advances to test step", async () => {
    const putMock = vi.fn().mockResolvedValue({ ok: true });
    const getMock = vi.fn().mockResolvedValue({ name: "Roman", email: "roman@example.com" });
=======
    // Step 1 → 2
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    // Step 2 → 3
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByPlaceholderText(/paste your api key/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  it("disables Save button when API key input is empty", () => {
    render(<SetupWizard api={api} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("calls PUT /api/config/fireflies-key on Save and advances to test step", async () => {
    const putMock = vi.fn().mockResolvedValue({ ok: true });
<<<<<<< HEAD
    const getMock = vi
      .fn()
      .mockResolvedValue({ name: "Roman", email: "roman@example.com" });
>>>>>>> 6a82158 (TC-1305: Build SetupWizard component (5-step guided API key onboarding))
=======
    const getMock = vi.fn().mockResolvedValue({ name: "Roman", email: "roman@example.com" });
>>>>>>> 4ccbd94 (style: run Prettier on all conversation-sync files)
    api = mockApi({ put: putMock, get: getMock });

    render(<SetupWizard api={api} onComplete={onComplete} />);
    // Navigate to input step
<<<<<<< HEAD
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Type key and save
    fireEvent.change(screen.getByPlaceholderText(/paste your fireflies api key/i), {
      target: { value: "test-api-key-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save & verify/i }));
=======
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Type key and save
    fireEvent.change(screen.getByPlaceholderText(/paste your api key/i), {
      target: { value: "test-api-key-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
>>>>>>> 6a82158 (TC-1305: Build SetupWizard component (5-step guided API key onboarding))

    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/api/config/fireflies-key", {
        apiKey: "test-api-key-123",
      });
    });
  });

  // Step 4: Test connection
  it("shows connected user info on successful connection test", async () => {
    const putMock = vi.fn().mockResolvedValue({ ok: true });
<<<<<<< HEAD
<<<<<<< HEAD
    const getMock = vi.fn().mockResolvedValue({ name: "Roman", email: "roman@example.com" });
    api = mockApi({ put: putMock, get: getMock });

    render(<SetupWizard api={api} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.change(screen.getByPlaceholderText(/paste your fireflies api key/i), {
      target: { value: "test-api-key-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save & verify/i }));
=======
    const getMock = vi
      .fn()
      .mockResolvedValue({ name: "Roman", email: "roman@example.com" });
=======
    const getMock = vi.fn().mockResolvedValue({ name: "Roman", email: "roman@example.com" });
>>>>>>> 4ccbd94 (style: run Prettier on all conversation-sync files)
    api = mockApi({ put: putMock, get: getMock });

    render(<SetupWizard api={api} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.change(screen.getByPlaceholderText(/paste your api key/i), {
      target: { value: "test-api-key-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
>>>>>>> 6a82158 (TC-1305: Build SetupWizard component (5-step guided API key onboarding))

    await waitFor(() => {
      expect(screen.getByText(/connected as roman/i)).toBeInTheDocument();
      expect(screen.getByText(/roman@example\.com/i)).toBeInTheDocument();
    });

    expect(getMock).toHaveBeenCalledWith("/api/fireflies/user");
  });

  it("shows error and re-enter option on failed connection test", async () => {
    const putMock = vi.fn().mockResolvedValue({ ok: true });
    const getMock = vi.fn().mockRejectedValue(new Error("Invalid API key"));
    api = mockApi({ put: putMock, get: getMock });

    render(<SetupWizard api={api} onComplete={onComplete} />);
<<<<<<< HEAD
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.change(screen.getByPlaceholderText(/paste your fireflies api key/i), {
      target: { value: "bad-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save & verify/i }));
=======
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.change(screen.getByPlaceholderText(/paste your api key/i), {
      target: { value: "bad-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
>>>>>>> 6a82158 (TC-1305: Build SetupWizard component (5-step guided API key onboarding))

    await waitFor(() => {
      expect(screen.getByText(/invalid api key/i)).toBeInTheDocument();
    });
<<<<<<< HEAD
<<<<<<< HEAD
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
=======
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
>>>>>>> 6a82158 (TC-1305: Build SetupWizard component (5-step guided API key onboarding))
=======
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
>>>>>>> 4ccbd94 (style: run Prettier on all conversation-sync files)
  });

  it("goes back to input step on Try Again after failed test", async () => {
    const putMock = vi.fn().mockResolvedValue({ ok: true });
    const getMock = vi.fn().mockRejectedValue(new Error("Invalid API key"));
    api = mockApi({ put: putMock, get: getMock });

    render(<SetupWizard api={api} onComplete={onComplete} />);
<<<<<<< HEAD
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.change(screen.getByPlaceholderText(/paste your fireflies api key/i), {
      target: { value: "bad-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save & verify/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
=======
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.change(screen.getByPlaceholderText(/paste your api key/i), {
      target: { value: "bad-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
<<<<<<< HEAD
      expect(
        screen.getByRole("button", { name: /try again/i }),
      ).toBeInTheDocument();
>>>>>>> 6a82158 (TC-1305: Build SetupWizard component (5-step guided API key onboarding))
=======
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
>>>>>>> 4ccbd94 (style: run Prettier on all conversation-sync files)
    });
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    // Should be back on input step
<<<<<<< HEAD
<<<<<<< HEAD
    expect(screen.getByPlaceholderText(/paste your fireflies api key/i)).toBeInTheDocument();
  });

  // Step 5: Webhook configuration
  // Helper: navigate to webhook step (through successful connection test)
  async function navigateToWebhook() {
    const putMock = vi.fn().mockResolvedValue({ ok: true });
    const getMock = vi.fn().mockResolvedValue({ name: "Roman", email: "roman@example.com" });
    api = mockApi({ put: putMock, get: getMock });

    render(<SetupWizard api={api} onComplete={onComplete} backendUrl="http://localhost:3001" />);
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.change(screen.getByPlaceholderText(/paste your fireflies api key/i), {
      target: { value: "test-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save & verify/i }));
=======
    expect(
      screen.getByPlaceholderText(/paste your api key/i),
    ).toBeInTheDocument();
=======
    expect(screen.getByPlaceholderText(/paste your api key/i)).toBeInTheDocument();
>>>>>>> 4ccbd94 (style: run Prettier on all conversation-sync files)
  });

  // Step 5: Webhook configuration
  // Helper: navigate to webhook step (through successful connection test)
  async function navigateToWebhook() {
    const putMock = vi.fn().mockResolvedValue({ ok: true });
    const getMock = vi.fn().mockResolvedValue({ name: "Roman", email: "roman@example.com" });
    api = mockApi({ put: putMock, get: getMock });

    render(<SetupWizard api={api} onComplete={onComplete} backendUrl="http://localhost:3001" />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.change(screen.getByPlaceholderText(/paste your api key/i), {
      target: { value: "test-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
>>>>>>> 6a82158 (TC-1305: Build SetupWizard component (5-step guided API key onboarding))

    await waitFor(() => {
      expect(screen.getByText(/connected as roman/i)).toBeInTheDocument();
    });

<<<<<<< HEAD
<<<<<<< HEAD
    // Continue -> webhook step
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    return { putMock, getMock };
  }

  it("advances to webhook step after successful connection test", async () => {
    await navigateToWebhook();
    expect(screen.getByText(/webhook setup/i)).toBeInTheDocument();
  });

  it("displays webhook URL with backend URL", async () => {
    await navigateToWebhook();
    expect(screen.getByText("http://localhost:3001/api/webhooks/fireflies")).toBeInTheDocument();
  });

  it("has a copy button that copies to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    await navigateToWebhook();
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith("http://localhost:3001/api/webhooks/fireflies");
  });

  it("shows webhook secret input field", async () => {
    await navigateToWebhook();
    expect(screen.getByPlaceholderText(/16-32 characters/i)).toBeInTheDocument();
  });

  it("generates a random secret on button click", async () => {
    await navigateToWebhook();
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));

    const input = screen.getByPlaceholderText(/16-32 characters/i) as HTMLInputElement;
    expect(input.value.length).toBeGreaterThanOrEqual(16);
  });

  it("saves webhook secret via PUT /api/config/webhook-secret", async () => {
    const { putMock } = await navigateToWebhook();
    putMock.mockClear();
    putMock.mockResolvedValue({ ok: true });

    fireEvent.change(screen.getByPlaceholderText(/16-32 characters/i), {
      target: { value: "my-secret-value-1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save secret/i }));

    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/api/config/webhook-secret", {
        secret: "my-secret-value-1234",
      });
    });
  });

  it("shows success message after saving secret", async () => {
    const { putMock } = await navigateToWebhook();
    putMock.mockClear();
    putMock.mockResolvedValue({ ok: true });

    fireEvent.change(screen.getByPlaceholderText(/16-32 characters/i), {
      target: { value: "my-secret-value-1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save secret/i }));

    await waitFor(() => {
      expect(screen.getByText(/secret saved/i)).toBeInTheDocument();
    });
  });

  it("shows error message on failed secret save", async () => {
    const { putMock } = await navigateToWebhook();
    putMock.mockClear();
    putMock.mockRejectedValue(new Error("Store failed"));

    fireEvent.change(screen.getByPlaceholderText(/16-32 characters/i), {
      target: { value: "my-secret-value-1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save secret/i }));

    await waitFor(() => {
      expect(screen.getByText(/store failed/i)).toBeInTheDocument();
    });
  });

  it("skip button advances to done step", async () => {
    await navigateToWebhook();
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));

    expect(screen.getByText(/all set/i)).toBeInTheDocument();
  });

  it("shows Fireflies Dashboard instructions in ordered list", async () => {
    await navigateToWebhook();
    expect(screen.getByText(/fireflies dashboard/i)).toBeInTheDocument();
    // Instructions are in an <ol>
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
  });

  // Step 6: Done (navigates through webhook via Skip)
  it("shows done step with Start Syncing button after skipping webhook", async () => {
    await navigateToWebhook();
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));

    expect(screen.getByText(/all set/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start syncing/i })).toBeInTheDocument();
  });

  it("calls onComplete when Start Syncing is clicked", async () => {
    await navigateToWebhook();
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));
    fireEvent.click(screen.getByRole("button", { name: /start syncing/i }));
=======
    // Advance to done step
=======
    // Continue → webhook step
>>>>>>> 64c2d6d (TC-1315: Add Setup Wizard Step 3 for webhook configuration)
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    return { putMock, getMock };
  }

  it("advances to webhook step after successful connection test", async () => {
    await navigateToWebhook();
    expect(screen.getByText(/webhook setup/i)).toBeInTheDocument();
  });

  it("displays webhook URL with backend URL", async () => {
    await navigateToWebhook();
    expect(screen.getByText("http://localhost:3001/api/webhooks/fireflies")).toBeInTheDocument();
  });

  it("has a copy URL button that copies to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    await navigateToWebhook();
    fireEvent.click(screen.getByRole("button", { name: /copy url/i }));

    expect(writeText).toHaveBeenCalledWith("http://localhost:3001/api/webhooks/fireflies");
  });

  it("shows webhook secret input field", async () => {
    await navigateToWebhook();
    expect(screen.getByPlaceholderText(/webhook secret/i)).toBeInTheDocument();
  });

  it("generates a random secret on button click", async () => {
    await navigateToWebhook();
    fireEvent.click(screen.getByRole("button", { name: /generate random/i }));

    const input = screen.getByPlaceholderText(/webhook secret/i) as HTMLInputElement;
    expect(input.value.length).toBeGreaterThanOrEqual(16);
  });

  it("saves webhook secret via PUT /api/config/webhook-secret", async () => {
    const { putMock } = await navigateToWebhook();
    putMock.mockClear();
    putMock.mockResolvedValue({ ok: true });

    fireEvent.change(screen.getByPlaceholderText(/webhook secret/i), {
      target: { value: "my-secret-value-1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save secret/i }));

    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/api/config/webhook-secret", {
        secret: "my-secret-value-1234",
      });
    });
  });

  it("shows success message after saving secret", async () => {
    const { putMock } = await navigateToWebhook();
    putMock.mockClear();
    putMock.mockResolvedValue({ ok: true });

    fireEvent.change(screen.getByPlaceholderText(/webhook secret/i), {
      target: { value: "my-secret-value-1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save secret/i }));

    await waitFor(() => {
      expect(screen.getByText(/secret saved/i)).toBeInTheDocument();
    });
  });

  it("shows error message on failed secret save", async () => {
    const { putMock } = await navigateToWebhook();
    putMock.mockClear();
    putMock.mockRejectedValue(new Error("Store failed"));

    fireEvent.change(screen.getByPlaceholderText(/webhook secret/i), {
      target: { value: "my-secret-value-1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save secret/i }));

    await waitFor(() => {
      expect(screen.getByText(/store failed/i)).toBeInTheDocument();
    });
  });

  it("skip button advances to done step", async () => {
    await navigateToWebhook();
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));

    expect(screen.getByText(/you're all set/i)).toBeInTheDocument();
  });

  it("shows Fireflies dashboard instructions", async () => {
    await navigateToWebhook();
    expect(screen.getByText(/fireflies dashboard/i)).toBeInTheDocument();
  });

  // Step 6: Done (navigates through webhook via Skip)
  it("shows done step with Sync Now button after skipping webhook", async () => {
    await navigateToWebhook();
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));

    expect(screen.getByText(/you're all set/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sync now/i })).toBeInTheDocument();
  });

  it("calls onComplete when Sync Now is clicked", async () => {
    await navigateToWebhook();
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));
    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));
>>>>>>> 6a82158 (TC-1305: Build SetupWizard component (5-step guided API key onboarding))

    expect(onComplete).toHaveBeenCalledOnce();
  });

  // Back navigation
  it("supports Back button on instructions step", () => {
    render(<SetupWizard api={api} onComplete={onComplete} />);
<<<<<<< HEAD
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    expect(screen.getByText(/app\.fireflies\.ai/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByText(/connect fireflies/i)).toBeInTheDocument();
=======
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText(/app\.fireflies\.ai/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
<<<<<<< HEAD
    expect(
      screen.getByText(/connect your fireflies\.ai account/i),
    ).toBeInTheDocument();
>>>>>>> 6a82158 (TC-1305: Build SetupWizard component (5-step guided API key onboarding))
=======
    expect(screen.getByText(/connect your fireflies\.ai account/i)).toBeInTheDocument();
>>>>>>> 4ccbd94 (style: run Prettier on all conversation-sync files)
  });
});
