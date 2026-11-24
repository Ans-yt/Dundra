"use client";

import { useState } from "react";
import { BookOpen, Cable, Palette, SlidersHorizontal } from "lucide-react";
import { ModelSettingsForm } from "./model-settings";
import { PromptSettings } from "./generation-settings";
import { VisualSettings } from "./visual-settings";
import { LorebookEditor } from "./lorebooks";

import { AdvancedControls } from "./advanced";
import type { Advanced } from "../lib/tavern";
const sections = [
  { id: "model", label: "Model", icon: Cable },
  { id: "visuals", label: "Visuals", icon: Palette },
  { id: "prompts", label: "Prompts", icon: SlidersHorizontal },
  { id: "lorebooks", label: "Lorebooks", icon: BookOpen },
  { id:"advanced", label:"Advanced", icon: SlidersHorizontal },
] as const;

export function SettingsView({ advanced, onSaved }: { advanced: Advanced; onSaved: (model: string | null) => void }) {
  const [active, setActive] = useState<(typeof sections)[number]["id"]>("model");
  return <section className="section settings-layout">
    <aside className="settings-sidebar">
      <h1>Settings</h1>
      <nav aria-label="Settings sections">{sections.map(({ id, label, icon: Icon }) =>
        <button key={id} type="button" aria-current={active === id ? "page" : undefined} onClick={() => setActive(id)}>
          <Icon size={17} />{label}
        </button>)}</nav>
    </aside>
    <div className="settings-content">
      {active === "advanced" && <AdvancedControls config={advanced} />}
      {active === "model" && <ModelSettingsForm onSaved={onSaved} />}
      {active === "lorebooks" && <LorebookEditor />}
      {active === "visuals" && <VisualSettings />}
      {active === "prompts" && <PromptSettings presets={advanced.enabled && advanced.presets} />}
    </div>
  </section>;
}
