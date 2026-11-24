"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";

export function mediaUrl(kind: "persona" | "background", id: string, version: string) {
  return "/api/media?" + new URLSearchParams({ kind, id, v: version });
}

export const imageTypes = "image/png,image/jpeg,image/webp,image/gif";

export function useImageUpload(change: (image: string | null) => void) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef<FileReader | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  useEffect(() => () => { latest.current?.abort(); }, []);
  function remove() { latest.current?.abort(); setReading(false); setError(""); change(null); }
  function read(file?: File) {
    if (!file) return;
    latest.current?.abort();
    setError("");
    if (!imageTypes.split(",").includes(file.type) || file.size > 5 * 1024 * 1024) {
      setReading(false);
      setError("Choose a PNG, JPEG, WebP, or GIF up to 5 MB.");
      return;
    }
    const reader = new FileReader();
    latest.current = reader;
    setReading(true);
    reader.onerror = () => setError("Could not read the image.");
    reader.onload = () => change(String(reader.result));
    reader.onloadend = () => { if (latest.current === reader) setReading(false); };
    reader.readAsDataURL(file);
  }
  return { input, read, remove, reading, error };
}

export function ImagePicker({ label, src, disabled, change, avatar = false }: { label: string; src?: string | null; disabled?: boolean; change: (image: string | null) => void; avatar?: boolean }) {
  const { input, read, remove, error } = useImageUpload(change);
  const action = (src ? "Replace " : "Add ") + label.toLowerCase();
  return <div className={avatar ? "avatar-field" : "local-image-picker"}>
    {avatar ? <><span>Avatar</span><div className="avatar-tile">
      <button type="button" aria-label={action} title={action} disabled={disabled} onClick={() => input.current?.click()}>
        {src ? <img src={src} alt={label + " preview"} /> : <ImagePlus size={24} />}
      </button>
      {src && <button type="button" className="avatar-remove" aria-label={"Remove " + label.toLowerCase()} disabled={disabled} onClick={remove}><X size={14} /></button>}
    </div></> : <>
    {src && <img src={src} alt={label + " preview"} />}
    <div className="local-image-actions">
      <button className="secondary" type="button" disabled={disabled} onClick={() => input.current?.click()}><ImagePlus size={16} aria-hidden="true" />{src ? "Replace " : "Add "}{label.toLowerCase()}</button>
      {src && <button className="quiet" type="button" disabled={disabled} aria-label={"Remove " + label.toLowerCase()} onClick={remove}><X size={16} aria-hidden="true" /> Remove</button>}
    </div></>}
    <input ref={input} type="file" aria-label={label} accept={imageTypes} hidden disabled={disabled}
      onChange={event => { read(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
    {error && <small role="alert">{error}</small>}
  </div>;
}
