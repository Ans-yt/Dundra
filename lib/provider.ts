import type { Message } from "./types";
import type { GenerationSettings } from "./generation";
import { RequestError } from "./http";

import { mediaParts } from "./attachment";
import type { ChatBonus } from "./chat-bonus";
import { randomInt } from "node:crypto";
import { allowsFunctions, headersForEndpoint } from "./chat-bonus";
import { postProcessPrompt } from "./prompt-post-processing";
type Prompt = { role: "system" | Message["role"]; content: string; media?:string; example?: boolean };

export async function listModels(endpoint: string, key: string, signal: AbortSignal) {
  const response = await fetch(endpoint + "/models", {
    headers: { Accept: "application/json", ...(key ? { Authorization: "Bearer " + key } : {}) },
    cache: "no-store", redirect: "error", signal,
  }).catch(() => { throw new RequestError("Could not load models. Check the base URL and make sure the provider is running.", 502); });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) {
      throw new RequestError("The provider denied the model list (HTTP " + response.status + "). Check your API key.", 502);
    }
    throw new RequestError("The provider could not list models (HTTP " + response.status + "). You can enter a model name manually.", 502);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let json = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new RequestError("The provider returned a model list that is too large.", 502);
      json += decoder.decode(value, { stream: true });
    }
    const data = JSON.parse(json + decoder.decode())?.data;
    if (!Array.isArray(data)) throw new Error("Invalid model list");
    const models = new Set<string>();
    for (const item of data) {
      if (typeof item?.id === "string" && item.id.trim() && item.id.length <= 256) models.add(item.id);
    }
    return [...models].sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (signal.aborted) throw new RequestError("The model list request timed out or was cancelled.", 502);
    throw new RequestError("The provider did not return a valid model list. You can enter a model name manually.", 502);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function* generate(messages: Prompt[], signal: AbortSignal,
  connection: { endpoint: string; model: string; key: string; thinking?: { enabled: boolean } },
  settings: GenerationSettings, thinkingLevel = "", onReasoning?: (text: string) => void, samplers: Record<string,number> = {},
  bonus?: { settings: ChatBonus; character: string; player: string }) {
  const { model, key } = connection;
  const base = connection.endpoint.replace(/\/+$/, "");
  const tokenLimit = connection.thinking?.enabled ? "max_completion_tokens" : "max_tokens";
  const headers = new Headers({ "Content-Type": "application/json" });
  if (key) headers.set("Authorization", "Bearer " + key);
  for (const { name, value } of headersForEndpoint(bonus?.settings, connection.endpoint)) headers.set(name, value);
  const formatted: Parameters<typeof postProcessPrompt>[0] = [];
  let previousExample = false;
  for (const message of messages) {
    const previous = formatted.at(-1);
    if (bonus?.settings.squashSystem && !message.example && !previousExample && message.role === "system" && previous?.role === "system"
      && typeof previous.content === "string") previous.content += "\n\n" + message.content;
    else formatted.push({ role: message.role, content: message.media && bonus?.settings.inlineMedia !== false
      ? mediaParts(message.content, message.media, bonus?.settings.imageQuality) : message.content });
    previousExample = !!message.example;
  }
  const wire: unknown[] = bonus ? postProcessPrompt(formatted, bonus.settings.postProcessing, bonus.character, bonus.player) : formatted;
  const functions = !!bonus?.settings.functionCalling && allowsFunctions(bonus.settings.postProcessing);
  for (let round = 0; round <= 3; round++) {
    const calls = new Map<number, ToolCall>();
    let reasoning = "";
    let assistant = "";
    const toolsAvailable = functions && round < 3;
    const payload = {
      ...samplers, model, messages: wire, stream: true,
      ...(toolsAvailable && { tools: [diceTool] }),
      ...(settings.maxOutput > 0 && { [tokenLimit]: settings.maxOutput }),
      ...(thinkingLevel && { reasoning_effort: thinkingLevel }),
      ...(settings.temperature !== 1 && { temperature: settings.temperature }),
      ...(settings.topK > 0 && { top_k: settings.topK }),
      ...(settings.topP > 0 && { top_p: settings.topP }),
      ...(settings.repetitionPenalty > 0 && { repetition_penalty: settings.repetitionPenalty }),
      ...(settings.frequencyPenalty !== 0 && { frequency_penalty: settings.frequencyPenalty }),
    };
    for await (const piece of readStream(base, headers, payload, signal, calls, text => {
      if (toolsAvailable && bonus?.settings.interleavedThinking) {
        if (reasoning.length + text.length > 2000000) throw new Error("The tool exchange exceeded its reasoning limit.");
        reasoning += text;
      }
      onReasoning?.(text);
    })) {
      if (toolsAvailable) assistant += piece;
      yield piece;
    }
    if (!calls.size) return;
    if (!toolsAvailable) throw new Error("The provider requested an unavailable tool.");
    const requested = [...calls.values()];
    if (requested.some(call => !call.id || !call.function.name)) throw new Error("The provider returned an incomplete tool call.");
    wire.push({ role: "assistant", content: assistant || null, tool_calls: requested, ...(reasoning && { reasoning_content: reasoning }) });
    for (const call of requested) wire.push({ role: "tool", tool_call_id: call.id, content: rollDice(call) });
  }
}

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
const diceTool = { type: "function", function: { name: "roll_dice", description: "Roll dice for the current scene.",
  parameters: { type: "object", properties: { count: { type: "integer", minimum: 1, maximum: 20 },
    sides: { type: "integer", minimum: 2, maximum: 1000 } }, required: ["count", "sides"], additionalProperties: false } } };

function rollDice(call: ToolCall) {
  if (call.function.name !== "roll_dice") return "Unknown tool.";
  try {
    const { count, sides } = JSON.parse(call.function.arguments);
    if (Number.isInteger(count) && count >= 1 && count <= 20 && Number.isInteger(sides) && sides >= 2 && sides <= 1000) {
      const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1));
      return JSON.stringify({ rolls, total: rolls.reduce((sum, die) => sum + die, 0) });
    }
  } catch { /* An invalid tool argument is returned to the model for correction. */ }
  return "Use 1–20 dice with 2–1000 sides.";
}

async function* readStream(base: string, headers: Headers, payload: object, signal: AbortSignal, calls: Map<number, ToolCall>, onReasoning: (text: string) => void) {
  const response = await fetch(base + "/chat/completions", {
    method: "POST", headers, body: JSON.stringify(payload),
    signal: AbortSignal.any([signal, AbortSignal.timeout(900_000)]),
    redirect: "error",
  }).catch(() => { throw new Error("Could not reach the model endpoint. Check the URL and that the provider is running."); });
  if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) {
      throw new Error("The provider denied the request (HTTP " + response.status + "). Check the API key and model access.");
    }
    throw new Error("The model endpoint did not return a reply stream (HTTP " + response.status + "). Check the model, token limits, and supported generation controls.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() + "\n" : decoder.decode(value, { stream: true });
      if (buffer.length > 1_000_000) throw new Error("The model sent an unexpectedly large event.");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        const payload = JSON.parse(data);
        if (payload.error) throw new Error("The provider reported a generation error.");
        const choice = payload.choices?.[0];
        if (choice?.finish_reason) finished = true;
        for (const fragment of choice?.delta?.tool_calls ?? []) {
          const index = fragment.index;
          if (!Number.isInteger(index) || index < 0 || index > 7) throw new Error("Too many tool calls in one reply.");
          const call = calls.get(index) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
          call.id += fragment.id ?? "";
          call.function.name += fragment.function?.name ?? "";
          call.function.arguments += fragment.function?.arguments ?? "";
          if (call.function.arguments.length > 8192 || call.function.name.length > 128 || call.id.length > 256) throw new Error("The tool call is too large.");
          calls.set(index, call);
        }
        if (choice?.delta) {
          const delta = choice.delta;
          const reasoning = delta.reasoning_content || delta.reasoning;
          if (typeof reasoning === "string") onReasoning(reasoning);
          else if (Array.isArray(delta.reasoning_details)) for (const part of delta.reasoning_details) {
            if (part?.type === "reasoning.text" && typeof part.text === "string") onReasoning(part.text);
            if (part?.type === "reasoning.summary" && typeof part.summary === "string") onReasoning(part.summary);
          }
        }
        if (typeof choice?.delta?.content === "string") yield choice.delta.content;
      }
      if (done) break;
    }
    if (!finished) throw new Error("The model stream ended before the reply was complete.");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
