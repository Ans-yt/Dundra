"use client";

import { useState, type FormEvent } from "react";
import { BookOpen, Plus, RefreshCw } from "lucide-react";
import { memoryLimits, memoryPromptLimit, type AutoMemory } from "../lib/auto-memory";
import type { ChatPreferences } from "../lib/types";
import { PresetDialog } from "./preset-dialog";
import { SettingHelp, SettingsSwitch } from "./setting-help";

const tokenFields = [
  { key: "input", label: "Max input", help: "Caps the summary request, including the instructions and previous summary. Older chat text is trimmed to fit." },
  { key: "previous", label: "Previous summary", help: "Maximum tokens carried forward from the previous summary. Use 0 to skip it." },
  { key: "output", label: "Max output", help: "Hard limit on the model’s reply, including the lorebook memory entry if enabled." },
  { key: "suggested", label: "Suggested output", help: "Asks the model to aim for this length. Use 0 for no suggestion." },
] as const;

export function AdvancedMemory({ preferences, locked, error, close, save, summarize, openBook }: {
  preferences: ChatPreferences; locked: boolean; error: string; close: () => void;
  save: (value: AutoMemory) => Promise<boolean>; summarize: () => Promise<boolean>; openBook: (id: string) => void;
}) {
  const [draft, setDraft] = useState(preferences.options.autoMemory);
  const status = preferences.memoryStatus;
  const changed = JSON.stringify(draft) !== JSON.stringify(preferences.options.autoMemory);
  const [saveError, setSaveError] = useState("");
  const template = draft.templates.find(item => item.id === draft.templateId)!;
  const profiles = preferences.profiles;
  const change = (patch: Partial<AutoMemory>) => { setDraft(current => ({ ...current, ...patch })); setSaveError(""); };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft.suggested > draft.output) {
      setSaveError("Suggested output must be within the max output limit.");
      return;
    }
    if (await save(draft)) close();
  }

  return <PresetDialog title="Advanced memory" close={close}>
    <form className="memory-form" onSubmit={submit}>
      <div className="memory-form-body">
        <section className="memory-settings-section">
          <div className="memory-run-title"><h3>Summary status</h3>
            <div className="transfer-actions">
              {status.bookId && <button type="button" className="secondary" onClick={() => openBook(status.bookId!)}><BookOpen size={15} /> View memories</button>}
              <button type="button" className="secondary" disabled={locked || changed || status.running}
                onClick={() => void summarize()}><RefreshCw size={15} /> Summarize now</button>
            </div>
          </div>
          {(status.running || changed || (!status.summary && !status.error)) && <small className="memory-status" role="status">
            {status.running ? "Writing a summary…" : changed ? "Save your changes before summarizing." : "No summary yet."}
          </small>}
          {!status.running && status.error && <p className="error" role="alert">{status.error}</p>}
          {!status.running && status.summary && preferences.options.autoMemory.book && !status.bookId && <small className="memory-status">
            No lorebook memories yet. The summary model adds one when it finds a new event with searchable keywords.
          </small>}
          {status.summary && <details className="memory-summary-preview"><summary>Latest generated summary</summary><p>{status.summary}</p></details>}
        </section>
        <section className="memory-settings-section">
          <SettingsSwitch label="Automatic summaries" checked={draft.enabled} disabled={locked} onChange={enabled => change({ enabled })} />
          <div className="memory-cadence">
            <label htmlFor="memory-every">Summarize every</label>
            <input id="memory-every" type="number" required {...memoryLimits.every} value={draft.every || ""} disabled={locked}
              onChange={event => change({ every: event.target.valueAsNumber })} />
            <span>new messages</span>
          </div>
          <div className="chat-number-grid">
            <label>Summary profile<select value={draft.profileId} disabled={locked} onChange={event => change({ profileId: event.target.value })}>
              <option value="">Current chat profile</option>
              {draft.profileId && !profiles.some(item => item.id === draft.profileId) && <option value={draft.profileId}>Unavailable profile</option>}
              {profiles.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select></label>
            <label>Custom model ID<input value={draft.model} maxLength={200} placeholder="Use profile model" disabled={locked} onChange={event => change({ model: event.target.value })} /></label>
          </div>
        </section>
        <section className="memory-settings-section">
          <div className="chat-settings-section-title"><h3>Summary prompt</h3>
            <button type="button" className="secondary" disabled={locked || draft.templates.length >= 24} onClick={() => {
              const id = crypto.randomUUID();
              change({ templateId: id, templates: [...draft.templates, { id, name: "New prompt", prompt: template.prompt }] });
            }}><Plus size={15} /> New prompt</button>
          </div>
          <div className="chat-number-grid">
            <label>Template<select value={template.id} disabled={locked} onChange={event => change({ templateId: event.target.value })}>
              {draft.templates.map(item => <option key={item.id} value={item.id}>{item.name || "Untitled prompt"}</option>)}
            </select></label>
            <label>Template name<input required maxLength={80} value={template.name} disabled={locked} onChange={event =>
              change({ templates: draft.templates.map(item => item.id === template.id ? { ...item, name: event.target.value } : item) })} /></label>
          </div>
          <label>Instructions<textarea required rows={4} maxLength={memoryPromptLimit} value={template.prompt} disabled={locked} onChange={event =>
            change({ templates: draft.templates.map(item => item.id === template.id ? { ...item, prompt: event.target.value } : item) })} /></label>
        </section>
        <section className="memory-settings-section">
          <h3>Token limits</h3>
          <div className="chat-number-grid">
            {tokenFields.map(({ key, label, help }) => <div className="memory-number" key={key}>
              <div><label htmlFor={"memory-" + key}>{label}</label><SettingHelp label={label}>{help}</SettingHelp></div>
              <input id={"memory-" + key} type="number" required {...memoryLimits[key]} value={Number.isFinite(draft[key]) ? draft[key] : ""}
                disabled={locked} onChange={event => change({ [key]: event.target.valueAsNumber })} />
            </div>)}
          </div>
        </section>
        <section className="memory-settings-section">
          <SettingsSwitch label="Lorebook memory" checked={draft.book} disabled={locked} onChange={book => change({ book })}
            help="Saves key events as lorebook entries. Matching entries can return in later replies within this chat." />
        </section>
      </div>
      <footer className="preset-dialog-actions">
        {(saveError || error) && <p className="error" role="alert">{saveError || error}</p>}
        <button type="button" className="quiet" onClick={close}>Cancel</button>
        <button className="primary" disabled={locked}>Save automatic memory</button>
      </footer>
    </form>
  </PresetDialog>;
}
