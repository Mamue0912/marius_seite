import type { SVGProps } from "react";
const paths: Record<string, string> = {
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  mail: "M3 5h18v14H3z M3 5l9 7 9-7", briefcase: "M3 7h18v13H3z M8 7V4h8v3 M3 12l9 3 9-3 M12 12v5",
  calendar: "M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4",
  check: "M5 12l4 4L19 6", tasks: "M9 6h12 M9 12h12 M9 18h12 M3 5l1 1 2-2 M3 11l1 1 2-2 M3 17l1 1 2-2",
  clock: "M12 8v4l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  settings: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
  chevron: "M9 5l7 7-7 7", arrow: "M5 12h14 M13 6l6 6-6 6", close: "M6 6l12 12 M18 6L6 18",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  refresh: "M20 7A9 9 0 0 0 4 7 M20 3v5h-5 M4 17a9 9 0 0 0 16 0 M4 21v-5h5",
  folder: "M3 6h7l2 2h9v12H3z", archive: "M3 4h18v4H3z M5 8v12h14V8 M9 12h6",
  inbox: "M4 4h16v16H4z M4 14h5l2 3h2l2-3h5", paperclip: "M9 12l6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8",
  image: "M4 4h16v16H4z M7 16l4-4 3 3 2-2 4 4 M8 9h.01", star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M4 21a8 8 0 0 1 16 0", spark: "M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z",
  trash: "M3 6h18 M8 6V3h8v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  edit: "M4 16l12-12 4 4L8 20H4z M13 7l4 4", info: "M12 11v6 M12 7h.01 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  plus: "M12 5v14 M5 12h14", send: "M3 3l18 9-18 9 4-9z M7 12h14",
  document: "M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h8",
  menu: "M4 6h16 M4 12h16 M4 18h16", chat: "M3 4h18v13H8l-5 4z M7 8h10 M7 12h7",
  shield: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6",
  logout: "M9 4H4v16h5 M9 12h12 M16 7l5 5-5 5"
};
export default function Icon({name, size=18, ...props}: SVGProps<SVGSVGElement> & {name: string; size?: number}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}><path d={paths[name] || paths.document} /></svg>;
}
