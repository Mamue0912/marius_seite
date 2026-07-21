import { requireUser } from "@/lib/supabaseServer";
import { loadMailAccounts } from "@/lib/mailAccounts";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import LoginForm from "@/components/LoginForm";
import Settings from "@/components/Settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  if (!user) return <LoginForm />;

  const accounts = await loadMailAccounts(user.id);
  const { data: rules } = await supabaseAdmin().from("mail_rules").select("*").eq("user_id", user.id).order("created_at", { ascending: false });

  return (
    <Settings
      accounts={accounts.map((a) => ({ id: a.id, email: a.email, provider: a.provider }))}
      initialRules={rules || []}
      sendEnabled={process.env.ENABLE_SEND === "true"}
    />
  );
}
