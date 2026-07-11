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
