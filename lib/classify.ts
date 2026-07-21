// Regelbasierte Erst-Kategorisierung (schnell, ohne externe Aufrufe).
// Bewusst konservativ. Kann später durch einen LLM-Schritt ersetzt/ergänzt
// werden (dann Status "analyzing" → asynchron aktualisieren).

export interface RawMessage {
  folder: string;
  from_address?: string | null;
  from_name?: string | null;
  subject?: string | null;
  preview?: string | null;
  is_read?: boolean | null;
  importance?: string | null;
  received_at?: string | null;
}

export interface Classification {
  category: string; // sofort | heute | woche | spaeter | warten | info | newsletter
  needs_reply: boolean;
  deadline_at: string | null;
  detected_task: string | null;
  hidden: boolean;
  status: "classified";
}

const AUTOMATED = /(no-?reply|noreply|newsletter|mailer|notifications?|updates?|marketing|do-?not-?reply|mailings?|news@|info@|support@)/i;
const NEWSLETTER_WORDS = /(newsletter|abmelden|unsubscribe|angebot|rabatt|sale|gewinnspiel|jetzt kaufen|deal)/i;
const QUESTION = /\?|kannst du|könntest du|bitte um|rückmeldung|antwort|melde dich|gib bescheid|brauche|benötige|bis wann|zusage|bestätige/i;
const DEADLINE = /(frist|deadline|bis zum|spätestens|fällig|abgabe|termin bis)/i;

// Sehr einfache DE-Datumserkennung: "bis 23.07.", "bis 23.07.2026"
function findDeadline(text: string, base: Date): string | null {
  const m = text.match(/bis\s+(?:zum\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/i);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const mon = parseInt(m[2], 10) - 1;
  let year = m[3] ? parseInt(m[3], 10) : base.getFullYear();
  if (year < 100) year += 2000;
  const d = new Date(year, mon, day, 23, 59, 0);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function classify(msg: RawMessage, now = new Date()): Classification {
  const from = (msg.from_address || "").toLowerCase();
  const hay = `${msg.subject || ""} ${msg.preview || ""}`;
  const isAutomated = AUTOMATED.test(from) || NEWSLETTER_WORDS.test(hay);

  // Gesendete Nachrichten → Kontext "warten auf Antwort"
  if (msg.folder === "sentitems") {
    return { category: "warten", needs_reply: false, deadline_at: null, detected_task: null, hidden: false, status: "classified" };
  }

  if (isAutomated) {
    return { category: "newsletter", needs_reply: false, deadline_at: null, detected_task: null, hidden: true, status: "classified" };
  }

  const deadline = findDeadline(hay, now);
  const asksReply = QUESTION.test(hay) || DEADLINE.test(hay);
  const unread = msg.is_read === false;
  const high = (msg.importance || "").toLowerCase() === "high";

  let category = "info";
  if (asksReply) {
    const soon = deadline ? new Date(deadline).getTime() - now.getTime() < 2 * 864e5 : false;
    if (high || soon) category = "sofort";
    else if (unread) category = "heute";
    else category = "woche";
  } else if (unread && high) {
    category = "heute";
  } else {
    category = "info";
  }

  const task = asksReply ? shorten(msg.subject || "Antworten", 80) : null;

  return {
    category,
    needs_reply: asksReply,
    deadline_at: deadline,
    detected_task: task,
    hidden: false,
    status: "classified"
  };
}

function shorten(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
