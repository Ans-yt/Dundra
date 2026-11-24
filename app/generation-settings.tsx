"use client";

import { useEffect, useState, type FormEvent } from "react";
import { defaultGeneration, generationRanges, type GenerationConfig, type GenerationNumber, type GenerationSettings } from "../lib/generation";

const controls: Record<GenerationNumber, { label: string; detail: string; sliderStep?: number }> = {
  temperature: { label: "Temperature", detail: "Lower values make replies more focused. Higher values add variety." },
  maxOutput: { label: "Max output tokens", detail: "Limit replies to 50,000 tokens or fewer. Set to 0 to use the provider’s default.", sliderStep: 50 },
  contextSize: { label: "Context size", detail: "Estimated prompt budget, including instructions and recent messages. Use a size your model supports.", sliderStep: 1 },
  topK: { label: "Top K", detail: "Limits how many candidate tokens are considered. 0 uses the provider’s default." },
  topP: { label: "Top P", detail: "Limits the combined probability of candidate tokens. 0 uses the provider’s default." },
  repetitionPenalty: { label: "Repetition penalty", detail: "Values above 1 discourage repeats on supported providers. 0 uses the provider’s default." },
  frequencyPenalty: { label: "Frequency penalty", detail: "Positive values discourage repeated words. Negative values encourage them." },
};

function NumberControl({ name, value, change }: { name: GenerationNumber; value: number; change: (value: number) => void }) {
  const { label, detail, sliderStep } = controls[name];
  const range = generationRanges[name];
  return <div className="generation-control">
    <label htmlFor={name}>{label}</label>
    <div className="generation-inputs">
      <input aria-label={label + " slider"} type="range" min={range.min} max={range.max} step={sliderStep || range.step}
        value={value} onChange={(event) => change(event.target.valueAsNumber)} />
      <input id={name} type="number" {...range} value={Number.isNaN(value) ? "" : value} required
        aria-describedby={name + "-detail"} onChange={(event) => change(event.target.valueAsNumber)} />
    </div>
    <small id={name + "-detail"}>{detail}</small>
  </div>;
}

async function read(response: Response): Promise<GenerationConfig> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not save generation settings.");
  return body;
}

export function PromptSettings({ presets = false, promptsOnly = false, initialPrompt = "", onSaved }: {
  presets?: boolean; promptsOnly?: boolean; initialPrompt?: string; onSaved?: (config: GenerationConfig) => void;
}) {
  const [config, setConfig] = useState<GenerationConfig | null>(null);
  const [draft, setDraft] = useState(defaultGeneration);
  const [preset, setPreset] = useState("");
  const [name, setName] = useState("");
  const [promptId, setPromptId] = useState("");
  const [promptName, setPromptName] = useState("");
  const [promptText, setPromptText] = useState("");
  const [promptFeedback, setPromptFeedback] = useState<{ message: string; error?: boolean } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(true);
  const [reload, setReload] = useState(0);
  const apply = setDraft;
  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    setError("");
    fetch("/api/generation", { cache: "no-store", signal: controller.signal }).then(read)
      .then((saved) => {
        if (controller.signal.aborted) return;
        setConfig(saved);
        apply(saved.current);
        const prompt = saved.prompts.find(item => item.id === initialPrompt);
        if (prompt) { setPromptId(prompt.id); setPromptName(prompt.name); setPromptText(prompt.content); }
      })
      .catch((cause: Error) => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, [reload, initialPrompt]);

  async function save(action: "save" | "preset" | "delete") {
    if (pending) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const saved = await read(await fetch("/api/generation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, action, name: action === "delete" ? preset : name.trim() }),
      }));
      setConfig(saved);
      if (action !== "delete") apply(saved.current);
      if (action === "preset") { setPreset(name.trim()); setName(""); }
      if (action === "delete") setPreset("");
      setNotice(action === "save" ? "Generation settings saved." : action === "preset" ? "Preset saved and applied." : "Preset removed.");
      onSaved?.(saved);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save generation settings."); }
    finally { setPending(false); }
  }

  function choosePrompt(id: string) {
    setPromptFeedback(null);
    const prompt = config?.prompts.find((item) => item.id === id);
    setPromptId(id);
    setPromptName(prompt?.name || "");
    setPromptText(prompt?.content || "");
  }

  async function savePrompt(action: "save-prompt" | "delete-prompt" | "use-prompt") {
    if (pending) return;
    setPending(true);
    setPromptFeedback(null);
    try {
      const saved = await read(await fetch("/api/generation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id: promptId, name: promptName.trim(), content: promptText }),
      }));
      setConfig(saved);
      if (action === "save-prompt") {
        const prompt = saved.prompts.find((item) => item.name === promptName.trim());
        if (prompt) { setPromptId(prompt.id); setPromptName(prompt.name); setPromptText(prompt.content); }
        setPromptFeedback({ message: "Prompt saved." });
      } else if (action === "use-prompt") {
        setDraft((prior) => ({ ...prior, globalPrompt: saved.current.globalPrompt }));
        setPromptFeedback({ message: "Global prompt updated." });
      } else {
        choosePrompt("");
        setPromptFeedback({ message: "Prompt removed from the library." });
      }
      onSaved?.(saved);
    } catch (cause) { setPromptFeedback({ message: cause instanceof Error ? cause.message : "Could not update the prompt.", error: true }); }
    finally { setPending(false); }
  }

  if (!config) return pending ? <p className="notice" role="status">Loading prompts and presets…</p>
    : <><p className="error" role="alert">{error}</p><button className="secondary" onClick={() => setReload((value) => value + 1)}>Try again</button></>;

  const update = (key: keyof GenerationSettings, value: string | number) => {
    setDraft((settings) => ({ ...settings, [key]: value }));
    setNotice("");
  };
  const number = (key: GenerationNumber) => <NumberControl key={key} name={key} value={draft[key]} change={(value) => update(key, value)} />;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const button = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    void save(button?.value === "preset" ? "preset" : "save");
  }

  return <form className="settings-stack" onSubmit={submit}>
    <section className="settings-panel">
      <h2>Prompt library</h2>
      <p>Save reusable prompts and assign one to a model profile or use it as the global prompt.</p>
      <label>Saved prompt<select value={promptId} disabled={pending} onChange={(event) => choosePrompt(event.target.value)}>
        <option value="">New prompt…</option>
        {config.prompts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Prompt name<input value={promptName} disabled={pending} maxLength={60} onChange={(event) => setPromptName(event.target.value)} /></label>
      <label>Prompt text<textarea value={promptText} disabled={pending} maxLength={30000} rows={4} onChange={(event) => setPromptText(event.target.value)} /></label>
      <div className="transfer-actions">
        <button type="button" className="secondary" disabled={pending || !promptName.trim() || !promptText.trim()} onClick={() => void savePrompt("save-prompt")}>Save prompt</button>
        {promptId && <>
          <button type="button" className="quiet" disabled={pending} onClick={() => void savePrompt("use-prompt")}>Use saved prompt globally</button>
          <button type="button" className="quiet" disabled={pending} onClick={() => choosePrompt("")}>New prompt</button>
          <button type="button" className="quiet danger" disabled={pending} onClick={() => {
            if (window.confirm("Remove this prompt from the library?")) void savePrompt("delete-prompt");
          }}>Remove prompt</button>
        </>}
      </div>
      {promptFeedback && <p className={promptFeedback.error ? "error" : "notice"} role={promptFeedback.error ? "alert" : "status"}>{promptFeedback.message}</p>}
    </section>
    {presets && <section className="settings-panel">
      <h2>Presets</h2>
      <div className="preset-row">
        <label>Saved preset<select value={preset} onChange={(event) => {
          const selected = config.presets.find((item) => item.name === event.target.value);
          setPreset(event.target.value);
          if (selected) { apply(selected.settings); setNotice("Preset loaded. Save settings to use it in chats."); }
        }}>
          <option value="">Choose a preset</option>
          {config.presets.map((item) => <option key={item.name}>{item.name}</option>)}
        </select></label>
        <button type="button" className="quiet danger" disabled={!preset || pending} onClick={() => void save("delete")}>Remove preset</button>
      </div>
      <div className="preset-row">
        <label>Preset name<input value={name} maxLength={60} placeholder="Name this setup" onChange={(event) => setName(event.target.value)} /></label>
        <button className="secondary" value="preset" disabled={pending || !name.trim()}>Save as preset</button>
      </div>
    </section>}
    <section className="settings-panel">
      <h2>Instructions</h2>
      <p>A prompt assigned to the active model profile takes priority over the global prompt.</p>
      <details className="instruction-item">
        <summary>Global prompt <small>{draft.globalPrompt ? "On" : "None"}</small></summary>
        <label>Global prompt<textarea value={draft.globalPrompt} maxLength={30000} rows={5} onChange={(event) => update("globalPrompt", event.target.value)} /></label>
      </details>
      <details className="instruction-item">
        <summary>Prefill <small>{draft.prefill ? "On" : "Off"}</small></summary>
        <label>Start each AI reply with<textarea value={draft.prefill} maxLength={2000} rows={3} onChange={(event) => update("prefill", event.target.value)} /></label>
        <p>Requires a provider that accepts an assistant prefix.</p>
      </details>
    </section>
    {!promptsOnly && <><section className="settings-panel">
      <div className="settings-panel-heading"><h2>Generation</h2>
        <button type="button" className="quiet" onClick={() => { apply(defaultGeneration); setPreset(""); setNotice("Defaults loaded. Save settings to apply them."); }}>Reset to defaults</button>
      </div>
      {number("temperature")}{number("maxOutput")}{number("contextSize")}
    </section>
    <section className="settings-panel">
      <h2>Advanced settings</h2>
      <p>Available controls depend on your model and provider.</p>
      {(["topK", "topP", "repetitionPenalty", "frequencyPenalty"] as const).map(number)}
    </section></>}
    <div className="settings-save">
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      <button className="primary" value="save" disabled={pending}>{pending ? "Saving…" : promptsOnly ? "Save instructions" : "Save settings"}</button>
    </div>
  </form>;
}
