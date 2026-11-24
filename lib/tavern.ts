import { generationRanges, type GenerationSettings } from "./generation";

export type Rule = {
  scriptName: string; findRegex: string; replaceString: string; placement: number[]; disabled?: boolean;
  trimStrings?: string[]; markdownOnly?: boolean; promptOnly?: boolean; runOnEdit?: boolean;
  substituteRegex?: number; minDepth?: number | null; maxDepth?: number | null;
};
export type PresetPrompt = {
  identifier: string; name?: string; role?: string; content?: string; marker?: boolean;
  injection_position?: number; injection_depth?: number; injection_order?: number; injection_trigger?: string[];
};
export type Preset = Record<string, unknown> & {
  prompts?: PresetPrompt[];
  prompt_order?: {character_id?: number; order: {identifier: string; enabled: boolean}[]}[];
};
export type SavedPreset = { name: string; preset: Preset; bundledRegex?: boolean };
export type Advanced = {enabled: boolean; regex: boolean; presets: boolean; audio: boolean; video: boolean;
  rules: Rule[]; library: SavedPreset[]; selected: string};
export const defaults: Advanced = {enabled:false, regex:false, presets:false, audio:false, video:false, rules:[], library:[], selected:""};

export function importRules(data: unknown): Rule[] {
  const list = Array.isArray(data) ? data : [data];
  for (const r of list) {
    if (!r || typeof r.scriptName !== "string" || typeof r.findRegex !== "string" || !r.findRegex || typeof r.replaceString !== "string" || !Array.isArray(r.placement) || !r.placement.every(Number.isInteger) || (r.trimStrings && (!Array.isArray(r.trimStrings) || !r.trimStrings.every((x:unknown)=>typeof x==="string")))) throw Error("Choose a SillyTavern regex script export.");
    const parsed = /^\/([\s\S]*)\/([a-z]*)$/.exec(r.findRegex);
    new RegExp(parsed?.[1] ?? r.findRegex, parsed?.[2] ?? "");
  }
  return list;
}
export function importPreset(data: Preset) {
  if (!data || typeof data !== "object" || !("prompts" in data || "openai_max_tokens" in data || "prompt_order" in data)) throw Error("Choose a SillyTavern Chat Completion preset JSON.");
  if (data.prompts && (!Array.isArray(data.prompts) || data.prompts.some(p => !p || typeof p.identifier !== "string" || (p.content != null && typeof p.content !== "string")))) throw Error("Invalid prompt definition.");
  if (data.prompt_order && (!Array.isArray(data.prompt_order) || data.prompt_order.some(p => !Array.isArray(p?.order) || p.order.some(o => typeof o?.identifier !== "string")))) throw Error("Invalid prompt order.");
  presetRegexRules(data);
  return data;
}

export function presetRegexRules(preset: Preset): Rule[] {
  const scripts = (preset.extensions as { regex_scripts?: unknown } | undefined)?.regex_scripts;
  return scripts == null ? [] : importRules(scripts);
}

export function withPresetRegex(preset: Preset, scripts: Rule[]): Preset {
  return { ...preset, extensions: { ...(preset.extensions as object), regex_scripts: scripts } };
}
export function presetSettings(p: Preset): Partial<GenerationSettings> {
  const result: Partial<GenerationSettings> = {};
  const keys = {maxOutput:"openai_max_tokens",contextSize:"openai_max_context",temperature:"temp_openai",topP:"top_p_openai",topK:"top_k",frequencyPenalty:"freq_pen_openai",repetitionPenalty:"repetition_penalty"} as const;
  for (const k of Object.keys(keys) as (keyof typeof keys)[]) {
    const modern = {temperature:"temperature",frequencyPenalty:"frequency_penalty",topP:"top_p"};
    const v = (k in modern ? p[modern[k as keyof typeof modern]] : undefined) ?? p[keys[k]];
    if (typeof v === "number" && Number.isFinite(v)) result[k] = Math.min(generationRanges[k].max,Math.max(generationRanges[k].min,v));
  }
  if (typeof p.assistant_prefill === "string") result.prefill = p.assistant_prefill;
  return result;
}

// Self-contained so the server can run imported patterns with a time limit.
export function transform(text: string, rules: Rule[], placement: number, stage: "display"|"prompt"|"save", depth: number, user: string, char: string, edit = false) {
  const expand = (s:string, escape = false) => s.replace(/\{\{(char|user)\}\}/gi, (_, key:string) => {
    const name = key.toLowerCase() === "char" ? char : user;
    return escape ? name.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&") : name;
  });
  if (!text) return text;
  for (const r of rules) {
    if (r.disabled || !r.placement.includes(placement) || (edit && !r.runOnEdit)) continue;
    if (stage === "save" ? r.markdownOnly || r.promptOnly : stage === "display" ? !r.markdownOnly : !r.promptOnly) continue;
    if (depth >= 0 && ((r.minDepth != null && depth < r.minDepth) || (r.maxDepth != null && r.maxDepth >= 0 && depth > r.maxDepth))) continue;
    const expr = r.substituteRegex ? expand(r.findRegex,r.substituteRegex === 2) : r.findRegex;
    const parts = /^\/([\s\S]*)\/([a-z]*)$/.exec(expr);
    const re = new RegExp(parts?.[1] ?? expr, parts?.[2] ?? "");
    text = text.replace(re, (...args) => {
      const groups = typeof args.at(-1) === "object" ? args.at(-1) : {};
      const captures = args.slice(0, typeof args.at(-1) === "object" ? -3 : -2);
      const trim = (s:string) => (r.trimStrings ?? []).reduce((a,b)=>a.split(expand(b)).join(""),s);
      return expand(r.replaceString.replace(/\{\{match\}\}|\$(\d+)|\$<([^>]+)>/gi,(_match, n, key) =>
        trim(String(key ? groups[key] ?? "" : captures[n === undefined ? 0 : Number(n)] ?? ""))));
    });
    if (text.length > 2_000_000) throw Error("Regex output exceeded the message limit.");
  }
  return text;
}
