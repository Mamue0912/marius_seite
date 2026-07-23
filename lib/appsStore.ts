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
