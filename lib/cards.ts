import { crc32, inflateSync } from "node:zlib";
import { RequestError } from "./http";
import type { Character } from "./types";

export const CARD_LIMIT = 12 * 1024 * 1024;
export const TEXT_LIMIT = 80_000;
export const GREETING_LIMIT = 12_000;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const textChunks = new Set(["tEXt", "zTXt", "iTXt"]);
const keys = ["description", "personality", "scenario", "mes_example", "creator_notes", "system_prompt", "post_history_instructions", "character_version"] as const;
type CardFields = Partial<Record<(typeof keys)[number], string>> & { character_book?: object; regex_scripts?: unknown[]; extras?: Record<string, unknown>; extensions?: Record<string, unknown> };
export type CardDraft = { character: Character; tags: string[]; original: CardFields; portrait?: Buffer };

function cardTags(value: unknown) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const unique = new Map<string, string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const tag = entry.normalize("NFKC").trim().replace(/[\s,]+/g, (match) => match.includes(",") ? " / " : " ");
    if (tag && tag.length <= 80 && !unique.has(tag.toLowerCase())) unique.set(tag.toLowerCase(), tag);
  }
  return [...unique.values()].slice(0, 60);
}

export function alternateGreetings(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30 || value.some((entry) => typeof entry !== "string" || entry.length > GREETING_LIMIT)) {
    throw new RequestError("Use up to 30 alternate openings, each at most " + GREETING_LIMIT + " characters.");
  }
  return (value as string[]).map((entry) => entry.trim()).filter(Boolean);
}

export async function readCardBytes(input: Request | Response, limit = CARD_LIMIT) {
  if (!input.body) throw new RequestError("The character card is empty.");
  if (Number(input.headers.get("content-length")) > limit) {
    await input.body.cancel();
    throw new RequestError("The character card exceeds the size limit.", 413);
  }
  const reader = input.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, total);
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw new RequestError("The character card exceeds the size limit.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

function pngChunks(bytes: Buffer) {
  if (!bytes.subarray(0, 8).equals(PNG)) throw new RequestError("Invalid PNG signature.");
  const chunks: { code: string; data: Buffer; raw: Buffer }[] = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    const end = offset + size + 12;
    if (end > bytes.length) break;
    const code = bytes.toString("ascii", offset + 4, offset + 8);
    chunks.push({ code, data: bytes.subarray(offset + 8, end - 4), raw: bytes.subarray(offset, end) });
    if (code === "IEND") return chunks;
    offset = end;
  }
  throw new RequestError("This PNG is incomplete.");
}

export function pngPortrait(bytes: Buffer) {
  return Buffer.concat([PNG, ...pngChunks(bytes).filter(({ code }) => !textChunks.has(code)).map(({ raw }) => raw)]);
}

function embeddedText(code: string, data: Buffer, separator: number) {
  if (code === "tEXt") return data.subarray(separator + 1).toString("ascii");
  const inflate = (bytes: Buffer) => inflateSync(bytes, { maxOutputLength: 2_000_000 }).toString("utf8");
  if (code === "zTXt" && data[separator + 1] === 0) return inflate(data.subarray(separator + 2));
  if (code === "iTXt" && data[separator + 2] === 0 && [0, 1].includes(data[separator + 1])) {
    const lang = data.indexOf(0, separator + 3);
    const name = lang < 0 ? -1 : data.indexOf(0, lang + 1);
    if (name >= 0) return data[separator + 1] ? inflate(data.subarray(name + 1)) : data.subarray(name + 1).toString("utf8");
  }
  throw new RequestError("Unsupported PNG card metadata.");
}

function decodePng(bytes: Buffer) {
  const chunks = pngChunks(bytes);
  const entries = new Map<string, { code: string; data: Buffer; separator: number }>();
  for (const { code, data } of chunks) {
    if (!textChunks.has(code)) continue;
    const separator = data.indexOf(0);
    if (separator < 1) continue;
    const key = data.toString("ascii", 0, separator);
    if (key === "ccv3" || key === "chara") entries.set(key, { code, data, separator });
  }
  for (const key of ["ccv3", "chara"]) {
    const entry = entries.get(key);
    if (!entry) continue;
    try {
      const raw = embeddedText(entry.code, entry.data, entry.separator).trim();
      const json = Buffer.from(raw, "base64").toString("utf8");
      const card = normalizeCard(JSON.parse(json));
      const artwork = chunks.filter(({ code, data }) => !textChunks.has(code) || (code === "tEXt" && data.subarray(0, 17).toString("ascii").startsWith("chara-ext-asset_:")));
      return { ...card, portrait: Buffer.concat([PNG, ...artwork.map(({ raw }) => raw)]) };
    } catch (error) {
      if (key === "chara" || !entries.has("chara")) {
        if (error instanceof RequestError) throw error;
        throw new RequestError("The PNG contains invalid character metadata.");
      }
    }
  }
  throw new RequestError("This PNG has no embedded character card. Choose a card exported by your character app.");
}

export function parseCard(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(PNG)) return decodePng(bytes);
  return normalizeCard(JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")));
}

function cardInstructions(fields: CardFields) {
  return [fields.system_prompt, fields.description, fields.personality, fields.scenario && "Scenario:\n" + fields.scenario,
    fields.mes_example && "Example dialogue:\n" + fields.mes_example,
    fields.post_history_instructions && "Additional instructions:\n" + fields.post_history_instructions].filter(Boolean).join("\n\n");
}

export function normalizeCard(value: unknown, source = ""): CardDraft {
  const wrapper = object(value);
  const inner = object(wrapper.data);
  const card = Object.keys(inner).length ? inner : wrapper;
  if (wrapper.spec !== undefined && !["chara_card_v2", "chara_card_v3", "chara_card_v1"].includes(String(wrapper.spec))) {
    throw new RequestError("This file uses an unsupported card format.");
  }
  const name = string(card.name);
  if (!name || name.length > 80 || !["description", "personality", "scenario", "first_mes", "instructions", "greeting"].some((key) => typeof card[key] === "string")) {
    throw new RequestError("This file does not contain a supported character card.");
  }
  const original: CardFields = Object.fromEntries(keys.map((key) => [key, string(card[key])]));
  original.extras = Object.fromEntries(["assets","nickname","creator_notes_multilingual","source","group_only_greetings","creation_date","modification_date"].filter(key => card[key] !== undefined).map(key => [key, card[key]]));
  const book = object(card.character_book);
  if (Array.isArray(book.entries) && JSON.stringify(book).length <= 500_000) original.character_book = book;
  const extensions=object(card.extensions);
  if (Array.isArray(extensions.regex_scripts) && JSON.stringify(extensions.regex_scripts).length<=500000) original.regex_scripts=extensions.regex_scripts;
  original.extensions = extensions;
  const own = object(extensions.nitanor);
  const nickname = string(card.nickname ?? own.nickname).slice(0, 80);
  if (nickname) original.extras.nickname = nickname;
  const instructions = string(own.instructions) || string(card.instructions) || cardInstructions(original) || "Play the character named " + name + ".";
  const greeting = string(card.first_mes ?? card.greeting);
  if (instructions.length > TEXT_LIMIT || greeting.length > GREETING_LIMIT) {
    throw new RequestError("The character instructions or opening message exceed Dundra’s limits.");
  }
  const tags = cardTags(card.tags);
  return {
    character: { id: crypto.randomUUID(), name, nickname,
      description: (string(own.description) || original.creator_notes || original.description || "").slice(0, 600),
      creator: string(card.creator).slice(0, 100), source, greeting, instructions,
      alternateGreetings: alternateGreetings(card.alternate_greetings ?? card.alternateGreetings), tags: "" },
    tags, original,
  };
}

export function exportCard(character: Character, original: CardFields, version: 2 | 3 = 2) {
  const { extras, extensions, regex_scripts, ...fields } = original;
  const edited = character.instructions !== cardInstructions(original);
  return {
    spec: version === 3 ? "chara_card_v3" : "chara_card_v2", spec_version: version === 3 ? "3.0" : "2.0",
    data: {
      ...(version === 3 && { group_only_greetings: [], ...extras }),
      ...fields,
      name: character.name,
      ...(version === 3 && { nickname: character.nickname || "" }),
      description: edited ? character.instructions : original.description || "",
      personality: edited ? "" : original.personality || "",
      scenario: edited ? "" : original.scenario || "",
      mes_example: edited ? "" : original.mes_example || "",
      system_prompt: edited ? "" : original.system_prompt || "",
      post_history_instructions: edited ? "" : original.post_history_instructions || "",
      creator_notes: original.creator_notes || character.description,
      first_mes: character.greeting,
      alternate_greetings: character.alternateGreetings || [],
      creator: character.creator || "",
      character_version: original.character_version || "",
      tags: cardTags(character.tags),
      extensions: { ...extensions, ...(regex_scripts && {regex_scripts:regex_scripts}), nitanor: { description: character.description, instructions: character.instructions, nickname: character.nickname || "" } },
    },
  };
}

function cardChunk(key: string, card: ReturnType<typeof exportCard>) {
  const body = Buffer.from("tEXt" + key + "\0" + Buffer.from(JSON.stringify(card)).toString("base64"));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length - 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePngCard(portrait: Buffer | null, card: ReturnType<typeof exportCard>) {
  const fallback = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  const chunks = card.spec === "chara_card_v3" ? [cardChunk("chara", { ...card, spec: "chara_card_v2", spec_version: "2.0" }), cardChunk("ccv3", card)] : [cardChunk("chara", card)];
  return Buffer.concat([PNG, ...pngChunks(portrait ?? fallback).flatMap(({ code, raw }) => code === "IEND" ? [...chunks, raw] : [raw])]);
}

export type { CardFields };
