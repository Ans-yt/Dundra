"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { FontField, fontImportLimit, fontImportUrl, validFontName } from "./font-picker";

const storageKey = "dundra-visual-settings";
const schemes = [
  { id: "plum", name: "Plum", color: "#24232e" },
  { id: "graphite", name: "Graphite", color: "#252830" },
  { id: "twilight", name: "Twilight", color: "#2c2338" },
] as const;

const fontTargets = [["system", "Interface"], ["plain", "Chat text"], ["dialogue", "Dialogue"], ["italic", "Italics"], ["code", "Code"]] as const;
type FontTarget = (typeof fontTargets)[number][0];
const cssLimit = 60_000;
type Visuals = { fonts: Partial<Record<FontTarget, string>>; imports: Record<string, string>; css: string; scheme: (typeof schemes)[number]["id"]; accent: string; size: number; chatSize: number; density: "comfortable" | "compact" };
const defaults: Visuals = { fonts: {}, imports: {}, css: "", scheme: "plum", accent: "#d5b5f1", size: 16, chatSize: 17, density: "comfortable" };

function readVisuals(): Visuals {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? localStorage.getItem("nitanor-visual-settings") ?? "{}");
    return {
      fonts: Object.fromEntries(fontTargets.flatMap(([key]) => typeof value.fonts?.[key] === "string" ? [[key, value.fonts[key].slice(0, 150)]] : [])),
      imports: Object.fromEntries(Object.entries(value.imports ?? {}).slice(0, fontImportLimit).flatMap(([name, source]) => {
        const url = typeof source === "string" && validFontName(name) ? fontImportUrl(source) : undefined;
        return url ? [[name, url]] : [];
      })),
      css: typeof value.css === "string" ? value.css.slice(0, cssLimit) : "",
      scheme: schemes.find((item) => item.id === value.scheme)?.id || defaults.scheme,
      accent: /^#[\da-f]{6}$/i.test(value.accent) ? value.accent : defaults.accent,
      size: Number.isInteger(value.size) && value.size >= 14 && value.size <= 20 ? value.size : defaults.size,
      chatSize: Number.isInteger(value.chatSize) && value.chatSize >= 12 && value.chatSize <= 32 ? value.chatSize : defaults.chatSize,
      density: value.density === "compact" ? "compact" : defaults.density,
    };
  } catch { return defaults; }
}

function applyVisuals(value: Visuals) {
  const root = document.documentElement;
  const fontUrls = new Set(Object.values(value.fonts).flatMap(font => Object.hasOwn(value.imports, font) ? [value.imports[font]] : []));
  for (const link of document.head.querySelectorAll<HTMLLinkElement>("link[data-dundra-font]")) {
    if (!fontUrls.delete(link.href)) link.remove();
  }
  for (const url of fontUrls) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.dataset.dundraFont = "";
    document.head.insertBefore(link, document.getElementById("dundra-custom-css"));
  }
  for (const [target] of fontTargets) {
    const font = value.fonts[target]?.trim();
    if (font) root.style.setProperty("--dundra-font-" + target, fontValue(font, value.imports));
    else root.style.removeProperty("--dundra-font-" + target);
  }
  let stylesheet = document.getElementById("dundra-custom-css");
  if (!stylesheet && value.css) {
    stylesheet = document.createElement("style");
    stylesheet.id = "dundra-custom-css";
    document.head.append(stylesheet);
  }
  if (stylesheet && stylesheet.textContent !== value.css) stylesheet.textContent = value.css;
  root.dataset.scheme = value.scheme;
  root.dataset.density = value.density;
  root.style.setProperty("--accent", value.accent);
  root.style.setProperty("--dundra-chat-size", value.chatSize + "px");
  root.style.setProperty("--visual-font-size", value.size + "px");
  const channels = value.accent.slice(1).match(/../g)!.map((part) => parseInt(part, 16) / 255);
  const luminance = channels.map((part) => part <= .04045 ? part / 12.92 : ((part + .055) / 1.055) ** 2.4)
    .reduce((sum, part, index) => sum + part * [.2126, .7152, .0722][index], 0);
  root.style.setProperty("--accent-ink", luminance > .18 ? "#141019" : "#ffffff");
  root.style.setProperty("--accent-hover", "color-mix(in srgb, " + value.accent + " 90%, " + (luminance > .18 ? "white" : "black") + ")");
}

export function useVisualPreferences() {
  useEffect(() => { applyVisuals(readVisuals()); }, []);
}

function fontValue(font: string, imports: Record<string, string>) {
  return Object.hasOwn(imports, font) ? JSON.stringify(font) : font;
}

export function VisualSettings() {
  const [value, setValue] = useState(defaults);
  const [warning, setWarning] = useState("");
  const [draftCss, setDraftCss] = useState("");
  const [nextFont, setNextFont] = useState<FontTarget | "">("");
  useEffect(() => {
    const saved = readVisuals();
    setValue(saved);
    setDraftCss(saved.css);
  }, []);
  const targets = fontTargets.filter(([key]) => key !== "system" && key !== "plain" && key in value.fonts);
  const available = fontTargets.filter(([key]) => key !== "system" && key !== "plain" && !(key in value.fonts));

  function update(next: Visuals) {
    setValue(next);
    applyVisuals(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setWarning("");
    } catch { setWarning("Your browser could not save these changes for next time."); }
  }

  function fontField(target: FontTarget, label: string) {
    return <FontField label={label} value={value.fonts[target] ?? ""} imports={value.imports}
      change={font => update({ ...value, fonts: { ...value.fonts, [target]: font } })}
      addImport={(font, url) => update({ ...value, fonts: { ...value.fonts, [target]: font }, imports: { ...value.imports, [font]: url } })} />;
  }

  return <div className="settings-stack">
    <section className="settings-panel">
      <h2>Appearance</h2>
      <p>Changes apply as you make them and are saved in this browser.</p>
      <fieldset className="theme-choices">
        <legend>Color scheme</legend>
        <div>{schemes.map((item) => <button key={item.id} type="button" aria-pressed={value.scheme === item.id}
          className="theme-choice" onClick={() => update({ ...value, scheme: item.id })}>
          <span style={{ background: item.color }} />{item.name}
        </button>)}</div>
      </fieldset>
      <div className="visual-row">
        <label htmlFor="visual-accent">Accent color</label><input id="visual-accent" type="color" value={value.accent} onChange={(e) => update({ ...value, accent: e.target.value })} />
      </div>
      <div className="visual-row">
        <label htmlFor="visual-density">Library density</label>
        <select id="visual-density" value={value.density} onChange={(e) => update({ ...value, density: e.target.value === "compact" ? "compact" : "comfortable" })}>
          <option value="comfortable">Comfortable</option><option value="compact">Compact</option>
        </select>
      </div>
      <button className="secondary" onClick={() => { update(defaults); setDraftCss(""); setNextFont(""); }}>Reset appearance</button>
      {warning && <p className="error" role="alert">{warning}</p>}
    </section>
    <section className="settings-panel typography-panel">
      <h2>Typography</h2>
      <div className="type-specimens">{(["system", "plain"] as const).map(target => {
        const system = target === "system";
        const sizeKey = system ? "size" : "chatSize";
        const label = system ? "Interface" : "In-chat";
        return <fieldset className="type-specimen" key={target}><legend>{label}</legend>
          <div className={"type-preview type-preview-" + target} style={{ fontSize: value[sizeKey], fontFamily: system ? "var(--dundra-font-system, system-ui)" : "var(--dundra-font-plain, Georgia, serif)" }}>
            {system ? "Character library" : "The lantern flickered."}
          </div>
          {fontField(target, label + " font")}
          <label className="type-size">{label} size <select value={value[sizeKey]} onChange={e => update({ ...value, [sizeKey]: Number(e.target.value) })}>
            {Array.from({ length: system ? 7 : 21 }, (_, i) => i + (system ? 14 : 12)).map(px => <option key={px} value={px}>{px} px</option>)}
          </select></label>
        </fieldset>;
      })}</div>
      <div className="type-overrides-head"><h3>Text styles</h3><button type="button" className="secondary" aria-label="Add font override"
        disabled={!available.length} onClick={() => setNextFont(nextFont ? "" : available[0]?.[0] || "")}><Plus size={15}/> Add override</button></div>
      {nextFont && <div className="font-row"><label>Apply font to<select value={nextFont} onChange={event => setNextFont(event.target.value as FontTarget)}>
        {available.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label><button type="button" className="secondary" onClick={() => {
        update({ ...value, fonts: { ...value.fonts, [nextFont]: "" } }); setNextFont("");
      }}>Add</button></div>}
      {targets.map(([target, label]) => <div className="font-row" key={target}>
        {fontField(target, label + " font")}
        <button type="button" className="quiet" aria-label={"Remove " + label + " font override"} onClick={() => {
          const fonts = { ...value.fonts };
          delete fonts[target];
          update({ ...value, fonts });
        }}><X size={17}/></button>
      </div>)}
    </section>
    <section className="settings-panel typography-panel stylesheet-panel"><h2>Custom CSS</h2>
      <label className="custom-css-label">Stylesheet
        <textarea spellCheck={false} rows={5} maxLength={cssLimit} value={draftCss} placeholder={".chat-prose { line-height: 1.8; }"}
          onChange={event => setDraftCss(event.target.value)} aria-describedby="css-help" />
      </label>
      <small id="css-help">Use Dundra’s selectors to style the interface. For fonts, use Import font in a font picker.</small>
      <div className="transfer-actions">
        <button type="button" className="primary" disabled={draftCss === value.css} onClick={() => update({ ...value, css: draftCss })}>Apply CSS</button>
        {value.css && <button type="button" className="secondary" onClick={() => { update({ ...value, css: "" }); setDraftCss(""); }}>Clear CSS</button>}
      </div>
    </section>
  </div>;
}
