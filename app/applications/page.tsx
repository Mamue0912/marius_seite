import { requireUser } from "@/lib/supabaseServer";
import { loadMailAccounts } from "@/lib/mailAccounts";
import LoginForm from "@/components/LoginForm";
import AppShell from "@/components/AppShell";
import ApplicationCenter from "@/components/ApplicationCenter";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage({ searchParams }: { searchParams?: Promise<{ view?: string; open?: string; new?: string }> }) {
  const query = await searchParams;
  const user = await requireUser();
  if (!user) return <LoginForm />;
  const accounts = await loadMailAccounts(user.id);
  const initialSection = query?.new ? "neu" : (query?.view || "uebersicht");
  return (
    <AppShell active="/applications">
      <ApplicationCenter
        accounts={accounts.map((a) => ({ id: a.id, email: a.email, provider: a.provider }))}
        sendEnabled={process.env.ENABLE_SEND === "true"}
        initialSection={initialSection}
        initialOpenId={query?.open || null}
      />
    </AppShell>
  );
}
