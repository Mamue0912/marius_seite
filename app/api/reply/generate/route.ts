import { NextRequest } from "next/server";
import { POST as generateReply } from "../../mail/generate-reply/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

// Kompatibilitätsroute für ältere Clients. Die zentrale Implementierung liegt
// bei /api/mail/generate-reply, damit Validierung und Persistenz identisch bleiben.
export async function POST(req: NextRequest) {
  return generateReply(req);
}