import { beginMemorySummary, connectionAdvanced, finishMemorySummary, generationConfig } from "./store";
import { chatHistoryText, expandNames, stripAssistantThoughts } from "./chat-text";
import { generate } from "./provider";
import { presetSettings } from "./tavern";
import { blankLoreEntry } from "./lorebook";
import { chatMemoryLimit } from "./chat-options";
import { countTextTokens, limitTextTokens } from "./tokens";

export async function summarizeChat(chatId: string, job: NonNullable<ReturnType<typeof beginMemorySummary>>) {
  const { settings, connection, chat, formats } = job;
  try {
    if (!connection || !(settings.model || connection.model)) throw new Error("Choose an available summary model in Memory → Advanced.");
    const model = settings.model || connection.model;
    const config = connectionAdvanced(connection.presetName);
    const preset = config.enabled && config.presets ? config.library.find(item => item.name === config.selected)?.preset : undefined;
    const generation = { ...generationConfig().current, ...(preset && presetSettings(preset)), maxOutput: settings.output };
    const player = chat.persona || "Player";
    const template = settings.templates.find(item => item.id === settings.templateId)!;
    const instruction = [
      expandNames(template.prompt, chat.character, player),
      settings.suggested ? `Aim for at most ${settings.suggested} output tokens.` : "",
      settings.book
        ? 'Return one JSON object with four fields. "summary" is the updated cumulative summary as a string. When the new messages establish an event, decision, discovery, or change worth recalling, give it a short "title" and describe the new facts in "memory" as a string. Use "keys" as an array of 2–6 short phrases people might repeat to recall those specific facts. If there is nothing new to remember, use empty strings for "title" and "memory" and an empty array for "keys".'
        : "Return only the updated summary in plain text.",
    ].filter(Boolean).join("\n\n");
    const transcript = job.messages.map(message => {
      const speaker = message.role === "assistant" ? chat.character : message.player?.name || player;
      return speaker + ": " + chatHistoryText(message, formats, chat.character, player);
    }).join("\n\n");
    const available = Math.min(settings.input, generation.contextSize - settings.output) - countTextTokens(instruction) - 24;
    if (available < 32) throw new Error("Increase max input or shorten the summary prompt.");
    const previous = limitTextTokens(job.previous, Math.min(settings.previous, available - 32));
    const recent = limitTextTokens(transcript, available - countTextTokens(previous), true);
    const input = [previous && "Previous summary:\n" + previous, "New chat messages:\n" + recent].filter(Boolean).join("\n\n");
    const prompt = [{ role: "system" as const, content: instruction }, { role: "user" as const, content: input }];
    let output = "";
    for await (const chunk of generate(prompt, AbortSignal.timeout(90_000), { ...connection, model }, generation)) {
      output += chunk;
      if (output.length > 160_000) throw new Error("The summary model returned too much text.");
    }
    output = stripAssistantThoughts(output, formats).trim();
    if (!output) throw new Error("The summary model returned an empty response.");
    if (!settings.book) {
      finishMemorySummary(chatId, job, { summary: limitTextTokens(output, settings.output).slice(0, chatMemoryLimit) });
      return;
    }
    const json = output.replace(/^```(?:json)?\s*|\s*```$/gi, "");
    let value: { summary?: unknown; title?: unknown; memory?: unknown; keys?: unknown } | null;
    try { value = JSON.parse(json); } catch { throw new Error("The summary model could not format a lorebook memory entry."); }
    if (typeof value?.summary !== "string" || !value.summary.trim()) throw new Error("The model omitted the updated summary.");
    const summary = limitTextTokens(value.summary.trim(), settings.output).slice(0, chatMemoryLimit);
    const candidates: unknown[] = Array.isArray(value.keys) ? value.keys : typeof value.keys === "string" ? value.keys.split(",") : [];
    const keys = [...new Set(candidates.filter((key): key is string =>
      typeof key === "string" && !!key.trim() && !key.trim().startsWith("/")).map(key => key.trim().slice(0, 80)))].slice(0, 12);
    const memory = typeof value.memory === "string" ? limitTextTokens(value.memory.trim(), Math.min(800, settings.output)) : "";
    const entry = memory && keys.length ? { ...blankLoreEntry(), id: "memory-through-" + job.head, name: typeof value.title === "string" && value.title.trim() ? value.title.trim().slice(0, 100) : "Chat memory",
      keys, content: memory.slice(0, 4000), position: "after_char" as const, match_whole_words: true, excludeRecursion: true, preventRecursion: true } : undefined;
    finishMemorySummary(chatId, job, { summary, entry });
  } catch (cause) {
    finishMemorySummary(chatId, job, undefined, cause instanceof Error ? cause.message.slice(0, 240) : "Could not generate a summary.");
  }
}
