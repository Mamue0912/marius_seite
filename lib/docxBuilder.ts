import { Document, Packer, Paragraph, TextRun, AlignmentType } from "docx";

// Erzeugt eine professionell formatierte DOCX-Datei aus Fließtext.
// Sinnvolle Seitenränder, klare Typografie, vollständig bearbeitbar.
export async function buildDocx(opts: { title?: string; body: string }): Promise<Buffer> {
  const paras: Paragraph[] = [];

  if (opts.title) {
    paras.push(new Paragraph({
      spacing: { after: 240 },
      children: [new TextRun({ text: opts.title, bold: true, size: 30 })]
    }));
  }

  // Absätze am Leerzeilen trennen; Zeilenumbrüche innerhalb erhalten.
  const blocks = opts.body.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n");
    const children: TextRun[] = [];
    lines.forEach((line, i) => {
      if (i > 0) children.push(new TextRun({ text: "", break: 1 }));
      children.push(new TextRun({ text: line, size: 22 }));
    });
    paras.push(new Paragraph({
      spacing: { after: 200, line: 276 },
      alignment: AlignmentType.LEFT,
      children
    }));
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 } }
      }
    },
    sections: [{
      properties: {
        page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } // ~2 cm
      },
      children: paras
    }]
  });

  return Packer.toBuffer(doc) as unknown as Buffer;
}

// Dateisicherer Name aus Titel/Firma/Art.
export function safeFileName(parts: (string | null | undefined)[], ext: string): string {
  const base = parts.filter(Boolean).join("_")
    .normalize("NFKD").replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 80) || "dokument";
  return `${base}.${ext}`;
}
