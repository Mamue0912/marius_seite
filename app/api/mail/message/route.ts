import { NextRequest, NextResponse } from "next/server";
import sanitizeHtml from "sanitize-html";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadMailAccount, MailAccount } from "@/lib/mailAccounts";
import { fetchMessageFull, extractUid } from "@/lib/imapFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

// Sicheres HTML für isolierte iframe-Darstellung. Inline-Styles UND
// Tabellenlayout bleiben erhalten (sonst zerbricht das Original-Layout,
// z. B. bei PayPal). Skripte/Formulare/Event-Handler werden entfernt.
// Bilder nur, wenn ausdrücklich gewünscht (Tracking-Pixel sonst geblockt).
function safeHtml(html: string, withImages: boolean): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags
      .concat(["img", "span", "div", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "center", "font", "u", "s", "hr", "h1", "h2"])
      .filter((t) => !["script", "style", "iframe", "object", "embed", "form", "input", "button", "textarea", "link", "meta"].includes(t)),
    allowedAttributes: {
      "*": ["style", "align", "valign", "width", "height", "bgcolor", "color", "colspan", "rowspan", "cellpadding", "cellspacing", "border", "dir"],
      a: ["href", "style", "target", "align"],
      img: withImages ? ["src", "alt", "width", "height", "style", "loading", "decoding", "referrerpolicy"] : ["alt", "width", "height", "style"],
      font: ["face", "size", "color"]
    },
    allowedSchemes: ["http", "https", "mailto", "data"],
    allowedSchemesByTag: { img: withImages ? ["http", "https", "data"] : [] },
    // Tracking-Pixel (1×1 o. Ä.) entfernen, auch wenn Bilder erlaubt sind.
    exclusiveFilter: (frame) => {
      if (frame.tag !== "img") return false;
      const a = frame.attribs || {};
      const w = parseInt(a.width || "", 10);
      const h = parseInt(a.height || "", 10);
      if ((w > 0 && w <= 2) || (h > 0 && h <= 2)) return true;
      if (/(width\s*:\s*1px|height\s*:\s*1px)/i.test(a.style || "")) return true;
      if (/(\/(open|track|trk|pixel|beacon|wf\/open|o\/)|utm_|email_open|mailstat|spacer\.gif)/i.test(a.src || "")) return true;
      return false;
    },
    // Gefährliche/positionierende Styles raus, Layout-Styles behalten.
    allowedStyles: {
      "*": {
        "color": [/.*/], "background-color": [/.*/], "background": [/.*/],
        "text-align": [/.*/], "font-size": [/.*/], "font-weight": [/.*/], "font-family": [/.*/], "font-style": [/.*/],
        "width": [/.*/], "max-width": [/.*/], "height": [/.*/], "min-width": [/.*/],
        "padding": [/.*/], "padding-top": [/.*/], "padding-bottom": [/.*/], "padding-left": [/.*/], "padding-right": [/.*/],
        "margin": [/.*/], "margin-top": [/.*/], "margin-bottom": [/.*/], "margin-left": [/.*/], "margin-right": [/.*/],
        "border": [/.*/], "border-radius": [/.*/], "border-top": [/.*/], "border-bottom": [/.*/], "border-collapse": [/.*/],
        "line-height": [/.*/], "letter-spacing": [/.*/], "text-decoration": [/.*/], "vertical-align": [/.*/], "display": [/.*/]
      }
    },
    transformTags: {
      a: (tag, attribs) => ({ tagName: "a", attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" } }),
      // Externe Bilder über den sicheren serverseitigen Proxy laden (schützt IP,
      // sendet keine Cookies/Referer), lazy laden, kein Referrer.
      img: (tag, attribs) => {
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(attribs)) if (v != null) clean[k] = String(v);
        if (!withImages) { delete clean.src; return { tagName: "img", attribs: clean } as any; }
        const src = clean.src || "";
        if (/^https?:\/\//i.test(src)) clean.src = `/api/mail/img?u=${encodeURIComponent(src)}`;
        clean.loading = "lazy"; clean.decoding = "async"; clean.referrerpolicy = "no-referrer";
        return { tagName: "img", attribs: clean } as any;
      }
    }
  });
}

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const withImages = url.searchParams.get("images") === "1";

  // Direktabruf aus einem beliebigen IMAP-Ordner (nicht in der DB gespeichert).
  const directUid = url.searchParams.get("uid");
  const directAccount = url.searchParams.get("account");
  const directPath = url.searchParams.get("path");
  if (directUid && directAccount && directPath) {
    const acc = await loadMailAccount(directAccount);
    if (!acc || (acc as any).user_id !== user.id) return NextResponse.json({ error: "no_account" }, { status: 403 });
    try {
      const full = await fetchMessageFull(acc as MailAccount, parseInt(directUid, 10), directPath, true);
      return NextResponse.json({ text: full.text, html: full.html ? safeHtml(full.html, withImages) : null, hasImages: full.html ? /<img[\s>]/i.test(full.html) : false, withImages, thread: [] });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  }

  if (!id) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: msg } = await admin.from("messages").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!msg) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Als gelesen markieren (nur lokal; IMAP-Flag bleibt unangetastet).
  if (!msg.is_read) admin.from("messages").update({ is_read: true }).eq("id", msg.id).then(() => {});

  // Thread (frühere Nachrichten derselben Unterhaltung).
  let thread: any[] = [];
  if (msg.thread_id) {
    const { data } = await admin.from("messages")
      .select("id,from_name,from_address,subject,received_at,folder_type,preview")
      .eq("user_id", user.id).eq("thread_id", msg.thread_id).neq("id", msg.id)
      .order("received_at", { ascending: true }).limit(15);
    thread = data || [];
  }

  const account = msg.mail_account_id ? await loadMailAccount(msg.mail_account_id) : null;
  const uid = extractUid(msg.web_link);

  let text = "";
  let html: string | null = null;
  let hasImages = false;
  if (account && uid) {
    try {
      const full = await fetchMessageFull(account as MailAccount, uid, msg.original_folder_name || "INBOX");
      text = full.text;
      if (full.html) {
        hasImages = /<img[\s>]/i.test(full.html);
        html = safeHtml(full.html, withImages);
      }
    } catch (e) {
      console.error("fetchMessageFull:", (e as Error).message);
    }
  }

  return NextResponse.json({
    id: msg.id, text, html, thread, hasImages, withImages,
    account: account ? { email: (account as any).email, provider: (account as any).provider } : null
  });
}
