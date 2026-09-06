import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { safeInternalPath } from "@/lib/safeNavigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const errorDescription = url.searchParams.get("error_description");
  const next = safeInternalPath(url.searchParams.get("next"));

  if (errorDescription) {
    return NextResponse.redirect(new URL("/?auth_error=" + encodeURIComponent(errorDescription), url.origin));
  }

  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL("/?auth_error=" + encodeURIComponent(error.message), url.origin));
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}