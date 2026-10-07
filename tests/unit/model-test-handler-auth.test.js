import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", async (importOriginal) => ({
  ...await importOriginal(),
  getSettings: async () => ({ requireApiKey: true }),
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

function requestWithoutKey() {
  return new Request("http://localhost/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

describe("dashboard probe API key boundary", () => {
  it("still rejects ordinary keyless chat requests", async () => {
    const response = await handleChat(requestWithoutKey());

    expect(response.status).toBe(401);
  });

  it("lets the trusted in-process probe reach model validation without a key", async () => {
    const response = await handleChat(requestWithoutKey(), null, { trustedDashboardProbe: true });

    expect(response.status).toBe(400);
  });
});
