export const loreEntryLimit = 1000;
export type LoreScope = "character" | "persona" | "chat";

export type LoreEntry = {
  id: string;
  name: string;
  keys: string[];
  secondary_keys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  match_whole_words?: boolean;
  selective: boolean;
  case_sensitive: boolean;
  position: "before_char" | "after_char" | "at_depth";
  depth?: number;
  probability?: number;
  insertion_order: number;
  scanDepth?: number;
  automationId?: string;
  excludeRecursion?: boolean;
  preventRecursion?: boolean;
  delayUntilRecursion?: boolean | number;
  ignoreBudget?: boolean;
  group?: string;
  useGroupScoring?: boolean;
  groupOverride?: boolean;
  groupWeight?: number;
  sticky?: number;
  cooldown?: number;
  delay?: number;
  characters?: string[];
  tags?: string[];
  excludeCharacters?: boolean;
  triggers?: string[];
};

export type Lorebook = { id: string; name: string; scan_depth: number; token_budget?: number; entries: LoreEntry[] };

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function list(value: unknown) {
  return (Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,]/) : [])
    .map(key => string(key, 200).trim()).filter(Boolean).slice(0, 100);
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

export function blankLoreEntry(): LoreEntry {
  return { id: crypto.randomUUID(), name: "", keys: [], secondary_keys: [], content: "", enabled: true, constant: false,
    selective: false, case_sensitive: false, position: "before_char", insertion_order: 100 };
}

export function readLorebook(input: unknown, fallbackName = "Untitled lorebook"): Omit<Lorebook, "id"> {
  const root = object(input);
  const raw = root.character_book ?? object(root.data).character_book ?? input;
  const book = object(raw);
  const source = Array.isArray(raw) ? raw : book.entries;
  if (!source || typeof source !== "object") {
    throw Error("This JSON does not contain a lorebook. Choose a list of lore entries or a file with an entries field.");
  }
  const entries = Array.isArray(source) ? source : Object.values(object(source));
  if (entries.length > loreEntryLimit) throw Error(`This lorebook has ${entries.length} entries. The limit is ${loreEntryLimit}.`);
  if (entries.some(entry => typeof object(entry).content !== "string")) {
    throw Error("Each lorebook entry needs a text content field.");
  }
  const seen = new Set<string>();
  return {
    name: string(book.name, 100).trim() || fallbackName.slice(0, 100),
    scan_depth: integer(book.scan_depth ?? book.scanDepth, 4, 1, 100),
    token_budget: integer(book.token_budget ?? book.tokenBudget, 0, 0, 1000000),
    entries: entries.map((value, index) => {
      const entry = object(value);
      const ext = object(entry.extensions);
      const savedId = string(entry.id, 64) || String(entry.uid ?? index).slice(0, 64);
      const filter = object(entry.characterFilter ?? ext.character_filter);
      const depth = entry.scanDepth ?? ext.scan_depth;
      const recursion = entry.delayUntilRecursion ?? ext.delay_until_recursion;
      const id = savedId && !seen.has(savedId) ? savedId : crypto.randomUUID();
      seen.add(id);
      return {
        id, name: string(entry.name ?? entry.comment, 100),
        keys: list(entry.keys ?? entry.key), secondary_keys: list(entry.secondary_keys ?? entry.keysecondary),
        scanDepth: depth == null ? undefined : integer(depth, 4, 0, 100),
        automationId: string(entry.automationId ?? ext.automation_id, 150),
        excludeRecursion: (entry.excludeRecursion ?? ext.exclude_recursion) === true,
        preventRecursion: (entry.preventRecursion ?? ext.prevent_recursion) === true,
        delayUntilRecursion: typeof recursion === "number" ? integer(recursion, 0, 0, 100) : recursion === true,
        ignoreBudget: (entry.ignoreBudget ?? ext.ignore_budget) === true,
        group: string(entry.group ?? ext.group, 200),
        groupWeight: integer(entry.groupWeight ?? ext.group_weight, 100, 0, 10000),
        groupOverride: (entry.groupOverride ?? ext.group_override) === true,
        useGroupScoring: (entry.useGroupScoring ?? ext.use_group_scoring) === true,
        sticky: integer(entry.sticky ?? ext.sticky, 0, 0, 10000),
        cooldown: integer(entry.cooldown ?? ext.cooldown, 0, 0, 10000),
        delay: integer(entry.delay ?? ext.delay, 0, 0, 10000),
        characters: list(entry.characters ?? filter.names), tags: list(entry.tags ?? filter.tags),
        excludeCharacters: (entry.excludeCharacters ?? filter.isExclude) === true,
        triggers: list(entry.triggers ?? ext.triggers),
        content: string(entry.content, 20_000),
        enabled: entry.enabled !== false && entry.disable !== true,
        constant: entry.constant === true, selective: entry.selective === true,
        match_whole_words: (entry.match_whole_words ?? entry.matchWholeWords ?? ext.match_whole_words) === true,
        case_sensitive: (entry.case_sensitive ?? entry.caseSensitive ?? ext.case_sensitive) === true,
        depth: integer(entry.depth ?? ext.depth, 4, 0, 100),
        probability: (entry.useProbability ?? ext.useProbability ?? ext.use_probability) === false ? 100 : integer(entry.probability ?? ext.probability, 100, 0, 100),
        position: entry.position === "at_depth" || entry.position === 4 || ext.position === 4 ? "at_depth" as const : entry.position === "after_char" || entry.position === 1 ? "after_char" as const : "before_char" as const,
        insertion_order: integer(entry.insertion_order ?? entry.order, 100, -10000, 10000),
      };
    }),
  };
}

export function withEmbeddedLore(embedded: unknown, books: Lorebook[]) {
  if (!embedded) return books;
  try { return [readLorebook(embedded, "Character card"), ...books]; }
  catch { return books; }
}
