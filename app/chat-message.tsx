"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReplyPhase } from "./chat-workspace";
import { ChevronDown, Timer, ChevronLeft, ChevronRight, ChevronsRight, Copy, GitFork, Pencil, Trash2 } from "lucide-react";
import Markdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { HtmlFragment } from "./message-html";
import type {Root as MarkdownRoot} from "mdast";
import type {PluggableList} from "unified";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { Element, Root, Text } from "hast";
import type { ThinkingFormats } from "../lib/chat-options";
import { expandNames, splitThinking } from "../lib/chat-text";
import { blockOpening, elementEnd, separateThoughtDetails } from "../lib/message-markup";
import type { Message } from "../lib/types";
import { Mark } from "./workspace";

// Preserve only CSS text colors through sanitization, including legacy font tags.
function inlineColor(value: unknown) {
  if (typeof value !== "string") return undefined;
  const color = value.trim().replace(/[,;]$/, "").trim();
  return /^(?:#[\da-f]{3,8}|[a-z]+|(?:rgba?|hsla?)\([\d.%+,/\s-]+\))$/i.test(color) ? color : undefined;
}

function markInlineColors() {
  return (tree: Root) => {
    function visit(parent: Element | Root) {
      for (const node of parent.children) {
        if (node.type !== "element") continue;
        if (node.tagName === "span" || node.tagName === "font") {
          const style = String(node.properties.style || "");
          const color = inlineColor(/(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style)?.[1]) ?? inlineColor(node.properties.color);
          if (color) {
            node.tagName = "span";
            node.properties.dataTextColor = color;
          }
        }
        visit(node);
      }
    }
    visit(tree);
  };
}

function markDialogue() {
  return (tree: Root) => {
    function visit(parent: Root | Element) {
      if (parent.type === "element" && (["code", "pre", "a"].includes(parent.tagName) || parent.properties.dataTextColor)) return;
      const children: Root["children"] = parent.children;
      for (let index = 0; index < children.length; index++) {
        const node = children[index];
        if (node.type === "element") visit(node);
        if (node.type !== "text") continue;
        const parts = node.value.split(/(“[^”\n]+”|"[^"\n]+")/g);
        if (parts.length < 2) continue;
        const replacements = parts.map((value, partIndex): Text | Element => {
          const text: Text = { type: "text", value };
          return partIndex % 2 ? { type: "element", tagName: "span", properties: { className: ["chat-dialogue"] }, children: [text] } : text;
        });
        children.splice(index, 1, ...replacements);
        index += replacements.length - 1;
      }
    }
    visit(tree);
  };
}

function htmlBlocks() {
  return (tree: MarkdownRoot, file: { value: unknown }) => {
    const source = String(file.value);
    function preserveUnknown(node: {type:string;value?:string;children?:typeof tree.children}) {
      if (node.type === "html" && node.value && !blockOpening.test(node.value) &&
        /^<\/?(?:think|thinking|[\w]+_[\w-]+)\b/i.test(node.value)) node.type = "text";
      node.children?.forEach(child=>preserveUnknown(child as typeof node));
    }
    preserveUnknown(tree);
    const nodes: MarkdownRoot["children"] = [];
    for (let index = 0; index < tree.children.length; index++) {
      const node = tree.children[index];
      if (node.type !== "html") { nodes.push(node); continue; }
      const opening = blockOpening.exec(node.value);
      const start = node.position?.start.offset;
      if (!opening || start === undefined) { nodes.push(node); continue; }
      const closing = elementEnd(source, start, opening[1]);
      if (closing === undefined && /^\s*<internal_states\s*>\s*$/i.test(node.value)) continue;
      let end = Math.max(node.position?.end.offset ?? start, closing ?? start);
      for (let next = tree.children[index + 1]; next; next = tree.children[index + 1]) {
        const nextStart = next.position?.start.offset ?? Infinity;
        if (nextStart >= end && (next.type !== "html" || !blockOpening.test(next.value))) break;
        const tag = next.type === "html" ? blockOpening.exec(next.value)?.[1] : undefined;
        end = Math.max(end, next.position?.end.offset ?? end, tag ? elementEnd(source, nextStart, tag) ?? end : end);
        index++;
      }
      nodes.push({ type: "paragraph", children: [], data: { hName: "div", hProperties: { dataNitanorHtml: source.slice(start, end) } } });
    }
    tree.children = nodes;
  };
}
const remarkPlugins = [remarkGfm, remarkBreaks, htmlBlocks];
const rehypePlugins:PluggableList = [rehypeRaw,markInlineColors,[rehypeSanitize,{...defaultSchema,attributes:{...defaultSchema.attributes,span:[...(defaultSchema.attributes?.span ?? []),"dataTextColor"],div:[...(defaultSchema.attributes?.div ?? []),"dataNitanorHtml"]}}],markDialogue];
const markdownComponents: Components = {
  div: ({node,children}) => typeof node?.properties.dataNitanorHtml==="string" ? <HtmlFragment html={node.properties.dataNitanorHtml}/> : <div>{children}</div>,
  span: ({ node, children, className }) => {
    const color = inlineColor(node?.properties.dataTextColor);
    return <span className={color ? "chat-inline-color" : className} style={color ? { color } : undefined}>{children}</span>;
  },
  a: ({ href, children }) => <a href={href} rel="noreferrer" target="_blank">{children}</a>,
  img: ({ src, alt }) => typeof src === "string" && src ? <img src={src} alt={alt || ""} loading="lazy" referrerPolicy="no-referrer" /> : null,
};

const MessageMarkdown = memo(function MessageMarkdown({ content }: { content: string }) {
  return <div className="chat-prose"><Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}
    components={markdownComponents}>{content}</Markdown></div>;
});

function duration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return seconds < 60 ? seconds + "s" : Math.floor(seconds / 60) + "m " + seconds % 60 + "s";
}

function ThinkingClock({ since, elapsed }: { since: number; elapsed: number }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function tick() {
      const current = performance.now();
      setNow(current);
      timer = setTimeout(tick, 1000 - Math.floor(elapsed + Math.max(0, current - since)) % 1000);
    }
    tick();
    return () => clearTimeout(timer);
  }, [since, elapsed]);
  return <span className="thinking-clock" role="timer">{duration(elapsed + Math.max(0, now - since))}</span>;
}

function Thoughts({ text, phase, elapsed, since }: { text: string; phase?: ReplyPhase; elapsed?: number; since?: number }) {
  const panel = useRef<HTMLDetailsElement>(null);
  const body = useRef<HTMLParagraphElement>(null);
  const follow = useRef(true);
  const label = phase === "thinking" ? "Thinking" : phase === "waiting" ? "Waiting for the model" : elapsed !== undefined ? "Thought for " + duration(elapsed) : phase === "answering" ? "Answering" : "Thoughts";
  useLayoutEffect(() => {
    if (phase && panel.current?.open && body.current && follow.current) body.current.scrollTop = body.current.scrollHeight;
  }, [text, phase]);
  return <details className="chat-thoughts" data-phase={phase ?? "complete"} ref={panel} onToggle={e => {
    if (e.currentTarget.open && phase && body.current && follow.current) body.current.scrollTop = body.current.scrollHeight;
  }}>
    <summary><Timer size={15} aria-hidden="true"/><span role="status">{label}</span>
      {phase === "thinking" && since !== undefined && <ThinkingClock since={since} elapsed={elapsed ?? 0}/>}
      {phase === "answering" && elapsed !== undefined && <span className="sr-only">Answering</span>}
      {phase && <span className="thought-activity" aria-hidden="true"><i/><i/><i/></span>}<ChevronDown className="thought-chevron" size={14} aria-hidden="true"/></summary>
    <p ref={body} onScroll={e => { const el = e.currentTarget; follow.current = el.scrollHeight - el.clientHeight - el.scrollTop < 16; }}>
      {text || (phase === "waiting" ? "Waiting for the first tokens…" : "No thoughts received.")}
    </p>
  </details>;
}

type MessageActions = {
  edit: (id: number, content: string) => Promise<boolean>;
  fork: (id: number) => void;
  delete: (id: number) => void;
  select: (id: number, variant: number) => void;
  generate: (id: number, mode: "continue" | "alternate") => void;
};

export const ChatMessage = memo(function ChatMessage({ message, speaker, character, player, portraitId, hasPortrait, portrait,
  formats, phase, thinkingSince, locked, hasModel, colorfulEditing, imageSwipe = "generate", actions }: {
  message: Message; speaker: string; character: string; player: string; portraitId?: string; hasPortrait?: boolean; portrait?: string;
  formats: ThinkingFormats; phase?: ReplyPhase; thinkingSince?: number; locked: boolean; hasModel: boolean;
  colorfulEditing: boolean; imageSwipe?: "generate" | "rollover"; actions?: MessageActions;
}) {
  const pending = Boolean(phase);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const isPlayer = message.role === "user";
  const visibleContent = message.displayContent ?? message.content;
  const text = useMemo(() => {
    if (isPlayer) return { content: visibleContent, reasoning: "" };
    const tagged = splitThinking(visibleContent, { ...formats, customTags: [...(formats.customTags ?? []), { tag: "internal_thoughts", enabled: true }] });
    const details = separateThoughtDetails(tagged.content, true);
    return { content: details.content, reasoning: [tagged.reasoning, details.reasoning].filter(Boolean).join("\n\n") };
  }, [isPlayer, visibleContent, formats]);
  const rendered = useMemo(() => expandNames(text.content, character, player), [text.content, character, player]);
  const thoughts = [message.reasoning, text.reasoning].filter(Boolean).join("\n\n").trim();
  const variant = message.variant ?? 1;
  const count = message.variantCount ?? 1;
  const previous = variant > 1;
  const next = variant < count;
  const rollOver = !isPlayer && !next && count > 1 && imageSwipe === "rollover"
    && (message.media?.startsWith("data:image/") || /!\[[^\]]*\]\(|<img\b/i.test(rendered));

  return <article id={message.id > 0 ? "message-" + message.id : undefined} className={"chat-message" + (isPlayer ? " chat-player" : "")}>
    <div className="chat-message-avatar"><Mark name={speaker} id={portraitId} hasPortrait={hasPortrait} src={portrait} /></div>
    <div className="chat-message-main" data-streaming={!!(pending && !isPlayer && rendered.trim())}>
      <div className="chat-message-heading"><h2>{speaker}</h2>{message.edited && <small className="chat-edited">Edited</small>}</div>
      {message.media && <div className="message-media">{message.media.startsWith("data:image/") ? <img src={message.media} alt="Attached image" /> : message.media.startsWith("data:audio/") ? <audio controls src={message.media}/> : <video controls src={message.media}/>}</div>}
      {(thoughts || phase) && <Thoughts text={expandNames(thoughts, character, player)} phase={phase} elapsed={message.thinkingMs} since={thinkingSince}/>}
      {editing && actions ? <form className="chat-edit-form" onSubmit={async (event) => {
        event.preventDefault();
        if (!locked && draft.trim() && await actions.edit(message.id, draft)) setEditing(false);
      }}>
        <textarea aria-label="Edit message text" value={draft} onChange={(event) => setDraft(event.target.value)}
          rows={Math.min(12, Math.max(4, draft.split("\n").length + 1))} maxLength={2_000_000} disabled={locked} autoFocus />
        {colorfulEditing && <div className="chat-edit-preview" aria-label="Formatted preview"><MessageMarkdown content={expandNames(draft, character, player)} /></div>}
        <div><button className="quiet" type="button" onClick={() => setEditing(false)} disabled={locked}>Cancel</button>
          <button className="primary" disabled={locked || !draft.trim()}>Save message</button></div>
      </form> : <>
        {rendered.trim() && <MessageMarkdown content={rendered} />}
        {pending && actions && !isPlayer && <p className="chat-variants" aria-label={`Reply ${variant} of ${count}`}>{variant} / {count}</p>}
        {actions && !pending && <div className="chat-message-controls">
          <button type="button" className="quiet" title="Edit message" aria-label={"Edit " + speaker + " message"} disabled={locked}
            onClick={() => { setDraft(message.content); setEditing(true); }}><Pencil size={15} aria-hidden="true" /></button>
          <button type="button" className="quiet" title="Copy message" aria-label="Copy message" disabled={locked}
            onClick={() => { navigator.clipboard.writeText(rendered).then(() => setCopyStatus("Copied."), () => setCopyStatus("Could not copy.")); }}>
            <Copy size={15} aria-hidden="true" /></button>
          <button type="button" className="quiet" title="Fork into new chat" aria-label="Fork into new chat" disabled={locked}
            onClick={() => actions.fork(message.id)}><GitFork size={15} aria-hidden="true" /></button>
          <button type="button" className="quiet danger" title="Delete from this message" aria-label={"Delete " + speaker + " message"} disabled={locked}
            onClick={() => actions.delete(message.id)}><Trash2 size={15} aria-hidden="true" /></button>
          {copyStatus && <small role="status">{copyStatus}</small>}
          {message.opening && count > 1 && <div className="chat-variants">
            <button type="button" className="quiet" title="Previous opening" aria-label="Previous opening" disabled={locked || !previous}
              onClick={() => actions.select(message.id, variant - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
            <small aria-label={`Opening ${variant} of ${count}`}>{variant} / {count}</small>
            <button type="button" className="quiet" title="Next opening" aria-label="Next opening" disabled={locked || !next}
              onClick={() => actions.select(message.id, variant + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
          </div>}
          {!isPlayer && !message.opening && <>
            <button type="button" className="quiet" title="Continue this scene" aria-label="Continue this scene" disabled={locked || !hasModel}
              onClick={() => actions.generate(message.id, "continue")}><ChevronsRight size={19} aria-hidden="true" /></button>
            <div className="chat-variants">
              {count > 1 && <><button type="button" className="quiet" title="Previous reply" aria-label="Previous reply" disabled={locked || !previous}
                onClick={() => actions.select(message.id, variant - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
                <small aria-label={`Reply ${variant} of ${count}`}>{variant} / {count}</small></>}
              <button type="button" className="quiet" title={next ? "Next reply" : rollOver ? "First saved reply" : "Generate alternate reply"}
                aria-label={next ? "Next reply" : rollOver ? "First saved reply" : "Generate alternate reply"} disabled={locked || (!next && !rollOver && !hasModel)}
                onClick={() => next || rollOver ? actions.select(message.id, rollOver ? 1 : variant + 1) : actions.generate(message.id, "alternate")}><ChevronRight size={18} aria-hidden="true" /></button>
            </div>
          </>}
        </div>}
      </>}
    </div>
  </article>;
});
