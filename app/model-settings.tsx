"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { ModelProfile, ModelProfiles } from "../lib/types";
import { commonThinkingLevels, noThinking, normalizeThinkingLevel, thinkingLabel } from "../lib/thinking";
import { TokenCount } from "./token-count";
import { PromptSettings } from "./generation-settings";

async function read<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not complete the model settings request.");
  return data as T;
}

function request(data: object, signal?: AbortSignal) {
  return fetch("/api/settings", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), signal,
  });
}

type Feedback = { message: string; error?: boolean };
type Action = "models" | "test" | "save-profile" | "activate" | "delete-profile";
type ProfileDraft = { profileId: string; endpoint?: string; model?: string; apiKey?: string; name?: string; promptId?: string;
  thinkingEnabled?: boolean; thinkingLevels?: string };

const newProfile: ModelProfile = { id: "new", name: "", endpoint: "http://127.0.0.1:11434/v1", model: "", promptId: "", hasKey: false, thinking: noThinking };

export function ModelSettingsForm({ onSaved, initialProfile }: { onSaved: (model: string | null) => void; initialProfile?: string }) {
  const [editorPrompt, setEditorPrompt] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ModelProfiles | null>(null);
  const [profileId, setProfileId] = useState("default");
  const [name, setName] = useState("");
  const [presetName, setPresetName] = useState("");
  const [promptId, setPromptId] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [thinkingLevels, setThinkingLevels] = useState<string[]>([]);
  const [customLevel, setCustomLevel] = useState("");
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [revealed, setRevealed] = useState("");
  const [revealing, setRevealing] = useState(false);
  const revealRequest = useRef<AbortController | null>(null);
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState<"load" | Action | null>("load");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [manual, setManual] = useState(false);
  const [reload, setReload] = useState(0);
  const active = useRef<AbortController | null>(null);

  function apply(value: ModelProfile) {
    setProfileId(value.id);
    setName(value.name);
    setPromptId(value.promptId);
    setPresetName(value.presetName || "");
    setEndpoint(value.endpoint);
    setModel(value.model);
    setThinkingEnabled(value.thinking.enabled);
    setThinkingLevels(value.thinking.levels);
    setCustomLevel("");
    revealRequest.current?.abort();
    setRevealing(false);
    setKey(""); setVisible(false); setRevealed("");
    setClearKey(false);
  }

  async function run(action: Action, connection: ProfileDraft) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(action);
    setFeedback(action === "test" ? { message: "Waiting for a short reply…" } : null);
    try {
      const response = await request({ ...connection, action }, controller.signal);
      if (action === "models") {
        const result = await read<{ models: string[] }>(response);
        if (controller.signal.aborted) return;
        setModels(result.models);
        if (!result.models.length) setFeedback({ message: "The provider listed no models. You can enter one manually." });
      } else if (action === "test") {
        await read<{ ok: true }>(response);
        if (controller.signal.aborted) return;
        setFeedback({ message: "Connection works. The selected model returned a streamed reply." });
      } else {
        const saved = await read<ModelProfiles & { selectedId?: string }>(response);
        if (controller.signal.aborted) return;
        setProfiles(saved);
        const current = saved.profiles.find((profile) => profile.id === saved.activeId)!;
        const selected = saved.profiles.find((profile) => profile.id === (saved.selectedId || connection.profileId)) || current;
        apply(selected);
        onSaved(current.model || null);
        if (action === "delete-profile") { setModels([]); setManual(false); }
        setFeedback({ message: action === "activate" ? selected.name + " is active for chats."
          : action === "delete-profile" ? "Model profile removed." : "Model settings saved." });
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (action === "models") setModels([]);
        setFeedback({ message: cause instanceof Error ? cause.message : "The request failed.", error: true });
      }
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setBusy("load");
    setFeedback(null);
    fetch("/api/settings?profiles=1", { cache: "no-store", signal: controller.signal })
      .then(read<ModelProfiles>)
      .then((value) => {
        if (controller.signal.aborted) return;
        setProfiles(value);
        const current = value.profiles.find((profile) => profile.id === (initialProfile ?? value.activeId));
        if (current) {
          apply(current);
          void run("models", { endpoint: current.endpoint, profileId: current.id });
        } else {
          apply(newProfile);
          setBusy(null);
        }
      })
      .catch((cause: Error) => {
        if (!controller.signal.aborted) {
          setFeedback({ message: cause.message, error: true });
          setBusy(null);
        }
      });
    return () => { controller.abort(); active.current?.abort(); };
  }, [reload, initialProfile]);

  function edited(connectionChanged = false) {
    revealRequest.current?.abort();
    setRevealing(false);
    active.current?.abort();
    setBusy(null);
    setFeedback(null);
    if (connectionChanged) setModels([]);
  }

  const settings = profiles?.profiles.find((profile) => profile.id === profileId);
  let newOrigin = false;
  try { newOrigin = Boolean(settings && new URL(settings.endpoint).origin !== new URL(endpoint).origin); } catch {}
  if (!profiles) return busy === "load"
    ? <p className="notice" role="status">Loading model settings…</p>
    : <><p className="error" role="alert">{feedback?.message}</p><button className="secondary" onClick={() => setReload((value) => value + 1)}>Try again</button></>;

  const selectedPrompt = profiles.prompts.some((prompt) => prompt.id === promptId) ? promptId : "";
  if (editorPrompt !== null) return <div className="profile-prompt-editor">
    <button type="button" className="secondary" onClick={() => setEditorPrompt(null)}>Back to model profile</button>
    <PromptSettings promptsOnly initialPrompt={editorPrompt} onSaved={async config => {
      window.dispatchEvent(new Event("chat-prompts-change"));
      const { countTextTokens } = await import("../lib/tokens");
      setProfiles(prior => prior && ({ ...prior, globalPromptTokens: countTextTokens(config.current.globalPrompt),
        prompts: config.prompts.map(prompt => ({ id: prompt.id, name: prompt.name, tokens: countTextTokens(prompt.content) })) }));
    }} />
  </div>;
  const connection = { profileId, endpoint, model, name, presetName: profiles.presets.includes(presetName) ? presetName : "", promptId: selectedPrompt, apiKey: clearKey ? "" : key.trim() || undefined,
    thinkingEnabled, thinkingLevels: (thinkingEnabled ? thinkingLevels : settings?.thinking.levels)?.join(", ") };
  const listed = models.includes(model);
  const showManual = manual || !models.length || (!!model && !listed);
  const saving = busy === "save-profile" || busy === "activate" || busy === "delete-profile";
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (thinkingEnabled && !thinkingLevels.length) {
      setFeedback({ message: "Select at least one thinking level supported by the model.", error: true }); return;
    }
    if (!saving) void run("save-profile", connection);
  }
  function addThinkingLevel() {
    const level = normalizeThinkingLevel(customLevel);
    if (!/^[a-z0-9_-]{1,32}$/.test(level) || (!thinkingLevels.includes(level) && thinkingLevels.length >= 12)) {
      setFeedback({ message: "Use letters, numbers, hyphens or underscores. Select up to 12 thinking levels.", error: true }); return;
    }
    if (!thinkingLevels.includes(level)) setThinkingLevels([...thinkingLevels, level]);
    setCustomLevel("");
    setFeedback(null);
  }
  function chooseProfile(id: string) {
    edited(true);
    setManual(false);
    const selected = profiles?.profiles.find((profile) => profile.id === id);
    if (selected) {
      apply(selected);
      void run("models", { profileId: selected.id, endpoint: selected.endpoint });
    } else apply(newProfile);
  }

  return <form className="form model-settings" onSubmit={save}>
    {initialProfile === undefined && <><h2>Model profiles</h2>
    <p>Default for chats: <strong>{profiles.profiles.find((profile) => profile.id === profiles.activeId)?.name}</strong>.</p>
    <div className="model-picker">
      <div className="model-picker-field">
        <label htmlFor="model-profile">Model profile</label>
        <select id="model-profile" value={profileId} disabled={saving} onChange={(event) => chooseProfile(event.target.value)}>
          {profiles.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.id === profiles.activeId ? " (active)" : ""}</option>)}
          <option value="new">New profile…</option>
        </select>
      </div>
      <button className="secondary" type="button" disabled={saving || profileId === "new"} onClick={() => chooseProfile("new")}>New profile</button>
    </div></>}
    {profileId !== "default" && <label>Profile name<input value={name} maxLength={60} required disabled={saving}
      onChange={(event) => { setName(event.target.value); setFeedback(null); }} /></label>}
    <label>Base URL<input type="url" required maxLength={2048} value={endpoint} disabled={saving} placeholder="http://127.0.0.1:11434/v1"
      onChange={(event) => { setEndpoint(event.target.value); edited(true); }} /></label>
    <div className="model-key-field"><label>API key <small>{settings?.hasKey ? "A key is saved" : "Optional"}</small>
      <input type={visible ? "text" : "password"} autoComplete="new-password" spellCheck={false} maxLength={2048} value={key || (visible && !newOrigin ? revealed : "")} disabled={saving || clearKey}
        placeholder={settings?.hasKey && !newOrigin ? "Enter a new key to replace the saved key" : "Enter a key if your provider requires one"}
        onChange={(event) => { setRevealed(""); setKey(event.target.value); edited(true); }} />
    </label>
    <button type="button" className="secondary" aria-label={visible ? "Hide API key" : "Show API key"} title={visible ? "Hide API key" : "Show API key"} disabled={saving || clearKey || revealing} onClick={async () => {
      if (visible) { setVisible(false); setRevealed(""); return; }
      if (!key && settings?.hasKey && !newOrigin) {
        const controller = new AbortController();
        revealRequest.current = controller;
        setRevealing(true);
        try {
          const data = await read<{key: string}>(await request({ action: "reveal-key", profileId, endpoint }, controller.signal));
          if (controller.signal.aborted) return;
          setRevealed(data.key);
        } catch {
          if (!controller.signal.aborted) setFeedback({ error: true, message: "Could not show the saved key." });
          return;
        } finally {
          if (!controller.signal.aborted) setRevealing(false);
        }
      }
      setVisible(true);
    }}>{visible ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>
    {settings?.hasKey && newOrigin && <p className="settings-hint">Changing providers removes the saved key. Enter a new key for the new provider if it needs one.</p>}
    {settings?.hasKey && !newOrigin && <label className="clear-key"><input type="checkbox" checked={clearKey} disabled={saving}
      onChange={(event) => { setClearKey(event.target.checked); setKey(""); edited(true); }} /> Remove saved key</label>}
    <div className="model-picker">
      <div className="model-picker-field">
        <label htmlFor="available-models">Available models</label>
        <select id="available-models" disabled={saving} value={listed && !manual ? "id:" + model : showManual && (model || manual) ? "manual" : ""}
        onChange={(event) => {
          const choice = event.target.value;
          edited();
          setManual(choice === "manual");
          if (choice !== "manual") setModel(choice.slice(3));
        }}>
        <option value="">Choose a model</option>
        {models.map((item) => <option key={item} value={"id:" + item}>{item}</option>)}
        <option value="manual">Enter a model name</option>
        </select>
      </div>
      <button type="button" className="secondary" disabled={busy !== null || !endpoint.trim()}
        onClick={() => void run("models", connection)}>{busy === "models" ? "Loading…" : "Load models"}</button>
    </div>
    {showManual && <label>Model name<input value={model} disabled={saving} maxLength={256} placeholder="Exact model ID from your provider"
      onChange={(event) => { setManual(true); setModel(event.target.value); edited(); }} /></label>}
    <fieldset className="model-thinking">
      <legend>Thinking</legend>
      <label className="clear-key"><input type="checkbox" checked={thinkingEnabled} disabled={saving}
        onChange={(event) => { setThinkingEnabled(event.target.checked); setFeedback(null); }} /> Supports thinking</label>
      {thinkingEnabled && <>
        <div className="thinking-level-buttons" role="group" aria-label="Supported thinking levels">
          {[...new Set([...commonThinkingLevels, ...thinkingLevels])].map((level) => <button className="secondary" type="button" key={level}
            aria-pressed={thinkingLevels.includes(level)} disabled={saving || (!thinkingLevels.includes(level) && thinkingLevels.length >= 12)}
            onClick={() => {
              setThinkingLevels(thinkingLevels.includes(level) ? thinkingLevels.filter((value) => value !== level) : [...thinkingLevels, level]);
              setFeedback(null);
            }}>{thinkingLabel(level)}</button>)}
        </div>
        <div className="model-picker">
          <div className="model-picker-field"><input aria-label="Custom thinking level" placeholder="Custom level" value={customLevel}
            maxLength={32} disabled={saving} onChange={(event) => setCustomLevel(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addThinkingLevel(); } }} /></div>
          <button className="secondary" type="button" disabled={saving || !customLevel.trim()} onClick={addThinkingLevel}>Add level</button>
        </div>
      </>}
    </fieldset>
    {profiles.presets.length > 0 && <label>Advanced preset<select value={profiles.presets.includes(presetName) ? presetName : ""} disabled={saving} onChange={event => setPresetName(event.target.value)}><option value="">Follow Advanced settings</option>{profiles.presets.map(name => <option key={name}>{name}</option>)}</select></label>}
    <label><span className="chat-settings-section-title">Profile prompt
      <TokenCount value={profiles.prompts.find(({ id }) => id === selectedPrompt)?.tokens ?? profiles.globalPromptTokens} label="Prompt" />
    </span><select aria-label="Profile prompt" value={selectedPrompt} disabled={saving} onChange={(event) => { setPromptId(event.target.value); setFeedback(null); }}>
      <option value="">Use global prompt</option>
      {profiles.prompts.map((prompt) => <option key={prompt.id} value={prompt.id}>{prompt.name}</option>)}
    </select></label>
    <button type="button" className="secondary" disabled={saving} onClick={() => setEditorPrompt(selectedPrompt)}>Edit prompts</button>
    <div className="transfer-actions">
      <button className="primary" disabled={saving}>{busy === "save-profile" ? "Saving…" : "Save settings"}</button>
      <button type="button" className="secondary" disabled={saving || busy === "test" || !endpoint.trim() || !model.trim()}
        onClick={() => void run("test", connection)}>{busy === "test" ? "Testing…" : "Test connection"}</button>
      {initialProfile === undefined && settings && profileId !== profiles.activeId && <button type="button" className="secondary" disabled={saving}
        onClick={() => void run("activate", { profileId })}>Use saved profile</button>}
      {settings && profileId !== "default" && <button type="button" className="quiet danger" disabled={saving}
        onClick={() => { if (window.confirm("Remove " + settings.name + "?")) void run("delete-profile", { profileId }); }}>Remove profile</button>}
    </div>
    {feedback && <p className={feedback.error ? "error" : "notice"} role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
  </form>;
}
