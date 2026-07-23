import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sicherer Bild-Proxy: lädt externe Mailbilder serverseitig, damit die IP/der
// Client des Nutzers nicht an den Bildserver geht und keine Cookies/persönlichen
// Header mitgesendet werden. Nur eingeloggte Nutzer; nur Bild-Inhaltstypen.
const MAX = 6 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const u = new URL(req.url).searchParams.get("u");
  if (!u || !/^https?:\/\//i.test(u)) return new NextResponse(null, { status: 400 });

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(u, {
      signal: ctrl.signal,
      redirect: "follow",
      // Bewusst minimal: kein Referer, keine Cookies, neutraler User-Agent.
      headers: { "user-agent": "Mozilla/5.0 (compatible; CockpitMailImage/1.0)", "accept": "image/*" }
    });
    clearTimeout(t);
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!r.ok || !ct.startsWith("image/")) return transparentGif();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX) return transparentGif();
    return new NextResponse(buf as any, {
      headers: {
        "content-type": ct,
        "cache-control": "private, max-age=86400",
        "content-security-policy": "default-src 'none'; img-src 'self' data:",
        "x-content-type-options": "nosniff"
      }
    });
  } catch {
    return transparentGif();
  }
}

// 1×1 transparentes GIF als Fallback (bricht das Layout nicht).
function transparentGif() {
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  return new NextResponse(gif as any, { headers: { "content-type": "image/gif", "cache-control": "private, max-age=3600" } });
}
