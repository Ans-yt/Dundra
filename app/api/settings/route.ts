import { workspaceRequest } from "../../../lib/access";
import { failure, field, fields, RequestError } from "../../../lib/http";
import { effectiveModelKey, modelConnection, modelProfiles, removeModelProfile, saveModelConnection, selectModelProfile } from "../../../lib/store";
import { generate, listModels } from "../../../lib/provider";
import { defaultGeneration } from "../../../lib/generation";
import { normalizeThinkingLevel } from "../../../lib/thinking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

function readThinking(body: Record<string, unknown>) {
  if (body.thinkingEnabled === undefined) return undefined;
  if (typeof body.thinkingEnabled !== "boolean") throw new RequestError("Choose whether this model supports thinking.");
  const levels = [...new Set(field(body, "thinkingLevels", 512).split(",").map(normalizeThinkingLevel).filter(Boolean))];
  if (levels.length > 12 || levels.some((level) => !/^[a-z0-9_-]{1,32}$/.test(level))) {
    throw new RequestError("Enter up to 12 comma-separated thinking levels using letters, numbers, hyphens, or underscores.");
  }
  if (body.thinkingEnabled && !levels.length) throw new RequestError("Enter at least one thinking level supported by this model.");
  return { enabled: body.thinkingEnabled, levels };
}

export async function GET(request: Request) {
  try {
    workspaceRequest(request);
    if (new URL(request.url).searchParams.has("profiles")) return Response.json(modelProfiles(), { headers });
    const { endpoint, model, key } = modelConnection();
    return Response.json({ endpoint, model, hasKey: Boolean(key) }, { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    workspaceRequest(request);
    const body = await fields(request, 10_000);
    const profileId = field(body, "profileId", 64) || undefined;
    if (body.action === "activate" || body.action === "delete-profile") {
      if (!profileId || profileId === "new") throw new RequestError("Choose a saved model profile.");
      return Response.json(body.action === "activate" ? selectModelProfile(profileId) : removeModelProfile(profileId), { headers });
    }
    if (body.action === "reveal-key" && profileId && profileId !== "new") {
      return Response.json({ key: effectiveModelKey(field(body, "endpoint", 2048, true), undefined, profileId) }, { headers });
    }
    let endpoint: URL;
    try { endpoint = new URL(field(body, "endpoint", 2048, true)); }
    catch { throw new RequestError("Enter a full model endpoint URL."); }
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new RequestError("Use an HTTP or HTTPS base URL without credentials, query parameters, or a fragment.");
    }
    if (/\/chat\/completions\/?$/.test(endpoint.pathname)) {
      endpoint.pathname = endpoint.pathname.replace(/\/chat\/completions\/?$/, "");
    }
    const model = field(body, "model", 256);
    const key = body.apiKey === undefined ? undefined : field(body, "apiKey", 2048);
    if (key && !/^[\x21-\x7e]+$/.test(key)) throw new RequestError("The API key contains invalid characters.");
    const base = endpoint.toString().replace(/\/+$/, "");
    if (body.action === "models") {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
      const models = await listModels(base, effectiveModelKey(base, key, profileId), signal);
      return Response.json({ models }, { headers });
    }
    if (body.action === "test") {
      if (!model) throw new RequestError("Select a model or enter its exact name first.");
      const timeout = AbortSignal.timeout(30_000);
      const signal = AbortSignal.any([request.signal, timeout]);
      try {
        const thinking = { enabled: body.thinkingEnabled === true, levels: [] };
        const connection = { endpoint: base, model, key: effectiveModelKey(base, key, profileId), thinking };
        for await (const text of generate([{ role: "user", content: "Reply with just the word OK." }], signal, connection,
          { ...defaultGeneration, maxOutput: thinking.enabled ? defaultGeneration.maxOutput : 64 })) {
          if (text.trim()) return Response.json({ ok: true }, { headers });
        }
        throw new Error("The provider connected but the model returned no text.");
      } catch (error) {
        const message = timeout.aborted ? "The model did not reply within 30 seconds. The server may still be loading the model."
          : error instanceof Error && !(error instanceof SyntaxError) ? error.message : "The provider returned an invalid chat stream.";
        throw new RequestError(message, 502);
      }
    }
    if (body.action === "save-profile") {
      if (!profileId) throw new RequestError("Choose or create a model profile.");
      const name = field(body, "name", 60, true);
      const promptId = field(body, "promptId", 64);
      return Response.json(saveModelConnection(base, model, key, profileId, name, promptId, readThinking(body), body.presetName === undefined ? undefined : field(body, "presetName", 200)), { headers });
    }
    if (body.action !== undefined && body.action !== "save") throw new RequestError("Unknown model settings action.");
    return Response.json(saveModelConnection(base, model, key), { headers });
  } catch (error) {
    return failure(error);
  }
}
