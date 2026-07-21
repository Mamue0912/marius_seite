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
    .select("id,from_name,from_address,subject,received_at,is_read,needs_reply,semantic_category,mail_account_id,deadline_at,folder_type,hidden")
    .eq("user_id", user.id)
    .eq("is_deleted", false)
    .eq("folder_type", "inbox")
    .order("received_at", { ascending: false })
    .limit(400);

  const rows = inbox || [];
  const perAccount = accounts.map((a) => ({
    id: a.id, email: a.email, provider: a.provider,
    unread: rows.filter((m) => m.mail_account_id === a.id && !m.is_read && !m.hidden).length
  }));
  const needsReply = rows.filter((m) => m.needs_reply && !m.hidden);
  const unreadImportant = rows.filter((m) => !m.is_read && !m.hidden && (m.semantic_category === "Wichtig" || m.needs_reply));
  const newest = rows.find((m) => !m.hidden) || null;
  const now = Date.now();
  const deadlines = rows.filter((m) => m.deadline_at && new Date(m.deadline_at).getTime() >= now - 864e5);

  return (
    <AppShell active="/">
      <Overview
        accounts={perAccount}
        summary={{
          totalUnread: rows.filter((m) => !m.is_read && !m.hidden).length,
          needsReply: needsReply.length,
          unreadImportant: unreadImportant.length,
          deadlines: deadlines.length
        }}
        newest={newest}
        needsReplyList={needsReply.slice(0, 5)}
        deadlineList={deadlines.slice(0, 5)}
      />
    </AppShell>
  );
}
