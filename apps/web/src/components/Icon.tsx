// Line icon set (1.7px stroke, currentColor) — ported from design_handoff/ds.jsx.
import type { CSSProperties, ReactNode } from "react";

export type IconName =
  | "lock" | "members" | "pencil" | "eye" | "plus" | "check" | "chevdown"
  | "chevright" | "chevleft" | "home" | "school" | "phone" | "mail" | "link"
  | "pin" | "x" | "wifioff" | "shield" | "search" | "arrowleft" | "bolt"
  | "upload" | "globe" | "gear" | "users3" | "file" | "table" | "swap"
  | "dot3" | "star" | "minus" | "info" | "calendar" | "download" | "grid" | "box"
  | "chart";

const paths: Record<IconName, ReactNode> = {
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  members: <><circle cx="9" cy="9" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 7.5a3 3 0 0 1 0 6M15.5 19a5.5 5.5 0 0 0-1.8-4.1" /></>,
  pencil: <path d="M14 5.5l4.5 4.5M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1z" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  chevdown: <path d="M6 9l6 6 6-6" />,
  chevright: <path d="M9 6l6 6-6 6" />,
  chevleft: <path d="M15 6l-6 6 6 6" />,
  home: <><path d="M4 11l8-6 8 6" /><path d="M6 10v9h12v-9" /></>,
  school: <><path d="M3 8l9-4 9 4-9 4-9-4z" /><path d="M7 10.5V15c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4.5" /><path d="M21 8v5" /></>,
  phone: <path d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A15 15 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z" />,
  mail: <><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M4 7l8 5.5L20 7" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7L11 7.3" /><path d="M14 10a4 4 0 0 0-5.7 0L6 12.3a4 4 0 0 0 5.7 5.7L13 16.7" /></>,
  pin: <><path d="M12 21s7-5.6 7-11a7 7 0 0 0-14 0c0 5.4 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  wifioff: <><path d="M3 3l18 18" /><path d="M5 12.5a11 11 0 0 1 4-2.6M2 8.8A16 16 0 0 1 7 6M16.5 10A11 11 0 0 1 19 12.5M22 8.8a16 16 0 0 0-6.5-3.4M9 16a5 5 0 0 1 5.6-.9" /><path d="M12 20h.01" /></>,
  shield: <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></>,
  arrowleft: <path d="M19 12H5M11 6l-6 6 6 6" />,
  bolt: <path d="M13 3L5 14h6l-1 7 8-11h-6z" />,
  upload: <><path d="M12 16V5M8 9l4-4 4 4" /><path d="M5 16v2a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18v-2" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M21 12h-2.5M5.5 12H3M18 6l-1.8 1.8M7.8 16.2 6 18M18 18l-1.8-1.8M7.8 7.8 6 6" /></>,
  users3: <><circle cx="8" cy="9.5" r="2.6" /><path d="M3 18a5 5 0 0 1 10 0" /><circle cx="16.5" cy="8" r="2.2" /><path d="M14 18a5 5 0 0 1 7-4.5" /></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
  table: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M3.5 10h17M9 10v9M3.5 14.5h17" /></>,
  swap: <><path d="M7 4L4 7l3 3" /><path d="M4 7h11a4 4 0 0 1 0 8" /><path d="M17 20l3-3-3-3" /><path d="M20 17H9" /></>,
  dot3: <><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
  star: <path d="M12 4l2.3 4.7 5.2.8-3.7 3.6.9 5.1L12 15.8 7.3 18.2l.9-5.1L4.5 9.5l5.2-.8z" />,
  minus: <path d="M5 12h14" />,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>,
  calendar: <><rect x="4" y="5.5" width="16" height="14.5" rx="2" /><path d="M4 10h16M8 3.5v4M16 3.5v4" /></>,
  download: <><path d="M12 4v10M8 11l4 4 4-4" /><path d="M5 19h14" /></>,
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>,
  box: <><path d="M3.5 8L12 4l8.5 4v8L12 20l-8.5-4z" /><path d="M3.5 8L12 12l8.5-4M12 12v8" /></>,
  chart: <><path d="M4 4v16h16" /><path d="M8.5 16v-5M13 16V7.5M17.5 16v-3" /></>,
};

export function Icon({
  name,
  size = 18,
  stroke = 1.7,
  style,
}: {
  name: IconName;
  size?: number;
  stroke?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
