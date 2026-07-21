import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import LoginForm from "@/components/LoginForm";
import AppShell from "@/components/AppShell";

export const dynamic = "force-dynamic";

// Nur handlungsrelevante Dinge: aus E-Mails erkannte Fristen + fällige Aufgaben.
// KEINE Auflistung aller Kalendertermine, keine Routinen/Geburtstage als „offen".
export default async function DeadlinesPage() {
  const user = await requireUser();
  if (!user) return <LoginForm />;
  const admin = supabaseAdmin();

  const { data: msgs } = await admin.from("messages")
    .select("id,subject,from_name,from_address,deadline_at,semantic_category")
    .eq("user_id", user.id).eq("is_deleted", false).not("deadline_at", "is", null)
    .order("deadline_at", { ascending: true });
  const { data: tasks } = await admin.from("tasks")
    .select("id,title,due_at,status").eq("user_id", user.id).neq("status", "erledigt").not("due_at", "is", null);

  const now = Date.now();
  type Item = { key: string; when: number; title: string; sub: string; kind: string };
  const items: Item[] = [];
  for (const m of msgs || []) items.push({ key: "m" + m.id, when: new Date(m.deadline_at!).getTime(), title: m.subject || "(kein Betreff)", sub: `Frist aus E-Mail · ${m.from_name || m.from_address || ""}`, kind: "frist" });
  for (const t of tasks || []) items.push({ key: "t" + t.id, when: new Date(t.due_at!).getTime(), title: t.title, sub: "Aufgabe fällig", kind: "aufgabe" });
  items.sort((a, b) => a.when - b.when);

  const day = 864e5;
  const groups: Record<string, Item[]> = { Heute: [], "Diese Woche": [], Demnächst: [], "Später wichtig": [] };
  for (const it of items) {
    const dd = Math.floor((it.when - new Date(new Date().toDateString()).getTime()) / day);
    if (dd <= 0) groups["Heute"].push(it);
    else if (dd <= 7) groups["Diese Woche"].push(it);
    else if (dd <= 30) groups["Demnächst"].push(it);
    else groups["Später wichtig"].push(it);
  }
  const openCount = groups["Heute"].length + groups["Diese Woche"].length;

  return (
    <AppShell active="/deadlines">
      <div className="page">
        <div className="page-head"><h1>Termine & Fristen</h1></div>
        <div className="wrap-inner">
          <div className="stat-row">
            <div className="stat-tile"><span className="stat-n">{openCount}</span><span className="stat-l">offen (heute/Woche)</span></div>
            <div className="stat-tile"><span className="stat-n">{groups["Demnächst"].length}</span><span className="stat-l">demnächst</span></div>
            <div className="stat-tile"><span className="stat-n">{groups["Später wichtig"].length}</span><span className="stat-l">später wichtig</span></div>
          </div>
          {items.length === 0 && <div className="empty"><div className="ic">◎</div>Keine offenen Fristen.<div className="sub">Routinen, Geburtstage und normale Termine zählen hier bewusst nicht.</div></div>}
          {Object.entries(groups).map(([g, list]) => list.length ? (
            <div className="bucket" key={g}>
              <div className="bh"><span className="bt">{g}</span><span className="bc">{list.length}</span></div>
              {list.map((it) => (
                <div className="mail" key={it.key}>
                  <div className="m-acct"><span className="cat-chip">{it.kind === "frist" ? "Frist" : "Aufgabe"}</span><span className="m-time">{new Date(it.when).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })}</span></div>
                  <div className="m-subj">{it.title}</div>
                  <div className="m-sum">{it.sub}</div>
                </div>
              ))}
            </div>
          ) : null)}
        </div>
      </div>
    </AppShell>
  );
}
