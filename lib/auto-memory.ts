export const memoryPromptLimit = 4_000;

type MemoryTemplate = { id: string; name: string; prompt: string };
export type AutoMemory = {
  enabled: boolean;
  every: number;
  profileId: string;
  model: string;
  templateId: string;
  templates: MemoryTemplate[];
  input: number;
  previous: number;
  output: number;
  suggested: number;
  book: boolean;
};

export const memoryLimits = {
  every: { min: 1, max: 1000 },
  input: { min: 128, max: 128_000 },
  previous: { min: 0, max: 8192 },
  output: { min: 64, max: 8192 },
  suggested: { min: 0, max: 8192 },
} as const;

export const defaultAutoMemory: AutoMemory = {
  enabled: false, every: 20, profileId: "", model: "",
  templateId: "story", input: 8192, previous: 1536, output: 1024, suggested: 600, book: false,
  templates: [
    { id: "story", name: "General roleplay", prompt: "Summarize the story so far for a writer continuing the roleplay. Preserve the chronology, significant actions and decisions, changes to the cast and setting, and unresolved threads. Keep concrete details and distinguish established facts from speculation." },
    { id: "adventure", name: "RPG and adventure", prompt: "Maintain a concise adventure log. Record completed and open quests, locations and routes, items gained or spent, injuries, new abilities, allies and threats, clues, and the party’s current plan. Preserve established numbers and outcomes exactly." },
    { id: "relationships", name: "Characters and relationships", prompt: "Track the cast’s evolving relationships, motives, promises, conflicts, boundaries, and what each character knows. Record the events that caused a change and the emotional state at the end of the scene. Use each character’s name where it helps disambiguate." },
  ],
};

export type MemoryStatus = { summary: string; bookId: string | null; running: boolean; error: string; details?: string };
