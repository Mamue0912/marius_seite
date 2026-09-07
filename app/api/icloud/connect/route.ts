import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { encrypt } from "@/lib/crypto";
import { verifyIcloud, IcloudAuthError } from "@/lib/icloudCalendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Verbindet einen iCloud-Kalender per CalDAV. Prüft Apple-ID + app-spezifisches
// Passwort, ermittelt das Kalender-Home und speichert die Zugangsdaten
// verschlüsselt. Nur Lesezugriff.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const appleId = String(body.appleId || "").trim();
  // Apple zeigt app-spezifische Passwörter mit Leerzeichen an (xxxx-xxxx-…),
  // die aber nicht Teil des Passworts sind.
  const appPassword = String(body.appPassword || "").replace(/\s+/g, "");

  if (!appleId || !appPassword) {
    return NextResponse.json({ error: "Apple-ID und app-spezifisches Passwort sind erforderlich." }, { status: 400 });
  }
  if (!appleId.includes("@")) {
    return NextResponse.json({ error: "Bitte die vollständige Apple-ID (E-Mail) angeben." }, { status: 400 });
  }

  let home: string;
  let calendars: number;
  try {
    ({ home, calendars } = await verifyIcloud(appleId, appPassword));
  } catch (e) {
    if (e instanceof IcloudAuthError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    // Die Meldungen benennen nur die Stufe und ggf. den HTTP-Status. Sie
    // enthalten weder Zugangsdaten noch Antwortinhalte und dürfen deshalb
    // sichtbar sein – sonst ist die Ursache nicht zu ermitteln.
    const message = (e as Error).message?.trim();
    return NextResponse.json(
      { error: message || "Apple-Kalender konnten nicht gelesen werden. Bitte App-Passwort und Kalenderberechtigung prüfen." },
      { status: 502 }
    );
  }

  const { error } = await supabaseAdmin()
    .from("icloud_accounts")
    .upsert(
      {
        user_id: user.id,
        apple_id: appleId,
        app_password_enc: encrypt(appPassword),
        calendar_home_url: home,
        status: "connected",
        last_error: null,
        updated_at: new Date().toISOString()
      },
      { onConflict: "user_id" }
    );

  if (error) {
    return NextResponse.json({ error: `Speichern fehlgeschlagen: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, calendars });
}
