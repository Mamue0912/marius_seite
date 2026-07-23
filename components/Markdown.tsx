"use client";
import React from "react";

// Sicherer, minimaler Markdown-Renderer für KI-Chatnachrichten.
// Baut ausschließlich React-Elemente aus geparsten Tokens – kein
// dangerouslySetInnerHTML, also keine Möglichkeit für HTML-Injection.
// Unterstützt: **fett**, *kursiv*/_kursiv_, `code`, [Text](URL),
// Überschriften (# .. ####), Aufzählungen (-/*/•), nummerierte Listen,
// Absätze und Zeilenumbrüche. Alles andere bleibt sichtbarer Text.

// Inline-Formatierung eines einzelnen Textabschnitts zu React-Knoten.
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Reihenfolge wichtig: Code, Link, fett, kursiv.
  const re = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("`")) {
      nodes.push(<code key={key} className="md-code">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      if (mm && /^(https?:\/\/|mailto:)/i.test(mm[2])) {
        nodes.push(
          <a key={key} href={mm[2]} target="_blank" rel="noopener noreferrer nofollow" className="md-a">
            {mm[1]}
          </a>
        );
      } else {
        nodes.push(mm ? mm[1] : tok);
      }
    } else if (tok.startsWith("**") || tok.startsWith("__")) {
      nodes.push(<strong key={key}>{renderInline(tok.slice(2, -2), key)}</strong>);
    } else {
      nodes.push(<em key={key}>{renderInline(tok.slice(1, -1), key)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

interface Block {
  type: "p" | "h1" | "h2" | "h3" | "h4" | "ul" | "ol";
  lines: string[]; // für Absätze/Überschriften: 1 Eintrag; für Listen: Einträge
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) { blocks.push({ type: "p", lines: [para.join("\n")] }); para = []; }
  };
  for (let raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { flushPara(); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      const lvl = h[1].length as 1 | 2 | 3 | 4;
      blocks.push({ type: (["h1", "h2", "h3", "h4"][lvl - 1] as Block["type"]), lines: [h[2]] });
      continue;
    }
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (ul) {
      flushPara();
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === "ul") prev.lines.push(ul[1]);
      else blocks.push({ type: "ul", lines: [ul[1]] });
      continue;
    }
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      flushPara();
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === "ol") prev.lines.push(ol[1]);
      else blocks.push({ type: "ol", lines: [ol[1]] });
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks;
}

// Absatztext mit einfachen Zeilenumbrüchen zu Knoten (br zwischen Zeilen).
function renderMultiline(text: string, keyBase: string): React.ReactNode[] {
  const parts = text.split("\n");
  const out: React.ReactNode[] = [];
  parts.forEach((p, idx) => {
    if (idx > 0) out.push(<br key={`${keyBase}-br-${idx}`} />);
    out.push(...renderInline(p, `${keyBase}-l${idx}`));
  });
  return out;
}

export default function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = React.useMemo(() => parseBlocks(text || ""), [text]);
  return (
    <div className={"md" + (className ? " " + className : "")}>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        if (b.type === "ul") {
          return (
            <ul key={key} className="md-ul">
              {b.lines.map((li, j) => <li key={j}>{renderInline(li, `${key}-${j}`)}</li>)}
            </ul>
          );
        }
        if (b.type === "ol") {
          return (
            <ol key={key} className="md-ol">
              {b.lines.map((li, j) => <li key={j}>{renderInline(li, `${key}-${j}`)}</li>)}
            </ol>
          );
        }
        if (b.type === "h1") return <div key={key} className="md-h1">{renderInline(b.lines[0], key)}</div>;
        if (b.type === "h2") return <div key={key} className="md-h2">{renderInline(b.lines[0], key)}</div>;
        if (b.type === "h3") return <div key={key} className="md-h3">{renderInline(b.lines[0], key)}</div>;
        if (b.type === "h4") return <div key={key} className="md-h4">{renderInline(b.lines[0], key)}</div>;
        return <p key={key} className="md-p">{renderMultiline(b.lines[0], key)}</p>;
      })}
    </div>
  );
}
