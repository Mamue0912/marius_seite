import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadMailAccounts, MailAccount } from "@/lib/mailAccounts";
import { sendMail } from "@/lib/mailSend";
import { friendlyMailError } from "@/lib/mailErrors";
import { downloadDocument } from "@/lib/storage";
import { buildDocx, safeFileName } from "@/lib/docxBuilder";
import { loadApplication, touchApplication } from "@/lib/applicationContext";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Prüft, welche laut Stellenanzeige verlangten Unterlagen fehlen.
function missingDocWarnings(required: string[], attachedTypes: string[], attachedNames: string[]): string[] {
  const warnings: string[] = [];
  const hay = (attachedTypes.join(" ") + " " + attachedNames.join(" ")).toLowerCase();
  const need: { key: RegExp; label: string; has: RegExp }[] = [
    { key: /lebenslauf|cv|resume/i, label: "Lebenslauf", has: /lebenslauf|cv|resume/ },
    { key: /zeugnis|zeugnisse|abitur/i, label: "Zeugnisse", has: /zeugnis|abitur/ },
    { key: /zertifikat|nachweis|zertifikate/i, label: "Zertifikate/Nachweise", has: /zertifikat|nachweis/ },
    { key: /anschreiben|motivations/i, label: "Anschreiben", has: /anschreiben|motivation/ }
  ];
  for (const r of (required || [])) {
    for (const n of need) {
      if (n.key.test(r) && !n.has.test(hay)) {
        if (!warnings.some((w) => w.includes(n.label))) warnings.push(`Die Stellenanzeige verlangt „${r}". ${n.label} wurde noch nicht ausgewählt.`);
      }
    }
  }
  return warnings;
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { applicationId, mode, fromAccountId, to, cc, subject, text, attachmentDocIds, generatedDocId, confirm } = body;
  const app = await loadApplication(user.id, applicationId);
  if (!app) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const admin = supabaseAdmin();

  // Angehängte Unterlagen bestimmen (nur eigene, für Bewerbungen freigegebene).
  const docIds: string[] = Array.isArray(attachmentDocIds) ? attachmentDocIds : [];
  let attachedDocs: any[] = [];
  if (docIds.length) {
    const { data } = await admin.from("app_documents").select("*").eq("user_id", user.id).in("id", docIds);
    attachedDocs = (data || []).filter((d) => d.allowed_for_applications);
  }
  const required: string[] = app.analysis?.documents_required || [];
  const warnings = missingDocWarnings(required, attachedDocs.map((d) => d.doc_type || ""), attachedDocs.map((d) => d.name || ""));

  // Prüfmodus: nur Warnungen + Vorschau zurückgeben, nichts senden.
  if (mode === "check") {
    return NextResponse.json({ warnings, requiredDocuments: required, sendEnabled: env.enableSend() });
  }

  // Senden – nur nach ausdrücklicher Bestätigung und wenn aktiviert.
  if (!env.enableSend()) return NextResponse.json({ error: "send_disabled", message: "Versand ist nicht aktiviert (ENABLE_SEND=false)." }, { status: 403 });
  if (confirm !== true) return NextResponse.json({ error: "confirmation_required", message: "Bitte den Versand ausdrücklich bestätigen." }, { status: 400 });
  if (!to?.trim()) return NextResponse.json({ error: "no_recipient", message: "Kein Empfänger angegeben." }, { status: 400 });
  if (!subject?.trim() || !text?.trim()) return NextResponse.json({ error: "empty", message: "Betreff und Text dürfen nicht leer sein." }, { status: 400 });

  const accounts = await loadMailAccounts(user.id);
  const account = accounts.find((a) => a.id === fromAccountId) || (app ? accounts[0] : null);
  if (!account) return NextResponse.json({ error: "no_account", message: "Kein Absenderkonto." }, { status: 400 });

  // Anhänge laden (Unterlagen aus privatem Storage + optional erzeugtes Dokument als DOCX).
  const attachments: { filename: string; content: Buffer; contentType?: string }[] = [];
  for (const d of attachedDocs) {
    const dl = await downloadDocument(d.storage_path);
    if (dl) attachments.push({ filename: d.name || "Unterlage", content: dl.buffer, contentType: d.mime || undefined });
  }
  if (generatedDocId) {
    const { data: gd } = await admin.from("application_docs").select("*").eq("id", generatedDocId).eq("user_id", user.id).maybeSingle();
    if (gd) {
      const buf = await buildDocx({ title: gd.title || gd.kind, body: gd.body });
      attachments.push({ filename: safeFileName([app.company, gd.kind], "docx"), content: buf, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    }
  }

  try {
    await sendMail(account as MailAccount, {
      to: to.trim(), cc: cc?.trim() || undefined, subject: subject.trim(), text,
      fromName: (account as any).display_name || null, attachments
    });
    await admin.from("applications").update({ status: "beworben", last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", app.id);
    await touchApplication(app.id);
    return NextResponse.json({ ok: true, from: (account as any).email });
  } catch (e) {
    return NextResponse.json({ error: "send_failed", message: friendlyMailError(e as Error) }, { status: 502 });
  }
}
