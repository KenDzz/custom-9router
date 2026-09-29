import { getModelAccessSnapshot } from "@/lib/db/repos/modelAccessRepo.js";

function deny(message = "This model or combo is not allowed for this account") {
  return Response.json({ error: { message, type: "permission_error", code: "model_not_allowed" }, code: "model_not_allowed" },
    { status: 403, headers: { "Access-Control-Allow-Origin": "*" } });
}

function requestPath(request) {
  const raw = request.nextUrl?.pathname || (request.url ? new URL(request.url).pathname : "");
  // Decode static route names without splitting escaped slashes inside a
  // Gemini model segment, and don't depend on Next's trailing-slash redirect.
  try { return decodeURI(raw).replace(/\/+$/, ""); } catch { return raw; }
}

export async function authorizeModelRequest(request, context) {
  const access = await getModelAccessSnapshot(context.userId);
  if (!access.restricted || request.method !== "POST") return { access };
  const path = requestPath(request);
  let model;
  let service = null;
  try {
    // Gemini chooses the target from the URL, never the body's `model` field.
    const gemini = path.match(/\/(?:api\/)?v1beta\/models\/(.+)$/);
    if (gemini) {
      const parts = gemini[1].split("/").map(decodeURIComponent);
      const stripAction = (value) => value.replace(":streamGenerateContent", "").replace(":generateContent", "");
      model = parts.length >= 2 ? `${parts[0]}/${stripAction(parts[1])}` : stripAction(parts[0]);
    } else if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      // The upstream video proxy forwards multipart bytes using its default
      // provider, ignoring the form's model. Never authorize that as a target.
      if (/\/videos\//.test(path)) return { access, error: deny("Restricted video requests require JSON with an explicit provider/model") };
      const body = await request.clone().formData();
      model = body.get("model");
    } else {
      const body = await request.clone().json();
      model = /\/(?:web\/fetch|search)$/.test(path) ? body.provider || body.model : body.model;
      service = /\/web\/fetch$/.test(path) ? "fetch" : /\/search$/.test(path) ? "search" : null;
    }
  } catch {
    return { access, error: Response.json({ error: "Cannot read the model from this request" }, { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }) };
  }
  // No target/default-provider fallback may bypass a configured allow-list.
  if (/\/videos\//.test(path) && (typeof model !== "string" || !model.includes("/"))) {
    return { access, error: deny("Restricted video requests require an explicit provider/model") };
  }
  return { access, error: await access.allows(model, service) ? null : deny() };
}

export async function filterModelCatalog(request, response, access) {
  if (!access.restricted || request.method !== "GET" || !response?.ok) return response;
  const path = requestPath(request);
  if (!/\/(?:api\/)?v1\/models(?:\/[^/]+)?\/?$/.test(path)) return response;
  const payload = await response.clone().json();
  if (!Array.isArray(payload.data)) return response;
  const allowed = await Promise.all(payload.data.map((model) => access.allows(model.id)));
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("cache-control", "no-store");
  return Response.json({ ...payload, data: payload.data.filter((_, index) => allowed[index]) }, { status: response.status, headers });
}
