"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import Markdown from "@/components/Markdown";
import OverlayScroll from "@/components/OverlayScroll";
import { getAppsCache, getDocsCache, fetchApps, fetchDocs, getAppDetail, fetchAppDetail, prefetchAppDetail, getFactsCache, setFactsCache, fetchFacts, getGenDocsCache, setGenDocsCache } from "@/lib/appsStore";

// ============================ Konstanten ============================
const STATUS: { key: string; label: string; tone: string }[] = [
  { key: "interessant", label: "Interessant", tone: "mid" },
  { key: "analyse_offen", label: "Analyse offen", tone: "mid" },
  { key: "unterlagen", label: "Unterlagen in Vorbereitung", tone: "high" },
  { key: "bereit", label: "Bereit zum Senden", tone: "high" },
  { key: "beworben", label: "Beworben", tone: "accent" },
  { key: "rueckmeldung", label: "Rückmeldung ausstehend", tone: "accent" },
  { key: "gespraech", label: "Vorstellungsgespräch", tone: "low" },
  { key: "zusage", label: "Zusage", tone: "low" },
  { key: "absage", label: "Absage", tone: "urgent" }
];
const statusLabel = (k: string) => STATUS.find((s) => s.key === k)?.label || k;
const statusTone = (k: string) => STATUS.find((s) => s.key === k)?.tone || "mid";

const TONES = ["professionell und natürlich", "selbstbewusst", "zurückhaltend", "persönlich", "kurz und präzise", "formell", "modern"];
const DOC_KINDS: { key: string; label: string }[] = [
  { key: "anschreiben", label: "Anschreiben" },
  { key: "motivation", label: "Motivationsschreiben" },
  { key: "bewerbungsmail", label: "Bewerbungsmail" },
  { key: "kurzprofil", label: "Kurzprofil" },
  { key: "gespraech", label: "Gesprächsvorbereitung" }
];
const REFINE = ["kürzer", "persönlicher", "professioneller", "konkreter", "weniger übertrieben", "stärker auf die Stelle eingehen", "Einleitung neu schreiben", "Schluss neu schreiben"];
const FACT_CATS = ["schule", "abschluss", "note", "praktikum", "erfahrung", "sprache", "projekt", "zertifikat", "sport", "faehigkeit", "sonstiges"];
const JOB_TYPE_LABEL: Record<string, string> = { praktikum: "Praktikum", nebenjob: "Nebenjob", ausbildung: "Ausbildungsplatz", stelle: "Stelle", unbekannt: "Art unklar" };

// Robuster fetch mit Zeitlimit + optionalem Abbruch (kein Endlos-Laden).
async function aj(url: string, opts: { method?: string; body?: any; json?: any; timeoutMs?: number; signal?: AbortSignal } = {}) {
  const { timeoutMs = 45000, signal: ext, json, ...rest } = opts;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const onExt = () => ctrl.abort();
  if (ext) ext.addEventListener("abort", onExt, { once: true });
  try {
    const init: any = { ...rest, signal: ctrl.signal };
    if (json !== undefined) { init.headers = { "content-type": "application/json" }; init.body = JSON.stringify(json); init.method = init.method || "POST"; }
    const r = await fetch(url, init);
    let data: any = {}; try { data = (await r.json()) || {}; } catch {}
    return { ok: r.ok, status: r.status, data, timedOut, aborted: !!(ext?.aborted && !timedOut) };
  } catch (e: any) {
    return { ok: false, status: 0, data: {}, timedOut, aborted: !timedOut };
  } finally { clearTimeout(timer); if (ext) ext.removeEventListener("abort", onExt); }
}
function errText(r: { data: any; timedOut: boolean; aborted: boolean; status: number }, fallback = "Es ist ein Fehler aufgetreten.") {
  if (r.aborted) return "Abgebrochen.";
  if (r.timedOut) return "Die Anfrage hat zu lange gedauert.";
  if (r.status === 0) return "Keine Verbindung zum Server.";
  return r.data?.message || fallback;
}

type Account = { id: string; email: string; provider: string };

// ============================ Hauptkomponente ============================
export default function ApplicationCenter({ accounts, sendEnabled, initialSection, initialOpenId }: { accounts: Account[]; sendEnabled: boolean; initialSection?: string; initialOpenId?: string | null }) {
  const validSection = ["uebersicht", "suche", "neu", "aktiv", "unterlagen", "dokumente"].includes(initialSection || "") ? (initialSection as any) : "uebersicht";
  const [section, setSection] = useState<"uebersicht" | "suche" | "neu" | "aktiv" | "unterlagen" | "dokumente">(validSection);
  // Aus dem seitenübergreifenden Cache initialisieren → sofortige Anzeige, wenn
  // beim Hovern über „Bewerbungen" bereits vorgeladen wurde.
  const [apps, setApps] = useState<any[]>(() => getAppsCache() || []);
  const [docs, setDocs] = useState<any[]>(() => getDocsCache() || []);
  const [openId, setOpenId] = useState<string | null>(initialOpenId || null);
  const [listFilter, setListFilter] = useState<string>("all");
  const [loading, setLoading] = useState(() => getAppsCache() === null || getDocsCache() === null);
  const [diag, setDiag] = useState(false);
  const [mergePrompt, setMergePrompt] = useState<{ newId: string; existing: any } | null>(null);

  const loadApps = useCallback(async () => { setApps(await fetchApps()); }, []);
  const loadDocs = useCallback(async () => { setDocs(await fetchDocs()); }, []);
  // Immer im Hintergrund aktualisieren; blockt aber nicht, wenn schon Cache da ist.
  useEffect(() => { (async () => { await Promise.all([loadApps(), loadDocs()]); setLoading(false); })(); }, [loadApps, loadDocs]);

  const NAV: { key: any; label: string; ic: string }[] = [
    { key: "uebersicht", label: "Übersicht", ic: "◉" },
    { key: "suche", label: "Stellensuche", ic: "🔎" },
    { key: "neu", label: "Neue Stelle", ic: "＋" },
    { key: "aktiv", label: "Aktive Bewerbungen", ic: "▤" },
    { key: "chat", label: "Bewerbungs-Chat", ic: "💬" } as any,
    { key: "unterlagen", label: "Meine Unterlagen", ic: "📎" },
    { key: "dokumente", label: "Erstellte Dokumente", ic: "✍" }
  ];

  function go(key: any) {
    if (key === "chat") {
      const target = openId || (apps[0] && apps[0].id);
      if (target) { setOpenId(target); }
      else { setSection("neu"); }
      return;
    }
    setSection(key); setListFilter("all"); setOpenId(null);
  }
  // Direkte Navigation aus der Mitte (Kachel-Klick).
  function nav(sec: any, filter = "all") { setSection(sec); setListFilter(filter); setOpenId(null); }
  function openApp(id: string) { setOpenId(id); }
  // Nach dem Anlegen: bei erkannter Dublette Auswahl anbieten, sonst öffnen.
  async function handleCreated(id: string, duplicate?: any) {
    await loadApps();
    if (duplicate && duplicate.id && duplicate.id !== id) setMergePrompt({ newId: id, existing: duplicate });
    else setOpenId(id);
  }
  // Fällt der Client in ein Zeitlimit, hat der Server die Bewerbung oft trotzdem
  // angelegt. Dann die Liste neu laden und die gerade erstellte öffnen, statt
  // fälschlich „abgebrochen" zu zeigen.
  async function recoverRecent(): Promise<boolean> {
    const list = await fetchApps(); setApps(list);
    const now = Date.now();
    const recent = list
      .filter((a: any) => a.created_at && now - new Date(a.created_at).getTime() < 120000)
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (recent[0]) { setOpenId(recent[0].id); return true; }
    return false;
  }
  async function doMerge() {
    if (!mergePrompt) return;
    const { newId, existing } = mergePrompt;
    setMergePrompt(null);
    const r = await aj("/api/applications/merge", { json: { targetId: existing.id, sourceId: newId }, timeoutMs: 20000 });
    await loadApps();
    setOpenId(r.ok && r.data.applicationId ? r.data.applicationId : existing.id);
  }

  return (
    <div className={"ac" + (openId ? " ac-workspace-open" : "")}>
      <aside className="ac-side">
        <div className="ac-side-head"><span className="ac-mark" /> Bewerbungen</div>
        <nav className="ac-nav">
          {NAV.map((n) => (
            <button key={n.key} className={"ac-nav-item" + ((!openId && section === n.key) || (openId && n.key === "chat") ? " on" : "")} onClick={() => go(n.key)}>
              <span className="ac-nav-ic">{n.ic}</span><span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="ac-side-foot">
          <button className="ac-diaglink" onClick={() => setDiag(true)}>KI-Diagnose</button>
        </div>
      </aside>

      <main className="ac-main">
        {!loading && !openId && section !== "uebersicht" && (
          <button className="ac-back" title="Zur Bewerbungsübersicht" aria-label="Zur Bewerbungsübersicht" onClick={() => nav("uebersicht")}>
            <span className="ac-back-ic">‹</span><span className="ac-back-l">Übersicht</span>
          </button>
        )}
        {loading ? <div className="ac-empty"><span className="spin" /></div>
          : openId ? <Workspace id={openId} apps={apps} onOpen={openApp} accounts={accounts} sendEnabled={sendEnabled} docs={docs} onBack={() => nav("uebersicht")} onChanged={loadApps} onDeleted={async () => { nav("uebersicht"); await loadApps(); }} onDiag={() => setDiag(true)} />
          : section === "uebersicht" ? <Overview apps={apps} onOpen={openApp} onNav={nav} onNew={() => nav("neu")} />
          : section === "suche" ? <JobSearch onOpenApp={async (id: string) => { await loadApps(); setOpenId(id); }} />
          : section === "neu" ? <NewJob onCreated={handleCreated} onAnalyzeTimeout={recoverRecent} accounts={accounts} />
          : section === "aktiv" ? <AppList apps={apps} filter={listFilter} onFilter={setListFilter} onOpen={openApp} onNew={() => setSection("neu")} onReload={loadApps} />
          : section === "unterlagen" ? <Documents docs={docs} reload={loadDocs} onDiag={() => setDiag(true)} />
          : <GeneratedDocsAll apps={apps} onOpen={openApp} onReloadApps={loadApps} />}
      </main>

      {diag && <DiagModal onClose={() => setDiag(false)} />}
      {mergePrompt && (
        <div className="ac-modal-scrim" onClick={() => { const id = mergePrompt.newId; setMergePrompt(null); setOpenId(id); }}>
          <div className="ac-modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="ac-modal-h"><h3>Gleiche Stelle erkannt</h3></div>
            <div className="ac-modal-b">
              <p style={{ margin: "0 0 10px", fontSize: 14, lineHeight: 1.55 }}>
                Diese Stelle sieht aus wie eine bereits vorhandene Bewerbung:
              </p>
              <div className="ac-note" style={{ marginTop: 0 }}>
                <b>{mergePrompt.existing.position || "Bewerbung"}</b>{mergePrompt.existing.company ? ` · ${mergePrompt.existing.company}` : ""}
              </div>
              <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.55 }}>
                <b>Zusammenführen:</b> behält die vorhandene Bewerbung (inkl. Chat &amp; Dokumenten) und verwirft das Duplikat.<br />
                <b>Beide behalten:</b> legt die neue als eigene Bewerbung an.
              </p>
            </div>
            <div className="ac-modal-f">
              <button className="ac-btn primary" onClick={doMerge}>Zusammenführen</button>
              <button className="ac-btn" onClick={() => { const id = mergePrompt.newId; setMergePrompt(null); setOpenId(id); }}>Beide behalten</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================ Übersicht ============================
function Overview({ apps, onOpen, onNav, onNew }: any) {
  const now = Date.now();
  const active = apps.filter((a: any) => !["absage", "zusage"].includes(a.status));
  const prep = apps.filter((a: any) => ["analyse_offen", "unterlagen", "bereit"].includes(a.status));
  const waiting = apps.filter((a: any) => ["beworben", "rueckmeldung", "gespraech"].includes(a.status));
  const deadlines = apps.filter((a: any) => a.deadline).map((a: any) => ({ a, d: new Date(a.deadline).getTime() }))
    .filter((x: any) => x.d >= now - 864e5).sort((x: any, y: any) => x.d - y.d);
  const last = [...apps].sort((a: any, b: any) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime())[0];
  const nextAction = (() => {
    const bereit = apps.find((a: any) => a.status === "bereit");
    if (bereit) return { t: `„${bereit.position || bereit.company || "Bewerbung"}" ist bereit zum Senden.`, a: bereit };
    const analyse = apps.find((a: any) => a.status === "analyse_offen");
    if (analyse) return { t: `Unterlagen für „${analyse.position || analyse.company}" vorbereiten.`, a: analyse };
    const dl = deadlines[0];
    if (dl) return { t: `Frist für „${dl.a.position || dl.a.company}" am ${new Date(dl.a.deadline).toLocaleDateString("de-DE")}.`, a: dl.a };
    return null;
  })();

  if (!apps.length) {
    return (
      <div className="ac-view">
        <div className="ac-hero">
          <h1>Bewerbungszentrale</h1>
          <p>Dein spezialisierter Arbeitsbereich für Praktika, Nebenjobs, Ausbildung und Stellen. Füge eine Stellenanzeige ein – die KI analysiert sie, und du bekommst pro Stelle ein eigenes Projekt mit Chat, Unterlagen und Dokumenten.</p>
          <button className="ac-btn primary lg" onClick={onNew}>Erste Stelle einfügen</button>
        </div>
      </div>
    );
  }
  return (
    <div className="ac-view">
      <div className="ac-view-head"><h1>Übersicht</h1><button className="ac-btn primary" onClick={onNew}>＋ Neue Stelle</button></div>

      {/* Fokus: primäre Handlung + Fristen */}
      <div className="ac-focus">
        <button className={"ac-primcard" + (nextAction ? "" : " muted")} onClick={() => (nextAction ? onOpen(nextAction.a.id) : onNew())}>
          <div className="ac-primglow" />
          <div className="ac-mod-k light">Nächste sinnvolle Handlung</div>
          <div className="ac-prim-big">{nextAction ? nextAction.t : "Füge eine Stellenanzeige ein – die KI analysiert sie und legt ein Projekt an."}</div>
          <div className="ac-prim-cta">{nextAction ? "Bewerbung öffnen" : "Neue Stelle einfügen"} →</div>
        </button>

        <div className="ac-card ac-deadcard">
          <div className="ac-card-head"><span className="ac-mod-k">Offene Fristen</span>{deadlines.length ? <button className="ac-morelink" onClick={() => onNav("aktiv", "fristen")}>alle →</button> : null}</div>
          {deadlines.length ? (
            <div className="ac-mini-list">
              {deadlines.slice(0, 5).map(({ a, d }: any) => {
                const days = Math.ceil((d - now) / 864e5);
                return <button key={a.id} className="ac-mini" onMouseEnter={() => prefetchAppDetail(a.id)} onClick={() => onOpen(a.id)}>
                  <span className="ac-mini-t">{a.position || a.company || "Bewerbung"}</span>
                  <span className={"ac-mini-b " + (days <= 3 ? "urgent" : days <= 10 ? "high" : "mid")}>{days <= 0 ? "heute" : "in " + days + " T"}</span>
                </button>;
              })}
            </div>
          ) : <div className="ac-mod-empty">Keine offenen Fristen.</div>}
        </div>
      </div>

      {/* Zähl-Kacheln als direkte Einstiege */}
      <div className="ac-stats">
        <button className="ac-stat" onClick={() => onNav("aktiv", "active")}><span className="ac-stat-num">{active.length}</span><span className="ac-stat-l">Aktive Bewerbungen</span></button>
        <button className="ac-stat" onClick={() => onNav("aktiv", "prep")}><span className="ac-stat-num high">{prep.length}</span><span className="ac-stat-l">In Vorbereitung</span></button>
        <button className="ac-stat" onClick={() => onNav("aktiv", "waiting")}><span className="ac-stat-num accent">{waiting.length}</span><span className="ac-stat-l">Warte auf Antwort</span></button>
      </div>

      {/* Schnell-Einstiege */}
      <div className="ac-quick">
        <button className="ac-qtile accent" onClick={onNew}><span className="ac-qic">＋</span><span className="ac-qt">Neue Stelle</span><span className="ac-qs">Link, Text, PDF oder Screenshot</span></button>
        {last && <button className="ac-qtile" onClick={() => onOpen(last.id)}><span className="ac-qic">🕘</span><span className="ac-qt">Zuletzt bearbeitet</span><span className="ac-qs">{last.position || last.company || "Bewerbung"}</span></button>}
        <button className="ac-qtile" onClick={() => onNav("aktiv", "all")}><span className="ac-qic">▤</span><span className="ac-qt">Aktive Bewerbungen</span><span className="ac-qs">{apps.length} {apps.length === 1 ? "Projekt" : "Projekte"}</span></button>
        <button className="ac-qtile" onClick={() => onNav("unterlagen")}><span className="ac-qic">📎</span><span className="ac-qt">Meine Unterlagen</span><span className="ac-qs">Lebenslauf, Zeugnisse, Zertifikate</span></button>
        <button className="ac-qtile" onClick={() => onNav("dokumente")}><span className="ac-qic">✍</span><span className="ac-qt">Erstellte Dokumente</span><span className="ac-qs">Anschreiben, Mails, Kurzprofil</span></button>
      </div>
    </div>
  );
}

// ============================ Neue Stelle ============================
function NewJob({ onCreated, onAnalyzeTimeout, accounts }: any) {
  const [mode, setMode] = useState<"stelle" | "website">("stelle");
  const [tab, setTab] = useState<"url" | "text" | "datei" | "email">("url");
  const [url, setUrl] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function analyzeWebsite() {
    if (!siteUrl.trim() || busy) return;
    setBusy(true); setError(null);
    const ctrl = new AbortController(); ctrlRef.current = ctrl;
    const r = await aj("/api/applications/analyze-website", { json: { url: siteUrl.trim() }, timeoutMs: 100000, signal: ctrl.signal });
    setBusy(false);
    if (r.ok) { onCreated(r.data.applicationId, r.data.duplicate); return; }
    if (r.timedOut && onAnalyzeTimeout && await onAnalyzeTimeout()) return;
    setError(errText(r, "Die Website konnte nicht analysiert werden."));
  }

  async function analyzeJson(payload: any) {
    setBusy(true); setError(null);
    const ctrl = new AbortController(); ctrlRef.current = ctrl;
    const r = await aj("/api/applications/analyze", { json: payload, timeoutMs: 100000, signal: ctrl.signal });
    setBusy(false);
    if (r.ok) { onCreated(r.data.applicationId, r.data.duplicate); return; }
    if (r.timedOut && onAnalyzeTimeout && await onAnalyzeTimeout()) return;
    if (r.data?.error === "fetch_failed") setShowFallback(true);
    setError(errText(r, "Die Stellenanzeige konnte nicht verarbeitet werden."));
  }
  async function analyzeFile(file: File) {
    setBusy(true); setError(null);
    const ctrl = new AbortController(); ctrlRef.current = ctrl;
    const fd = new FormData(); fd.append("file", file); fd.append("mode", "datei");
    const r = await aj("/api/applications/analyze", { method: "POST", body: fd, timeoutMs: 100000, signal: ctrl.signal });
    setBusy(false);
    if (r.ok) { onCreated(r.data.applicationId, r.data.duplicate); return; }
    if (r.timedOut && onAnalyzeTimeout && await onAnalyzeTimeout()) return;
    setError(errText(r, "Die Datei konnte nicht verarbeitet werden."));
  }

  return (
    <div className="ac-view">
      <div className="ac-view-head"><h1>Neue Bewerbung</h1></div>
      <div className="ac-modeswitch">
        <button className={"ac-modebtn" + (mode === "stelle" ? " on" : "")} onClick={() => { setMode("stelle"); setError(null); }}>
          <span className="ac-modebtn-t">Stellenangebot hinzufügen</span>
          <span className="ac-modebtn-s">Link, Text, PDF/Screenshot oder E-Mail</span>
        </button>
        <button className={"ac-modebtn" + (mode === "website" ? " on" : "")} onClick={() => { setMode("website"); setError(null); }}>
          <span className="ac-modebtn-t">Unternehmenswebsite analysieren</span>
          <span className="ac-modebtn-s">Initiativbewerbung ohne ausgeschriebene Stelle</span>
        </button>
      </div>

      {mode === "website" ? (
        <div className="ac-card ac-import">
          <label className="ac-label">Link zur Unternehmenswebsite</label>
          <div className="ac-import-row">
            <input className="ac-input" placeholder="z. B. www.unternehmen.de" value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)} disabled={busy} onKeyDown={(e) => { if (e.key === "Enter" && siteUrl.trim()) analyzeWebsite(); }} />
            <button className="ac-btn primary" disabled={busy || !siteUrl.trim()} onClick={analyzeWebsite}>
              {busy ? <><span className="spin" /> Analysiere…</> : "Analysieren"}
            </button>
            {busy && <button className="ac-btn" onClick={() => ctrlRef.current?.abort()}>Abbrechen</button>}
          </div>
          <div className="ac-hint">Ich sehe mir die Startseite und relevante Unterseiten an (Über uns, Leistungen, Karriere, Team, Werte, Standorte, Projekte), erstelle eine kurze Unternehmensanalyse und passende Bewerbungsargumente – und stelle dir im Chat gezielte Rückfragen. Danach kannst du wie gewohnt eine Initiativbewerbung erstellen. Es werden nur bestätigte Profil-Fakten und echte Website-Inhalte genutzt – nichts erfunden.</div>
          {busy && <div className="ac-hint" style={{ marginTop: 8 }}>Das kann bei mehreren Unterseiten einen Moment dauern…</div>}
          {error && <div className="ac-note bad">{error}</div>}
        </div>
      ) : (
      <div className="ac-card ac-import">
        <label className="ac-label">Link zur Stellenanzeige einfügen</label>
        <div className="ac-import-row">
          <input className="ac-input" placeholder="https://… (StepStone, Unternehmensseite, Praktikumsplattform)" value={url}
            onChange={(e) => setUrl(e.target.value)} disabled={busy} onKeyDown={(e) => { if (e.key === "Enter" && url.trim()) analyzeJson({ mode: "url", url: url.trim() }); }} />
          <button className="ac-btn primary" disabled={busy || !url.trim()} onClick={() => analyzeJson({ mode: "url", url: url.trim() })}>
            {busy ? <><span className="spin" /> Analysiere…</> : "Analysieren"}
          </button>
          {busy && <button className="ac-btn" onClick={() => ctrlRef.current?.abort()}>Abbrechen</button>}
        </div>
        <div className="ac-hint">Kann die Seite nicht automatisch gelesen werden, nutze eine der Alternativen unten.</div>

        <div className={"ac-tabs" + (showFallback ? " ac-tabs-glow" : "")}>
          {(["text", "datei", "email"] as const).map((t) => (
            <button key={t} className={"ac-tab" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>
              {t === "text" ? "Text einfügen" : t === "datei" ? "PDF/Screenshot" : "E-Mail übernehmen"}
            </button>
          ))}
        </div>

        {tab === "text" && (
          <div className="ac-fallback">
            <textarea className="ac-textarea" placeholder="Text der Stellenanzeige hier einfügen…" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
            <button className="ac-btn primary" disabled={busy || text.trim().length < 40} onClick={() => analyzeJson({ mode: "text", text })}>{busy ? <><span className="spin" /> Analysiere…</> : "Text analysieren"}</button>
          </div>
        )}
        {tab === "datei" && (
          <div className="ac-fallback">
            <input ref={fileRef} type="file" accept=".pdf,image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) analyzeFile(f); e.currentTarget.value = ""; }} />
            <button className="ac-drop" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? <><span className="spin" /> Analysiere…</> : "PDF oder Screenshot hochladen"}
            </button>
            <div className="ac-hint">PDF wird ausgelesen, Screenshots werden per Bilderkennung analysiert.</div>
          </div>
        )}
        {tab === "email" && (
          <div className="ac-fallback">
            <div className="ac-hint">E-Mail-Übernahme: Öffne im E-Mail-Bereich die betreffende Nachricht und wähle dort künftig „Als Stelle übernehmen". Alternativ Text der Mail hier einfügen.</div>
          </div>
        )}

        {error && <div className="ac-note bad">{error}</div>}
      </div>
      )}
    </div>
  );
}

// ============================ Bewerbungsliste (gefiltert) ============================
const LIST_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "active", label: "Aktiv" },
  { key: "prep", label: "In Vorbereitung" },
  { key: "waiting", label: "Warte auf Antwort" },
  { key: "fristen", label: "Mit Frist" }
];
function AppList({ apps, filter = "all", onFilter, onOpen, onNew, onReload }: any) {
  const [busyId, setBusyId] = useState<string | null>(null);
  function match(a: any) {
    if (filter === "active") return !["absage", "zusage"].includes(a.status);
    if (filter === "prep") return ["analyse_offen", "unterlagen", "bereit"].includes(a.status);
    if (filter === "waiting") return ["beworben", "rueckmeldung", "gespraech"].includes(a.status);
    if (filter === "fristen") return !!a.deadline;
    return true;
  }
  let items = apps.filter(match);
  if (filter === "fristen") items = [...items].sort((a: any, b: any) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
  const title = LIST_FILTERS.find((f) => f.key === filter)?.label === "Alle" ? "Bewerbungen" : (LIST_FILTERS.find((f) => f.key === filter)?.label || "Bewerbungen");

  async function del(id: string, e: any) {
    e.stopPropagation();
    if (!confirm("Diese Bewerbung inklusive Chat, Analyse, zugeordneten Unterlagen und erstellten Dokumenten wirklich vollständig löschen? Das kann nicht rückgängig gemacht werden.")) return;
    setBusyId(id);
    await aj(`/api/applications/${id}`, { method: "DELETE" });
    setBusyId(null); await onReload();
  }

  return (
    <div className="ac-view">
      <div className="ac-view-head"><h1>{title}</h1><button className="ac-btn primary" onClick={onNew}>＋ Neue Stelle</button></div>
      <div className="ac-filterbar">
        {LIST_FILTERS.map((f) => <button key={f.key} className={"ac-fchip" + (filter === f.key ? " on" : "")} onClick={() => onFilter && onFilter(f.key)}>{f.label}</button>)}
      </div>
      {!items.length ? <div className="ac-card ac-empty2">Keine Bewerbungen in dieser Ansicht. {filter !== "all" && <button className="ac-diaglink" onClick={() => onFilter && onFilter("all")}>Alle anzeigen</button>}</div> : (
        <div className="ac-list">
          {items.map((a: any) => (
            <div key={a.id} className="ac-row" onMouseEnter={() => prefetchAppDetail(a.id)} onClick={() => onOpen(a.id)}>
              <div className="ac-row-main">
                <div className="ac-row-title">{a.position || "Unbenannte Stelle"}{a.job_type ? <span className="ac-tag">{JOB_TYPE_LABEL[a.job_type] || a.job_type}</span> : null}</div>
                <div className="ac-row-sub">{a.company || "—"}{a.deadline ? ` · Frist ${new Date(a.deadline).toLocaleDateString("de-DE")}` : ""}</div>
              </div>
              <span className={"ac-badge " + statusTone(a.status)}>{statusLabel(a.status)}</span>
              <div className="ac-row-actions" onClick={(e) => e.stopPropagation()}>
                <button className="ac-btn sm" onClick={() => onOpen(a.id)}>Öffnen</button>
                <button className="ac-iconbtn danger" disabled={busyId === a.id} title="Bewerbung löschen" onClick={(e) => del(a.id, e)}>{busyId === a.id ? "…" : "🗑"}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================ Erstellte Dokumente (alle) ============================
function GeneratedDocsAll({ apps, onOpen }: any) {
  // Aus dem Cache initialisieren → nicht bei jedem Öffnen komplett neu laden.
  const [docs, setDocs] = useState<any[] | null>(() => getGenDocsCache());
  const load = useCallback(async () => {
    const all: any[] = [];
    // Detailabrufe laufen über den Cache (fetchAppDetail) und parallel.
    const results = await Promise.all(apps.map((a: any) => fetchAppDetail(a.id).then((data: any) => ({ a, data }))));
    for (const { a, data } of results) {
      if (data) (data.generatedDocs || []).forEach((d: any) => all.push({ ...d, app: a }));
    }
    all.sort((x, y) => new Date(y.updated_at).getTime() - new Date(x.updated_at).getTime());
    setDocs(all); setGenDocsCache(all);
  }, [apps]);
  useEffect(() => { load(); }, [load]);

  async function del(id: string, e: any) {
    e.stopPropagation();
    if (!confirm("Dieses erstellte Dokument löschen?")) return;
    await aj(`/api/applications/doc/${id}`, { method: "DELETE" });
    await load();
  }
  return (
    <div className="ac-view">
      <div className="ac-view-head"><h1>Erstellte Dokumente</h1></div>
      {docs === null ? <div className="ac-empty"><span className="spin" /></div>
        : !docs.length ? <div className="ac-card ac-empty2">Noch keine Dokumente erstellt. Öffne eine Bewerbung und erstelle im rechten Bereich z. B. ein Anschreiben.</div>
        : <div className="ac-list">
            {docs.map((d) => (
              <div key={d.id} className="ac-row" onClick={() => onOpen(d.app.id)}>
                <div className="ac-row-main">
                  <div className="ac-row-title">{d.title || DOC_KINDS.find((k) => k.key === d.kind)?.label || d.kind}</div>
                  <div className="ac-row-sub">{d.app.position || d.app.company || "Bewerbung"} · {new Date(d.updated_at).toLocaleDateString("de-DE")}</div>
                </div>
                <div className="ac-row-actions" onClick={(e) => e.stopPropagation()}>
                  <a className="ac-btn sm" href={`/api/applications/doc/${d.id}?format=docx`} target="_blank" rel="noreferrer">DOCX</a>
                  <button className="ac-btn sm" onClick={() => onOpen(d.app.id)}>Öffnen</button>
                  <button className="ac-iconbtn danger" title="Dokument löschen" onClick={(e) => del(d.id, e)}>🗑</button>
                </div>
              </div>
            ))}
          </div>}
    </div>
  );
}

// Stellensuche: echte Jobs/Praktika/Ausbildung (Bundesagentur für Arbeit),
// optional per KI auf die bestätigten Profil-Fakten zugeschnitten.
function JobSearch({ onOpenApp }: any) {
  const [was, setWas] = useState("");
  const [wo, setWo] = useState("");
  const [umkreis, setUmkreis] = useState("25");
  const [art, setArt] = useState("");
  const [tailor, setTailor] = useState(true);
  const [jobs, setJobs] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tailored, setTailored] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  const ART_ENUM: Record<string, string> = { "1": "stelle", "4": "ausbildung", "34": "praktikum" };

  async function search() {
    if (loading) return;
    setLoading(true); setError(null);
    const r = await aj("/api/applications/job-search", { json: { was, wo, umkreis, angebotsart: art, page: 1, tailor }, timeoutMs: 60000 });
    setLoading(false);
    if (r.ok) { setJobs(r.data.jobs || []); setTotal(r.data.total || 0); setTailored(!!r.data.tailored); }
    else { setJobs([]); setError(errText(r, "Suche fehlgeschlagen.")); }
  }

  async function take(job: any) {
    if (creating) return;
    setCreating(job.id);
    const r = await aj("/api/applications", { json: {
      company: job.employer, position: job.title, status: "interessant",
      job_url: job.url, job_source: "url", job_type: ART_ENUM[art] || "unbekannt"
    }, timeoutMs: 20000 });
    setCreating(null);
    if (r.ok && r.data.application) onOpenApp(r.data.application.id);
    else setError(errText(r, "Konnte nicht übernommen werden."));
  }

  return (
    <div className="ac-view">
      <div className="ac-view-head"><h1>Stellensuche</h1></div>
      <div className="ac-hint" style={{ marginBottom: 14 }}>Echte Stellen, Praktika und Ausbildungsplätze (Quelle: Bundesagentur für Arbeit). Mit „Auf mein Profil zuschneiden" nutze ich deine <b>bestätigten</b> Fakten, um die passendsten Treffer nach oben zu sortieren.</div>
      <div className="ac-search-bar">
        <input className="ac-input" placeholder="Beruf / Suchbegriff (z. B. Praktikum Informatik)" value={was} onChange={(e) => setWas(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }} />
        <input className="ac-input" placeholder="Ort (z. B. Hamburg)" value={wo} onChange={(e) => setWo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }} />
        <select className="ac-select" value={art} onChange={(e) => setArt(e.target.value)}>
          <option value="">Alle Arten</option>
          <option value="34">Praktikum</option>
          <option value="4">Ausbildung</option>
          <option value="1">Stelle / Job</option>
        </select>
        <select className="ac-select" value={umkreis} onChange={(e) => setUmkreis(e.target.value)}>
          {["10", "25", "50", "100", "200"].map((u) => <option key={u} value={u}>+{u} km</option>)}
        </select>
        <button className="ac-btn primary" disabled={loading} onClick={search}>{loading ? <><span className="spin" /> Suche…</> : "Suchen"}</button>
      </div>
      <label className="ac-search-tailor"><input type="checkbox" checked={tailor} onChange={(e) => setTailor(e.target.checked)} /> Auf mein Profil zuschneiden</label>

      {error && <div className="ac-note bad" style={{ marginTop: 12 }}>{error}</div>}
      {jobs !== null && !loading && <div className="ac-search-meta">{total > 0 ? `${total} Treffer` : "Keine passenden Stellen gefunden – Suchbegriff/Ort anpassen."}{tailored ? " · nach Passung zu deinem Profil sortiert" : ""}</div>}

      {loading && jobs === null ? <div className="ac-empty"><span className="spin" /></div> : jobs && jobs.length > 0 && (
        <div className="ac-list" style={{ marginTop: 6 }}>
          {jobs.map((j) => (
            <div key={j.id} className="ac-jobresult">
              <div className="ac-row-main">
                <div className="ac-row-title">{j.title}{j.reason && <span className="ac-jobfit">✓ {j.reason}</span>}</div>
                <div className="ac-row-sub">{j.employer} · {j.location}{j.date ? ` · ${new Date(j.date).toLocaleDateString("de-DE")}` : ""} · {j.type}</div>
              </div>
              <div className="ac-row-actions">
                <a className="ac-btn sm" href={j.url} target="_blank" rel="noreferrer">Ansehen ↗</a>
                <button className="ac-btn sm primary" disabled={creating === j.id} onClick={() => take(j)}>{creating === j.id ? "…" : "Übernehmen"}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const FACT_CAT_LABEL: Record<string, string> = {
  schule: "Schule", abschluss: "Abschluss", note: "Noten", praktikum: "Praktika", erfahrung: "Erfahrungen",
  sprache: "Sprachkenntnisse", projekt: "Projekte", zertifikat: "Zertifikate", sport: "Sport", faehigkeit: "Fähigkeiten", sonstiges: "Sonstiges"
};

// Zentrale, bearbeitbare Übersicht aller Fakten, die die App über den Nutzer kennt.
function MyFacts() {
  // Aus dem Cache initialisieren → keine leere/neu ladende Ansicht bei jedem Öffnen.
  const [facts, setFacts] = useState<any[] | null>(() => getFactsCache());
  const [addCat, setAddCat] = useState("faehigkeit");
  const [addVal, setAddVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const didInit = useRef(false);
  const load = useCallback(async () => { setFacts(await fetchFacts()); }, []);
  useEffect(() => { load(); }, [load]);
  // Änderungen (Bearbeiten/Bestätigen/Löschen/Hinzufügen) im Cache spiegeln.
  useEffect(() => { if (facts) setFactsCache(facts); }, [facts]);

  async function patch(id: string, patch: any) {
    setFacts((fs) => (fs || []).map((f) => f.id === id ? { ...f, ...patch } : f));
    await aj("/api/documents/facts", { method: "PATCH", json: { id, ...patch } });
  }
  async function del(id: string) { setFacts((fs) => (fs || []).filter((f) => f.id !== id)); await aj("/api/documents/facts", { method: "DELETE", json: { id } }); }
  async function add() {
    if (!addVal.trim()) return; setBusy(true);
    const r = await aj("/api/documents/facts", { method: "POST", json: { category: addCat, value: addVal } });
    setBusy(false);
    if (r.ok && r.data.fact) { setFacts((fs) => [...(fs || []), r.data.fact]); setAddVal(""); setOpen((o) => ({ ...o, [addCat]: true })); }
  }

  const cats = Object.keys(FACT_CAT_LABEL);
  const byCat: Record<string, any[]> = {};
  for (const f of facts || []) (byCat[f.category] ||= []).push(f);
  const shownCats = cats.filter((c) => byCat[c]?.length);
  const total = facts?.length || 0;
  const confirmed = (facts || []).filter((f) => f.status === "bestaetigt").length;
  const openCount = total - confirmed;

  // Beim ersten Laden: Gruppen mit offenen (unbestätigten) Angaben aufklappen,
  // damit man sofort sieht, was noch Aufmerksamkeit braucht; Rest bleibt kompakt.
  useEffect(() => {
    if (didInit.current || facts === null) return;
    didInit.current = true;
    const init: Record<string, boolean> = {};
    for (const c of shownCats) init[c] = byCat[c].some((f) => f.status !== "bestaetigt");
    setOpen(init);
  }, [facts, shownCats, byCat]);

  return (
    <div className="ac-card ac-myfacts">
      <div className="ac-panel-h" style={{ position: "static" }}>Was das Cockpit über dich weiß</div>
      <div className="ac-hint" style={{ marginTop: 0, marginBottom: 12 }}>Alle erkannten und selbst ergänzten Angaben, nach Bereich gegliedert. Tippe auf einen Bereich zum Auf- und Zuklappen. <b>Nur bestätigte</b> Fakten werden in Bewerbungen verwendet.</div>
      {facts === null ? <div className="ac-empty"><span className="spin" /></div> : (
        <>
          {total > 0 && (
            <div className="ac-facts-summary">
              <span className="ac-facts-stat"><b>{total}</b> Angaben</span>
              <span className="ac-facts-stat ok"><b>{confirmed}</b> bestätigt</span>
              {openCount > 0 && <span className="ac-facts-stat todo"><b>{openCount}</b> offen</span>}
              <button className="ac-facts-toggleall" onClick={() => { const allOpen = shownCats.every((c) => open[c]); const next: Record<string, boolean> = {}; for (const c of shownCats) next[c] = !allOpen; setOpen(next); }}>
                {shownCats.every((c) => open[c]) ? "Alle zuklappen" : "Alle aufklappen"}
              </button>
            </div>
          )}
          {!facts.length && <div className="ac-mod-empty">Noch keine Fakten. Lade Unterlagen hoch und nutze „Fakten erkennen" – oder ergänze unten selbst.</div>}
          {shownCats.map((c) => {
            const items = byCat[c];
            const off = items.filter((f) => f.status !== "bestaetigt").length;
            const isOpen = !!open[c];
            return (
              <div key={c} className={"ac-fact-group" + (isOpen ? " open" : "")}>
                <button className="ac-fact-grouphead" onClick={() => setOpen((o) => ({ ...o, [c]: !o[c] }))}>
                  <span className={"ac-fact-chev" + (isOpen ? " open" : "")}>›</span>
                  <span className="ac-fact-grouptitle">{FACT_CAT_LABEL[c]}</span>
                  <span className="ac-fact-groupcount">{items.length}</span>
                  {off > 0 && <span className="ac-fact-groupoffen">{off} offen</span>}
                </button>
                {isOpen && (
                  <div className="ac-fact-groupbody">
                    {items.map((f) => (
                      <div key={f.id} className={"ac-fact " + (f.status === "bestaetigt" ? "ok" : f.status === "abgelehnt" ? "" : "offen")}>
                        <input className="ac-fact-input" defaultValue={f.value} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== f.value) patch(f.id, { value: e.target.value }); }} />
                        {f.status !== "bestaetigt"
                          ? <button className="ac-fact-badge todo" onClick={() => patch(f.id, { status: "bestaetigt" })} title="Bestätigen">✓ bestätigen</button>
                          : <span className="ac-fact-badge done">bestätigt</span>}
                        <button className="ac-fact-del" onClick={() => del(f.id)} title="Löschen">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {adding ? (
            <div className="ac-fact-add" style={{ marginTop: 14 }}>
              <select className="ac-select sm" value={addCat} onChange={(e) => setAddCat(e.target.value)}>{cats.map((c) => <option key={c} value={c}>{FACT_CAT_LABEL[c]}</option>)}</select>
              <input className="ac-input sm" placeholder="Eigene Angabe ergänzen…" value={addVal} autoFocus onChange={(e) => setAddVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
              <button className="ac-btn sm primary" disabled={busy || !addVal.trim()} onClick={add}>Hinzufügen</button>
              <button className="ac-btn sm" onClick={() => { setAdding(false); setAddVal(""); }}>Abbrechen</button>
            </div>
          ) : (
            <button className="ac-facts-addbtn" onClick={() => setAdding(true)}>+ Eigene Angabe ergänzen</button>
          )}
        </>
      )}
    </div>
  );
}

// Chat über die eigenen Unterlagen (Erklärungen geben, Rückfragen beantworten).
function DocumentsChat({ onDiag }: any) {
  const [msgs, setMsgs] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const initScrolled = useRef(false);
  useEffect(() => { aj("/api/documents/chat", { timeoutMs: 15000 }).then((r) => { if (r.ok) setMsgs(r.data.messages || []); }); }, []);
  // Beim ersten Anzeigen sofort ganz nach unten springen (ohne Animation),
  // danach neue Nachrichten sanft einscrollen. Der erste Sprung zählt erst,
  // wenn tatsächlich Nachrichten geladen sind (sonst animiert das Nachladen).
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: initScrolled.current ? "smooth" : "auto" }); if (msgs.length) initScrolled.current = true; }, [msgs, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setError(null); setInput("");
    const hist = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { id: "u" + Date.now(), role: "user", content: text }]);
    setBusy(true);
    const ctrl = new AbortController(); ctrlRef.current = ctrl;
    const r = await aj("/api/documents/chat", { json: { message: text, history: hist }, timeoutMs: 60000, signal: ctrl.signal });
    setBusy(false);
    if (r.ok) setMsgs((m) => [...m, r.data.message]);
    else setError(errText(r, "Antwort konnte nicht erstellt werden."));
  }
  const suggestions = ["Was steht in meinen Zeugnissen?", "Welche Fähigkeiten kannst du belegen?", "Ich habe mein Praktikum bei X gemacht, nicht Y – merke dir das.", "Welche Angaben fehlen dir noch von mir?"];

  return (
    <div className="ac-card ac-docchat">
      <div className="ac-panel-h" style={{ position: "static" }}>Unterlagen-Chat</div>
      <div className="ac-hint" style={{ marginTop: 0, marginBottom: 10 }}>Frag zu deinen Dokumenten, korrigiere Missverständnisse oder beantworte Rückfragen der KI. Die KI nutzt nur deine hochgeladenen Unterlagen.</div>
      <div className="ac-docchat-scroll">
        {!msgs.length && <div className="ac-suggests">{suggestions.map((s) => <button key={s} className="ac-suggest" onClick={() => send(s)}>{s}</button>)}</div>}
        {msgs.map((m) => <div key={m.id} className={"ac-msg " + m.role}><div className="ac-msg-b">{m.role === "assistant" ? <Markdown text={m.content} /> : m.content}</div></div>)}
        {busy && <div className="ac-msg assistant"><div className="ac-msg-b"><span className="spin" /> denkt nach…{ctrlRef.current && <button className="ac-diaglink" onClick={() => ctrlRef.current?.abort()}>Abbrechen</button>}</div></div>}
        <div ref={endRef} />
      </div>
      {error && <div className="ac-note bad">{error} {onDiag && <button className="ac-diaglink" onClick={onDiag}>Diagnose</button>}</div>}
      <div className="ac-chat-input" style={{ position: "static" }}>
        <textarea className="ac-chat-ta" placeholder="Nachricht an den Unterlagen-Chat…" value={input} disabled={busy}
          onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
        <button className="ac-btn primary" disabled={busy || !input.trim()} onClick={() => send(input)}>Senden</button>
      </div>
    </div>
  );
}

// ============================ Meine Unterlagen ============================
function Documents({ docs, reload, onDiag }: any) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(files: FileList) {
    setError(null);
    for (const file of Array.from(files)) {
      setBusy(true);
      const fd = new FormData(); fd.append("file", file);
      const r = await aj("/api/documents", { method: "POST", body: fd, timeoutMs: 60000 });
      if (!r.ok) setError(errText(r, "Upload fehlgeschlagen."));
    }
    setBusy(false); await reload();
  }

  return (
    <div className="ac-view">
      <div className="ac-view-head"><h1>Meine Unterlagen</h1>
        <div className="ac-row-actions">
          <button className={"ac-btn" + (chatOpen ? " primary" : "")} onClick={() => setChatOpen((v) => !v)}>💬 Unterlagen-Chat</button>
          <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt,image/*" hidden onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.currentTarget.value = ""; }} />
          <button className="ac-btn primary" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <><span className="spin" /> Lädt…</> : "＋ Hochladen"}</button>
        </div>
      </div>
      <div className="ac-hint">Privat gespeichert (kein öffentlicher Link). Unterstützt PDF, DOCX, TXT und Bilder. Die KI erkennt Fakten – nur von dir <b>bestätigte</b> Fakten werden in Bewerbungen verwendet.</div>
      {chatOpen && <DocumentsChat onDiag={onDiag} />}
      <MyFacts />
      {error && <div className="ac-note bad">{error}</div>}
      {!docs.length ? <div className="ac-card ac-empty2">Noch keine Unterlagen. Lade Lebenslauf, Zeugnisse, Zertifikate usw. hoch.</div> : (
        <div className="ac-doc-grid">
          {docs.map((d: any) => (
            <div key={d.id} className={"ac-doc" + (openId === d.id ? " on" : "")}>
              <div className="ac-doc-head" onClick={() => setOpenId(openId === d.id ? null : d.id)}>
                <span className="ac-doc-ic">{/(png|jpe?g|webp|gif)/i.test(d.mime || "") ? "🖼" : d.mime?.includes("pdf") ? "📄" : "📝"}</span>
                <div className="ac-doc-main">
                  <div className="ac-doc-name">{d.name}</div>
                  <div className="ac-doc-sub">{d.doc_type || "sonstiges"} · {new Date(d.created_at).toLocaleDateString("de-DE")} · <span className={"ac-dot " + (d.processing_status === "verarbeitet" ? "ok" : d.processing_status === "fehler" ? "bad" : "wait")} />{d.processing_status}</div>
                </div>
                <div className="ac-doc-badges">
                  {d.factCounts?.bestaetigt ? <span className="ac-badge low">{d.factCounts.bestaetigt} bestätigt</span> : null}
                  {d.factCounts?.offen ? <span className="ac-badge high">{d.factCounts.offen} offen</span> : null}
                </div>
              </div>
              {openId === d.id && <DocDetail doc={d} reload={reload} onDiag={onDiag} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DocDetail({ doc, reload, onDiag }: any) {
  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addCat, setAddCat] = useState("faehigkeit");
  const [addVal, setAddVal] = useState("");
  const replaceRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await aj(`/api/documents/${doc.id}`, { timeoutMs: 20000 });
    if (r.ok) setDetail(r.data);
  }, [doc.id]);
  useEffect(() => { load(); }, [load]);

  async function factAction(payload: any) {
    const r = await aj(`/api/documents/${doc.id}/facts`, { json: payload, timeoutMs: 50000 });
    if (!r.ok) { setError(errText(r, "Aktion fehlgeschlagen.")); return false; }
    await load(); await reload(); return true;
  }
  async function extract() { setBusy(true); setError(null); const ok = await factAction({ action: "extract" }); setBusy(false); }
  async function rename() {
    const name = prompt("Neuer Name:", doc.name); if (name == null) return;
    await aj(`/api/documents/${doc.id}`, { method: "PATCH", json: { name } }); await reload();
  }
  async function setAllowed(v: boolean) { await aj(`/api/documents/${doc.id}`, { method: "PATCH", json: { allowed_for_applications: v } }); await reload(); }
  async function del() { if (!confirm("Dieses Dokument wirklich löschen?")) return; await aj(`/api/documents/${doc.id}`, { method: "DELETE" }); await reload(); }
  async function replace(file: File) { setBusy(true); const fd = new FormData(); fd.append("file", file); const r = await aj(`/api/documents/${doc.id}`, { method: "PUT", body: fd, timeoutMs: 60000 }); setBusy(false); if (r.ok) { await load(); await reload(); } else setError(errText(r)); }

  const facts = detail?.facts || [];
  const offen = facts.filter((f: any) => f.status === "offen");
  const bestaetigt = facts.filter((f: any) => f.status === "bestaetigt");

  return (
    <div className="ac-doc-detail">
      <div className="ac-doc-tools">
        <input ref={replaceRef} type="file" hidden accept=".pdf,.docx,.txt,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) replace(f); e.currentTarget.value = ""; }} />
        {detail?.previewUrl && <a className="ac-btn sm" href={detail.previewUrl} target="_blank" rel="noreferrer">Vorschau</a>}
        <button className="ac-btn sm" onClick={rename}>Umbenennen</button>
        <button className="ac-btn sm" onClick={() => replaceRef.current?.click()}>Ersetzen</button>
        <button className="ac-btn sm" onClick={() => setAllowed(!doc.allowed_for_applications)}>{doc.allowed_for_applications ? "Für Bewerbungen: an" : "Für Bewerbungen: aus"}</button>
        <button className="ac-btn sm danger" onClick={del}>Löschen</button>
        <button className="ac-btn sm primary" disabled={busy} onClick={extract}>{busy ? <><span className="spin" /> Erkenne…</> : "Fakten erkennen"}</button>
      </div>
      {error && <div className="ac-note bad">{error} <button className="ac-diaglink" onClick={onDiag}>Diagnose</button></div>}

      {!!offen.length && <>
        <div className="ac-label sm">Zur Bestätigung erkannt (KI) – bitte prüfen</div>
        <div className="ac-facts">
          {offen.map((f: any) => (
            <div key={f.id} className="ac-fact offen">
              <span className="ac-fact-cat">{f.category}</span><span className="ac-fact-val">{f.value}</span>
              <span className="ac-fact-act">
                <button title="Bestätigen" onClick={() => factAction({ action: "confirm", factId: f.id })}>✓</button>
                <button title="Löschen" onClick={() => factAction({ action: "delete", factId: f.id })}>✕</button>
              </span>
            </div>
          ))}
        </div>
      </>}

      <div className="ac-label sm">Bestätigte Fakten (nur diese werden in Bewerbungen genutzt)</div>
      <div className="ac-facts">
        {bestaetigt.map((f: any) => (
          <div key={f.id} className="ac-fact ok">
            <span className="ac-fact-cat">{f.category}</span><span className="ac-fact-val">{f.value}</span>
            <span className="ac-fact-act"><button title="Entfernen" onClick={() => factAction({ action: "delete", factId: f.id })}>✕</button></span>
          </div>
        ))}
        {!bestaetigt.length && <div className="ac-mod-empty">Noch keine bestätigten Fakten.</div>}
      </div>
      <div className="ac-fact-add">
        <select className="ac-select sm" value={addCat} onChange={(e) => setAddCat(e.target.value)}>{FACT_CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <input className="ac-input sm" placeholder="Eigenen Fakt ergänzen…" value={addVal} onChange={(e) => setAddVal(e.target.value)} />
        <button className="ac-btn sm" disabled={!addVal.trim()} onClick={async () => { if (await factAction({ action: "add", category: addCat, value: addVal })) setAddVal(""); }}>Hinzufügen</button>
      </div>
    </div>
  );
}

// ============================ Arbeitsbereich (offene Bewerbung) ============================
function Workspace({ id, apps, onOpen, accounts, sendEnabled, docs, onBack, onChanged, onDeleted, onDiag }: any) {
  // Aus dem Cache initialisieren → Chat/Details sofort sichtbar, wenn beim
  // Hovern über die Bewerbung bereits vorgeladen wurde.
  const [d, setD] = useState<any>(() => getAppDetail(id));
  // Panels: liste (Bewerbungen) · chat · stelle (Analyse) · docs (Unterlagen).
  // Desktop zeigt Liste + Chat + Info-Schiene gleichzeitig; Mobile schaltet um.
  const [pane, setPane] = useState<"liste" | "chat" | "stelle" | "docs">("chat");
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);

  const load = useCallback(async () => {
    const data = await fetchAppDetail(id);
    if (data) setD(data); else setError("Bewerbung konnte nicht geladen werden.");
  }, [id]);
  // Beim Wechsel der Bewerbung sofort Cache zeigen (kein Leerblitzen), dann laden.
  useEffect(() => { setD(getAppDetail(id)); load(); }, [id, load]);

  if (error) return <div className="ac-view"><button className="ac-btn" onClick={onBack}>‹ Zurück</button><div className="ac-note bad" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!d) return <div className="ac-empty"><span className="spin" /></div>;
  const app = d.application;

  async function patch(update: any) { await aj(`/api/applications/${id}`, { method: "PATCH", json: update }); await load(); await onChanged(); }
  async function clearJob() {
    setMenu(false);
    if (!confirm("Die eingefügte Stellenanzeige samt Link und Analyse entfernen? Chat, Unterlagen und erstellte Dokumente bleiben erhalten.")) return;
    await patch({ clearJob: true });
  }
  async function deleteApp() {
    setMenu(false);
    if (!confirm("Diese Bewerbung vollständig löschen – inklusive Chat, Analyse, Zuordnungen und erstellten Dokumenten? Das kann nicht rückgängig gemacht werden.")) return;
    await aj(`/api/applications/${id}`, { method: "DELETE" });
    await onDeleted();
  }

  const TABS: { key: typeof pane; label: string; ic: string }[] = [
    { key: "liste", label: "Übersicht", ic: "▤" },
    { key: "chat", label: "Chat", ic: "💬" },
    { key: "stelle", label: "Stelle", ic: "▦" },
    { key: "docs", label: "Unterlagen", ic: "📄" }
  ];

  return (
    <div className="ac-ws" data-pane={pane}>
      <div className="ac-ws-top">
        <button className="ac-back sm" title="Zur Bewerbungsübersicht" aria-label="Zur Bewerbungsübersicht" onClick={onBack}><span className="ac-back-ic">‹</span><span className="ac-back-l">Übersicht</span></button>
        <div className="ac-ws-title">{app.position || "Bewerbung"}{app.company ? <span className="ac-ws-co"> · {app.company}</span> : null}</div>
        <div className="ac-ws-menu">
          <button className="ac-iconbtn" title="Aktionen" onClick={() => setMenu((v) => !v)}>⋯</button>
          {menu && <>
            <div className="ac-menu-scrim" onClick={() => setMenu(false)} />
            <div className="ac-menu">
              {app.analysis || app.job_url || app.job_text ? <button onClick={clearJob}>Stellenanzeige entfernen</button> : null}
              <button className="danger" onClick={deleteApp}>Bewerbung löschen</button>
            </div>
          </>}
        </div>
      </div>
      <div className="ac-ws-body">
        <aside className={"ac-ws-col ac-col-list" + (pane === "liste" ? " show" : "")}>
          <WorkspaceList apps={apps} currentId={id} onOpen={(x: string) => { onOpen(x); setPane("chat"); }} onNew={onBack} />
        </aside>
        <section className={"ac-ws-col ac-col-chat" + (pane === "chat" ? " show" : "")}>
          <ChatPanel app={app} messages={d.messages} onReload={load} onDiag={onDiag} />
        </section>
        <aside className={"ac-ws-col ac-col-info" + (pane === "stelle" || pane === "docs" ? " show" : "")}>
          <InfoRail app={app} data={d} docs={docs} accounts={accounts} sendEnabled={sendEnabled} onPatch={patch} onReload={load} onDiag={onDiag} mobilePane={pane} />
        </aside>
      </div>
      <nav className="ac-tabbar">
        {TABS.map((t) => (
          <button key={t.key} className={"ac-tab-item" + (pane === t.key ? " on" : "")} onClick={() => setPane(t.key)}>
            <span className="ac-tab-ic">{t.ic}</span><span className="ac-tab-l">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// Kompakte Bewerbungsliste in der linken Spalte des Arbeitsbereichs.
function WorkspaceList({ apps, currentId, onOpen, onNew }: any) {
  return (
    <div className="ac-wlist">
      <div className="ac-wlist-head">
        <span>Bewerbungen</span>
        <button className="ac-iconbtn sm" title="Zur Übersicht / neu" onClick={onNew}>＋</button>
      </div>
      <div className="ac-wlist-items">
        {(apps || []).map((a: any) => (
          <button key={a.id} className={"ac-witem" + (a.id === currentId ? " on" : "")} onMouseEnter={() => prefetchAppDetail(a.id)} onClick={() => onOpen(a.id)}>
            <span className="ac-witem-main">
              <span className="ac-witem-pos">{a.position || "Bewerbung"}</span>
              <span className="ac-witem-co">{a.company || "—"}</span>
            </span>
            <span className={"ac-wdot " + statusTone(a.status)} title={statusLabel(a.status)} />
          </button>
        ))}
        {!(apps || []).length && <div className="ac-mod-empty sm">Keine Bewerbungen.</div>}
      </div>
    </div>
  );
}

// Rechte Info-Schiene: kompakte Zusammenfassung + Schnellaktionen, darunter
// ausklappbar die volle Stellenanalyse und der Unterlagen-/Dokumentbereich.
// Auf Mobile zeigt sie je nach Tab nur „Stelle" ODER „Unterlagen".
function InfoRail({ app, data, docs, accounts, sendEnabled, onPatch, onReload, onDiag, mobilePane }: any) {
  const a = app.analysis;
  const reqs: string[] = (a?.requirements_must || []).slice(0, 4);
  const gdocs = data.generatedDocs || [];
  const assigned = data.assignedDocuments || [];
  const [openStelle, setOpenStelle] = useState(false);
  const [openDocs, setOpenDocs] = useState(true);
  // Beim Tab-Wechsel auf Mobile den passenden Abschnitt sicher öffnen.
  useEffect(() => { if (mobilePane === "stelle") setOpenStelle(true); if (mobilePane === "docs") setOpenDocs(true); }, [mobilePane]);

  return (
    <div className="ac-inforail">
      {/* Kompakte Kopf-Info – auf Mobile nur im Stelle-Tab */}
      <div className="ac-info-card" data-only="stelle">
        <div className="ac-info-pos">{app.position || "—"}</div>
        <div className="ac-info-co">{app.company || "—"} · {JOB_TYPE_LABEL[app.job_type] || "Stelle"}</div>
        <div className="ac-info-status">
          <select className="ac-select sm" value={app.status} onChange={(e) => onPatch({ status: e.target.value })}>
            {STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <div className="ac-info-metas">
          {app.deadline && <span className="ac-chipv high">Frist {new Date(app.deadline).toLocaleDateString("de-DE")}</span>}
          {app.job_url && <a className="ac-chipv link" href={app.job_url} target="_blank" rel="noreferrer">Anzeige ↗</a>}
          <span className="ac-chipv">{gdocs.length} Dok.</span>
          <span className="ac-chipv">{assigned.length} Anhang</span>
        </div>
        {!!reqs.length && (
          <div className="ac-info-reqs">
            <div className="ac-info-lbl">Wichtigste Anforderungen</div>
            <ul>{reqs.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
        )}
      </div>

      <div className={"ac-acc" + (openStelle ? " open" : "")} data-only="stelle">
        <button className="ac-acc-sum" onClick={() => setOpenStelle((v) => !v)}>Stellenanalyse<span className="ac-acc-chev">›</span></button>
        {openStelle && <div className="ac-acc-body"><JobPanel app={app} docs={docs} onPatch={onPatch} onReload={onReload} embedded /></div>}
      </div>

      <div className={"ac-acc" + (openDocs ? " open" : "")} data-only="docs">
        <button className="ac-acc-sum" onClick={() => setOpenDocs((v) => !v)}>Unterlagen &amp; Dokumente<span className="ac-acc-chev">›</span></button>
        {openDocs && <div className="ac-acc-body"><DocsPanel app={app} data={data} accounts={accounts} sendEnabled={sendEnabled} onReload={onReload} onDiag={onDiag} embedded /></div>}
      </div>
    </div>
  );
}

function Chip({ children, tone }: any) { return <span className={"ac-chipv " + (tone || "")}>{children}</span>; }

function JobPanel({ app, docs, onPatch, onReload, embedded }: any) {
  const a = app.analysis;
  const assignedIds: string[] = []; // aus data.assignedDocuments – hier via docs prop nicht nötig
  return (
    <div className={embedded ? "ac-panel-embed" : "ac-panel"}>
      {!embedded && <div className="ac-panel-h">Stelle</div>}
      <div className="ac-jobcard">
        <div className="ac-jobtype">{JOB_TYPE_LABEL[app.job_type] || "Stelle"}</div>
        <div className="ac-jobpos">{app.position || "—"}</div>
        <div className="ac-jobco">{app.company || "—"}</div>
        <div className="ac-metaline">
          {app.deadline && <Chip tone="high">Frist {new Date(app.deadline).toLocaleDateString("de-DE")}</Chip>}
          {app.contact && <Chip>Kontakt: {app.contact}</Chip>}
          {app.job_url && <a className="ac-chipv link" href={app.job_url} target="_blank" rel="noreferrer">Anzeige ↗</a>}
        </div>
      </div>
      {!a ? <div className="ac-mod-empty">Noch keine Analyse vorhanden.</div> : (
        <div className="ac-analysis">
          {a.summary && <p className="ac-sum">{a.summary}</p>}
          <Sec title="Aufgaben" items={a.tasks} />
          <Sec title="Zwingende Voraussetzungen" items={a.requirements_must} tone="must" />
          <Sec title="Wünschenswert" items={a.requirements_nice} />
          <Sec title="Verlangte Unterlagen" items={a.documents_required} />
          <Sec title="Worauf achten" items={a.application_tips} />
          <div className="ac-match">
            <MatchCol title="Starke Übereinstimmung" items={a.matches_strong} tone="low" />
            <MatchCol title="Teilweise" items={a.matches_partial} tone="high" />
            <MatchCol title="Offene Punkte" items={a.open_points} tone="urgent" />
          </div>
        </div>
      )}
    </div>
  );
}
function Sec({ title, items, tone }: any) { if (!items || !items.length) return null; return <div className="ac-sec"><div className="ac-sec-t">{title}</div><ul className={"ac-ul " + (tone || "")}>{items.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>; }
function MatchCol({ title, items, tone }: any) { return <div className={"ac-matchcol " + tone}><div className="ac-matchcol-t">{title}</div>{(items && items.length) ? <ul>{items.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul> : <div className="ac-mod-empty sm">—</div>}</div>; }

function ChatPanel({ app, messages, onReload, onDiag }: any) {
  const [msgs, setMsgs] = useState<any[]>(messages || []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const initScrolled = useRef(false);
  useEffect(() => { setMsgs(messages || []); }, [messages]);
  // Beim ersten Anzeigen sofort ganz nach unten springen (ohne Animation),
  // danach neue Nachrichten sanft einscrollen. Der erste Sprung zählt erst,
  // wenn tatsächlich Nachrichten geladen sind (sonst animiert das Nachladen).
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: initScrolled.current ? "smooth" : "auto" }); if (msgs.length) initScrolled.current = true; }, [msgs, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setError(null); setInput("");
    const optimistic = { id: "tmp", role: "user", content: text };
    setMsgs((m) => [...m, optimistic]); setBusy(true);
    const ctrl = new AbortController(); ctrlRef.current = ctrl;
    const r = await aj("/api/applications/chat", { json: { applicationId: app.id, message: text }, timeoutMs: 60000, signal: ctrl.signal });
    setBusy(false);
    if (r.ok) { setMsgs((m) => [...m.filter((x) => x.id !== "tmp"), { id: "u" + Date.now(), role: "user", content: text }, r.data.message]); onReload(); }
    else { setMsgs((m) => m.filter((x) => x.id !== "tmp")); setError(errText(r, "Antwort konnte nicht erstellt werden.")); }
  }

  const suggestions = ["Fass mir die Stelle zusammen.", "Welche Punkte aus meinem Lebenslauf passen besonders gut?", "Was fehlt mir für diese Stelle?", "Schreib mir ein Anschreiben.", "Erstelle eine kurze Bewerbungsmail.", "Bereite mich auf das Vorstellungsgespräch vor.", "Welche Rückfragen sollte ich stellen?"];

  return (
    <div className="ac-chat">
      <div className="ac-chat-head">
        <span className="ac-chat-title">Bewerbungs-Chat</span>
        <span className="ac-chat-sub">kennt Stelle &amp; bestätigte Unterlagen</span>
      </div>
      <OverlayScroll className="ac-chat-scroll">
        {!msgs.length && (
          <div className="ac-chat-intro">
            <p>Dieser Chat kennt die Stelle und deine <b>bestätigten</b> Unterlagen. Frag zum Beispiel:</p>
            <div className="ac-suggests">{suggestions.map((s) => <button key={s} className="ac-suggest" onClick={() => send(s)}>{s}</button>)}</div>
          </div>
        )}
        {msgs.map((m) => <div key={m.id} className={"ac-msg " + m.role}><div className="ac-msg-b">{m.role === "assistant" ? <Markdown text={m.content} /> : m.content}</div></div>)}
        {busy && <div className="ac-msg assistant"><div className="ac-msg-b"><span className="spin" /> denkt nach…{ctrlRef.current && <button className="ac-diaglink" onClick={() => ctrlRef.current?.abort()}>Abbrechen</button>}</div></div>}
        <div ref={endRef} />
      </OverlayScroll>
      {error && <div className="ac-note bad ac-chat-err">{error} <button className="ac-diaglink" onClick={onDiag}>Diagnose</button></div>}
      <div className="ac-chat-input">
        <textarea className="ac-chat-ta" placeholder="Nachricht an den Bewerbungs-Chat…" value={input} disabled={busy}
          onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
        <button className="ac-btn primary" disabled={busy || !input.trim()} onClick={() => send(input)}>Senden</button>
      </div>
    </div>
  );
}

function DocsPanel({ app, data, accounts, sendEnabled, onReload, onDiag, embedded }: any) {
  const [tone, setTone] = useState(TONES[0]);
  const [kind, setKind] = useState("anschreiben");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [refining, setRefining] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);
  const gdocs = data.generatedDocs || [];
  const assigned = data.assignedDocuments || [];
  const editing = gdocs.find((x: any) => x.id === editId);

  async function generate() {
    setBusy(true); setError(null); setMissing(null);
    const ctrl = new AbortController(); ctrlRef.current = ctrl;
    const r = await aj("/api/applications/generate-doc", { json: { applicationId: app.id, kind, tone }, timeoutMs: 60000, signal: ctrl.signal });
    setBusy(false);
    if (r.ok) { setMissing(r.data.missing_info || null); await onReload(); setEditId(r.data.doc.id); setEditBody(r.data.doc.body); }
    else setError(errText(r, "Dokument konnte nicht erstellt werden."));
  }
  function openEdit(doc: any) { setEditId(doc.id); setEditBody(doc.body); }
  async function saveEdit() { if (!editId) return; await aj(`/api/applications/doc/${editId}`, { method: "PATCH", json: { body: editBody } }); await onReload(); }
  async function refine(cmd: string) {
    if (!editId) return; setRefining(true); setError(null);
    const r = await aj("/api/applications/refine-doc", { json: { docId: editId, command: cmd }, timeoutMs: 60000 });
    setRefining(false);
    if (r.ok) { setEditBody(r.data.body); await onReload(); } else setError(errText(r, "Anpassung fehlgeschlagen."));
  }
  async function delDoc(docId: string) { if (!confirm("Dokument löschen?")) return; await aj(`/api/applications/doc/${docId}`, { method: "DELETE" }); if (editId === docId) setEditId(null); await onReload(); }
  async function assign(documentId: string, action: string) { await aj(`/api/applications/${app.id}/assign`, { json: { documentId, action } }); await onReload(); }

  return (
    <div className={embedded ? "ac-panel-embed" : "ac-panel"}>
      {!embedded && <div className="ac-panel-h">Dokumente & Entwurf</div>}

      <div className="ac-gen">
        <div className="ac-gen-row">
          <select className="ac-select sm" value={kind} onChange={(e) => setKind(e.target.value)}>{DOC_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
          <select className="ac-select sm" value={tone} onChange={(e) => setTone(e.target.value)}>{TONES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        </div>
        <div className="ac-gen-row">
          <button className="ac-btn primary" disabled={busy} onClick={generate}>{busy ? <><span className="spin" /> Erstelle…</> : "Erstellen"}</button>
          {busy && <button className="ac-btn sm" onClick={() => ctrlRef.current?.abort()}>Abbrechen</button>}
        </div>
      </div>
      {error && <div className="ac-note bad">{error} <button className="ac-diaglink" onClick={onDiag}>Diagnose</button></div>}
      {missing && <div className="ac-note warn"><b>Bitte prüfen – fehlende Angaben:</b> {missing}</div>}

      {!!gdocs.length && (
        <div className="ac-gdocs">
          {gdocs.map((doc: any) => (
            <div key={doc.id} className={"ac-gdoc" + (editId === doc.id ? " on" : "")}>
              <div className="ac-gdoc-h" onClick={() => (editId === doc.id ? setEditId(null) : openEdit(doc))}>
                <span className="ac-gdoc-t">{doc.title || DOC_KINDS.find((k) => k.key === doc.kind)?.label}</span>
                <span className="ac-gdoc-meta">{new Date(doc.updated_at).toLocaleDateString("de-DE")}</span>
              </div>
              {editId === doc.id && (
                <div className="ac-editor-wrap">
                  <textarea className="ac-editor" value={editBody} onChange={(e) => setEditBody(e.target.value)} onBlur={saveEdit} />
                  <div className="ac-chips">
                    {REFINE.map((c) => <button key={c} className="ac-chip" disabled={refining} onClick={() => refine(c)}>{c}</button>)}
                    {refining && <span className="spin" />}
                  </div>
                  <div className="ac-gdoc-actions">
                    <button className="ac-btn sm" onClick={saveEdit}>Speichern</button>
                    <a className="ac-btn sm primary" href={`/api/applications/doc/${doc.id}?format=docx`} target="_blank" rel="noreferrer">DOCX herunterladen</a>
                    <button className="ac-btn sm danger" onClick={() => delDoc(doc.id)}>Löschen</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="ac-label sm">Angehängte Unterlagen</div>
      <div className="ac-assign">
        {(data.assignedDocuments || []).map((d: any) => (
          <span key={d.id} className="ac-chipv low">{d.name}<button className="ac-x" onClick={() => assign(d.id, "remove")}>×</button></span>
        ))}
        <AssignPicker app={app} assigned={assigned} onAssign={(id: string) => assign(id, "add")} />
      </div>

      <button className="ac-btn primary block" onClick={() => setSendOpen(true)}>Bewerbungsmail vorbereiten</button>
      {sendOpen && <SendModal app={app} data={data} accounts={accounts} sendEnabled={sendEnabled} onClose={() => setSendOpen(false)} onSent={onReload} onDiag={onDiag} />}
    </div>
  );
}

function AssignPicker({ assigned, onAssign }: any) {
  const [docs, setDocs] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open && !docs) aj("/api/documents", { timeoutMs: 20000 }).then((r) => { if (r.ok) setDocs((r.data.documents || []).filter((d: any) => d.allowed_for_applications)); }); }, [open, docs]);
  const assignedIds = new Set(assigned.map((a: any) => a.id));
  return (
    <span className="ac-assign-pick">
      <button className="ac-chipv add" onClick={() => setOpen((v) => !v)}>＋ Unterlage</button>
      {open && <div className="ac-assign-menu">
        {docs === null ? <span className="spin" /> : !docs.length ? <div className="ac-mod-empty sm">Keine freigegebenen Unterlagen.</div> :
          docs.map((d) => <button key={d.id} disabled={assignedIds.has(d.id)} onClick={() => { onAssign(d.id); setOpen(false); }}>{d.name}</button>)}
      </div>}
    </span>
  );
}

function SendModal({ app, data, accounts, sendEnabled, onClose, onSent, onDiag }: any) {
  const mailDoc = (data.generatedDocs || []).find((d: any) => d.kind === "bewerbungsmail");
  const [fromAccountId, setFrom] = useState(accounts[0]?.id || "");
  const [to, setTo] = useState(app.contact && /@/.test(app.contact) ? app.contact.match(/[\w.+-]+@[\w.-]+/)?.[0] || "" : "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(`Bewerbung als ${app.position || ""}${app.company ? " – " + app.company : ""}`.trim());
  const [text, setText] = useState(mailDoc?.body || "");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const attachIds = (data.assignedDocuments || []).map((d: any) => d.id);

  useEffect(() => {
    (async () => {
      const r = await aj("/api/applications/send", { json: { applicationId: app.id, mode: "check", attachmentDocIds: attachIds }, timeoutMs: 25000 });
      if (r.ok) { setWarnings(r.data.warnings || []); }
      setChecked(true);
    })();
  }, []); // eslint-disable-line

  async function doSend() {
    setBusy(true); setError(null);
    const r = await aj("/api/applications/send", { json: { applicationId: app.id, mode: "send", confirm: true, fromAccountId, to, cc, subject, text, attachmentDocIds: attachIds, generatedDocId: mailDoc ? null : (data.generatedDocs || []).find((d: any) => d.kind === "anschreiben")?.id || null }, timeoutMs: 60000 });
    setBusy(false);
    if (r.ok) { setSent(true); await onSent(); setTimeout(onClose, 1200); }
    else setError(errText(r, "Versand fehlgeschlagen."));
  }

  return (
    <div className="ac-modal-scrim" onClick={() => !busy && onClose()}>
      <div className="ac-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ac-modal-h"><h3>Bewerbungsmail</h3><button className="ac-x" onClick={() => !busy && onClose()}>✕</button></div>
        <div className="ac-modal-b">
          {sent ? <div className="ac-note ok">Gesendet ✓ Status auf „Beworben" gesetzt.</div> : <>
            <div className="ac-field"><label>Von</label>
              <select className="ac-select" value={fromAccountId} onChange={(e) => setFrom(e.target.value)}>{accounts.map((a: any) => <option key={a.id} value={a.id}>{a.email}</option>)}</select></div>
            <div className="ac-field"><label>An</label><input className="ac-input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="empfaenger@unternehmen.de" /></div>
            <div className="ac-field"><label>CC</label><input className="ac-input" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="optional" /></div>
            <div className="ac-field"><label>Betreff</label><input className="ac-input" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
            <div className="ac-field"><label>Text</label><textarea className="ac-textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="Text der Bewerbungsmail…" /></div>
            <div className="ac-field"><label>Anhänge</label>
              <div className="ac-attaches">
                {(data.assignedDocuments || []).length ? (data.assignedDocuments).map((d: any) => <span key={d.id} className="ac-chipv">{d.name}</span>) : <span className="ac-mod-empty sm">Keine Unterlagen angehängt.</span>}
              </div>
            </div>
            {checked && warnings.map((w, i) => <div key={i} className="ac-note warn">{w}</div>)}
            {error && <div className="ac-note bad">{error} <button className="ac-diaglink" onClick={onDiag}>Diagnose</button></div>}
            {!sendEnabled && <div className="ac-note warn">Versand ist nicht aktiviert (ENABLE_SEND=false). Du kannst alles vorbereiten, aber noch nicht senden.</div>}
          </>}
        </div>
        {!sent && <div className="ac-modal-f">
          <button className="ac-btn primary" disabled={busy || !sendEnabled || !to.trim() || !text.trim()} onClick={doSend}>{busy ? <><span className="spin" /> Sende…</> : "Senden"}</button>
          <button className="ac-btn" onClick={() => !busy && onClose()}>Abbrechen</button>
        </div>}
      </div>
    </div>
  );
}

// ============================ KI-Diagnose ============================
function DiagModal({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<any>({ loading: true });
  useEffect(() => { aj("/api/mail/ai-diagnostics", { timeoutMs: 15000 }).then((r) => setS(r.ok ? { loading: false, ...r.data } : { loading: false, error: true })); }, []);
  const cat: Record<string, string> = { not_configured: "Nicht eingerichtet", auth: "Authentifizierung", rate_limit: "Rate-Limit", timeout: "Zeitüberschreitung", overloaded: "Überlastet", api_error: "API-Fehler" };
  return (
    <div className="ac-modal-scrim" onClick={onClose}>
      <div className="ac-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ac-modal-h"><h3>KI-Diagnose</h3><button className="ac-x" onClick={onClose}>✕</button></div>
        <div className="ac-modal-b">
          {s.loading ? <div className="ac-empty"><span className="spin" /></div> : s.error ? <div className="ac-note bad">Diagnose nicht verfügbar.</div> : <>
            <div className="ac-field"><label>KI-Verbindung</label><div>{s.configured ? "✅ eingerichtet" : "❌ nicht eingerichtet (ANTHROPIC_API_KEY fehlt)"}</div></div>
            <div className="ac-field"><label>Modell</label><div>{s.model || "—"}</div></div>
            <div className="ac-field"><label>Versand</label><div>{s.sendEnabled ? "aktiviert" : "deaktiviert"}</div></div>
            <div className="ac-label sm">Letzte KI-Anfragen</div>
            {(!s.events || !s.events.length) ? <div className="ac-mod-empty">Noch keine protokolliert. (Tabelle ai_events via schema_ai.sql.)</div> :
              <div className="ac-diag-list">{s.events.map((e: any, i: number) => <div key={i} className={"ac-diag-row" + (e.ok ? "" : " bad")}><span>{e.ok ? "✅" : "⚠️"}</span><span className="ac-diag-kind">{e.kind}</span><span className="ac-diag-meta">{new Date(e.created_at).toLocaleString("de-DE")} · {e.duration_ms != null ? Math.round(e.duration_ms / 100) / 10 + "s" : "—"}{e.error_category ? " · " + (cat[e.error_category] || e.error_category) : ""}</span></div>)}</div>}
            <div className="ac-hint">Keine Schlüssel und keine vollständigen Inhalte werden gespeichert.</div>
          </>}
        </div>
        <div className="ac-modal-f"><button className="ac-btn" onClick={onClose}>Schließen</button></div>
      </div>
    </div>
  );
}
