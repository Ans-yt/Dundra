export class RequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function fields(request: Request, limit = 150_000): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new RequestError("Send a JSON request.", 415);
  }
  const length = Number(request.headers.get("content-length"));
  if (length > limit) throw new RequestError("Request is too large.", 413);
  const raw = await request.text();
  if (raw.length > limit) throw new RequestError("Request is too large.", 413);
  const body = JSON.parse(raw);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError("Invalid request.");
  return body;
}

export function field(body: Record<string, unknown>, key: string, limit: number, required = false) {
  const value = body[key];
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.length > limit || (required && !value.trim())) {
    throw new RequestError("Invalid " + key + ". Maximum length: " + limit + " characters.");
  }
  return value.trim();
}

export function localRequest(request: Request) {
  const host = request.headers.get("host") || "";
  const origin = request.headers.get("origin");
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)
    || (origin && origin !== "http://" + host)
    || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new RequestError("Open Dundra from localhost.", 403);
  }
}

export function failure(error: unknown) {
  if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof SyntaxError) return Response.json({ error: "Invalid JSON request." }, { status: 400 });
  console.error(error);
  return Response.json({ error: "Dundra could not complete this request." }, { status: 500 });
}
