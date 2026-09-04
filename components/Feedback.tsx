"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
type Feedback = { message: string; error?: boolean };
export function notify(message: string, error = false) {
  window.dispatchEvent(new CustomEvent<Feedback>("cockpit:notice", {detail: {message, error}}));
}
export function Notice({children, retry}: {children: React.ReactNode; retry?: () => void}) {
  return <div className="feedback error" role="alert"><Icon name="info" /><span>{children}</span>{retry && <button className="btn small" onClick={retry}>Erneut versuchen</button>}</div>;
}
export default function FeedbackHost() {
  const [notice, setNotice] = useState<Feedback | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handler = (event: Event) => { clearTimeout(timer); const n = (event as CustomEvent<Feedback>).detail; setNotice(n); if (!n.error) timer = setTimeout(() => setNotice(null), 7000); };
    window.addEventListener("cockpit:notice", handler);
    return () => { clearTimeout(timer); window.removeEventListener("cockpit:notice", handler); };
  }, []);
  return notice ? <div className={"toast feedback" + (notice.error ? " error" : "")} role={notice.error ? "alert" : "status"}><Icon name={notice.error ? "info" : "check"} /><span>{notice.message}</span><button className="icon-button" aria-label="Meldung schließen" onClick={() => setNotice(null)}><Icon name="close" /></button></div> : null;
}
