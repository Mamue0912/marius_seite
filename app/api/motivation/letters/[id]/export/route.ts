import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { loadLetter, loadProfile } from "@/lib/motivationContext";
import { buildMotivationPdf } from "@/lib/motivationPdf";
import { buildDocx } from "@/lib/docxBuilder";
import { whuFileName } from "@/lib/whuRequirements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET ?format=pdf|docx  → Download
// GET ?probe=1          → nur Seitenzahl prüfen, ohne Download
//
// Die Seitenzahl stammt IMMER aus dem tatsächlichen Satz, nie aus einer
// Hochrechnung der Wortzahl.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let letter, profile;
  try {
    letter = await loadLetter(user.id, id);
    profile = await loadProfile(user.id);
  } catch (e) {
    return NextResponse.json({ error: "db_error", message: (e as Error).message }, { status: 500 });
  }
  if (!letter) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!letter.body.trim()) {
    return NextResponse.json({ error: "empty", message: "Es gibt noch keinen Text zum Exportieren." }, { status: 400 });
  }

  const url = new URL(req.url);
  const probe = url.searchParams.get("probe") === "1";
  const format = url.searchParams.get("format") === "docx" ? "docx" : "pdf";

  // Kopfzeile nur ergänzen, wenn der Text sie nicht ohnehin schon enthält.
  const header: string[] = [];
  const full = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  if (full && !letter.body.includes(full)) header.push(full);
  if (profile.birthDate && !letter.body.includes(profile.birthDate)) {
    const [y, m, d] = profile.birthDate.slice(0, 10).split("-");
    const german = `${d}.${m}.${y}`;
    if (!letter.body.includes(german)) header.push(`Geburtsdatum: ${german}`);
  }

  let pdf;
  try {
    pdf = await buildMotivationPdf({ body: letter.body, headerLines: header, maxPages: 2 });
  } catch (e) {
    return NextResponse.json({ error: "render_error", message: "Das PDF konnte nicht gesetzt werden." }, { status: 500 });
  }

  if (probe) {
    return NextResponse.json({
      pages: pdf.pages,
      fits: pdf.fits,
      fontSize: pdf.fontSize,
      message: pdf.fits
        ? `Der Text ergibt ${pdf.pages} gesetzte Seite(n).`
        : `Der Text ergibt ${pdf.pages} Seiten. Die WHU erlaubt höchstens 2 – bitte inhaltlich kürzen.`
    });
  }

  const fileName = whuFileName(profile.lastName || "", profile.firstName || "", format);

  if (format === "docx") {
    const buffer = await buildDocx({ title: undefined, body: [...header, "", letter.body].filter((l) => l !== undefined).join("\n") });
    return new NextResponse(new Uint8Array(buffer) as any, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${fileName}"`,
        "x-rendered-pages": String(pdf.pages)
      }
    });
  }

  return new NextResponse(new Uint8Array(pdf.bytes) as any, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${fileName}"`,
      "x-rendered-pages": String(pdf.pages),
      "x-fits-two-pages": String(pdf.fits)
    }
  });
}
