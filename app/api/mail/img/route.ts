import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { fetchPublicResource, readBodyLimited } from "@/lib/safeRemote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX = 6 * 1024 * 1024;
const SAFE_IMAGE_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const source = new URL(req.url).searchParams.get("u");
  if (!source) return new NextResponse(null, { status: 400 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetchPublicResource(source, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; CockpitMailImage/1.0)",
        accept: "image/avif,image/webp,image/png,image/jpeg,image/gif"
      }
    });
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!response.ok || !SAFE_IMAGE_TYPES.has(contentType)) {
      await response.body?.cancel();
      return transparentGif();
    }
    const buffer = await readBodyLimited(response, MAX);
    if (!buffer) return transparentGif();
    return new NextResponse(buffer as any, {
      headers: {
        "content-type": contentType,
        "cache-control": "private, max-age=86400",
        "content-security-policy": "default-src 'none'; img-src 'self' data:",
        "x-content-type-options": "nosniff"
      }
    });
  } catch {
    return transparentGif();
  } finally {
    clearTimeout(timer);
  }
}

function transparentGif() {
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  return new NextResponse(gif as any, {
    headers: { "content-type": "image/gif", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" }
  });
}