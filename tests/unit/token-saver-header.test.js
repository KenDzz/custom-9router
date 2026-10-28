import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), rtk: vi.fn(() => null), headroom: vi.fn(async () => null), caveman: vi.fn(), ponytail: vi.fn(), pxpipe: vi.fn(async () => ({ body: null, summary: {} })) }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: true, execute: mocks.execute }) }));
vi.mock("open-sse/utils/requestLogger.js", () => ({ createRequestLogger: async () => ({
  logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(), logError: vi.fn(),
}) }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), appendRequestLog: async () => {}, saveRequestDetail: async () => {} }));
vi.mock("open-sse/rtk/index.js", () => ({ compressMessages: mocks.rtk, formatRtkLog: () => "" }));
vi.mock("open-sse/rtk/headroom.js", async (original) => ({ ...await original(), compressWithHeadroom: mocks.headroom }));
vi.mock("open-sse/rtk/caveman.js", () => ({ injectCaveman: mocks.caveman }));
vi.mock("open-sse/rtk/ponytail.js", () => ({ injectPonytail: mocks.ponytail }));
vi.mock("open-sse/rtk/pxpipe.js", () => ({ compressWithPxpipe: mocks.pxpipe }));

const { handleChatCore } = await import("open-sse/handlers/chatCore.js");
beforeEach(() => {
  vi.clearAllMocks();
  // Stop at dispatch: these assertions cover preprocessing without an upstream call.
  mocks.execute.mockRejectedValue(new Error("test dispatch"));
});
describe("Token Saver per-request opt-out", () => {
  it.each([undefined, "off", "OFF"])("gates all five features with header %s", async (header) => {
    const body = { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "hello" }] };
    await handleChatCore({
      body, modelInfo: { provider: "openai", model: "gpt-4o" }, credentials: { apiKey: "test" },
      connectionId: "test", log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: header ? { "x-9router-token-saver": header } : {} },
      rtkEnabled: true, headroomEnabled: true, headroomUrl: "http://localhost:8787", cavemanEnabled: true, cavemanLevel: "full",
      ponytailEnabled: true, ponytailLevel: "full", pxpipeEnabled: true,
    });
    const enabled = header === undefined;
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.rtk).toHaveBeenCalledWith(expect.any(Object), enabled);
    expect(mocks.headroom).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ enabled }));
    for (const mock of [mocks.caveman, mocks.ponytail, mocks.pxpipe]) expect(mock).toHaveBeenCalledTimes(enabled ? 1 : 0);
  });
});
