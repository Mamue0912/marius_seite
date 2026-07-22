import type { Block } from "@/lib/anthropic";

// Serverseitige Textextraktion aus hochgeladenen Unterlagen.
// PDF/DOCX/TXT → Text. Bilder → Vision-Block (Claude liest den Inhalt).
const IMAGE_MIMES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];

export function isImageMime(mime: string): boolean {
  return IMAGE_MIMES.includes((mime || "").toLowerCase());
}

export function imageBlock(buffer: Buffer, mime: string): Block {
  const mt = (mime || "").toLowerCase() === "image/jpg" ? "image/jpeg" : (mime || "image/png").toLowerCase();
  return { type: "image", source: { type: "base64", media_type: mt, data: buffer.toString("base64") } };
}

// PDF direkt an Claude als Dokument (liest auch gescannte PDFs ohne Textebene).
export function pdfBlock(buffer: Buffer): Block {
  return { type: "document", source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") } };
}

export function isPdf(mime: string, name: string): boolean {
  return (mime || "").toLowerCase().includes("pdf") || /\.pdf$/i.test(name || "");
}

export interface ExtractResult {
  text: string | null;   // null bei Bildern/gescannten PDFs (dann via Vision/Dokument)
  isImage: boolean;
  isPdf?: boolean;
  mediaType?: string;
}

export async function extractText(buffer: Buffer, mime: string, name: string): Promise<ExtractResult> {
  const lower = (name || "").toLowerCase();
  const m = (mime || "").toLowerCase();

  if (isImageMime(m) || /\.(png|jpe?g|webp|gif)$/.test(lower)) {
    return { text: null, isImage: true, mediaType: m || "image/png" };
  }
  if (m.includes("pdf") || lower.endsWith(".pdf")) {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const res = await parser.getText();
      const text = (res?.text || "").trim();
      // Kein Text (z. B. gescanntes PDF) → als PDF-Dokument an die KI weiterreichen.
      return { text: text || null, isImage: false, isPdf: true };
    } catch {
      return { text: null, isImage: false, isPdf: true };
    }
  }
  if (m.includes("wordprocessingml") || lower.endsWith(".docx")) {
    try {
      const mammoth = await import("mammoth");
      const res = await mammoth.extractRawText({ buffer });
      return { text: (res?.value || "").trim() || null, isImage: false };
    } catch {
      return { text: null, isImage: false };
    }
  }
  // TXT und alles Textartige
  try {
    return { text: buffer.toString("utf-8").trim() || null, isImage: false };
  } catch {
    return { text: null, isImage: false };
  }
}

// Grobe Doku-Typ-Vermutung aus dem Dateinamen (nur Vorschlag, editierbar).
export function guessDocType(name: string): string {
  const n = (name || "").toLowerCase();
  if (/(lebenslauf|cv|resume)/.test(n)) return "lebenslauf";
  if (/(zeugnis|zeugnisse|abitur|schulzeugnis)/.test(n)) return "zeugnis";
  if (/(zertifikat|certificate|urkunde)/.test(n)) return "zertifikat";
  if (/(empfehlung|reference|referenz)/.test(n)) return "empfehlung";
  if (/(anschreiben|cover)/.test(n)) return "anschreiben";
  if (/(sport|karate|dan|kyu)/.test(n)) return "sportnachweis";
  return "sonstiges";
}
