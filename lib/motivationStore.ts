// Clientseitige Datenzugriffe für den Motivationsbereich.
// Hält fetch-Details aus der Komponente heraus und liefert verständliche
// Fehlermeldungen statt roher HTTP-Codes.

export interface ApiResult<T> { ok: boolean; status: number; data: T; message: string | null; }

export async function api<T = any>(
  url: string,
  opts: { method?: string; json?: any; timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<ApiResult<T>> {
  const { timeoutMs = 45000, json, signal: ext, method } = opts;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const onExt = () => ctrl.abort();
  if (ext) ext.addEventListener("abort", onExt, { once: true });
  try {
    const init: RequestInit = { method: method || (json !== undefined ? "POST" : "GET"), signal: ctrl.signal };
    if (json !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(json);
    }
    const r = await fetch(url, init);
    let data: any = {};
    try { data = (await r.json()) || {}; } catch { /* leere Antwort ist ok */ }
    return {
      ok: r.ok, status: r.status, data,
      message: r.ok ? null : (data?.message || `Die Anfrage ist fehlgeschlagen (HTTP ${r.status}).`)
    };
  } catch {
    const message = timedOut
      ? "Die Anfrage hat zu lange gedauert. Dein Text ist gespeichert – bitte erneut versuchen."
      : ext?.aborted ? "Abgebrochen." : "Keine Verbindung zum Server.";
    return { ok: false, status: 0, data: {} as T, message };
  } finally {
    clearTimeout(timer);
    if (ext) ext.removeEventListener("abort", onExt);
  }
}

// Seitenübergreifender Zwischenspeicher, damit der Reiterwechsel sofort
// anzeigt statt kurz leer zu sein.
let requirementsCache: any = null;
export function getRequirementsCache() { return requirementsCache; }
export async function fetchRequirements() {
  if (requirementsCache) return requirementsCache;
  const r = await api("/api/motivation/requirements");
  if (r.ok) requirementsCache = r.data;
  return r.ok ? r.data : null;
}
