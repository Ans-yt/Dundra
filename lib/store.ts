import { withEmbeddedLore, type LoreEntry, type Lorebook, type LoreScope } from "./lorebook";
import { activeLore } from "./lore-activation";
import { arrangePreset } from "./preset-prompt";
import { defaults, presetSettings, type Advanced } from "./tavern";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import type { CardDraft, CardFields } from "./cards";
import { defaultGeneration, effectivePrompt, type GenerationConfig } from "./generation";
import { countTextTokens } from "./tokens";
import { defaultChatOptions, type ChatOptions } from "./chat-options";
import { chatHistoryText, expandNames } from "./chat-text";
import type { StoredImage } from "./media";

import type { Character, Chat, ChatPreferences, Conversation, Message, ModelProfile, ModelProfiles, ModelThinking, Persona } from "./types";
import { RequestError } from "./http";
import type { Problem } from "./diagnostics";
import type { MemoryStatus } from "./auto-memory";
import { noThinking } from "./thinking";

const processCache = globalThis as typeof globalThis & { dundraDb?: DatabaseSync };

function database() {
  if (processCache.dundraDb) return processCache.dundraDb;
  const data = resolve(process.env.DUNDRA_DATA_DIR || process.env.NITANOR_DATA_DIR || "data");
  mkdirSync(data, { recursive: true });
  const currentPath = join(data, "dundra.sqlite");
  const legacyPath = join(data, "nitanor.sqlite");
  const db = new DatabaseSync(!existsSync(currentPath) && existsSync(legacyPath) ? legacyPath : currentPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON");
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
      instructions TEXT NOT NULL, greeting TEXT NOT NULL, tags TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS character_persona_defaults (character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE, persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS character_persona_opt_out (
      character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS workspace_setup (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      default_persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
      name TEXT, salt TEXT, hash TEXT
    );
    DROP TABLE IF EXISTS workspace_sessions;
    CREATE TABLE IF NOT EXISTS lorebooks (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, scan_depth INTEGER NOT NULL, entries TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lorebook_image_settings (id TEXT PRIMARY KEY REFERENCES lorebooks(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS lorebook_budgets (id TEXT PRIMARY KEY REFERENCES lorebooks(id) ON DELETE CASCADE, tokens INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS lore_activations (message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL, starts TEXT NOT NULL, PRIMARY KEY(message_id, ordinal));
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY, title TEXT NOT NULL,
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
      persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL, updated TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_lorebooks (
      owner_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      lorebook_id TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
      PRIMARY KEY (owner_id, lorebook_id)
    );
    CREATE TABLE IF NOT EXISTS character_lorebooks (
      owner_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      lorebook_id TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
      PRIMARY KEY (owner_id, lorebook_id)
    );
    CREATE TABLE IF NOT EXISTS persona_lorebooks (
      owner_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      lorebook_id TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
      PRIMARY KEY (owner_id, lorebook_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('assistant', 'user')), content TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_chat_id ON messages(chat_id, id);
    CREATE TABLE IF NOT EXISTS advanced_config (id INTEGER PRIMARY KEY, config TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_transfer_headers (chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE, metadata TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS message_transfer_info (message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, metadata TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS message_media (message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, url TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS model_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      endpoint TEXT NOT NULL, model TEXT NOT NULL, api_key TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_profiles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      endpoint TEXT NOT NULL, model TEXT NOT NULL, api_key TEXT NOT NULL, prompt_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_profile_selection (
      id INTEGER PRIMARY KEY CHECK (id = 1), profile_id TEXT NOT NULL REFERENCES model_profiles(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS profile_presets (profile_id TEXT PRIMARY KEY REFERENCES model_profiles(id) ON DELETE CASCADE, preset TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS model_profile_thinking (
      profile_id TEXT PRIMARY KEY REFERENCES model_profiles(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL, levels TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_preferences (
      chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
      profile_id TEXT, thinking_profile_id TEXT, thinking_level TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS chat_options (
      chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
      config TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS chat_memory (
      chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
      covered INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      book_id TEXT REFERENCES lorebooks(id) ON DELETE SET NULL,
      run TEXT NOT NULL DEFAULT '',
      expires INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT ''
    );
    CREATE TRIGGER IF NOT EXISTS delete_chat_memory_book AFTER DELETE ON chat_memory
      WHEN OLD.book_id IS NOT NULL BEGIN DELETE FROM lorebooks WHERE id = OLD.book_id; END;
    CREATE TABLE IF NOT EXISTS message_variants (
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL, content TEXT NOT NULL, reasoning TEXT NOT NULL, edited INTEGER NOT NULL, active INTEGER NOT NULL,
      PRIMARY KEY (message_id, ordinal)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS active_message_variant ON message_variants(message_id) WHERE active = 1;
    CREATE TABLE IF NOT EXISTS reply_thinking_times (
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL, elapsed_ms INTEGER NOT NULL, PRIMARY KEY (message_id, ordinal)
    );
    CREATE TABLE IF NOT EXISTS message_openings (
      message_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      variant_ordinal INTEGER NOT NULL,
      PRIMARY KEY (message_id, position),
      FOREIGN KEY (message_id, variant_ordinal) REFERENCES message_variants(message_id, ordinal) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS message_players (
      message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL, name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS persona_portraits (
      id TEXT PRIMARY KEY REFERENCES personas(id) ON DELETE CASCADE,
      version TEXT NOT NULL, mime TEXT NOT NULL, image BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_backgrounds (
      id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
      version TEXT NOT NULL, mime TEXT NOT NULL, image BLOB NOT NULL
    );
    INSERT OR IGNORE INTO model_profiles
      SELECT 'default', 'Default', endpoint, model, api_key, '' FROM model_settings
      WHERE id = 1 AND NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'model-profiles');
    DELETE FROM model_settings WHERE id = 1;
    INSERT OR IGNORE INTO app_meta VALUES ('model-profiles');
    CREATE TABLE IF NOT EXISTS generation_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1), config TEXT NOT NULL
    );
    DROP TABLE IF EXISTS ranking_snapshots;
    CREATE TABLE IF NOT EXISTS character_credits (
      character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      creator TEXT NOT NULL, source TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS character_cards (
      character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      alternate_greetings TEXT NOT NULL DEFAULT '[]',
      original TEXT NOT NULL DEFAULT '{}',
      portrait BLOB
    );
    UPDATE lorebooks SET name = 'Lorebook memory'
      WHERE name = 'Memory Book' AND id IN (SELECT book_id FROM chat_memory);
    COMMIT;
  `);
  migrateOpeningVariants(db);
  return processCache.dundraDb = db;
}

export function advancedConfig(): Advanced {
  const row = database().prepare("SELECT config FROM advanced_config WHERE id=1").get();
  return row ? {...defaults, ...JSON.parse(String(row.config))} : defaults;
}
export function connectionAdvanced(presetName: string) {
  const config = advancedConfig();
  return config.enabled && presetName && config.library.some(entry => entry.name === presetName)
    ? { ...config, presets: true, selected: presetName } : config;
}
export function saveAdvanced(config: Advanced) {
  database().prepare("INSERT OR REPLACE INTO advanced_config VALUES (1, ?)").run(JSON.stringify(config));
}
const loreTables = { chat: "chat_lorebooks", character: "character_lorebooks", persona: "persona_lorebooks" } as const;
const loreOwners = { chat: "chats", character: "characters", persona: "personas" } as const;

export function lorebookList(owner = "") {
  return database().prepare(`SELECT id, name FROM lorebooks b
    WHERE NOT EXISTS (SELECT 1 FROM chat_memory WHERE book_id = b.id AND chat_id <> ?)
    ORDER BY name COLLATE NOCASE, id`).all(owner).map(row => ({ id: String(row.id), name: String(row.name) }));
}

function hydrateLorebook(row: Record<string, SQLOutputValue>): Lorebook {
  return { id: String(row.id), name: String(row.name), scan_depth: Number(row.scan_depth), entries: JSON.parse(String(row.entries)), token_budget: Number(row.tokens ?? 0), image_attachments: Boolean(row.image_attachments) };
}

export function lorebook(id: string): Lorebook | undefined {
  const row = database().prepare(`SELECT b.*, limits.tokens, images.id IS NOT NULL AS image_attachments FROM lorebooks b
    LEFT JOIN lorebook_budgets limits ON limits.id = b.id LEFT JOIN lorebook_image_settings images ON images.id = b.id WHERE b.id = ?`).get(id);
  return row && hydrateLorebook(row);
}

export function saveLorebook(book: Lorebook) {
  transaction(db => {
    db.prepare(`INSERT INTO lorebooks VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, scan_depth=excluded.scan_depth, entries=excluded.entries`)
    .run(book.id, book.name, book.scan_depth, JSON.stringify(book.entries));
    db.prepare("INSERT OR REPLACE INTO lorebook_budgets VALUES (?, ?)").run(book.id, book.token_budget ?? 0);
    if (book.image_attachments) db.prepare("INSERT OR IGNORE INTO lorebook_image_settings VALUES (?)").run(book.id);
    else db.prepare("DELETE FROM lorebook_image_settings WHERE id = ?").run(book.id);
  });
}

export function deleteLorebook(id: string) {
  database().prepare("DELETE FROM lorebooks WHERE id = ?").run(id);
}

export function loreLinks(scope: LoreScope, owner: string) {
  return database().prepare(`SELECT lorebook_id FROM ${loreTables[scope]} WHERE owner_id = ? ORDER BY rowid`)
    .all(owner).map(row => String(row.lorebook_id));
}

export function setLoreLink(scope: LoreScope, owner: string, id: string, enabled: boolean) {
  const db = database();
  if (!db.prepare(`SELECT 1 FROM ${loreOwners[scope]} WHERE id = ?`).get(owner) || !db.prepare("SELECT 1 FROM lorebooks WHERE id = ?").get(id)) {
    throw new RequestError("Lorebook or link target not found.", 404);
  }
  if (db.prepare("SELECT 1 FROM chat_memory WHERE book_id = ?").get(id)) {
    throw new RequestError("Manage this lorebook in its chat’s Advanced memory settings.");
  }
  const table = loreTables[scope];
  if (enabled) db.prepare(`INSERT OR IGNORE INTO ${table} VALUES (?, ?)`).run(owner, id);
  else db.prepare(`DELETE FROM ${table} WHERE owner_id = ? AND lorebook_id = ?`).run(owner, id);
}

type ChatLoreTargets = Pick<Conversation["chat"], "id" | "character_id" | "persona_id">;

function loreTargets(id: string): ChatLoreTargets | undefined {
  const row = database().prepare("SELECT character_id, persona_id FROM chats WHERE id = ?").get(id);
  return row && { id, character_id: String(row.character_id), persona_id: row.persona_id ? String(row.persona_id) : null };
}

function linksForChat(chat: ChatLoreTargets) {
  const inherited = [...new Set([...loreLinks("character", chat.character_id),
    ...(chat.persona_id ? loreLinks("persona", chat.persona_id) : [])])];
  const memory = memoryStatus(chat.id);
  if (memory.bookId && chatOptions(chat.id).autoMemory.book) inherited.push(memory.bookId);
  return { inherited, direct: loreLinks("chat", chat.id), memoryBookId: memory.bookId };
}

export function chatLorebookLinks(id: string) {
  const chat = loreTargets(id);
  return chat && linksForChat(chat);
}

export function linkedChatLorebooks(chat: ChatLoreTargets) {
  const { inherited, direct } = linksForChat(chat);
  const ids = [...new Set([...inherited, ...direct])];
  if (!ids.length) return [];
  return database().prepare(`SELECT b.*, limits.tokens, images.id IS NOT NULL AS image_attachments FROM json_each(?) links
    JOIN lorebooks b ON b.id = links.value
    LEFT JOIN lorebook_budgets limits ON limits.id = b.id LEFT JOIN lorebook_image_settings images ON images.id = b.id ORDER BY links.key`).all(JSON.stringify(ids)).map(hydrateLorebook);
}

export function loreTiming(id: string, before = Number.MAX_SAFE_INTEGER): Record<string, number> {
  const rows = database().prepare(`SELECT events.key, MAX(events.value) AS start FROM messages m
    JOIN lore_activations a ON a.message_id = m.id
    LEFT JOIN message_variants v ON v.message_id = m.id AND v.active = 1
    JOIN json_each(a.starts) events WHERE m.chat_id = ? AND m.id < ? AND a.ordinal = COALESCE(v.ordinal, 1)
    GROUP BY events.key`).all(id, before);
  return Object.fromEntries(rows.map(row => [String(row.key), Number(row.start)]));
}

export function originalFields(id:string): CardFields {
  const row = database().prepare("SELECT original FROM character_cards WHERE character_id=?").get(id);
  return row ? JSON.parse(String(row.original)) : {};
}
const chatQuery = `SELECT c.*, x.name AS character, p.name AS persona, pp.version AS personaPortrait,
    EXISTS(SELECT 1 FROM character_cards d WHERE d.character_id = x.id AND d.portrait IS NOT NULL) AS has_portrait,
    (SELECT substr(CASE WHEN coalesce(v.reasoning, '') <> '' THEN 'Thoughts · ' || v.reasoning
       WHEN lower(ltrim(m.content)) LIKE '<think>%' THEN 'Thoughts · ' || replace(substr(ltrim(m.content), 8), '</think>', ' · ')
       ELSE m.content END, 1, 240) FROM messages m LEFT JOIN message_variants v ON v.message_id=m.id AND v.active=1 WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS preview,
    (SELECT count(*) FROM messages m WHERE m.chat_id = c.id) AS message_count
  FROM chats c JOIN characters x ON x.id = c.character_id LEFT JOIN personas p ON p.id = c.persona_id
  LEFT JOIN persona_portraits pp ON pp.id = p.id`;

const personaQuery = `SELECT p.*, pp.version AS portrait FROM personas p LEFT JOIN persona_portraits pp ON pp.id = p.id`;

function hydrateChat(row: Record<string, SQLOutputValue>): Chat {
  const { has_portrait, ...chat } = row;
  return { ...chat as Omit<Chat, "hasPortrait">, hasPortrait: Boolean(has_portrait) };
}

const characterQuery = `SELECT c.*, s.creator, s.source, d.alternate_greetings, (SELECT persona_id FROM character_persona_defaults WHERE character_id=c.id) AS default_persona,
  EXISTS (SELECT 1 FROM character_persona_opt_out WHERE character_id=c.id) AS no_persona,
  d.portrait IS NOT NULL AS has_portrait FROM characters c
  LEFT JOIN character_credits s ON s.character_id = c.id
  LEFT JOIN character_cards d ON d.character_id = c.id`;

function hydrateCharacter(row: Record<string, SQLOutputValue>): Character {
  return {
    id: String(row.id), name: String(row.name), description: String(row.description),
    instructions: String(row.instructions), greeting: String(row.greeting), tags: String(row.tags),
    creator: row.creator == null ? null : String(row.creator), source: row.source == null ? null : String(row.source),
    defaultPersonaId: row.no_persona ? "" : row.default_persona ? String(row.default_persona) : undefined,
    alternateGreetings: JSON.parse(String(row.alternate_greetings || "[]")), hasPortrait: Boolean(row.has_portrait),
  };
}

export function library() {
  const db = database();
  return {
    characters: db.prepare(characterQuery + " ORDER BY c.name COLLATE NOCASE").all().map(hydrateCharacter),
    personas: db.prepare(personaQuery + " ORDER BY p.name COLLATE NOCASE").all() as Persona[],
    chats: db.prepare(chatQuery + " ORDER BY c.updated DESC").all().map(hydrateChat),
    model: modelConnection().model || null,
    defaultPersonaId: workspacePersonaId() || null,
  };
}

const DEFAULT_MODEL_PROFILE = "default";

function activeModelProfile() {
  const row = database().prepare("SELECT profile_id FROM model_profile_selection WHERE id = 1").get();
  return row ? String(row.profile_id) : DEFAULT_MODEL_PROFILE;
}

function profileThinking(row: Record<string, SQLOutputValue>): ModelThinking {
  return row.levels == null ? noThinking : { enabled: Boolean(row.enabled), levels: JSON.parse(String(row.levels)) };
}

const profileQuery = `FROM model_profiles p LEFT JOIN model_profile_thinking t ON t.profile_id = p.id LEFT JOIN profile_presets pp ON pp.profile_id = p.id`;

function profileConnection(id: string) {
  const row = database().prepare(`SELECT p.*, pp.preset, t.enabled, t.levels ${profileQuery} WHERE p.id = ?`).get(id);
  if (row) return {
    id, name: String(row.name), endpoint: String(row.endpoint), model: String(row.model),
    key: String(row.api_key), presetName: String(row.preset || ""), promptId: String(row.prompt_id), thinking: profileThinking(row),
  };
  if (id !== DEFAULT_MODEL_PROFILE) return null;
  return {
    id, name: "Default", presetName: "", promptId: "", thinking: noThinking,
    endpoint: (process.env.DUNDRA_MODEL_URL ?? process.env.NITANOR_MODEL_URL)?.trim() || "http://127.0.0.1:11434/v1",
    model: (process.env.DUNDRA_MODEL ?? process.env.NITANOR_MODEL)?.trim() || "",
    key: (process.env.DUNDRA_MODEL_KEY ?? process.env.NITANOR_MODEL_KEY)?.trim() || "",
  };
}

export function modelConnection() {
  return profileConnection(activeModelProfile()) || profileConnection(DEFAULT_MODEL_PROFILE)!;
}

function savedModelProfiles(): ModelProfile[] {
  const profiles = database().prepare(`SELECT p.id, p.name, p.endpoint, p.model, pp.preset, p.prompt_id, p.api_key <> '' AS has_key, t.enabled, t.levels
    ${profileQuery} ORDER BY p.id <> 'default', p.name COLLATE NOCASE`).all().map((row): ModelProfile => ({
    id: String(row.id), name: String(row.name), endpoint: String(row.endpoint), model: String(row.model),
    presetName: String(row.preset || ""), promptId: String(row.prompt_id), hasKey: Boolean(row.has_key), thinking: profileThinking(row),
  }));
  if (!profiles.some((profile) => profile.id === DEFAULT_MODEL_PROFILE)) {
    const { key, ...profile } = profileConnection(DEFAULT_MODEL_PROFILE)!;
    profiles.unshift({ ...profile, hasKey: Boolean(key) });
  }
  return profiles;
}

export function modelProfiles(): ModelProfiles {
  const config = generationConfig();
  const prompts = config.prompts.map(({ id, name, content }) => ({ id, name, tokens: countTextTokens(content) }));
  return { activeId: activeModelProfile(), profiles: savedModelProfiles(), presets: advancedConfig().library.map(entry => entry.name), prompts, globalPromptTokens: countTextTokens(config.current.globalPrompt) };
}

export function generationConfig(): GenerationConfig {
  const row = database().prepare("SELECT config FROM generation_settings WHERE id = 1").get();
  if (!row) return { current: defaultGeneration, presets: [], prompts: [] };
  const config = JSON.parse(String(row.config)) as GenerationConfig;
  const settings = (value: GenerationConfig["current"]) => Object.fromEntries(Object.entries(defaultGeneration).map(([key, fallback]) => [key, value[key as keyof typeof value] ?? fallback])) as GenerationConfig["current"];
  return { current: settings(config.current), presets: config.presets.map(preset => ({ ...preset, settings: settings(preset.settings) })), prompts: config.prompts || [] };
}

export function changeGeneration(change: (saved: GenerationConfig) => GenerationConfig) {
  return transaction((db) => {
    const next = change(generationConfig());
    db.prepare(`INSERT INTO generation_settings VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET config=excluded.config`).run(JSON.stringify(next));
    return next;
  });
}

export function effectiveModelKey(endpoint: string, key: string | undefined, profileId = activeModelProfile()) {
  const previous = profileId === "new" ? null : profileConnection(profileId);
  if (profileId !== "new" && !previous) throw new RequestError("Model profile not found.", 404);
  if (key !== undefined) return key;
  if (!previous) return "";
  try { return new URL(previous.endpoint).origin === new URL(endpoint).origin ? previous.key : ""; }
  catch { return ""; }
}

export function saveModelConnection(endpoint: string, model: string, key: string | undefined,
  profileId = activeModelProfile(), name?: string, promptId?: string, thinking?: ModelThinking, presetName?: string) {
  return transaction((db) => {
    const creating = profileId === "new";
    const id = creating ? crypto.randomUUID() : profileId;
    const previous = creating ? null : profileConnection(id);
    const savedKey = effectiveModelKey(endpoint, key, profileId);
    const savedName = id === DEFAULT_MODEL_PROFILE ? "Default" : name || previous?.name || "";
    const savedPromptId = promptId ?? previous?.promptId ?? "";
    if (!savedName) throw new RequestError("Name the model profile.");
    if (savedPromptId && !generationConfig().prompts.some((prompt) => prompt.id === savedPromptId) && promptId !== undefined) {
      throw new RequestError("That prompt no longer exists.");
    }
    if (db.prepare("SELECT id FROM model_profiles WHERE name = ? COLLATE NOCASE AND id <> ?").get(savedName, id)
      || (id !== DEFAULT_MODEL_PROFILE && savedName.toLowerCase() === "default")) {
      throw new RequestError("A profile with that name already exists.", 409);
    }
    if (creating && (db.prepare("SELECT count(*) AS count FROM model_profiles").get()?.count as number) >= 30) {
      throw new RequestError("You can save up to 30 model profiles.");
    }
    db.prepare(`INSERT INTO model_profiles VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, endpoint=excluded.endpoint, model=excluded.model,
      api_key=excluded.api_key, prompt_id=excluded.prompt_id`)
      .run(id, savedName, endpoint, model, savedKey, savedPromptId);
    if (presetName !== undefined) {
      if (presetName && !advancedConfig().library.some(entry => entry.name === presetName)) throw new RequestError("Choose an available preset.");
      if (presetName) db.prepare("INSERT OR REPLACE INTO profile_presets VALUES (?, ?)").run(id, presetName);
      else db.prepare("DELETE FROM profile_presets WHERE profile_id = ?").run(id);
    }
    if (thinking) db.prepare(`INSERT INTO model_profile_thinking VALUES (?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET enabled=excluded.enabled, levels=excluded.levels`)
      .run(id, Number(thinking.enabled), JSON.stringify(thinking.levels));
    if (name !== undefined) return { ...modelProfiles(), selectedId: id };
    return { endpoint, model, hasKey: Boolean(savedKey) };
  });
}

export function selectModelProfile(id: string) {
  const db = database();
  if (!profileConnection(id)) throw new RequestError("Model profile not found.", 404);
  if (id === DEFAULT_MODEL_PROFILE) db.prepare("DELETE FROM model_profile_selection WHERE id = 1").run();
  else db.prepare(`INSERT INTO model_profile_selection VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET profile_id=excluded.profile_id`).run(id);
  return modelProfiles();
}

export function removeModelProfile(id: string) {
  if (id === DEFAULT_MODEL_PROFILE) throw new RequestError("Keep the default profile. You can edit its settings.");
  transaction((db) => {
    if (!db.prepare("DELETE FROM model_profiles WHERE id = ?").run(id).changes) throw new RequestError("Model profile not found.", 404);
    db.prepare("UPDATE chat_preferences SET profile_id = NULL WHERE profile_id = ?").run(id);
    db.prepare("UPDATE chat_preferences SET thinking_profile_id = NULL, thinking_level = '' WHERE thinking_profile_id = ?").run(id);
  });
  return modelProfiles();
}

export function chatModelConnection(id: string) {
  const row = database().prepare("SELECT * FROM chat_preferences WHERE chat_id = ?").get(id);
  const pinned = row?.profile_id ? profileConnection(String(row.profile_id)) : null;
  const connection = pinned ?? modelConnection();
  const level = row?.thinking_profile_id === connection.id ? String(row.thinking_level) : "";
  const thinkingLevel = connection.thinking.enabled && connection.thinking.levels.includes(level) ? level : "";
  return { connection, profileId: pinned?.id ?? null, thinkingLevel };
}

export function chatPreferences(id: string, session?: Conversation): ChatPreferences {
  const { connection, profileId, thinkingLevel } = chatModelConnection(id);
  const { id: providerId, name, model, thinking } = connection;
  const generation = generationConfig();
  const { globalPrompt: _prompt, prefill: _prefill, ...generationDefaults } = generation.current;
  const options = chatOptions(id);
  const cfg = connectionAdvanced(connection.presetName);
  const preset = cfg.enabled && cfg.presets ? cfg.library.find(entry => entry.name === cfg.selected)?.preset : undefined;
  let promptTokens = countTextTokens(effectivePrompt(generation, connection.promptId));
  const targets = session?.chat ?? loreTargets(id);
  const books = targets ? linkedChatLorebooks(targets) : [];
  if (targets && (preset || books.length || options.authorNote)) {
    const current = session ?? conversation(id);
    if (current) {
      const { chat, messages } = current;
      const expand = (s: string) => expandNames(s, chat.character, chat.persona || "you");
      const settings = { ...generation.current, ...(preset && presetSettings(preset)), ...options.generation };
      const prefill = expand(settings.prefill);
      const ordered = Boolean(preset?.prompt_order?.length);
      const scanDepth = books.reduce((max, book) => book.entries.reduce((depth, entry) => Math.max(depth, entry.scanDepth ?? 0), Math.max(max, book.scan_depth)), 0);
      const relevant = ordered ? messages : scanDepth ? messages.slice(-scanDepth) : [];
      const history = relevant.map(message => ({
        role: message.role,
        content: chatHistoryText(message, options.formats, chat.character, chat.persona || "you"),
      }));
      const actor = character(chat.character_id);
      const context = { character: chat.character, characterId: chat.character_id, tags: actor?.tags.split(","), seed: id,
        messageCount: messages.length, previous: loreTiming(id), trigger: "normal" };
      const lore = activeLore(books, history, context);
      const embedded = preset?.prompt_order?.length ? activeLore(withEmbeddedLore(originalFields(chat.character_id).character_book, []), history, context) : undefined;
      if (preset?.prompt_order?.length) {
        const card = originalFields(chat.character_id);
        const instructions = actor?.instructions ?? "";
        const historySet = new Set<object>(history);
        // Count preset entries before truncation. History, persona and memory have their own counters.
        const entries = arrangePreset(preset, [{role:"system",content:""}, ...history], { ...settings, prefill:"", contextSize: Infinity },
          card, card.mes_example ? instructions.replace("Example dialogue:\n" + card.mes_example, "") : instructions,
          "", "", expand, "send", undefined, options.bonus.examples, lore, embedded);
        const profilePrompt = generation.prompts.find(item => item.id === connection.promptId);
        promptTokens = (profilePrompt ? countTextTokens(expand(profilePrompt.content)) : 0) + entries.reduce((sum, entry) => sum + (historySet.has(entry) ? 0 : countTextTokens(entry.content)), 0);
      } else {
        promptTokens += [...lore.before_char, ...lore.after_char].reduce((sum, entry) => sum + countTextTokens(expand(entry)), 0);
      }
      promptTokens += [...lore.at_depth, ...(embedded?.at_depth ?? [])].reduce((sum, entry) => sum + countTextTokens(expand(entry.content)), 0);
      promptTokens += countTextTokens(expand(options.authorNote));
      if (preset) promptTokens += countTextTokens(prefill);
    }
  }
  const background = database().prepare("SELECT version FROM chat_backgrounds WHERE id = ?").get(id);
  return {
    profileId, thinkingLevel, profilePreset: cfg.presets && cfg.selected === connection.presetName ? connection.presetName : "", activeProfileId: activeModelProfile(),
    provider: { id: providerId, name, model, thinking },
    profiles: savedModelProfiles().map(({ id, name, model, endpoint }) => ({ id, name, model, endpoint })),
    options, generationDefaults, promptTokens, memoryStatus: memoryStatus(id),
    background: background ? String(background.version) : null,
  };
}

export function chatOptions(id: string): ChatOptions {
  const row = database().prepare("SELECT config FROM chat_options WHERE chat_id = ?").get(id);
  if (!row) return defaultChatOptions;
  const saved = JSON.parse(String(row.config));
  return { ...defaultChatOptions, ...saved, bonus: { ...defaultChatOptions.bonus, ...saved.bonus } };
}

export function changeChatOptions(id: string, options: Partial<ChatOptions>, background?: StoredImage | null, profileId?: string | null) {
  return transaction((db) => {
    if (!db.prepare("SELECT 1 FROM chats WHERE id = ?").get(id)) throw new RequestError("Chat not found.", 404);
    if (profileId !== undefined) writeChatProfile(db, id, profileId);
    const current = chatOptions(id);
    if (options.autoMemory && JSON.stringify(options.autoMemory) !== JSON.stringify(current.autoMemory)) {
      if (options.autoMemory.profileId && !profileConnection(options.autoMemory.profileId)) throw new RequestError("Choose a saved summary profile.");
      if (options.autoMemory.enabled && !current.autoMemory.enabled) {
        const head = Number(db.prepare("SELECT MAX(id) AS head FROM messages WHERE chat_id = ?").get(id)?.head ?? 0);
        db.prepare("INSERT OR IGNORE INTO chat_memory (chat_id, covered) VALUES (?, ?)").run(id, head);
      }
      db.prepare("UPDATE chat_memory SET run='', expires=0, error='' WHERE chat_id=?").run(id);
    }
    if (options.bonus?.headers.length) {
      options.bonus.headerOrigin = JSON.stringify(options.bonus.headers) === JSON.stringify(current.bonus.headers) && current.bonus.headerOrigin
        ? current.bonus.headerOrigin : new URL(chatModelConnection(id).connection.endpoint).origin;
    }
    db.prepare(`INSERT INTO chat_options (chat_id, config) VALUES (?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET config=excluded.config`).run(id, JSON.stringify({ ...current, ...options }));
    writeImage(db, "chat_backgrounds", id, background);
    return chatPreferences(id);
  });
}

type ImageTable = "chat_backgrounds" | "persona_portraits";

function writeImage(db: DatabaseSync, table: ImageTable, id: string, image?: StoredImage | null) {
  if (image === null) db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  if (image) db.prepare(`INSERT INTO ${table} VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET version=excluded.version, mime=excluded.mime, image=excluded.image`)
    .run(id, crypto.randomUUID(), image.mime, image.bytes);
}

export function storedImage(kind: "persona" | "background", id: string) {
  const table = kind === "persona" ? "persona_portraits" : "chat_backgrounds";
  return database().prepare(`SELECT mime, image FROM ${table} WHERE id = ?`).get(id) as { mime: string; image: Uint8Array } | undefined;
}

export function chooseChatProfile(id: string, profileId: string | null) {
  return transaction((db) => {
    if (!db.prepare("SELECT 1 FROM chats WHERE id = ?").get(id)) throw new RequestError("Chat not found.", 404);
    writeChatProfile(db, id, profileId);
  });
}

function writeChatProfile(db: DatabaseSync, id: string, profileId: string | null) {
  if (profileId && !profileConnection(profileId)?.model) throw new RequestError("Choose a configured model profile.");
  if (chatModelConnection(id).profileId !== profileId) db.prepare(`INSERT INTO chat_preferences (chat_id, profile_id) VALUES (?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET profile_id=excluded.profile_id, thinking_profile_id=NULL, thinking_level=''`).run(id, profileId);
}

export function chooseChatThinking(id: string, profileId: string, level: string) {
  return transaction((db) => {
    if (!db.prepare("SELECT 1 FROM chats WHERE id = ?").get(id)) throw new RequestError("Chat not found.", 404);
    const { connection } = chatModelConnection(id);
    if (profileId !== connection.id) throw new RequestError("The model profile changed. Reopen the chat to update the choices.", 409);
    if (!connection.thinking.enabled || (level && !connection.thinking.levels.includes(level))) {
      throw new RequestError("That thinking level is unavailable for this model profile.");
    }
    db.prepare(`INSERT INTO chat_preferences (chat_id, thinking_profile_id, thinking_level) VALUES (?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET thinking_profile_id=excluded.thinking_profile_id, thinking_level=excluded.thinking_level`)
      .run(id, profileId, level);
    return chatPreferences(id);
  });
}

export function character(id: string) {
  const row = database().prepare(characterQuery + " WHERE c.id = ?").get(id);
  return row ? hydrateCharacter(row) : undefined;
}

export function persona(id: string) {
  return database().prepare(personaQuery + " WHERE p.id = ?").get(id) as Persona | undefined;
}

export function chooseChatPersona(id: string, personaId: string | null) {
  transaction((db) => {
    const chat = db.prepare(`SELECT c.persona_id, p.name FROM chats c LEFT JOIN personas p ON p.id = c.persona_id WHERE c.id = ?`).get(id);
    if (!chat) throw new RequestError("Chat not found.", 404);
    if (personaId && !persona(personaId)) throw new RequestError("Persona not found.", 404);
    if (chat.persona_id === personaId) return;
    db.prepare(`INSERT OR IGNORE INTO message_players (message_id, persona_id, name)
      SELECT id, ?, ? FROM messages WHERE chat_id = ?`).run(chat.persona_id, chat.name ?? "", id);
    db.prepare("UPDATE chats SET persona_id = ? WHERE id = ?").run(personaId, id);
    touchConversation(db, id);
  });
}

export function conversation(id: string): Conversation | null {
  const db = database();
  const chat = db.prepare(chatQuery + " WHERE c.id = ?").get(id);
  if (!chat) return null;
  const revision = Number(db.prepare("SELECT revision FROM chat_options WHERE chat_id = ?").get(id)?.revision ?? 0);
  const messages = db.prepare(`SELECT m.id, m.role, m.content, (SELECT url FROM message_media WHERE message_id=m.id) AS media, v.reasoning, v.edited, mp.name AS player_name, mp.persona_id AS player_id, pp.version AS player_portrait,
    t.elapsed_ms, ov.position IS NOT NULL AS isOpening,
    COALESCE(ov.position, v.ordinal, 1) AS variant,
    CASE WHEN ov.position IS NOT NULL THEN (SELECT COUNT(*) FROM message_openings WHERE message_id = m.id)
      ELSE MAX(1, (SELECT COUNT(*) FROM message_variants WHERE message_id = m.id)) END AS variantCount
    FROM messages m LEFT JOIN message_variants v ON v.message_id = m.id AND v.active = 1
    LEFT JOIN reply_thinking_times t ON t.message_id = m.id AND t.ordinal = COALESCE(v.ordinal, 1)
    LEFT JOIN message_openings ov ON ov.message_id = m.id AND ov.variant_ordinal = v.ordinal
    LEFT JOIN message_players mp ON mp.message_id = m.id LEFT JOIN persona_portraits pp ON pp.id = mp.persona_id
    WHERE m.chat_id = ? ORDER BY m.id`).all(id).map((row): Message => ({
      id: Number(row.id), role: row.role as Message["role"], content: String(row.content),
      ...(row.elapsed_ms != null && { thinkingMs: Number(row.elapsed_ms) }),
      ...(row.isOpening ? { opening: true } : {}),
      ...(row.media ? {media: String(row.media)} : {}), reasoning: String(row.reasoning ?? ""), edited: Boolean(row.edited), variant: Number(row.variant), variantCount: Number(row.variantCount),
      ...(row.player_name === null ? {} : { player: { id: row.player_id as string | null, name: String(row.player_name), portrait: row.player_portrait as string | null } }),
    }));
  return { chat: hydrateChat(chat), messages, revision };
}

export function saveCharacter(item: Character, { portrait, lorebookIds }: { portrait?: Uint8Array | null; lorebookIds?: string[] } = {}) {
  transaction(db => {
    writeCharacter(db, item);
    if (portrait !== undefined) {
      db.prepare(`INSERT INTO character_cards (character_id, portrait) VALUES (?, ?)
        ON CONFLICT(character_id) DO UPDATE SET portrait = excluded.portrait`).run(item.id, portrait);
    }
    if (lorebookIds !== undefined) {
      const available = new Set(lorebookList().map(book => book.id));
      if (lorebookIds.some(id => !available.has(id))) throw new RequestError("A selected lorebook is no longer available. Reopen the character and try again.", 409);
      db.prepare("DELETE FROM character_lorebooks WHERE owner_id = ?").run(item.id);
      const attach = db.prepare("INSERT INTO character_lorebooks VALUES (?, ?)");
      for (const id of lorebookIds) attach.run(item.id, id);
    }
  });
}

function writeCharacter(db: DatabaseSync, item: Character) {
  db.prepare(`INSERT INTO characters VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
      instructions=excluded.instructions, greeting=excluded.greeting, tags=excluded.tags`)
    .run(item.id, item.name, item.description, item.instructions, item.greeting, item.tags);
  if (item.alternateGreetings !== undefined) {
    db.prepare(`INSERT INTO character_cards (character_id, alternate_greetings) VALUES (?, ?)
      ON CONFLICT(character_id) DO UPDATE SET alternate_greetings = excluded.alternate_greetings`)
      .run(item.id, JSON.stringify(item.alternateGreetings));
  }
}

export function importCharacter(draft: CardDraft, tags: string[]) {
  const item = draft.character;
  transaction((db) => {
    writeCharacter(db, { ...item, tags: tags.join(", ") });
    db.prepare("UPDATE character_cards SET original = ?, portrait = ? WHERE character_id = ?")
      .run(JSON.stringify(draft.original), draft.portrait ?? null, item.id);
    db.prepare("INSERT INTO character_credits VALUES (?, ?, ?)").run(item.id, item.creator || "", item.source || "");
  });
}

export function cardAssets(id: string) {
  const row = database().prepare("SELECT original, portrait FROM character_cards WHERE character_id = ?").get(id);
  return {
    original: JSON.parse(String(row?.original || "{}")) as CardFields,
    portrait: row?.portrait instanceof Uint8Array ? Buffer.from(row.portrait) : undefined,
  };
}

export function savePersona(item: Persona, portrait?: StoredImage | null) {
  transaction((db) => {
    db.prepare(`INSERT INTO personas VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description`).run(item.id, item.name, item.description);
    writeImage(db, "persona_portraits", item.id, portrait);
  });
}

function transaction<T>(action: (db: DatabaseSync) => T): T {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = action(db);
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function attachOpeningVariants(db: DatabaseSync, message: number, greetings: string[], currentPosition: number) {
  const active = db.prepare("SELECT ordinal FROM message_variants WHERE message_id = ? AND active = 1").get(message);
  if (!active) throw Error("Opening message has no active variant.");
  let ordinal = Number(db.prepare("SELECT MAX(ordinal) AS ordinal FROM message_variants WHERE message_id = ?").get(message)?.ordinal);
  const addVariant = db.prepare("INSERT INTO message_variants VALUES (?, ?, ?, '', 0, 0)");
  const attach = db.prepare("INSERT INTO message_openings VALUES (?, ?, ?)");
  for (const [index, greeting] of greetings.entries()) {
    const variant = index === currentPosition ? Number(active.ordinal) : ++ordinal;
    if (index !== currentPosition) addVariant.run(message, variant, greeting);
    attach.run(message, index + 1, variant);
  }
}

function migrateOpeningVariants(db: DatabaseSync) {
  if (db.prepare("SELECT 1 FROM app_meta WHERE key = 'opening-variants'").get()) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("SELECT 1 FROM app_meta WHERE key = 'opening-variants'").get()) {
      const existing = db.prepare(`SELECT m.id, m.content, x.name, x.greeting, d.alternate_greetings, p.name AS player,
        (SELECT v.content FROM message_variants v WHERE v.message_id = m.id AND v.ordinal = 1) AS initial
        FROM chats c JOIN messages m ON m.id = (SELECT MIN(id) FROM messages WHERE chat_id = c.id)
        JOIN characters x ON x.id = c.character_id LEFT JOIN character_cards d ON d.character_id = x.id
        LEFT JOIN personas p ON p.id = c.persona_id WHERE m.role = 'assistant'`).all();
      for (const row of existing) {
        const raw = [String(row.greeting), ...JSON.parse(String(row.alternate_greetings || "[]")) as string[]].filter(Boolean);
        const greetings = raw.map(text => expandNames(text, String(row.name), String(row.player || "you")));
        const find = (value: unknown) => raw.findIndex((text, index) => value === text || value === greetings[index]);
        const selected = find(row.content);
        const message = Number(row.id);
        ensureMessageVariant(db, message, String(row.content));
        attachOpeningVariants(db, message, greetings.length ? greetings : [String(row.content)], selected >= 0 ? selected : Math.max(0, find(row.initial)));
      }
      db.exec("INSERT INTO app_meta VALUES ('opening-variants')");
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function startChat(item: Character, player: Persona | undefined, openingIndex = 0, rememberPersona = false) {
  return transaction(db => {
    if (rememberPersona) {
      if (player) {
        db.prepare("DELETE FROM character_persona_opt_out WHERE character_id = ?").run(item.id);
        db.prepare("INSERT OR REPLACE INTO character_persona_defaults VALUES (?, ?)").run(item.id, player.id);
      } else {
        db.prepare("DELETE FROM character_persona_defaults WHERE character_id = ?").run(item.id);
        db.prepare("INSERT OR IGNORE INTO character_persona_opt_out VALUES (?)").run(item.id);
      }
    }
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO chats VALUES (?, ?, ?, ?, ?)").run(id, item.name, item.id, player?.id ?? null, new Date().toISOString());
    const greetings = [item.greeting, ...(item.alternateGreetings ?? [])].filter(Boolean)
      .map(text => expandNames(text, item.name, player?.name || "you"));
    const opening = greetings[openingIndex];
    if (opening) {
      const row = db.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, 'assistant', ?)").run(id, opening);
      const message = Number(row.lastInsertRowid);
      ensureMessageVariant(db, message, opening);
      attachOpeningVariants(db, message, greetings, openingIndex);
    }
    return id;
  });
}

export function importChatFile(item: Character, text: string, title: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (!lines.length || lines.length > 20001) throw new RequestError("Choose a JSONL chat with up to 20,000 messages.");
  const records = lines.map((line, index) => {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch { /* Report the line that needs attention. */ }
    throw new RequestError("Invalid chat record on line " + (index + 1) + ".");
  });
  const header = records[0].mes === undefined ? records.shift()! : {};
  if (!records.length && typeof header.character_name !== "string" && !header.chat_metadata) throw new RequestError("The file contains no chat messages.");
  return transaction(db => {
    const id = crypto.randomUUID();
    const player = db.prepare("SELECT id FROM personas WHERE name=? COLLATE NOCASE LIMIT 1").get(String(header.user_name || ""));
    db.prepare("INSERT INTO chats VALUES (?, ?, ?, ?, ?)").run(id, title || item.name, item.id, player?.id ?? null, new Date().toISOString());
    db.prepare("INSERT INTO chat_transfer_headers VALUES (?,?)").run(id, JSON.stringify(header));
    const insert = db.prepare("INSERT INTO messages (chat_id,role,content) VALUES (?,?,?)");
    const variant = db.prepare("INSERT INTO message_variants VALUES (?,?,?,?,0,?)");
    const info = db.prepare("INSERT INTO message_transfer_info VALUES (?,?)");
    for (const [index, record] of records.entries()) {
      const { mes, is_user, swipes, swipe_id, ...metadata } = record;
      if (typeof mes !== "string" || mes.length > 2000000 || typeof is_user !== "boolean") throw new RequestError("Invalid text or speaker in message " + (index + 1) + ".");
      if (swipes !== undefined && (!Array.isArray(swipes) || swipes.length > 1000 || swipes.some(value => typeof value !== "string" || value.length > 2000000))) throw new RequestError("Invalid swipes in message " + (index + 1) + ".");
      const message = insert.run(id, is_user ? "user" : "assistant", mes).lastInsertRowid;
      info.run(message, JSON.stringify(metadata));
      if (is_user) {
        const name = typeof record.name === "string" ? record.name : String(header.user_name || "You");
        db.prepare("INSERT INTO message_players VALUES (?,?,?)").run(message, name === header.user_name ? player?.id ?? null : null, name);
      } else {
        const variants: string[] = Array.isArray(swipes) && swipes.length ? swipes : [mes];
        const selected = typeof swipe_id === "number" && Number.isInteger(swipe_id) && swipe_id >= 0 && swipe_id < variants.length ? swipe_id : Math.max(0, variants.indexOf(mes));
        variants.forEach((value, offset) => {
          const extra = offset === selected ? record.extra : Array.isArray(record.swipe_info) ? record.swipe_info[offset]?.extra : undefined;
          variant.run(message, offset + 1, offset === selected ? mes : value, typeof extra?.reasoning === "string" ? extra.reasoning : "", Number(offset === selected));
          if (index === 0) db.prepare("INSERT INTO message_openings VALUES (?,?,?)").run(message, offset + 1, offset + 1);
        });
      }
    }
    return id;
  });
}

export function exportChatFile(id: string) {
  const session = conversation(id);
  if (!session) throw new RequestError("Chat not found.", 404);
  const db = database();
  const { chat, messages } = session;
  const header = db.prepare("SELECT metadata FROM chat_transfer_headers WHERE chat_id=?").get(id);
  const metadata = JSON.parse(String(header?.metadata ?? "{}"));
  const lines = [JSON.stringify({ chat_metadata: {}, create_date: chat.updated, ...metadata, user_name: chat.persona || metadata.user_name || "You", character_name: chat.character })];
  const extras = db.prepare("SELECT metadata FROM message_transfer_info WHERE message_id=?");
  const swipes = db.prepare("SELECT v.content,v.reasoning,v.active FROM message_variants v LEFT JOIN message_openings o ON o.message_id=v.message_id AND o.variant_ordinal=v.ordinal WHERE v.message_id=? AND (o.position IS NOT NULL OR NOT EXISTS (SELECT 1 FROM message_openings WHERE message_id=v.message_id)) ORDER BY COALESCE(o.position,v.ordinal)");
  for (const message of messages) {
    const meta = JSON.parse(String(extras.get(message.id)?.metadata ?? "{}"));
    const variants = message.role === "assistant" ? swipes.all(message.id) : [];
    lines.push(JSON.stringify({ send_date: chat.updated, is_system: false, ...meta,
      name: message.role === "user" ? message.player?.name || chat.persona || meta.name || "You" : chat.character,
      is_user: message.role === "user", mes: message.content, extra: { ...meta.extra, reasoning: message.reasoning || undefined },
      ...(variants.length && { swipe_id: Math.max(0, variants.findIndex(row => row.active)), swipes: variants.map(row => row.content),
        swipe_info: variants.map((row, index) => ({ ...meta.swipe_info?.[index], extra: { ...meta.swipe_info?.[index]?.extra, reasoning: row.reasoning || undefined } })) }) }));
  }
  return lines.join("\n") + "\n";
}

export function renameChat(id: string, title: string) {
  return database().prepare("UPDATE chats SET title = ? WHERE id = ?").run(title, id).changes > 0;
}

export function deleteChat(id: string) {
  return database().prepare("DELETE FROM chats WHERE id = ?").run(id).changes > 0;
}

export function deleteMessagesFrom(chat: string, message: number, revision: number) {
  return transaction(db => {
    getMessage(db, chat, message);
    const current = Number(db.prepare("SELECT revision FROM chat_options WHERE chat_id = ?").get(chat)?.revision ?? 0);
    if (current !== revision) throw new RequestError("The conversation changed. Reopen it before deleting messages.", 409);
    db.prepare("DELETE FROM messages WHERE chat_id = ? AND id >= ?").run(chat, message);
    invalidateMemoriesFrom(db, chat, message);
    touchConversation(db, chat);
  });
}

function touchConversation(db: DatabaseSync, id: string) {
  db.prepare(`INSERT INTO chat_options (chat_id, revision) VALUES (?, 1)
    ON CONFLICT(chat_id) DO UPDATE SET revision=revision+1`).run(id);
  db.prepare("UPDATE chats SET updated = ? WHERE id = ?").run(new Date().toISOString(), id);
}

function getMessage(db: DatabaseSync, chat: string, id: number) {
  const row = db.prepare("SELECT content FROM messages WHERE chat_id = ? AND id = ?").get(chat, id);
  if (!row) throw new RequestError("Message not found.", 404);
  return String(row.content);
}

function updateMessageContent(db: DatabaseSync, id: number, content: string) {
  db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(content, id);
}

function ensureMessageVariant(db: DatabaseSync, id: number, content: string) {
  db.prepare("INSERT OR IGNORE INTO message_variants VALUES (?, 1, ?, '', 0, 1)").run(id, content);
}

export function editChatMessage(chat: string, id: number, content: string) {
  transaction((db) => {
    const previous = getMessage(db, chat, id);
    if (previous === content) return;
    ensureMessageVariant(db, id, previous);
    updateMessageContent(db, id, content);
    db.prepare("UPDATE message_variants SET content = ?, edited = 1 WHERE message_id = ? AND active = 1").run(content, id);
    invalidateMemoriesFrom(db, chat, id);
    touchConversation(db, chat);
  });
}

export function selectChatVariant(chat: string, id: number, variant: number) {
  transaction((db) => {
    getMessage(db, chat, id);
    const opening = db.prepare("SELECT 1 FROM message_openings WHERE message_id = ?").get(id);
    const slot = opening ? db.prepare("SELECT variant_ordinal FROM message_openings WHERE message_id = ? AND position = ?").get(id, variant) : undefined;
    if (opening && !slot) throw new RequestError("Opening message not found.", 404);
    const ordinal = slot ? Number(slot.variant_ordinal) : variant;
    const picked = db.prepare("SELECT content, active FROM message_variants WHERE message_id = ? AND ordinal = ?").get(id, ordinal);
    if (!picked) throw new RequestError("Reply variant not found.", 404);
    if (picked.active) return;
    db.prepare("UPDATE message_variants SET active = 0 WHERE message_id = ? AND active = 1").run(id);
    db.prepare("UPDATE message_variants SET active = 1 WHERE message_id = ? AND ordinal = ?").run(id, ordinal);
    updateMessageContent(db, id, String(picked.content));
    invalidateMemoriesFrom(db, chat, id);
    touchConversation(db, chat);
  });
}

export function forkChat(id: string, through: number) {
  return transaction((db) => {
    const current = conversation(id);
    if (!current) throw new RequestError("Chat not found.", 404);
    getMessage(db, id, through);
    const branch = crypto.randomUUID();
    db.prepare("INSERT INTO chats VALUES (?, ?, ?, ?, ?)").run(branch, current.chat.title.slice(0, 93) + " (fork)",
      current.chat.character_id, current.chat.persona_id, new Date().toISOString());
    db.prepare(`INSERT INTO chat_preferences SELECT ?, profile_id, thinking_profile_id, thinking_level FROM chat_preferences WHERE chat_id = ?`).run(branch, id);
    db.prepare("INSERT INTO chat_options (chat_id, config) SELECT ?, config FROM chat_options WHERE chat_id = ?").run(branch, id);
    db.prepare("INSERT INTO chat_transfer_headers SELECT ?,metadata FROM chat_transfer_headers WHERE chat_id=?").run(branch,id);
    db.prepare("INSERT INTO chat_lorebooks SELECT ?, lorebook_id FROM chat_lorebooks WHERE owner_id = ?").run(branch, id);
    db.prepare("INSERT INTO chat_backgrounds SELECT ?, version, mime, image FROM chat_backgrounds WHERE id = ?").run(branch, id);
    const insert = db.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)");
    const copyVariants = db.prepare("INSERT INTO message_variants SELECT ?, ordinal, content, reasoning, edited, active FROM message_variants WHERE message_id = ?");
    const copyPlayer = db.prepare("INSERT INTO message_players SELECT ?, persona_id, name FROM message_players WHERE message_id = ?");
    for (const message of current.messages) {
      if (message.id > through) break;
      const copy = insert.run(branch, message.role, message.content);
      db.prepare("INSERT INTO message_media SELECT ?,url FROM message_media WHERE message_id=?").run(copy.lastInsertRowid,message.id);
      db.prepare("INSERT INTO message_transfer_info SELECT ?,metadata FROM message_transfer_info WHERE message_id=?").run(copy.lastInsertRowid,message.id);
      copyVariants.run(copy.lastInsertRowid, message.id);
      db.prepare("INSERT INTO reply_thinking_times SELECT ?, ordinal, elapsed_ms FROM reply_thinking_times WHERE message_id = ?").run(copy.lastInsertRowid, message.id);
      db.prepare("INSERT INTO message_openings SELECT ?, position, variant_ordinal FROM message_openings WHERE message_id = ?").run(copy.lastInsertRowid, message.id);
      db.prepare("INSERT INTO lore_activations SELECT ?, ordinal, starts FROM lore_activations WHERE message_id = ?").run(copy.lastInsertRowid, message.id);
      copyPlayer.run(copy.lastInsertRowid, message.id);
    }
    return branch;
  });
}

export type ReplyAction = { mode: "send"; input: string; media?: string } | { mode: "continue" | "alternate"; messageId: number };

export function finishReply(id: string, revision: number, action: ReplyAction, reply: string, reasoning: string, loreStarts: Record<string, number> = {}, thinkingMs?: number) {
  return transaction((db) => {
    if (!db.prepare("SELECT 1 FROM chats WHERE id = ?").get(id)
      || Number(db.prepare("SELECT revision FROM chat_options WHERE chat_id = ?").get(id)?.revision ?? 0) !== revision) return false;
    let messageId: number | bigint;
    if (action.mode === "send") {
      const insert = db.prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)");
      const user = insert.run(id, "user", action.input);
      if (action.media) db.prepare("INSERT INTO message_media VALUES (?,?)").run(user.lastInsertRowid,action.media);
      const added = insert.run(id, "assistant", reply);
      messageId = added.lastInsertRowid;
      if (reasoning) db.prepare("INSERT INTO message_variants VALUES (?, 1, ?, ?, 0, 1)").run(added.lastInsertRowid, reply, reasoning);
    } else {
      messageId = action.messageId;
      ensureMessageVariant(db, action.messageId, getMessage(db, id, action.messageId));
      if (action.mode === "alternate") {
        db.prepare("UPDATE message_variants SET active = 0 WHERE message_id = ? AND active = 1").run(action.messageId);
        db.prepare(`INSERT INTO message_variants SELECT ?, MAX(ordinal)+1, ?, ?, 0, 1
          FROM message_variants WHERE message_id = ?`).run(action.messageId, reply, reasoning, action.messageId);
      } else {
        db.prepare(`UPDATE message_variants SET content = ?, reasoning = trim(reasoning || char(10) || char(10) || ?)
          WHERE message_id = ? AND active = 1`).run(reply, reasoning, action.messageId);
      }
      updateMessageContent(db, action.messageId, reply);
      invalidateMemoriesFrom(db, id, action.messageId);
    }
    if (thinkingMs !== undefined) {
      db.prepare(`INSERT INTO reply_thinking_times VALUES (?, COALESCE((SELECT ordinal FROM message_variants WHERE message_id = ? AND active = 1), 1), ?)
        ON CONFLICT(message_id, ordinal) DO UPDATE SET elapsed_ms = elapsed_ms + excluded.elapsed_ms`).run(messageId, messageId, thinkingMs);
    }
    if (Object.keys(loreStarts).length) {
      db.prepare(`INSERT INTO lore_activations VALUES (?, COALESCE((SELECT ordinal FROM message_variants WHERE message_id = ? AND active = 1), 1), ?)
        ON CONFLICT(message_id, ordinal) DO UPDATE SET starts=json_patch(starts, excluded.starts)`).run(messageId, messageId, JSON.stringify(loreStarts));
    }
    touchConversation(db, id);
    return true;
  });
}



function invalidateMemoriesFrom(db: DatabaseSync, chatId: string, message: number) {
  const state = db.prepare("SELECT covered, book_id FROM chat_memory WHERE chat_id = ?").get(chatId);
  if (!state || Number(state.covered) < message) return;
  db.prepare("UPDATE chat_memory SET covered=0, summary='', run='', expires=0, error='' WHERE chat_id=?").run(chatId);
  const book = state.book_id ? lorebook(String(state.book_id)) : undefined;
  if (book) {
    const retained = book.entries.filter(entry => !entry.id.startsWith("memory-through-") ||
      Number(entry.id.slice("memory-through-".length)) < message);
    db.prepare("UPDATE lorebooks SET entries = ? WHERE id = ?").run(JSON.stringify(retained), book.id);
  }
}

export function memoryStatus(chatId: string): MemoryStatus {
  const row = database().prepare("SELECT summary, book_id, expires, error FROM chat_memory WHERE chat_id = ?").get(chatId);
  const raw = String(row?.error ?? "");
  let failure: Problem = { message: raw };
  if (raw.startsWith("{")) {
    try {
      const saved = JSON.parse(raw);
      if (typeof saved.message === "string" && typeof saved.details === "string") failure = saved;
    } catch { /* Older workspaces store the error as plain text. */ }
  }
  return { summary: String(row?.summary ?? ""), bookId: row?.book_id ? String(row.book_id) : null,
    running: Number(row?.expires ?? 0) > Date.now(), error: failure.message, details: failure.details };
}

export function beginMemorySummary(chatId: string, manual = false) {
  if (!manual && !chatOptions(chatId).autoMemory.enabled) return;
  return transaction(db => {
    const { autoMemory: settings, formats } = chatOptions(chatId);
    if (!manual && !settings.enabled) return;
    const state = db.prepare("SELECT * FROM chat_memory WHERE chat_id = ?").get(chatId);
    if (Number(state?.expires ?? 0) > Date.now()) return;
    const covered = manual && !state?.summary ? 0 : Number(state?.covered ?? 0);
    const stats = db.prepare("SELECT COUNT(*) AS count, MAX(id) AS head FROM messages WHERE chat_id = ? AND id > ?").get(chatId, covered);
    if (!manual && Number(stats?.count) < settings.every) return;
    const current = conversation(chatId);
    if (!current) throw new RequestError("Chat not found.", 404);
    if (!Number(stats?.count)) throw new RequestError("There are no new messages to summarize.", 409);
    const lease = crypto.randomUUID();
    const connection = settings.profileId ? profileConnection(settings.profileId) : chatModelConnection(chatId).connection;
    db.prepare(`INSERT INTO chat_memory (chat_id, run, expires) VALUES (?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET run=excluded.run, expires=excluded.expires, error=''`).run(chatId, lease, Date.now() + 95_000);
    return { lease, covered, head: Number(stats?.head), settings, formats, connection,
      chat: current.chat, messages: current.messages.filter(message => message.id > covered),
      previous: String(state?.summary ?? "") };
  });
}

export function finishMemorySummary(chatId: string, job: NonNullable<ReturnType<typeof beginMemorySummary>>,
  result?: { summary: string; entry?: LoreEntry }, error?: Problem) {
  transaction(db => {
    const state = db.prepare("SELECT * FROM chat_memory WHERE chat_id = ? AND run = ?").get(chatId, job.lease);
    if (!state) return;
    db.prepare("UPDATE chat_memory SET run='', expires=0, error=? WHERE chat_id = ?").run(error ? JSON.stringify(error) : "", chatId);
    if (!result) return;
    const source = db.prepare("SELECT id, content FROM messages WHERE chat_id = ? AND id > ? AND id <= ? ORDER BY id")
      .all(chatId, job.covered, job.head);
    if (source.length !== job.messages.length || source.some((row, index) =>
      row.id !== job.messages[index].id || row.content !== job.messages[index].content)) return;
    let bookId = state.book_id ? String(state.book_id) : null;
    if (job.settings.book && result.entry) {
      const book = bookId ? lorebook(bookId) : undefined;
      bookId ??= crypto.randomUUID();
      const entries = [...(book?.entries ?? []).slice(-499), result.entry];
      if (book) db.prepare("UPDATE lorebooks SET entries = ? WHERE id = ?").run(JSON.stringify(entries), bookId);
      else {
        db.prepare("INSERT INTO lorebooks VALUES (?, ?, ?, ?)").run(bookId, "Lorebook memory", 6, JSON.stringify(entries));
        db.prepare("INSERT INTO lorebook_budgets VALUES (?, ?)").run(bookId, 2048);
      }
    }
    db.prepare("UPDATE chat_memory SET covered=?, summary=?, book_id=? WHERE chat_id=?").run(job.head, result.summary, bookId, chatId);
  });
}

export function workspaceSetup() {
  return database().prepare("SELECT name, salt, hash FROM workspace_setup WHERE id = 1").get() as
    { name: string | null; salt: string | null; hash: string | null } | undefined;
}

export function setupPersonas() {
  return database().prepare("SELECT id, name FROM personas ORDER BY name COLLATE NOCASE").all() as { id: string; name: string }[];
}

export function workspacePersonaId() {
  const id = database().prepare("SELECT default_persona_id FROM workspace_setup WHERE id = 1").get()?.default_persona_id;
  return typeof id === "string" ? id : undefined;
}

export function setWorkspacePersona(personaId: string | null) {
  const db = database();
  if (personaId && !persona(personaId)) throw new RequestError("Persona not found.", 404);
  if (!db.prepare("UPDATE workspace_setup SET default_persona_id = ? WHERE id = 1").run(personaId).changes) {
    throw new RequestError("Finish setup before choosing a default persona.", 409);
  }
}

export function completeWorkspaceSetup(player: { id: string } | { name: string; description: string; portrait?: StoredImage | null },
  account?: { name: string; salt: string; hash: string }) {
  transaction(db => {
    if (workspaceSetup()) throw new RequestError("Setup is already complete. Reload Dundra to continue.", 409);
    let personaId;
    if ("id" in player) {
      if (!persona(player.id)) throw new RequestError("Choose an existing persona.", 404);
      personaId = player.id;
    } else {
      personaId = crypto.randomUUID();
      db.prepare("INSERT INTO personas VALUES (?, ?, ?)").run(personaId, player.name, player.description);
      writeImage(db, "persona_portraits", personaId, player.portrait);
    }
    db.prepare("INSERT INTO workspace_setup VALUES (1, ?, ?, ?, ?)").run(
      personaId, account?.name ?? null, account?.salt ?? null, account?.hash ?? null);
  });
}
