import { workspaceRequest } from "../../../lib/access";
import { applyRules, withScopedRules } from "../../../lib/regex-server";
import { presetSettings } from "../../../lib/tavern";
import { activeLore } from "../../../lib/lore-activation";
import { withEmbeddedLore } from "../../../lib/lorebook";
import { attachmentKinds } from "../../../lib/attachment";
import { arrangePreset } from "../../../lib/preset-prompt";
import { beginMemorySummary, connectionAdvanced, originalFields, loreTiming, character, linkedChatLorebooks, chatModelConnection, chatOptions, conversation, finishReply, generationConfig, memoryStatus, persona, type ReplyAction } from "../../../lib/store";
import { failure, field, fields, RequestError } from "../../../lib/http";
import { generate } from "../../../lib/provider";
import { after } from "next/server";
import { summarizeChat } from "../../../lib/summarize-chat";
import { buildPrompt, withPrefill } from "../../../lib/chat-prompt";
import { chatHistoryText, expandNames, personaText, stripAssistantThoughts, thinkingSplitter } from "../../../lib/chat-text";
import { effectivePrompt } from "../../../lib/generation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    workspaceRequest(request);
    const body = await fields(request, 11_300_000);
    const id = field(body, "chat", 64, true);
    const current = conversation(id);
    if (!current) throw new RequestError("Chat not found.", 404);
    const { connection, thinkingLevel } = chatModelConnection(id);
    if (!connection.model) throw new RequestError("Choose a model in Settings before sending a message.");
    const item = character(current.chat.character_id);
    if (!item) throw new RequestError("Character not found.", 404);
    const player = current.chat.persona_id ? persona(current.chat.persona_id) : undefined;
    const mode = body.mode ?? (body.regenerate === true ? "alternate" : "send");
    if (mode !== "send" && mode !== "alternate" && mode !== "continue" && mode !== "impersonate") throw new RequestError("Unknown reply action.");
    const targetId = body.messageId ?? current.messages.at(-1)?.id;
    const targetIndex = current.messages.findIndex((message) => message.id === targetId && message.role === "assistant");
    const target = current.messages[targetIndex];
    if ((mode === "alternate" || mode === "continue") && !target) throw new RequestError("Choose a character reply first.");
    if ((mode === "alternate" || mode === "continue") && target?.opening) throw new RequestError("Choose a written opening, or send a message to begin the chat.");
    const card=originalFields(item.id);
    const cfg = withScopedRules(connectionAdvanced(connection.presetName),card.regex_scripts);
    const preset = cfg.enabled && cfg.presets ? cfg.library.find(p=>p.name===cfg.selected)?.preset : undefined;
    const media = typeof body.media === "string" ? body.media : "";
    if (media) {
      const head=media.slice(0,media.indexOf(","));
      if (mode!=="send" || !attachmentKinds(cfg.enabled && cfg.audio,cfg.enabled && cfg.video).some(t=>head==="data:"+t+";base64") || media.length>11_185_000 || !/^[A-Za-z0-9+/]+=*$/.test(media.slice(head.length+1))) throw new RequestError("Unsupported attachment or file over 8 MiB.");
    }
    const rule = (s:string,p:number,stage:"save"|"prompt",depth=0) => applyRules(cfg,s,p,stage,depth,player?.name || "you",item.name);
    const action: ReplyAction | undefined = mode === "impersonate" ? undefined : mode === "send" ? { mode, media, input: rule(field(body, "message", 8_000, !media),1,"save") } : { mode, messageId: target.id };
    const generation = generationConfig();
    const options = chatOptions(id);
    if (mode === "send" && media && !options.bonus.inlineMedia && action?.mode === "send" && !action.input.trim()) {
      throw new RequestError("Add a message or enable Send inline media in Bonus settings.");
    }
    const saved = { ...generation.current, ...(preset && presetSettings(preset)), ...options.generation };
    const expand = (text: string) => expandNames(text, item.name, player?.name || "you");
    const settings = { ...saved, globalPrompt: expand(effectivePrompt(generation, connection.promptId)), prefill: mode === "continue" || mode === "impersonate" ? "" : expand(saved.prefill) };
    const exampleSection = card.mes_example && "Example dialogue:\n" + card.mes_example;
    const hasEmbeddedExamples = Boolean(exampleSection && item.instructions.includes(exampleSection));
    const instructions = hasEmbeddedExamples ? item.instructions.replace(exampleSection!, "") : item.instructions;
    const summary = [options.memory, memoryStatus(id).summary].filter(Boolean).join("\n\n");
    const system = [expand(instructions), player && "Player persona: " + personaText({ name: player.name, description: expand(player.description) }),
      summary && "Chat summary:\n" + expand(summary)].filter(Boolean).join("\n\n");
    const history = (mode === "send" || mode === "impersonate" ? current.messages : current.messages.slice(0, targetIndex + Number(mode === "continue")))
      .map((message,i,list) => ({ ...message, content: rule(chatHistoryText(message, options.formats, item.name, player?.name || "you"),message.role==="user"?1:2,"prompt",list.length-i-1) }));
    const continuePrompt = options.actionPrompts.continue || (typeof preset?.continue_nudge_prompt === "string" && preset.continue_nudge_prompt) || "**continue this scene.**";
    const input = action?.mode === "send" ? rule(expand(action.input),1,"prompt") : mode === "impersonate" ? (history.length ? null : "") : mode === "continue" && options.bonus.continuePrefill ? null : mode === "continue" ? expand(continuePrompt)
      : history.at(-1)?.role === "user" ? null : "Begin the scene with an opening message.";
    const ordered = Boolean(preset?.prompt_order?.length);
    const linkedBooks = linkedChatLorebooks(current.chat);
    const scan = mode === "send" ? [...history, { content: input || "" }] : history;
    const embeddedBooks = ordered ? withEmbeddedLore(card.character_book, []) : [];
    const timed = [...linkedBooks, ...embeddedBooks].some(book => book.entries.some(entry => entry.sticky || entry.cooldown));
    const context = { character: item.name, characterId: item.id, tags: item.tags.split(","), seed: id, messageCount: scan.length,
      previous: timed ? loreTiming(id, mode === "send" || mode === "impersonate" ? undefined : target.id + Number(mode === "continue")) : undefined, trigger: mode === "send" ? "normal" : mode === "alternate" ? "swipe" : mode };
    const lore = activeLore(linkedBooks, scan, context);
    const embedded = embeddedBooks.length ? activeLore(embeddedBooks, scan, context) : undefined;
    const starts = Object.fromEntries([...lore.activations, ...(embedded?.activations ?? [])].map(key => [key, scan.length]));
    const formatLore = (text: string) => rule(rule(text, 5, "save"), 5, "prompt");
    const systemWithLore = ordered ? "" : [...lore.before_char.map(text => formatLore(expand(text))), system,
      ...lore.after_char.map(text => formatLore(expand(text)))].filter(Boolean).join("\n\n");
    const depthEntries = [...lore.at_depth, ...(embedded?.at_depth ?? [])].map(entry => ({ ...entry, content: formatLore(expand(entry.content)) }));
    if (options.authorNote) depthEntries.push({ content: expand(options.authorNote), depth: options.noteDepth });
    const impersonation = mode === "impersonate" ? expand(options.actionPrompts.impersonate || (typeof preset?.impersonation_prompt === "string" && preset.impersonation_prompt) || "Write only the next message as {{user}}, in their voice. Leave {{char}}’s response to the next turn.") : "";
    const profilePrompt = ordered && connection.promptId && generation.prompts.some(item => item.id === connection.promptId) ? settings.globalPrompt : "";
    const continuePrefillPrompt = mode === "continue" && options.bonus.continuePrefill ? expand(options.actionPrompts.continue) : "";
    const reserved = [impersonation, profilePrompt, continuePrefillPrompt].reduce((sum, text) => text ? sum + 4 + Math.ceil(Buffer.byteLength(text) / 4) : sum, 0);
    const presetSettingsBudget = { ...settings, contextSize: settings.contextSize - reserved };
    const historySettings = { ...presetSettingsBudget, contextSize: presetSettingsBudget.contextSize - depthEntries.reduce((sum, entry) => sum + 4 + Math.ceil(Buffer.byteLength(entry.content) / 4), 0) };
    let prompt = buildPrompt(systemWithLore, history, input,
      ordered ? { ...historySettings, globalPrompt: "" } : historySettings, media,
      !ordered && hasEmbeddedExamples ? { text: expand(card.mes_example!), behavior: options.bonus.examples } : undefined);
    const historyEnd = prompt.length - Number(Boolean(settings.prefill));
    if (!ordered) for (const entry of depthEntries.reverse().sort((a,b) => a.depth - b.depth)) {
      prompt.splice(Math.max(1, historyEnd - entry.depth), 0, { role: "system", content: entry.content });
    }
    if (ordered && preset) prompt=arrangePreset(preset,prompt,presetSettingsBudget,card,instructions,player?.description || "",summary,expand,mode,formatLore,options.bonus.examples,lore,embedded,depthEntries);
    if (profilePrompt) prompt.unshift({ role: "system", content: profilePrompt });
    if (mode === "continue" && options.bonus.continuePrefill) {
      const tail = history.at(-1)!;
      const index = prompt.findLastIndex(message => message.role === "assistant" && message.content === tail.content);
      if (index >= 0) prompt.splice(index, 1);
      if (continuePrefillPrompt) prompt.push({ role: "system", content: continuePrefillPrompt });
      prompt.push({ role: "assistant", content: tail.content });
    }
    prompt = prompt.map(message => message.role === "assistant"
      ? { ...message, content: stripAssistantThoughts(message.content, options.formats) } : message)
      .filter(message => message.role !== "assistant" || message.content.trim());
    if (impersonation) prompt.push({ role: "system", content: impersonation });
    const abort = new AbortController();
    const signal = AbortSignal.any([request.signal, abort.signal]);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: { delta?: string; reasoning?: string; thinkingMs?: number; display?: string; done?: true; draft?: string; automationIds?: string[]; error?: string }) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        let publishTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          let reply = "";
          let reasoning = "";
          let answerStarted = false;
          let started: number | undefined;
          let thinkingMs: number | undefined;
          function beginAnswer() {
            answerStarted = true;
            if (started === undefined) return;
            thinkingMs = (thinkingMs ?? 0) + Math.round(performance.now() - started);
            started = undefined;
          }
          const receiveReasoning = (text: string) => {
            if (!text) return;
            const entering = !answerStarted && started === undefined;
            if (entering) started = performance.now();
            signal.throwIfAborted();
            if (reasoning.length + text.length > 2_000_000) throw new Error("The model returned too much reasoning text.");
            reasoning += text;
            if (options.view.streaming) emit({ reasoning: text, ...(entering && { thinkingMs: thinkingMs ?? 0 }) });
          };
          const formatStream = cfg.enabled && cfg.regex && cfg.rules.some(rule => !rule.disabled && rule.markdownOnly && rule.placement.includes(2));
          let published = 0;
          let nextFormat = 0;
          function publish() {
            clearTimeout(publishTimer);
            publishTimer = undefined;
            if (signal.aborted) return;
            const delta = reply.slice(published);
            if (!delta) return;
            let display: string | undefined;
            if (formatStream && reply.length < 100_000) {
              try { display = applyRules(cfg, reply, 2, "display", 0, player?.name || "you", item!.name); }
              catch { /* Chat remains readable when a display script fails. */ }
            }
            emit({ delta, display, thinkingMs });
            published = reply.length;
            nextFormat = Date.now() + 100;
          }
          const samplers:Record<string,number>={};
          if(preset) for(const key of ["presence_penalty","seed","min_p","top_a"]) {
            const value=preset[key]; if(typeof value==="number" && Number.isFinite(value) && (key === "seed" ? value >= 0 : value !== 0)) samplers[key]=value;
          }
          if (options.bonus.seed !== null) {
            if (options.bonus.seed < 0) delete samplers.seed;
            else samplers.seed = options.bonus.seed;
          }
          const raw = generate(prompt, signal, connection, settings, thinkingLevel, options.formats.reasoning ? receiveReasoning : undefined,
            samplers, { settings: options.bonus, character: item.name, player: player?.name || "You" });
          const splitter = thinkingSplitter(options.formats);
          async function* visible() {
            for await (const chunk of raw) for (const part of splitter.split(chunk)) {
              if (part.reasoning) receiveReasoning(part.text);
              else { if (part.text.trim()) beginAnswer(); yield part.text; }
            }
            for (const part of splitter.split("", true)) {
              if (part.reasoning) receiveReasoning(part.text);
              else { if (part.text.trim()) beginAnswer(); yield part.text; }
            }
          }
          const results = withPrefill(visible(), settings.prefill);
          for await (const delta of results) {
            signal.throwIfAborted();
            if (delta.trim() && !answerStarted) beginAnswer();
            reply += delta;
            if (reply.length > 2_000_000) throw new Error("The generated reply exceeded the local storage limit.");
            if (options.view.streaming) {
              const wait = formatStream ? nextFormat - Date.now() : 0;
              if (wait <= 0) publish();
              else if (!publishTimer) publishTimer = setTimeout(publish, wait);
            }
          }
          beginAnswer();
          if (options.view.streaming) publish();
          signal.throwIfAborted();
          if (!action) {
            if (!reply.trim() || reply.length > 8000) throw new RequestError("The generated draft is empty or exceeds 8,000 characters.");
            emit({ done: true, draft: reply });
            return;
          }
          reply = rule(reply,2,"save"); reasoning = rule(reasoning,6,"save");
          if (!reply.trim()) throw new Error("The model returned an empty reply.");
          const content = mode === "continue" ? target.content.trimEnd() + "\n\n" + expand(reply.trimStart())
            : mode === "alternate" ? expand(reply) : reply;
          if (content.length > 2_000_000) throw new Error("The combined reply exceeded the local storage limit.");
          if (!finishReply(id, current.revision, action, content, reasoning.trim(), starts, thinkingMs)) {
            throw new Error("This chat changed during generation. Reload it and try again.");
          }
          emit({ done: true, automationIds: [...new Set([...lore.automationIds, ...(embedded?.automationIds ?? [])])] });
          if (action.mode === "send") {
            try {
              const job = beginMemorySummary(id);
              if (job) after(() => summarizeChat(id, job));
            } catch (cause) {
              console.error("Could not schedule automatic memory.", cause);
            }
          }
        } catch (error) {
          if (!signal.aborted) emit({ error: error instanceof Error && !(error instanceof SyntaxError) ? error.message : "The model sent an invalid reply stream." });
        } finally {
          clearTimeout(publishTimer);
          if (!abort.signal.aborted) controller.close();
        }
      },
      cancel() { abort.abort(); },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
