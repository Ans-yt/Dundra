"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { AppAlert } from "./alerts";
import { readResponse as read } from "./request";
import { DiagnosticError, networkProblem, type Problem } from "../lib/diagnostics";
import { NavigationIcon } from "./navigation-icon";
import { WorkspaceGate } from "./onboarding";
import type { Character, Chat, ChatPreferences, ChatSession, Library, Persona } from "../lib/types";
import { ChatsView, ContinueShelf, Mark, PersonasView, SearchField } from "./workspace";
import { CardsView } from "./cards";
import { CharacterEditor } from "./character-editor";
import { SettingsView } from "./settings";
import { useAdvanced } from "./advanced";
import { useVisualPreferences } from "./visual-settings";
import { ChatWorkspace, type ReplyMode, type ReplyPreview } from "./chat-workspace";
import { ImagePicker, mediaUrl } from "./media";
import { PresetDialog } from "./preset-dialog";
import { TokenCount, useTokenCounter } from "./token-count";
import { chatImportBody } from "./chat-transfer";
import type { MemoryStatus } from "../lib/auto-memory";

const navigation = [
  { title: "Library", icon: "library" },
  { title: "Import & export", icon: "transfer" },
  { title: "Chats", icon: "chat" },
  { title: "Personas", icon: "personas" },
] as const;
type Tab = (typeof navigation)[number]["title"] | "Settings";
type Editor = { kind: "character"; item?: Character } | { kind: "persona"; item?: Persona };
const empty: Library = { characters: [], personas: [], chats: [], model: null, defaultPersonaId: null };

const post = (url: string, data: object, signal?: AbortSignal) => fetch(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), signal,
});

function Notice({ children }: { children: ReactNode }) {
  return typeof children === "string" ? <AppAlert tone="info" message={children} /> : <p className="notice" role="status">{children}</p>;
}

function CardTokens({ item }: { item: Character }) {
  const count = useTokenCounter();
  const total = useMemo(() => count ? count([item.instructions, item.greeting].join("\n\n")) : null, [count, item.instructions, item.greeting]);
  return <TokenCount label="Character instructions and opening" value={total} />;
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="section">
    <header className="section-head"><h1>{title}</h1>{action}</header>
    {children}
  </section>;
}

export default function Home() {
  useVisualPreferences();
  return <WorkspaceGate><Workspace /></WorkspaceGate>;
}

function Workspace() {
  const [data, setData] = useState(empty);
  const [tab, setTab] = useState<Tab>("Library");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selected, setSelected] = useState<Character | null>(null);
  const [portraitChoice, setPortraitChoice] = useState<string | null>();
  const [openChat, setOpenChat] = useState<ChatSession | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState<ReplyPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function refresh() {
    setData(await read<Library>(await fetch("/api/library", { cache: "no-store" })));
  }

  useEffect(() => {
    refresh().catch((e: Error) => setError(networkProblem(e, "Open workspace"))).finally(() => setLoading(false));
    return () => abort.current?.abort();
  }, []);

  const openChatId = openChat?.chat.id;
  const advanced = useAdvanced(Boolean(openChatId) || tab === "Settings");
  useEffect(() => {
    if (!openChatId) return;
    let request: AbortController | undefined;
    function refreshFormatting() {
      if (abort.current) return;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      fetch("/api/library?chat=" + encodeURIComponent(openChatId!), { cache: "no-store", signal: controller.signal })
        .then(read<ChatSession>).then(result => {
          if (!controller.signal.aborted) setOpenChat(current => current?.chat.id === result.chat.id && current.revision <= result.revision ? result : current);
        }).catch(cause => {
          if (!controller.signal.aborted) setError(networkProblem(cause, "Reload chat formatting"));
        });
    }
    window.addEventListener("advanced-change", refreshFormatting);
    window.addEventListener("chat-prompts-change", refreshFormatting);
    window.addEventListener("lorebooks-change", refreshFormatting);
    return () => {
      request?.abort();
      window.removeEventListener("advanced-change", refreshFormatting);
      window.removeEventListener("chat-prompts-change", refreshFormatting);
      window.removeEventListener("lorebooks-change", refreshFormatting);
    };
  }, [openChatId]);

  const memoryRunning = openChat?.preferences.memoryStatus.running;
  useEffect(() => {
    if (!openChatId || !memoryRunning) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refreshMemory() {
      try {
        const status = await read<MemoryStatus>(await fetch("/api/library?memory=" + encodeURIComponent(openChatId!),
          { signal: controller.signal, cache: "no-store" }));
        if (status.running) timer = setTimeout(refreshMemory, 1500);
        else window.dispatchEvent(new Event("lorebooks-change"));
      } catch { /* Reloading the chat also refreshes memory status. */ }
    }
    timer = setTimeout(refreshMemory, 1500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [openChatId, memoryRunning]);

  function visit(next: Tab) {
    if (next !== tab) window.scrollTo({ top: 0, behavior: "instant" });
    setTab(next);
    setEditor(null);
    setSelected(null);
    setOpenChat(null);
    setSearch("");
    setFilter("");
    setDraft("");
    setError(null);
  }

  async function action(work: () => Promise<void>) {
    setError(null);
    setPending(true);
    try { await work(); return true; } catch (e) { setError(networkProblem(e, "Dundra request")); return false; }
    finally { setPending(false); }
  }

  function applySession(session: ChatSession) {
    setOpenChat(session);
    setData(library => {
      const chats = library.chats.filter(chat => chat.id !== session.chat.id);
      return { ...library, chats: [session.chat, ...chats] };
    });
  }

  async function loadChat(id: string) {
    const result = await read<ChatSession>(await fetch("/api/library?chat=" + encodeURIComponent(id), { cache: "no-store" }));
    applySession(result);
    setTab("Chats");
    setSelected(null);
  }

  function resumeChat(id: string) {
    setDraft("");
    void action(() => loadChat(id));
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveEditor({ ...Object.fromEntries(new FormData(event.currentTarget)), portrait: portraitChoice });
  }

  function saveEditor(fields: object) {
    if (!editor) return;
    void action(async () => {
      setData(await read<Library>(await post("/api/library", { ...fields, action: "save-" + editor.kind, id: editor.item?.id })));
      setEditor(null);
    });
  }

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    void action(async () => {
      const { id } = await read<{ id: string }>(await post("/api/library", {
        action: "start-chat", character: selected.id, persona: form.get("persona"), rememberPersona: form.has("rememberPersona"),
      }));
      if (form.has("rememberPersona")) setData(current => ({ ...current, characters: current.characters.map(item => item.id === selected.id ? { ...item, defaultPersonaId: String(form.get("persona") || "") } : item) }));
      setDraft("");
      await loadChat(id);
    });
  }

  function removeChat(chat: Chat) {
    if (!window.confirm(`Delete “${chat.title}” permanently?`)) return;
    void action(async () => {
      setData(await read<Library>(await post("/api/library", { action: "delete-chat", id: chat.id })));
      if (openChat?.chat.id === chat.id) visit("Chats");
    });
  }

  async function reply(mode: ReplyMode, messageId?: number, media?: string) {
    if (!openChat?.preferences.provider.model || pending || abort.current || (mode === "send" && !draft.trim() && !media)) return false;
    const id = openChat.chat.id;
    const submitted = mode === "send" ? draft : "";
    const initialPreview = { baseCount: openChat.messages.length, phase: "waiting" as const, mode, input: submitted.trim(), messageId, media };
    const controller = new AbortController();
    abort.current = controller;
    if (mode === "send") setDraft("");
    setPreview({ ...initialPreview, text: "", reasoning: "" });
    setError(null);
    let saved = false;
    let frame: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await post("/api/reply", { chat: id, message: initialPreview.input, mode, messageId, media }, controller.signal);
      if (!response.ok) await read(response);
      if (!response.body) throw new Error("The reply stream did not open.");
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let output = "";
      let reasoning = "";
      let thinkingMs: number | undefined;
      let thinkingSince: number | undefined;
      let phase: ReplyPreview["phase"] = "waiting";
      let display: string | undefined;
      let visibleLength = 0;
      const { streamingFps, smoothStreaming } = openChat.preferences.options.bonus;
      const frameDelay = 1000 / streamingFps;
      const revealSteps = Math.max(1, Math.ceil(160 / frameDelay));
      const smooth = smoothStreaming && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      function publish(flush = false) {
        clearTimeout(frame);
        frame = undefined;
        if (smooth && !flush && display === undefined) {
          const pending = output.length - visibleLength;
          visibleLength += Math.ceil(pending / revealSteps);
          const next = output.charCodeAt(visibleLength);
          if (next >= 0xdc00 && next <= 0xdfff) visibleLength++;
        } else visibleLength = output.length;
        const nextPreview = { ...initialPreview, phase, thinkingMs, thinkingSince, text: output.slice(0, visibleLength), reasoning, display };
        setPreview(current => current && (current.text !== nextPreview.text || current.reasoning !== nextPreview.reasoning
          || current.thinkingMs !== thinkingMs || current.thinkingSince !== thinkingSince || current.phase !== nextPreview.phase || current.display !== nextPreview.display) ? nextPreview : current);
        if (visibleLength < output.length) frame = setTimeout(publish, frameDelay);
      }
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += chunk.value;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const event = JSON.parse(line);
            if (event.error) throw new DiagnosticError(event.error, event.details || event.error);
            if (event.done) {
              saved = true;
              if (mode === "impersonate" && typeof event.draft === "string") setDraft(event.draft);
              if (event.automationIds?.length) window.dispatchEvent(new CustomEvent("dundra:lore-activated", { detail: { chat: id, ids: event.automationIds } }));
            }
            if (event.delta || event.reasoning || typeof event.display === "string") {
              if (typeof event.thinkingMs === "number") thinkingMs = event.thinkingMs;
              if (event.delta?.trim()) { phase = "answering"; thinkingSince = undefined; }
              else if (event.reasoning && phase !== "answering") {
                phase = "thinking";
                thinkingSince ??= performance.now();
              }
              output += event.delta || "";
              if (mode === "impersonate" && event.delta) setDraft(output.slice(0, 8000));
              reasoning += event.reasoning || "";
              display = typeof event.display === "string" ? event.display : event.delta ? undefined : display;
              if (!frame) frame = setTimeout(publish, frameDelay);
            }
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (!saved) throw new Error("The connection closed before the reply was saved.");
      if (frame) publish(true);
      if (mode !== "impersonate") await loadChat(id);
      return true;
    } catch (e) {
      if (!controller.signal.aborted) setError(networkProblem(e, "Model reply"));
    } finally {
      clearTimeout(frame);
      if (mode === "send" && !saved) setDraft(submitted);
      if (controller.signal.aborted) {
        try { await loadChat(id); } catch (cause) { setError(networkProblem(cause, "Reload conversation")); }
      }
      abort.current = null;
      setPreview(null);
    }
  }

  const locked = pending || Boolean(preview);
  if (openChat) {
    const { chat, preferences } = openChat;
    function updatePreference(change: object) {
      return action(async () => {
        const saved = await read<ChatPreferences>(await post("/api/library", { id: chat.id, ...change }));
        setOpenChat((current) => current?.chat.id === chat.id ? { ...current, preferences: saved } : current);
      });
    }
    function updateMessage(change: object) {
      return action(async () => {
        const saved = await read<ChatSession>(await post("/api/library", { id: chat.id, ...change }));
        applySession(saved);
      });
    }
    return <ChatWorkspace key={chat.id} session={openChat} advanced={advanced} personas={data.personas} draft={draft} preview={preview} locked={locked} error={error} onDismissError={() => setError(null)}
      onBack={() => visit("Chats")}
      onImport={file => void action(async () => {
        const body = await chatImportBody(file, chat.character_id);
        const imported = await read<ChatSession>(await post("/api/library?format=jsonl", { ...body, open: true }));
        setDraft("");
        applySession(imported);
      })}
      onRename={() => {
        const title = window.prompt("Chat title", chat.title);
        if (title?.trim()) void action(async () => {
          setData(await read<Library>(await post("/api/library", { action: "rename-chat", id: chat.id, title })));
          await loadChat(chat.id);
        });
      }}
      onDelete={() => removeChat(chat)}
      onDeleteFrom={messageId => updateMessage({ action: "delete-messages", messageId, revision: openChat.revision })}
      onPersona={(personaId) => void updateMessage({ action: "chat-persona", personaId })}
      onSavePersona={(persona) => action(async () => {
        setData(await read<Library>(await post("/api/library", { ...persona, action: "save-persona" })));
        await loadChat(chat.id);
      })}
      onModelsChanged={(model) => action(async () => {
        setData((value) => ({ ...value, model }));
        await loadChat(chat.id);
      })}
      onThinking={(level) => void updatePreference({ action: "chat-thinking", profileId: preferences.provider.id, level })}
      onSettings={(changes) => changes.profileId !== undefined ? updateMessage({ action: "chat-profile", profileId: changes.profileId, includeMessages: true }) : updatePreference({ ...changes, action: "chat-options" })}
      onSummarize={() => updatePreference({ action: "summarize-chat" })}
      onEdit={(messageId, content) => updateMessage({ action: "edit-message", messageId, content })}
      onVariant={(messageId, variant) => void updateMessage({ action: "select-variant", messageId, variant })}
      onFork={(messageId) => void action(async () => {
        const branch = await read<{ id: string }>(await post("/api/library", { action: "fork-chat", id: chat.id, messageId }));
        setDraft("");
        await loadChat(branch.id);
      })}
      onDraft={setDraft} onReply={reply} onStop={() => abort.current?.abort()} />;
  }

  function chooseCharacter(item: Character) {
    setSelected(item);
  }
  const tags = [...new Set(data.characters.flatMap((item) => item.tags.split(",").map((value) => value.trim()).filter(Boolean)))].sort();
  const query = search.trim().toLowerCase();
  const characters = data.characters.filter((item) =>
    [item.name, item.description, item.tags].join(" ").toLowerCase().includes(query)
    && (!filter || item.tags.split(",").some((value) => value.trim() === filter)));

  return <div className="shell">
    <header className="masthead">
      <button className="brand" disabled={locked} onClick={() => visit("Library")}><NavigationIcon name="brand" /> Dundra</button>
      <nav aria-label="Workspace" className="nav">
        {navigation.map(({ title, icon }) => <button key={title} type="button" aria-current={tab === title ? "page" : undefined}
          aria-label={title} disabled={locked} onClick={() => visit(title)}><NavigationIcon name={icon} /><span className={title === "Import & export" ? "nav-long" : undefined}>{title}</span>
              {title === "Import & export" && <span className="nav-short">Transfer</span>}</button>)}
      </nav>
      <button className="settings-link" aria-current={tab === "Settings" ? "page" : undefined}
        aria-label="Settings" disabled={locked} onClick={() => visit("Settings")}><NavigationIcon name="settings" /><span>Settings</span></button>
    </header>
    <main id="workspace">
      {loading && <Notice>Opening your workspace…</Notice>}
      {error && editor?.kind !== "character" && !selected && <AppAlert {...error} dismiss={() => setError(null)} />}

      {!loading && editor && <Section title={editor.item ? "Edit " + editor.kind : "New " + editor.kind}
        action={<button className="secondary" disabled={pending} onClick={() => { setError(null); setEditor(null); }}><ArrowLeft size={16} /> Back</button>}>
        {editor.kind === "character" ? <CharacterEditor key={editor.item?.id ?? "new"} item={editor.item}
          player={data.personas.find(persona => persona.id === (editor.item?.defaultPersonaId ?? data.defaultPersonaId))?.name ?? "You"}
          pending={pending} error={error} save={saveEditor} /> : <form className="form" onSubmit={save}>
          <div className="persona-identity">
            <ImagePicker avatar label="Persona image" disabled={pending}
              src={portraitChoice === undefined && editor.item?.portrait ? mediaUrl("persona", editor.item.id, editor.item.portrait) : portraitChoice}
              change={setPortraitChoice} />
            <label>Name<input name="name" required maxLength={80} defaultValue={editor.item?.name} autoFocus /></label>
          </div>
          <label>Description<textarea name="description" maxLength={4000} rows={3} defaultValue={editor.item?.description} /></label>
          <button className="primary" disabled={pending}>{pending ? "Saving…" : "Save persona"}</button>
        </form>}
      </Section>}

      {!loading && !editor && selected && <PresetDialog compact title={"New chat with " + selected.name} close={() => { if (!pending) setSelected(null); }}>
        <form className="form new-chat-form" onSubmit={start}>
          {error && <AppAlert {...error} dismiss={() => setError(null)} />}
          <label>Play as<select name="persona" defaultValue={selected.defaultPersonaId ?? data.defaultPersonaId ?? ""}><option value="">No persona</option>{data.personas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {data.personas.length > 0 && <label className="remember-persona"><input type="checkbox" name="rememberPersona" />Use this choice by default for {selected.name}</label>}
          <button className="primary" disabled={pending}>Start chat</button>
        </form>
      </PresetDialog>}

      {!loading && !editor && tab === "Library" && <section className="library-page">
        <ContinueShelf chats={data.chats} open={resumeChat} disabled={pending} />
        <header className="section-head"><div><h1>Character library</h1><p>{data.characters.length} {data.characters.length === 1 ? "character" : "characters"} in your library</p></div>
          <button className="primary" disabled={pending} onClick={() => setEditor({ kind: "character" })}><Plus size={18} /> New character</button>
        </header>
        <div className="toolbar">
          <SearchField value={search} change={setSearch} label="Search characters" />
          <select aria-label="Filter by tag" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All tags</option>{tags.map((tag) => <option key={tag}>{tag}</option>)}
          </select>
        </div>
        <div className="library-grid">{characters.map((item) => {
          const cardTags = item.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
          return <article className="character-card" key={item.id}>
          <Mark id={item.id} name={item.name} hasPortrait={item.hasPortrait} cover />
          <div className="card-body">
            <h2 className="card-name">{item.name}</h2>
              <CardTokens item={item} />
            <p className="card-summary">{item.description || "No description yet."}</p>
            {item.creator && <p className="card-creator" title={item.creator}>by {item.creator}</p>}
            {cardTags.length > 0 && <div className="tags compact-tags">
              {cardTags.slice(0, 4).map((tag, index) => <span key={index} title={tag}>{tag}</span>)}
              {cardTags.length > 4 && <span title={cardTags.slice(4).join(", ")}>+{cardTags.length - 4}</span>}
            </div>}
            <div className="card-actions">
              <button className="secondary" disabled={pending} onClick={() => chooseCharacter(item)}>New chat</button>
              <button className="quiet" disabled={pending} onClick={() => setEditor({ kind: "character", item })} aria-label={"Edit " + item.name}>Edit</button>
            </div>
          </div>
          </article>;
        })}</div>
        {!characters.length && <Notice>{data.characters.length
          ? "No characters match this search."
          : "Create a character or bring one in through Import & export."}</Notice>}
      </section>}

      {!loading && tab === "Import & export" && <CardsView library={data} onImport={setData} />}

      {!loading && tab === "Chats" && <ChatsView all={data.chats}
        characters={data.characters} search={search} setSearch={setSearch} open={resumeChat} start={chooseCharacter} remove={removeChat} disabled={pending} />}

      {!loading && !editor && tab === "Personas" && <PersonasView all={data.personas} search={search} setSearch={setSearch}
        defaultId={data.defaultPersonaId} setDefault={personaId => void action(async () => {
          setData(await read<Library>(await post("/api/library", { action: "default-persona", personaId })));
        })}
        create={() => { setPortraitChoice(undefined); setEditor({ kind: "persona" }); }} disabled={pending}
        save={(persona) => action(async () => setData(await read<Library>(await post("/api/library", { ...persona, action: "save-persona" }))))} />}

      {!loading && tab === "Settings" && <SettingsView advanced={advanced} onSaved={(model) => setData((value) => ({ ...value, model }))} />}
    </main>
  </div>;
}
