import { NextRequest, NextResponse } from "next/server";
import sanitizeHtml from "sanitize-html";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadMailAccount, MailAccount } from "@/lib/mailAccounts";
import { fetchMessageFull, extractUid } from "@/lib/imapFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const SAFE_STYLE = /^(?![\s\S]*(?:url\s*\(|expression\s*\(|@import|javascript\s*:))[\s\S]*$/i;

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
    allowedSchemes: ["http", "https", "mailto"],
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
        "color": [SAFE_STYLE], "background-color": [SAFE_STYLE], "background": [SAFE_STYLE],
        "text-align": [SAFE_STYLE], "font-size": [SAFE_STYLE], "font-weight": [SAFE_STYLE], "font-family": [SAFE_STYLE], "font-style": [SAFE_STYLE],
        "width": [SAFE_STYLE], "max-width": [SAFE_STYLE], "height": [SAFE_STYLE], "min-width": [SAFE_STYLE],
        "padding": [SAFE_STYLE], "padding-top": [SAFE_STYLE], "padding-bottom": [SAFE_STYLE], "padding-left": [SAFE_STYLE], "padding-right": [SAFE_STYLE],
        "margin": [SAFE_STYLE], "margin-top": [SAFE_STYLE], "margin-bottom": [SAFE_STYLE], "margin-left": [SAFE_STYLE], "margin-right": [SAFE_STYLE],
        "border": [SAFE_STYLE], "border-radius": [SAFE_STYLE], "border-top": [SAFE_STYLE], "border-bottom": [SAFE_STYLE], "border-collapse": [SAFE_STYLE],
        "line-height": [SAFE_STYLE], "letter-spacing": [SAFE_STYLE], "text-decoration": [SAFE_STYLE], "vertical-align": [SAFE_STYLE], "display": [SAFE_STYLE]
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
        if (/^data:/i.test(src) && !/^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i.test(src)) delete clean.src;
        else if (/^https?:\/\//i.test(src)) clean.src = `/api/mail/img?u=${encodeURIComponent(src)}`;
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

  // Lokal als gelesen markieren; das IMAP-\Seen-Flag wird unten beim Abruf
  // mitgesetzt, damit die Mail auch in anderen Mail-Apps als gelesen gilt.
  const wasUnread = !msg.is_read;


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
  if (!account || !uid || account.user_id !== user.id) return NextResponse.json({error:"Die Originalnachricht ist derzeit nicht verfügbar."},{status:404});
  if (account && uid) {
    try {
      const full = await fetchMessageFull(account as MailAccount, uid, msg.original_folder_name || "INBOX", wasUnread);
      if (wasUnread) {
        const {error} = await admin.from("messages").update({is_read:true}).eq("id",msg.id).eq("user_id",user.id);
        if (error) return NextResponse.json({error:"Gelesen-Status konnte lokal nicht gespeichert werden."},{status:502});
      }
      text = full.text;
      if (full.html) {
        hasImages = /<img[\s>]/i.test(full.html);
        html = safeHtml(full.html, withImages);
      }
    } catch (e) {
      return NextResponse.json({error:"Nachricht konnte nicht vollständig geladen werden. Bitte erneut versuchen."},{status:502});
    }
  }

  return NextResponse.json({
    id: msg.id, text, html, thread, hasImages, withImages,
    account: account ? { email: (account as any).email, provider: (account as any).provider } : null
  });
}
