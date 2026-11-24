"use client";

import { Plus, X } from "lucide-react";
import { SettingHelp, SettingsSwitch } from "./setting-help";
import { allowsFunctions, postProcessingModes, type ChatBonus, type CustomHeader } from "../lib/chat-bonus";

export function ChatBonusSettings({ bonus, endpoint, disabled, change }: {
  bonus: ChatBonus; endpoint?: string; disabled: boolean; change: (settings: ChatBonus) => void;
}) {
  const modify = (patch: Partial<ChatBonus>) => change({ ...bonus, ...patch });
  const updateHeader = (index: number, patch: Partial<CustomHeader>) =>
    modify({ headers: bonus.headers.map((row, at) => at === index ? { ...row, ...patch } : row) });
  let origin = "";
  try { if (endpoint) origin = new URL(endpoint).origin; } catch {}

  return <>
    <section className="chat-settings-card bonus-card">
      <h3>Conversation</h3>
      <div className="bonus-setting-row">
        <label>Messages to load<input type="number" required min={0} max={1000} value={Number.isNaN(bonus.messageLimit) ? "" : bonus.messageLimit} disabled={disabled}
          onChange={event => modify({ messageLimit: event.target.valueAsNumber })} /><small>0 shows all messages.</small></label>
      </div>
      <label>Example messages<select value={bonus.examples} disabled={disabled} onChange={event => modify({ examples: event.target.value as ChatBonus["examples"] })}>
        <option value="normal">Gradual push-out</option><option value="keep">Always include examples</option><option value="strip">Never include examples</option>
      </select></label>
      <label>Image swipe behavior<select value={bonus.imageSwipe} disabled={disabled} onChange={event => modify({ imageSwipe: event.target.value as ChatBonus["imageSwipe"] })}>
        <option value="generate">Generate new</option><option value="rollover">Roll over to the first saved reply</option>
      </select></label>
      <SettingsSwitch label="Keep avatar size fixed" checked={bonus.fixedAvatars} disabled={disabled}
        onChange={fixedAvatars => modify({ fixedAvatars })} />
    </section>
    <section className="chat-settings-card bonus-card">
      <h3>Streaming</h3>
      <div className="bonus-setting-row"><label>Streaming FPS<input type="number" required min={5} max={100} value={Number.isNaN(bonus.streamingFps) ? "" : bonus.streamingFps} disabled={disabled}
        onChange={event => modify({ streamingFps: event.target.valueAsNumber })} /></label></div>
      {([
        ["smoothStreaming", "Smooth streaming", "Reveals large batches of incoming text in smaller steps."],
        ["streamFade", "Stream fade-in", "Fades the reply in when the first text arrives."],
      ] as const).map(([key, label, help]) => <SettingsSwitch key={key} label={label} help={help}
        checked={bonus[key]} disabled={disabled} onChange={checked => modify({ [key]: checked })} />)}
    </section>
    <section className="chat-settings-card bonus-card">
      <h3>Provider request</h3>
      <div className="bonus-explained"><div><label htmlFor="bonus-post-processing">Prompt post-processing</label>
        <SettingHelp label="prompt post-processing">Rearranges message roles for providers that require a specific order.</SettingHelp></div>
        <select id="bonus-post-processing" value={bonus.postProcessing} disabled={disabled} onChange={event => modify({ postProcessing: event.target.value as ChatBonus["postProcessing"] })}>
        <option value="none">None</option>
        <optgroup label="With tools">{postProcessingModes.slice(1, 4).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</optgroup>
        <optgroup label="No tools">{postProcessingModes.slice(4).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</optgroup>
      </select></div>
      <label>Seed<input type="number" min={-1} max={2147483647} step={1} value={bonus.seed ?? ""} placeholder="Use preset" disabled={disabled}
        onChange={e => modify({ seed: e.target.value === "" ? null : e.target.valueAsNumber })}/><small>Use −1 for a random seed.</small></label>
      {([
        ["continuePrefill", "Continue prefill", "Asks the model to write directly after the last reply’s text. The provider needs to support assistant prefill."],
        ["squashSystem", "Squash system messages", "Combines consecutive system instructions into one message."],
        ["inlineMedia", "Send inline media", "Includes attachments in the request so a compatible model can see or hear them."],
        ["functionCalling", "Enable function calling", allowsFunctions(bonus.postProcessing)
          ? "Lets compatible models roll dice during a reply." : "The selected post-processing mode disables tools."],
      ] as const).map(([key, label, help]) => <SettingsSwitch key={key} label={label} help={help}
        checked={bonus[key] && (key !== "functionCalling" || allowsFunctions(bonus.postProcessing))}
        disabled={disabled || (key === "functionCalling" && !allowsFunctions(bonus.postProcessing))}
        onChange={checked => modify({ [key]: checked })} />)}
      <div className="bonus-explained"><div><label htmlFor="bonus-image-quality">Inline image quality</label>
        <SettingHelp label="inline image quality">High quality preserves more image detail and may use more tokens.</SettingHelp></div>
        <select id="bonus-image-quality" value={bonus.imageQuality} disabled={disabled || !bonus.inlineMedia}
          onChange={e => modify({ imageQuality: e.target.value as ChatBonus["imageQuality"] })}>
          <option value="auto">Auto</option><option value="low">Low</option><option value="high">High</option>
        </select></div>
      <div className="bonus-explained"><div><label htmlFor="bonus-interleaved">Interleaved thinking</label>
        <SettingHelp label="interleaved thinking">Sends the model’s reasoning back within the same tool exchange so it can finish the reply.</SettingHelp></div>
        <select id="bonus-interleaved" value={bonus.interleavedThinking ? "tools" : "off"} disabled={disabled || !bonus.functionCalling || !allowsFunctions(bonus.postProcessing)}
          onChange={e => modify({ interleavedThinking: e.target.value === "tools" })}><option value="off">Disabled</option><option value="tools">During tool calls</option></select>
      </div>
      <div className="chat-settings-section-title">
        <h4>Custom headers</h4>
        <button type="button" className="secondary" disabled={disabled || bonus.headers.length >= 16 || !origin}
          onClick={() => modify({ headers: [...bonus.headers, { name: "", value: "" }] })}><Plus size={14} /> Add header</button>
      </div>
      {origin && <small>Headers are sent to {origin} for this chat.</small>}
      {bonus.headerOrigin && bonus.headerOrigin !== origin && <small>Saved headers are bound to {bonus.headerOrigin}. Edit or replace them to use the current provider.</small>}
      {bonus.headers.map((header, index) => <div className="bonus-header-row" key={index}>
        <label>Header name<input required maxLength={100} spellCheck={false} placeholder="X-Custom-Header" value={header.name} disabled={disabled}
          onChange={event => updateHeader(index, { name: event.target.value })} /></label>
        <label>Value<input type="password" autoComplete="off" maxLength={4096} value={header.value} disabled={disabled}
          onChange={event => updateHeader(index, { value: event.target.value })} /></label>
        <button type="button" className="quiet danger" title="Remove header" aria-label={`Remove header ${index + 1}`} disabled={disabled}
          onClick={() => modify({ headers: bonus.headers.filter((_, at) => at !== index) })}><X size={16} /></button>
      </div>)}
    </section>
  </>;
}
