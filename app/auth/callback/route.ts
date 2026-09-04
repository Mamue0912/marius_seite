import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rückgabe-Route für den Supabase-Magic-Link (PKCE-Flow).
// Der Link führt hierher mit ?code=… ; wir tauschen den Code gegen eine
// Sitzung und setzen die Auth-Cookies. Danach zurück ins Cockpit.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const errorDescription = url.searchParams.get("error_description");
  const next = url.searchParams.get("next") || "/";

  if (errorDescription) {
    // Abgelaufener/ungültiger Link → zurück zur Anmeldung mit Hinweis.
    return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(errorDescription)}`, url.origin));
  }

  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(error.message)}`, url.origin));
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
