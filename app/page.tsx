import { requireUser } from "@/lib/supabaseServer";
import { loadMailAccounts } from "@/lib/mailAccounts";
import LoginForm from "@/components/LoginForm";
import Cockpit from "@/components/Cockpit";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  if (!user) return <LoginForm />;

  // Verbundene IMAP-Postfächer (iCloud, web.de, …).
  const accounts = await loadMailAccounts(user.id);
  const connectedAccounts = accounts.map((a) => ({ id: a.id, email: a.email, provider: a.provider }));

  return (
    <Cockpit
      connected={connectedAccounts.length > 0}
      accounts={connectedAccounts}
      sendEnabled={process.env.ENABLE_SEND === "true"}
    />
  );
}
