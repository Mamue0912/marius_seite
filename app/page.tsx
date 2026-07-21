import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import LoginForm from "@/components/LoginForm";
import Cockpit from "@/components/Cockpit";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  if (!user) return <LoginForm />;

  // Ob überhaupt ein Outlook-Konto verbunden ist (steuert die UI).
  const { data: account } = await supabaseAdmin()
    .from("ms_accounts")
    .select("id,email,status")
    .eq("user_id", user.id)
    .maybeSingle();

  return <Cockpit connected={!!account} email={account?.email ?? null} sendEnabled={process.env.ENABLE_SEND === "true"} />;
}
