import { requestJson } from "./http";
// Seitenübergreifender Cache für die Mail-Liste (Client). Bleibt dank
// Client-Navigation über Seitenwechsel erhalten. Vorladen beim Hovern über
// „E-Mails" und sofortige Anzeige beim Öffnen (stale-while-revalidate).
import { supabaseBrowser } from "./supabaseBrowser";

let cache: any[] | null = null;
let inflight: Promise<any[]> | null = null;

export function getMailCache() { return cache; }
export function setMailCache(d: any[]) { cache = d; }

export function fetchMessages(): Promise<any[]> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.from("messages").select("*").eq("is_deleted", false).order("received_at", { ascending: false }).limit(600);
      if (error) throw new Error("Nachrichten konnten nicht geladen werden.");
      cache = data || [];
      return cache!;
    }
    finally { inflight = null; }
  })();
  return inflight;
}

export function prefetchMail() { if (cache === null) void fetchMessages().catch(() => {}); }

// ---- Ordner-Inhalte (Junk/Archiv/…): live vom Server, aber zwischengespeichert ----
const folderCache = new Map<string, any[]>();
const folderInflight = new Map<string, Promise<any[]>>();
const fkey = (account: string, path: string) => account + "|" + path;

export function getFolderCache(account: string, path: string) { return folderCache.get(fkey(account, path)) || null; }
export function fetchFolder(account: string, path: string): Promise<any[]> {
  const k = fkey(account, path);
  const running = folderInflight.get(k);
  if (running) return running;
  const p = (async () => {
    try {
      const j = await requestJson("/api/mail/folder?account=" + encodeURIComponent(account) + "&path=" + encodeURIComponent(path));
      const items = j.items || [];
      folderCache.set(k, items);
      return items;
    }
    finally { folderInflight.delete(k); }
  })();
  folderInflight.set(k, p);
  return p;
}
export function prefetchFolder(account: string, path: string) { const k = fkey(account, path); if (!folderCache.has(k)) void fetchFolder(account, path).catch(() => {}); }

// ---- Geöffnete Mail-Inhalte zwischenspeichern (sofortiges Wiederöffnen) ----
const contentCache = new Map<string, any>();
export function getMsgContent(key: string) { return contentCache.get(key) || null; }
export function setMsgContent(key: string, val: any) {
 if (val?.error) return;
 if (contentCache.size >= 80) contentCache.delete(contentCache.keys().next().value!);
 contentCache.set(key, val);
}
export function invalidateFolderCache(account: string, path: string) { folderCache.delete(fkey(account, path)); }
export function clearMailCache() { cache = null; folderCache.clear(); contentCache.clear(); }
