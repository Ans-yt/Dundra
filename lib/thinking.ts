import type { ModelThinking } from "./types";

export const noThinking: ModelThinking = { enabled: false, levels: [] };
export const commonThinkingLevels = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

export function normalizeThinkingLevel(value: string) {
  const level = value.trim().toLowerCase();
  if (level === "med") return "medium";
  if (/^extra[ -]?high$/.test(level)) return "xhigh";
  return level;
}

export function thinkingLabel(level: string) {
  if (level === "xhigh") return "Extra high";
  return level.charAt(0).toUpperCase() + level.slice(1);
}
