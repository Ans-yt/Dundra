"use client";

import { useRef, useState, type PointerEvent } from "react";

type HSV = { h: number; s: number; v: number };
const clamp = (n: number, max = 1) => Math.min(max, Math.max(0, n));
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const hexColor = (channels: number[]) => "#" + channels.map(n => Math.round(clamp(n, 255)).toString(16).padStart(2, "0")).join("");

function fromHex(hex: string, priorHue: number): HSV {
  const [r, g, b] = rgb(hex).map(n => n / 255);
  const v = Math.max(r, g, b), d = v - Math.min(r, g, b);
  const sector = v === r ? (g - b) : v === g ? b - r : r - g;
  const h = d ? (360 + 60 * (sector / d + (v === r ? 0 : v === g ? 2 : 4))) % 360 : priorHue;
  return { h, s: v ? d / v : 0, v };
}
function toHex({ h, s, v }: HSV) {
  return hexColor([5, 3, 1].map(n => {
    const k = (n + h / 60) % 6;
    return 255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)));
  }));
}
function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
}

export function ColorPicker({ value, label, disabled, change }: {value: string; label: string; disabled?: boolean; change: (value: string) => void}) {
  const [color, setColor] = useState(() => fromHex(value, 0));
  const last = useRef(value);
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [format, setFormat] = useState("Hex");
  const [background, setBackground] = useState("#2e2e35");
  const current = last.current === value ? color : fromHex(value, color.h);
  const { h, s, v } = current;
  const light = v * (1 - s / 2);
  const sat = light === 0 || light === 1 ? 0 : (v - light) / Math.min(light, 1 - light);
  const ratio = (Math.max(luminance(value), luminance(background)) + .05) / (Math.min(luminance(value), luminance(background)) + .05);
  function update(next: HSV) {
    const hex = toHex(next);
    last.current = hex;
    setColor(next);
    setHexDraft(null);
    change(hex);
  }
  function point(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    update({ h, s: clamp((e.clientX - rect.left) / rect.width), v: 1 - clamp((e.clientY - rect.top) / rect.height) });
  }
  const channels = format === "RGB" ? rgb(value) : [Math.round(h), Math.round(100 * sat), Math.round(100 * light)];
  function editChannel(i: number, n: number) {
    const next = [...channels];
    next[i] = n;
    if (format === "RGB") return update(fromHex(hexColor(next), h));
    const [hue, saturation, brightness] = next;
    const l = brightness / 100, v = l + saturation / 100 * Math.min(l, 1 - l);
    update({ h: hue, v, s: v ? 2 * (1 - l / v) : 0 });
  }
  return <div className="spectrum-picker" ref={el => {
    if (!el) return;
    const bg = getComputedStyle(el).getPropertyValue("--page").trim();
    if (/^#[0-9a-f]{6}$/i.test(bg) && bg !== background) setBackground(bg);
  }}>
    <div className="spectrum-field" role="group" aria-label={label + " saturation and brightness"} style={{ backgroundColor: `hsl(${h} 100% 50%)` }}
      onPointerDown={e => { if (!disabled && e.button === 0) { e.currentTarget.setPointerCapture(e.pointerId); point(e); } }}
      onPointerMove={e => { if (!disabled && e.currentTarget.hasPointerCapture(e.pointerId)) point(e); }}>
      <i style={{ left: 100*s+"%", top: 100*(1-v)+"%", background: value }}/>
    </div>
    <input className="spectrum-hue" type="range" min={0} max={359} aria-label={label+" hue"} disabled={disabled}
      value={Math.round(h)%360} onChange={e => update({ ...current, h: e.target.valueAsNumber })}/>
    <div className="spectrum-values"><select aria-label="Color format" value={format} disabled={disabled} onChange={e => setFormat(e.target.value)}>
      {["Hex","RGB","HSL"].map(f => <option key={f}>{f}</option>)}</select>
      {format === "Hex" ? <input aria-label={label+" hex color"} value={hexDraft ?? value} maxLength={7} disabled={disabled}
        onChange={e => {
          const input = e.target.value;
          if (/^#?[0-9a-f]{6}$/i.test(input)) update(fromHex("#"+input.replace("#",""),h));
          setHexDraft(input);
        }}
        onBlur={() => setHexDraft(null)}
        onKeyDown={e => { if(e.key==="Enter"){ e.preventDefault(); e.currentTarget.blur(); } }}/> : channels.map((n,i) => <label key={format+i}>{format[i]}
        <input key={n} aria-label={label+" "+format[i]} type="number" defaultValue={n} min={0} max={format==="RGB"?255:i===0?359:100} disabled={disabled}
          onBlur={e => { const field=e.currentTarget; if (field.value && field.validity.valid) editChannel(i,field.valueAsNumber); else field.value=String(n); }}
          onKeyDown={e => { if(e.key==="Enter"){ e.preventDefault(); e.currentTarget.blur(); } }}/></label>)}
    </div>
    <div className="spectrum-swatches">{["#ff6547","#ffe2bc","#ffbf46","#a8dfad","#43ccbc","#46aaf4","#8063ec","#f6bedb","#f5efff"].map(hex =>
      <button type="button" key={hex} style={{background:hex}} aria-label={label+" swatch "+hex} disabled={disabled} onClick={() => update(fromHex(hex,h))}/>)}</div>
    <div className="spectrum-contrast"><b style={{color:value,background}}>Aa</b><span>Text contrast <strong>{ratio.toFixed(2)}:1</strong></span>
      <small title="Normal text contrast against the page color">{ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : "Low"}</small></div>
  </div>;
}
