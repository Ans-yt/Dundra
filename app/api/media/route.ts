import { workspaceRequest } from "../../../lib/access";
import { failure, RequestError } from "../../../lib/http";
import { storedImage } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    workspaceRequest(request);
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind");
    const id = params.get("id");
    if (!id || (kind !== "persona" && kind !== "background")) throw new RequestError("Image unavailable.", 404);
    const asset = storedImage(kind, id);
    if (!asset) throw new RequestError("Image unavailable.", 404);
    return new Response(new Uint8Array(asset.image), { headers: {
      "Content-Type": asset.mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
    } });
  } catch (error) { return failure(error); }
}
