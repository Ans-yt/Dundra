import { fields, field, localRequest, failure, RequestError } from "../../../lib/http";
import { readLorebook, type LoreScope } from "../../../lib/lorebook";
import { chatLorebookLinks, deleteLorebook, lorebook, lorebookList, loreLinks, saveLorebook, setLoreLink } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function scope(value: unknown): LoreScope {
  if (value === "chat" || value === "character" || value === "persona") return value;
  throw new RequestError("Choose a valid lorebook link target.");
}

export function GET(request: Request) {
  try {
    localRequest(request);
    const query = new URL(request.url).searchParams;
    const id = query.get("book");
    if (id) {
      const book = lorebook(id);
      if (!book) throw new RequestError("Lorebook not found.", 404);
      return Response.json(book);
    }
    const kind = query.get("scope");
    const owner = query.get("owner") || "";
    if (kind === "chat") {
      const links = chatLorebookLinks(owner);
      if (!links) throw new RequestError("Chat not found.", 404);
      return Response.json({ books: lorebookList(owner), ...links });
    }
    return Response.json({ books: lorebookList(), direct: kind ? loreLinks(scope(kind), owner) : [], inherited: [] });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    localRequest(request);
    const body = await fields(request, 3_000_000);
    const id = field(body, "id", 64);
    switch (body.action) {
      case "link":
        if (typeof body.enabled !== "boolean") throw new RequestError("Choose whether to link this lorebook.");
        setLoreLink(scope(body.scope), field(body, "owner", 64, true), id, body.enabled);
        return Response.json({ ok: true });
      case "delete":
        deleteLorebook(id);
        return Response.json({ ok: true });
      case "save": {
        let normalized;
        try { normalized = readLorebook(body.book, field(body, "filename", 100) || undefined); }
        catch (error) { throw new RequestError(error instanceof Error ? error.message : "Invalid lorebook."); }
        const book = { ...normalized, id: id || crypto.randomUUID() };
        if (id && !lorebook(id)) throw new RequestError("Lorebook not found.", 404);
        saveLorebook(book);
        return Response.json(book);
      }
      default: throw new RequestError("Unknown lorebook action.");
    }
  } catch (error) { return failure(error); }
}
