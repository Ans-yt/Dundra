import type { PostProcessing } from "./chat-bonus";
import type { mediaParts } from "./attachment";

type ContentPart = ReturnType<typeof mediaParts>[number];
export type ProviderMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };

function combine(first: ProviderMessage["content"], second: ProviderMessage["content"]) {
  if (typeof first === "string" && typeof second === "string") return [first, second].filter(Boolean).join("\n\n");
  const parts = (content: ProviderMessage["content"]): ContentPart[] =>
    typeof content === "string" ? content ? [{ type: "text", text: content }] : [] : content;
  return [...parts(first), ...parts(second)];
}

export function postProcessPrompt(messages: ProviderMessage[], mode: PostProcessing, character: string, player: string) {
  if (mode === "none") return messages;
  const alternating = mode.startsWith("semi") || mode.startsWith("strict");
  const strict = mode.startsWith("strict");
  const single = mode === "single";
  const result: ProviderMessage[] = [];
  for (const message of messages) {
    let { role, content } = message;
    if (single) {
      const name = role === "assistant" ? character : role === "user" ? player : "";
      if (name) content = combine(name + ":", content);
      role = "user";
    } else if (alternating && role === "system" && result.some(entry => entry.role !== "system")) role = "user";
    const previous = result.at(-1);
    if (previous?.role === role) previous.content = combine(previous.content, content);
    else result.push({ role, content });
  }
  if (strict) {
    const first = result[0]?.role === "system" ? 1 : 0;
    if (result[first]?.role !== "user") result.splice(first, 0, { role: "user", content: "Start." });
  }
  return result;
}
