"use client";

import { useEffect, type RefObject } from "react";

const distance = 12;
const controls = 'input:not([type="hidden"], [type="file"]), textarea, .opening-bar, .character-lore-list li';

export function useHeaderJoin(form: RefObject<HTMLFormElement | null>) {
  useEffect(() => {
    const editor = form.current;
    const header = editor?.closest(".shell")?.querySelector<HTMLElement>(".masthead");
    if (!editor || !header) return;
    let frame = 0;
    const properties = ["--join-x", "--join-width", "--join-depth", "--join-strength"];
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const top = header.getBoundingClientRect().bottom;
        const field = Array.from(editor.querySelectorAll<HTMLElement>(controls), item => item.getBoundingClientRect())
          .filter(rect => rect.width > 0 && rect.height > 0 && Math.abs(rect.top - top) < distance)
          .sort((a, b) => Math.abs(a.top - top) - Math.abs(b.top - top))[0];
        if (!field) { header.style.setProperty("--join-strength", "0"); return; }
        const gap = field.top - top;
        const headerLeft = header.getBoundingClientRect().left;
        const strength = 1 - Math.abs(gap) / distance;
        header.style.setProperty("--join-x", field.left - headerLeft + "px");
        header.style.setProperty("--join-width", field.width + "px");
        header.style.setProperty("--join-depth", Math.max(3, gap + 3) + "px");
        header.style.setProperty("--join-strength", String(strength));
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(editor);
    observer.observe(header);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      properties.forEach(name => header.style.removeProperty(name));
    };
  }, [form]);
}
