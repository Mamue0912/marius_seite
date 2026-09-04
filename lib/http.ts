export class RequestError extends Error {
  constructor(message: string, public status = 0) { super(message); this.name = "RequestError"; }
}
export async function requestJson<T = any>(url: string, init: RequestInit = {}, timeoutMs = 45000): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new RequestError(response.status === 401 ? "Bitte erneut anmelden." : data?.message || data?.error || "Die Anfrage ist fehlgeschlagen.", response.status);
    if (data === null) throw new RequestError("Der Server hat keine gültige Antwort geliefert.", response.status);
    return data as T;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (controller.signal.aborted) throw new RequestError("Keine rechtzeitige Bestätigung erhalten. Bitte den aktuellen Stand prüfen.");
    throw new RequestError("Verbindung unterbrochen. Bitte erneut versuchen.");
  } finally { clearTimeout(timer); init.signal?.removeEventListener("abort", abort); }
}
export function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
