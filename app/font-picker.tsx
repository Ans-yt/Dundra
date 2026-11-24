"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Check, ChevronDown, Link2, Search, X } from "lucide-react";

const fontChoices = ["system-ui", "Georgia", "Arial", "Segoe UI", "Lexend", "Inter", "DM Sans", "Instrument Serif", "IBM Plex Mono", "Consolas"];
export const fontImportLimit = 24;

export function fontImportUrl(input: string): string | undefined {
  const source = input.trim();
  const rule = /^@import\s+(?:url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)|"([^"]+)"|'([^']+)')\s*;?$/i.exec(source);
  try {
    const url = new URL(rule ? rule.slice(1).find(Boolean)! : source);
    if (url.protocol === "https:" && !url.username && !url.password && url.href.length <= 2048) return url.href;
  } catch { /* The field accepts only stylesheet URLs. */ }
}

export function validFontName(name: string) {
  return name.length > 0 && name.length <= 150 && /^[\p{L}\p{N} _.-]+$/u.test(name);
}

export function FontField({ label, value, imports, change, addImport }: {
  label: string;
  value: string;
  imports: Record<string, string>;
  change: (font: string) => void;
  addImport: (font: string, url: string) => void;
}) {
  const id = useId();
  const field = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const importName = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  function close(restoreFocus = false) {
    setOpen(false);
    setQuery("");
    setImporting(false);
    setError("");
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !field.current?.contains(event.target)) close();
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  useLayoutEffect(() => {
    const anchor = trigger.current;
    const popup = panel.current;
    if (!open || !anchor || !popup) return;
    popup.showPopover();
    const viewport = window.visualViewport;
    const position = () => {
      const rect = anchor.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      const topEdge = (viewport?.offsetTop ?? 0) + 8;
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 16;
      const panelWidth = Math.min(width - 16, Math.max(rect.width, 228));
      popup.style.width = panelWidth + "px";
      popup.style.maxHeight = bottomEdge - topEdge + "px";
      popup.style.left = Math.max(8, Math.min(rect.left, width - panelWidth - 8)) + "px";
      const height = popup.offsetHeight;
      const below = rect.bottom + 6;
      const above = rect.top - height - 6;
      const top = below + height <= bottomEdge ? below : above;
      popup.style.top = Math.max(topEdge, Math.min(top, bottomEdge - height)) + "px";
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(popup);
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    (importing ? importName.current : search.current)?.focus({ preventScroll: true });
  }, [open, importing]);

  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = 0;
  }, [open, query, importing]);

  const term = query.trim();
  const options = ["", ...new Set([...fontChoices, ...Object.keys(imports), ...(value ? [value] : [])])]
    .filter(font => (font || "Default").toLowerCase().includes(term.toLowerCase()));
  const custom = term && !options.some(font => (font || "Default").toLowerCase() === term.toLowerCase()) &&
    validFontStack(term);

  function choose(font: string) {
    change(font);
    close(true);
  }

  function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("font") ?? "").trim();
    const url = fontImportUrl(String(data.get("source") ?? ""));
    if (!validFontName(name)) return setError("Enter the font family name listed in the stylesheet.");
    if (!url) return setError("Enter an HTTPS stylesheet URL or a single @import rule.");
    if (!Object.hasOwn(imports, name) && Object.keys(imports).length >= fontImportLimit) {
      return setError("You can save up to 24 imported fonts.");
    }
    addImport(name, url);
    close(true);
  }

  return <div className="font-field" ref={field} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  }} onKeyDown={event => {
    if (!open || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  }}>
    <label id={id} htmlFor={id + "-trigger"}>{label}</label>
    <button id={id + "-trigger"} ref={trigger} type="button" className="font-trigger secondary" aria-expanded={open}
      aria-controls={open ? id + "-panel" : undefined} aria-labelledby={id + " " + id + "-value"}
      onClick={() => open ? close() : setOpen(true)}>
      <span id={id + "-value"}>{value || "Default"}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && <div id={id + "-panel"} className="font-picker-panel" ref={panel} popover="manual">
      {!importing && <>
        <div className="font-search"><Search size={16} aria-hidden="true" /><input ref={search} type="search" aria-label="Search fonts"
          placeholder="Search fonts…" value={query} maxLength={150} autoComplete="off" spellCheck={false} onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              list.current?.querySelector("button")?.focus();
            } else if (event.key === "Enter" && term) {
              event.preventDefault();
              if (options.length === 1) choose(options[0]);
              else if (custom) choose(term);
            }
          }} />
          {query && <button type="button" aria-label="Clear font search" onClick={() => {
            setQuery("");
            search.current?.focus({ preventScroll: true });
          }}><X size={15} aria-hidden="true" /></button>}
        </div>
        <div ref={list} className="font-options" aria-label="Font choices" onKeyDown={event => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          const options = [...event.currentTarget.querySelectorAll("button")];
          const index = options.indexOf(event.target as HTMLButtonElement);
          const target = index + (event.key === "ArrowUp" ? -1 : 1);
          if (target < 0) search.current?.focus();
          else options[target]?.focus();
        }}>
          {options.map(font => <button key={font} type="button" aria-pressed={font === value} onClick={() => choose(font)}>
            <span>{font || "Default"}</span>{font === value && <Check size={15} aria-hidden="true" />}
          </button>)}
          {custom && <button type="button" onClick={() => choose(term)}>Use “{term}”</button>}
          {!options.length && !custom && <small>No matching fonts.</small>}
        </div>
        <button type="button" className="quiet font-import-action" onClick={() => setImporting(true)}><Link2 size={15} /> Import font</button>
      </>}
      {importing && <form className="font-import-form" onSubmit={submitImport}>
        <label>Font family<input name="font" ref={importName} defaultValue={query.trim()} autoComplete="off" placeholder="e.g. DM Sans" required maxLength={150} /></label>
        <label>Stylesheet URL or @import<input name="source" autoComplete="off" placeholder="https://…" required maxLength={2080} /></label>
        <small>Use a trusted stylesheet that defines this font.</small>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="transfer-actions"><button className="secondary" type="button" onClick={() => { setError(""); setImporting(false); }}>Back</button>
          <button className="primary" type="submit">Use font</button></div>
      </form>}
    </div>}
  </div>;
}

function validFontStack(value: string) {
  return /^[\p{L}\p{N} '",_.-]+$/u.test(value) && /[\p{L}]/u.test(value);
}
