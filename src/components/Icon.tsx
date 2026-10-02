// Iconos SVG de trazo; heredan el color del texto (currentColor).

const PATHS = {
  music: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.3 7.3 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.3 7.3 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.3 7.3 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-15v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z",
  monitor: "M3 5h18v11H3zM8 20h8m-4-4v4",
  search: "m20 20-4.2-4.2M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z",
  back10: "M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4M9.5 10v5m2.5-5h2.5v5H12z",
  forward10: "M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4M9.5 10v5m2.5-5h2.5v5H12z",
  previous: "M6 5v14M18 5 9 12l9 7V5Z",
  next: "M18 5v14M6 5l9 7-9 7V5Z",
  stop: "M7 7h10v10H7z",
  restart: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5",
  type: "M4 18 9 6l5 12M5.6 14h6.8M15 18v-5.5a2.5 2.5 0 0 1 5 0V18m0-3.5h-3.2a1.8 1.8 0 0 0 0 3.5H20",
  image: "M4 5h16v14H4zM4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 18M15.5 9.5h.01",
  volume: "M4 9v6h4l5 4V5L8 9H4Zm12.5-.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12",
  mute: "M4 9v6h4l5 4V5L8 9H4Zm12 .5 5 5m0-5-5 5",
  chevronDown: "m6 9 6 6 6-6",
  close: "M6 6l12 12M18 6 6 18",
  check: "m5 12.5 4.5 4.5L19 7",
  window: "M3 5h18v14H3zM3 9h18",
  compact: "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7",
  expand: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  lifebuoy: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5.6 5.6l3.6 3.6m5.6 5.6 3.6 3.6m0-12.8-3.6 3.6m-5.6 5.6-3.6 3.6",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
