"use client";

import { useEffect, useState } from "react";
import { downloadJson } from "./tavern-editors";
import { RegexList } from "./regex-list";
import { PresetEditor } from "./preset-editor";
import { PresetDialog } from "./preset-dialog";
import { defaults, importPreset, importRules, presetRegexRules, withPresetRegex, type Advanced, type Preset, type Rule, type SavedPreset } from "../lib/tavern";

export function useAdvanced(active: boolean) {
  const [config, setConfig] = useState<Advanced>(defaults);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    fetch("/api/advanced",{signal:controller.signal}).then(r=>r.ok?r.json():defaults).then(setConfig).catch(()=>{});
    const receive = (event: Event) => {
      controller.abort();
      setConfig((event as CustomEvent<Advanced>).detail);
    };
    window.addEventListener("advanced-change",receive);
    return () => { controller.abort(); window.removeEventListener("advanced-change",receive); };
  }, [active]);
  return config;
}

export function AdvancedControls({ config, inChat = false, profilePreset = "" }: { config: Advanced; inChat?: boolean; profilePreset?: string }) {
  const pinned = profilePreset && config.library.some(entry => entry.name === profilePreset);
  const cfg = pinned ? { ...config, selected: profilePreset, presets: true } : config;
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [pendingPreset, setPendingPreset] = useState<{ name: string; preset: Preset; scripts: Rule[] } | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [importVersion, setImportVersion] = useState(0);
  async function save(patch: Partial<Advanced>) {
    setError("");setBusy(true);
    try {
      const res = await fetch("/api/advanced",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(patch)});
      const data = await res.json();
      if (!res.ok) throw Error(data.error);
      window.dispatchEvent(new CustomEvent("advanced-change",{detail:data})); return true;
    } catch(e) {setError(String(e));return false;} finally { setBusy(false); }
  }

  async function addPreset(entry: SavedPreset) {
    const library = [...cfg.library.filter(preset => preset.name !== entry.name), entry];
    if (await save({ library, selected: entry.name, presets: true, ...(entry.bundledRegex && { regex: true }) })) {
      setImportVersion(version => version + 1);
      setPendingPreset(null);
    }
  }

  function file(kind:"rules"|"library") {
    return <label className="secondary advanced-upload">Import {kind==="rules"?"regex":"preset"} JSON<input type="file" accept=".json,application/json" disabled={busy} onChange={async e=>{
      const f=e.target.files?.[0];e.target.value="";if (!f) return;
      try {
        if(f.size>2_000_000) throw Error("Choose a JSON file smaller than 2 MB.");
        const data=JSON.parse(await f.text());
        if(kind==="rules") await save({rules:[...cfg.rules,...importRules(data)]});
        else {
          const name = f.name.replace(/\.json$/i, "");
          const preset = importPreset(data);
          const scripts = presetRegexRules(preset);
          if (scripts.length) setPendingPreset({ name, preset, scripts });
          else await addPreset({ name, preset });
        }
      } catch(e) {setError(String(e));}
    }}/></label>;
  }
  const selected = cfg.presets ? cfg.library.find(entry => entry.name === cfg.selected) : undefined;
  const presetRules = selected ? presetRegexRules(selected.preset) : [];
  function updatePresetRules(scripts: Rule[], globalRules = cfg.rules) {
    return save({ rules: globalRules, library: cfg.library.map(entry => entry === selected
      ? { ...entry, preset: withPresetRegex(entry.preset, scripts) } : entry) });
  }
  const toggle=(key:"enabled"|"presets"|"regex"|"audio"|"video",label:string)=><label className="advanced-toggle"><input className="preset-switch" type="checkbox" disabled={busy} checked={cfg[key]} onChange={e=>void save({[key]:e.target.checked})}/><span>{label}</span></label>;
  return <section className="settings-panel advanced-controls"><h2>Advanced</h2>
    {!inChat && toggle("enabled", "Enable advanced mode")}
    {cfg.enabled && <>{!pinned && toggle("presets", "Chat Completion presets")}
      {cfg.presets && <div className="transfer-actions">{file("library")}{!pinned && <button className="secondary" type="button" disabled={busy} onClick={() => { setNewName(""); setError(""); }}>New preset</button>}</div>}
      {cfg.presets && <>
      <label>{pinned ? "Model profile preset" : "Active preset"}<select value={cfg.selected} disabled={busy || !!pinned} onChange={e=>void save({selected:e.target.value})}><option value="">Use Dundra settings</option>{cfg.library.map(p=><option key={p.name}>{p.name}</option>)}</select></label>
      {selected && <>
      <PresetEditor key={selected.name + ":" + importVersion} name={selected.name} initial={selected.preset} busy={busy}
        save={preset => save({ library: cfg.library.map(entry => entry === selected ? { ...entry, preset } : entry) })} />
      {presetRules.length > 0 && <label className="advanced-toggle">
        <input className="preset-switch" type="checkbox" disabled={busy} checked={cfg.regex && selected.bundledRegex !== false}
          onChange={event => {
            const bundledRegex = event.target.checked;
            void save({
              library: cfg.library.map(entry => entry === selected ? { ...entry, bundledRegex } : entry),
              ...(bundledRegex && { regex: true }),
            });
          }} /><span>Use bundled regex</span>
      </label>}
      <button className="quiet danger preset-remove" type="button" disabled={busy} onClick={()=>void save({library:cfg.library.filter(x=>x!==selected)})}>Remove imported preset</button></>}
    </>}
    {toggle("regex","Regex scripts")}{cfg.regex && <>{file("rules")}
      <RegexList title="Global scripts" rules={cfg.rules} busy={busy} save={rules => save({ rules })}
        transfer={selected && { destination: "preset", move: index => updatePresetRules([...presetRules, cfg.rules[index]],
          cfg.rules.filter((_, at) => at !== index)) }} />
      {selected && <RegexList key={selected.name} title="Preset scripts" rules={presetRules} busy={busy} save={updatePresetRules}
        transfer={{ destination: "global scripts", move: index => updatePresetRules(presetRules.filter((_, at) => at !== index),
          [...cfg.rules, presetRules[index]]) }} />}
      {cfg.rules.length>0 && <button type="button" className="secondary" onClick={()=>downloadJson("regex-scripts",cfg.rules)}>Export regex scripts</button>}
    </>}{toggle("audio","Audio attachments")}{toggle("video","Video attachments")}</>}
    {error && !pendingPreset && <p className="error" role="alert">{error}</p>}
    {newName !== null && <PresetDialog compact title="New preset" close={() => setNewName(null)}>
      <form className="form new-chat-form" onSubmit={async event => {
        event.preventDefault();
        const name = newName.trim();
        const order = ["main", "worldInfoBefore", "charDescription", "charPersonality", "scenario", "personaDescription", "worldInfoAfter", "dialogueExamples", "chatHistory"].map(identifier => ({ identifier, enabled: true }));
        if (await save({ selected: name, library: [...cfg.library, { name, preset: { prompts: [{ identifier: "main", name: "Main prompt", role: "system", content: "" }], prompt_order: [{ character_id: 100001, order }] } }] })) setNewName(null);
      }}><label>Preset name<input autoFocus required maxLength={100} value={newName} onChange={event => setNewName(event.target.value)}/></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={busy || !newName.trim() || cfg.library.some(entry => entry.name === newName.trim())}>Create preset</button></form>
    </PresetDialog>}
    {pendingPreset && <PresetDialog title="Bundled regex scripts" close={() => { if (!busy) setPendingPreset(null); }}>
      <div className="preset-import-content">
        <p><strong>{pendingPreset.name}</strong> includes {pendingPreset.scripts.length} {pendingPreset.scripts.length === 1 ? "script" : "scripts"}. Enabled scripts can change messages or the prompts sent to the model while this preset is active.</p>
        <ul>{pendingPreset.scripts.map((rule, index) => <li key={index}><span>{rule.scriptName}</span><small>{rule.disabled ? "Off in file" : "On in file"}</small></li>)}</ul>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <footer className="preset-dialog-actions">
        <button type="button" className="quiet" disabled={busy} onClick={() => setPendingPreset(null)}>Cancel</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => void addPreset({
          name: pendingPreset.name, preset: pendingPreset.preset, bundledRegex: false,
        })}>Import only</button>
        <button type="button" className="primary" disabled={busy} onClick={() => void addPreset({
          name: pendingPreset.name, preset: pendingPreset.preset, bundledRegex: true,
        })}>Import and enable</button>
      </footer>
    </PresetDialog>}
  </section>;
}
