import { supabaseAdmin } from "./supabaseAdmin";

export interface MailRule {
  id: string;
  user_id: string;
  match_type: "sender" | "domain" | "account";
  match_value: string;
  set_category: string | null;
  set_hidden: boolean;
}

export async function loadRules(userId: string): Promise<MailRule[]> {
  const { data } = await supabaseAdmin().from("mail_rules").select("*").eq("user_id", userId);
  return (data as MailRule[]) || [];
}

// Wendet die erste passende Regel an. Nutzerregeln haben Vorrang vor der KI.
export function applyRules(
  rules: MailRule[],
  msg: { from_address?: string | null; mail_account_id?: string | null }
): { category: string | null; hidden: boolean; matched: boolean } {
  const from = (msg.from_address || "").toLowerCase();
  const domain = from.includes("@") ? from.split("@")[1] : "";
  for (const r of rules) {
    const v = r.match_value.toLowerCase();
    const hit =
      (r.match_type === "sender" && from === v) ||
      (r.match_type === "domain" && domain === v) ||
      (r.match_type === "account" && msg.mail_account_id === r.match_value);
    if (hit) return { category: r.set_category, hidden: !!r.set_hidden, matched: true };
  }
  return { category: null, hidden: false, matched: false };
}
