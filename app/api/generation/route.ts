import { workspaceRequest } from "../../../lib/access";
import { generationRanges, type GenerationNumber, type GenerationSettings } from "../../../lib/generation";
import { failure, field, fields, RequestError } from "../../../lib/http";
import { changeGeneration, generationConfig } from "../../../lib/store";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

function parseSettings(body: Record<string, unknown>): GenerationSettings {
  const numeric = Object.keys(generationRanges) as GenerationNumber[];
  const numbers = Object.fromEntries(numeric.map((key) => {
    const { min, max, step } = generationRanges[key];
    const value = body[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (step === 1 && !Number.isInteger(value))) {
      throw new RequestError("Invalid " + key + ". Use a value from " + min + " to " + max + ".");
    }
    return [key, value];
  })) as Record<GenerationNumber, number>;
  const prefill = body.prefill;
  if (typeof prefill !== "string" || prefill.length > 2000) throw new RequestError("Prefill must be at most 2,000 characters.");
  return { ...numbers, globalPrompt: field(body, "globalPrompt", 30_000), prefill: prefill.trim() ? prefill : "" };
}

export async function GET(request: Request) {
  try {
    workspaceRequest(request);
    return Response.json(generationConfig(), { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    workspaceRequest(request);
    const body = await fields(request);
    if (body.action === "save-prompt" || body.action === "delete-prompt" || body.action === "use-prompt") {
      const id = field(body, "id", 64);
      const isSave = body.action === "save-prompt";
      const name = isSave ? field(body, "name", 60, true) : "";
      const content = isSave ? field(body, "content", 30_000, true) : "";
      const config = changeGeneration((saved) => {
        const prior = saved.prompts.find((prompt) => prompt.id === id);
        if ((id || !isSave) && !prior) throw new RequestError("Prompt not found.", 404);
        if (body.action === "use-prompt") return { ...saved, current: { ...saved.current, globalPrompt: prior!.content } };
        if (body.action === "delete-prompt") return { ...saved, prompts: saved.prompts.filter((prompt) => prompt.id !== id) };
        if (saved.prompts.some((prompt) => prompt.id !== id && prompt.name.toLowerCase() === name.toLowerCase())) {
          throw new RequestError("A prompt with that name already exists.", 409);
        }
        if (!id && saved.prompts.length >= 30) throw new RequestError("You can save up to 30 prompts.");
        const prompt = { id: prior?.id || crypto.randomUUID(), name, content };
        return { ...saved, prompts: prior ? saved.prompts.map((item) => item.id === id ? prompt : item) : [...saved.prompts, prompt] };
      });
      return Response.json(config, { headers });
    }
    if (!["save", "preset", "delete"].includes(String(body.action))) throw new RequestError("Unknown generation settings action.");
    const name = body.action === "save" ? "" : field(body, "name", 60, true);
    const settings = body.action === "delete" ? null : parseSettings(body);
    const config = changeGeneration((saved) => {
      const match = saved.presets.findIndex((preset) => preset.name.toLowerCase() === name.toLowerCase());
      if (!settings) return { ...saved, presets: saved.presets.filter((_, index) => index !== match) };
      if (body.action === "save") return { ...saved, current: settings };
      const presets = [...saved.presets];
      if (match >= 0) presets[match] = { name, settings };
      else {
        if (presets.length >= 30) throw new RequestError("You can save up to 30 presets.");
        presets.push({ name, settings });
      }
      return { ...saved, current: settings, presets };
    });
    return Response.json(config, { headers });
  } catch (error) { return failure(error); }
}
