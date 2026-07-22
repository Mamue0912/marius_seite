import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Privater Storage-Bucket "documents". Zugriff ausschließlich serverseitig
// über Service-Role; nach außen nur kurzlebige Signed-URLs. Keine öffentlichen
// Datei-Links.
const BUCKET = "documents";

let _ensured = false;
async function ensureBucket() {
  if (_ensured) return;
  try {
    const admin = supabaseAdmin();
    const { data } = await admin.storage.getBucket(BUCKET);
    if (!data) await admin.storage.createBucket(BUCKET, { public: false });
  } catch {
    // Bucket existiert evtl. schon oder wird per SQL angelegt – ignorieren.
  }
  _ensured = true;
}

export async function uploadDocument(userId: string, fileName: string, buffer: Buffer, mime: string): Promise<string> {
  await ensureBucket();
  const safe = fileName.replace(/[^\w.\-]+/g, "_").slice(-120);
  const path = `${userId}/${Date.now()}_${safe}`;
  const { error } = await supabaseAdmin().storage.from(BUCKET).upload(path, buffer, { contentType: mime || "application/octet-stream", upsert: false });
  if (error) throw new Error("upload_failed: " + error.message);
  return path;
}

export async function signedUrl(path: string, seconds = 300): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, seconds);
    return data?.signedUrl || null;
  } catch {
    return null;
  }
}

export async function downloadDocument(path: string): Promise<{ buffer: Buffer; mime: string } | null> {
  try {
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(path);
    if (error || !data) return null;
    const buffer = Buffer.from(await data.arrayBuffer());
    return { buffer, mime: (data as any).type || "application/octet-stream" };
  } catch {
    return null;
  }
}

export async function deleteDocument(path: string): Promise<void> {
  try { await supabaseAdmin().storage.from(BUCKET).remove([path]); } catch {}
}
