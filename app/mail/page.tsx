import { requireUser } from "@/lib/supabaseServer";
import { loadMailAccounts } from "@/lib/mailAccounts";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import LoginForm from "@/components/LoginForm";
import AppShell from "@/components/AppShell";
import Cockpit from "@/components/Cockpit";

export const dynamic = "force-dynamic";

export default async function MailPage({ searchParams }: { searchParams?: { open?: string } }) {
  const user = await requireUser();
  if (!user) return <LoginForm />;
  const accounts = await loadMailAccounts(user.id);
  const { data: folders } = await supabaseAdmin()
    .from("mail_folders").select("account_id,path,folder_type,unread,total")
    .eq("user_id", user.id);
  return (
    <AppShell active="/mail">
      <Cockpit
        connected={accounts.length > 0}
        accounts={accounts.map((a) => ({ id: a.id, email: a.email, provider: a.provider }))}
        folders={folders || []}
        sendEnabled={process.env.ENABLE_SEND === "true"}
        initialOpenId={searchParams?.open || null}
      />
    </AppShell>
  );
}
