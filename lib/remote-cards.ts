import { normalizeCard, parseCard, pngPortrait, readCardBytes, type CardDraft } from "./cards";
import { RequestError } from "./http";

const chubHosts = new Set(["chub.ai", "www.chub.ai", "chat.chub.ai", "preview.chub.ai", "venus.chub.ai", "characterhub.org", "www.characterhub.org"]);
const pygmalionHosts = new Set(["pygmalion.chat", "www.pygmalion.chat"]);
const chubImages = new Set(["avatars.charhub.io", "avatars.chub.ai", "cdn.chub.ai"]);
const pygmalionImages = new Set(["assets.pygmalion.chat", "pygmalion.chat", "server.pygmalion.chat", "cdn.pygmalion.chat"]);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

class SourceStatus extends Error {
  constructor(readonly source: string, readonly code: number) { super(source + " returned HTTP " + code + "."); }
}

function httpsUrl(input: string) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Invalid HTTPS link.");
  return url;
}

async function download(url: string | URL, source: string, timeout = 12_000, headers?: HeadersInit) {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeout), headers });
  } catch {
    throw new RequestError("Could not reach " + source + ". Check the connection and try again.", 502);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new SourceStatus(source, response.status);
  }
  return response;
}

async function publicPng(url: string, displayUrl: string, provider: string) {
  const draft = parseCard(await readCardBytes(await download(url, provider)));
  draft.character.source = displayUrl;
  return draft;
}

async function portrait(input: unknown, hosts: Set<string>) {
  if (typeof input !== "string") return undefined;
  try {
    const url = httpsUrl(input);
    if (!hosts.has(url.hostname)) return undefined;
    return pngPortrait(await readCardBytes(await download(url, url.hostname, 4000)));
  } catch {
    return undefined;
  }
}

async function chubMetadata(path: string, displayUrl: string, author: string, slug: string) {
  const response = await download("https://api.chub.ai/api/characters/" + path + "?full=true", "Chub", 12_000, { Accept: "application/json" });
  const { node } = JSON.parse((await readCardBytes(response, 2_000_000)).toString("utf8"));
  const definition = node?.definition;
  if (!definition || typeof definition !== "object") throw new RequestError("Chub did not return a public character card.", 502);

  const draft = normalizeCard({
    name: definition.name || node.name || slug,
    description: definition.personality,
    personality: definition.tavern_personality,
    scenario: definition.scenario,
    first_mes: definition.first_message,
    mes_example: definition.example_dialogs,
    creator_notes: definition.description || node.description,
    system_prompt: definition.system_prompt,
    post_history_instructions: definition.post_history_instructions,
    alternate_greetings: definition.alternate_greetings,
    tags: node.topics,
    creator: author,
    character_book: definition.embedded_lorebook,
  }, displayUrl);
  draft.portrait = await portrait(node.max_res_url, chubImages);
  return draft;
}

async function chub(parts: string[]) {
  const card = parts[0] === "characters" ? parts.slice(1) : parts;
  if (card.length !== 2 || !card.every((part) => /^[a-z\d_-]{1,160}$/i.test(part))) {
    throw new RequestError("Use a Chub character link with an author and character name.");
  }
  const [author, slug] = card;
  const path = card.map(encodeURIComponent).join("/");
  const displayUrl = "https://chub.ai/characters/" + path;
  try {
    const draft = await publicPng("https://avatars.charhub.io/avatars/" + path + "/chara_card_v2.png", displayUrl, "Chub");
    if (!draft.character.creator) draft.character.creator = author;
    return draft;
  } catch (error) {
    if (error instanceof SourceStatus && ![404, 410].includes(error.code)) throw error;
    if (error instanceof RequestError && [413, 502].includes(error.status)) throw error;
    return chubMetadata(path, displayUrl, author, slug);
  }
}

async function pygmalion(id: string) {
  const response = await download("https://server.pygmalion.chat/api/export/character/" + id + "/v2", "PygmalionAI");
  const { character } = JSON.parse((await readCardBytes(response, 2_000_000)).toString("utf8"));
  const draft = normalizeCard(character, "https://pygmalion.chat/character/" + id);
  draft.portrait = await portrait(character?.data?.avatar, pygmalionImages);
  return draft;
}

export async function fetchPublicCard(input: string): Promise<CardDraft> {
  let url: URL;
  try { url = httpsUrl(input); } catch { throw new RequestError("Paste a complete HTTPS character link."); }
  const parts = url.pathname.split("/").filter(Boolean);
  try {
    if (chubHosts.has(url.hostname)) return await chub(parts);
    if (pygmalionHosts.has(url.hostname) && parts.length === 2 && parts[0] === "character" && uuid.test(parts[1])) {
      return await pygmalion(parts[1]);
    }
    if (url.hostname === "realm.risuai.net" && parts.length === 2 && parts[0] === "character" && (uuid.test(parts[1]) || /^[a-f0-9]{64}$/i.test(parts[1]))) {
      return await publicPng("https://realm.risuai.net/api/v1/download/png-v3/" + parts[1] + "?non_commercial=true",
        "https://realm.risuai.net/character/" + parts[1], "RisuRealm");
    }
    throw new RequestError("Use a public character page from Chub, PygmalionAI, or RisuRealm.");
  } catch (error) {
    if (error instanceof SourceStatus) {
      if ([401, 403].includes(error.code)) throw new RequestError(error.source + " denied access to this card (" + error.code + ").", error.code);
      if ([404, 410].includes(error.code)) throw new RequestError(error.source + " no longer lists this card as downloadable.", 404);
      if (error.code === 429) throw new RequestError(error.source + " is limiting requests. Try again later.", 429);
      throw new RequestError(error.message, 502);
    }
    if (error instanceof SyntaxError) throw new RequestError("The site returned an invalid character card.", 502);
    throw error;
  }
}
