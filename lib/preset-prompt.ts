import type { CardFields } from "./cards";
import type { ChatBonus } from "./chat-bonus";
import type { GenerationSettings } from "./generation";
import type { Preset } from "./tavern";
import { RequestError } from "./http";
import { activeLore } from "./lore-activation";
import { withEmbeddedLore } from "./lorebook";

type Entry = {role:"user"|"system"|"assistant";content:string;media?:string;example?:boolean};
export function arrangePreset(preset:Preset, base:Entry[], settings:GenerationSettings, card:CardFields, instructions:string, persona:string, memory:string, expand:(s:string)=>string, mode:string, worldRegex:(value:string)=>string = value=>value, examples:ChatBonus["examples"]="normal", linkedLore?: ReturnType<typeof activeLore>, embeddedLore?: ReturnType<typeof activeLore>, depthEntries: { content: string; depth: number }[] = []) {
  const orders = preset.prompt_order ?? [];
  const order = (orders.find(o=>o.character_id===100001) ?? orders.at(-1))?.order;
  if (!order) return base;
  const history = base.slice(1);
  const prefill = settings.prefill && history.at(-1)?.role==="assistant" ? history.pop() : undefined;
  const format=(key:string, name:string, value:string)=>value && typeof preset[key]==="string" && preset[key] ? String(preset[key]).replaceAll("{{"+name+"}}",value) : value;
  const markers:Record<string,string> = {charDescription:card.description || instructions, charPersonality:format("personality_format","personality",card.personality || ""),scenario:format("scenario_format","scenario",card.scenario || ""), dialogueExamples:card.mes_example || "",personaDescription:persona};
  const embedded = embeddedLore ?? activeLore(withEmbeddedLore(card.character_book, []), history);
  for (const [position, marker] of [["before_char", "worldInfoBefore"], ["after_char", "worldInfoAfter"]] as const) {
    const entries = new Set([...embedded[position], ...(linkedLore?.[position] ?? [])]);
    markers[marker] = [...entries].map(content => {
      const text = worldRegex(expand(content));
      return typeof preset.wi_format === "string" ? preset.wi_format.replaceAll("{0}", text) : text;
    }).join("\n");
  }
  const prompts = new Map<string, NonNullable<Preset["prompts"]>[number]>();
  for (const prompt of preset.prompts ?? []) {
    if (!prompts.has(prompt.identifier)) prompts.set(prompt.identifier, prompt);
  }
  const trigger = mode === "send" ? "normal" : mode === "alternate" ? "swipe" : mode;
  const result: Entry[] = [];
  const inserts:{entry:Entry;depth:number;order:number}[] = depthEntries.map(({content, depth}) => ({ entry: { role: "system", content }, depth, order: 100 }));
  let examplesEntry: Entry | undefined;
  let historyStart = 0;
  let historyEnd = 0;
  const fallbackLore = ([["before_char", "worldInfoBefore"], ["after_char", "worldInfoAfter"]] as const)
    .filter(([position, marker]) => linkedLore?.[position].length && !order.some(row => row.identifier === marker))
    .map(([position]) => ({ role: "system" as const, content: linkedLore![position].map(text => worldRegex(expand(text))).join("\n") }));
  result.push(...fallbackLore);
  for (const o of order) {
    if (!o.enabled) continue;
    if (o.identifier === "dialogueExamples" && examples === "strip") continue;
    const p = prompts.get(o.identifier);
    if (p?.injection_trigger?.length && !p.injection_trigger.includes(trigger)) continue;
    if (o.identifier==="chatHistory") {
      if (typeof preset.new_chat_prompt==="string" && preset.new_chat_prompt) result.push({role:"system",content:expand(preset.new_chat_prompt)});
      historyStart = result.length;
      result.push(...history); historyEnd=result.length; continue;
    }
    const cardOverride=o.identifier==="main"?card.system_prompt:o.identifier==="jailbreak"?card.post_history_instructions:"";
    const content=markers[o.identifier] ?? (cardOverride ? cardOverride.replace(/\{\{original\}\}/gi,()=>p?.content ?? "") : p?.content ?? "");
    if (!content) continue;
    const entry:Entry={role:p?.role==="user" || p?.role==="assistant"?p.role:"system",content:expand(content)};
    if (o.identifier === "dialogueExamples") { examplesEntry = entry; entry.example = true; }
    if (p?.injection_position===1) inserts.push({entry,depth:p.injection_depth??4,order:p.injection_order??100});
    else result.push(entry);
  }
  const roleOrder = { user: 0, assistant: 1, system: 2 };
  const boundary = (depth: number) => Math.max(historyStart, historyEnd - depth);
  // Insert from the end so offsets stay relative to the chat history.
  for (const item of inserts.reverse().sort((a, b) => boundary(b.depth) - boundary(a.depth)
    || roleOrder[b.entry.role] - roleOrder[a.entry.role] || b.order - a.order)) {
    result.splice(boundary(item.depth), 0, item.entry);
  }
  if (memory) result.unshift({role:"system",content:"Chat summary:\n"+expand(memory)});
  const mandatory = history.at(-1);
  if (mode === "send" && mandatory?.role === "user" && !result.includes(mandatory)) result.push(mandatory);
  if (prefill) result.push(prefill);
  if (!Number.isFinite(settings.contextSize)) return result;

  const costs = new Map<Entry, number>();
  let used = 3;
  for (const entry of result) {
    const cost = costs.get(entry) ?? 4 + Math.ceil(Buffer.byteLength(entry.content) / 4);
    costs.set(entry, cost);
    used += cost;
  }
  if (used <= settings.contextSize) return result;

  const removed = new Set<Entry>();
  if (examplesEntry && examples === "normal" && costs.has(examplesEntry)) {
    removed.add(examplesEntry);
    used -= costs.get(examplesEntry)!;
  }
  for (const entry of history) {
    if (used <= settings.contextSize || entry === mandatory) break;
    const cost = costs.get(entry);
    if (cost !== undefined) {
      removed.add(entry);
      used -= cost;
    }
  }
  if (used > settings.contextSize) throw new RequestError("This preset and conversation exceed the selected context size.");
  return result.filter(entry => !removed.delete(entry));
}
