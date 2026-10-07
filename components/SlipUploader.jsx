"use client";

// Free-tier bet-slip tracker — upload a screenshot of any sportsbook or
// Kalshi ticket, Claude vision reads it (lib/bets/parse-slip.js via
// app/api/bets/route.js), and it's saved for later tracking. Not Pro-gated,
// so it's styled like the home tab's FantasySpotlightCard (app/page.js),
// which is also free for every tier — same gradient-card language, just
// brand green instead of NFL orange.

import { useRef, useState } from "react";
import { tokens } from "../lib/ui-theme.js";
import { CameraIcon } from "./icons.js";

const MAX_EDGE = 1568; // Anthropic's recommended long-edge cap for vision input
const JPEG_QUALITY = 0.85;

async function resizeToJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not process that image"))), "image/jpeg", JPEG_QUALITY);
  });
}

const fmtPct = (p) => (p == null ? "—" : `${Math.round(p * 100)}%`);
const fmtUsd = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);

function fmtOneInX(combinedProb) {
  if (!combinedProb || combinedProb <= 0) return "—";
  const x = 1 / combinedProb;
  return `1 in ${x < 10 ? x.toFixed(1) : Math.round(x)}`;
}

export default function SlipUploader({ getAuthHeaders }) {
  const inputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const reset = () => { setResult(null); setError(null); };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    reset();
    setLoading(true);
    try {
      const resized = await resizeToJpeg(file);
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const form = new FormData();
      form.append("image", resized, "slip.jpg");
      form.append("timezone", timezone);
      const headers = await getAuthHeaders();
      const res = await fetch("/api/bets", { method: "POST", headers, body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      setResult(data.slip);
    } catch (err) {
      setError(err.message || "Upload failed");
    }
    setLoading(false);
  };

  const legs = result?.bet_legs || [];
  const combinedProb = legs.length && legs.every(l => l.implied_prob != null)
    ? legs.reduce((acc, l) => acc * l.implied_prob, 1)
    : null;

  return (
    <div style={{ background: "linear-gradient(135deg, rgba(47,191,113,0.12), rgba(47,191,113,0.02))", border: "1px solid rgba(47,191,113,0.3)", borderRadius: 16, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: "#2FBF71" }}>
          <CameraIcon size={12} /> BET SLIP TRACKER
        </span>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: "#555" }}>FREE</span>
      </div>

      <input ref={inputRef} type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />

      {!result && (
        <>
          <div style={{ fontSize: 13, color: "#999", marginBottom: 12, lineHeight: 1.5 }}>
            Upload a screenshot of any sportsbook or Kalshi bet slip — we&apos;ll read it and start tracking it for you.
          </div>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={loading}
            style={{ width: "100%", background: loading ? "#181b22" : "#2FBF71", color: loading ? "#555" : "#000", border: "none", borderRadius: 10, padding: "12px 0", fontWeight: 700, fontSize: 13, cursor: loading ? "default" : "pointer" }}
          >
            {loading ? "Reading slip…" : "Upload Bet Slip"}
          </button>
        </>
      )}

      {error && <div style={{ marginTop: 10, fontSize: 12, color: "#D9645C", lineHeight: 1.5 }}>{error}</div>}

      {result && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>{result.book}</div>
            <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 9px", borderRadius: 999, letterSpacing: 1, background: "rgba(47,191,113,0.15)", color: "#2FBF71", border: "1px solid rgba(47,191,113,0.3)" }}>SAVED</span>
          </div>

          <div style={{ display: "flex", gap: 16, marginBottom: 10, fontSize: 12, color: "#999" }}>
            <span>Stake <b style={{ color: "#fff" }}>{fmtUsd(result.stake)}</b></span>
            <span>Payout <b style={{ color: "#2FBF71" }}>{fmtUsd(result.max_payout)}</b></span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {legs.map((leg, i) => (
              <div key={leg.id ?? i} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: "#ccc" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {leg.pick}{leg.sport && <span style={{ color: "#555" }}> · {leg.sport}</span>}
                </span>
                <span style={{ fontFamily: tokens.font.mono, color: "#999", flexShrink: 0 }}>{fmtPct(leg.implied_prob)}</span>
              </div>
            ))}
          </div>

          {legs.length > 1 && (
            <div style={{ fontSize: 11, color: "#777", borderTop: "1px solid rgba(47,191,113,0.15)", marginTop: 10, paddingTop: 8 }}>
              Combined probability: <b style={{ color: "#999" }}>{fmtOneInX(combinedProb)}</b>
            </div>
          )}

          <button
            onClick={reset}
            style={{ width: "100%", marginTop: 12, background: "transparent", border: "1px solid #242832", borderRadius: 10, padding: "9px 0", color: "#777", fontSize: 12, cursor: "pointer" }}
          >
            Upload Another
          </button>
        </div>
      )}
    </div>
  );
}
