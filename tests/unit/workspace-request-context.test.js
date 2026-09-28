import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
const WORKSPACE_A = "10000000-0000-4000-8000-000000000001";
const WORKSPACE_B = "20000000-0000-4000-8000-000000000002";
let tempDir;
let db;
let runWithWorkspace;

function inWorkspace(workspaceId, callback) {
  return runWithWorkspace({ workspaceId }, callback);
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-workspace-context-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  ({ runWithWorkspace } = await import("@/lib/workspaces/requestContext.js"));
  await db.initDb();
  await db.updateSettings({ enableObservability: true, observabilityBatchSize: 100 });
});

afterAll(async () => {
  await db?.closeDb?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("workspace request context", () => {
  it("fails closed without workspace context", async () => {
    await expect(db.getUsageHistory()).rejects.toThrow("requireWorkspaceId");
    expect(() => db.trackPendingRequest("m", "p", "c", true)).toThrow("requireWorkspaceId");
  });

  it("isolates concurrent usage writes and reads", async () => {
    await Promise.all([
      inWorkspace(WORKSPACE_A, () => db.saveRequestUsage({
        timestamp: "2026-09-21T10:00:00.000Z",
        provider: "provider-a",
        model: "model-a",
        tokens: { prompt_tokens: 11, completion_tokens: 3 },
      })),
      inWorkspace(WORKSPACE_B, () => db.saveRequestUsage({
        timestamp: "2026-09-21T10:00:00.000Z",
        provider: "provider-b",
        model: "model-b",
        tokens: { prompt_tokens: 22, completion_tokens: 4 },
      })),
    ]);

    const [a, b] = await Promise.all([
      inWorkspace(WORKSPACE_A, () => db.getUsageHistory()),
      inWorkspace(WORKSPACE_B, () => db.getUsageHistory()),
    ]);
    expect(a.map((row) => row.provider)).toEqual(["provider-a"]);
    expect(b.map((row) => row.provider)).toEqual(["provider-b"]);
  });

  it("keeps pending state and emitted workspace ids separate", async () => {
    const events = [];
    const onPending = (event) => events.push(event.workspaceId);
    db.statsEmitter.on("pending", onPending);
    try {
      inWorkspace(WORKSPACE_A, () => db.trackPendingRequest("model-a", "provider-a", "conn-a", true));
      inWorkspace(WORKSPACE_B, () => db.trackPendingRequest("model-b", "provider-b", "conn-b", true));
      await new Promise((resolve) => setTimeout(resolve, 200));

      const [a, b] = await Promise.all([
        inWorkspace(WORKSPACE_A, () => db.getActiveRequests()),
        inWorkspace(WORKSPACE_B, () => db.getActiveRequests()),
      ]);
      expect(a.activeRequests).toEqual([
        expect.objectContaining({ model: "model-a", provider: "provider-a", count: 1 }),
      ]);
      expect(b.activeRequests).toEqual([
        expect.objectContaining({ model: "model-b", provider: "provider-b", count: 1 }),
      ]);
      expect(events).toEqual(expect.arrayContaining([WORKSPACE_A, WORKSPACE_B]));
    } finally {
      db.statsEmitter.off("pending", onPending);
      inWorkspace(WORKSPACE_A, () => db.trackPendingRequest("model-a", "provider-a", "conn-a", false));
      inWorkspace(WORKSPACE_B, () => db.trackPendingRequest("model-b", "provider-b", "conn-b", false));
    }
  });

  it("buffer flush uses workspace captured before await and timer", async () => {
    await Promise.all([
      inWorkspace(WORKSPACE_A, () => db.saveRequestDetail({ id: "detail-a", provider: "provider-a" })),
      inWorkspace(WORKSPACE_B, () => db.saveRequestDetail({ id: "detail-b", provider: "provider-b" })),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 5200));

    const [aOwn, aOther, bOwn, bOther] = await Promise.all([
      inWorkspace(WORKSPACE_A, () => db.getRequestDetailById("detail-a")),
      inWorkspace(WORKSPACE_A, () => db.getRequestDetailById("detail-b")),
      inWorkspace(WORKSPACE_B, () => db.getRequestDetailById("detail-b")),
      inWorkspace(WORKSPACE_B, () => db.getRequestDetailById("detail-a")),
    ]);
    expect(aOwn?.id).toBe("detail-a");
    expect(aOther).toBeNull();
    expect(bOwn?.id).toBe("detail-b");
    expect(bOther).toBeNull();
  }, 10000);
});
