import type { SVGProps } from "react";

export type IconName =
  | "audit"
  | "bag"
  | "card"
  | "chevron"
  | "clock"
  | "coffee"
  | "grid"
  | "kitchen"
  | "minus"
  | "monitor"
  | "more"
  | "orders"
  | "plus"
  | "recall"
  | "search"
  | "send"
  | "shift"
  | "spark"
  | "table"
  | "trash"
  | "upload"
  | "user"
  | "users"
  | "wifi";

const iconPaths: Record<IconName, React.ReactNode> = {
  audit: (
    <>
      <path d="M6 3.5h9l3 3V20.5H6z" />
      <path d="M15 3.5v3h3M9 11h6M9 15h6" />
    </>
  ),
  bag: (
    <>
      <path d="M5 8h14l-1 12H6z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18M7 15h4" />
    </>
  ),
  chevron: <path d="m8 10 4 4 4-4" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  coffee: (
    <>
      <path d="M5 8h11v5a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5z" />
      <path d="M16 10h2a2.5 2.5 0 0 1 0 5h-2M8 5c0-1 1-1 1-2M12 5c0-1 1-1 1-2" />
      <path d="M4 21h14" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </>
  ),
  kitchen: (
    <>
      <path d="M5 12a7 7 0 0 1 14 0M3 12h18M5 16h14" />
      <path d="M12 5V3" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  orders: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  recall: (
    <>
      <path d="M8 8H4V4" />
      <path d="M4.5 8.5A8 8 0 1 1 4 14" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </>
  ),
  send: (
    <>
      <path d="m3 11 18-8-8 18-2-8z" />
      <path d="m11 13 5-5" />
    </>
  ),
  shift: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5h5" />
    </>
  ),
  spark: (
    <>
      <path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
      <path d="m18.5 15 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z" />
    </>
  ),
  table: (
    <>
      <path d="M4 9h16M6 9v11M18 9v11M8 9V5h8v4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M8 8l4-4 4 4" />
      <path d="M5 14v6h14v-6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="9" r="3" />
      <circle cx="17" cy="10" r="2.5" />
      <path d="M3 20a6 6 0 0 1 12 0M15 15a5 5 0 0 1 6 5" />
    </>
  ),
  wifi: (
    <>
      <path d="M3.5 9a13 13 0 0 1 17 0M6.5 12.5a8.5 8.5 0 0 1 11 0M9.5 16a4 4 0 0 1 5 0" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </>
  ),
};

export function Icon({
  name,
  size = 24,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...props}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      {iconPaths[name]}
    </svg>
  );
}
