import { generationRanges, type GenerationNumber } from "./generation";
import { defaultChatBonus, type ChatBonus } from "./chat-bonus";
import { defaultAutoMemory, type AutoMemory } from "./auto-memory";

export const generationControls: { key: GenerationNumber; label: string }[] = [
  { key: "maxOutput", label: "Max output tokens" },
  { key: "contextSize", label: "Context size" },
  { key: "temperature", label: "Temperature" },
  { key: "topP", label: "Top P" },
  { key: "topK", label: "Top K" },
  { key: "repetitionPenalty", label: "Repetition penalty" },
  { key: "frequencyPenalty", label: "Frequency penalty" },
];

export const thinkingFormats = [
  { key: "think", label: "<think> … </think>" },
  { key: "thinking", label: "<thinking> … </thinking>" },
  { key: "reasoning", label: "Provider reasoning fields" },
] as const;
export type ThinkingFormats = Record<(typeof thinkingFormats)[number]["key"], boolean> & { customTags?: { tag: string; enabled: boolean }[] };
const defaultThinkingFormats: ThinkingFormats = { think: true, thinking: true, reasoning: true };
export const customThinkingTagLimit = 12;

export function customThinkingTag(value: string) {
  const name = value.trim().toLowerCase().replace(/^<([a-z][a-z0-9_-]*)>$/, "$1");
  return /^[a-z][a-z0-9_-]{0,31}$/.test(name) && name !== "think" && name !== "thinking" ? name : "";
}

export const chatColors = [
  { key: "text", label: "Text" }, { key: "italic", label: "Italic text" }, { key: "edited", label: "Edited label" },
  { key: "bold", label: "Bold text" }, { key: "code", label: "Code" }, { key: "dialogue", label: "Dialogue" },
] as const;
export type ChatColors = Record<(typeof chatColors)[number]["key"], string>;
export const chatFonts = { serif: "Georgia", sans: "System sans", rounded: "Trebuchet MS", mono: "Monospace" } as const;
export const defaultChatText = {
  size: 17, inheritSize: true, font: "serif" as keyof typeof chatFonts,
  colors: { text: "#f6f2fa", italic: "#ccc5d6", edited: "#d4b7ff", bold: "#f6f2fa", code: "#9ce4df", dialogue: "#f5dfbd" } satisfies ChatColors,
};
export const defaultChatView = {
  ...defaultChatText, autoscroll: true, streaming: true, colorfulEditing: false, opacity: 18, blur: 0,
};
export type ChatViewOptions = typeof defaultChatView;
type ChatGeneration = Partial<Record<GenerationNumber, number>>;
export const chatMemoryLimit = 16_000;
export const actionPromptLimit = 4_000;
type ActionPrompts = { impersonate: string; continue: string };
export type ChatOptions = { autoMemory: AutoMemory; actionPrompts: ActionPrompts; generation: ChatGeneration; view: ChatViewOptions; formats: ThinkingFormats; memory: string; authorNote: string; noteDepth: number; bonus: ChatBonus };
export const defaultChatOptions: ChatOptions = { autoMemory: defaultAutoMemory, actionPrompts: { impersonate: "", continue: "" }, generation: {}, view: defaultChatView, formats: defaultThinkingFormats, memory: "", authorNote: "", noteDepth: 4, bonus: defaultChatBonus };

export function validGenerationNumber(key: GenerationNumber, value: unknown): value is number {
  const { min, max, step } = generationRanges[key];
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (step !== 1 || Number.isInteger(value));
}
