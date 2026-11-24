"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function PresetDialog({ title, close, children, compact = false }: { title: string; close: () => void; children: ReactNode; compact?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { dialog.current?.showModal(); }, []);

  return <dialog ref={dialog} className={compact ? "preset-dialog preset-dialog-compact" : "preset-dialog"} aria-labelledby={titleId}
    onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}
    onCancel={event => { event.preventDefault(); close(); }}>
    <div className="preset-dialog-head">
      <h2 id={titleId}>{title}</h2>
      <button type="button" className="quiet preset-icon" aria-label="Close dialog" onClick={close}><X size={18} /></button>
    </div>
    {children}
  </dialog>;
}
