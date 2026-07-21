import { NextRequest, NextResponse } from "next/server";
import sanitizeHtml from "sanitize-html";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadMailAccount, MailAccount } from "@/lib/mailAccounts";
import { fetchMessageFull, extractUid } from "@/lib/imapFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

// Sicheres HTML: nur lesbare Formatierung, KEINE Skripte, iframes, Event-Handler.
// Bilder werden entfernt (Tracking-Pixel/Remote-Tracker), ohne den Text zu zerstören.
function safeHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "b", "strong", "i", "em", "u", "s", "a", "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "span", "div", "table", "thead", "tbody", "tr", "td", "th", "pre", "code"],
    allowedAttributes: { a: ["href"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (tag, attribs) => ({ tagName: "a", attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" } })
    },
    // Bilder/Style/Script komplett raus.
    exclusiveFilter: (f) => ["script", "style", "img", "iframe", "object", "embed", "link"].includes(f.tag)
  });
}

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
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
  if (account && uid) {
    try {
      const full = await fetchMessageFull(account as MailAccount, uid, msg.original_folder_name || "INBOX");
      text = full.text;
      html = full.html ? safeHtml(full.html) : null;
    } catch (e) {
      console.error("fetchMessageFull:", (e as Error).message);
    }
  }

  return NextResponse.json({
    id: msg.id, text, html, thread,
    account: account ? { email: (account as any).email, provider: (account as any).provider } : null
  });
}
