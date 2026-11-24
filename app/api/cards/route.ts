import { workspaceRequest } from "../../../lib/access";
import { CARD_LIMIT, encodePngCard, exportCard, parseCard, readCardBytes, type CardDraft } from "../../../lib/cards";
import { fetchPublicCard } from "../../../lib/remote-cards";
import { failure, field, fields, RequestError } from "../../../lib/http";
import { cardAssets, character, importCharacter, library } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pending = new Map<string, { draft: CardDraft; expires: number }>();

function purge() {
  for (const [id, item] of pending) if (item.expires <= Date.now()) pending.delete(id);
}

function preview(draft: CardDraft) {
  const token = crypto.randomUUID();
  if (pending.size >= 5) pending.delete(pending.keys().next().value!);
  pending.set(token, { draft, expires: Date.now() + 10 * 60_000 });
  return Response.json({ token, name: draft.character.name, creator: draft.character.creator, tags: draft.tags,
    openings: Number(Boolean(draft.character.greeting)) + (draft.character.alternateGreetings?.length || 0) });
}

export async function POST(request: Request) {
  try {
    workspaceRequest(request);
    purge();
    const action = new URL(request.url).searchParams.get("action");
    if (action === "preview-file") {
      if (request.headers.get("content-type") !== "application/octet-stream") throw new RequestError("Choose a character-card file.", 415);
      return preview(parseCard(await readCardBytes(request, CARD_LIMIT)));
    }
    const body = await fields(request);
    if (action === "preview-link" || action === "preview-chub") return preview(await fetchPublicCard(field(body, "url", 650, true)));
    if (action !== "import") throw new RequestError("Unknown character-card action.");
    const token = field(body, "token", 64, true);
    const item = pending.get(token);
    if (!item) throw new RequestError("This preview expired. Open the character card again.", 409);
    if (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== "string" || !item.draft.tags.includes(tag))) {
      throw new RequestError("Select tags from the card.");
    }
    const tags = item.draft.tags.filter((tag) => (body.tags as string[]).includes(tag));
    importCharacter(item.draft, tags);
    pending.delete(token);
    return Response.json(library());
  } catch (error) {
    return failure(error);
  }
}

export async function GET(request: Request) {
  try {
    workspaceRequest(request);
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    const item = id && character(id);
    if (!item) throw new RequestError("Character not found.", 404);
    const { original, portrait } = cardAssets(item.id);
    const format = params.get("format");
    if (format === "portrait") {
      if (!portrait) throw new RequestError("Portrait unavailable.", 404);
      return new Response(new Uint8Array(portrait), { headers: { "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
    }
    const card = exportCard(item, original, params.get("version") === "3" ? 3 : 2);
    const filename = item.name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "character";
    if (format === "png") {
      return new Response(new Uint8Array(encodePngCard(portrait ?? null, card)), {
        headers: { "Content-Type": "image/png", "Content-Disposition": 'attachment; filename="' + filename + '.png"' },
      });
    }
    return new Response(JSON.stringify(card, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="' + filename + '.json"' },
    });
  } catch (error) {
    return failure(error);
  }
}
