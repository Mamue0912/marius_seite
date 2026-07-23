"use client";
import { useEffect, useRef, ReactNode } from "react";

// Eigene Overlay-Scrollbar: natives Scrollen bleibt voll erhalten (Inhalt
// scrollt nativ, native Leiste ist nur ausgeblendet). Darüber liegt ein
// dünner, abgerundeter Thumb, der beim Scrollen/Hovern erscheint und nach
// kurzer Ruhe per Opacity-Transition SANFT ausblendet – zuverlässig in allen
// Browsern (echte div-Opacity, nicht die unzuverlässige Scrollbar-Animation).
export default function OverlayScroll({
  children, className, viewClassName
}: { children: ReactNode; className?: string; viewClassName?: string }) {
  const view = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ y: number; top: number } | null>(null);
  const topRef = useRef(0);

  function sync() {
    const v = view.current, t = thumb.current;
    if (!v || !t) return;
    const ratio = v.clientHeight / v.scrollHeight;
    if (ratio >= 1) { t.style.height = "0"; return; }
    const trackH = v.clientHeight;
    const thumbH = Math.max(30, ratio * trackH);
    const maxTop = trackH - thumbH;
    const denom = v.scrollHeight - v.clientHeight;
    const top = denom > 0 ? (v.scrollTop / denom) * maxTop : 0;
    topRef.current = top;
    t.style.height = thumbH + "px";
    t.style.transform = `translateY(${top}px)`;
  }
  function show() {
    const v = view.current, t = thumb.current;
    if (!v || !t || v.scrollHeight <= v.clientHeight) return;
    t.classList.add("show");
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!drag.current) hideTimer.current = setTimeout(() => t.classList.remove("show"), 1100);
  }
  function onScroll() { sync(); show(); }

  useEffect(() => {
    const v = view.current; if (!v) return;
    sync();
    const ro = new ResizeObserver(() => sync());
    ro.observe(v);
    Array.from(v.children).forEach((c) => ro.observe(c));
    v.addEventListener("scroll", onScroll, { passive: true });

    // Thumb ziehen (optional, komfortabel auf Desktop).
    const t = thumb.current;
    function onMove(e: PointerEvent) {
      if (!drag.current || !v || !t) return;
      const trackH = v.clientHeight;
      const thumbH = t.offsetHeight;
      const maxTop = trackH - thumbH;
      const nextTop = Math.min(maxTop, Math.max(0, drag.current.top + (e.clientY - drag.current.y)));
      v.scrollTop = (nextTop / maxTop) * (v.scrollHeight - v.clientHeight);
    }
    function onUp() { drag.current = null; document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); show(); }
    function onDown(e: PointerEvent) {
      if (!t) return;
      drag.current = { y: e.clientY, top: topRef.current };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      e.preventDefault();
    }
    t?.addEventListener("pointerdown", onDown);

    return () => {
      ro.disconnect();
      v.removeEventListener("scroll", onScroll);
      t?.removeEventListener("pointerdown", onDown);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={"oscroll" + (className ? " " + className : "")} onMouseEnter={show}>
      <div className={"oscroll-view" + (viewClassName ? " " + viewClassName : "")} ref={view}>{children}</div>
      <div className="oscroll-thumb" ref={thumb} />
    </div>
  );
}
