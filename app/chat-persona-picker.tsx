"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Pencil, Plus } from "lucide-react";
import { personaText } from "../lib/chat-text";
import type { Persona } from "../lib/types";
import { ImagePicker, mediaUrl } from "./media";
import { TokenCount } from "./token-count";
import { Mark } from "./workspace";

export type PersonaDraft = Pick<Persona, "name" | "description"> & { id?: string; portrait?: string | null };
type CountTokens = ((text: string) => number) | null;

function portraitUrl(persona?: Persona) {
  return persona?.portrait ? mediaUrl("persona", persona.id, persona.portrait) : undefined;
}

export function ChatPersonaPicker({ personas, selectedId, locked, countTokens, onSelect, onSave }: {
  personas: Persona[]; selectedId: string | null; locked: boolean; countTokens: CountTokens;
  onSelect: (id: string) => void; onSave: (draft: PersonaDraft) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<Persona | "new" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = personas.find(({ id }) => id === selectedId);

  useEffect(() => {
    if (!open || editor) return;
    const panel = root.current;
    const choice = panel?.querySelector<HTMLButtonElement>('.chat-persona-choice[aria-pressed="true"]')
      ?? panel?.querySelector<HTMLButtonElement>(".chat-persona-choice")
      ?? panel?.querySelector<HTMLButtonElement>(".chat-persona-panel-head button");
    choice?.focus({ preventScroll: true });
  }, [open, editor]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false);
        setEditor(null);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function close() {
    setOpen(false);
    setEditor(null);
    trigger.current?.focus();
  }

  return <div ref={root} className="chat-persona-picker" onBlur={(event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
      setOpen(false);
      setEditor(null);
    }
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.preventDefault(); close(); }
    if (editor || locked) return;
    if (event.key === "ArrowDown" && event.target === trigger.current && !open) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    const choices = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".chat-persona-choice"));
    const index = choices.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const next = { ArrowDown: (index + 1) % choices.length, ArrowUp: (index + choices.length - 1) % choices.length,
      Home: 0, End: choices.length - 1 }[event.key];
    if (next !== undefined) { event.preventDefault(); choices[next].focus(); }
  }}>
    <button type="button" className="chat-persona-trigger" ref={trigger} aria-expanded={open} aria-label="Chat persona" aria-controls={open ? "chat-persona-panel" : undefined}
      aria-description={selected ? `Current persona: ${selected.name}` : undefined}
      onClick={() => open ? close() : setOpen(true)} disabled={locked}>
      <Mark name={selected?.name ?? "?"} src={portraitUrl(selected)} />
      <span>{selected?.name ?? "Choose persona"}</span><ChevronDown aria-hidden="true" size={14} />
    </button>
    {open && <section className="chat-persona-panel" id="chat-persona-panel" aria-label="Choose a persona">
      {editor ? <PersonaEditor key={editor === "new" ? "new" : editor.id} persona={editor === "new" ? undefined : editor}
        onBack={() => setEditor(null)} locked={locked} countTokens={countTokens} onSave={async (draft) => {
          if (await onSave(draft)) setEditor(null);
        }} /> : <>
        <header className="chat-persona-panel-head">
          <h2>Personas</h2>
          <button type="button" className="quiet" disabled={locked} onClick={() => setEditor("new")}><Plus size={15} /> New persona</button>
        </header>
        {personas.length ? <ul className="chat-persona-list">
          {personas.map((persona) => <li key={persona.id} className="chat-persona-option">
            <button type="button" className="chat-persona-choice" aria-label={`Use ${persona.name}`} aria-pressed={selectedId === persona.id} disabled={locked}
              onClick={() => { close(); if (persona.id !== selectedId) onSelect(persona.id); }}>
              <span className="persona-list-avatar"><Mark name={persona.name} src={portraitUrl(persona)} />
                {selectedId === persona.id && <Check size={13} aria-hidden="true" />}</span>
              <span className="chat-persona-description"><strong title={persona.name}>{persona.name}</strong>
                {persona.description && <small>{persona.description}</small>}
              </span>
            </button>
            <TokenCount value={countTokens ? countTokens(personaText(persona)) : null} label={`${persona.name} persona`} />
            <button type="button" className="quiet chat-persona-edit" aria-label={`Edit ${persona.name}`} title={`Edit ${persona.name}`} disabled={locked}
              onClick={() => setEditor(persona)}><Pencil size={15} aria-hidden="true" /></button>
          </li>)}
        </ul> : <p className="chat-persona-empty">Create a persona to use in this chat.</p>}
      </>}
    </section>}
  </div>;
}

function PersonaEditor({ persona, countTokens, locked, onBack, onSave }: {
  persona?: Persona; countTokens: CountTokens; locked: boolean; onBack: () => void; onSave: (draft: PersonaDraft) => Promise<void>;
}) {
  const [name, setName] = useState(persona?.name ?? "");
  const [description, setDescription] = useState(persona?.description ?? "");
  const [portrait, setPortrait] = useState<string | null>();
  const clean = { name: name.trim(), description: description.trim() };

  return <div className="chat-persona-editor" onKeyDown={(event) => {
    if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT" && !event.nativeEvent.isComposing) event.preventDefault();
  }}>
    <header className="chat-persona-panel-head">
      <button type="button" className="quiet" aria-label="Back to personas" disabled={locked} onClick={onBack}><ArrowLeft size={17} /></button>
      <h2>{persona ? "Edit persona" : "New persona"}</h2>
    </header>
    <div className="persona-identity">
      <ImagePicker avatar label="Persona image" src={portrait === undefined ? portraitUrl(persona) : portrait} change={setPortrait} disabled={locked} />
      <label>Persona name<input value={name} maxLength={80} autoFocus disabled={locked} onChange={(event) => setName(event.target.value)} /></label>
    </div>
    <div>
      <div className="chat-settings-section-title"><label htmlFor="chat-persona-description">Description</label>
        <TokenCount value={countTokens ? countTokens(personaText(clean)) : null} label="Persona" />
      </div>
      <textarea id="chat-persona-description" value={description} maxLength={4000} rows={4} disabled={locked} onChange={(event) => setDescription(event.target.value)} />
    </div>
    <div className="chat-persona-editor-actions">
      <button type="button" className="quiet" disabled={locked} onClick={onBack}>Cancel</button>
      <button type="button" className="primary" disabled={locked || !clean.name} onClick={() => void onSave({ ...clean, id: persona?.id, portrait })}>Save persona</button>
    </div>
  </div>;
}
