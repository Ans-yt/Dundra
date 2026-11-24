import { DiagnosticError, diagnosticText, networkProblem } from "../lib/diagnostics";

export async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) window.dispatchEvent(new Event("dundra:check-access"));
  const status = "HTTP " + response.status + (response.url ? " · " + new URL(response.url).pathname : "");
  let data;
  try { data = await response.json(); }
  catch (cause) {
    throw new DiagnosticError("Dundra received an invalid response.", networkProblem(cause, status).details);
  }
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : "The request failed.";
    throw new DiagnosticError(message, diagnosticText([status, typeof data?.details === "string" ? data.details : message].join("\n")));
  }
  return data as T;
}
