import { decrypt } from "./crypto";
import { supabaseAdmin } from "./supabaseAdmin";

export interface MailAccount {
  id: string;
  user_id: string;
  provider: string;
  email: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  username: string;
  password_enc: string;
  status: string;
  inbox_uidvalidity: number | null;
  inbox_last_uid: number | null;
}

// Entschlüsseltes Passwort – nur serverseitig verwenden.
export function accountPassword(acc: MailAccount): string {
  return decrypt(acc.password_enc);
}

export async function loadMailAccounts(userId: string): Promise<MailAccount[]> {
  const { data } = await supabaseAdmin()
    .from("mail_accounts")
    .select("*")
    .eq("user_id", userId);
  return (data as MailAccount[]) || [];
}

export async function loadAllMailAccounts(): Promise<MailAccount[]> {
  const { data } = await supabaseAdmin()
    .from("mail_accounts")
    .select("*")
    .eq("status", "connected");
  return (data as MailAccount[]) || [];
}

export async function loadMailAccount(id: string): Promise<MailAccount | null> {
  const { data } = await supabaseAdmin().from("mail_accounts").select("*").eq("id", id).maybeSingle();
  return (data as MailAccount) || null;
}
