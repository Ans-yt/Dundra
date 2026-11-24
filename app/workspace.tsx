"use client";

import { ChevronRight, CircleUserRound, MessageSquare, Plus, Search, Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { Character, Chat, Persona } from "../lib/types";
import { ImagePicker, mediaUrl } from "./media";
import { LoreLinks } from "./lorebooks";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const plural = (count: number, noun: string) => count + " " + noun + (count === 1 ? "" : "s");

export function SearchField({ value, change, label }: { value: string; change: (value: string) => void; label: string }) {
  return <label className="search"><Search size={16} /><input type="search" aria-label={label} placeholder={label} value={value} onChange={(event) => change(event.target.value)} /></label>;
}

export function Mark({ id, name, cover = false, hasPortrait = false, src }: { id?: string; name: string; cover?: boolean; hasPortrait?: boolean; src?: string }) {
  const illustration = src || (hasPortrait && id ? "/api/cards?format=portrait&id=" + encodeURIComponent(id)
    : undefined);
  return <span className={cover ? "cover" : "thumbnail"} aria-hidden="true">
    {name.trim().slice(0, 1).toUpperCase()}{illustration && <img key={illustration} src={illustration} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}
  </span>;
}

export function ContinueShelf({ chats, open, disabled, heading = "Continue chatting" }: {
  chats: Chat[]; open: (id: string) => void; disabled: boolean; heading?: string;
}) {
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  if (!chats.length) return null;
  return <section aria-label={heading} className="continue-shelf">
    <h2>{heading}</h2>
    <div className="continue-grid" tabIndex={chats.length > 3 ? 0 : undefined}
      onDragStart={event => event.preventDefault()}
      onPointerDown={event => {
        const shelf = event.currentTarget;
        if (event.button === 0 && event.pointerType === "mouse" && shelf.scrollWidth > shelf.clientWidth) {
          drag.current = { x: event.clientX, left: shelf.scrollLeft, moved: false };
        }
      }}
      onPointerMove={event => {
        const gesture = drag.current;
        if (!gesture || !(event.buttons & 1)) return;
        const delta = event.clientX - gesture.x;
        if (!gesture.moved && Math.abs(delta) < 6) return;
        gesture.moved = true;
        const shelf = event.currentTarget;
        if (!shelf.hasPointerCapture(event.pointerId)) shelf.setPointerCapture(event.pointerId);
        shelf.scrollLeft = gesture.left - delta;
      }}
      onPointerCancel={() => { drag.current = null; }}
      onPointerUp={() => { const gesture = drag.current; setTimeout(() => { if (drag.current === gesture) drag.current = null; }, 0); }}
      onClickCapture={event => { if (drag.current?.moved) { event.preventDefault(); event.stopPropagation(); } }}>
      {[...chats].sort((a, b) => b.updated.localeCompare(a.updated)).map((chat) =>
      <button className="continue-card" key={chat.id} onClick={() => open(chat.id)} disabled={disabled}>
        <Mark id={chat.character_id} name={chat.character} hasPortrait={chat.hasPortrait} />
        <span className="continue-copy"><strong>{chat.title}</strong>
          {chat.persona && <span className="continue-persona">as {chat.persona}</span>}
          <small>{chat.preview || "Open conversation"}</small>
        </span>
      </button>)}</div>
  </section>;
}

function Manager({ title, summary, action, search, change, sort, options, setSort, children }: {
  title: string; summary: string; action?: ReactNode; search: string; change: (value: string) => void; sort: string;
  options: { value: string; label: string }[]; setSort: (value: string) => void; children: ReactNode;
}) {
  return <section className="manager">
    <header className="section-head manager-head"><div><h1>{title}</h1><p>{summary}</p></div>{action}</header>
    <aside className="manager-side">
      <div className="manager-filters">
        <SearchField value={search} change={change} label={"Search " + title.toLowerCase()} />
        <label className="sort"><span>Sort by</span><select value={sort} onChange={(e) => setSort(e.target.value)}>
          {options.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </div>
    </aside>
    <div className="manager-body">{children}</div>
  </section>;
}

export function ChatsView({ all, characters, search, setSearch, open, start, remove, disabled }: {
  all: Chat[]; characters: Character[]; search: string; setSearch: (value: string) => void;
  open: (id: string) => void; start: (item: Character) => void; remove: (chat: Chat) => void; disabled: boolean;
}) {
  const [sort, setSort] = useState("latest");
  const query = search.trim().toLowerCase();
  const chats = all.filter((chat) => [chat.title, chat.character, chat.persona].join(" ").toLowerCase().includes(query))
    .sort((a, b) => sort === "oldest" ? a.updated.localeCompare(b.updated) : b.updated.localeCompare(a.updated));
  const groups = new Map<string, Chat[]>();
  for (const chat of chats) {
    const group = groups.get(chat.character_id);
    if (group) group.push(chat);
    else groups.set(chat.character_id, [chat]);
  }
  return <Manager title="Chats" summary={`${plural(groups.size, "character")} · ${plural(chats.length, "conversation")}`} search={search} change={setSearch} sort={sort} setSort={setSort}
    options={[{ value: "latest", label: "Latest activity" }, { value: "oldest", label: "Oldest activity" }]}>
    {!query && <ContinueShelf chats={all} open={open} disabled={disabled} heading="Continue" />}
    {groups.size > 0 && <div className="list-label">By character</div>}
    {[...groups.values()].map((group) => {
      const first = group[0];
      const character = characters.find((item) => item.id === first.character_id);
      return <details className="chat-group" key={first.character_id} open={query ? true : undefined}>
        <summary><Mark id={first.character_id} name={first.character} hasPortrait={character?.hasPortrait} />
          <span className="stacked"><strong>{first.character}</strong><small>{plural(group.length, "chat")}</small></span>
          <ChevronRight size={17} className="disclosure-arrow" />
        </summary>
        <div className="group-content">
          {group.map((chat) => <div className="conversation-item" key={chat.id}>
            <button className="conversation-row" onClick={() => open(chat.id)} disabled={disabled}>
              <span className="stacked"><strong>{chat.title}</strong><small>{chat.preview || "Open conversation"}</small></span>
              <span className="conversation-meta">{chat.persona && <span className="persona-badge">as {chat.persona}</span>}
                <time dateTime={chat.updated}>{dateFormat.format(new Date(chat.updated))}</time>
                <span className="message-count" aria-label={plural(chat.message_count, "message")}><MessageSquare size={14} />{chat.message_count}</span>
              </span>
            </button>
            <button type="button" className="quiet danger" title="Delete chat" aria-label={"Delete chat " + chat.title} disabled={disabled}
              onClick={() => remove(chat)}><Trash2 size={16} aria-hidden="true" /></button>
          </div>)}
          {character && <footer className="group-actions"><button className="secondary" onClick={() => start(character)} disabled={disabled} aria-label={"New chat with " + first.character}><Plus size={15} /> New chat</button></footer>}
        </div>
      </details>;
    })}
    {!groups.size && <p className="notice" role="status">{query ? "No chats match this search." : "Start a chat from the character library and it will appear here."}</p>}
  </Manager>;
}

function InlinePersona({ item, disabled, save }: { item: Persona; disabled: boolean; save: (draft: { id: string; name: string; description: string; portrait?: string | null }) => Promise<boolean> }) {
  const row = useRef<HTMLDetailsElement>(null);
  const [image, setImage] = useState<string | null>();
  return <details className="persona-row" ref={row}>
    <summary><ChevronRight size={16} className="disclosure-arrow" />{item.portrait
      ? <Mark name={item.name} src={mediaUrl("persona", item.id, item.portrait)} />
      : <span className="persona-icon"><CircleUserRound size={22} /></span>}
      <span className="stacked"><strong>{item.name}</strong><small>{item.description || "No description yet."}</small></span>
    </summary>
    <div className="persona-content">
      <form className="form" key={JSON.stringify(item)} onSubmit={async event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        if (await save({ id: item.id, name: String(form.get("name")), description: String(form.get("description")), portrait: image })) {
          setImage(undefined);
          if (row.current) row.current.open = false;
        }
      }}>
        <div className="persona-identity">
          <ImagePicker avatar label="Persona image" disabled={disabled} src={image === undefined && item.portrait ? mediaUrl("persona", item.id, item.portrait) : image} change={setImage} />
          <label>Name<input name="name" required maxLength={80} defaultValue={item.name} disabled={disabled} /></label>
        </div>
        <label>Description<textarea name="description" rows={3} maxLength={4000} defaultValue={item.description} disabled={disabled} /></label>
        <LoreLinks scope="persona" id={item.id} disabled={disabled} />
        <button className="primary" disabled={disabled}>Save persona</button>
      </form>
    </div>
  </details>;
}

export function PersonasView({ all, search, setSearch, create, save, disabled, defaultId, setDefault }: {
  all: Persona[]; search: string; setSearch: (value: string) => void; create: () => void;
  save: Parameters<typeof InlinePersona>[0]["save"]; disabled: boolean;
  defaultId: string | null; setDefault: (id: string) => void;
}) {
  const [sort, setSort] = useState("name");
  const query = search.trim().toLowerCase();
  const items = all.filter((item) => (item.name + " " + item.description).toLowerCase().includes(query));
  if (sort === "reverse") items.reverse();
  return <Manager title="Personas" summary={plural(items.length, "persona")}
    action={<button className="primary" onClick={create}><Plus size={17} /> New persona</button>} search={search} change={setSearch} sort={sort} setSort={setSort}
    options={[{ value: "name", label: "Name A–Z" }, { value: "reverse", label: "Name Z–A" }]}>
    {all.length > 0 && <label className="persona-default">Default persona
      <select value={defaultId ?? ""} disabled={disabled} onChange={event => setDefault(event.target.value)}>
        <option value="">No default persona</option>
        {all.map(persona => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
      </select>
    </label>}
    <div className="persona-list">{items.map(item => <InlinePersona key={item.id} item={item} disabled={disabled} save={save} />)}</div>
    {!items.length && <p className="notice" role="status">{query ? "No personas match this search." : "Create a persona to give your character someone to meet."}</p>}
  </Manager>;
}
