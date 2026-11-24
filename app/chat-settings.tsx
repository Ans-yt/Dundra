"use client";

import { AppAlert } from "./alerts";
import type { Problem } from "../lib/diagnostics";
import { useRef, useState, type CSSProperties, type FormEvent, type PointerEvent } from "react";
import { ArrowLeft, BookOpen, Check, ChevronDown, Grip, Palette, Plus, Settings2, SlidersHorizontal, Wrench, X } from "lucide-react";
import { chatColors, chatFonts, chatMemoryLimit, customThinkingTag, customThinkingTagLimit, defaultChatText, generationControls, thinkingFormats, type ChatOptions, type ChatViewOptions } from "../lib/chat-options";
import { generationRanges } from "../lib/generation";
import type { ChatPreferences } from "../lib/types";
import { AdvancedControls } from "./advanced";
import type { Advanced } from "../lib/tavern";
import { ColorPicker } from "./color-picker";
import { ImagePicker, mediaUrl } from "./media";
import { ModelSettingsForm } from "./model-settings";
import { ChatBonusSettings } from "./chat-bonus-settings";
import { TokenCount, useTokenCounter } from "./token-count";
import { actionPromptLimit } from "../lib/chat-options";
import { AdvancedMemory } from "./advanced-memory";
import { LorebookEditor } from "./lorebooks";
import { PresetDialog } from "./preset-dialog";

export type ChatSettingsChange = Partial<ChatOptions> & { background?: string | null; profileId?: string | null };
export type ChatViewPreview = { view: ChatViewOptions; background?: string | null };

const tabs = ["Settings", "Memory", "Customize", "Bonus"] as const;
const tabIcons = { Settings: Settings2, Memory: BookOpen, Customize: Palette, Bonus: Wrench };
const fontFamilies: Record<keyof typeof chatFonts, string> = {
  serif: 'Georgia, "Times New Roman", serif', sans: "system-ui, sans-serif",
  rounded: '"Trebuchet MS", system-ui, sans-serif', mono: '"Cascadia Code", Consolas, monospace',
};

export function chatTextStyle(view: ChatViewOptions): CSSProperties {
  return Object.fromEntries([
    ["--story-font", fontFamilies[view.font]], ["--story-size", (view.inheritSize ?? (view.size === 17)) ? "var(--dundra-chat-size, 17px)" : `${Math.max(12, Math.min(32, view.size))}px`],
    ...chatColors.map(({ key }) => ["--story-" + key, view.colors[key]]),
  ]) as CSSProperties;
}

function profileHost(endpoint: string) {
  try { return new URL(endpoint).host; } catch { return endpoint; }
}

export function ChatSettings({ preferences, advanced, chatId, locked, error, onClose, onModelsChanged, onSave, onSummarize, onPreview, width, onWidth }: {
  preferences: ChatPreferences; advanced: Advanced; chatId: string; locked: boolean; error: Problem | null; onClose: () => void;
  width: number; onWidth: (width: number) => void;
  onModelsChanged: (model: string | null) => Promise<boolean>;
  onSummarize: () => Promise<boolean>;
  onSave: (changes: ChatSettingsChange) => Promise<boolean>; onPreview: (draft: ChatViewPreview | null) => void;
}) {
  const [position, setPosition] = useState<{x: number; y: number; dock: "left" | "right" | "float"}>({ x: 0, y: 0, dock: "right" });
  const drag = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);
  const resize = useRef<{ startX: number; left: number; width: number } | null>(null);
  const [snap, setSnap] = useState<"left" | "right" | null>(null);
  const [tools, setTools] = useState(false);
  const [tab, setTab] = useState<(typeof tabs)[number]>("Settings");
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [authorNote, setAuthorNote] = useState(preferences.options.authorNote);
  const [noteDepth, setNoteDepth] = useState(preferences.options.noteDepth);
  const [advancedMemory, setAdvancedMemory] = useState(false);
  const [memoryBook, setMemoryBook] = useState<string>();
  const [actionPrompts, setActionPrompts] = useState(preferences.options.actionPrompts);
  const [memory, setMemory] = useState(preferences.options.memory);
  const [bonus, setBonus] = useState(preferences.options.bonus);
  const [generation, setGeneration] = useState(preferences.options.generation);
  const [formats, setFormats] = useState(preferences.options.formats);
  const [tagInput, setTagInput] = useState("");
  const [tagError, setTagError] = useState("");
  const [view, setView] = useState(preferences.options.view);
  const [colorKey, setColorKey] = useState<string | null>(null);
  const [customColor, setCustomColor] = useState<string | null>(null);
  const [background, setBackground] = useState<string | null>();
  const [saved, setSaved] = useState(false);
  const countTokens = useTokenCounter();
  const customTags = formats.customTags ?? [];
  const profiles = preferences.profiles.filter((profile) => profile.model);
  const image = background === undefined && preferences.background ? mediaUrl("background", chatId, preferences.background) : background;

  function preview(nextView: ChatViewOptions, nextImage = background) {
    setView(nextView);
    setSaved(false);
    onPreview({ view: nextView, background: nextImage });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const changes: ChatSettingsChange = tab === "Settings" ? { generation, actionPrompts }
      : tab === "Memory" ? { memory, authorNote, noteDepth } : tab === "Bonus" ? { bonus } : { view, background, formats };
    if (!(await onSave(changes))) return;
    setSaved(true);
    if (changes.view) {
      setBackground(undefined);
      onPreview(null);
    }
    if (changes.memory !== undefined) setMemory(memory.trim());
    if (changes.bonus) {
      const endpoint = profiles.find(profile => profile.id === preferences.provider.id)?.endpoint;
      setBonus(current => ({
        ...current,
        headerOrigin: !current.headers.length ? undefined
          : JSON.stringify(current.headers) === JSON.stringify(preferences.options.bonus.headers) && preferences.options.bonus.headerOrigin
            ? preferences.options.bonus.headerOrigin : endpoint ? new URL(endpoint).origin : undefined,
      }));
    }
  }

  function addThinkingTag() {
    const tag = customThinkingTag(tagInput);
    if (!tag || customTags.some((entry) => entry.tag === tag)) {
      setTagError("Use a unique tag name, such as analysis or <analysis>."); return;
    }
    if (customTags.length >= customThinkingTagLimit) return;
    setFormats({ ...formats, customTags: [...customTags, { tag, enabled: true }] });
    setTagInput("");
    setTagError("");
    setSaved(false);
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    const bounds = event.currentTarget.closest("aside")?.getBoundingClientRect();
    if (!bounds) return;
    drag.current = {
      startX: event.clientX, startY: event.clientY, offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top, moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrawer(event: PointerEvent<HTMLButtonElement>) {
    const gesture = drag.current;
    if (!gesture || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (!gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 5) return;
    gesture.moved = true;
    const left = drawerLeft(event.clientX, gesture.offsetX);
    setSnap(dockAt(left, gesture.startX, event.clientX));
    setPosition({
      x: left,
      y: Math.max(0, Math.min(window.innerHeight * .25, event.clientY - gesture.offsetY)),
      dock: "float",
    });
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>) {
    setSnap(null);
    if (!drag.current?.moved) return;
    const dock = dockAt(drawerLeft(event.clientX, drag.current.offsetX), drag.current.startX, event.clientX);
    if (dock) setPosition({ x: 0, y: 0, dock });
  }
  function drawerLeft(pointer: number, offset: number) {
    return Math.max(0, Math.min(window.innerWidth - width, pointer - offset));
  }
  function dockAt(left: number, start: number, pointer: number) {
    const rightGap = window.innerWidth - left - Math.min(width, window.innerWidth);
    if (left <= 18 && rightGap <= 18) return pointer < start ? "left" : "right";
    return left <= 18 ? "left" : rightGap <= 18 ? "right" : null;
  }
  function limitWidth(value: number) { return Math.min(Math.max(value, 300), 800, window.innerWidth); }
  function changeWidth(side: "left" | "right", delta: number, startWidth: number, left: number) {
    const max = dock === "float" ? side === "left" ? left + startWidth : window.innerWidth - left : window.innerWidth;
    const next = Math.min(limitWidth(delta + startWidth), max);
    if (dock === "float" && side === "left") setPosition(current => ({ ...current, x: left + startWidth - next }));
    onWidth(next);
  }

  const dock = advanced.enabled ? position.dock : undefined;
  const floatingPosition = dock === "float" ? { "--drawer-x": position.x + "px", "--drawer-y": position.y + "px" } as CSSProperties : undefined;
  return <>{snap && <div className="chat-snap-preview" data-edge={snap} aria-hidden="true" />}
    <aside className="chat-settings-drawer" data-dock={dock} style={floatingPosition} aria-label="Chat settings panel">
    {(dock === "float" ? ["left", "right"] as const : [dock === "left" ? "right" : "left"] as const).map(side =>
      <div key={side} role="separator" tabIndex={0} aria-label={`Resize settings from the ${side}`} aria-orientation="vertical"
        aria-valuemin={300} aria-valuemax={800} aria-valuenow={width} className="chat-drawer-resize" data-edge={side}
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0) return;
          const rect = event.currentTarget.parentElement!.getBoundingClientRect();
          resize.current = { startX: event.clientX, left: rect.left, width: rect.width };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId) || !resize.current) return;
          const { startX, left, width } = resize.current;
          changeWidth(side, (event.clientX - startX) * (side === "left" ? -1 : 1), width, left);
        }}
        onLostPointerCapture={() => { resize.current = null; }}
        onKeyDown={event => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const rect = event.currentTarget.parentElement!.getBoundingClientRect();
          changeWidth(side, (event.key === "ArrowRight" ? 16 : -16) * (side === "left" ? -1 : 1), rect.width, rect.left);
        }} />)}
    <div className="chat-settings-head">
      {advanced.enabled ? <button type="button" className="drawer-grip" aria-label="Move chat settings" title="Drag to float or dock. Click to cycle positions."
        onPointerDown={startDrag} onPointerMove={moveDrawer} onPointerUp={finishDrag} onPointerCancel={() => { drag.current = null; setSnap(null); }}
        onClick={(event) => {
          if (event.detail && drag.current?.moved) return;
          setPosition({ x: Math.max(0, (window.innerWidth - width) / 2), y: 40,
            dock: position.dock === "right" ? "float" : position.dock === "float" ? "left" : "right" });
        }}><Grip size={16} aria-hidden="true" /> Chat settings</button> : <h2>Chat settings</h2>}
      <button type="button" className="quiet" onClick={onClose} aria-label="Close chat settings" autoFocus><X size={19} /></button>
    </div>
    <nav className="chat-settings-nav" aria-label="Chat settings sections">
      {tabs.map((value) => {
        const Icon = tabIcons[value];
        return <button type="button" className="quiet" key={value} disabled={locked}
          aria-pressed={!(advanced.enabled && tools) && tab === value} onClick={() => { setTools(false); setTab(value); setEditingProfile(null); setSaved(false); }}><Icon aria-hidden="true" size={17}/>{value}</button>;
      })}
      {advanced.enabled && <button type="button" className="quiet" aria-pressed={tools} onClick={()=>{setTools(true);setEditingProfile(null);}}><SlidersHorizontal size={17} aria-hidden="true"/>Advanced</button>}
    </nav>
    {advanced.enabled && tools ? <div className="chat-settings-body"><AdvancedControls config={advanced} inChat profilePreset={preferences.profilePreset} /></div> : editingProfile ? <div className="chat-settings-body chat-profile-editor">
      <button type="button" className="quiet" onClick={() => setEditingProfile(null)}><ArrowLeft size={15} /> Model profiles</button>
      <h3>{editingProfile === "new" ? "New model profile" : "Edit model profile"}</h3>
      <ModelSettingsForm key={editingProfile} initialProfile={editingProfile} onSaved={(model) => void (async () => {
        if (await onModelsChanged(model)) { setEditingProfile(null); setSaved(true); }
      })()} />
    </div> : <form id="chat-settings-form" className="chat-settings-body" onSubmit={save} onInvalid={(event) => {
      const section = (event.target as HTMLElement).closest("details");
      if (section) section.open = true;
    }}>
    {tab === "Settings" && <>
      <section className="chat-settings-card">
        <div className="chat-settings-section-title"><h3>Model profiles</h3>
          <button type="button" className="secondary" disabled={locked} onClick={() => { setEditingProfile("new"); setSaved(false); }}><Plus size={15} /> New</button>
        </div>
        <div className="chat-profile-list">{preferences.profiles.map((profile) => <div className="chat-profile-row" key={profile.id}>
          <button type="button" className="profile-choice" aria-pressed={preferences.provider.id === profile.id} disabled={locked || !profile.model} onClick={() => void onSave({ profileId: profile.id })}>
            <span><strong>{profile.name}</strong><small>{profile.model || "Choose a model"} · {profileHost(profile.endpoint)}</small></span>
            {preferences.provider.id === profile.id && <Check size={16} aria-hidden="true" />}
          </button>
          <button type="button" className="quiet" aria-label={"Edit " + profile.name + " profile"} disabled={locked}
            onClick={() => { setEditingProfile(profile.id); setSaved(false); }}>Edit</button>
        </div>)}</div>
        {preferences.profileId && <button type="button" className="quiet" disabled={locked} onClick={() => void onSave({ profileId: null })}>Follow default profile</button>}
      </section>
    <details className="chat-settings-card chat-customize-section" open>
      <summary>Generation</summary>
      <p>Blank fields follow your global generation settings.</p>
      <div className="chat-number-grid">
        {generationControls.map(({ key, label }) => <label key={key}>{label}
          <input type="number" {...generationRanges[key]} placeholder={String(preferences.generationDefaults[key])}
            value={generation[key] ?? ""} onChange={(event) => {
              setGeneration({ ...generation, [key]: event.target.value === "" ? undefined : event.target.valueAsNumber });
              setSaved(false);
            }} disabled={locked} />
        </label>)}
      </div>
      <button type="button" className="quiet chat-reset-text" disabled={locked} onClick={() => { setGeneration({}); setSaved(false); }}>Use global settings</button>
    </details>
    <details className="chat-settings-card chat-customize-section">
      <summary>Quick prompts</summary>
      <p>Leave a field empty to use the preset or Dundra’s default. You can use <code>{"{{user}}"}</code> and <code>{"{{char}}"}</code>.</p>
      <label>Draft as persona<textarea rows={3} maxLength={actionPromptLimit} value={actionPrompts.impersonate} disabled={locked}
        onChange={event => { setActionPrompts({ ...actionPrompts, impersonate: event.target.value }); setSaved(false); }} /></label>
      <label>Continue the scene<textarea rows={3} maxLength={actionPromptLimit} value={actionPrompts.continue} disabled={locked}
        onChange={event => { setActionPrompts({ ...actionPrompts, continue: event.target.value }); setSaved(false); }} /></label>
    </details>
    </>}
    {tab === "Memory" && <section className="chat-settings-card">
      <div className="chat-settings-section-title memory-drawer-head">
        <h3>Memory</h3>
        <button type="button" className="secondary" onClick={() => setAdvancedMemory(true)}><SlidersHorizontal size={15} /> Advanced</button>
      </div>
      <div className="chat-settings-section-title"><label htmlFor="chat-memory">Chat summary</label>
        <TokenCount value={countTokens ? countTokens(memory.trim()) : null} label="Summary" />
      </div>
      <p id="chat-memory-help">Write down story details you want the model to remember. Your saved summary is sent with every request in this chat.</p>
      <textarea id="chat-memory" aria-describedby="chat-memory-help" placeholder="What has happened so far?" rows={10} value={memory} maxLength={chatMemoryLimit}
        disabled={locked} onChange={(event) => { setMemory(event.target.value); setSaved(false); }} />
      <label>Author’s note<textarea rows={3} maxLength={chatMemoryLimit} value={authorNote} disabled={locked} onChange={event => { setAuthorNote(event.target.value); setSaved(false); }} /></label>
      <label>Insertion depth<input type="number" min={0} max={100} required value={noteDepth} onChange={event => { setNoteDepth(event.target.valueAsNumber); setSaved(false); }} /><small>0 places the note after the latest message.</small></label>
    </section>}
    {tab === "Bonus" && <ChatBonusSettings bonus={bonus} endpoint={profiles.find(profile => profile.id === preferences.provider.id)?.endpoint}
      disabled={locked} change={next => { setBonus(next); setSaved(false); }} />}
    {tab === "Customize" && <>
    <details className="chat-settings-card chat-customize-section customize-disclosure">
      <summary>Appearance</summary>
      <div className="chat-text-sample chat-prose" style={chatTextStyle(view)}><p>Regular text. <em>Narration.</em> <strong>Bold.</strong> <code>Code</code>{" "}<span className="chat-dialogue">“Dialogue”</span> <span className="chat-edited">[edited]</span></p></div>
      <div className="chat-number-grid">
        <label>Font size (px)<select value={(view.inheritSize ?? (view.size === 17)) ? "" : view.size} disabled={locked}
          onChange={e => preview({ ...view, inheritSize: !e.target.value, size: Number(e.target.value) || 17 })}>
          <option value="">Use in-chat size</option>{Array.from({ length: 21 }, (_, i) => i + 12).map(px => <option key={px} value={px}>{px} px</option>)}</select></label>
        <label>Font family<select value={view.font} disabled={locked} onChange={(event) => preview({ ...view, font: event.target.value as ChatViewOptions["font"] })}>
          {Object.entries(chatFonts).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
      </div>
      <div className="chat-color-grid">
        {chatColors.map(({ key, label }) => {
          const color = view.colors[key];
          const expanded = colorKey === key;
          const select = (next: string) => preview({ ...view, colors: { ...view.colors, [key]: next } });
          return <div key={key} className="ink-row">
            <button type="button" className="ink-trigger" aria-expanded={expanded} disabled={locked} onClick={() => setColorKey(expanded ? null : key)}>
              <i style={{ backgroundColor: color }} /><span>{label}</span><code>{color.toUpperCase()}</code><ChevronDown size={14} />
            </button>
            {expanded && <div className="ink-palette">
              {[["Ivory", "#fff1d6"], ["Pearl", "#f5efff"], ["Mist", "#c3c8da"], ["Lilac", "#d5b6ff"], ["Rose", "#ffb7d4"], ["Mint", "#a3e5d5"]].map(([name, hex]) =>
                <button type="button" key={hex} disabled={locked} aria-label={label + " · " + name} title={name} aria-pressed={color.toLowerCase() === hex}
                  style={{ backgroundColor: hex }} onClick={() => select(hex)}>{color.toLowerCase() === hex && <Check size={14} />}</button>)}
              <button type="button" className="secondary" aria-expanded={customColor === key} disabled={locked}
                onClick={() => setCustomColor(customColor === key ? null : key)}>Custom</button>
              {customColor === key && <ColorPicker value={color} label={label} disabled={locked} change={select} />}
            </div>}
          </div>;
        })}
      </div>
      <button type="button" className="quiet chat-reset-text" disabled={locked} onClick={() => preview({ ...view, ...defaultChatText })}>Reset text settings</button>
      <fieldset className="chat-settings-group">
        <legend>Options</legend>
        {([
          ["autoscroll", "Autoscroll"], ["streaming", "Stream replies as they arrive"], ["colorfulEditing", "Colorful message editing"],
        ] as const).map(([key, label]) => <label className="chat-settings-check" key={key}><input type="checkbox" checked={view[key]} disabled={locked}
          onChange={(event) => preview({ ...view, [key]: event.target.checked })} />{label}</label>)}
      </fieldset>
      <fieldset className="chat-settings-group">
        <legend>Background</legend>
        <ImagePicker label="Background image" src={image} disabled={locked} change={(value) => { setBackground(value); preview(view, value); }} />
        <label>Opacity <span className="chat-setting-value">{view.opacity}%</span><input type="range" min={0} max={100} value={view.opacity}
          disabled={locked} onChange={(event) => preview({ ...view, opacity: Number(event.target.value) })} /></label>
        <label>Blur <span className="chat-setting-value">{view.blur}%</span><input type="range" min={0} max={100} value={view.blur}
          disabled={locked} onChange={(event) => preview({ ...view, blur: Number(event.target.value) })} /></label>
      </fieldset>
    </details>
    <details className="chat-settings-card chat-customize-section customize-disclosure">
      <summary>Thinking formats</summary>
      <p>Selected formats appear in a collapsed Thoughts section when the provider returns them.</p>
      {thinkingFormats.map(({ key, label }) => <label className="chat-settings-check" key={key}>
        <input type="checkbox" checked={formats[key]} disabled={locked} onChange={(event) => {
          setFormats({ ...formats, [key]: event.target.checked }); setSaved(false);
        }} />{label}</label>)}
      {customTags.map(({ tag, enabled }) => <div className="thinking-tag-row" key={tag}>
        <label className="chat-settings-check"><input type="checkbox" checked={enabled} disabled={locked} onChange={(event) => {
          setFormats({ ...formats, customTags: customTags.map((entry) => entry.tag === tag ? { ...entry, enabled: event.target.checked } : entry) });
          setSaved(false);
        }} />{`<${tag}> … </${tag}>`}</label>
        <button type="button" className="quiet" aria-label={`Remove ${tag} tag`} disabled={locked} onClick={() => {
          setFormats({ ...formats, customTags: customTags.filter((entry) => entry.tag !== tag) }); setSaved(false);
        }}><X size={15} aria-hidden="true" /></button>
      </div>)}
      <div className="thinking-tag-row">
        <input aria-label="Custom thinking tag" placeholder="e.g. analysis" value={tagInput} maxLength={34} disabled={locked || customTags.length >= customThinkingTagLimit}
          onChange={(event) => { setTagInput(event.target.value); setTagError(""); }} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); if (!locked && tagInput.trim()) addThinkingTag(); }
          }} />
        <button type="button" className="secondary" disabled={locked || !tagInput.trim() || customTags.length >= customThinkingTagLimit} onClick={addThinkingTag}>Add tag</button>
      </div>
      {tagError && <p role="alert">{tagError}</p>}
    </details>
    </>}
    </form>}
    {!(advanced.enabled && tools) && (!editingProfile || error) && <div className="chat-settings-footer">
      {error && <AppAlert className="chat-settings-error" {...error} />}
      {saved && <p role="status">Saved.</p>}
      {!editingProfile && <button type="submit" form="chat-settings-form" className="primary" disabled={locked}>Save {tab === "Memory" ? "memory" : tab === "Customize" ? "customization" : tab === "Bonus" ? "bonus settings" : "settings"}</button>}
    </div>}
  </aside>
    {advancedMemory && <AdvancedMemory preferences={preferences} locked={locked} error={error} summarize={onSummarize}
      close={() => setAdvancedMemory(false)} save={autoMemory => onSave({ autoMemory })}
      openBook={id => { setAdvancedMemory(false); setMemoryBook(id); }} />}
    {memoryBook && <PresetDialog title="Lorebook memory" close={() => { setMemoryBook(undefined); setAdvancedMemory(true); }}>
      <LorebookEditor chatId={chatId} initialBook={memoryBook} />
    </PresetDialog>}
  </>;
}
