// Seitenübergreifender Cache für den Bewerbungsbereich (Client). Bleibt dank
// Client-Navigation über Seitenwechsel erhalten. Ermöglicht Vorladen beim
// Hovern über „Bewerbungen" und sofortige Anzeige beim Öffnen.

let appsCache: any[] | null = null;
let docsCache: any[] | null = null;
let appsInflight: Promise<any[]> | null = null;
let docsInflight: Promise<any[]> | null = null;

export function getAppsCache() { return appsCache; }
export function getDocsCache() { return docsCache; }

export function fetchApps(): Promise<any[]> {
  if (appsInflight) return appsInflight;
  appsInflight = (async () => {
    try {
      const r = await fetch("/api/applications", { cache: "no-store" });
      const d = await r.json();
      appsCache = d.applications || [];
      return appsCache!;
    } catch { return appsCache || []; }
    finally { appsInflight = null; }
  })();
  return appsInflight;
}

export function fetchDocs(): Promise<any[]> {
  if (docsInflight) return docsInflight;
  docsInflight = (async () => {
    try {
      const r = await fetch("/api/documents", { cache: "no-store" });
      const d = await r.json();
      docsCache = d.documents || [];
      return docsCache!;
    } catch { return docsCache || []; }
    finally { docsInflight = null; }
  })();
  return docsInflight;
}

// Beim Hovern über „Bewerbungen": Liste + Unterlagen im Hintergrund vorladen.
export function prefetchApplications() {
  if (appsCache === null) fetchApps();
  if (docsCache === null) fetchDocs();
}

// ---- Detailansicht einer einzelnen Bewerbung (für den Bewerbungschat) ----
const detailCache = new Map<string, any>();
const detailInflight = new Map<string, Promise<any>>();

export function getAppDetail(id: string) { return detailCache.get(id) || null; }
export function setAppDetail(id: string, d: any) { detailCache.set(id, d); }

export function fetchAppDetail(id: string): Promise<any> {
  const running = detailInflight.get(id);
  if (running) return running;
  const p = (async () => {
    try {
      const r = await fetch(`/api/applications/${id}`, { cache: "no-store" });
      const d = await r.json();
      if (r.ok) detailCache.set(id, d);
      return r.ok ? d : null;
    } catch { return detailCache.get(id) || null; }
    finally { detailInflight.delete(id); }
  })();
  detailInflight.set(id, p);
  return p;
}

// Beim Hovern über eine Bewerbung deren Detaildaten (inkl. Chat) vorladen.
export function prefetchAppDetail(id: string) { if (id && !detailCache.has(id)) fetchAppDetail(id); }

// ---- Profil-Fakten (bleiben über Wechsel erhalten) ----
let factsCache: any[] | null = null;
let factsInflight: Promise<any[]> | null = null;
export function getFactsCache() { return factsCache; }
export function setFactsCache(d: any[]) { factsCache = d; }
export function fetchFacts(): Promise<any[]> {
  if (factsInflight) return factsInflight;
  factsInflight = (async () => {
    try {
      const r = await fetch("/api/documents/facts", { cache: "no-store" });
      const d = await r.json();
      factsCache = d.facts || [];
      return factsCache!;
    } catch { return factsCache || []; }
    finally { factsInflight = null; }
  })();
  return factsInflight;
}

// ---- Erstellte Dokumente (Aggregat über alle Bewerbungen) ----
let genDocsCache: any[] | null = null;
export function getGenDocsCache() { return genDocsCache; }
export function setGenDocsCache(d: any[]) { genDocsCache = d; }
