"use client";
import { useState } from "react";
import { importRules, type Rule } from "../lib/tavern";
import { PresetDialog } from "./preset-dialog";

export function downloadJson(name:string, value:unknown) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));
  const link=document.createElement("a");link.href=url;link.download=name+".json";link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function RegexEditor({initial,save,cancel,busy}:{initial:Rule;save:(r:Rule)=>Promise<boolean>;cancel:()=>void;busy:boolean}) {
  const [r,set]=useState(initial),[error,setError]=useState("");
  const [sample, setSample] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const patch=(v:Partial<Rule>)=>set({...r,...v});

  async function testRule() {
    setTesting(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/advanced", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview-regex", rule: r, text: sample }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResult(data.text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not run the regex test.");
    } finally {
      setTesting(false);
    }
  }
  return <PresetDialog title="Regex editor" close={cancel}>
    <form className="preset-prompt-form regex-editor" onSubmit={async event => {
      event.preventDefault();
      try {
        const script = { ...r, scriptName: r.scriptName.trim() };
        if (!script.scriptName) throw new Error("Enter a name for the script.");
        importRules(script);
        if (!(await save(script))) setError("The script could not be saved.");
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid regex script."); }
    }}>
    <details className="preset-triggers regex-test-mode">
      <summary>Test script</summary>
      <label>Sample text<textarea value={sample} maxLength={40000} onChange={event => setSample(event.target.value)} /></label>
      <button type="button" className="secondary" disabled={testing} onClick={() => void testRule()}>{testing ? "Testing…" : "Run test"}</button>
      {result !== null && <label>Test result<textarea readOnly value={result} /></label>}
    </details>
    <label>Script name<input required value={r.scriptName} onChange={e=>patch({scriptName:e.target.value})}/></label>
    <label>Find regex<input required value={r.findRegex} spellCheck={false} onChange={e=>patch({findRegex:e.target.value})}/></label>
    <label>Replace with<textarea rows={4} value={r.replaceString} spellCheck={false} onChange={e=>patch({replaceString:e.target.value})}/></label>
    <label>Trim out<textarea rows={2} placeholder="One entry per line" value={r.trimStrings?.join("\n") || ""} onChange={e=>patch({trimStrings:e.target.value.split("\n")})}/></label>
    <div className="regex-editor-options">
      <fieldset><legend>Affects</legend>{(["User input","AI response","Slash commands","World info","Reasoning"] as const).map((label,index)=>{
        const placement=[1,2,3,5,6][index];
        return <label className="preset-trigger-option" key={placement}><input type="checkbox" checked={r.placement.includes(placement)}
          onChange={event=>patch({placement:event.target.checked?[...r.placement,placement]:r.placement.filter(value=>value!==placement)})}/>{label}</label>;
      })}</fieldset>
      <fieldset><legend>Options</legend>
        {(["disabled","runOnEdit","markdownOnly","promptOnly"] as const).map((key,index)=><label className="preset-trigger-option" key={key}>
          <input type="checkbox" checked={!!r[key]} onChange={event=>patch({[key]:event.target.checked})}/>
          {["Disabled","Run on edit","Alter chat display","Alter outgoing prompt"][index]}</label>)}
      </fieldset>
      {(["minDepth","maxDepth"] as const).map((key,index)=><label key={key}>{index?"Maximum depth":"Minimum depth"}<input type="number" min="-1"
        placeholder="Unlimited" value={r[key]??""} onChange={event=>patch({[key]:event.target.value===""?null:event.target.valueAsNumber})}/></label>)}
    </div>
    <label>Macros in find regex<select value={r.substituteRegex || 0} onChange={event=>patch({substituteRegex:Number(event.target.value)})}>
      <option value={0}>Don’t substitute</option><option value={1}>Substitute raw</option><option value={2}>Substitute escaped</option>
    </select></label>
    {error && <p className="error" role="alert">{error}</p>}
    <footer className="preset-dialog-actions"><button type="button" className="quiet" onClick={cancel}>Cancel</button>
      <button type="submit" className="primary" disabled={busy}>Save script</button></footer>
    </form>
  </PresetDialog>;
}
