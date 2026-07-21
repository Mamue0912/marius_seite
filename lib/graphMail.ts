import { graphGet, graphPost, graphPatch } from "./graph";
import { ThreadMessage } from "./anthropic";

// Liest den relevanten Thread (nach conversationId) und liefert eine
// kompakte, KI-taugliche Darstellung. Nur lesend.
export async function fetchThread(accessToken: string, graphId: string): Promise<ThreadMessage[]> {
  const msg: any = await graphGet(
    accessToken,
    `/me/messages/${graphId}?$select=conversationId,subject,from,receivedDateTime`
  );
  const conversationId = msg.conversationId;
  if (!conversationId) return [];

  const select = "subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,body,isDraft,parentFolderId";
  const filter = encodeURIComponent(`conversationId eq '${conversationId}'`);
  const res: any = await graphGet(
    accessToken,
    `/me/messages?$filter=${filter}&$select=${select}&$orderby=receivedDateTime asc&$top=20`
  );
  const meAddr = await myAddress(accessToken);

  return (res.value || [])
    .filter((m: any) => !m.isDraft)
    .map((m: any): ThreadMessage => {
      const from = m.from?.emailAddress?.address || "";
      const isMe = meAddr && from.toLowerCase() === meAddr.toLowerCase();
      return {
        from: m.from?.emailAddress?.name || from || "(unbekannt)",
        date: m.receivedDateTime || m.sentDateTime || "",
        direction: isMe ? "gesendet" : "eingehend",
        subject: m.subject || "",
        // Body auf reinen Text reduzieren (kein HTML in den Prompt).
        body: stripHtml(m.body?.content || m.bodyPreview || "").slice(0, 4000)
      };
    });
}

// Kein globaler Cache: bei warmen Serverless-Prozessen würde sonst die Adresse
// zwischen verschiedenen Nutzern verwechselt.
async function myAddress(accessToken: string): Promise<string> {
  try {
    const me: any = await graphGet(accessToken, "/me?$select=mail,userPrincipalName");
    return (me.mail || me.userPrincipalName || "").toLowerCase();
  } catch {
    return "";
  }
}

function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Erstellt einen ECHTEN Outlook-Entwurf als Antwort (erscheint in Outlook
// unter "Entwürfe") und setzt den Text. Gibt die Outlook-Draft-ID zurück.
export async function createOrUpdateReplyDraft(
  accessToken: string,
  graphId: string,
  outlookDraftId: string | null,
  body: string
): Promise<string> {
  let draftId = outlookDraftId;
  if (!draftId) {
    // createReply erzeugt einen Antwort-Entwurf mit korrektem Empfänger/Betreff.
    const draft: any = await graphPost(accessToken, `/me/messages/${graphId}/createReply`, {});
    draftId = draft.id;
  }
  await graphPatch(accessToken, `/me/messages/${draftId}`, {
    body: { contentType: "text", content: body }
  });
  return draftId as string;
}

// Sendet den Entwurf – NUR nach ausdrücklicher Bestätigung im Cockpit und
// nur, wenn ENABLE_SEND/Mail.Send aktiv ist. Antwortet erst nach dem Senden.
export async function sendDraft(accessToken: string, outlookDraftId: string): Promise<void> {
  await graphPost(accessToken, `/me/messages/${outlookDraftId}/send`, {});
}
