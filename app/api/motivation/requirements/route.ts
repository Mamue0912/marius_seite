import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import {
  WHU_SOURCES, WHU_REQUIREMENTS, WHU_NOT_SPECIFIED, WHU_ADMISSION_2027,
  WHU_PROGRAMME_FACTS, WHU_SOURCE_CONFLICTS, WHU_BACHELOR
} from "@/lib/whuRequirements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liefert die hinterlegten Hochschulanforderungen für die Checkliste in der
// Arbeitsoberfläche. Quellenhinweise gehören in die Oberfläche – NICHT
// automatisch in den fertigen Bewerbungstext.
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    programme: WHU_BACHELOR,
    sources: WHU_SOURCES,
    requirements: WHU_REQUIREMENTS,
    notSpecified: WHU_NOT_SPECIFIED,
    admission: WHU_ADMISSION_2027,
    programmeFacts: WHU_PROGRAMME_FACTS,
    conflicts: WHU_SOURCE_CONFLICTS
  });
}
