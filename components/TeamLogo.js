"use client";
import { useState } from "react";
import Image from "next/image";
import { teamLogoUrl } from "../lib/team-logos.js";

// Consistent team-logo treatment everywhere a matchup renders — same size
// steps, same fallback (a blank slot, not a broken-image icon) whenever a
// team isn't in the static lookup or the CDN request fails.
export default function TeamLogo({ team, sport, size = 22, style }) {
  const [broken, setBroken] = useState(false);
  const src = teamLogoUrl(team, sport);

  if (!src || broken) {
    return <div aria-hidden style={{ width: size, height: size, flexShrink: 0, ...style }} />;
  }

  return (
    <Image
      src={src}
      alt=""
      aria-hidden
      width={size}
      height={size}
      // unoptimized: these are already-small hotlinked CDN assets (ESPN's
      // own logo CDN) — routing them through Vercel's Image Optimization
      // would just add a billed source-image count for no real size win.
      unoptimized
      onError={() => setBroken(true)}
      style={{ width: size, height: size, objectFit: "contain", flexShrink: 0, ...style }}
    />
  );
}
