import { requireUser } from "@/lib/supabaseServer";
import { loadMailAccounts } from "@/lib/mailAccounts";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import LoginForm from "@/components/LoginForm";
import AppShell from "@/components/AppShell";
import Overview from "@/components/Overview";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  if (!user) return <LoginForm />;

  const admin = supabaseAdmin();
  const accounts = await loadMailAccounts(user.id);

  // Zusammenfassungen (keine langen Listen) aus echten Daten.
  const { data: inbox } = await admin
    .from("messages")
    .select("id,from_name,from_address,subject,received_at,is_read,needs_reply,semantic_category,relevance,mail_account_id,deadline_at,folder_type,hidden")
    .eq("user_id", user.id)
    .eq("is_deleted", false)
    .eq("folder_type", "inbox")
    .order("received_at", { ascending: false })
    .limit(400);

  const rows = inbox || [];
  // Ungelesen = Posteingang, nicht gelesen (gleiche Regel wie Liste & Nav-Badge).
  const perAccount = accounts.map((a) => ({
    id: a.id, email: a.email, provider: a.provider,
    unread: rows.filter((m) => m.mail_account_id === a.id && !m.is_read).length
  }));
  const needsReply = rows.filter((m) => m.needs_reply && !m.hidden);
  const unreadImportant = rows.filter((m) => !m.is_read && (m.relevance === "wichtig" || m.relevance === "sehr_wichtig" || m.semantic_category === "Wichtig" || m.needs_reply));
  const newest = rows[0] || null;
  // Zwei bis drei neueste ungelesene für die Übersicht (klickbar → direkt öffnen).
  const acctById = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const newestUnread = rows.filter((m) => !m.is_read).slice(0, 3).map((m) => ({
    id: m.id, from: m.from_name || m.from_address || "", subject: m.subject || "(kein Betreff)",
    at: m.received_at, provider: acctById[m.mail_account_id]?.provider || "", email: acctById[m.mail_account_id]?.email || ""
  }));
  const now = Date.now();
  const deadlines = rows.filter((m) => m.deadline_at && new Date(m.deadline_at).getTime() >= now - 864e5);

  // Bewerbungs-Kachel: kompakte Kennzahlen direkt aus den Bewerbungsprojekten.
  const { data: apps } = await admin
    .from("applications")
    .select("id,company,position,status,deadline,last_activity_at")
    .eq("user_id", user.id);
  const appRows = apps || [];
  const appActive = appRows.filter((a) => !["absage", "zusage"].includes(a.status));
  const appPrep = appRows.filter((a) => ["analyse_offen", "unterlagen", "bereit"].includes(a.status));
  const appWaiting = appRows.filter((a) => ["beworben", "rueckmeldung", "gespraech"].includes(a.status));
  const appDeadlines = appRows.filter((a) => a.deadline && new Date(a.deadline).getTime() >= now - 864e5)
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
  const appLast = [...appRows].sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime())[0] || null;
  const appNext = (() => {
    const bereit = appRows.find((a) => a.status === "bereit");
    if (bereit) return { text: `„${bereit.position || bereit.company || "Bewerbung"}" ist bereit zum Senden.`, id: bereit.id };
    const analyse = appRows.find((a) => a.status === "analyse_offen");
    if (analyse) return { text: `Unterlagen für „${analyse.position || analyse.company}" vorbereiten.`, id: analyse.id };
    if (appDeadlines[0]) return { text: `Frist „${appDeadlines[0].position || appDeadlines[0].company}" am ${new Date(appDeadlines[0].deadline).toLocaleDateString("de-DE")}.`, id: appDeadlines[0].id };
    return null;
  })();
  const appStats = {
    total: appRows.length,
    active: appActive.length, prep: appPrep.length, waiting: appWaiting.length,
    deadlines: appDeadlines.slice(0, 3).map((a) => ({ id: a.id, label: a.position || a.company || "Bewerbung", deadline: a.deadline })),
    last: appLast ? { id: appLast.id, label: appLast.position || appLast.company || "Bewerbung", status: appLast.status } : null,
    next: appNext
  };

  return (
    <AppShell active="/">
      <Overview
        accounts={perAccount}
        summary={{
          totalUnread: rows.filter((m) => !m.is_read).length,
          needsReply: needsReply.length,
          unreadImportant: unreadImportant.length,
          deadlines: deadlines.length
        }}
        newest={newest}
        newestUnread={newestUnread}
        needsReplyList={needsReply.slice(0, 5)}
        deadlineList={deadlines.slice(0, 5)}
        appStats={appStats}
      />
    </AppShell>
  );
}
