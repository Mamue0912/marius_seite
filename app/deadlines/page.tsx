import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import LoginForm from "@/components/LoginForm";
import AppShell from "@/components/AppShell";
import Icon from "@/components/Icon";
import { dayDistance } from "@/lib/taskDates";

export const dynamic = "force-dynamic";

type DeadlineItem = {
  key: string;
  id: string;
  when: number;
  iso: string;
  title: string;
  sub: string;
  kind: "frist" | "aufgabe";
};

export default async function DeadlinesPage() {
  const user = await requireUser();
  if (!user) return <LoginForm />;
  const admin = supabaseAdmin();

  const [messageResult, taskResult] = await Promise.all([
    admin.from("messages")
      .select("id,subject,from_name,from_address,deadline_at")
      .eq("user_id", user.id)
      .eq("is_deleted", false)
      .not("deadline_at", "is", null)
      .order("deadline_at", { ascending: true }),
    admin.from("tasks")
      .select("id,title,due_at,status")
      .eq("user_id", user.id)
      .neq("status", "erledigt")
      .not("due_at", "is", null)
  ]);

  const items: DeadlineItem[] = [];
  for (const message of messageResult.data || []) {
    const when = new Date(message.deadline_at!).getTime();
    if (Number.isFinite(when)) items.push({
      key: "m" + message.id,
      id: message.id,
      when,
      iso: message.deadline_at!,
      title: message.subject || "(kein Betreff)",
      sub: "Frist aus E-Mail · " + (message.from_name || message.from_address || ""),
      kind: "frist"
    });
  }
  for (const task of taskResult.data || []) {
    const when = new Date(task.due_at!).getTime();
    if (Number.isFinite(when)) items.push({
      key: "t" + task.id,
      id: task.id,
      when,
      iso: task.due_at!,
      title: task.title,
      sub: "Aufgabe fällig",
      kind: "aufgabe"
    });
  }
  items.sort((a, b) => a.when - b.when);

  const groups: Record<string, DeadlineItem[]> = {
    "Überfällig": [],
    "Heute": [],
    "Diese Woche": [],
    "Demnächst": [],
    "Später wichtig": []
  };
  for (const item of items) {
    const days = dayDistance(item.iso);
    if (days === null) continue;
    if (days < 0) groups["Überfällig"].push(item);
    else if (days === 0) groups["Heute"].push(item);
    else if (days <= 7) groups["Diese Woche"].push(item);
    else if (days <= 30) groups["Demnächst"].push(item);
    else groups["Später wichtig"].push(item);
  }

  const openCount = groups["Überfällig"].length + groups["Heute"].length + groups["Diese Woche"].length;
  const loadError = messageResult.error || taskResult.error;

  return (
    <AppShell active="/deadlines">
      <div className="page">
        <div className="page-head"><h1>Termine & Fristen</h1></div>
        <div className="wrap-inner">
          {loadError && <div className="feedback error" role="alert"><Icon name="info" /><span>Einige Fristen konnten nicht geladen werden. Bitte die Seite neu laden.</span></div>}
          <div className="stat-row">
            <div className="stat-tile"><span className="stat-n">{openCount}</span><span className="stat-l">überfällig / nächste 7 Tage</span></div>
            <div className="stat-tile"><span className="stat-n">{groups["Demnächst"].length}</span><span className="stat-l">demnächst</span></div>
            <div className="stat-tile"><span className="stat-n">{groups["Später wichtig"].length}</span><span className="stat-l">später wichtig</span></div>
          </div>
          {items.length === 0 && !loadError && <div className="empty"><div className="ic"><Icon name="calendar" size={24} /></div>Keine offenen Fristen.<div className="sub">Routinen, Geburtstage und normale Termine zählen hier bewusst nicht.</div></div>}
          {Object.entries(groups).map(([group, list]) => list.length ? (
            <section className="bucket" key={group}>
              <div className="bh"><h2 className="bt">{group}</h2><span className="bc">{list.length}</span></div>
              {list.map((item) => (
                <a className="mail" key={item.key} href={item.kind === "frist" ? "/mail?open=" + item.id : "/tasks"}>
                  <div className="m-acct"><span className="cat-chip">{item.kind === "frist" ? "Frist" : "Aufgabe"}</span><span className="m-time">{new Date(item.when).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })}</span></div>
                  <div className="m-subj">{item.title}</div>
                  <div className="m-sum">{item.sub}</div>
                </a>
              ))}
            </section>
          ) : null)}
        </div>
      </div>
    </AppShell>
  );
}