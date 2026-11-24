import { workspaceRequest } from "../../../lib/access";
import { advancedConfig, saveAdvanced } from "../../../lib/store";
import { importRules, importPreset } from "../../../lib/tavern";
import { applyRules } from "../../../lib/regex-server";
import { fields, failure, RequestError } from "../../../lib/http";
export const dynamic = "force-dynamic";
export async function GET(req:Request) {
  try { workspaceRequest(req); return Response.json(advancedConfig(), {headers:{"Cache-Control":"no-store"}}); } catch(e) {return failure(e);}
}
export async function POST(req:Request) {
  try {
    workspaceRequest(req);
    const cfg = await fields(req, 3000000);
    const current = advancedConfig();
    try {
      if (cfg.action === "preview-regex") {
        if (!current.enabled || !current.regex) throw Error("Enable regex scripts to test a rule.");
        if (typeof cfg.text !== "string" || cfg.text.length > 40_000) throw Error("Enter up to 40,000 characters to test.");
        const [rule] = importRules(cfg.rule);
        if (!rule) throw Error("Enter a regex script.");
        const sample = { ...rule, disabled: false, placement: [1], promptOnly: false, markdownOnly: false };
        const result = applyRules({ ...current, rules: [sample] }, cfg.text, 1, "save", -1, "You", "Character");
        return Response.json({ text: result });
      }
      for (const key of ["enabled","regex","presets","audio","video"] as const) if (typeof cfg[key] === "boolean") current[key] = cfg[key];
      if (cfg.rules !== undefined) current.rules = importRules(cfg.rules);
      if (cfg.library !== undefined) {
        if (!Array.isArray(cfg.library)) throw Error("Invalid preset list.");
        current.library = cfg.library.map(p => {
          if (typeof p?.name !== "string" || !p.name.trim()) throw Error("Name the preset.");
          return { name: p.name, preset: importPreset(p.preset),
            ...(typeof p.bundledRegex === "boolean" && { bundledRegex: p.bundledRegex }) };
        });
      }
      if (typeof cfg.selected === "string") current.selected = cfg.selected;
      if (!current.library.some(p=>p.name===current.selected)) current.selected = "";
    } catch(e) {throw new RequestError(e instanceof Error ? e.message : "Invalid advanced settings.");}
    saveAdvanced(current); return Response.json(current);
  } catch(e) {return failure(e);}
}
