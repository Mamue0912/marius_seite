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
