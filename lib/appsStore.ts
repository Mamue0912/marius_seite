import { requestJson } from "@/lib/http";

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
      const data = await requestJson("/api/applications", { cache: "no-store" });
      if (!Array.isArray(data.applications)) throw new Error("Bewerbungen konnten nicht geladen werden.");
      appsCache = data.applications;
      return data.applications as any[];
    } finally {
      appsInflight = null;
    }
  })();
  return appsInflight!;
}

export function fetchDocs(): Promise<any[]> {
  if (docsInflight) return docsInflight;
  docsInflight = (async () => {
    try {
      const data = await requestJson("/api/documents", { cache: "no-store" });
      if (!Array.isArray(data.documents)) throw new Error("Unterlagen konnten nicht geladen werden.");
      docsCache = data.documents;
      return data.documents as any[];
    } finally {
      docsInflight = null;
    }
  })();
  return docsInflight!;
}

export function prefetchApplications() {
  if (appsCache === null) void fetchApps().catch(() => undefined);
  if (docsCache === null) void fetchDocs().catch(() => undefined);
}

const detailCache = new Map<string, any>();
const detailInflight = new Map<string, Promise<any>>();

export function getAppDetail(id: string) { return detailCache.get(id) || null; }
export function setAppDetail(id: string, data: any) { detailCache.set(id, data); }

export function fetchAppDetail(id: string): Promise<any> {
  const running = detailInflight.get(id);
  if (running) return running;
  const promise = (async () => {
    try {
      const data = await requestJson("/api/applications/" + encodeURIComponent(id), { cache: "no-store" });
      detailCache.set(id, data);
      return data;
    } finally {
      detailInflight.delete(id);
    }
  })();
  detailInflight.set(id, promise);
  return promise;
}

export function prefetchAppDetail(id: string) {
  if (id && !detailCache.has(id)) void fetchAppDetail(id).catch(() => undefined);
}

let factsCache: any[] | null = null;
let factsInflight: Promise<any[]> | null = null;
export function getFactsCache() { return factsCache; }
export function setFactsCache(data: any[]) { factsCache = data; }
export function fetchFacts(): Promise<any[]> {
  if (factsInflight) return factsInflight;
  factsInflight = (async () => {
    try {
      const data = await requestJson("/api/documents/facts", { cache: "no-store" });
      if (!Array.isArray(data.facts)) throw new Error("Profilfakten konnten nicht geladen werden.");
      factsCache = data.facts;
      return data.facts as any[];
    } finally {
      factsInflight = null;
    }
  })();
  return factsInflight!;
}

let genDocsCache: any[] | null = null;
export function getGenDocsCache() { return genDocsCache; }
export function setGenDocsCache(data: any[]) { genDocsCache = data; }