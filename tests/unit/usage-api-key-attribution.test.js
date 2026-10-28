import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
let db;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-api-key-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const rawDb = await import("@/lib/db/index.js");
  const { runWithWorkspace } = await import("@/lib/workspaces/requestContext.js");
  const { DEFAULT_WORKSPACE_ID: testWorkspaceId } = await import("@/lib/workspaces/constants.js");
  db = Object.fromEntries(Object.entries(rawDb).map(([key, value]) => [key, typeof value === "function"
    ? (...args) => runWithWorkspace({ workspaceId: testWorkspaceId }, () => value(...args)) : value]));
  await db.initDb();
});

afterEach(() => {
  delete process.env.DATA_DIR;
});

describe("Usage stats API key attribution", () => {
  it("keeps API keys with the same masked prefix in separate buckets", async () => {
    const apiKeyA = "sk-machine-aaaaaa-11111111";
    const apiKeyB = "sk-machine-bbbbbb-22222222";

    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      connectionId: "c1",
      apiKey: apiKeyA,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      endpoint: "/v1/chat",
      status: "ok",
    });

    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      connectionId: "c1",
      apiKey: apiKeyB,
      tokens: { prompt_tokens: 20, completion_tokens: 10 },
      endpoint: "/v1/chat",
      status: "ok",
    });

    const stats = await db.getUsageStats("24h");
    const apiKeyEntries = Object.values(stats.byApiKey);

    expect(apiKeyEntries).toHaveLength(2);

    expect(
      apiKeyEntries
        .map((entry) => entry.promptTokens)
        .sort((a, b) => a - b)
    ).toEqual([10, 20]);
  });
});
