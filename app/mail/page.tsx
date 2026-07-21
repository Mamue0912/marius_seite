import { requireUser } from "@/lib/supabaseServer";
import { loadMailAccounts } from "@/lib/mailAccounts";
import LoginForm from "@/components/LoginForm";
import AppShell from "@/components/AppShell";
import Cockpit from "@/components/Cockpit";

export const dynamic = "force-dynamic";

export default async function MailPage() {
  const user = await requireUser();
  if (!user) return <LoginForm />;
  const accounts = await loadMailAccounts(user.id);
  return (
    <AppShell active="/mail">
      <Cockpit
        connected={accounts.length > 0}
        accounts={accounts.map((a) => ({ id: a.id, email: a.email, provider: a.provider }))}
        sendEnabled={process.env.ENABLE_SEND === "true"}
      />
    </AppShell>
  );
}
