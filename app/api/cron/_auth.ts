import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { timingSafeEqual } from "@/lib/crypto";

// Vercel-Crons senden CRON_SECRET automatisch als "Authorization: Bearer ...".
// Prüft den Header streng (timing-safe). Gibt bei Fehler eine 401-Response
// zurück, sonst null (= autorisiert).
export function checkCronAuth(req: NextRequest): NextResponse | null {
  const header = req.headers.get("authorization") || "";
  const expected = `Bearer ${env.cronSecret()}`;
  if (!timingSafeEqual(header, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
