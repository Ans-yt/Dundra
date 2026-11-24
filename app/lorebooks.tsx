"use client";

import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, Download, Plus, Trash2, Upload } from "lucide-react";
import { blankLoreEntry, lorebookFileLimit, loreEntryLimit, type Lorebook, type LoreEntry, type LoreScope } from "../lib/lorebook";
import { AppAlert } from "./alerts";
import { readResponse } from "./request";
import { networkProblem, type Problem } from "../lib/diagnostics";
import { LoreEntryFields } from "./lore-entry-fields";
import { SettingsSwitch } from "./setting-help";
import { PresetDialog } from "./preset-dialog";
import { downloadJson } from "./tavern-editors";

const api = "/api/lorebooks";
type Links = { books: Pick<Lorebook, "id" | "name">[]; direct: string[]; inherited: string[]; memoryBookId?: string | null };
const empty: Links = { books: [], direct: [], inherited: [] };

async function read<T>(query = "", body?: object): Promise<T> {
  const response = await fetch(api + query, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-store" });
  return readResponse<T>(response);
}

function changed() { window.dispatchEvent(new Event("lorebooks-change")); }

function useBooks(query: string, enabled = true, refreshKey?: string | null) {
  const [data, setData] = useState(empty);
  const [error, setError] = useState<Problem | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let revision = 0;
    function refresh() {
      const current = ++revision;
      read<Links>(query).then(result => {
        if (active && revision === current) { setData(result); setError(null); }
      }).catch(cause => { if (active && revision === current) setError(networkProblem(cause, "Load lorebooks")); });
    }
    refresh();
    window.addEventListener("lorebooks-change", refresh);
    return () => { active = false; window.removeEventListener("lorebooks-change", refresh); };
  }, [query, enabled, refreshKey]);
  return { data, error, setData };
}

export function LoreLinks({ scope, id, contextKey, disabled }: { scope: LoreScope; id: string; contextKey?: string | null; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  const query = "?" + new URLSearchParams({ scope, owner: id });
  const { data, error: loadError, setData } = useBooks(query, scope === "chat" || open, contextKey);
  const active = data.books.filter(book => data.direct.includes(book.id) || data.inherited.includes(book.id));
  return <>
    <details className={"lore-links lore-links-" + scope} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className={scope === "persona" ? "persona-lore-summary" : "secondary"}><BookOpen size={15} aria-hidden="true" />
        <span>{scope === "persona" ? "Linked lorebooks" : "Lorebooks"}{scope === "chat" ? ": " + (active.length === 1 ? active[0].name : active.length || "None") : ""}</span>
        <ChevronDown size={13} aria-hidden="true" /></summary>
      <div className="lore-menu">
        {(error || loadError) && <AppAlert {...(error || loadError)!} />}
        {!data.books.length && <p>No lorebooks yet.</p>}
        {data.books.map(book => {
          const linked = data.direct.includes(book.id);
          const inherited = data.inherited.includes(book.id);
          return <label className="lore-link-option" key={book.id}>
            <input type="checkbox" checked={linked || inherited} disabled={disabled || busy || book.id === data.memoryBookId || (inherited && !linked)} onChange={async () => {
              setBusy(true);
              setError(null);
              setData({ ...data, direct: linked ? data.direct.filter(key => key !== book.id) : [...data.direct, book.id] });
              try { await read("", { action: "link", scope, owner: id, id: book.id, enabled: !linked }); changed(); }
              catch (cause) { setData(data); setError(networkProblem(cause, "Update lorebook link")); }
              finally { setBusy(false); }
            }} /><span>{book.name}{book.id === data.memoryBookId ? <small>Lorebook memory for this chat</small> : inherited && <small>Linked through a character or persona</small>}</span>
          </label>;
        })}
        <button type="button" className="quiet" onClick={() => setManage(true)}>Manage lorebooks</button>
      </div>
    </details>
    {manage && <PresetDialog title="Lorebooks" close={() => setManage(false)}><LorebookEditor chatId={scope === "chat" ? id : undefined} /></PresetDialog>}
  </>;
}

export function LorebookEditor({ chatId, initialBook, create, onSaved }: {
  chatId?: string; initialBook?: string; create?: boolean; onSaved?: (book: Lorebook) => void;
} = {}) {
  const { data, error: loadError } = useBooks(chatId ? "?" + new URLSearchParams({ scope: "chat", owner: chatId }) : "");
  const [book, setBook] = useState<Lorebook | undefined>(() => create ? { id: "", name: "", scan_depth: 4, entries: [] } : undefined);
  const [opening, setOpening] = useState(Boolean(initialBook));
  useEffect(() => {
    if (!initialBook) return;
    let active = true;
    read<Lorebook>("?book=" + encodeURIComponent(initialBook)).then(item => {
      if (active) setBook(item);
    }).catch(cause => { if (active) setError(networkProblem(cause, "Open lorebook")); }).finally(() => { if (active) setOpening(false); });
    return () => { active = false; };
  }, [initialBook]);
  const [saving, setSaving] = useState(false);
  const [readingImages, setReadingImages] = useState(false);
  const busy = saving || readingImages || opening;
  const [status, setStatus] = useState("");
  const [error, setError] = useState<Problem | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [query, setQuery] = useState("");
  const [openEntry, setOpenEntry] = useState<string>();

  async function perform(run: () => Promise<void>) {
    setSaving(true);
    setError(null);
    setStatus("");
    try { await run(); }
    catch (cause) { setError(networkProblem(cause, "Lorebook editor")); }
    finally { setSaving(false); }
  }

  function patchEntry(id: string, update: Partial<LoreEntry>) {
    setBook(current => current && { ...current, entries: current.entries.map(entry => entry.id === id ? { ...entry, ...update } : entry) });
  }

  const filter = query.trim().toLowerCase();
  const visibleEntries = book ? (filter ? book.entries.filter(entry =>
    [entry.name, ...entry.keys, ...entry.secondary_keys, entry.content, entry.group, entry.automationId].some(text => text?.toLowerCase().includes(filter))
  ) : book.entries) : [];
  return <div className="lore-editor settings-stack">
    <section className="settings-panel lore-library">
      <h2>Lorebooks</h2>
      <div className="lore-library-controls">
      <label>Saved lorebook<select value={book?.id || ""} disabled={busy || !data.books.length} onChange={event => {
        const id = event.target.value;
        setQuery(""); setOpenEntry(undefined);
        setDeletePending(false);
        void perform(async () => setBook(id ? await read<Lorebook>("?book=" + encodeURIComponent(id)) : undefined));
      }}>
        <option value="">{opening ? "Opening lorebook…" : data.books.length ? "Choose a lorebook" : "No saved lorebooks"}</option>
        {data.books.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <div className="transfer-actions">
        <button type="button" className="secondary" disabled={busy} onClick={() => {
          setQuery(""); setOpenEntry(undefined);
          setBook({ id: "", name: "", scan_depth: 4, entries: [] });
          setDeletePending(false); setStatus(""); setError(null);
        }}><Plus size={16} /> New lorebook</button>
        <label className="secondary advanced-upload"><Upload size={16} /> <span>Import JSON</span>
          <input type="file" accept=".json,application/json" aria-label="Import lorebook JSON" disabled={busy} onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void perform(async () => {
              if (file.size >= lorebookFileLimit) throw Error("Choose a JSON file under 12 MB.");
              let source: unknown;
              try { source = JSON.parse((await file.text()).replace(/^\uFEFF/, "")); }
              catch { throw Error("This file is not valid JSON. Choose a lorebook JSON export."); }
              const imported = await read<Lorebook>("", { action: "save", book: source, filename: file.name.replace(/\.json$/i, "").slice(0, 100) });
              setQuery(""); setOpenEntry(undefined); setBook(imported); setDeletePending(false); changed(); setStatus("Lorebook imported.");
            });
          }} />
        </label>
      </div>
      </div>
      {(error || loadError) && <AppAlert {...(error || loadError)!} />}
      {status && <AppAlert tone="success" message={status} dismiss={() => setStatus("")} />}
    </section>

    {book && <section className="settings-panel lore-book-form">
      <h2>{book.name.trim() || "New lorebook"}</h2>
      <div className="lore-fields lore-book-fields">
        <label>Lorebook name<input value={book.name} maxLength={100} disabled={busy} onChange={event => setBook({ ...book, name: event.target.value })}/></label>
        <label>Scan recent messages<input type="number" min={1} max={100} value={book.scan_depth || ""} disabled={busy}
          onChange={event => setBook({ ...book, scan_depth: Number(event.target.value) })}/></label>
        <label>Token budget<input type="number" min={0} max={1000000} placeholder="Unlimited" disabled={busy} value={book.token_budget || ""} onChange={event => setBook({ ...book, token_budget: Math.min(1000000, Math.max(0, Number(event.target.value))) })}/></label>
      </div>
      <div className="lore-image-setting">
        <SettingsSwitch label="Lorebook images (experimental)" checked={book.image_attachments ?? false} disabled={busy}
          onChange={enabled => setBook({ ...book, image_attachments: enabled })} />
        <small>Attach up to three images per entry. Matching entries send images to your model when Send inline media is on.</small>
      </div>
      <div className="lore-index-head"><h3>Entries <small>{book.entries.length}</small></h3>{book.entries.length > 0 && <input type="search" aria-label="Find entries" placeholder="Find an entry…" value={query} onChange={event => setQuery(event.target.value)}/>}</div>
      {!book.entries.length && <p className="lore-empty">Add an entry for a person, place, or detail the chat should remember.</p>}
      {filter && !visibleEntries.length && <p role="status">No matching entries.</p>}
      <div className="lore-entry-list">{visibleEntries.map(entry => <details className="lore-entry" key={entry.id} open={openEntry === entry.id}>
        <summary onClick={event => { event.preventDefault(); setOpenEntry(openEntry === entry.id ? undefined : entry.id); }}>
          <ChevronDown size={15}/><span><strong>{entry.name.trim() || entry.keys.join(", ") || "Untitled entry"}</strong>
            <small>{entry.enabled ? (entry.constant ? "Always active" : entry.keys.join(" · ") || "No activation keys") : "Disabled"}</small></span></summary>
        {openEntry === entry.id && <fieldset disabled={busy} className="lore-entry-body"><LoreEntryFields entry={entry} depth={book.scan_depth} imagesEnabled={book.image_attachments}
          onReading={setReadingImages} change={update => patchEntry(entry.id, update)} />
        <button type="button" className="quiet danger" onClick={() => setBook({ ...book, entries: book.entries.filter(item => item.id !== entry.id) })}>Remove entry</button>
      </fieldset>}</details>)}</div>
      <button type="button" className="secondary lore-add-entry" disabled={busy || book.entries.length >= loreEntryLimit}
        onClick={() => { setQuery(""); const entry = blankLoreEntry(); setBook({ ...book, entries: [entry, ...book.entries] }); setOpenEntry(entry.id); }}><Plus size={16} /> Add entry</button>
      <div className="transfer-actions">
        <button type="button" className="primary" disabled={busy || !book.name.trim() || book.scan_depth < 1 || book.scan_depth > 100} onClick={() => void perform(async () => {
          const saved = await read<Lorebook>("", { action: "save", id: book.id, book });
          setBook(saved);
          changed(); setStatus("Lorebook saved."); onSaved?.(saved);
        })}>Save lorebook</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => downloadJson(book.name || "lorebook", {
          name: book.name, scan_depth: book.scan_depth, token_budget: book.token_budget ?? 0,
          image_attachments: book.image_attachments ?? false, entries: book.entries,
        })}><Download size={15} /> Export JSON</button>
        {book.id && <button type="button" className="quiet danger" disabled={busy} onClick={() => setDeletePending(true)}><Trash2 size={15} /> Delete</button>}
      </div>
      {deletePending && <div className="lore-delete"><p>Delete this lorebook and remove its links?</p>
        <div className="transfer-actions"><button type="button" className="secondary" onClick={() => setDeletePending(false)}>Cancel</button>
          <button type="button" className="quiet danger" disabled={busy} onClick={() => void perform(async () => {
            await read("", { action: "delete", id: book.id }); setBook(undefined); setDeletePending(false); changed(); setStatus("Lorebook deleted.");
          })}>Delete lorebook</button></div>
      </div>}
    </section>}
  </div>;
}
