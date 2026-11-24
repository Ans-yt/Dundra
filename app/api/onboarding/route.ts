import type { SetupStatus } from "../../../lib/onboarding";
import { readImage } from "../../../lib/media";
import { failure, field, fields, localRequest, RequestError } from "../../../lib/http";
import { completeWorkspaceSetup, setupPersonas, workspaceSetup } from "../../../lib/store";
import { makeWorkspacePassword, newWorkspaceSession, sessionCookie, signIn, unlocked } from "../../../lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function status(body: SetupStatus, token?: string) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (token !== undefined) headers.set("Set-Cookie", sessionCookie(token));
  return Response.json(body, { headers });
}

export function GET(request: Request) {
  try {
    localRequest(request);
    const setup = workspaceSetup();
    if (!setup) return status({ stage: "setup", personas: setupPersonas() });
    if (setup.hash && !unlocked(request)) return status({ stage: "locked" });
    return status({ stage: "ready" });
  } catch (error) { return failure(error); }
}

function password(value: unknown, minimum: number) {
  if (typeof value !== "string" || value.length < minimum || value.length > 256 || !value.trim()) {
    throw new RequestError(minimum > 1 ? `Use a password with ${minimum} to 256 characters.` : "Enter your password.");
  }
  return value;
}

export async function POST(request: Request) {
  try {
    localRequest(request);
    const body = await fields(request, 7_100_000);
    if (body.action === "login") {
      const name = field(body, "name", 80, true);
      const token = await signIn(name, password(body.password, 1));
      return status({ stage: "ready" }, token);
    }
    if (body.action !== "finish") throw new RequestError("Unknown setup action.");
    if (workspaceSetup()) throw new RequestError("Setup is already complete. Reload Dundra to continue.", 409);
    const personaId = field(body, "personaId", 64);
    const persona = personaId
      ? { id: personaId }
      : { name: field(body, "personaName", 80, true), description: field(body, "personaDescription", 4_000), portrait: readImage(body.personaPortrait) };
    const name = field(body, "accountName", 80, body.password !== undefined);
    const account = name ? await makeWorkspacePassword(name, password(body.password, 12)) : undefined;
    completeWorkspaceSetup(persona, account);
    return status({ stage: "ready" }, account ? newWorkspaceSession() : undefined);
  } catch (error) { return failure(error); }
}
