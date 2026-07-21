"use client";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { PROVIDERS } from "@/lib/mailProviders";

type Msg = any;

const BUCKETS: { k: string; t: string; c: string }[] = [
  { k: "sofort", t: "Sofort beantworten", c: "#FF453A" },
  { k: "heute", t: "Heute beantworten", c: "#FF9F0A" },
  { k: "woche", t: "Diese Woche beantworten", c: "#0A84FF" },
  { k: "spaeter", t: "Später beantworten", c: "#98989D" },
  { k: "warten", t: "Warten auf Antwort", c: "#BF5AF2" },
  { k: "info", t: "Nur zur Information", c: "#30D158" },
  { k: "newsletter", t: "Newsletter & Automatisch", c: "#98989D" }
];
const TONES = ["Professionell", "Freundlich", "Kurz und direkt", "Förmlich", "Locker"];
const COMMANDS = ["Kürzer", "Freundlicher", "Förmlicher", "Direkter", "Wärmer", "Weniger begeistert", "Mehr Kontext", "Rechtschreibung prüfen"];

type Account = { id: string; email: string; provider: string };

export default function Cockpit({
  connected,
  accounts,
  sendEnabled
}: {
  connected: boolean;
  accounts: Account[];
  sendEnabled: boolean;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [suggests, setSuggests] = useState<Record<string, any[]>>({});
  const [drawer, setDrawer] = useState<any>(null); // { msg, mode, loading, draft, body, tone, customInstruction, confirmBinding, sending }
  const uidRef = useRef<string | null>(null);

  // ---- Live-Daten aus Supabase (Realtime) ----
  useEffect(() => {
    const supabase = supabaseBrowser();
    let channel: any;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      uidRef.current = user.id;
      const { data } = await supabase.from("messages").select("*").eq("is_deleted", false).order("received_at", { ascending: false });
      setMsgs(data || []);
      channel = supabase
        .channel("messages-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `user_id=eq.${user.id}` }, (payload: any) => {
          setMsgs((prev) => {
            const row = payload.new || payload.old;
            if (!row) return prev;
            if (payload.eventType === "DELETE") return prev.filter((m) => m.id !== row.id);
            const next = prev.filter((m) => m.id !== row.id);
            if (!row.is_deleted) next.unshift(row);
            return next.sort((a, b) => new Date(b.received_at || 0).getTime() - new Date(a.received_at || 0).getTime());
          });
        })
        .subscribe();
    })();
    return () => { if (channel) channel.unsubscribe(); };
  }, []);

  // ---- Beim Öffnen einmal synchronisieren (holt neue Mails) ----
  useEffect(() => {
    if (!connected) return;
    manualSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // ---- Vorschläge lazy laden (nur für zu beantwortende, noch nicht gesendete Mails) ----
  async function ensureSuggestions(m: Msg) {
    if (suggests[m.id]) return;
    if (m.suggested_replies) { setSuggests((s) => ({ ...s, [m.id]: m.suggested_replies })); return; }
    setSuggests((s) => ({ ...s, [m.id]: [] })); // Platzhalter, verhindert Doppelabruf
    try {
      const r = await fetch("/api/reply/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: m.id }) });
      if (r.ok) { const j = await r.json(); setSuggests((s) => ({ ...s, [m.id]: j.suggestions || [] })); }
    } catch {}
  }

  function visible(m: Msg) {
    if (m.is_deleted) return false;
    if (m.hidden && !showHidden) return false;
    return true;
  }

  async function manualSync() {
    setStatus((s: any) => ({ ...s, syncing: true }));
    let errors: string[] = [];
    try {
      const r = await fetch("/api/mail/sync", { method: "POST" });
      if (r.ok) {
        const j = await r.json();
        errors = j.errors || [];
      }
    } catch {}
    // Nachrichten frisch laden (Realtime pusht sonst nur neue Inserts).
    try {
      const supabase = supabaseBrowser();
      const { data } = await supabase.from("messages").select("*").eq("is_deleted", false).order("received_at", { ascending: false });
      setMsgs(data || []);
    } catch {}
    setStatus({ syncing: false, errors });
  }

  // ---- Entwurf erzeugen (aus Vorschlag oder Freitext) ----
  async function openDraft(m: Msg, opts: { intent?: string; intentLabel?: string; custom?: boolean }) {
    if (opts.custom) {
      setDrawer({ msg: m, mode: "custom", customInstruction: "", tone: "Professionell" });
      return;
    }
    setDrawer({ msg: m, mode: "generated", loading: true, tone: null });
    await generate(m, { intent: opts.intent, intentLabel: opts.intentLabel, tone: undefined });
  }

  async function generate(m: Msg, p: { intent?: string; intentLabel?: string; customInstruction?: string; tone?: string }) {
    setDrawer((d: any) => ({ ...d, loading: true }));
    try {
      const r = await fetch("/api/reply/generate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: m.id, intent: p.intent, intentLabel: p.intentLabel, customInstruction: p.customInstruction, tone: p.tone })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Fehler");
      setDrawer((d: any) => ({
        ...d, mode: "generated", loading: false, draft: j.draft, body: j.draft.body,
        tone: j.draft.tone, outlookSynced: j.outlookSynced,
        intent: p.intent, intentLabel: p.intentLabel, customInstruction: p.customInstruction, confirmBinding: false
      }));
    } catch (e: any) {
      setDrawer((d: any) => ({ ...d, loading: false, error: e.message }));
    }
  }

  async function refine(command: string) {
    if (!drawer) return;
    setDrawer((d: any) => ({ ...d, refining: true }));
    try {
      const r = await fetch("/api/reply/refine", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: drawer.msg.id, command }) });
      const j = await r.json();
      if (r.ok) setDrawer((d: any) => ({ ...d, body: j.body, refining: false }));
      else setDrawer((d: any) => ({ ...d, refining: false }));
    } catch { setDrawer((d: any) => ({ ...d, refining: false })); }
  }

  async function changeTone(tone: string) {
    if (!drawer) return;
    setDrawer((d: any) => ({ ...d, tone }));
    await generate(drawer.msg, { intent: drawer.intent, intentLabel: drawer.intentLabel, customInstruction: drawer.customInstruction, tone });
  }

  async function saveEdited() {
    if (!drawer) return;
    await fetch("/api/reply/refine", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: drawer.msg.id, editedBody: drawer.body }) });
  }

  async function send() {
    if (!drawer) return;
    setDrawer((d: any) => ({ ...d, sending: true }));
    await saveEdited(); // aktuellen (ggf. bearbeiteten) Text sichern
    try {
      const r = await fetch("/api/reply/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: drawer.msg.id, confirm: true }) });
      const j = await r.json();
      if (r.ok) setDrawer(null);
      else setDrawer((d: any) => ({ ...d, sending: false, error: j.message || j.error }));
    } catch (e: any) { setDrawer((d: any) => ({ ...d, sending: false, error: e.message })); }
  }

  const statusView = () => {
    if (!connected) return <span className="status"><span className="sdot" />Kein Postfach verbunden</span>;
    if (status?.syncing) return <span className="status sync"><span className="sdot" />Synchronisierung läuft…</span>;
    if (status?.errors && status.errors.length) return <span className="status err"><span className="sdot" />Sync-Fehler</span>;
    return <span className="status live"><span className="sdot" />Verbunden · {accounts.length} Postfach{accounts.length === 1 ? "" : "er"}</span>;
  };

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <span className="mark" />
          <h1>Cockpit</h1>
        </div>
        <div className="spacer" />
        {statusView()}
        {connected && <button className="btn small ghost" onClick={manualSync} aria-label="Aktualisieren" title="Aktualisieren">↻</button>}
        <button className="btn btn-primary small" onClick={() => setShowConnect((v) => !v)}>
          {connected ? "+ Postfach" : "Postfach verbinden"}
        </button>
      </div>

      <div className="wrap">
        {(showConnect || !connected) && <ConnectForm accounts={accounts} onClose={() => setShowConnect(false)} />}

        {status?.errors && status.errors.length > 0 && (
          <div className="note binding-warn" style={{ marginBottom: 18 }}>
            <b>Synchronisierung fehlgeschlagen:</b>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {status.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn small" onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? "Newsletter verbergen" : "Newsletter einblenden"}
          </button>
        </div>

        {BUCKETS.map((bk) => {
          const list = msgs.filter((m) => visible(m) && (m.category || "info") === bk.k);
          if (!list.length) return null;
          return (
            <div className="bucket" key={bk.k}>
              <div className="bh"><span className="bd" style={{ background: bk.c }} /><span className="bt">{bk.t}</span><span className="bc">{list.length}</span></div>
              {list.map((m) => (
                <MailCard key={m.id} m={m} suggests={suggests[m.id]} ensure={ensureSuggestions} onReply={openDraft} />
              ))}
            </div>
          );
        })}

        {connected && msgs.length === 0 && status?.syncing && (
          <div className="bucket">{[0, 1, 2, 3].map((i) => <div className="sk-card" key={i} />)}</div>
        )}
        {connected && msgs.length === 0 && !status?.syncing && (
          <div className="empty">
            <div className="ic">✦</div>
            Für heute ist alles ruhig.
            <div className="sub">Keine neuen E-Mails im Posteingang.</div>
          </div>
        )}
      </div>

      <div className={"scrim" + (drawer ? " open" : "")} onClick={() => !drawer?.sending && setDrawer(null)} />
      <aside className={"drawer" + (drawer ? " open" : "")}>
        {drawer && <DraftPanel
          drawer={drawer} setDrawer={setDrawer} sendEnabled={sendEnabled}
          onGenerateCustom={() => generate(drawer.msg, { customInstruction: drawer.customInstruction, tone: drawer.tone })}
          onRefine={refine} onChangeTone={changeTone} onSend={send}
          onRegenerate={() => generate(drawer.msg, { intent: drawer.intent, intentLabel: drawer.intentLabel, customInstruction: drawer.customInstruction, tone: drawer.tone })}
        />}
      </aside>
    </>
  );
}

function ConnectForm({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const providerList = Object.values(PROVIDERS);
  const [provider, setProvider] = useState(providerList[0].id);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const preset = PROVIDERS[provider];

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/mail/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, email, password })
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error || "Verbindung fehlgeschlagen.");
        setBusy(false);
        return;
      }
      // Erfolg → Seite neu laden, damit Postfach + Mails erscheinen.
      window.location.reload();
    } catch (e: any) {
      setErr(e.message || "Netzwerkfehler.");
      setBusy(false);
    }
  }

  async function disconnect(id: string) {
    if (!confirm("Dieses Postfach trennen? Die geladenen Mails werden entfernt.")) return;
    await fetch("/api/mail/disconnect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id })
    });
    window.location.reload();
  }

  return (
    <div className="bucket" style={{ marginBottom: 18 }}>
      <div className="bh"><span className="bt">Postfach verbinden</span></div>
      <div style={{ padding: "4px 2px" }}>
        {accounts.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            {accounts.map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
                <span className="sdot" style={{ background: "#30D158" }} />
                <span style={{ flex: 1 }}>{a.email} <span style={{ opacity: 0.6 }}>({PROVIDERS[a.provider]?.label || a.provider})</span></span>
                <button className="btn small" onClick={() => disconnect(a.id)}>Trennen</button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={connect} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 460 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ opacity: 0.7, fontSize: 13 }}>Anbieter</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {providerList.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ opacity: 0.7, fontSize: 13 }}>E-Mail-Adresse</span>
            <input type="email" required placeholder="name@icloud.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ opacity: 0.7, fontSize: 13 }}>Passwort</span>
            <input type="password" required placeholder="App-Passwort" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <div className="note" style={{ fontSize: 13 }}>{preset?.passwordHint}</div>
          {err && <div className="note binding-warn">{err}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" disabled={busy}>{busy ? "Verbinde…" : "Verbinden"}</button>
            <button type="button" className="btn" onClick={onClose}>Schließen</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MailCard({ m, suggests, ensure, onReply }: any) {
  const canReply = m.needs_reply && m.draft_status !== "gesendet" && !m.hidden && m.category !== "warten";
  useEffect(() => { if (canReply) ensure(m); }, [m.id]); // eslint-disable-line
  return (
    <div className="mail">
      <div className="m-top">
        <span className="m-from">{m.from_name || m.from_address}</span>
        {m.draft_status === "gesendet" ? <span className="badge sent">Gesendet</span>
          : m.status === "analyzing" ? <span className="badge analyzing">Wird analysiert…</span>
          : m.needs_reply ? <span className="badge reply">Antwort nötig</span> : null}
        <span className="m-time">{m.received_at ? new Date(m.received_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}</span>
      </div>
      <div className="m-subj">{m.subject || "(kein Betreff)"}</div>
      {m.preview && <div className="m-sum">{m.preview}</div>}

      {canReply && (
        <div className="suggests">
          {(suggests && suggests.length ? suggests : []).map((s: any, i: number) => (
            <button key={i} className={"sug" + (s.binding ? " binding" : "")} title={s.explanation}
              onClick={() => onReply(m, { intent: s.intent, intentLabel: s.label })}>{s.label}</button>
          ))}
          {(!suggests || !suggests.length) && <span className="sug" style={{ pointerEvents: "none" }}><span className="spin" /></span>}
          <button className="sug custom" onClick={() => onReply(m, { custom: true })}>Eigene Antwort</button>
        </div>
      )}
      {m.draft_status === "gesendet" && m.reply_sent_at && (
        <div className="note" style={{ marginTop: 10 }}>Antwort gesendet am {new Date(m.reply_sent_at).toLocaleString("de-DE")}.</div>
      )}
    </div>
  );
}

function DraftPanel({ drawer, setDrawer, sendEnabled, onGenerateCustom, onRefine, onChangeTone, onSend, onRegenerate }: any) {
  const m = drawer.msg;
  const d = drawer.draft;
  return (
    <>
      <div className="dh">
        <div>
          <h3>Antwort an {m.from_name || m.from_address}</h3>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>{m.subject}</div>
        </div>
        <button className="x" onClick={() => !drawer.sending && setDrawer(null)}>✕</button>
      </div>

      <div className="db">
        {drawer.mode === "custom" && !d ? (
          <>
            <div className="label">Wie möchtest du antworten?</div>
            <input className="custom-input" placeholder="Zum Beispiel: Zusagen und nach dem Startdatum fragen."
              value={drawer.customInstruction} autoFocus
              onChange={(e) => setDrawer((x: any) => ({ ...x, customInstruction: e.target.value }))} />
            <div className="df" style={{ padding: "14px 0 0", borderTop: 0 }}>
              <button className="btn btn-primary" disabled={!drawer.customInstruction?.trim() || drawer.loading} onClick={onGenerateCustom}>
                {drawer.loading ? <><span className="spin" /> Erstelle…</> : "Entwurf erstellen"}
              </button>
              <button className="btn" onClick={() => setDrawer(null)}>Abbrechen</button>
            </div>
          </>
        ) : drawer.loading || !d ? (
          <div className="empty"><span className="spin" /> <div style={{ marginTop: 12 }}>Antwort wird formuliert…</div></div>
        ) : (
          <>
            <div className="meta-row">
              <span className="k">Empfänger</span><span className="v">{m.from_name || ""} &lt;{m.from_address}&gt;</span>
              <span className="k">Betreff</span><span className="v">{d.subject}</span>
              <span className="k">Reaktion</span><span className="v">{drawer.customInstruction ? "Eigene Antwort" : drawer.intentLabel}</span>
              <span className="k">Tonalität</span><span className="v">{drawer.tone || d.tone}</span>
              <span className="k">Sprache</span><span className="v">{d.language}</span>
            </div>

            <div className="label">Tonalität ändern</div>
            <div className="chips">
              {TONES.map((t) => (
                <button key={t} className={"chip" + ((drawer.tone || d.tone) === t ? " sel" : "")} onClick={() => onChangeTone(t)} disabled={drawer.loading}>{t}</button>
              ))}
            </div>

            <div className="label">Entwurf (bearbeitbar)</div>
            <textarea className="editor" value={drawer.body} onChange={(e) => setDrawer((x: any) => ({ ...x, body: e.target.value }))} />

            <div className="label">Schnelle Bearbeitung</div>
            <div className="chips">
              {COMMANDS.map((c) => (
                <button key={c} className="chip cmd" onClick={() => onRefine(c)} disabled={drawer.refining}>{c}</button>
              ))}
              {drawer.refining && <span className="spin" style={{ alignSelf: "center" }} />}
            </div>

            {d.missing_info && <div className="note warn"><b>Fehlende Information:</b> {d.missing_info} — bitte vor dem Senden prüfen.</div>}
            {d.needs_attachment && <div className="note warn"><b>Anhang beachten:</b> In dieser Unterhaltung werden Unterlagen angefordert. Prüfe vor dem Senden, ob die benötigten Dateien angehängt sind (Anhänge fügst du direkt in Outlook hinzu).</div>}
            {drawer.outlookSynced === false && <div className="note">Hinweis: Der Entwurf konnte nicht mit Outlook synchronisiert werden und ist vorerst nur im Cockpit gespeichert.</div>}
            {drawer.outlookSynced && <div className="note">Als echter Entwurf in deinem Outlook unter „Entwürfe" gespeichert.</div>}
            {d.binding && <div className="note binding-warn"><b>Achtung – verbindliche Antwort:</b> Diese Antwort enthält eine verbindliche oder sensible Entscheidung. Bitte prüfe den Text genau vor dem Senden.</div>}
            {drawer.error && <div className="note binding-warn">{drawer.error}</div>}
          </>
        )}
      </div>

      {d && !drawer.loading && (
        <div className="df">
          {sendEnabled ? (
            d.binding && !drawer.confirmBinding ? (
              <button className="btn btn-primary" onClick={() => setDrawer((x: any) => ({ ...x, confirmBinding: true }))}>Senden…</button>
            ) : (
              <button className="btn btn-primary" onClick={onSend} disabled={drawer.sending}>
                {drawer.sending ? <><span className="spin" /> Sende…</> : (d.binding ? "Verbindlich senden" : "Senden")}
              </button>
            )
          ) : (
            <button className="btn" disabled title="Versand ist nicht aktiviert – Entwurf liegt in Outlook">Senden (deaktiviert)</button>
          )}
          <button className="btn" onClick={onRegenerate} disabled={drawer.loading}>Neu formulieren</button>
          <button className="btn" onClick={() => setDrawer(null)}>Abbrechen</button>
        </div>
      )}
    </>
  );
}
