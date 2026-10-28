import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

// No test may fall back to the user's installed application database.
const originalDataDir = process.env.DATA_DIR;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-suite-"));
process.env.DATA_DIR = dataDir;
afterAll(() => {
  const state = global._dbAdapter;
  try { state?.instance?.close?.(); } catch {}
  if (state) { state.instance = null; state.initPromise = null; }
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});
