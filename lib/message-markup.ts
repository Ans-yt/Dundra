export const blockOpening = /^\s*<(div|style|section|article|figure|table|details|p|aside|main|header|footer|ul|ol|h[1-6]|pre|blockquote|svg|html|internal_states)(?=[\s/>])/i;

export function elementEnd(source: string, start: number, tag: string) {
  const name = tag.toLowerCase();
  const tokens = /<!--[\s\S]*?-->|<(\/?)([a-z][\w:-]*)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  tokens.lastIndex = start;
  let depth = 0;
  for (let token = tokens.exec(source); token; token = tokens.exec(source)) {
    const current = token[2]?.toLowerCase();
    if (current === name) {
      if (token[1]) {
        if (--depth === 0) return tokens.lastIndex;
      } else if (!token[0].endsWith("/>")) {
        depth++;
      } else if (!depth) return tokens.lastIndex;
    }
    if (!token[1] && (current === "style" || current === "script")) {
      const close = new RegExp("</" + current + "\\s*>", "gi");
      close.lastIndex = tokens.lastIndex;
      if (!close.exec(source)) return undefined;
      if (current === name) return close.lastIndex;
      tokens.lastIndex = close.lastIndex;
    }
  }
}

export function separateThoughtDetails(text: string, excludeIncomplete = false) {
  const openings = /<details\b(?:[^"'<>]|"[^"]*"|'[^']*')*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/gi;
  const thoughts: string[] = [];
  const visible: string[] = [];
  let offset = 0;
  for (let match = openings.exec(text); match; match = openings.exec(text)) {
    const label = match[1].replace(/<[^>]*>|&#?\w+;/g, "").replace(/[^a-z\s]/gi, "").trim();
    if (!/^(?:(?:internal|model)\s+)?(?:thoughts|thinking|reasoning)$/i.test(label)) continue;
    const end = elementEnd(text, match.index, "details");
    if (end === undefined && !excludeIncomplete) continue;
    visible.push(text.slice(offset, match.index));
    const inner = text.slice(openings.lastIndex, end).replace(/<\/details\s*>$/i, "");
    thoughts.push(inner.replace(/<(?:br\b[^>]*|\/p)\s*>/gi, "\n").replace(/<[^>]*>/g, "").trim());
    offset = end ?? text.length;
    openings.lastIndex = offset;
  }
  return { content: visible.length ? visible.join("") + text.slice(offset) : text, reasoning: thoughts.filter(Boolean).join("\n\n") };
}
