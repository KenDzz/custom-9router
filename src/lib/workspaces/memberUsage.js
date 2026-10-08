// Flush this request's usage before its response finishes. Each request has
// its own pending writes; overlapping requests never wait on one another.
export async function waitForMemberUsage(context) {
  while (context.pendingUsageWrites?.size) {
    await Promise.allSettled([...context.pendingUsageWrites]);
  }
}

export async function completeMemberResponse(response, context) {
  if (!response?.body) {
    await waitForMemberUsage(context);
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          await waitForMemberUsage(context);
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        await waitForMemberUsage(context);
        controller.error(error);
      }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); }
      finally { await waitForMemberUsage(context); }
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

// Some upstream JSON endpoints (notably embeddings) report tokens without
// using the chat usage collector. Keep that adapter at the custom boundary.
export async function recordUntrackedMemberUsage(request, response, context) {
  if (!context.trackMemberUsage || context.usageRecorded || request.method !== "POST" || !response?.ok
    || !response.headers.get("content-type")?.includes("application/json")) return;
  let data;
  try { data = await response.clone().json(); } catch { return; }
  const usage = data?.usage;
  if (!usage || typeof usage !== "object") return;
  const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? (usage.total_tokens !== undefined ? Number(usage.total_tokens) - output : 0));
  if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0 || !(input + output)) return;
  const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
  const { extractApiKey } = await import("@/dashboardGuard.js");
  await saveRequestUsage({
    model: typeof data.model === "string" ? data.model : "unknown",
    provider: "unknown",
    apiKey: extractApiKey(request),
    endpoint: request.nextUrl?.pathname || (request.url ? new URL(request.url).pathname : null),
    tokens: { ...usage, prompt_tokens: input, completion_tokens: output },
  });
}
