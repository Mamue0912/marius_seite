"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { Notice, notify } from "@/components/Feedback";
import OverlayScroll from "@/components/OverlayScroll";
import { api, fetchRequirements, getRequirementsCache } from "@/lib/motivationStore";
import { EvidenceStep, InterviewStep, ReviewPanel } from "@/components/MotivationPanels";

// ============================ Typen ============================
type Stage = "profil" | "erfahrungen" | "gespraech" | "beispiele" | "bezug" | "gliederung" | "entwurf" | "ueberarbeitung" | "export";

const STAGES: { key: Stage; label: string; ic: string }[] = [
  { key: "entwurf", label: "Schreiben & Bearbeiten", ic: "edit" },
  { key: "ueberarbeitung", label: "Gezielt ändern", ic: "spark" },
  { key: "export", label: "Prüfen & Export", ic: "document" },
  { key: "erfahrungen", label: "Meine Erfahrungen", ic: "star" },
  { key: "gespraech", label: "Gespräch", ic: "chat" },
  { key: "profil", label: "Profil", ic: "user" },
  { key: "bezug", label: "Anforderungen", ic: "shield" },
  { key: "gliederung", label: "Gliederung", ic: "tasks" }
];
// "beispiele" bleibt als Stage erhalten: früher erfasste Antworten fließen
// weiterhin in den Prompt, der Schritt wird aber nicht mehr angeboten.

const TONE_OPTIONS = [
  { key: "persoenlich", label: "Natürlich und persönlich" },
  { key: "klassisch", label: "Klassisch professionell" },
  { key: "analytisch", label: "Reflektiert und analytisch" }
];

const REFINE_BUTTONS = [
  { key: "konkreter", label: "Konkreter" },
  { key: "kuerzer", label: "Kürzer" },
  { key: "natuerlicher", label: "Natürlicher" },
  { key: "whu_bezug", label: "Stärkerer WHU-Bezug" }
];

// ============================ Hauptkomponente ============================
export default function MotivationStudio() {
  const [letters, setLetters] = useState<any[]>([]);
  const [letter, setLetter] = useState<any | null>(null);
  const [examples, setExamples] = useState<any[]>([]);
  const [openGroups, setOpenGroups] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>({});
  const [profileMissing, setProfileMissing] = useState<string[]>([]);
  const [reqs, setReqs] = useState<any>(() => getRequirementsCache());
  const [stage, setStage] = useState<Stage>("entwurf");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [check, setCheck] = useState<any>(null);
  const [draft, setDraft] = useState("");          // sichtbarer Text im Editor
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [versions, setVersions] = useState<any[]>([]);
  const [compare, setCompare] = useState<any | null>(null); // Vorher/Nachher
  const [missingInfo, setMissingInfo] = useState<string[]>([]);
  const [sources, setSources] = useState<any>(null);
  const [targeted, setTargeted] = useState<any | null>(null);
  const [wish, setWish] = useState("");

  const savedRef = useRef("");   // zuletzt gespeicherter Text
  const letterRef = useRef<string | null>(null);

  const loadExamples = useCallback(async (id: string) => {
    const r = await api(`/api/motivation/examples?letter=${encodeURIComponent(id)}`);
    if (r.ok) { setExamples(r.data.examples || []); setOpenGroups(r.data.open || []); }
  }, []);

  const loadVersions = useCallback(async (id: string) => {
    const r = await api(`/api/motivation/letters/${id}/versions`);
    if (r.ok) setVersions(r.data.versions || []);
  }, []);

  const openLetter = useCallback(async (id: string, opts?: { keepStage?: boolean }) => {
    const r = await api(`/api/motivation/letters/${id}`);
    if (!r.ok) { setLoadError(r.message); return; }
    setLetter(r.data.letter);
    letterRef.current = r.data.letter.id;
    setDraft(r.data.letter.body || "");
    savedRef.current = r.data.letter.body || "";
    setExamples(r.data.examples || []);
    setCheck(r.data.letter.last_check || null);
    // Beim blossen Aktualisieren darf der gerade gewaehlte Schritt NICHT
    // zurueckspringen – sonst wirft es den Nutzer mitten in der Arbeit heraus.
    if (!opts?.keepStage) setStage((r.data.letter.stage as Stage) || "entwurf");
    void loadExamples(id);
    void loadVersions(id);
  }, [loadExamples, loadVersions]);

  // ---- Initiales Laden ----
  const loadAll = useCallback(async () => {
    setLoadError(null);
    const [p, l, r] = await Promise.all([
      api("/api/motivation/profile"),
      api("/api/motivation/letters"),
      fetchRequirements()
    ]);
    if (p.ok) { setProfile(p.data.profile || {}); setProfileMissing(p.data.missing || []); }
    else setLoadError(p.message);
    if (r) setReqs(r);
    if (l.ok) {
      const list = l.data.letters || [];
      setLetters(list);
      const current = letterRef.current;
      if (current) await openLetter(current, { keepStage: true });
      else if (list[0]) await openLetter(list[0].id);
    } else setLoadError(l.message);
    setLoading(false);
  }, [openLetter]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  async function createLetter() {
    setBusy("create");
    const r = await api("/api/motivation/letters", { json: {} });
    setBusy(null);
    if (!r.ok) { notify(r.message || "Das Schreiben konnte nicht angelegt werden.", true); return; }
    const list = await api("/api/motivation/letters");
    if (list.ok) setLetters(list.data.letters || []);
    await openLetter(r.data.letter.id);
    notify("Neues Motivationsschreiben mit WHU-Voreinstellung angelegt.");
  }

  // ---- Automatisches Speichern (entprellt) ----
  useEffect(() => {
    if (!letter || draft === savedRef.current) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      const id = letterRef.current;
      if (!id) return;
      const r = await api(`/api/motivation/letters/${id}`, { method: "PATCH", json: { body: draft }, timeoutMs: 20000 });
      if (r.ok) { savedRef.current = draft; setSaveState("saved"); }
      else { setSaveState("error"); }
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, letter?.id]);

  // Vor dem Verlassen warnen, solange ungespeicherte Änderungen offen sind.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (draft !== savedRef.current) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [draft]);

  async function patchLetter(patch: any, label?: string) {
    if (!letter) return;
    const r = await api(`/api/motivation/letters/${letter.id}`, { method: "PATCH", json: { ...patch, versionLabel: label } });
    if (!r.ok) { notify(r.message || "Speichern fehlgeschlagen.", true); return; }
    setLetter(r.data.letter);
    if (typeof patch.body === "string") { setDraft(patch.body); savedRef.current = patch.body; }
  }

  async function saveProfile(next: any) {
    setProfile(next);
    setSaveState("saving");
    const r = await api("/api/motivation/profile", { method: "PUT", json: next, timeoutMs: 20000 });
    if (r.ok) { setProfileMissing(r.data.missing || []); setSaveState("saved"); }
    else { setSaveState("error"); notify(r.message || "Das Profil konnte nicht gespeichert werden.", true); }
  }

  // ---- KI-Aktionen ----
  async function generate(mode: "outline" | "draft") {
    if (!letter) return;
    setBusy(mode);
    setMissingInfo([]);
    const r = await api("/api/motivation/generate", { json: { letterId: letter.id, mode }, timeoutMs: 60000 });
    setBusy(null);
    if (!r.ok) { notify(r.message || "Die Erzeugung ist fehlgeschlagen.", true); return; }
    setMissingInfo(r.data.missing || []);
    if (r.data.sources) setSources(r.data.sources);
    if (mode === "outline") {
      setLetter((l: any) => ({ ...l, outline: r.data.outline, stage: "gliederung" }));
      setStage("gliederung");
      notify("Gliederung erstellt. Du kannst sie frei bearbeiten.");
    } else {
      setLetter(r.data.letter);
      setDraft(r.data.letter.body || "");
      savedRef.current = r.data.letter.body || "";
      setStage("entwurf");
      void loadVersions(letter.id);
      notify("Entwurf erstellt. Der vorherige Stand liegt in den Versionen.");
    }
  }

  async function refine(paragraphIndex: number, action: string) {
    if (!letter) return;
    const paras = splitParagraphs(draft);
    const paragraph = paras[paragraphIndex];
    if (!paragraph) return;
    setBusy(`refine-${paragraphIndex}`);
    const r = await api("/api/motivation/refine", { json: { letterId: letter.id, paragraph, action }, timeoutMs: 50000 });
    setBusy(null);
    if (!r.ok) { notify(r.message || "Die Überarbeitung ist fehlgeschlagen.", true); return; }
    // Nichts wird automatisch übernommen: erst vergleichen, dann entscheiden.
    setCompare({ index: paragraphIndex, before: r.data.before, after: r.data.after, note: r.data.note, action });
  }

  // Freitext-Wunsch: die KI sucht selbst die betroffenen Absätze und ändert
  // nur diese. Nichts wird automatisch übernommen.
  async function applyWish() {
    if (!letter || !wish.trim()) return;
    setBusy("wish");
    setTargeted(null);
    const r = await api("/api/motivation/refine", {
      json: { letterId: letter.id, body: draft, instruction: wish.trim() }, timeoutMs: 60000
    });
    setBusy(null);
    if (!r.ok) { notify(r.message || "Die Änderung ist fehlgeschlagen.", true); return; }
    if (!r.data.changes?.length) {
      notify(r.data.note || r.data.message || "Dafür wurde keine passende Stelle gefunden.", true);
      return;
    }
    setTargeted({ changes: r.data.changes, note: r.data.note, accepted: {} as Record<number, boolean> });
  }

  // Einzelne vorgeschlagene Änderung übernehmen.
  function acceptChange(index: number, after: string) {
    const paras = splitParagraphs(draft);
    if (!paras[index]) return;
    paras[index] = after;
    setDraft(paras.join("\n\n"));
    setTargeted((t: any) => t ? { ...t, accepted: { ...t.accepted, [index]: true } } : t);
  }

  function acceptAllChanges() {
    if (!targeted) return;
    const paras = splitParagraphs(draft);
    for (const c of targeted.changes) if (paras[c.index] && !targeted.accepted[c.index]) paras[c.index] = c.after;
    setDraft(paras.join("\n\n"));
    setTargeted(null);
    setWish("");
    notify("Änderungen übernommen. Der alte Stand liegt in den Versionen.");
  }

  function applyCompare() {
    if (!compare) return;
    const paras = splitParagraphs(draft);
    paras[compare.index] = compare.after;
    setDraft(paras.join("\n\n"));
    setCompare(null);
    notify("Vorschlag übernommen. Der alte Stand bleibt in den Versionen.");
  }

  async function runCheck() {
    if (!letter) return;
    setBusy("check");
    const r = await api("/api/motivation/check", { json: { letterId: letter.id, body: draft }, timeoutMs: 40000 });
    setBusy(null);
    if (!r.ok) { notify(r.message || "Die Prüfung ist fehlgeschlagen.", true); return; }
    setCheck(r.data);
  }

  async function restore(versionId: string) {
    if (!letter) return;
    if (!confirm("Diese Version wiederherstellen? Der aktuelle Stand wird vorher als Version gesichert.")) return;
    setBusy("restore");
    const r = await api(`/api/motivation/letters/${letter.id}/versions`, { json: { versionId } });
    setBusy(null);
    if (!r.ok) { notify(r.message || "Wiederherstellen fehlgeschlagen.", true); return; }
    setLetter(r.data.letter);
    setDraft(r.data.letter.body || "");
    savedRef.current = r.data.letter.body || "";
    void loadVersions(letter.id);
    notify("Version wiederhergestellt.");
  }

  async function exportFile(format: "pdf" | "docx") {
    if (!letter) return;
    // Erst sicherstellen, dass der sichtbare Stand gespeichert ist.
    if (draft !== savedRef.current) await patchLetter({ body: draft });
    setBusy(`export-${format}`);
    try {
      const r = await fetch(`/api/motivation/letters/${letter.id}/export?format=${format}`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        notify(j.message || "Der Export ist fehlgeschlagen.", true);
        return;
      }
      const pages = r.headers.get("x-rendered-pages");
      const blob = await r.blob();
      const name = (r.headers.get("content-disposition") || "").match(/filename="([^"]+)"/)?.[1] || `Motivationsschreiben.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      notify(pages ? `${name} geladen – ${pages} gesetzte Seite(n).` : `${name} geladen.`);
    } catch {
      notify("Der Export ist fehlgeschlagen.", true);
    } finally {
      setBusy(null);
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(draft);
      notify("Text in die Zwischenablage kopiert.");
    } catch {
      notify("Kopieren war nicht möglich. Bitte den Text manuell markieren.", true);
    }
  }

  const counts = useMemo(() => ({
    words: draft.trim() ? draft.trim().split(/\s+/).length : 0,
    chars: draft.length,
    paragraphs: splitParagraphs(draft).length
  }), [draft]);

  // ============================ Darstellung ============================
  if (loading) return <div className="ac-empty"><span className="spin" /></div>;

  return (
    <div className="ms">
      <aside className="ms-side">
        <OverlayScroll className="ms-side-scroll">
          <div className="ms-side-h">Ablauf</div>
          <nav className="ms-steps" aria-label="Schritte">
            {STAGES.map((s, i) => (
              <button
                key={s.key}
                className={"ms-step" + (stage === s.key ? " on" : "")}
                onClick={() => { setStage(s.key); if (letter) void patchLetter({ stage: s.key }); }}
                aria-current={stage === s.key ? "step" : undefined}
              >
                <span className="ms-step-n">{i + 1}</span>
                <span className="ms-step-ic"><Icon name={s.ic} size={16} /></span>
                <span className="ms-step-l">{s.label}</span>
              </button>
            ))}
          </nav>

          <div className="ms-side-h">Schreiben</div>
          {letters.map((l) => (
            <button key={l.id} className={"ms-letter" + (letter?.id === l.id ? " on" : "")} onClick={() => void openLetter(l.id)}>
              <span className="ms-letter-t">{l.title || l.institution}</span>
              <span className="ms-letter-s">{l.programme}</span>
            </button>
          ))}
          <button className="ac-btn" style={{ margin: "10px 8px" }} onClick={() => void createLetter()} disabled={busy === "create"}>
            {busy === "create" ? "Wird angelegt…" : "+ Neues Schreiben"}
          </button>
        </OverlayScroll>
      </aside>

      <main className="ms-main">
        {loadError && <Notice retry={() => void loadAll()}>{loadError}</Notice>}

        {!letter ? (
          <div className="ms-intro">
            <h2>Motivationsschreiben</h2>
            <p>
              Für Studienbewerbungen – mit ausgearbeiteter Voreinstellung für den Bachelor an der
              WHU – Otto Beisheim School of Management. Der Ablauf führt dich von deinem Profil über
              persönliche Beispiele bis zum geprüften Export.
            </p>
            <button className="ac-btn primary" onClick={() => void createLetter()} disabled={busy === "create"}>
              {busy === "create" ? "Wird angelegt…" : "Jetzt starten"}
            </button>
          </div>
        ) : (
          <>
            <header className="ms-head">
              <div className="ms-head-t">
                <h2>{letter.title || "Motivationsschreiben"}</h2>
                <span className="ms-head-s">{letter.institution} · {letter.programme}{letter.intake ? ` · Start ${letter.intake}` : ""}</span>
              </div>
              <div className="ms-head-a">
                <SaveBadge state={saveState} />
                <label className="ms-lang">
                  <span className="sr-only">Tonalität</span>
                  <select
                    value={letter.tone || "persoenlich"}
                    onChange={(e) => void patchLetter({ tone: e.target.value })}
                    aria-label="Tonalität des Schreibens"
                  >
                    {TONE_OPTIONS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </label>
                <label className="ms-lang">
                  <span className="sr-only">Sprache</span>
                  <select
                    value={letter.language}
                    onChange={(e) => void patchLetter({ language: e.target.value })}
                    aria-label="Sprache des Schreibens"
                  >
                    <option value="de">Deutsch</option>
                    <option value="en">English</option>
                  </select>
                </label>
              </div>
            </header>

            <OverlayScroll className="ms-body">
              {stage === "profil" && (
                <ProfileStep profile={profile} missing={profileMissing} onSave={saveProfile} onNext={() => setStage("beispiele")} />
              )}
              {stage === "beispiele" && (
                <ExamplesStep
                  letterId={letter.id} examples={examples} groups={openGroups}
                  onSaved={() => void loadExamples(letter.id)} onNext={() => setStage("bezug")}
                />
              )}
              {stage === "erfahrungen" && <EvidenceStep />}
              {stage === "gespraech" && <InterviewStep letterId={letter.id} />}
              {stage === "bezug" && <ReferenceStep reqs={reqs} letter={letter} onPatch={patchLetter} onNext={() => setStage("gliederung")} />}
              {stage === "gliederung" && (
                <OutlineStep
                  letter={letter} busy={busy} missing={missingInfo}
                  onGenerate={() => void generate("outline")}
                  onChange={(outline: any) => void patchLetter({ outline })}
                  onNext={() => setStage("entwurf")}
                />
              )}
              {stage === "entwurf" && (
                <DraftStep
                  draft={draft} setDraft={setDraft} counts={counts} busy={busy} missing={missingInfo}
                  sources={sources} wish={wish} setWish={setWish} targeted={targeted}
                  onGenerate={() => void generate("draft")} onWish={applyWish}
                  onAcceptChange={acceptChange} onAcceptAll={acceptAllChanges}
                  onDiscardTargeted={() => setTargeted(null)}
                  onNext={() => setStage("ueberarbeitung")}
                />
              )}
              {stage === "ueberarbeitung" && (
                <RefineStep
                  draft={draft} busy={busy} compare={compare}
                  onRefine={refine} onApply={applyCompare} onDiscard={() => setCompare(null)}
                  versions={versions} onRestore={restore} onNext={() => setStage("export")}
                />
              )}
              {stage === "export" && (
                <ExportStep
                  check={check} counts={counts} busy={busy} reqs={reqs} profile={profile}
                  letterId={letter.id} draftText={draft}
                  onCheck={runCheck} onExport={exportFile} onCopy={copyText}
                />
              )}
            </OverlayScroll>
          </>
        )}
      </main>
    </div>
  );
}

// ============================ Hilfen ============================
function splitParagraphs(text: string): string[] {
  return (text || "").replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

function SaveBadge({ state }: { state: string }) {
  if (state === "saving") return <span className="ms-save"><span className="spin sm" /> Wird gespeichert…</span>;
  if (state === "saved") return <span className="ms-save ok"><Icon name="check" size={14} /> Gespeichert</span>;
  if (state === "error") return <span className="ms-save err"><Icon name="info" size={14} /> Nicht gespeichert</span>;
  return null;
}

// ============================ Schritt 1: Profil ============================
function ProfileStep({ profile, missing, onSave, onNext }: any) {
  const [form, setForm] = useState<any>(profile);
  useEffect(() => { setForm(profile); }, [profile]);
  const set = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));

  const fields: { k: string; label: string; type?: string; area?: boolean; hint?: string }[] = [
    { k: "firstName", label: "Vorname" },
    { k: "lastName", label: "Nachname" },
    { k: "birthDate", label: "Geburtsdatum", type: "date" },
    { k: "city", label: "Wohnort" },
    { k: "school", label: "Schule" },
    { k: "graduationYear", label: "Abschlussjahr" },
    { k: "grade", label: "Notendurchschnitt" },
    { k: "experiences", label: "Belegte Erfahrungen", area: true, hint: "Nur, was bereits stattgefunden hat oder laufend ist." },
    { k: "planned", label: "Nur geplant", area: true, hint: "Vorhaben, die noch nicht stattgefunden haben. Werden nie als abgeschlossen dargestellt." },
    { k: "interests", label: "Interessen", area: true },
    { k: "goals", label: "Berufliche Ziele", area: true }
  ];

  return (
    <section className="ms-sec">
      <h3>Dein persönliches Profil</h3>
      <p className="ms-lead">
        Diese Angaben gehören dir und sind nur für dich sichtbar. Sie sind die einzige Tatsachenquelle
        für die Textvorschläge – was hier nicht steht, wird nicht erfunden.
      </p>
      {missing?.length > 0 && (
        <div className="ms-gap">
          <b>Noch offen:</b> {missing.join(", ")}
        </div>
      )}
      <div className="ms-grid">
        {fields.map((f) => (
          <label key={f.k} className={"ms-field" + (f.area ? " wide" : "")}>
            <span className="ms-label">{f.label}</span>
            {f.area
              ? <textarea rows={3} value={form?.[f.k] || ""} onChange={(e) => set(f.k, e.target.value)} onBlur={() => onSave(form)} />
              : <input type={f.type || "text"} value={form?.[f.k] || ""} onChange={(e) => set(f.k, e.target.value)} onBlur={() => onSave(form)} />}
            {f.hint && <span className="ms-hint">{f.hint}</span>}
          </label>
        ))}
      </div>
      <div className="ms-actions">
        <button className="ac-btn" onClick={() => onSave(form)}>Speichern</button>
        <button className="ac-btn primary" onClick={onNext}>Weiter zu den Beispielen</button>
      </div>
    </section>
  );
}

// ============================ Schritt 2: Beispiele ============================
function ExamplesStep({ letterId, examples, groups, onSaved, onNext }: any) {
  const answered = examples.filter((e: any) => e.situation || e.contribution || e.result);
  return (
    <section className="ms-sec">
      <h3>Persönliche Beispiele</h3>
      <p className="ms-lead">
        Die Qualität entsteht hier. Beantworte, was du beantworten kannst – unbeantwortete Fragen
        bleiben sichtbar und blockieren nichts. Bereits beantwortete Fragen werden nicht erneut gestellt.
      </p>

      {answered.length > 0 && (
        <div className="ms-answered">
          <b>{answered.length} beantwortet</b>
          <ul>{answered.map((e: any, i: number) => <li key={i}>{e.question}{e.isPlanned ? " (geplant)" : ""}</li>)}</ul>
        </div>
      )}

      {groups.length === 0
        ? <div className="ms-gap">Alle Rückfragen sind beantwortet.</div>
        : groups.map((g: any) => (
          <div key={g.key} className="ms-group">
            <h4>{g.title}</h4>
            {g.questions.map((q: any) => (
              <ExampleForm key={q.key} letterId={letterId} q={q} onSaved={onSaved} />
            ))}
          </div>
        ))}

      <div className="ms-actions">
        <button className="ac-btn primary" onClick={onNext}>Weiter zum Hochschul-Bezug</button>
      </div>
    </section>
  );
}

function ExampleForm({ letterId, q, onSaved }: any) {
  const [v, setV] = useState({ situation: "", contribution: "", result: "", link: "", isPlanned: false });
  const [saving, setSaving] = useState(false);
  const filled = v.situation.trim() || v.contribution.trim();

  async function save() {
    if (!filled) return;
    setSaving(true);
    const r = await api("/api/motivation/examples", {
      method: "PUT",
      json: { letterId, questionKey: q.key, question: q.question, ...v }
    });
    setSaving(false);
    if (!r.ok) { notify(r.message || "Die Antwort konnte nicht gespeichert werden.", true); return; }
    notify("Antwort gespeichert.");
    onSaved();
  }

  return (
    <div className="ms-q">
      <div className="ms-q-t">{q.question}</div>
      {q.hint && <div className="ms-hint">{q.hint}</div>}
      <div className="ms-q-grid">
        <label className="ms-field"><span className="ms-label">Situation</span>
          <textarea rows={2} value={v.situation} onChange={(e) => setV({ ...v, situation: e.target.value })} /></label>
        <label className="ms-field"><span className="ms-label">Mein Beitrag</span>
          <textarea rows={2} value={v.contribution} onChange={(e) => setV({ ...v, contribution: e.target.value })} /></label>
        <label className="ms-field"><span className="ms-label">Ergebnis oder Erkenntnis</span>
          <textarea rows={2} value={v.result} onChange={(e) => setV({ ...v, result: e.target.value })} /></label>
        <label className="ms-field"><span className="ms-label">Bezug zum Studium</span>
          <textarea rows={2} value={v.link} onChange={(e) => setV({ ...v, link: e.target.value })} /></label>
      </div>
      <label className="ms-check">
        <input type="checkbox" checked={v.isPlanned} onChange={(e) => setV({ ...v, isPlanned: e.target.checked })} />
        <span>Das ist erst geplant, noch nicht geschehen</span>
      </label>
      <button className="ac-btn" onClick={() => void save()} disabled={!filled || saving}>
        {saving ? "Wird gespeichert…" : "Antwort speichern"}
      </button>
    </div>
  );
}

// ============================ Schritt 3: Hochschul-Bezug ============================
function ReferenceStep({ reqs, letter, onPatch, onNext }: any) {
  const [inst, setInst] = useState(letter.institution);
  const [prog, setProg] = useState(letter.programme);
  const [intake, setIntake] = useState(letter.intake || "");
  useEffect(() => { setInst(letter.institution); setProg(letter.programme); setIntake(letter.intake || ""); }, [letter.id, letter.institution, letter.programme, letter.intake]);

  return (
    <section className="ms-sec">
      <h3>Hochschule und Anforderungen</h3>
      <p className="ms-lead">
        Voreingestellt ist die WHU. Du kannst die Angaben frei ändern – dann gelten die unten
        gezeigten WHU-Vorgaben nur noch eingeschränkt.
      </p>

      <div className="ms-grid">
        <label className="ms-field wide"><span className="ms-label">Hochschule</span>
          <input value={inst} onChange={(e) => setInst(e.target.value)} onBlur={() => onPatch({ institution: inst, preset: "custom" })} /></label>
        <label className="ms-field wide"><span className="ms-label">Studiengang</span>
          <input value={prog} onChange={(e) => setProg(e.target.value)} onBlur={() => onPatch({ programme: prog, preset: "custom" })} /></label>
        <label className="ms-field"><span className="ms-label">Studienstart</span>
          <input value={intake} onChange={(e) => setIntake(e.target.value)} onBlur={() => onPatch({ intake })} /></label>
      </div>

      {reqs && (
        <>
          <h4>Verbindliche Vorgaben</h4>
          <ul className="ms-reqlist">
            {reqs.requirements.filter((r: any) => r.kind === "binding").map((r: any) => (
              <li key={r.id}><b>{r.label}</b>{r.detail ? <> – {r.detail}</> : null}
                <SourceLinks ids={r.sourceIds} sources={reqs.sources} /></li>
            ))}
          </ul>

          <h4>Hinweise der Hochschule (unverbindlich)</h4>
          <ul className="ms-reqlist tip">
            {reqs.requirements.filter((r: any) => r.kind === "tip").map((r: any) => (
              <li key={r.id}><b>{r.label}</b>{r.detail ? <> – {r.detail}</> : null}
                <SourceLinks ids={r.sourceIds} sources={reqs.sources} /></li>
            ))}
          </ul>

          <h4>Eigene Empfehlungen dieser Anwendung</h4>
          <ul className="ms-reqlist own">
            {reqs.requirements.filter((r: any) => r.kind === "own").map((r: any) => (
              <li key={r.id}><b>{r.label}</b>{r.detail ? <> – {r.detail}</> : null}</li>
            ))}
          </ul>

          <h4>Ausdrücklich nicht vorgegeben</h4>
          <ul className="ms-reqlist muted">
            {reqs.notSpecified.map((n: any, i: number) => <li key={i}><b>{n.topic}:</b> {n.note}</li>)}
          </ul>

          <h4>Überprüfbare Merkmale des Programms</h4>
          <ul className="ms-reqlist">
            {reqs.programmeFacts.map((f: any, i: number) => (
              <li key={i}>{f.fact}<SourceLinks ids={f.sourceIds} sources={reqs.sources} /></li>
            ))}
          </ul>

          {reqs.admission && (
            <>
              <h4>Fristen und Verfahren</h4>
              <div className="ms-gap">
                <div>Bewerbungszeitraum: {reqs.admission.applicationWindow}</div>
                <div>Studienbeginn: {reqs.admission.studyStart}</div>
                <ul>
                  {reqs.admission.rounds.map((r: any) => (
                    <li key={r.name}>{r.name}: Frist {r.applicationDeadline} · Test {r.writtenTest} · Interviews {r.interviews}</li>
                  ))}
                </ul>
                <div>{reqs.admission.proofDeadline}</div>
              </div>
            </>
          )}

          {reqs.conflicts?.length > 0 && (
            <>
              <h4>Abweichungen zwischen den Quellen</h4>
              <ul className="ms-reqlist muted">
                {reqs.conflicts.map((c: any, i: number) => <li key={i}><b>{c.topic}:</b> {c.note}</li>)}
              </ul>
            </>
          )}
        </>
      )}

      <div className="ms-actions">
        <button className="ac-btn primary" onClick={onNext}>Weiter zur Gliederung</button>
      </div>
    </section>
  );
}

function SourceLinks({ ids, sources }: any) {
  const list = (ids || []).map((id: string) => sources.find((s: any) => s.id === id)).filter(Boolean);
  if (!list.length) return null;
  return (
    <span className="ms-src">
      {list.map((s: any) => (
        <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" title={`${s.title} (abgerufen ${s.retrievedAt})`}>Quelle</a>
      ))}
    </span>
  );
}

// ============================ Schritt 4: Gliederung ============================
function OutlineStep({ letter, busy, missing, onGenerate, onChange, onNext }: any) {
  const [rows, setRows] = useState<any[]>(letter.outline || []);
  useEffect(() => { setRows(letter.outline || []); }, [letter.outline]);

  function update(i: number, key: string, value: string) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r));
    setRows(next);
  }

  return (
    <section className="ms-sec">
      <h3>Gliederung</h3>
      <p className="ms-lead">Eine Vorschau der Struktur – frei bearbeitbar, bevor ein Text entsteht.</p>

      <button className="ac-btn" onClick={onGenerate} disabled={busy === "outline"}>
        {busy === "outline" ? <><span className="spin sm" /> Wird erstellt…</> : "Gliederung vorschlagen"}
      </button>

      {missing?.length > 0 && (
        <div className="ms-gap"><b>Fehlende Angaben:</b>
          <ul>{missing.map((m: string, i: number) => <li key={i}>{m}</li>)}</ul></div>
      )}

      <div className="ms-outline">
        {rows.map((r, i) => (
          <div key={r.id || i} className="ms-outline-row">
            <span className="ms-step-n">{i + 1}</span>
            <div className="ms-outline-f">
              <input value={r.heading} onChange={(e) => update(i, "heading", e.target.value)} onBlur={() => onChange(rows)} aria-label={`Überschrift ${i + 1}`} />
              <textarea rows={2} value={r.intent} onChange={(e) => update(i, "intent", e.target.value)} onBlur={() => onChange(rows)} aria-label={`Zweck ${i + 1}`} />
            </div>
            <button className="ac-btn tiny" aria-label={`Abschnitt ${i + 1} entfernen`}
              onClick={() => { const next = rows.filter((_, idx) => idx !== i); setRows(next); onChange(next); }}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        ))}
      </div>
      <button className="ac-btn tiny" onClick={() => {
        const next = [...rows, { id: `s${Date.now()}`, heading: "Neuer Abschnitt", intent: "" }];
        setRows(next); onChange(next);
      }}>+ Abschnitt</button>

      <div className="ms-actions">
        <button className="ac-btn primary" onClick={onNext}>Weiter zum Entwurf</button>
      </div>
    </section>
  );
}

// ============================ Schritt 5: Entwurf ============================
function DraftStep({ draft, setDraft, counts, busy, missing, sources, wish, setWish,
  targeted, onGenerate, onWish, onAcceptChange, onAcceptAll, onDiscardTargeted, onNext }: any) {
  const writing = busy === "draft";
  return (
    <section className="ms-sec">
      <h3>Schreiben &amp; Bearbeiten</h3>

      {!draft.trim() ? (
        <>
          <p className="ms-lead">
            Claude schreibt dir einen vollständigen Entwurf aus deinen hinterlegten Unterlagen
            (Lebenslauf, Zeugnisse, bestätigte Angaben) und deinem Profil. Danach kannst du alles
            selbst bearbeiten oder gezielt ändern lassen.
          </p>
          <button className="ac-btn primary big" onClick={onGenerate} disabled={writing}>
            {writing ? <><span className="spin sm" /> Claude schreibt…</> : "Motivationsschreiben jetzt schreiben lassen"}
          </button>
          <div className="ms-hint" style={{ marginTop: 10 }}>
            Es werden keine Tatsachen erfunden. Was fehlt, wird dir danach angezeigt.
          </div>
        </>
      ) : (
        <p className="ms-lead">
          Bearbeite den Text direkt im Feld – es wird automatisch gespeichert. Oder sag unten in
          eigenen Worten, was geändert werden soll; dann fasst Claude nur die betroffene Stelle an.
        </p>
      )}

      <SourceInfo sources={sources} />

      {missing?.length > 0 && (
        <div className="ms-gap"><b>Dafür fehlten Angaben – bitte selbst prüfen und ergänzen:</b>
          <ul>{missing.map((m: string, i: number) => <li key={i}>{m}</li>)}</ul></div>
      )}

      {draft.trim() && (
        <>
          <textarea
            className="ms-editor" value={draft} onChange={(e) => setDraft(e.target.value)}
            rows={22} aria-label="Text des Motivationsschreibens"
          />
          <div className="ms-actions left">
            <span className="ms-counts">{counts.words} Wörter · {counts.chars} Zeichen · {counts.paragraphs} Absätze</span>
            <span className="ms-hint" style={{ margin: 0 }}>
              Verbindlich sind zwei DIN-A4-Seiten – das prüft der Export, nicht die Wortzahl.
            </span>
          </div>

          {/* Freitext-Änderungswunsch */}
          <div className="ms-wish">
            <label className="ms-label" htmlFor="ms-wish-input">Was soll geändert werden?</label>
            <div className="ms-wish-row">
              <input
                id="ms-wish-input" value={wish} onChange={(e) => setWish(e.target.value)}
                placeholder="z. B. den Absatz über Karate konkreter machen"
                onKeyDown={(e) => { if (e.key === "Enter" && wish.trim() && !busy) { e.preventDefault(); onWish(); } }}
              />
              <button className="ac-btn primary" onClick={onWish} disabled={!wish.trim() || busy === "wish"}>
                {busy === "wish" ? <><span className="spin sm" /> Wird geändert…</> : "Ändern"}
              </button>
            </div>
            <div className="ms-hint">
              Claude sucht selbst die passende Stelle und ändert nur diese. Du siehst den Vorschlag,
              bevor etwas übernommen wird.
            </div>
          </div>

          {targeted && (
            <div className="ms-changes">
              <h4>Vorgeschlagene Änderungen ({targeted.changes.length})</h4>
              {targeted.note && <div className="ms-gap">{targeted.note}</div>}
              {targeted.changes.map((c: any) => (
                <div key={c.index} className={"ms-change" + (targeted.accepted?.[c.index] ? " done" : "")}>
                  <div className="ms-change-h">
                    <span>Absatz {c.index + 1}</span>
                    {c.reason && <span className="ms-change-r">{c.reason}</span>}
                  </div>
                  <div className="ms-cmp">
                    <div><h4>Bisher</h4><p>{c.before}</p></div>
                    <div><h4>Vorschlag</h4><p>{c.after}</p></div>
                  </div>
                  <button className="ac-btn tiny" disabled={!!targeted.accepted?.[c.index]}
                    onClick={() => onAcceptChange(c.index, c.after)}>
                    {targeted.accepted?.[c.index] ? "Übernommen" : "Diesen übernehmen"}
                  </button>
                </div>
              ))}
              <div className="ms-actions left">
                <button className="ac-btn primary" onClick={onAcceptAll}>Alle übernehmen</button>
                <button className="ac-btn" onClick={onDiscardTargeted}>Verwerfen</button>
              </div>
            </div>
          )}

          <div className="ms-actions">
            <button className="ac-btn" onClick={onGenerate} disabled={writing}>
              {writing ? "Wird geschrieben…" : "Komplett neu schreiben"}
            </button>
            <button className="ac-btn primary" onClick={onNext}>Weiter zu Prüfung &amp; Export</button>
          </div>
        </>
      )}
    </section>
  );
}

// Zeigt, worauf der Entwurf beruht – damit nachvollziehbar ist, welche
// Unterlagen verwendet wurden.
function SourceInfo({ sources }: any) {
  if (!sources) return null;
  const docs = sources.documents || [];
  if (!sources.factCount && !docs.length) {
    return (
      <div className="ms-gap">
        <b>Keine Unterlagen gefunden.</b> Lade unter „Bewerbung → Meine Unterlagen“ deinen Lebenslauf
        und Zeugnisse hoch und bestätige die erkannten Angaben – dann wird der Entwurf deutlich konkreter.
      </div>
    );
  }
  return (
    <div className="ms-srcinfo">
      <b>Verwendet:</b> {sources.factCount} bestätigte Angabe(n)
      {docs.length > 0 && <> · {docs.length} Unterlage(n): {docs.map((d: any) => d.name).join(", ")}</>}
    </div>
  );
}

// ============================ Schritt 6: Überarbeitung ============================
function RefineStep({ draft, busy, compare, onRefine, onApply, onDiscard, versions, onRestore, onNext }: any) {
  const paras = splitParagraphs(draft);
  if (!paras.length) return <section className="ms-sec"><h3>Überarbeitung</h3><div className="ms-gap">Es gibt noch keinen Text. Erstelle zuerst einen Entwurf.</div></section>;

  return (
    <section className="ms-sec">
      <h3>Absatzweise überarbeiten</h3>
      <p className="ms-lead">
        Vorschläge werden erst nach deinem Vergleich übernommen. Deine manuellen Änderungen bleiben
        bis dahin unangetastet.
      </p>

      {paras.map((p: string, i: number) => (
        <div key={i} className="ms-para">
          <p>{p}</p>
          <div className="ms-para-a">
            {REFINE_BUTTONS.map((b) => (
              <button key={b.key} className="ac-btn tiny" disabled={busy === `refine-${i}`} onClick={() => onRefine(i, b.key)}>
                {busy === `refine-${i}` ? "…" : b.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      {compare && (
        <div className="ac-modal-scrim" onClick={onDiscard}>
          <div className="ac-modal ms-compare" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Vorschlag vergleichen">
            <div className="ac-modal-h"><h3>Vorschlag vergleichen</h3></div>
            <div className="ac-modal-b">
              {compare.note && <div className="ms-gap">{compare.note}</div>}
              <div className="ms-cmp">
                <div><h4>Bisher</h4><p>{compare.before}</p></div>
                <div><h4>Vorschlag</h4><p>{compare.after}</p></div>
              </div>
            </div>
            <div className="ac-modal-f">
              <button className="ac-btn primary" onClick={onApply}>Übernehmen</button>
              <button className="ac-btn" onClick={onDiscard}>Verwerfen</button>
            </div>
          </div>
        </div>
      )}

      {versions?.length > 0 && (
        <>
          <h4>Versionen</h4>
          <ul className="ms-versions">
            {versions.map((v: any) => (
              <li key={v.id}>
                <span>{new Date(v.created_at).toLocaleString("de-DE")} · {v.label || v.origin}</span>
                <button className="ac-btn tiny" onClick={() => onRestore(v.id)} disabled={busy === "restore"}>Wiederherstellen</button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="ms-actions">
        <button className="ac-btn primary" onClick={onNext}>Weiter zu Prüfung &amp; Export</button>
      </div>
    </section>
  );
}

// ============================ Schritt 7: Prüfen & Export ============================
function ExportStep({ check, counts, busy, reqs, profile, letterId, draftText, onCheck, onExport, onCopy }: any) {
  const fileName = profile?.lastName && profile?.firstName
    ? `${profile.lastName}_${profile.firstName}_LM.pdf`.replace(/\s+/g, "")
    : "Nachname_Vorname_LM.pdf";

  return (
    <section className="ms-sec">
      <h3>Prüfen &amp; Export</h3>
      <p className="ms-lead">
        Die Prüfung setzt das PDF wirklich und zählt die entstandenen Seiten – nicht die Wörter.
        Es gibt bewusst keine Einschätzung deiner Zulassungschance.
      </p>

      <div className="ms-actions left">
        <button className="ac-btn" onClick={onCheck} disabled={busy === "check"}>
          {busy === "check" ? <><span className="spin sm" /> Wird geprüft…</> : "Jetzt prüfen"}
        </button>
        <span className="ms-counts">{counts.words} Wörter · {counts.chars} Zeichen</span>
      </div>

      {check && (
        <>
          <div className={"ms-pages" + (check.fits === false ? " bad" : check.fits ? " good" : "")}>
            {check.pages == null
              ? "Seitenzahl konnte nicht ermittelt werden."
              : check.fits
                ? `${check.pages} gesetzte Seite(n) – die Vorgabe von höchstens 2 Seiten ist eingehalten.`
                : `${check.pages} gesetzte Seiten – erlaubt sind höchstens 2. Bitte inhaltlich kürzen.`}
          </div>

          <h4>Verbindliche Vorgaben</h4>
          <ul className="ms-checklist">
            {check.requirements.map((r: any) => (
              <li key={r.id} className={r.status}>
                <span className="ms-ck-ic">{r.status === "ok" ? "✓" : r.status === "fehlt" ? "✕" : "•"}</span>
                <span><b>{r.label}</b>{r.hint ? <> – {r.hint}</> : null}</span>
              </li>
            ))}
          </ul>

          <h4>Verbesserungsvorschläge</h4>
          {check.quality.length === 0
            ? <div className="ms-gap">Keine Auffälligkeiten gefunden.</div>
            : <ul className="ms-checklist">
              {check.quality.map((q: any, i: number) => (
                <li key={i} className={q.severity === "wichtig" ? "fehlt" : "manuell"}>
                  <span className="ms-ck-ic">{q.severity === "wichtig" ? "!" : "•"}</span>
                  <span><b>{q.message}</b><br />{q.suggestion}</span>
                </li>
              ))}
            </ul>}

          {check.missingProfile?.length > 0 && (
            <div className="ms-gap"><b>Im Profil fehlen noch:</b> {check.missingProfile.join(", ")}</div>
          )}
        </>
      )}

      <ReviewPanel letterId={letterId} body={draftText} />

      <h4>Export</h4>
      <div className="ms-hint">Dateiname nach WHU-Muster: <b>{fileName}</b></div>
      <div className="ms-actions left">
        <button className="ac-btn primary" onClick={() => onExport("pdf")} disabled={busy === "export-pdf"}>
          {busy === "export-pdf" ? "PDF wird erzeugt…" : "Als PDF laden"}
        </button>
        <button className="ac-btn" onClick={() => onExport("docx")} disabled={busy === "export-docx"}>
          {busy === "export-docx" ? "DOCX wird erzeugt…" : "Als DOCX laden"}
        </button>
        <button className="ac-btn" onClick={onCopy}>Text kopieren</button>
      </div>

      {reqs?.sources?.length > 0 && (
        <div className="ms-sources">
          <b>Quellen der Anforderungen</b> (nur hier, nicht im Bewerbungstext):
          <ul>
            {reqs.sources.map((s: any) => (
              <li key={s.id}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> · abgerufen {s.retrievedAt}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
