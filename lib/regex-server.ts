import { Script } from "node:vm";
import { importRules, presetRegexRules, transform, type Advanced } from "./tavern";
import { RequestError } from "./http";

export function withScopedRules(cfg:Advanced,cardRules?:unknown[]): Advanced {
  if (!cfg.enabled || !cfg.regex) return cfg;
  const selected = cfg.presets ? cfg.library.find(p => p.name === cfg.selected) : undefined;
  try {
    const embedded = [
      ...(cardRules ? importRules(cardRules) : []),
      ...(selected && selected.bundledRegex !== false ? presetRegexRules(selected.preset) : []),
    ];
    return embedded.length ? { ...cfg, rules: [...cfg.rules, ...embedded] } : cfg;
  } catch {
    throw new RequestError("An embedded regex script is invalid. Disable regex or replace the imported file.");
  }
}
const evaluator = new Script("(" + transform.toString() + ")(...args)");
export function applyRules(cfg: Advanced, text: string, placement: number, stage: "display"|"prompt"|"save", depth: number, user:string, char:string, edit=false): string {
  if (!cfg.enabled || !cfg.regex || !cfg.rules.length) return text;
  try { return evaluator.runInNewContext({args:[text,cfg.rules,placement,stage,depth,user,char,edit]}, {timeout:80}); }
  catch {throw new RequestError("A regex rule failed or took too long. Review the rules in Advanced.");}
}
