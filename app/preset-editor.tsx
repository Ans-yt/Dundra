"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Download, Layers, Pencil } from "lucide-react";
import type { Preset, PresetPrompt } from "../lib/tavern";
import { PresetDialog } from "./preset-dialog";
import { useTokenCounter } from "./token-count";
import { downloadJson } from "./tavern-editors";

const generationTriggers = [
  ["normal", "Normal"], ["continue", "Continue"], ["impersonate", "Impersonate"],
  ["swipe", "Swipe"], ["regenerate", "Regenerate"], ["quiet", "Quiet"],
] as const;

const automaticPrompts = new Map([
  ["charDescription", "Character description"], ["charPersonality", "Character personality"], ["scenario", "Scenario"],
  ["dialogueExamples", "Chat examples"], ["personaDescription", "Persona description"], ["worldInfoBefore", "World info before character"],
  ["worldInfoAfter", "World info after character"], ["chatHistory", "Chat history"],
]);

function PromptEditor({ prompt, busy, save, close }: {
  prompt: PresetPrompt; busy: boolean; save: (prompt: PresetPrompt) => Promise<boolean>; close: () => void;
}) {
  const [draft, setDraft] = useState(prompt);
  const [error, setError] = useState(false);
  const triggers = draft.injection_trigger ?? [];
  const inChat = draft.injection_position === 1;
  const update = (patch: Partial<PresetPrompt>) => { setDraft(current => ({ ...current, ...patch })); setError(false); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!(await save({ ...draft, name: draft.name?.trim() || draft.identifier }))) setError(true);
  }

  return <PresetDialog title="Edit prompt" close={close}>
    <form className="preset-prompt-form" onSubmit={event => void submit(event)}>
      <div className="preset-field-grid">
        <label>Name<input required autoFocus value={draft.name ?? draft.identifier} onChange={event => update({ name: event.target.value })} /></label>
        <label>Role<select value={draft.role ?? "system"} onChange={event => update({ role: event.target.value })}>
          <option value="system">System</option><option value="user">User</option><option value="assistant">AI Assistant</option>
        </select></label>
        <label>Position<select value={inChat ? 1 : 0} onChange={event => update({ injection_position: Number(event.target.value) })}>
          <option value={0}>Relative</option><option value={1}>In-chat</option>
        </select></label>
        {inChat && <>
          <label>Depth<input type="number" required min={0} step={1} value={draft.injection_depth ?? 4}
            onChange={event => update({ injection_depth: event.target.valueAsNumber })} /></label>
          <label>Order<input type="number" required step={1} value={draft.injection_order ?? 100}
            onChange={event => update({ injection_order: event.target.valueAsNumber })} /></label>
        </>}
      </div>
      <details className="preset-triggers">
        <summary>Triggers <span>{triggers.length ? generationTriggers.filter(([id]) => triggers.includes(id)).map(([, label]) => label).join(", ") || "Custom" : "All types"} <ChevronDown size={15} /></span></summary>
        <div>{generationTriggers.map(([id, label]) => <label className="preset-trigger-option" key={id}>
          <input type="checkbox" checked={triggers.includes(id)} onChange={event => update({
            injection_trigger: event.target.checked ? [...triggers, id] : triggers.filter(trigger => trigger !== id),
          })} />{label}</label>)}</div>
      </details>
      <label>Prompt<textarea rows={10} value={draft.content ?? ""} onChange={event => update({ content: event.target.value })} /></label>
      {error && <p className="error" role="alert">The prompt could not be saved. Your edits are still here.</p>}
      <footer className="preset-dialog-actions">
        <button type="button" className="quiet" onClick={close}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>Save prompt</button>
      </footer>
    </form>
  </PresetDialog>;
}

export function PresetEditor({ name, initial, busy, save }: {
  name: string; initial: Preset; busy: boolean; save: (preset: Preset) => Promise<boolean>;
}) {
  const [preset, setPreset] = useState(initial);
  const [editing, setEditing] = useState<PresetPrompt | null>(null);
  const [status, setStatus] = useState("");
  const count = useTokenCounter();
  const definitions = useMemo(() => new Map(preset.prompts?.map(prompt => [prompt.identifier, prompt])), [preset.prompts]);
  const tokens = useMemo(() => new Map(preset.prompts?.map(prompt =>
    [prompt.identifier, count && !prompt.marker && !automaticPrompts.has(prompt.identifier) ? count(prompt.content ?? "") : null])), [preset.prompts, count]);
  const orders = preset.prompt_order ?? [];
  const group = orders.find(order => order.character_id === 100001) ?? orders.at(-1);
  const order = group?.order ?? (preset.prompts ?? []).map(prompt => ({ identifier: prompt.identifier, enabled: true }));

  function updateOrder(next: typeof order) {
    setPreset({ ...preset, prompt_order: group ? orders.map(entry => entry === group ? { ...entry, order: next } : entry)
      : [{ character_id: 100001, order: next }] });
    setStatus("");
  }

  function move(index: number, offset: number) {
    const next = [...order];
    next.splice(index + offset, 0, next.splice(index, 1)[0]);
    updateOrder(next);
  }

  function prepared(next: Preset) {
    const updated = { ...next, extensions: initial.extensions };
    return next.prompt_order?.length || !order.length ? updated : { ...updated, prompt_order: [{ character_id: 100001, order }] };
  }

  async function persist(next: Preset) {
    const withOrder = prepared(next);
    if (!(await save(withOrder))) return false;
    setPreset(withOrder);
    setStatus("Preset saved.");
    return true;
  }

  return <section className="preset-stack" aria-label="Preset prompts">
    <div className="preset-stack-head">
      <h3>Prompt order</h3>
      <button type="button" className="quiet" disabled={busy} onClick={() => setEditing({ identifier: crypto.randomUUID(), name: "New prompt", content: "", role: "system" })}>Add block</button>
      <span title="Estimated tokens for each prompt">Tokens</span>
    </div>
    {order.length ? <ol className="preset-prompt-list">{order.map((entry, index) => {
      const prompt = definitions.get(entry.identifier);
      const label = prompt?.name || automaticPrompts.get(entry.identifier) || entry.identifier;
      const automatic = prompt?.marker || automaticPrompts.has(entry.identifier);
      const tokenCount = tokens.get(entry.identifier);
      return <li className="preset-prompt-row" data-enabled={entry.enabled} key={entry.identifier} draggable={!busy}
        onDragStart={event => event.dataTransfer.setData("application/x-dundra-prompt", entry.identifier)}
        onDragOver={event => { if (event.dataTransfer.types.includes("application/x-dundra-prompt")) event.preventDefault(); }}
        onDrop={event => { event.preventDefault(); const from = order.findIndex(row => row.identifier === event.dataTransfer.getData("application/x-dundra-prompt")); if (from >= 0 && from !== index) move(from, index - from); }}>
        <div className="preset-prompt-name" title={label}>
          {automatic && <Layers size={14} aria-label="Generated from chat data" />}
          <span>{label}</span>
        </div>
        <div className="preset-row-actions">
          <button type="button" className="quiet preset-icon" title="Move up" aria-label={"Move up " + label} disabled={busy || index === 0}
            onClick={() => move(index, -1)}><ArrowUp size={14} /></button>
          <button type="button" className="quiet preset-icon" title="Move down" aria-label={"Move down " + label} disabled={busy || index === order.length - 1}
            onClick={() => move(index, 1)}><ArrowDown size={14} /></button>
          {!automatic && <button type="button" className="quiet preset-icon" title="Edit prompt" aria-label={"Edit " + label} disabled={busy}
            onClick={() => setEditing(prompt ?? { identifier: entry.identifier })}><Pencil size={14} /></button>}
        </div>
        <input className="preset-switch" role="switch" type="checkbox" aria-label={"Enable " + label} checked={entry.enabled} disabled={busy}
          onChange={event => updateOrder(order.map((item, at) => at === index ? { ...item, enabled: event.target.checked } : item))} />
        <span className="preset-tokens">{tokenCount == null ? "—" : tokenCount.toLocaleString()}</span>
      </li>;
    })}</ol> : <p className="preset-empty">This preset contains generation settings without a prompt list.</p>}
    <details className="preset-prefill">
      <summary>Assistant prefill <ChevronDown size={15} /></summary>
      <textarea aria-label="Assistant prefill" rows={3} value={String(preset.assistant_prefill ?? "")} onChange={event => {
        setPreset({ ...preset, assistant_prefill: event.target.value }); setStatus("");
      }} />
    </details>
    <div className="preset-stack-actions">
      <button type="button" className="primary" disabled={busy} onClick={() => void persist(preset)}>Save preset</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => downloadJson(name, prepared(preset))}><Download size={15} /> Export preset</button>
      {status && <span role="status">{status}</span>}
    </div>
    {editing && <PromptEditor prompt={editing} busy={busy} close={() => setEditing(null)} save={async prompt => {
      const prompts = preset.prompts ?? [];
      const next = prompts.some(entry => entry.identifier === prompt.identifier)
        ? prompts.map(entry => entry.identifier === prompt.identifier ? prompt : entry) : [...prompts, prompt];
      const newBlock = !order.some(entry => entry.identifier === prompt.identifier);
      const nextOrder = [...order, { identifier: prompt.identifier, enabled: true }];
      if (!order.length) nextOrder.push({ identifier: "chatHistory", enabled: true });
      const prompt_order = !newBlock ? preset.prompt_order : group ? orders.map(entry => entry === group ? { ...entry, order: nextOrder } : entry) : [{ character_id: 100001, order: nextOrder }];
      const saved = await persist({ ...preset, prompts: next, prompt_order });
      if (saved) setEditing(null);
      return saved;
    }} />}
  </section>;
}
