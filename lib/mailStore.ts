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
      const { data } = await supabase.from("messages").select("*").eq("is_deleted", false).order("received_at", { ascending: false }).limit(600);
      cache = data || [];
      return cache!;
    } catch { return cache || []; }
    finally { inflight = null; }
  })();
  return inflight;
}

export function prefetchMail() { if (cache === null) fetchMessages(); }

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
      const r = await fetch(`/api/mail/folder?account=${account}&path=${encodeURIComponent(path)}`);
      const j = await r.json();
      const items = r.ok ? (j.items || []) : [];
      folderCache.set(k, items);
      return items;
    } catch { return folderCache.get(k) || []; }
    finally { folderInflight.delete(k); }
  })();
  folderInflight.set(k, p);
  return p;
}
export function prefetchFolder(account: string, path: string) { const k = fkey(account, path); if (!folderCache.has(k)) fetchFolder(account, path); }

// ---- Geöffnete Mail-Inhalte zwischenspeichern (sofortiges Wiederöffnen) ----
const contentCache = new Map<string, any>();
export function getMsgContent(key: string) { return contentCache.get(key) || null; }
export function setMsgContent(key: string, val: any) { contentCache.set(key, val); }
