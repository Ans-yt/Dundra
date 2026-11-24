"use client";

import { useState } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, Download, Pencil, Plus, Trash2 } from "lucide-react";
import type { Rule } from "../lib/tavern";
import { PresetDialog } from "./preset-dialog";
import { downloadJson, RegexEditor } from "./tavern-editors";

const blankRule: Rule = { scriptName: "", findRegex: "", replaceString: "", placement: [2], markdownOnly: true };

export function RegexList({ title, rules, busy, save, transfer }: {
  title: string; rules: Rule[]; busy: boolean;
  save: (rules: Rule[]) => Promise<boolean>;
  transfer?: { destination: string; move: (index: number) => Promise<boolean> };
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState<{ index: number; action: "remove" | "move" } | null>(null);
  function reorder(index: number, offset: number) {
    const next = rules.slice();
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    void save(next);
  }

  return <section className="regex-list">
    <header><h3>{title}</h3><button type="button" className="secondary" disabled={busy}
      onClick={() => setEditing(rules.length)}><Plus size={15} /> New script</button></header>
    {rules.length ? <ul>{rules.map((rule, index) => <li className="regex-script" key={index}>
      <span title={rule.scriptName}>{rule.scriptName}</span>
      <div className="regex-script-actions">
        <button type="button" className="quiet preset-icon" title="Move up" aria-label={"Move up " + rule.scriptName} disabled={busy || index === 0}
          onClick={() => reorder(index, -1)}><ArrowUp size={14} /></button>
        <button type="button" className="quiet preset-icon" title="Move down" aria-label={"Move down " + rule.scriptName} disabled={busy || index === rules.length - 1}
          onClick={() => reorder(index, 1)}><ArrowDown size={14} /></button>
        <button type="button" className="quiet preset-icon" title="Edit script" aria-label={"Edit " + rule.scriptName} disabled={busy}
          onClick={() => setEditing(index)}><Pencil size={14} /></button>
        {transfer && <button type="button" className="quiet preset-icon" title={"Move to " + transfer.destination} aria-label={`Move ${rule.scriptName} to ${transfer.destination}`} disabled={busy}
          onClick={() => setConfirmation({ index, action: "move" })}><ArrowLeftRight size={14} /></button>}
        <button type="button" className="quiet preset-icon" title="Export script" aria-label={"Export " + rule.scriptName}
          onClick={() => downloadJson(rule.scriptName, rule)}><Download size={14} /></button>
        <button type="button" className="quiet danger preset-icon" title="Remove script" aria-label={"Remove " + rule.scriptName} disabled={busy}
          onClick={() => setConfirmation({ index, action: "remove" })}><Trash2 size={14} /></button>
        <input type="checkbox" role="switch" className="preset-switch" checked={!rule.disabled} disabled={busy} aria-label={"Enable " + rule.scriptName}
          onChange={event => void save(rules.map((entry, at) => at === index ? { ...entry, disabled: !event.target.checked } : entry))} />
      </div>
    </li>)}</ul> : <p>No scripts.</p>}
    {editing !== null && <RegexEditor initial={rules[editing] ?? blankRule} busy={busy} cancel={() => { if (!busy) setEditing(null); }} save={async rule => {
      const next = rules.slice();
      next[editing] = rule;
      if (!(await save(next))) return false;
      setEditing(null);
      return true;
    }} />}
    {confirmation && <PresetDialog title={confirmation.action === "move" ? "Move regex script" : "Remove regex script"} close={() => setConfirmation(null)}>
      <p className="preset-import-content">{rules[confirmation.index]?.scriptName}
        {confirmation.action === "move" ? " will move to " + transfer?.destination + "." : " will be removed from this list."}</p>
      <footer className="preset-dialog-actions">
        <button type="button" className="quiet" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button>
        <button type="button" className="primary" disabled={busy} onClick={async () => {
          const saved = confirmation.action === "move" ? await transfer?.move(confirmation.index)
            : await save(rules.filter((_, index) => index !== confirmation.index));
          if (saved) setConfirmation(null);
        }}>{confirmation.action === "move" ? "Move script" : "Remove script"}</button>
      </footer>
    </PresetDialog>}
  </section>;
}
