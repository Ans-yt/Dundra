"use client";

import { chatImportBody } from "./chat-transfer";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, Link2, LoaderCircle, Upload } from "lucide-react";
import type { Library } from "../lib/types";

type Preview = { token: string; name: string; creator?: string; tags: string[]; openings: number };

async function read<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The card request failed.");
  return payload as T;
}

function json(data: object) {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
}

export function CardsView({ library, onImport }: { library: Library; onImport: (value: Library) => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState("2");
  const [chatId, setChatId] = useState("");
  const [chatCharacter, setChatCharacter] = useState("");
  const [exportId, setExportId] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const current = library.characters.find((item) => item.id === exportId) || library.characters[0];

  useEffect(() => {
    if (preview && !dialog.current?.open) dialog.current?.showModal();
    if (!preview && dialog.current?.open) dialog.current.close();
  }, [preview]);

  async function inspect(action: string, request: RequestInit, label: string) {
    if (status) return;
    setStatus(label);
    setError("");
    setMessage("");
    try {
      const draft = await read<Preview>(await fetch("/api/cards?action=" + action, request));
      setTags(draft.tags);
      setPreview(draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the card.");
    } finally { setStatus(""); }
  }

  function inspectFile(file?: File) {
    if (!file) return;
    setDragging(false);
    if (!/\.(png|json)$/i.test(file.name)) {
      setError("Choose a PNG character card or a JSON file.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError("Choose a file up to 12 MiB.");
      return;
    }
    void inspect("preview-file", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file }, "Reading character card…");
  }

  function inspectLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void inspect("preview-link", json({ url: new FormData(event.currentTarget).get("url") }), "Loading character from link…");
  }

  async function commit(picked: string[]) {
    if (!preview || status) return;
    setStatus("Saving character…");
    setError("");
    try {
      const result = await read<Library>(await fetch("/api/cards?action=import", json({ token: preview.token, tags: picked })));
      onImport(result);
      setMessage("Imported " + preview.name + " into your library.");
      setPreview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the character.");
    } finally { setStatus(""); }
  }

  return <section className="section transfer">
    <header className="section-head"><h1>Import &amp; export</h1></header>
    {status && !preview && <div className="notice transfer-status" role="status"><LoaderCircle size={18} />{status}</div>}
    {error && !preview && <p className="error" role="alert">{error}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    <div className="transfer-grid">
      <section className="transfer-panel">
        <h2>Import a character</h2>
        <label className="card-drop" data-dragging={dragging} onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)} onDrop={(event) => {
            event.preventDefault();
            inspectFile(event.dataTransfer.files[0]);
          }}>
          <Upload size={23} /><strong>Drop a character card or browse</strong><span>PNG character cards or JSON · up to 12 MiB</span>
          <input type="file" aria-label="Choose character card" accept=".json,.png,application/json,image/png" disabled={!!status}
            onChange={(event) => { inspectFile(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        <form className="form" onSubmit={inspectLink}>
          <label>Character link<input type="url" name="url" required maxLength={650} placeholder="https://chub.ai/characters/author/character" aria-describedby="card-sites" /></label>
          <p id="card-sites">Chub, PygmalionAI, or RisuRealm.</p>
          <button className="secondary" disabled={!!status}><Link2 size={16} /> Load from link</button>
        </form>
      </section>
      <section className="transfer-panel">
        <h2>Export a character</h2>
        {current ? <div className="form">
          <label>Character<select value={current.id} onChange={(event) => setExportId(event.target.value)}>
            {library.characters.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select></label>
          <label>Card format<select value={version} onChange={event => setVersion(event.target.value)}><option value="2">Character Card V2</option><option value="3">Character Card V3</option></select></label>
          <div className="transfer-actions">
            <a className="primary" href={"/api/cards?version=" + version + "&id=" + encodeURIComponent(current.id)} download><Download size={16} /> Export JSON</a>
            <a className="secondary" href={"/api/cards?format=png&version=" + version + "&id=" + encodeURIComponent(current.id)} download><Download size={16} /> Export PNG</a>
          </div>
        </div> : <p>Import or create a character to export it.</p>}
      </section>
    </div>
    {(library.characters.length > 0 || library.chats.length > 0) &&
      <section className="transfer-panel transfer-history">
        <h2>Chat history</h2>
        <div className="form">
          {library.characters.length > 0 && <><label>Import chat for<select value={chatCharacter || library.characters[0].id} disabled={!!status} onChange={event => setChatCharacter(event.target.value)}>
            {library.characters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>SillyTavern chat file<input type="file" accept=".jsonl,application/x-ndjson" disabled={!!status} onChange={async event => {
              const file = event.target.files?.[0]; event.target.value = "";
              if (!file) return;
              setError(""); setMessage(""); setStatus("Importing chat…");
              try {
                const body = await chatImportBody(file, chatCharacter || library.characters[0].id);
                const result = await read<Library>(await fetch("/api/library?format=jsonl", json(body)));
                onImport(result); setMessage("Chat imported. Open it from My Chats.");
              } catch (cause) { setError((cause as Error).message); }
              finally { setStatus(""); }
            }} /></label></>}
          {library.chats.length > 0 && <><label>Export conversation<select value={chatId || library.chats[0].id} onChange={event => setChatId(event.target.value)}>{library.chats.map(chat => <option key={chat.id} value={chat.id}>{chat.title} · {chat.character} · {new Date(chat.updated).toLocaleDateString()}</option>)}</select></label>
            <a className="secondary" href={"/api/library?format=jsonl&chat=" + encodeURIComponent(chatId || library.chats[0].id)} download><Download size={16}/> Export JSONL</a></>}
        </div>
      </section>}
    <dialog className="tag-dialog" ref={dialog} aria-labelledby="tag-title" onCancel={(event) => {
      if (status) event.preventDefault(); else setPreview(null);
    }}>
      {preview && <>
        <h2 id="tag-title">Import {preview.name}</h2>
        <p>{preview.creator && "By " + preview.creator + " · "}{preview.openings} {preview.openings === 1 ? "opening message" : "opening messages"}</p>
        {preview.tags.length > 0 ? <>
          <p>Choose which tags to keep.</p>
          <div className="pick-tags">{preview.tags.map((tag) =>
            <button type="button" key={tag} className="pick-tag" aria-pressed={tags.includes(tag)} disabled={!!status}
              onClick={() => setTags((values) => values.includes(tag) ? values.filter((value) => value !== tag) : [...values, tag])}>{tag}</button>)}</div>
        </> : <p>This card has no tags.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {status && <div className="transfer-status" role="status"><LoaderCircle size={18} />{status}</div>}
        <div className="transfer-actions">
          <button className="primary" disabled={!!status || (!!preview.tags.length && !tags.length)} onClick={() => void commit(tags)}>{preview.tags.length ? "Import selected tags" : "Import character"}</button>
          {preview.tags.length > 0 && <button className="secondary" disabled={!!status} onClick={() => void commit([])}>Import without tags</button>}
          <button className="quiet" disabled={!!status} onClick={() => { setPreview(null); setError(""); }}>Cancel</button>
        </div>
      </>}
    </dialog>
  </section>;
}

export function AlternateOpenings({ initial }: { initial: string[] }) {
  const [openings, setOpenings] = useState(() => initial.map((text, key) => ({ key, text })));
  const next = useRef(initial.length);
  return <fieldset className="alternate-openings">
    <legend>Alternate opening messages</legend>
    {openings.map(({ key, text }, index) => <div className="alternate-input" key={key}>
      <label>Alternate {index + 1}<textarea name="alternateGreeting" rows={3} maxLength={12000} value={text}
        onChange={(event) => setOpenings((values) => values.map((item) => item.key === key ? { ...item, text: event.target.value } : item))} /></label>
      <button className="quiet" type="button" onClick={() => setOpenings((values) => values.filter((item) => item.key !== key))}>Remove alternate {index + 1}</button>
    </div>)}
    <button type="button" className="secondary" disabled={openings.length >= 30} onClick={() => {
      const key = next.current++;
      setOpenings((values) => [...values, { key, text: "" }]);
    }}>Add opening message</button>
  </fieldset>;
}
