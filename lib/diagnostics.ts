export type Problem = { message: string; details?: string };

export class DiagnosticError extends Error {
  constructor(message: string, readonly details: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export function diagnosticText(text: string, secrets: string[] = []) {
  let safe = text;
  for (const secret of [...new Set(secrets)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    safe = safe.replaceAll(secret, "[redacted]");
  }
  return safe
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, "[redacted]")
    .replace(/((?:api[-_ ]?key|authorization|password|access[-_ ]?token|secret)\s*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,\s&;]+)/gi, "$1[redacted]")
    .replace(/\b(?:sk-|ghp_|gho_|github_pat_)[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim().slice(0, 2400);
}

export function problem(cause: unknown, fallback = "The request failed."): Problem {
  if (!(cause instanceof Error)) return { message: fallback };
  return { message: cause.message || fallback, ...(cause instanceof DiagnosticError && { details: cause.details }) };
}

export function networkProblem(cause: unknown, action: string): Problem & { details: string } {
  const failed = problem(cause);
  if (failed.details) return { ...failed, details: failed.details };
  const notes = [action];
  if (cause instanceof Error) {
    notes.push(cause.name + ": " + cause.message);
    if (cause.cause instanceof Error) notes.push(cause.cause.message);
  } else notes.push(failed.message);
  return { ...failed, details: diagnosticText(notes.join("\n")) };
}
