import { chatColors, chatFonts, chatMemoryLimit, customThinkingTag, customThinkingTagLimit, defaultChatView, validGenerationNumber, type ChatColors, type ChatOptions } from "./chat-options";
import { memoryLimits, memoryPromptLimit, type AutoMemory } from "./auto-memory";
import { actionPromptLimit } from "./chat-options";
import { generationRanges, type GenerationNumber } from "./generation";
import { field, RequestError } from "./http";
import { defaultChatBonus, postProcessingModes, type ChatBonus } from "./chat-bonus";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError("Invalid chat settings.");
  return value as Record<string, unknown>;
}

export function readChatOptions(body: Record<string, unknown>) {
  const options: Partial<ChatOptions> = {};
  if (body.actionPrompts !== undefined) {
    const prompts = record(body.actionPrompts);
    options.actionPrompts = {
      impersonate: field(prompts, "impersonate", actionPromptLimit),
      continue: field(prompts, "continue", actionPromptLimit),
    };
  }
  if (body.autoMemory !== undefined) options.autoMemory = readAutoMemory(record(body.autoMemory));
  if (body.bonus !== undefined) {
    const value = { ...defaultChatBonus, ...record(body.bonus) };
    const { messageLimit, streamingFps, examples, imageSwipe, smoothStreaming, streamFade, fixedAvatars, postProcessing, headers } = value;
    if (typeof messageLimit !== "number" || !Number.isInteger(messageLimit) || messageLimit < 0 || messageLimit > 1000 ||
      typeof streamingFps !== "number" || !Number.isInteger(streamingFps) || streamingFps < 5 || streamingFps > 100 ||
      (examples !== "normal" && examples !== "keep" && examples !== "strip") || (imageSwipe !== "generate" && imageSwipe !== "rollover") ||
      typeof smoothStreaming !== "boolean" || typeof streamFade !== "boolean" || typeof fixedAvatars !== "boolean" ||
      !postProcessingModes.some(([key]) => key === postProcessing) || !Array.isArray(headers) || headers.length > 16) {
      throw new RequestError("Review the Bonus settings.");
    }
    const { continuePrefill, squashSystem, functionCalling, interleavedThinking, inlineMedia, imageQuality, seed } = value;
    if ([continuePrefill, squashSystem, functionCalling, interleavedThinking, inlineMedia].some(flag => typeof flag !== "boolean")
      || !["auto", "low", "high"].includes(imageQuality) || (seed !== null && (!Number.isInteger(seed) || seed < -1 || seed > 2147483647))) {
      throw new RequestError("Review the provider request options.");
    }
    const seen = new Set<string>();
    const customHeaders = headers.map(raw => {
      const header = record(raw);
      const name = field(header, "name", 100, true);
      const headerValue = field(header, "value", 4096);
      const key = name.toLowerCase();
      if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) || seen.has(key) || /[^\t\x20-\x7e]/.test(headerValue) ||
        /^(?:host|connection|content-(?:length|type|encoding)|cookie2?|keep-alive|proxy-.*|te|trailer|transfer-encoding|upgrade|origin|referer|sec-.*)$/i.test(key)) {
        throw new RequestError("Invalid, repeated, or reserved custom header: " + name + ".");
      }
      seen.add(key);
      return { name, value: headerValue };
    });
    options.bonus = { continuePrefill, squashSystem, functionCalling, interleavedThinking, inlineMedia, imageQuality, seed, messageLimit, streamingFps, examples, imageSwipe, smoothStreaming, streamFade, fixedAvatars,
      postProcessing: postProcessing as ChatBonus["postProcessing"], headers: customHeaders };
  }
  if (body.authorNote !== undefined) options.authorNote = field(body, "authorNote", chatMemoryLimit);
  if (body.noteDepth !== undefined) {
    if (typeof body.noteDepth !== "number" || !Number.isInteger(body.noteDepth) || body.noteDepth < 0 || body.noteDepth > 100) throw new RequestError("Note depth must be between 0 and 100.");
    options.noteDepth = body.noteDepth;
  }
  if (body.memory !== undefined) options.memory = field(body, "memory", chatMemoryLimit);
  if (body.generation !== undefined) {
    const numbers = record(body.generation);
    options.generation = {};
    for (const key of Object.keys(generationRanges) as GenerationNumber[]) {
      if (numbers[key] === undefined) continue;
      if (!validGenerationNumber(key, numbers[key])) throw new RequestError("Invalid " + key + " for this chat.");
      options.generation[key] = numbers[key];
    }
  }
  if (body.formats !== undefined) {
    const formats = record(body.formats);
    const { think, thinking, reasoning } = formats;
    if (typeof think !== "boolean" || typeof thinking !== "boolean" || typeof reasoning !== "boolean") throw new RequestError("Invalid thinking format.");
    options.formats = { think, thinking, reasoning };
    if (formats.customTags !== undefined) {
      if (!Array.isArray(formats.customTags) || formats.customTags.length > customThinkingTagLimit) throw new RequestError("Too many custom thinking tags.");
      const used = new Set<string>();
      options.formats.customTags = formats.customTags.map((value) => {
        const entry = record(value);
        const tag = typeof entry.tag === "string" ? customThinkingTag(entry.tag) : "";
        if (!tag || used.has(tag) || typeof entry.enabled !== "boolean") throw new RequestError("Use unique, valid custom thinking tags.");
        used.add(tag);
        return { tag, enabled: entry.enabled };
      });
    }
  }
  if (body.view !== undefined) {
    const view = record(body.view);
    const colors = record(view.colors);
    const number = (key: string, min: number, max: number) => {
      const value = view[key];
      if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new RequestError("Invalid chat " + key + ".");
      return value;
    };
    const toggle = (key: string) => {
      if (typeof view[key] !== "boolean") throw new RequestError("Invalid chat " + key + ".");
      return view[key];
    };
    const font = view.font;
    if (typeof font !== "string" || !Object.hasOwn(chatFonts, font)) throw new RequestError("Choose a chat font.");
    options.view = {
      ...defaultChatView, inheritSize: typeof view.inheritSize === "boolean" ? view.inheritSize : view.size === 17, size: number("size", 12, 32), font: font as keyof typeof chatFonts,
      colors: Object.fromEntries(chatColors.map(({ key }) => {
        const color = colors[key];
        if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) throw new RequestError("Choose a valid chat color.");
        return [key, color];
      })) as ChatColors,
      autoscroll: toggle("autoscroll"), streaming: toggle("streaming"), colorfulEditing: toggle("colorfulEditing"),
      opacity: number("opacity", 0, 100), blur: number("blur", 0, 100),
    };
  }
  return options;
}

function readAutoMemory(value: Record<string, unknown>): AutoMemory {
  if (typeof value.enabled !== "boolean" || typeof value.book !== "boolean" ||
    !Array.isArray(value.templates) || !value.templates.length || value.templates.length > 24) {
    throw new RequestError("Review the automatic memory settings.");
  }
  const size = (key: keyof typeof memoryLimits) => {
    const number = value[key];
    const { min, max } = memoryLimits[key];
    if (typeof number !== "number" || !Number.isInteger(number) || number < min || number > max) {
      throw new RequestError("Review the message interval and token limits.");
    }
    return number;
  };
  const templates = value.templates.map(raw => {
    const template = record(raw);
    return { id: field(template, "id", 64, true), name: field(template, "name", 80, true), prompt: field(template, "prompt", memoryPromptLimit, true) };
  });
  const templateId = field(value, "templateId", 64, true);
  const input = size("input"), previous = size("previous"), output = size("output"), suggested = size("suggested");
  if (!templates.some(template => template.id === templateId) || new Set(templates.map(template => template.id)).size !== templates.length ||
    suggested > output) throw new RequestError("Choose a valid summary prompt and keep the suggested output within the output limit.");
  return { enabled: value.enabled, book: value.book, every: size("every"), profileId: field(value, "profileId", 64),
    model: field(value, "model", 200), templateId, templates, input, previous, output, suggested };
}
