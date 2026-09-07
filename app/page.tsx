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
  const [accounts, inboxResult, applicationResult, taskResult] = await Promise.all([
    loadMailAccounts(user.id),
    admin
      .from("messages")
      .select("id,from_name,from_address,subject,received_at,is_read,needs_reply,semantic_category,relevance,mail_account_id,deadline_at,folder_type,hidden")
      .eq("user_id", user.id)
      .eq("is_deleted", false)
      .eq("folder_type", "inbox")
      .order("received_at", { ascending: false })
      .limit(400),
    admin
      .from("applications")
      .select("id,company,position,status,deadline,last_activity_at")
      .eq("user_id", user.id),
    admin
      .from("tasks")
      .select("*")
      .eq("user_id", user.id)
      .neq("status", "erledigt")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(200)
  ]);

  const rows = inboxResult.data || [];
  const appRows = applicationResult.data || [];
  const taskRows = taskResult.data || [];
  const loadErrors = {
    mail: inboxResult.error ? "E-Mails konnten nicht geladen werden." : null,
    applications: applicationResult.error ? "Bewerbungen konnten nicht geladen werden." : null,
    tasks: taskResult.error ? "Aufgaben & Fristen konnten nicht geladen werden." : null
  };
  if (inboxResult.error) console.error("Cockpit messages query failed", inboxResult.error);
  if (applicationResult.error) console.error("Cockpit applications query failed", applicationResult.error);
  if (taskResult.error) console.error("Cockpit tasks query failed", taskResult.error);
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const perAccount = accounts.map((account) => ({
    id: account.id,
    email: account.email,
    provider: account.provider,
    unread: rows.filter((message) => message.mail_account_id === account.id && !message.is_read).length
  }));
  const needsReply = rows.filter((message) => message.needs_reply && !message.hidden);
  const unreadImportant = rows.filter(
    (message) =>
      !message.is_read &&
      (message.relevance === "wichtig" ||
        message.relevance === "sehr_wichtig" ||
        message.semantic_category === "Wichtig" ||
        message.needs_reply)
  );
  const accountById = Object.fromEntries(accounts.map((account) => [account.id, account]));
  const newestUnread = rows
    .filter((message) => !message.is_read)
    .slice(0, 4)
    .map((message) => ({
      id: message.id,
      from: message.from_name || message.from_address || "",
      subject: message.subject || "(kein Betreff)",
      at: message.received_at,
      provider: accountById[message.mail_account_id]?.provider || "",
      email: accountById[message.mail_account_id]?.email || ""
    }));
  const deadlines = taskRows
    .filter((task) => task.due_at && new Date(task.due_at).getTime() >= now - 864e5)
    .sort((a, b) => new Date(a.due_at as string).getTime() - new Date(b.due_at as string).getTime());
  const overdueTasks = taskRows.filter(
    (task) => task.due_at && new Date(task.due_at).getTime() < todayStart.getTime()
  ).length;
  const dueToday = taskRows.filter((task) => {
    if (!task.due_at) return false;
    const due = new Date(task.due_at).getTime();
    return due >= todayStart.getTime() && due < tomorrowStart.getTime();
  }).length;

  const appActive = appRows.filter((application) => !["absage", "zusage"].includes(application.status));
  const appPrep = appRows.filter((application) =>
    ["analyse_offen", "unterlagen", "bereit"].includes(application.status)
  );
  const appWaiting = appRows.filter((application) =>
    ["beworben", "rueckmeldung", "gespraech"].includes(application.status)
  );
  const appDeadlines = appRows
    .filter((application) => application.deadline && new Date(application.deadline).getTime() >= now - 864e5)
    .sort(
      (a, b) =>
        new Date(a.deadline as string).getTime() - new Date(b.deadline as string).getTime()
    );
  const appLast =
    [...appRows].sort(
      (a, b) =>
        new Date(b.last_activity_at || 0).getTime() - new Date(a.last_activity_at || 0).getTime()
    )[0] || null;
  const appNext = (() => {
    const ready = appRows.find((application) => application.status === "bereit");
    if (ready)
      return {
        text: `„${ready.position || ready.company || "Bewerbung"}" ist bereit zum Senden.`,
        id: ready.id
      };
    const analysis = appRows.find((application) => application.status === "analyse_offen");
    if (analysis)
      return {
        text: `Unterlagen für „${analysis.position || analysis.company}" vorbereiten.`,
        id: analysis.id
      };
    if (appDeadlines[0])
      return {
        text: `Frist „${appDeadlines[0].position || appDeadlines[0].company}" am ${new Date(
          appDeadlines[0].deadline as string
        ).toLocaleDateString("de-DE")}.`,
        id: appDeadlines[0].id
      };
    return null;
  })();
  const appStats = {
    total: appRows.length,
    active: appActive.length,
    prep: appPrep.length,
    waiting: appWaiting.length,
    deadlines: appDeadlines.slice(0, 3).map((application) => ({
      id: application.id,
      label: application.position || application.company || "Bewerbung",
      deadline: application.deadline
    })),
    last: appLast
      ? {
          id: appLast.id,
          label: appLast.position || appLast.company || "Bewerbung",
          status: appLast.status
        }
      : null,
    next: appNext
  };

  return (
    <AppShell active="/">
      <Overview
        accounts={perAccount}
        summary={{
          totalUnread: rows.filter((message) => !message.is_read).length,
          needsReply: needsReply.length,
          unreadImportant: unreadImportant.length,
          deadlines: deadlines.length,
          overdueTasks,
          dueToday
        }}
        newestUnread={newestUnread}
        needsReplyList={needsReply.slice(0, 5)}
        appStats={appStats}
        tasks={taskRows}
        loadErrors={loadErrors}
      />
    </AppShell>
  );
}
