import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";

export const runtime = "edge";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function ctDate() {
  const ct = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  return `${ct.find(p => p.type === "year").value}-${ct.find(p => p.type === "month").value}-${ct.find(p => p.type === "day").value}`;
}

export async function GET() {
  try {
    const { data: cached } = await getSupabase()
      .from("picks_cache").select("picks").eq("date", ctDate()).single();
    const picks = cached?.picks || [];
    const pick  = picks.find(p => p.filter?.verdict === "CLEAN") || picks.find(p => p.isBet) || null;

    const matchup     = pick ? `${pick.awayTeam} @ ${pick.homeTeam}` : null;
    const pickTeam    = pick?.pick || null;
    const verdict     = pick?.filter?.verdict || "";
    const edge        = pick?.filter?.trueEdgePct ? `+${pick.filter.trueEdgePct.toFixed(1)}% edge` : "";
    const verdictColor = verdict === "CLEAN" ? "#00FF87" : verdict === "BET" ? "#FFD600" : "#888";
    const verdictLabel = verdict === "CLEAN" ? "CLEAN PLAY" : verdict === "BET" ? "BET" : "";

    return new ImageResponse(
      (
        <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "#000", padding: "52px 60px", fontFamily: "sans-serif", color: "#fff", justifyContent: "space-between" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ display: "flex", fontSize: 32, fontWeight: 700, letterSpacing: -1 }}>
                <div style={{ display: "flex", color: "#fff" }}>T</div>
                <div style={{ display: "flex", color: "#00FF87" }}>|</div>
                <div style={{ display: "flex", color: "#fff" }}>T</div>
              </div>
              <div style={{ display: "flex", fontSize: 11, color: "#444", letterSpacing: 4 }}>SHARP MLB PICKS</div>
            </div>
            <div style={{ display: "flex", fontSize: 11, color: "#333", letterSpacing: 2 }}>@ThisorThatPicks</div>
          </div>

          {/* Pick or fallback */}
          {matchup ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ display: "flex", fontSize: 13, color: "#444", letterSpacing: 3 }}>TODAY'S FREE PICK</div>
              <div style={{ display: "flex", fontSize: 42, fontWeight: 800, lineHeight: 1.1, color: "#fff" }}>{matchup}</div>
              {pickTeam && (
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ display: "flex", fontSize: 24, fontWeight: 700, color: "#00FF87" }}>Take {pickTeam}</div>
                  {verdictLabel && (
                    <div style={{ display: "flex", fontSize: 11, fontWeight: 800, padding: "5px 14px", borderRadius: 8, background: "rgba(0,255,135,0.08)", color: verdictColor, border: `1px solid ${verdictColor}33`, letterSpacing: 2 }}>
                      {verdictLabel}
                    </div>
                  )}
                  {edge && (
                    <div style={{ display: "flex", fontSize: 13, color: "#555", fontFamily: "monospace" }}>{edge}</div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", fontSize: 13, color: "#444", letterSpacing: 3 }}>SHARP MLB ANALYTICS</div>
              <div style={{ display: "flex", fontSize: 44, fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>Beat the market.</div>
              <div style={{ display: "flex", fontSize: 20, color: "#555" }}>Free daily pick · 6-layer filter · Pitcher analysis</div>
            </div>
          )}

          {/* Footer */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", fontSize: 13, color: "#222" }}>thisorthatpicks.com</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", width: 8, height: 8, borderRadius: 4, background: "#00FF87" }} />
              <div style={{ display: "flex", fontSize: 12, color: "#333" }}>Model-backed · No guessing</div>
            </div>
          </div>

        </div>
      ),
      { width: 1200, height: 630 }
    );
  } catch {
    return new ImageResponse(
      (
        <div style={{ display: "flex", width: "100%", height: "100%", background: "#000", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", fontSize: 72, fontWeight: 800, color: "#fff", letterSpacing: -2 }}>
            <div style={{ display: "flex" }}>T</div>
            <div style={{ display: "flex", color: "#00FF87" }}>|</div>
            <div style={{ display: "flex" }}>T</div>
          </div>
          <div style={{ display: "flex", fontSize: 14, color: "#333", letterSpacing: 4 }}>SHARP MLB PICKS</div>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  }
}
