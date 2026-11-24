import type { ThinkingFormats } from "./chat-options";
import type { Message, Persona } from "./types";
import { separateThoughtDetails } from "./message-markup";

export function expandNames(text: string, character: string, player: string) {
  return text.replace(/\{\{?\s*(user|char)\s*\}\}/gi, (_, name: string) => name.toLowerCase() === "user" ? player : character);
}

export function chatNameInstruction(cardName: string, chatName: string) {
  return cardName === chatName ? "" : "The character’s name in this chat is " + JSON.stringify(chatName) + ".";
}

type Part = { reasoning: boolean; text: string };

export function thinkingSplitter(formats: ThinkingFormats) {
  const tags = [
    ...(["think", "thinking"] as const).filter((tag) => formats[tag]),
    ...(formats.customTags ?? []).filter(({ enabled }) => enabled).map(({ tag }) => tag),
  ];
  let active = "";
  let buffer = "";
  function split(chunk: string, final = false) {
    buffer += chunk;
    const parts: Part[] = [];
    function take(length: number) {
      if (length > 0) parts.push({ reasoning: Boolean(active), text: buffer.slice(0, length) });
      buffer = buffer.slice(length);
    }
    while (buffer) {
      const markers = active ? ["</" + active + ">"] : tags.map((tag) => "<" + tag + ">");
      const lower = buffer.toLowerCase();
      const match = markers.map((marker) => ({ marker, index: lower.indexOf(marker) }))
        .filter(({ index }) => index >= 0).sort((a, b) => a.index - b.index)[0];
      if (match) {
        take(match.index);
        buffer = buffer.slice(match.marker.length);
        active = active ? "" : match.marker.slice(1, -1);
        continue;
      }
      let keep = 0;
      if (!final) for (const marker of markers) {
        for (let length = Math.min(marker.length - 1, buffer.length); length > keep; length--) {
          if (lower.endsWith(marker.slice(0, length))) { keep = length; break; }
        }
      }
      take(buffer.length - keep);
      break;
    }
    return parts;
  }
  return { split };
}

export function chatHistoryText(message: Message, formats: ThinkingFormats, character: string, player: string) {
  const text = message.role === "assistant" ? stripAssistantThoughts(message.content, formats) : message.content;
  return expandNames(text, character, message.player ? message.player.name || "you" : player);
}

export function stripAssistantThoughts(text: string, formats: ThinkingFormats) {
  const tags = [...(formats.customTags ?? []), { tag: "internal_thoughts", enabled: true }];
  const visible = splitThinking(text, { ...formats, think: true, thinking: true, customTags: tags.map(tag => ({ ...tag, enabled: true })) }).content;
  return separateThoughtDetails(visible, true).content;
}

export function personaText(persona?: Pick<Persona, "name" | "description">) {
  return persona ? [persona.name, persona.description].filter(Boolean).join("\n") : "";
}

export function splitThinking(text: string, formats: ThinkingFormats) {
  const parts = thinkingSplitter(formats).split(text, true);
  return {
    content: parts.filter((part) => !part.reasoning).map((part) => part.text).join(""),
    reasoning: parts.filter((part) => part.reasoning).map((part) => part.text).join(""),
  };
}
