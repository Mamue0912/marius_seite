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

  const accounts = await loadMailAccounts(user.id);
  const admin = supabaseAdmin();
  const { data: rules } = await admin.from("mail_rules").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
  let fRes: any = await admin.from("mail_folders").select("id,account_id,path,folder_type,unread,total,display_name,sort_order,hidden,type_override").eq("user_id", user.id);
  if (fRes.error) fRes = await admin.from("mail_folders").select("id,account_id,path,folder_type,unread,total").eq("user_id", user.id);

  return (
    <AppShell active="/settings">
      <Settings
        accounts={accounts.map((a) => ({ id: a.id, email: a.email, provider: a.provider }))}
        initialRules={rules || []}
        initialFolders={fRes.data || []}
        sendEnabled={process.env.ENABLE_SEND === "true"}
      />
    </AppShell>
  );
}
