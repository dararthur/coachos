/**
 * Jeu d'icônes Matnexa : grille de 24, trait de 1,75, extrémités carrées et angles vifs (la coupe d'une ceinture).
 * Toujours accompagnées d'un libellé visible ou d'un nom accessible : l'icône seule ne porte jamais le sens.
 */
const PATHS = {
  home: "M4 10.5 12 4l8 6.5M6 9v11h12V9M10 20v-6h4v6",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15.5 4.3a3.5 3.5 0 0 1 0 6.4M17.5 14.5c2 .8 3.5 2.9 3.5 5.5",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  roll: "M5 4h14v16H5zM8.5 9l1.5 1.5 3-3M8.5 15h7",
  chart: "M5 20V11M10 20V5M15 20v-7M20 20V8M3 20h18",
  settings: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2v2h-2zM18 14h2v2h-2z",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 20 20",
  plus: "M12 5v14M5 12h14",
  upload: "M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v5h16v-5",
  download: "M12 4v11M7.5 10.5 12 15l4.5-4.5M4 15v5h16v-5",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  back: "M10 6l-6 6 6 6M4 12h16",
  prev: "M14.5 6 8.5 12l6 6",
  next: "M9.5 6l6 6-6 6",
  logout: "M10 4H5v16h5M14 8l4 4-4 4M18 12H9",
  user: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 3.6-7 8-7s8 3 8 7",
  alert: "M12 4 3 20h18L12 4ZM12 10v4.5M12 17v.5",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  check: "M5 12.5 10 17l9-10",
  edit: "M4 20h4L19 9l-4-4L4 16v4ZM13 7l4 4",
  swap: "M7 4 4 7l3 3M4 7h12M17 14l3 3-3 3M20 17H8",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className ?? ""}`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
