// A capped member may have one billable request in flight. Keep the permit
// until streaming finishes and its usage writes settle, so parallel calls
// cannot all pass a stale daily-usage check. This map survives dev HMR.
const permits = globalThis.__9routerMemberQuotaPermits ||= new Set();

export function acquireMemberPermit(workspaceId, userId) {
  const key = `${workspaceId}:${userId}`;
  if (permits.has(key)) return null;
  permits.add(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    permits.delete(key);
  };
}

export async function finishMemberUsage(context, release) {
  try {
    while (context.pendingUsageWrites?.size) {
      await Promise.allSettled([...context.pendingUsageWrites]);
    }
  } finally {
    release();
  }
}

export async function keepPermitUntilResponseEnds(response, context, release) {
  if (!response?.body) {
    await finishMemberUsage(context, release);
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          await finishMemberUsage(context, release);
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        await finishMemberUsage(context, release);
        controller.error(error);
      }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); }
      finally { await finishMemberUsage(context, release); }
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
