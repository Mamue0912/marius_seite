import { requireUser } from "@/lib/supabaseServer";
import { loadMailAccounts } from "@/lib/mailAccounts";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import LoginForm from "@/components/LoginForm";
import AppShell from "@/components/AppShell";
import Cockpit from "@/components/Cockpit";

export const dynamic = "force-dynamic";

export default async function MailPage({ searchParams }: { searchParams?: Promise<{ open?: string; unread?: string }> }) {
  const query = await searchParams;
  const user = await requireUser();
  if (!user) return <LoginForm />;

  const admin = supabaseAdmin();
  const [accounts, initialFolders] = await Promise.all([
    loadMailAccounts(user.id),
    admin.from("mail_folders").select("account_id,path,folder_type,unread,total,display_name,sort_order,hidden,type_override").eq("user_id", user.id)
  ]);
  let folderResult: any = initialFolders;
  if (folderResult.error) {
    folderResult = await admin.from("mail_folders").select("account_id,path,folder_type,unread,total").eq("user_id", user.id);
  }

  return (
    <AppShell active="/mail">
      <Cockpit
        connected={accounts.length > 0}
        accounts={accounts.map((account) => ({ id: account.id, email: account.email, provider: account.provider }))}
        folders={folderResult.data || []}
        sendEnabled={process.env.ENABLE_SEND === "true"}
        initialOpenId={query?.open || null}
        initialUnreadOnly={query?.unread === "1"}
      />
    </AppShell>
  );
}