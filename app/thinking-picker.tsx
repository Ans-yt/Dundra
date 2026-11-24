"use client";

import { useId, useRef, useState } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { thinkingLabel } from "../lib/thinking";

export function ThinkingPicker({ model, levels, value, disabled, change }: {
  model: string; levels: string[]; value: string; disabled: boolean; change: (value: string) => void;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const options = ["", ...levels];
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, bottom: 0 });
  const label = (level: string) => level ? thinkingLabel(level) : "Provider default";
  const commit = (next: number) => {
    if (!disabled && options[next] !== value) change(options[next]);
  };
  return <>
    <button type="button" className="effort-trigger" aria-label={"Thinking level: " + label(value)} aria-expanded={open}
      disabled={disabled} popoverTarget={id} onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        setPosition({ left: Math.max(8, Math.min(rect.right - 232, window.innerWidth - 240)), bottom: window.innerHeight - rect.top + 8 });
        setIndex(Math.max(0, options.indexOf(value)));
      }}><span>{label(value)}</span><ChevronDown size={13} aria-hidden="true"/></button>
    <div ref={panel} id={id} popover="auto" className="effort-panel" style={position} onToggle={e => setOpen(e.newState === "open")}
      onBlur={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) panel.current?.hidePopover(); }}>
      <strong key={index}>{label(options[index] || "")}</strong><small title={model}>{model}</small>
      <button type="button" aria-label="Reset thinking to provider default" title="Use provider default" disabled={disabled}
        onClick={() => { setIndex(0); commit(0); }}><RotateCcw size={14}/></button>
      <div className="effort-track" style={{ "--effort": `${100 * index / (levels.length || 1)}%` } as React.CSSProperties}>
        <span className="effort-fill" aria-hidden="true"/><span className="effort-thumb" aria-hidden="true"/>
        <div aria-hidden="true">{options.map(level => <i key={level}/>)}</div>
        <input type="range" aria-label="Thinking level" aria-valuetext={label(options[index] || "")} min={0} max={levels.length} value={index}
          disabled={disabled || !levels.length} onChange={e => { setIndex(e.target.valueAsNumber); }}
          onPointerUp={e => commit(e.currentTarget.valueAsNumber)} onKeyUp={e => commit(e.currentTarget.valueAsNumber)}
          onBlur={e => commit(e.currentTarget.valueAsNumber)} />
      </div>
    </div>
  </>;
}
