import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const API_ROOT = path.resolve(import.meta.dirname, "../../src/app/api");
const SCOPED_CALL = /\b(?:get|create|update|delete|clear|validate|set|add|enable|disable)(?:ProviderConnections?|ProviderNodes?|ProxyPools?|ApiKeys?|Combos?|CustomModels?|ModelAliases?|DisabledModels?|MitmAlias(?:All)?|UsageHistory|UsageStats|ChartData|RequestDetails?)\b/;
const WORKSPACE_BOUNDARY = /\b(?:withDashboardWorkspace|withDashboardOrLlmWorkspace|withLlmWorkspace|runWithWorkspace)\b/;

function routeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(absolute);
    return entry.name === "route.js" ? [absolute] : [];
  });
}

describe("workspace route boundary coverage", () => {
  it("wraps every API route that calls a workspace-scoped repository", () => {
    const missing = routeFiles(API_ROOT)
      .filter((file) => {
        const source = fs.readFileSync(file, "utf8");
        return SCOPED_CALL.test(source) && !WORKSPACE_BOUNDARY.test(source);
      })
      .map((file) => path.relative(API_ROOT, file).replaceAll("\\", "/"));

    expect(missing).toEqual([]);
  });

  it("keeps every stateful LLM entry route behind the API-key workspace boundary", () => {
    const llmRoots = [path.join(API_ROOT, "v1"), path.join(API_ROOT, "v1beta")];
    const missing = llmRoots
      .flatMap(routeFiles)
      .filter((file) => {
        const source = fs.readFileSync(file, "utf8");
        return SCOPED_CALL.test(source) && !/\bwithLlmWorkspace\b/.test(source);
      })
      .map((file) => path.relative(API_ROOT, file).replaceAll("\\", "/"));

    expect(missing).toEqual([]);
  });
});
