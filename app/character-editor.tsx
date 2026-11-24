"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, BookOpen, ImagePlus, Plus, X } from "lucide-react";
import type { Character } from "../lib/types";
import { expandNames } from "../lib/chat-text";
import { AppAlert } from "./alerts";
import { readResponse } from "./request";
import { networkProblem } from "../lib/diagnostics";
import type { Problem } from "../lib/diagnostics";
import { MessageMarkdown } from "./chat-message";
import { LorebookEditor } from "./lorebooks";
import { imageTypes, useImageUpload } from "./media";
import { PresetDialog } from "./preset-dialog";
import { Mark } from "./workspace";

type Opening = { id: number; text: string };

function Openings({ initial, character, player }: { initial: string[]; character: string; player: string }) {
  const [items, setItems] = useState<Opening[]>(() => initial.map((text, id) => ({ id, text })));
  const [active, setActive] = useState(0);
  const [preview, setPreview] = useState(false);
  const next = useRef(initial.length);
  const tabs = useRef<HTMLDivElement>(null);
  const id = useId();
  const item = items.find(item => item.id === active)!;
  const index = items.indexOf(item);

  function focusTab(nextId: number) {
    setActive(nextId);
    requestAnimationFrame(() => tabs.current?.querySelector<HTMLButtonElement>('[data-opening="' + nextId + '"]')?.focus());
  }

  function navigate(event: KeyboardEvent<HTMLButtonElement>) {
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const target = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + direction + items.length) % items.length;
    focusTab(items[target].id);
  }

  return <fieldset className="opening-editor">
    <legend>Opening messages</legend>
    {items.map(entry => <input key={entry.id} type="hidden" name={entry.id === 0 ? "greeting" : "alternateGreeting"} value={entry.text} />)}
    <div className="opening-bar">
      <div className="opening-tabs" role="tablist" aria-label="Opening messages" ref={tabs}>
        {items.map((entry, position) => <button key={entry.id} type="button" role="tab" id={id + "-tab-" + entry.id} data-opening={entry.id}
          tabIndex={entry.id === active ? 0 : -1} aria-selected={entry.id === active} aria-controls={id + "-panel"}
          title={entry.text.trim().split("\n")[0].slice(0, 100) || undefined}
          onKeyDown={navigate} onClick={() => setActive(entry.id)}>
          {position === 0 ? "Opening" : "Alternate " + position}
        </button>)}
      </div>
      <button type="button" className="quiet opening-add" aria-label="Add alternate opening" title="Add alternate opening" disabled={items.length >= 31}
        onClick={() => {
          const newId = next.current++;
          setItems(current => [...current, { id: newId, text: "" }]);
          setPreview(false);
          focusTab(newId);
        }}><Plus size={17} /></button>
    </div>
    <div className="opening-panel" role="tabpanel" id={id + "-panel"} aria-labelledby={id + "-tab-" + active}>
      <div className="opening-tools">
        <div role="group" aria-label="Opening editor mode">
          <button type="button" className="quiet" aria-pressed={!preview} onClick={() => setPreview(false)}>Write</button>
          <button type="button" className="quiet" aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button>
        </div>
        {active !== 0 && <button type="button" className="quiet danger" aria-label={"Remove alternate " + index} title="Remove this alternate"
          onClick={() => {
            setItems(current => current.filter(entry => entry.id !== active));
            focusTab(items[index - 1].id);
          }}><X size={16} /></button>}
      </div>
      {preview ? <div className="opening-preview">
        {item.text.trim() ? <MessageMarkdown content={expandNames(item.text, character || "Character", player)} /> : <p>Write an opening to preview it.</p>}
      </div> : <textarea aria-label={index === 0 ? "Opening message" : "Alternate " + index} rows={5} maxLength={12000} value={item.text}
        onChange={event => setItems(current => current.map(entry => entry.id === active ? { ...entry, text: event.target.value } : entry))} />}
    </div>
  </fieldset>;
}

type LoreChoice = { id: string; name: string };

function CharacterLorebooks({ owner, selected, change }: {
  owner?: string; selected?: string[]; change: (ids: string[]) => void;
}) {
  const [books, setBooks] = useState<LoreChoice[]>([]);
  const [choice, setChoice] = useState("");
  const [create, setCreate] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<Problem | null>(null);
  const links = selected ?? [];
  const remaining = books.filter(book => !links.includes(book.id));

  useEffect(() => {
    const controller = new AbortController();
    const query = owner ? "?" + new URLSearchParams({ scope: "character", owner }) : "";
    async function load() {
      try {
        const response = await fetch("/api/lorebooks" + query, { cache: "no-store", signal: controller.signal });
        const data = await readResponse<{ books: LoreChoice[]; direct: string[] }>(response);
        if (!controller.signal.aborted) {
          setBooks(data.books);
          change(data.direct);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(networkProblem(cause, "Load character lorebooks"));
      }
    }
    void load();
    return () => controller.abort();
  }, [owner, change, attempt]);

  function move(index: number, offset: number) {
    const ordered = [...links];
    [ordered[index + offset], ordered[index]] = [ordered[index], ordered[index + offset]];
    change(ordered);
  }

  return <fieldset className="character-lorebooks">
    <legend><BookOpen size={16} /> Lorebooks</legend>
    {error ? <div className="character-lore-status"><AppAlert {...error} />
      <button className="secondary" type="button" onClick={() => { setError(null); setAttempt(i => i + 1); }}>Retry</button>
    </div> : selected === undefined ? <small role="status">Loading lorebooks…</small> : <>
      {links.length > 0 && <ol className="character-lore-list">{links.map((id, index) => {
        const name = books.find(book => book.id === id)?.name || "Unavailable lorebook";
        return <li key={id}>
          <span className="character-lore-order">{index + 1}</span>
          <span>{name}</span>
          <div>
            <button className="quiet" type="button" aria-label={"Move " + name + " up"} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
            <button className="quiet" type="button" aria-label={"Move " + name + " down"} disabled={index === links.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
            <button className="quiet danger" type="button" aria-label={"Detach " + name} onClick={() => change(links.filter(key => key !== id))}><X size={16} /></button>
          </div>
        </li>;
      })}</ol>}
      <div className="character-lore-actions">
        <select aria-label="Choose a lorebook" value={choice} onChange={event => setChoice(event.target.value)} disabled={!remaining.length}>
          <option value="">{remaining.length ? "Choose a lorebook" : books.length ? "All lorebooks attached" : "No saved lorebooks"}</option>
          {remaining.map(book => <option key={book.id} value={book.id}>{book.name}</option>)}
        </select>
        <button className="secondary" type="button" disabled={!choice} onClick={() => { change([...links, choice]); setChoice(""); }}><Plus size={16} /> Attach</button>
        <button className="quiet" type="button" onClick={() => setCreate(true)}>New lorebook</button>
      </div>
    </>}
    {create && createPortal(<PresetDialog title="New lorebook" close={() => setCreate(false)}>
      <LorebookEditor create onSaved={book => {
        setBooks(current => [...current.filter(item => item.id !== book.id), { id: book.id, name: book.name }]);
        if (!links.includes(book.id)) change([...links, book.id]);
        setCreate(false);
      }} />
    </PresetDialog>, document.body)}
  </fieldset>;
}

export function CharacterEditor({ item, player, pending, error, save }: {
  item?: Character; player: string; pending: boolean; error: Problem | null; save: (fields: object) => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [tags, setTags] = useState(item?.tags ?? "");
  const [portrait, setPortrait] = useState<string | null>();
  const [lorebookIds, setLorebookIds] = useState<string[]>();
  const [dragging, setDragging] = useState(false);
  const { input, read, remove, reading, error: uploadError } = useImageUpload(setPortrait);
  const art = portrait === undefined && item?.hasPortrait && item.id
    ? "/api/cards?format=portrait&id=" + encodeURIComponent(item.id) : portrait;
  const cardTags = tags.split(",").map(tag => tag.trim()).filter(Boolean);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || reading) return;
    const fields = new FormData(event.currentTarget);
    save({ ...Object.fromEntries(fields), alternateGreetings: fields.getAll("alternateGreeting"), portrait, lorebookIds });
  }

  return <form className="character-editor" onSubmit={submit}>
    <aside className="character-preview" aria-label="Character card preview">
      <h2>Card preview</h2>
      <article className="character-card">
        <button className="character-portrait" type="button" aria-label={art ? "Replace character portrait" : "Add character portrait"} disabled={pending}
          data-dragging={dragging} onClick={() => input.current?.click()}
          onDragOver={event => { event.preventDefault(); if (!pending) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); if (!pending) read(event.dataTransfer.files[0]); }}>
          <Mark cover name={name || "Character"} src={art || undefined} />
          <span><ImagePlus size={17} /> {reading ? "Reading image…" : art ? "Replace portrait" : "Add portrait"}</span>
        </button>
        <div className="card-body">
          <h3 className="card-name">{name.trim() || "Untitled character"}</h3>
          <p className="card-summary">{description.trim() || "No description yet."}</p>
          {cardTags.length > 0 && <div className="tags">{cardTags.slice(0, 4).map((tag, index) => <span key={index}>{tag}</span>)}</div>}
        </div>
      </article>
      <input ref={input} type="file" accept={imageTypes} aria-label="Character portrait" hidden disabled={pending}
        onChange={event => { read(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
      {art && <button className="quiet" type="button" onClick={remove} disabled={pending}>Remove portrait</button>}
      {uploadError && <AppAlert message={uploadError} tone="warning" />}
    </aside>
    <fieldset className="form character-details" disabled={pending}>
      <label>Name<input name="name" required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>Description<textarea name="description" maxLength={600} rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label>
      <label>Character instructions<textarea name="instructions" required maxLength={80000} rows={5} defaultValue={item?.instructions} /></label>
      <Openings initial={[item?.greeting ?? "", ...(item?.alternateGreetings ?? [])]} character={name} player={player} />
      <label>Tags<input name="tags" maxLength={5000} placeholder="Mystery, Fantasy" value={tags} onChange={event => setTags(event.target.value)} /></label>
      <CharacterLorebooks owner={item?.id} selected={lorebookIds} change={setLorebookIds} />
      {error && <AppAlert {...error} />}
      <button className="primary" disabled={pending || reading}>{pending ? "Saving…" : "Save character"}</button>
    </fieldset>
  </form>;
}
