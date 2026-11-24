export const generationRanges = {
  temperature: { min: 0, max: 2, step: 0.01 },
  maxOutput: { min: 0, max: 50_000, step: 1 },
  contextSize: { min: 256, max: 2_000_000, step: 1 },
  topK: { min: 0, max: 1000, step: 1 },
  topP: { min: 0, max: 1, step: 0.01 },
  repetitionPenalty: { min: 0, max: 2, step: 0.01 },
  frequencyPenalty: { min: -2, max: 2, step: 0.01 },
} as const;

export type GenerationNumber = keyof typeof generationRanges;
export type GenerationSettings = Record<GenerationNumber, number> & {
  globalPrompt: string;
  prefill: string;
};

export const defaultGeneration: GenerationSettings = {
  temperature: 1, maxOutput: 1024, contextSize: 128_000, topK: 0, topP: 0,
  repetitionPenalty: 0, frequencyPenalty: 0, globalPrompt: "", prefill: "",
};

type SavedPrompt = { id: string; name: string; content: string };
export type GenerationConfig = { current: GenerationSettings; presets: { name: string; settings: GenerationSettings }[]; prompts: SavedPrompt[] };

export function effectivePrompt(config: GenerationConfig, profilePromptId = "") {
  return config.prompts.find(({ id }) => id === profilePromptId)?.content ?? config.current.globalPrompt;
}
