"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { ColorPicker } from "./color-picker";
import { FontField, fontImportLimit, fontImportUrl, validFontName } from "./font-picker";

const storageKey = "dundra-visual-settings";
const themes = [
  { id: "plum", name: "Plum", description: "Dundra’s original style", accent: "#d5b5f1" },
  { id: "midnight", name: "Midnight", description: "Indigo panels and grouped navigation", accent: "#5865f2" },
  { id: "mint", name: "Mint", description: "White surfaces and compact controls", accent: "#0c8c5e" },
] as const;
type Theme = (typeof themes)[number]["id"];

const displayOptions = [
  { key: "density", label: "Library density", options: [["comfortable", "Comfortable"], ["compact", "Compact"]] },
  { key: "chatWidth", label: "Chat width", options: [["standard", "Standard"], ["narrow", "Narrow"], ["wide", "Wide"]] },
  { key: "corners", label: "Control corners", options: [["theme", "Theme default"], ["square", "Square"], ["rounded", "Rounded"]] },
  { key: "motion", label: "Motion", options: [["system", "Follow device"], ["reduced", "Reduced"]] },
] as const;
type DisplayOptions = {
  [Field in (typeof displayOptions)[number] as Field["key"]]: Field["options"][number][0];
};

const fontTargets = [["system", "Interface"], ["plain", "Chat text"], ["dialogue", "Dialogue"], ["italic", "Italics"], ["code", "Code"]] as const;
type FontTarget = (typeof fontTargets)[number][0];
const cssLimit = 60_000;
type Visuals = DisplayOptions & {
  fonts: Partial<Record<FontTarget, string>>;
  imports: Record<string, string>;
  css: string;
  scheme: Theme;
  accents: Partial<Record<Theme, string>>;
  size: number;
  chatSize: number;
};
const defaults: Visuals = {
  fonts: {}, imports: {}, css: "", scheme: "plum", accents: {}, size: 16, chatSize: 17,
  density: "comfortable", chatWidth: "standard", corners: "theme", motion: "system",
};
const isHexColor = (color: unknown): color is string => typeof color === "string" && /^#[\da-f]{6}$/i.test(color);

function readVisuals(): Visuals {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? localStorage.getItem("nitanor-visual-settings") ?? "{}");
    const scheme = value.scheme === "graphite" ? "midnight" : themes.find(item => item.id === value.scheme)?.id ?? defaults.scheme;
    const accents: Visuals["accents"] = {};
    for (const theme of themes) {
      const accent = value.accents?.[theme.id];
      if (isHexColor(accent)) accents[theme.id] = accent.toLowerCase();
    }
    if (!value.accents && isHexColor(value.accent) && value.accent.toLowerCase() !== "#d5b5f1") {
      accents[scheme] = value.accent.toLowerCase();
    }
    return {
      fonts: Object.fromEntries(fontTargets.flatMap(([key]) => typeof value.fonts?.[key] === "string" ? [[key, value.fonts[key].slice(0, 150)]] : [])),
      imports: Object.fromEntries(Object.entries(value.imports ?? {}).slice(0, fontImportLimit).flatMap(([name, source]) => {
        const url = typeof source === "string" && validFontName(name) ? fontImportUrl(source) : undefined;
        return url ? [[name, url]] : [];
      })),
      css: typeof value.css === "string" ? value.css.slice(0, cssLimit) : "",
      scheme, accents,
      size: Number.isInteger(value.size) && value.size >= 14 && value.size <= 20 ? value.size : defaults.size,
      chatSize: Number.isInteger(value.chatSize) && value.chatSize >= 12 && value.chatSize <= 32 ? value.chatSize : defaults.chatSize,
      density: value.density === "compact" ? "compact" : defaults.density,
      chatWidth: value.chatWidth === "narrow" || value.chatWidth === "wide" ? value.chatWidth : defaults.chatWidth,
      corners: value.corners === "square" || value.corners === "rounded" ? value.corners : defaults.corners,
      motion: value.motion === "reduced" ? "reduced" : defaults.motion,
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
  root.dataset.chatWidth = value.chatWidth;
  root.dataset.corners = value.corners;
  root.dataset.motion = value.motion;
  root.style.setProperty("--dundra-chat-size", value.chatSize + "px");
  root.style.setProperty("--visual-font-size", value.size + "px");
  const accent = value.accents[value.scheme];
  root.toggleAttribute("data-custom-accent", Boolean(accent));
  if (!accent) {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-ink");
    root.style.removeProperty("--accent-hover");
    return;
  }
  root.style.setProperty("--accent", accent);
  const channels = accent.slice(1).match(/../g)!.map(part => parseInt(part, 16) / 255);
  const luminance = channels.map((part) => part <= .04045 ? part / 12.92 : ((part + .055) / 1.055) ** 2.4)
    .reduce((sum, part, index) => sum + part * [.2126, .7152, .0722][index], 0);
  root.style.setProperty("--accent-ink", luminance > .179 ? "#000000" : "#ffffff");
  root.style.setProperty("--accent-hover", `color-mix(in srgb, ${accent} 90%, ${luminance > .179 ? "white" : "black"})`);
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
  const [accentOpen, setAccentOpen] = useState(false);
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

  const theme = themes.find(item => item.id === value.scheme) ?? themes[0];
  const customAccent = value.accents[theme.id];
  const accent = customAccent ?? theme.accent;

  return <div className="settings-stack">
    <section className="settings-panel appearance-panel">
      <div className="appearance-heading">
        <h2>Appearance</h2>
        <button type="button" className="quiet" onClick={() => {
          update(defaults);
          setDraftCss("");
          setNextFont("");
          setAccentOpen(false);
        }}>Reset appearance</button>
      </div>
      <fieldset className="theme-choices">
        <legend>Theme</legend>
        <div className="theme-grid">{themes.map(item => <label key={item.id} className="theme-choice">
          <input type="radio" name="theme" className="sr-only" value={item.id} checked={value.scheme === item.id}
            aria-label={item.name} onChange={() => update({ ...value, scheme: item.id })} />
          <span className="theme-preview" data-scheme={item.id} aria-hidden="true">
            <span className="theme-preview-bar"><i /><i /></span>
            <span className="theme-preview-sidebar"><i /><i /></span>
            <span className="theme-preview-content"><i /><i /><i /></span>
          </span>
          <span className="theme-caption"><strong>{item.name}</strong><Check size={16} aria-hidden="true" /></span>
          <small>{item.description}</small>
        </label>)}</div>
      </fieldset>
      <div className="appearance-accent">
        <div className="appearance-heading">
          <h3>Accent color</h3>
          <div className="appearance-accent-actions">
            {customAccent && <button type="button" className="quiet" onClick={() => {
              const accents = { ...value.accents };
              delete accents[theme.id];
              update({ ...value, accents });
            }}>Use theme color</button>}
            <button type="button" className="secondary accent-trigger" aria-expanded={accentOpen}
              aria-label={`Customize accent color, ${accent.toUpperCase()}`}
              onClick={() => setAccentOpen(!accentOpen)}>
              <span style={{ background: accent }} />{accent.toUpperCase()}<ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
        {accentOpen && <ColorPicker key={theme.id} value={accent} label="Accent"
          change={color => update({ ...value, accents: { ...value.accents, [theme.id]: color } })} />}
      </div>
      {warning && <p className="error" role="alert">{warning}</p>}
    </section>
    <section className="settings-panel display-panel">
      <h2>Layout and motion</h2>
      <div className="display-grid">{displayOptions.map(({ key, label, options }) => <div key={key}>
        <label htmlFor={"visual-" + key}>{label}</label>
        <select id={"visual-" + key} value={value[key]} onChange={event => update({ ...value, [key]: event.target.value })}>
          {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>)}</div>
    </section>
    <section className="settings-panel typography-panel">
      <h2>Typography</h2>
      <div className="type-specimens">{(["system", "plain"] as const).map(target => {
        const system = target === "system";
        const sizeKey = system ? "size" : "chatSize";
        const label = system ? "Interface" : "In-chat";
        return <fieldset className="type-specimen" key={target}><legend>{label}</legend>
          <div className={"type-preview type-preview-" + target} style={{ fontSize: value[sizeKey], fontFamily: system ? "var(--dundra-font-system, var(--interface-font))" : "var(--dundra-font-plain, Georgia, serif)" }}>
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
