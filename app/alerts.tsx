"use client";

import { useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Info, Terminal, TriangleAlert, X } from "lucide-react";
import type { Problem } from "../lib/diagnostics";
import { PresetDialog } from "./preset-dialog";

const tones = { error: CircleAlert, warning: TriangleAlert, success: CheckCircle2, info: Info };

export function AppAlert({ message, details, tone = "error", dismiss, className = "" }: Problem & {
  tone?: keyof typeof tones; dismiss?: () => void; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const Icon = tones[tone];
  const content = <><Icon className="app-alert-icon" size={17} aria-hidden="true" /><span>{message}</span></>;

  return <div className={"app-alert " + className} data-tone={tone} role={tone === "error" || tone === "warning" ? "alert" : "status"}>
    {details ? <button ref={trigger} className="app-alert-content" type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      {content}<span className="app-alert-details"><Terminal size={15} aria-hidden="true" /> Details</span>
    </button> : <div className="app-alert-content">{content}</div>}
    {dismiss && <button className="app-alert-dismiss quiet" type="button" aria-label="Dismiss alert" onClick={dismiss}><X size={16} /></button>}
    {open && details && <PresetDialog title="Error details" close={() => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); }} className="alert-dialog">
      <pre tabIndex={0}>{details}</pre>
    </PresetDialog>}
  </div>;
}
