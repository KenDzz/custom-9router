import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withDashboardWorkspace: vi.fn(),
  initTranslators: vi.fn(),
  handleChat: vi.fn(),
  handleEmbeddings: vi.fn(),
  handleImageGeneration: vi.fn(),
  handleStt: vi.fn(),
}));

vi.mock("@/lib/workspaces/requestContext.js", () => ({
  withDashboardWorkspace: mocks.withDashboardWorkspace,
}));
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: mocks.initTranslators }));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("@/sse/handlers/embeddings.js", () => ({ handleEmbeddings: mocks.handleEmbeddings }));
vi.mock("@/sse/handlers/imageGeneration.js", () => ({ handleImageGeneration: mocks.handleImageGeneration }));
vi.mock("@/sse/handlers/stt.js", () => ({ handleStt: mocks.handleStt }));
vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return Response.json(body, { status: init.status || 200 });
    },
  },
}));

const originalFetch = global.fetch;

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
}

async function testModel(model, kind) {
  const { POST } = await import("../../src/app/api/models/test/route.js");
  const request = new Request("http://localhost/api/models/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, kind }),
  });
  const response = await POST(request);
  return response.json();
}

describe("dashboard model tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withDashboardWorkspace.mockImplementation((_request, _role, callback) => callback());
    global.fetch = vi.fn(() => { throw new Error("A dashboard probe must not make an HTTP self-request"); });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("tests a chat model in process without an API key", async () => {
    mocks.handleChat.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "ok" } }] }));

    const result = await testModel("cc/claude-sonnet-5-5", "llm");

    expect(result.ok).toBe(true);
    expect(mocks.withDashboardWorkspace.mock.calls[0][1]).toBe("owner");
    const [probeRequest, clientRawRequest, options] = mocks.handleChat.mock.calls[0];
    expect(new URL(probeRequest.url).pathname).toBe("/api/v1/chat/completions");
    expect(probeRequest.headers.has("Authorization")).toBe(false);
    expect(await probeRequest.json()).toMatchObject({ model: "cc/claude-sonnet-5-5" });
    expect(clientRawRequest).toBeNull();
    expect(options).toEqual({ trustedDashboardProbe: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("routes image models to the image handler", async () => {
    mocks.handleImageGeneration.mockResolvedValue(jsonResponse({ data: [{ b64_json: "abc" }] }));

    const result = await testModel("hf/black-forest-labs/FLUX.1-schnell", "image");

    expect(result.ok).toBe(true);
    const [request, options] = mocks.handleImageGeneration.mock.calls[0];
    expect(new URL(request.url).pathname).toBe("/api/v1/images/generations");
    expect(await request.json()).toEqual({ model: "hf/black-forest-labs/FLUX.1-schnell", prompt: "test" });
    expect(options).toEqual({ trustedDashboardProbe: true });
  });

  it("routes embedding models to the embedding handler", async () => {
    mocks.handleEmbeddings.mockResolvedValue(jsonResponse({ data: [{ embedding: [0.1, 0.2] }] }));

    const result = await testModel("voyage/voyage-3-large", "embedding");

    expect(result.ok).toBe(true);
    const [request, options] = mocks.handleEmbeddings.mock.calls[0];
    expect(new URL(request.url).pathname).toBe("/api/v1/embeddings");
    expect(await request.json()).toEqual({ model: "voyage/voyage-3-large", input: "test" });
    expect(options).toEqual({ trustedDashboardProbe: true });
  });

  it("reports empty embedding responses", async () => {
    mocks.handleEmbeddings.mockResolvedValue(jsonResponse({ data: [{ embedding: null }] }));

    const result = await testModel("voyage/voyage-3-large", "embedding");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Provider returned no embedding data");
  });

  it("routes speech transcription models to the STT handler", async () => {
    mocks.handleStt.mockResolvedValue(jsonResponse({ text: "test" }));

    const result = await testModel("hf/openai/whisper-small", "stt");

    expect(result.ok).toBe(true);
    const [request, options] = mocks.handleStt.mock.calls[0];
    expect(new URL(request.url).pathname).toBe("/api/v1/audio/transcriptions");
    expect((await request.formData()).get("model")).toBe("hf/openai/whisper-small");
    expect(options).toEqual({ trustedDashboardProbe: true });
  });

  it("preserves upstream HTTP errors", async () => {
    mocks.handleEmbeddings.mockResolvedValue(jsonResponse({ error: { message: "bad upstream" } }, 502));

    const result = await testModel("voyage/voyage-3-large", "embedding");

    expect(result).toMatchObject({ ok: false, status: 502, error: "HTTP 502: bad upstream" });
  });
});
