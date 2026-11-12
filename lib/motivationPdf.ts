// =====================================================================
//  PDF-Satz für Motivationsschreiben
//
//  Kernpunkt: Die Seitenzahl wird NICHT aus der Wortzahl geschätzt,
//  sondern ergibt sich aus dem tatsächlichen Umbruch. buildMotivationPdf
//  liefert die Zahl der wirklich gesetzten Seiten zurück, damit die
//  2-Seiten-Vorgabe belastbar geprüft werden kann.
//
//  Schriftgröße wird NICHT auf unleserliche Werte reduziert: es gibt
//  eine harte Untergrenze. Passt der Text dann immer noch nicht, meldet
//  die Funktion das ehrlich (fits=false), damit gekürzt werden kann.
// =====================================================================

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

export interface PdfOptions {
  body: string;
  /** Optionaler Kopf (Name, Vorname, Geburtsdatum) über dem Text. */
  headerLines?: string[];
  /** Startgröße in pt. */
  fontSize?: number;
  /** Harte Untergrenze – darunter wird nicht verkleinert. */
  minFontSize?: number;
  /** Höchstzahl erlaubter Seiten (WHU: 2). */
  maxPages?: number;
}

export interface PdfResult {
  bytes: Uint8Array;
  /** Tatsächlich gesetzte Seiten. */
  pages: number;
  /** Verwendete Schriftgröße. */
  fontSize: number;
  /** Passt das Ergebnis in maxPages? */
  fits: boolean;
}

// DIN A4 in PostScript-Punkten.
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 56.7; // ca. 2 cm

/**
 * WinAnsi (die Kodierung der Standardschriften) kennt keine Zeichen
 * außerhalb Latin-1. Solche Zeichen würden pdf-lib zum Werfen bringen,
 * deshalb werden gängige Typografie-Zeichen ersetzt statt zu scheitern.
 * Deutsche Umlaute und ß sind in WinAnsi enthalten und bleiben erhalten.
 */
export function toWinAnsi(text: string): string {
  return (text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[‘’‚‹›]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/•/g, "-")
    .replace(/€/g, "EUR")
    .replace(/[−]/g, "-")
    // Alles übrige außerhalb Latin-1 entfernen, damit der Satz nicht bricht.
    .replace(/[^\u0000-ÿ\n]/g, "");
}

/** Bricht einen Absatz auf die verfügbare Breite um (echte Textmessung). */
export function wrapParagraph(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    // Einzelwort länger als die Zeile: hart trennen, sonst Endlosschleife.
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    } else {
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Zerlegt den gesamten Text in Zeilen inkl. Absatzabständen. */
function layout(body: string, header: string[], font: PDFFont, bold: PDFFont, size: number) {
  const maxWidth = A4_WIDTH - 2 * MARGIN;
  const items: { text: string; bold: boolean; gapAfter: number }[] = [];

  for (const h of header) {
    for (const l of wrapParagraph(h, bold, size, maxWidth)) items.push({ text: l, bold: true, gapAfter: 0 });
  }
  if (header.length) items.push({ text: "", bold: false, gapAfter: size * 0.8 });

  const paras = body.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  paras.forEach((p, idx) => {
    // Einzelne Zeilenumbrüche innerhalb eines Absatzes bleiben erhalten.
    const sub = p.split("\n");
    sub.forEach((s) => {
      const wrapped = wrapParagraph(s, font, size, maxWidth);
      if (!wrapped.length) items.push({ text: "", bold: false, gapAfter: 0 });
      for (const l of wrapped) items.push({ text: l, bold: false, gapAfter: 0 });
    });
    if (idx < paras.length - 1) items.push({ text: "", bold: false, gapAfter: size * 0.7 });
  });

  return items;
}

/**
 * Erzeugt das PDF. Passt der Text nicht in maxPages, wird die Schrift in
 * 0,5-pt-Schritten bis minFontSize verkleinert – und keinesfalls darunter.
 */
export async function buildMotivationPdf(opts: PdfOptions): Promise<PdfResult> {
  const body = toWinAnsi(opts.body || "");
  const header = (opts.headerLines || []).map(toWinAnsi).filter((l) => l.trim());
  const maxPages = opts.maxPages ?? 2;
  const minSize = opts.minFontSize ?? 10;
  let size = opts.fontSize ?? 11;

  let result: { bytes: Uint8Array; pages: number } | null = null;
  let used = size;

  // Erst mit der Wunschgröße versuchen, dann behutsam verkleinern.
  for (let s = size; s >= minSize - 0.001; s -= 0.5) {
    const attempt = await render(body, header, s);
    used = s;
    result = attempt;
    if (attempt.pages <= maxPages) break;
  }

  if (!result) result = await render(body, header, minSize);
  return { bytes: result.bytes, pages: result.pages, fontSize: used, fits: result.pages <= maxPages };
}

async function render(body: string, header: string[], size: number): Promise<{ bytes: Uint8Array; pages: number }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const lineHeight = size * 1.45;
  const items = layout(body, header, font, bold, size);

  let page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - MARGIN;

  for (const item of items) {
    if (y - lineHeight < MARGIN) {
      page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
      y = A4_HEIGHT - MARGIN;
    }
    if (item.text) {
      page.drawText(item.text, {
        x: MARGIN, y: y - size, size,
        font: item.bold ? bold : font,
        color: rgb(0.08, 0.08, 0.1)
      });
    }
    y -= lineHeight + (item.gapAfter || 0);
  }

  const bytes = await doc.save();
  return { bytes, pages: doc.getPageCount() };
}
