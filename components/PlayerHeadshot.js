"use client";
import { useState } from "react";
import Image from "next/image";
import { tokens } from "../lib/ui-theme.js";

function initials(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.length === 1 ? parts[0][0].toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Circular headshot with an initials-avatar fallback — used instead of a
// broken-image icon whenever a player has no photo on file yet (most minor
// leaguers / practice-squad players) or the CDN request fails.
export default function PlayerHeadshot({ src, name, size = 40 }) {
  const [broken, setBroken] = useState(false);
  const showFallback = !src || broken;

  const shell = {
    width: size, height: size, borderRadius: "50%", flexShrink: 0,
    overflow: "hidden", background: tokens.color.surface, border: `1px solid ${tokens.color.border}`,
  };

  if (showFallback) {
    return (
      <div style={{ ...shell, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.36, fontWeight: 700, color: tokens.color.textMuted, fontFamily: tokens.font.mono }}>
        {initials(name)}
      </div>
    );
  }

  return (
    <div style={shell}>
      <Image
        src={src}
        alt=""
        aria-hidden
        width={size}
        height={size}
        unoptimized
        onError={() => setBroken(true)}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
}
