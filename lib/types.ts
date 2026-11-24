import type { ChatOptions } from "./chat-options";
import type { GenerationNumber } from "./generation";

export type Character = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  greeting: string;
  defaultPersonaId?: string;
  alternateGreetings?: string[];
  tags: string;
  hasPortrait?: boolean;
  creator?: string | null;
  source?: string | null;
};

export type Persona = { id: string; name: string; description: string; portrait?: string | null };
export type Chat = {
  id: string;
  title: string;
  character_id: string;
  persona_id: string | null;
  character: string;
  persona: string | null;
  updated: string;
  preview: string | null;
  message_count: number;
  hasPortrait?: boolean;
  personaPortrait?: string | null;
};
type MessagePlayer = { id: string | null; name: string; portrait: string | null };
export type Message = { media?: string; displayContent?: string; id: number; role: "user" | "assistant"; content: string; reasoning?: string; thinkingMs?: number; opening?: boolean; edited?: boolean; variant?: number; variantCount?: number; player?: MessagePlayer };
export type Library = { characters: Character[]; personas: Persona[]; chats: Chat[]; model: string | null; defaultPersonaId: string | null };
export type Conversation = { chat: Chat; messages: Message[]; revision: number };
type ModelSettings = { endpoint: string; model: string; hasKey: boolean };
export type ModelThinking = { enabled: boolean; levels: string[] };
export type ModelProfile = ModelSettings & { id: string; name: string; presetName?: string; promptId: string; thinking: ModelThinking };
export type ChatPreferences = {
  memoryStatus: import("./auto-memory").MemoryStatus;
  profileId: string | null;
  activeProfileId: string;
  profilePreset: string;
  provider: Pick<ModelProfile, "id" | "name" | "model" | "thinking">;
  profiles: Pick<ModelProfile, "id" | "name" | "model" | "endpoint">[];
  thinkingLevel: string;
  options: ChatOptions;
  generationDefaults: Record<GenerationNumber, number>;
  promptTokens: number;
  background: string | null;
};
export type ChatSession = Conversation & { preferences: ChatPreferences };
export type ModelProfiles = {
  activeId: string;
  profiles: ModelProfile[];
  prompts: { id: string; name: string; tokens: number }[];
  presets: string[];
  globalPromptTokens: number;
};
