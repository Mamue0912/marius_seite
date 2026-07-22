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
  // Erweiterte Auswahl (mit Anzeigeeinstellungen); Fallback, falls Spalten fehlen.
  const admin = supabaseAdmin();
  let fRes: any = await admin.from("mail_folders").select("account_id,path,folder_type,unread,total,display_name,sort_order,hidden,type_override").eq("user_id", user.id);
  if (fRes.error) fRes = await admin.from("mail_folders").select("account_id,path,folder_type,unread,total").eq("user_id", user.id);
  const folders = fRes.data;
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
