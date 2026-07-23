"use client";
import { useEffect } from "react";

// Blendet die Scrollbalken wie bei macOS nur beim Scrollen ein und nach kurzer
// Ruhe wieder aus. Setzt dazu die Klasse `scrolling` auf <html>; das eigentliche
// Aus-/Einblenden macht CSS. Rein visuell – keine Logik/Datenänderung.
export default function ScrollbarAutoHide() {
  useEffect(() => {
    const root = document.documentElement;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const show = () => {
      root.classList.add("scrolling");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => root.classList.remove("scrolling"), 1200);
    };
    // capture=true: erfasst auch Scrollen in verschachtelten Containern.
    window.addEventListener("scroll", show, { capture: true, passive: true });
    window.addEventListener("wheel", show, { passive: true });
    window.addEventListener("touchmove", show, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("scroll", show, { capture: true } as any);
      window.removeEventListener("wheel", show);
      window.removeEventListener("touchmove", show);
    };
  }, []);
  return null;
}
