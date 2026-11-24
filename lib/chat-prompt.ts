import type { GenerationSettings } from "./generation";
import { RequestError } from "./http";
import type { Message } from "./types";
import type { ChatBonus } from "./chat-bonus";

type PromptMessage = {role:"user"|"assistant"|"system";content:string;media?:string};

export function buildPrompt(system: string, history: Message[], input: string | null, settings: GenerationSettings, media?: string,
  examples?: { text: string; behavior: ChatBonus["examples"] }) {
  const messages: PromptMessage[] = [{ role: "system", content: [settings.globalPrompt, system].filter(Boolean).join("\n\n") }];
  const initialInstruction = messages[0].content;
  const instructionWithExamples = examples?.text ? [initialInstruction, "Example dialogue:\n" + examples.text].filter(Boolean).join("\n\n") : initialInstruction;
  if (examples?.behavior === "keep") messages[0].content = instructionWithExamples;
  const last = input === null ? history.at(-1)! : { role: "user" as const, content: input, media };
  const prior = input === null ? history.length - 2 : history.length - 1;
  const cost = (message: PromptMessage) => 4 + Math.ceil(Buffer.byteLength(message.content, "utf8") / 4);
  let remaining = settings.contextSize - 3 - cost(messages[0]) - cost(last);
  if (settings.prefill) remaining -= cost({ role: "assistant", content: settings.prefill });
  if (remaining < 0) throw new RequestError("The new message and instructions exceed this context setting. Increase context size or shorten the prompt.");
  const retained: PromptMessage[] = [];
  for (let index = prior; index >= 0; index--) {
    const tokens = cost(history[index]);
    if (tokens > remaining) {
      if (retained.at(-1)?.role === "assistant") retained.pop();
      break;
    }
    const { role, content, media } = history[index];
    retained.push({ role, content, ...(media && {media}) });
    remaining -= tokens;
  }
  if (examples?.behavior === "normal" && remaining >= cost({ ...messages[0], content: instructionWithExamples }) - cost(messages[0])) {
    messages[0].content = instructionWithExamples;
  }
  messages.push(...retained.reverse(), { role: last.role, content: last.content, ...("media" in last && last.media ? {media:last.media} : {}) });
  if (settings.prefill) messages.push({ role: "assistant", content: settings.prefill });
  return messages;
}

export async function* withPrefill(reply: AsyncIterable<string>, prefill: string) {
  if (!prefill) { yield* reply; return; }
  let head = "";
  let prefixed = false;
  for await (const chunk of reply) {
    if (prefixed) { yield chunk; continue; }
    head += chunk;
    if (head.length < prefill.length && prefill.startsWith(head)) continue;
    yield head.startsWith(prefill) ? head : prefill + head;
    prefixed = true;
  }
  if (!prefixed && head) yield prefill + head;
}
