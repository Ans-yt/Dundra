"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AppAlert } from "./alerts";
import type { Problem } from "../lib/diagnostics";
import { ArrowLeft, ArrowUp, Cpu, Settings2, Square } from "lucide-react";
import type { ChatSession, Persona } from "../lib/types";
import { chatHistoryText, expandNames, personaText } from "../lib/chat-text";
import { LoreLinks } from "./lorebooks";
import { ThinkingPicker } from "./thinking-picker";
import { ChatSettings, chatTextStyle, type ChatSettingsChange, type ChatViewPreview } from "./chat-settings";
import { attachmentKinds } from "../lib/attachment";
import type { Advanced } from "../lib/tavern";
import { Paperclip, UserPen } from "lucide-react";
import { ChatMessage } from "./chat-message";
import { mediaUrl } from "./media";
import { ChatPersonaPicker, type PersonaDraft } from "./chat-persona-picker";
import { TokenCount, useTokenCounter } from "./token-count";
import { PresetDialog } from "./preset-dialog";
import { ChatTransfer } from "./chat-transfer";

export type ReplyMode = "impersonate" | "send" | "continue" | "alternate";
export type ReplyPhase = "waiting" | "thinking" | "answering";
export type ReplyPreview = { baseCount: number; phase: ReplyPhase; thinkingMs?: number; thinkingSince?: number; text: string; reasoning: string; mode: ReplyMode; input: string; messageId?: number; media?: string; display?: string };

type ChatWorkspaceProps = {
  session: ChatSession;
  advanced: Advanced;
  personas: Persona[];
  draft: string;
  preview: ReplyPreview | null;
  locked: boolean;
  error: Problem | null;
  onDismissError: () => void;
  onBack: () => void;
  onImport: (file: File) => void;
  onRename: () => void;
  onDelete: () => void;
  onDeleteFrom: (messageId: number) => Promise<boolean>;
  onPersona: (id: string) => void;
  onSavePersona: (draft: PersonaDraft) => Promise<boolean>;
  onModelsChanged: (model: string | null) => Promise<boolean>;
  onThinking: (level: string) => void;
  onSettings: (changes: ChatSettingsChange) => Promise<boolean>;
  onSummarize: () => Promise<boolean>;
  onEdit: (id: number, content: string) => Promise<boolean>;
  onVariant: (id: number, variant: number) => void;
  onFork: (id: number) => void;
  onDraft: (value: string) => void;
  onReply: (mode: ReplyMode, messageId?: number, media?:string) => Promise<boolean | undefined>;
  onStop: () => void;
};

export function ChatWorkspace({ session, advanced, personas, draft, preview, locked, error, onDismissError, onBack, onImport, onRename, onDelete, onDeleteFrom,
  onPersona, onSavePersona, onModelsChanged, onThinking, onSettings, onSummarize, onEdit, onVariant, onFork, onDraft, onReply, onStop }: ChatWorkspaceProps) {
  const { chat, messages, preferences } = session;
  const { provider } = preferences;
  const [panelOpen, setPanelOpen] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState(440);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [loadedEarlier, setLoadedEarlier] = useState(0);
  const historyAnchor = useRef<{ top: number; height: number } | null>(null);
  const bonus = preferences.options.bonus;
  const pendingSend = preview?.mode === "send" && preview.baseCount === messages.length;
  const rows = pendingSend ? [...messages,
    { id: -1, role: "user" as const, content: preview.input, media: preview.media },
    { id: -2, role: "assistant" as const, content: preview.text, reasoning: preview.reasoning, thinkingMs: preview.thinkingMs, displayContent: preview.display },
  ] as typeof messages : messages;
  const deleteIndex = messages.findIndex(message => message.id === deleteTarget);
  const firstShown = bonus.messageLimit > 0 ? Math.max(0, messages.length - bonus.messageLimit - loadedEarlier) : 0;
  const [visual, setVisual] = useState<ChatViewPreview | null>(null);
  const view = visual?.view ?? preferences.options.view;
  const background = visual?.background !== undefined ? visual.background
    : preferences.background ? mediaUrl("background", chat.id, preferences.background) : undefined;
  const player = chat.persona || "You";
  const countTokens = useTokenCounter();
  const formats = preferences.options.formats;
  const selectedPersona = personas.find(({ id }) => id === chat.persona_id);
  const historyTokens = useMemo(() => countTokens
    ? messages.reduce((total, message) => total + countTokens(chatHistoryText(message, formats, chat.character, chat.persona || "you")), 0) : null,
  [countTokens, messages, formats, chat.character, chat.persona]);
  const summary = preferences.memoryStatus.summary;
  const extraTokens = useMemo(() => countTokens ? countTokens(personaText(selectedPersona)) + countTokens(preferences.options.memory) + countTokens(summary) : null,
    [countTokens, selectedPersona, preferences.options.memory, summary]);
  const totalTokens = historyTokens !== null && extraTokens !== null ? historyTokens + preferences.promptTokens + extraTokens : null;
  const subtitle = [chat.title !== chat.character ? chat.character : "", chat.persona ? "as " + chat.persona : ""].filter(Boolean).join(" · ");
  const allowed=attachmentKinds(advanced.enabled && advanced.audio,advanced.enabled && advanced.video);
  const [attachment,setAttachment]=useState<{name:string;url:string}|null>(null);
  const [fileError,setFileError]=useState("");
  const [reading,setReading]=useState(false);
  const canSend = Boolean(provider.model && !locked && !reading && (draft.trim() || attachment));
  async function send() {
    if (canSend && await onReply("send",undefined,attachment?.url)) setAttachment(null);
  }
  const transcript = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(messages.length > 1);
  const wasGenerating = useRef(false);
  const mounted = useRef(false);
  const menu = useRef<HTMLDetailsElement>(null);
  const actions = { edit: onEdit, select: onVariant, fork: onFork, delete: setDeleteTarget, generate: (id: number, mode: "continue" | "alternate") => onReply(mode, id) };
  const shared = { character: chat.character, player, formats: preferences.options.formats, hasModel: Boolean(provider.model),
    locked, colorfulEditing: view.colorfulEditing, imageSwipe: bonus.imageSwipe };
  const characterAvatar = { speaker: chat.character, portraitId: chat.character_id, hasPortrait: chat.hasPortrait };
  const playerAvatar = { speaker: player, portrait: chat.persona_id && chat.personaPortrait ? mediaUrl("persona", chat.persona_id, chat.personaPortrait) : undefined };

  function closeSettings() {
    if (!menu.current) return;
    menu.current.open = false;
    menu.current.querySelector("summary")?.focus();
  }

  function fitComposer() {
    const field = input.current;
    if (!field) return;
    const position = field.scrollTop;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
    field.scrollTop = position;
  }

  useLayoutEffect(fitComposer, [draft]);

  useLayoutEffect(() => {
    const pane = transcript.current;
    const anchor = historyAnchor.current;
    if (pane && anchor) pane.scrollTop = anchor.top + pane.scrollHeight - anchor.height;
    historyAnchor.current = null;
  }, [loadedEarlier]);

  useEffect(() => {
    const form = composer.current;
    if (!form) return;
    let width = form.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width === form.clientWidth) return;
      width = form.clientWidth;
      fitComposer();
    });
    observer.observe(form);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (preview && !wasGenerating.current) {
      const latest = preview.mode === "send" || preview.messageId === messages.at(-1)?.id;
      if (latest && view.autoscroll) follow.current = true;
      else if (preview.mode === "alternate") document.getElementById("message-" + preview.messageId)?.scrollIntoView({ block: "nearest" });
    }
    wasGenerating.current = Boolean(preview);
    const pane = transcript.current;
    if (pane && follow.current && (!mounted.current || view.autoscroll)) pane.scrollTop = pane.scrollHeight;
    mounted.current = true;
  }, [messages, preview, view.autoscroll]);

  useEffect(() => {
    const pane = transcript.current;
    if (!pane) return;
    const observer = new ResizeObserver(() => {
      if (follow.current && view.autoscroll) pane.scrollTop = pane.scrollHeight;
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, [view.autoscroll]);

  useEffect(() => {
    if (!panelOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const settings = menu.current?.querySelector(".chat-settings-drawer");
      if (settings?.hasAttribute("data-dock")) return;
      if (menu.current && event.target instanceof Node && !menu.current.contains(event.target)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [panelOpen]);

  const workspaceStyle = { ...chatTextStyle(view), "--chat-drawer-width": drawerWidth + "px" } as CSSProperties;
  return <main className="chat-workspace" style={workspaceStyle} data-fixed-avatars={bonus.fixedAvatars} data-stream-fade={bonus.streamFade}>
    {background && <div className="chat-backdrop" aria-hidden="true"><img src={background} alt=""
      style={{ opacity: view.opacity / 100, filter: `blur(${view.blur / 3}px)` }} /></div>}
    <header className="chat-topbar">
      <div className="chat-topbar-inner">
        <button type="button" className="quiet chat-back" disabled={locked} onClick={onBack} aria-label="Back to chats">
          <ArrowLeft size={17} aria-hidden="true" /> <span>Chats</span>
        </button>
        <div className="chat-heading">
          <h1 title={chat.title}>{chat.title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="chat-provider">
          <LoreLinks scope="chat" id={chat.id} contextKey={JSON.stringify([chat.persona_id, preferences.options.autoMemory.book, preferences.memoryStatus.bookId])} disabled={locked} />
          {provider.model && <span className="chat-provider-name" title={provider.name + " · " + provider.model}><Cpu size={14} aria-hidden="true" /><span>{provider.name}</span></span>}
          <details className="chat-provider-menu" ref={menu} onToggle={(event) => {
            setPanelOpen(event.currentTarget.open);
            if (!event.currentTarget.open) setVisual(null);
          }} onKeyDown={(event) => {
            if (event.key === "Escape" && event.currentTarget.open) {
              closeSettings();
            }
          }}>
            <summary className="quiet" aria-label="Chat settings" title="Chat settings"><Settings2 size={20} aria-hidden="true" /></summary>
            {panelOpen && <ChatSettings preferences={preferences} advanced={advanced} chatId={chat.id} locked={locked} error={error} onClose={closeSettings}
              onModelsChanged={onModelsChanged} onSave={onSettings} onSummarize={onSummarize} onPreview={setVisual} width={drawerWidth} onWidth={setDrawerWidth} />}
          </details>
          <span className="chat-total-count"><span>Total </span><TokenCount value={totalTokens} label="Total" title="Estimated total for the active prompt or preset, persona, chat history, and saved summary" /></span>
        </div>
      </div>
    </header>

    <div className="chat-reading-pane" role="region" aria-label="Conversation" tabIndex={0} ref={transcript}
      onScroll={(event) => {
        const pane = event.currentTarget;
        follow.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 64;
      }}>
      <div className="chat-transcript">
        <div className="chat-management">
          <button type="button" className="quiet" disabled={locked} onClick={onRename}>Rename chat</button>
          <button type="button" className="quiet danger" disabled={locked} onClick={onDelete}>Delete chat</button>
        </div>
        {!messages.length && !preview && <p className="chat-empty">Write a message to start the conversation.</p>}
        {firstShown > 0 && <button type="button" className="secondary chat-load-earlier" disabled={locked} onClick={() => {
          const pane = transcript.current;
          if (pane) historyAnchor.current = { top: pane.scrollTop, height: pane.scrollHeight };
          setLoadedEarlier(value => value + bonus.messageLimit);
        }}>Load earlier messages</button>}
        {rows.slice(firstShown).map((message, index) => {
          const active = preview?.messageId === message.id ? preview : null;
          const messagePlayer = message.player ? message.player.name || "You" : player;
          const avatar = message.player ? { speaker: messagePlayer, portrait: message.player.id && message.player.portrait
            ? mediaUrl("persona", message.player.id, message.player.portrait) : undefined } : playerAvatar;
          const shown = active ? { ...message,
            thinkingMs: active.mode === "continue" && message.thinkingMs !== undefined ? message.thinkingMs + (active.thinkingMs ?? 0) : active.thinkingMs,
            edited: active.mode === "continue" && message.edited,
            displayContent: active.mode === "continue"
              ? [message.displayContent ?? message.content, active.display ?? active.text].filter(Boolean).join("\n\n")
              : active.display,
            variant: active.mode === "alternate" ? (message.variantCount ?? 1) + 1 : message.variant,
            variantCount: active.mode === "alternate" ? (message.variantCount ?? 1) + 1 : message.variantCount,
            content: active.mode === "continue"
              ? [message.content, expandNames(active.text, chat.character, player)].filter(Boolean).join("\n\n")
              : expandNames(active.text, chat.character, player),
            reasoning: active.mode === "continue" ? [message.reasoning, active.reasoning].filter(Boolean).join("\n\n") : active.reasoning,
          } : message;
          return <ChatMessage key={`${firstShown + index}-${message.role}`} message={shown} {...shared} player={messagePlayer}
            {...(message.role === "user" ? avatar : characterAvatar)} actions={message.id > 0 ? actions : undefined}
            thinkingSince={message.id === -2 ? preview?.thinkingSince : active?.thinkingSince}
            phase={message.id === -2 ? preview?.phase : active?.phase} />;
        })}
      </div>
    </div>

    <div className="chat-dock">
      {error && !panelOpen && <AppAlert {...error} dismiss={onDismissError} />}
      <div className="chat-dock-meta">
        {!provider.model && <p className="chat-model-hint" role="status">Choose a model in Chat settings to send messages.</p>}
        <span className="chat-history-count">History <TokenCount value={historyTokens} label="Chat history" /></span>
      </div>
      <form className="chat-composer" ref={composer} onSubmit={(event) => { event.preventDefault(); void send(); }}>
        {fileError && <AppAlert message={fileError} tone="warning" />}
        {attachment && preview?.mode !== "send" && <div className="attached-file">{attachment.url.startsWith("data:image/") && <img src={attachment.url} alt="Attachment preview"/>}{attachment.name}<button className="quiet" type="button" disabled={locked} onClick={()=>setAttachment(null)}>Remove</button></div>}
        <textarea ref={input} aria-label="Your message" placeholder="Enter to send · Shift+Enter for a new line" rows={1} maxLength={8000}
          readOnly={locked} value={draft} onChange={(event) => onDraft(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }} />
        <div className="chat-composer-actions">
          <div className="chat-composer-left">
            <ChatPersonaPicker personas={personas} selectedId={chat.persona_id} locked={locked} countTokens={countTokens} onSelect={onPersona} onSave={onSavePersona} />
            <ChatTransfer chatId={chat.id} locked={locked} onImport={onImport} />
          </div>
          <div className="chat-send-tools">
            {provider.model && <button type="button" className="quiet" title="Draft a message as your persona" aria-label="Impersonate persona" disabled={locked || !!draft.trim() || !!attachment} onClick={() => void onReply("impersonate")}><UserPen size={16} /></button>}
            <label className="attach-media" title="Attach media"><Paperclip size={17}/><input type="file" aria-label="Attach media" accept={allowed.join(",")} disabled={locked || reading}
              onChange={async e=>{
                const f=e.target.files?.[0];e.target.value="";if(!f)return;
                setFileError("");
                if(!allowed.includes(f.type) || !f.size || f.size>8*1024*1024){setFileError("Choose a supported file up to 8 MiB.");return;}
                const reader=new FileReader();setReading(true);
                reader.onload=()=>setAttachment({name:f.name,url:String(reader.result)});
                reader.onerror=()=>setFileError("Could not read the attachment.");
                reader.onloadend=()=>setReading(false);reader.readAsDataURL(f);
              }}/></label>
            {provider.model && provider.thinking.enabled && <ThinkingPicker key={provider.id} model={provider.model}
              levels={provider.thinking.levels} value={preferences.thinkingLevel} disabled={locked} change={onThinking}/>}
            {preview ? <button type="button" className="secondary chat-send" onClick={onStop} aria-label="Stop reply" title="Stop reply"><Square size={15} aria-hidden="true" /></button>
              : <button className="primary chat-send" aria-label="Send" title="Send" disabled={!canSend}><ArrowUp size={19} aria-hidden="true" /></button>}
          </div>
        </div>
      </form>
    </div>
    {deleteIndex >= 0 && <PresetDialog title="Delete messages?" close={() => { if (!locked) setDeleteTarget(null); }}>
      <p className="preset-import-content">{deleteIndex === messages.length - 1
        ? "This message will be permanently deleted."
        : `This message and ${messages.length - deleteIndex - 1} later ${deleteIndex === messages.length - 2 ? "message" : "messages"} will be permanently deleted.`}</p>
      {error && <AppAlert {...error} /> }
      <footer className="preset-dialog-actions">
        <button type="button" className="quiet" disabled={locked} onClick={() => setDeleteTarget(null)}>Cancel</button>
        <button type="button" className="secondary danger" disabled={locked} onClick={async () => {
          if (await onDeleteFrom(messages[deleteIndex].id)) setDeleteTarget(null);
        }}>Delete {deleteIndex === messages.length - 1 ? "message" : "messages"}</button>
      </footer>
    </PresetDialog>}
  </main>;
}
