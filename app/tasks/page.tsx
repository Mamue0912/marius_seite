import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import LoginForm from "@/components/LoginForm";
import AppShell from "@/components/AppShell";
import Tasks from "@/components/Tasks";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const user = await requireUser();
  if (!user) return <LoginForm />;
  const { data, error } = await supabaseAdmin().from("tasks").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
  return (
    <AppShell active="/tasks">
      <Tasks initial={data || []} initialError={error ? "Aufgaben konnten nicht geladen werden. Bitte die Seite neu laden." : null} />
    </AppShell>
  );
}