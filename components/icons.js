"use client";

// Small dependency-free inline icon set — replaces emoji previously used
// as button icons (✓ ✗ 🗑 ↻ ← ✕).

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function CheckIcon({ size = 16, style, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} {...base} {...props}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export function XIcon({ size = 16, style, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} {...base} {...props}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

export function TrashIcon({ size = 16, style, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} {...base} {...props}>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function RefreshIcon({ size = 16, style, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} {...base} {...props}>
      <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8M3 12a9 9 0 0 0 15.3 6.4L21 16" />
      <path d="M21 3v5h-5M3 21v-5h5" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 16, style, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} {...base} {...props}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function CloseIcon({ size = 16, style, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} {...base} {...props}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

export function HomeIcon({ size = 16, style, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} {...base} {...props}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

export function GamesIcon({ size = 16, style, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} {...base} {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M8 5v14M16 5v14" />
    </svg>
  );
}

export function WalletIcon({ size = 16, style, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} {...base} {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2" />
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M16 13.5h3" />
    </svg>
  );
}

export function UserIcon({ size = 16, style, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} {...base} {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" />
    </svg>
  );
}

export function TrendingUpIcon({ size = 16, style, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} {...base} {...props}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </svg>
  );
}

export function ClockIcon({ size = 16, style, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function LockIcon({ size = 16, style, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} {...base} {...props}>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </svg>
  );
}

export function SearchIcon({ size = 16, style, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} {...base} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4.3-4.3" />
    </svg>
  );
}

export function CalendarIcon({ size = 16, style, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} {...base} {...props}>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </svg>
  );
}
