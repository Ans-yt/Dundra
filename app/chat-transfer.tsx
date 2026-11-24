"use client";

import { useEffect, useRef } from "react";
import { ArrowDownToLine, ArrowUpFromLine, FolderDown } from "lucide-react";

export async function chatImportBody(file: File, character: string) {
  if (file.size > 12_000_000) throw new Error("Choose a chat file under 12 MB.");
  return { action: "import-chat", character, title: file.name.replace(/\.jsonl$/i, "").slice(0, 100), text: await file.text() };
}

export function ChatTransfer({ chatId, locked, onImport }: { chatId: string; locked: boolean; onImport: (file: File) => void }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (menu.current?.open && !menu.current.contains(event.target as Node)) menu.current.open = false;
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  return <details className="chat-transfer" ref={menu} onKeyDown={event => {
    if (event.key !== "Escape" || !menu.current?.open) return;
    event.stopPropagation();
    menu.current.open = false;
    menu.current.querySelector("summary")?.focus();
  }}>
    <summary aria-label="Chat files" title="Chat files"><FolderDown size={16} aria-hidden="true" /></summary>
    <div className="chat-transfer-menu">
      <button type="button" className="quiet" disabled={locked} onClick={() => file.current?.click()}>
        <ArrowUpFromLine size={15} aria-hidden="true" /> Import chat
      </button>
      <a className="quiet" download href={"/api/library?format=jsonl&chat=" + encodeURIComponent(chatId)}
        onClick={() => { if (menu.current) menu.current.open = false; }}>
        <ArrowDownToLine size={15} aria-hidden="true" /> Export chat
      </a>
    </div>
    <input hidden ref={file} type="file" accept=".jsonl,application/x-ndjson" onChange={event => {
      const selected = event.target.files?.[0];
      event.target.value = "";
      if (!selected) return;
      if (menu.current) menu.current.open = false;
      onImport(selected);
    }} />
  </details>;
}
