import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { localRequest, RequestError } from "./http";
import { workspaceSetup } from "./store";

const lifetime = 7 * 24 * 60 * 60;
const cookie = "dundra_session";
const attempts = { count: 0, reset: 0 };
// Next can load this module from separate route bundles. Share sessions within the running server.
const runtime = globalThis as typeof globalThis & { dundraSessions?: Map<string, number> };
const sessions = runtime.dundraSessions ??= new Map<string, number>();

function digest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function sessionKey(request: Request) {
  const value = request.headers.get("cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith(cookie + "="))?.slice(cookie.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? digest(value) : undefined;
}

export function unlocked(request: Request) {
  const key = sessionKey(request);
  return Boolean(key && (sessions.get(key) ?? 0) > Date.now());
}

export function workspaceRequest(request: Request) {
  localRequest(request);
  if (workspaceSetup()?.hash && !unlocked(request)) throw new RequestError("Sign in to Dundra to continue.", 401);
}

function hashPassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

export async function makeWorkspacePassword(name: string, password: string) {
  const salt = randomBytes(16).toString("hex");
  return { name, salt, hash: (await hashPassword(password, salt)).toString("hex") };
}

export function newWorkspaceSession() {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  for (const [key, expires] of sessions) if (expires <= now) sessions.delete(key);
  sessions.set(digest(token), now + lifetime * 1000);
  return token;
}

export function sessionCookie(token: string) {
  return `${cookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${lifetime}`;
}

export async function signIn(name: string, password: string) {
  const owner = workspaceSetup();
  if (!owner?.hash || !owner.salt) throw new RequestError("This workspace does not have an account.", 409);
  const now = Date.now();
  if (now >= attempts.reset) {
    attempts.count = 0;
    attempts.reset = now + 60_000;
  }
  if (attempts.count >= 5) throw new RequestError("Too many sign-in attempts. Try again in a minute.", 429);
  attempts.count += 1;
  const supplied = await hashPassword(password, owner.salt);
  const expected = Buffer.from(owner.hash, "hex");
  if (!timingSafeEqual(expected, supplied) || name.toLowerCase() !== owner.name?.toLowerCase()) {
    throw new RequestError("Account name or password is incorrect.", 401);
  }
  attempts.count = 0;
  return newWorkspaceSession();
}
