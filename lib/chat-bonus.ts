export const postProcessingModes = [
  ["none", "None"], ["merge-tools", "Merge consecutive roles (with tools)"],
  ["semi-tools", "Semi-strict (alternating roles; with tools)"], ["strict-tools", "Strict (user first, alternating roles; with tools)"],
  ["merge", "Merge consecutive roles (no tools)"], ["semi", "Semi-strict (alternating roles; no tools)"],
  ["strict", "Strict (user first, alternating roles; no tools)"], ["single", "Single user message (no tools)"],
] as const;

export type PostProcessing = (typeof postProcessingModes)[number][0];
export type CustomHeader = { name: string; value: string };
export type ChatBonus = {
  messageLimit: number; streamingFps: number; examples: "normal" | "keep" | "strip"; imageSwipe: "generate" | "rollover";
  smoothStreaming: boolean; streamFade: boolean; fixedAvatars: boolean; postProcessing: PostProcessing;
  continuePrefill: boolean; squashSystem: boolean; functionCalling: boolean; interleavedThinking: boolean;
  inlineMedia: boolean; imageQuality: "auto" | "low" | "high"; seed: number | null;
  headers: CustomHeader[]; headerOrigin?: string;
};

export const defaultChatBonus: ChatBonus = {
  continuePrefill: false, squashSystem: false, functionCalling: false, interleavedThinking: false,
  inlineMedia: true, imageQuality: "auto", seed: null,
  messageLimit: 0, streamingFps: 30, examples: "normal", imageSwipe: "generate",
  smoothStreaming: false, streamFade: false, fixedAvatars: false, postProcessing: "none", headers: [],
};

export function allowsFunctions(mode: PostProcessing) {
  return mode === "none" || mode.endsWith("-tools");
}

export function headersForEndpoint(bonus: ChatBonus | undefined, endpoint: string) {
  try {
    return bonus?.headerOrigin === new URL(endpoint).origin ? bonus.headers : [];
  } catch { return []; }
}
