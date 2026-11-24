import { Script } from "node:vm";
import { RequestError } from "./http";
import { countTextTokens } from "./tokens";
import type { Lorebook, LoreEntry } from "./lorebook";

type Source = Pick<Lorebook, "entries" | "scan_depth" | "token_budget" | "image_attachments"> & { id?: string };
export type LoreContext = {
  character?: string; nickname?: string; characterId?: string; tags?: string[]; trigger?: string; seed?: string;
  messageCount?: number; previous?: Record<string, number>;
};

const testPattern = new Script("new RegExp(pattern, flags).test(text)");
const word = /[\p{L}\p{N}_]/u;

function contains(text: string, needle: string, whole: boolean) {
  if (!needle) return false;
  if (!whole) return text.includes(needle);
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    if (!word.test(text[at - 1] ?? "") && !word.test(text[at + needle.length] ?? "")) return true;
  }
  return false;
}

function matchesContext(entry: LoreEntry, context: LoreContext) {
  if (entry.triggers?.length && !entry.triggers.includes(context.trigger ?? "normal")) return false;
  if (!entry.characters?.length && !entry.tags?.length) return true;
  const names = [context.character, context.nickname, context.characterId].filter(Boolean).map(name => name!.toLowerCase());
  const tags = context.tags?.map(tag => tag.trim().toLowerCase()) ?? [];
  const listed = entry.characters?.some(name => names.includes(name.toLowerCase().replace(/\.png$/, "")))
    || entry.tags?.some(tag => tags.includes(tag.toLowerCase()));
  return entry.excludeCharacters ? !listed : Boolean(listed);
}

// A stable per-chat draw lets the token preview and the actual request agree.
function hash(value: string) {
  let state = 2166136261;
  for (let i = 0; i < value.length; i++) state = Math.imul(state ^ value.charCodeAt(i), 16777619);
  return state >>> 0;
}

export function activeLore(books: Source[], history: { content: string }[], context: LoreContext = {}) {
  const turn = context.messageCount ?? history.length;
  const remaining = books.map(book => book.token_budget || Infinity);
  const occupied = new Set<string>();
  const activations: string[] = [];
  const automationIds = new Set<string>();
  const chosen: LoreEntry[] = [];
  const visualEntries: { name: string; images: string[] }[] = [];
  const scans = new Map<number, string>();
  const candidates = books.flatMap((book, bookIndex) => book.entries
    .filter(entry => entry.enabled && (entry.content.trim() || (book.image_attachments && entry.images?.length)) &&
      matchesContext(entry, context) && turn >= (entry.delay ?? 0))
    .map(entry => {
      const depth = entry.scanDepth ?? book.scan_depth;
      if (!scans.has(depth)) scans.set(depth, depth ? history.slice(-depth).map(message => message.content).join("\n") : "");
      const { images, ...textEntry } = entry;
      const key = JSON.stringify([book.id ?? "embedded", entry.id, hash(JSON.stringify(textEntry))]);
      const activeImages = book.image_attachments ? images : undefined;
      const age = turn - (context.previous?.[key] ?? -Infinity);
      const sticky = age >= 0 && age <= (entry.sticky || 0);
      const cooling = !sticky && age >= 0 && age <= (entry.sticky || 0) + (entry.cooldown || 0);
      const groups = (entry.group ?? "").split(",").map(label => label.trim()).filter(Boolean);
      const draw = (hash(JSON.stringify([context.seed, turn, key])) + 1) / 4294967297;
      const rank = -Math.log(draw) / Math.max(0, entry.groupWeight ?? 100);
      return { entry, depth, key, bookIndex, sticky, cooling, groups, rank, activeImages };
    }));
  const used = new Set<string>();
  let regexTime = 0;
  let recursed = "";
  const maxRound = Math.min(100, candidates.length + candidates.reduce((max, {entry}) => Math.max(max, Number(entry.delayUntilRecursion || 0)), 0));
  for (let round = 0; round <= maxRound; round++) {
    const ready = [];
    const textByDepth = new Map<number, { original: string; folded: string }>();
    for (const candidate of candidates) {
      const { entry, key, depth, sticky, cooling, groups } = candidate;
      if (used.has(key) || cooling || groups.some(group => occupied.has(group))) continue;
      if (!sticky && (entry.probability ?? 100) < 100 && hash(key + ":" + context.seed + ":" + turn) / 4294967296 * 100 >= (entry.probability ?? 100)) continue;
      if (!sticky && (round < Number(entry.delayUntilRecursion || 0) || (round && entry.excludeRecursion))) continue;
      let scan = textByDepth.get(depth);
      if (!scan) {
        const original = scans.get(depth)! + (round ? "\n" + recursed : "");
        scan = { original, folded: original.toLowerCase() };
        textByDepth.set(depth, scan);
      }
      const text = entry.case_sensitive ? scan.original : scan.folded;
      const matches = (needle: string) => {
        const slash = needle.lastIndexOf("/");
        if (!needle.startsWith("/") || slash < 1) return contains(text, entry.case_sensitive ? needle : needle.toLowerCase(), !!entry.match_whole_words);
        const started = performance.now();
        if (regexTime > 250) throw new RequestError("Lorebook keyword matching exceeded the time limit. Simplify the patterns.");
        try { return Boolean(testPattern.runInNewContext({ pattern: needle.slice(1, slash), flags: needle.slice(slash + 1), text: scan.original }, { timeout: 50 })); }
        catch { throw new RequestError("Check the regex keyword in lore entry " + (entry.name || entry.id) + "."); }
        finally { regexTime += performance.now() - started; }
      };
      const score = entry.keys.filter(matches).length;
      if (!sticky && !entry.constant && (!score || (entry.selective && entry.secondary_keys.length && !entry.secondary_keys.some(matches)))) continue;
      ready.push({ ...candidate, score });
    }
    // Resolve competing entries independently of the order of imported books.
    const scoring = new Set(ready.filter(row => row.entry.useGroupScoring).flatMap(row => row.groups));
    ready.sort((a, b) => Number(b.sticky) - Number(a.sticky)
      || Number(!!b.entry.groupOverride) - Number(!!a.entry.groupOverride)
      || (b.groups.some(group => scoring.has(group)) ? b.score : 0) - (a.groups.some(group => scoring.has(group)) ? a.score : 0)
      || (b.entry.groupOverride ? b.entry.insertion_order : 0) - (a.entry.groupOverride ? a.entry.insertion_order : 0)
      || Number(b.entry.constant) - Number(a.entry.constant)
      || (a.groups.length ? a.rank : 0) - (b.groups.length ? b.rank : 0)
      || b.entry.insertion_order - a.entry.insertion_order);
    const added: string[] = [];
    for (const row of ready) {
      const { entry, groups, bookIndex } = row;
      if (groups.some(group => occupied.has(group))) continue;
      used.add(row.key);
      if (groups.length && !row.sticky && !entry.groupOverride && entry.groupWeight === 0) continue;
      if (!entry.ignoreBudget && Number.isFinite(remaining[bookIndex])) {
        const cost = countTextTokens(entry.content);
        if (cost > remaining[bookIndex]) continue;
        remaining[bookIndex] -= cost;
      }
      groups.forEach(group => occupied.add(group));
      if (entry.content.trim()) chosen.push(entry);
      if (row.activeImages?.length) visualEntries.push({ name: entry.name || "Lorebook entry", images: row.activeImages });
      if (!row.sticky && (entry.sticky || entry.cooldown)) activations.push(row.key);
      if (entry.automationId) automationIds.add(entry.automationId);
      if (!entry.preventRecursion && entry.content.trim()) added.push(entry.content);
    }
    if (added.length) recursed += "\n" + added.join("\n");
    else if (!recursed || !candidates.some(row => !used.has(row.key) && Number(row.entry.delayUntilRecursion || 0) > round)) break;
  }
  chosen.sort((a, b) => a.insertion_order - b.insertion_order);
  const at = (position: LoreEntry["position"]) => [...new Set(chosen.filter(entry => entry.position === position).map(entry => entry.content))];
  return { at_depth: chosen.filter(entry => entry.position === "at_depth").map(entry => ({ content: entry.content, depth: entry.depth ?? 4 })), before_char: at("before_char"), after_char: at("after_char"), visualEntries, activations, automationIds: [...automationIds] };
}
