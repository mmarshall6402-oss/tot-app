import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";

export const runtime = "edge";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET() {
  try {
    // Get today's free pick from cache
    const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago" })
      .split("/").map((v, i) => i < 2 ? v.padStart(2, "0") : v).reverse().join("-").replace(/(\d{4})-(\d{2})-(\d{2})/, "$1-$3-$2");
    // Simpler date approach
    const now = new Date();
    const ct = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const dateStr = `${ct.find(p => p.type === "year").value}-${ct.find(p => p.type === "month").value}-${ct.find(p => p.type === "day").value}`;

    const supabase = getSupabase();
    const { data: cached } = await supabase.from("picks_cache").select("picks").eq("date", dateStr).single();
    const picks = cached?.picks || [];
    const pick = picks.find(p => p.filter?.verdict === "CLEAN") || picks.find(p => p.isBet) || null;

    const matchup = pick ? `${pick.awayTeam} @ ${pick.homeTeam}` : "No pick today";
    const pickTeam = pick?.pick || "";
    const verdict = pick?.filter?.verdict || "";
    const verdictLabel = verdict === "CLEAN" ? "🔥 Value Pick" : verdict === "BET" ? "✅ Solid Pick" : "";
    const edge = pick?.filter?.trueEdgePct ? `+${pick.filter.trueEdgePct}% edge` : "";

    return new ImageResponse(
      (
        <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "#000", padding: "48px 56px", fontFamily: "sans-serif", color: "#fff", justifyContent: "space-between" }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#fff", letterSpacing: -1 }}>
              T<span style={{ color: "#00FF87" }}>|</span>T
            </div>
            <div style={{ fontSize: 12, color: "#333", letterSpacing: 3 }}>SHARP MLB PICKS</div>
          </div>

          {/* Pick */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 13, color: "#555", letterSpacing: 2 }}>TODAY'S FREE PICK</div>
            <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.2 }}>{matchup}</div>
            {pickTeam && (
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ fontSize: 20, color: "#00FF87", fontWeight: 700 }}>Take {pickTeam}</div>
                {verdictLabel && (
                  <div style={{ fontSize: 13, fontWeight: 800, padding: "4px 12px", borderRadius: 8, background: "rgba(0,255,135,0.1)", color: "#00FF87", border: "1px solid rgba(0,255,135,0.3)", letterSpacing: 1 }}>
                    {verdictLabel}
                  </div>
                )}
                {edge && <div style={{ fontSize: 13, color: "#555", fontFamily: "monospace" }}>{edge}</div>}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, color: "#222" }}>tot-app.vercel.app</div>
            <div style={{ fontSize: 13, color: "#1DA1F2" }}>@ThisorThatPicks</div>
          </div>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  } catch {
    return new ImageResponse(
      (<div style={{ display: "flex", width: "100%", height: "100%", background: "#000", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 48, fontWeight: 700 }}>T<span style={{ color: "#00FF87" }}>|</span>T</div>),
      { width: 1200, height: 630 }
    );
  }
}
