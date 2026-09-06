import { requireUser } from "@/lib/supabaseServer";
import { loadMailAccounts } from "@/lib/mailAccounts";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import LoginForm from "@/components/LoginForm";
import AppShell from "@/components/AppShell";
import Settings from "@/components/Settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  if (!user) return <LoginForm />;

  const admin = supabaseAdmin();
  const [accounts, rulesResult, initialFolders] = await Promise.all([
    loadMailAccounts(user.id),
    admin.from("mail_rules").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    admin.from("mail_folders").select("id,account_id,path,folder_type,unread,total,display_name,sort_order,hidden,type_override").eq("user_id", user.id)
  ]);
  let folderResult: any = initialFolders;
  if (folderResult.error) {
    folderResult = await admin.from("mail_folders").select("id,account_id,path,folder_type,unread,total").eq("user_id", user.id);
  }
  const initialError = rulesResult.error || folderResult.error
    ? "Einige Einstellungen konnten nicht geladen werden. Bitte die Seite neu laden."
    : null;

  return (
    <AppShell active="/settings">
      <Settings
        accounts={accounts.map((account) => ({ id: account.id, email: account.email, provider: account.provider }))}
        initialRules={rulesResult.data || []}
        initialFolders={folderResult.data || []}
        initialError={initialError}
        sendEnabled={process.env.ENABLE_SEND === "true"}
      />
    </AppShell>
  );
}