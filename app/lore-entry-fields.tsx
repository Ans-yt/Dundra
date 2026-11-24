"use client";

import { useMemo } from "react";
import { TokenCount, useTokenCounter } from "./token-count";
import type { LoreEntry } from "../lib/lorebook";

type Props = { entry: LoreEntry; depth: number; change: (patch: Partial<LoreEntry>) => void };
type Flag = "enabled" | "constant" | "selective" | "case_sensitive" | "match_whole_words" | "useGroupScoring" |
  "groupOverride" | "excludeRecursion" | "preventRecursion" | "ignoreBudget" | "excludeCharacters";
const triggers = ["normal", "continue", "swipe", "regenerate", "impersonate", "quiet"];

export function LoreEntryFields({ entry, depth, change }: Props) {
  const counter = useTokenCounter();
  const tokens = useMemo(() => counter?.(entry.content) ?? null, [counter, entry.content]);
  function toggle(key: Flag, label: string) {
    return <label className="lore-check"><input type="checkbox" checked={!!entry[key]} onChange={e => change({ [key]: e.target.checked })}/>{label}</label>;
  }
  function number(key: "depth" | "probability" | "insertion_order" | "scanDepth" | "sticky" | "cooldown" | "delay" | "groupWeight", label: string, fallback: number, min = 0, max = 10000) {
    return <label>{label}<input type="number" min={min} max={max} placeholder={String(fallback)} value={entry[key] ?? ""}
      onChange={e => change({ [key]: e.target.value === "" ? key === "scanDepth" ? undefined : fallback : Math.min(max, Math.max(min, Math.trunc(e.target.valueAsNumber || 0))) })}/></label>;
  }
  function keywords(key: "keys" | "secondary_keys" | "characters" | "tags", label: string) {
    if (key === "keys" || key === "secondary_keys") return <label>{label}<textarea rows={2} defaultValue={entry[key].join("\n")} placeholder="One word or /pattern/flags per line" onBlur={e => change({ [key]: e.target.value.split("\n").map(value => value.trim()).filter(Boolean) })} /></label>;
    return <label>{label}<input defaultValue={entry[key]?.join(", ") ?? ""} placeholder="Comma-separated" onBlur={e =>
      change({ [key]: e.target.value.split(/[,\n]/).map(word => word.trim()).filter(Boolean) })}/></label>;
  }
  return <>
    <label>Entry name<input value={entry.name} maxLength={100} onChange={e => change({ name: e.target.value })}/></label>
    <label><span className="lore-content-label">Entry content<TokenCount value={tokens} label="Entry content"/></span>
      <textarea rows={5} maxLength={20000} value={entry.content} onChange={e => change({ content: e.target.value })}/></label>
    <div className="lore-fields">{keywords("keys", "Activation keys")}{keywords("secondary_keys", "Secondary keys")}</div>
    <div className="lore-flags">{toggle("enabled", "Enabled")}{toggle("constant", "Always active")}{toggle("selective", "Require a secondary key")}</div>
    <details className="lore-section"><summary>Matching and placement</summary><div>
      <div className="lore-fields">{number("scanDepth", "Scan depth", depth, 0, 100)}{number("insertion_order", "Insertion order", 100, -10000)}</div>
      <label>Position<select value={entry.position} onChange={e => change({ position: e.target.value as LoreEntry["position"] })}>
        <option value="before_char">Before character</option><option value="after_char">After character</option><option value="at_depth">In chat at depth</option></select></label>
      <div className="lore-fields">{entry.position === "at_depth" && number("depth", "Insertion depth", 4, 0, 100)}{number("probability", "Activation chance (%)", 100, 0, 100)}</div>
      <label>Automation ID<input maxLength={150} value={entry.automationId || ""} placeholder="Optional" onChange={e => change({ automationId: e.target.value })}/></label>
      <div className="lore-flags">{toggle("case_sensitive", "Case-sensitive")}{toggle("match_whole_words", "Whole words only")}{toggle("ignoreBudget", "Ignore lorebook budget")}</div>
    </div></details>
    <details className="lore-section"><summary>Recursion and groups</summary><div>
      <div className="lore-flags">{toggle("excludeRecursion", "Non-recursable")}{toggle("preventRecursion", "Prevent further recursion")}</div>
      <label>Delay until recursion<input type="number" min={0} max={100} value={Number(entry.delayUntilRecursion || 0)}
        onChange={e => change({ delayUntilRecursion: Math.max(0, Math.min(100, Math.trunc(e.target.valueAsNumber || 0))) })}/><small>0 allows the first scan. 1 waits for the first recursive scan.</small></label>
      <div className="lore-fields"><label>Inclusion group<input maxLength={200} value={entry.group || ""} onChange={e => change({ group: e.target.value })}/></label>
        {number("groupWeight", "Group weight", 100)}</div>
      <div className="lore-flags">{toggle("groupOverride", "Prioritize this entry")}{toggle("useGroupScoring", "Group scoring")}</div>
    </div></details>
    <details className="lore-section"><summary>Timing and filters</summary><div>
      <div className="lore-timing">{number("sticky", "Sticky", 0)}{number("cooldown", "Cooldown", 0)}{number("delay", "Delay", 0)}</div>
      <small>Durations count individual messages. Set a duration to 0 to turn it off.</small>
      <div className="lore-fields">{keywords("characters", "Characters")}{keywords("tags", "Character tags")}</div>
      {toggle("excludeCharacters", "Exclude matching characters or tags")}
      <fieldset><legend>Generation triggers</legend><small>Leave all unchecked to match every generation type.</small><div className="lore-flags">{triggers.map(trigger =>
        <label className="lore-check" key={trigger}><input type="checkbox" checked={entry.triggers?.includes(trigger) ?? false} onChange={e => change({
          triggers: e.target.checked ? [...(entry.triggers ?? []), trigger] : entry.triggers?.filter(item => item !== trigger)
        })}/>{trigger[0].toUpperCase() + trigger.slice(1)}</label>)}</div></fieldset>
    </div></details>
  </>;
}
