"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";

let dismissOpenTooltip: (() => void) | undefined;

export function SettingHelp({ label, children }: { label: string; children: string }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = !dismissed && (hovered || focused || pinned);

  useLayoutEffect(() => {
    const trigger = button.current;
    const tip = tooltip.current;
    if (!open || !trigger || !tip) return;

    function position(anchor: HTMLButtonElement, popup: HTMLSpanElement) {
      const rect = anchor.getBoundingClientRect();
      const { width, height } = popup.getBoundingClientRect();
      const inset = 8;
      const left = Math.max(inset, Math.min(rect.left + (rect.width - width) / 2, document.documentElement.clientWidth - width - inset));
      const above = rect.top - height - inset;
      const below = rect.bottom + inset;
      const top = above >= inset ? above : Math.max(inset, Math.min(below, window.innerHeight - height - inset));
      popup.style.left = Math.round(left) + "px";
      popup.style.top = Math.round(top) + "px";
    }

    const dismiss = () => { setPinned(false); setDismissed(true); };
    dismissOpenTooltip?.();
    dismissOpenTooltip = dismiss;
    tip.showPopover();
    const move = () => position(trigger, tip);
    move();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || dismissOpenTooltip !== dismiss) return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    document.addEventListener("keydown", escape, true);
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) {
        setHovered(false);
        dismiss();
      }
    });
    observer.observe(trigger);
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", move);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("scroll", move, true);
      window.removeEventListener("resize", move);
      if (tip.matches(":popover-open")) tip.hidePopover();
      if (dismissOpenTooltip === dismiss) dismissOpenTooltip = undefined;
    };
  }, [open]);

  return <span className="setting-help"
    onPointerEnter={event => { if (event.pointerType !== "touch") { setDismissed(false); setHovered(true); } }}
    onPointerLeave={() => setHovered(false)}
    onBlur={() => { setFocused(false); setPinned(false); }}>
    <button ref={button} type="button" aria-label={"About " + label} aria-describedby={id}
      onFocus={event => { setDismissed(false); setFocused(event.currentTarget.matches(":focus-visible")); }}
      onClick={() => { setDismissed(pinned); setPinned(!pinned); }}>
      <CircleHelp size={14} aria-hidden="true" />
    </button>
    <span ref={tooltip} className="setting-tooltip" popover="manual" role="tooltip" id={id}>{children}</span>
  </span>;
}

export function SettingsSwitch({ label, checked, disabled, onChange, help }: {
  label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; help?: string;
}) {
  const id = useId();
  return <div className="settings-switch-row">
    <div><span id={id}>{label}</span>{help && <SettingHelp label={label}>{help}</SettingHelp>}</div>
    <input type="checkbox" role="switch" className="preset-switch" aria-labelledby={id} checked={checked} disabled={disabled}
      onChange={event => onChange(event.target.checked)} />
  </div>;
}
