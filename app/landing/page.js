"use client";
import { useState, useEffect } from "react";

export default function Landing() {
  const [pick, setPick]       = useState(null);
  const [email, setEmail]     = useState("");
  const [status, setStatus]   = useState(null); // null | "loading" | "success" | "error"
  const [errMsg, setErrMsg]   = useState("");

  useEffect(() => {
    fetch("/api/free-pick")
      .then(r => r.json())
      .then(d => setPick(d.pick || null))
      .catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("loading");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (res.ok) { setStatus("success"); }
      else { setStatus("error"); setErrMsg(data.error || "Something went wrong."); }
    } catch { setStatus("error"); setErrMsg("Something went wrong."); }
  };

  const verdictColor = { CLEAN: "#00FF87", BET: "#FFD600", PASS: "#444", TRAP: "#FF4D4D" };
  const verdictLabel = { CLEAN: "🔥 Value Pick", BET: "✅ Solid Pick", PASS: "👀 Lean" };

  return (
    <div style={{ minHeight: "100vh", background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 20px", fontFamily: "'Space Grotesk', sans-serif", color: "#fff" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap');*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}body{background:#000;}input,button{font-family:inherit;}`}</style>

      <div style={{ width: "100%", maxWidth: 420 }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 32, fontWeight: 700, letterSpacing: -1 }}>
            T<span style={{ color: "#00FF87" }}>|</span>T
          </div>
          <div style={{ fontSize: 12, color: "#333", letterSpacing: 2, marginTop: 6 }}>SHARP MLB PICKS</div>
        </div>

        {/* Free pick preview */}
        <div style={{ background: "#080808", border: "1px solid #1a1a1a", borderRadius: 16, padding: 20, marginBottom: 28 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#555", marginBottom: 14 }}>TODAY'S FREE PICK</div>
          {pick ? (
            <>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>
                {pick.awayTeam} <span style={{ color: "#333" }}>@</span> {pick.homeTeam}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5, background: "rgba(0,255,135,0.1)", color: verdictColor[pick.filter?.verdict] || "#00FF87", border: `1px solid ${verdictColor[pick.filter?.verdict] || "#00FF87"}44` }}>
                  {verdictLabel[pick.filter?.verdict] || "🔥 Value Pick"}
                </span>
                <span style={{ fontSize: 13, color: "#888" }}>Take <strong style={{ color: "#fff" }}>{pick.pick}</strong></span>
              </div>
              {pick.breakdown?.preview && (
                <div style={{ fontSize: 13, color: "#555", lineHeight: 1.6 }}>
                  {pick.breakdown.preview.slice(0, 160)}{pick.breakdown.preview.length > 160 ? "…" : ""}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 13, color: "#333" }}>Loading today's pick…</div>
          )}
        </div>

        {/* Email capture */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, lineHeight: 1.3 }}>
            Get tomorrow's pick in your inbox.
          </div>
          <div style={{ fontSize: 13, color: "#444", marginBottom: 20, lineHeight: 1.5 }}>
            One game. One pick. Two sentences. Free, every morning.
          </div>

          {status === "success" ? (
            <div style={{ background: "rgba(0,255,135,0.08)", border: "1px solid rgba(0,255,135,0.2)", borderRadius: 12, padding: "16px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#00FF87" }}>You're in.</div>
              <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>First pick lands tomorrow morning.</div>
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 12, padding: "14px 16px", color: "#fff", fontSize: 15, outline: "none", width: "100%" }}
              />
              <button
                type="submit"
                disabled={status === "loading"}
                style={{ background: "#00FF87", color: "#000", border: "none", borderRadius: 12, padding: "14px 0", fontWeight: 800, fontSize: 15, cursor: status === "loading" ? "not-allowed" : "pointer", opacity: status === "loading" ? 0.7 : 1 }}
              >
                {status === "loading" ? "Adding you…" : "Send me tomorrow's pick →"}
              </button>
              {status === "error" && (
                <div style={{ fontSize: 12, color: "#FF4D4D", textAlign: "center" }}>{errMsg}</div>
              )}
            </form>
          )}
        </div>

        {/* CTA to app */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "#222", marginBottom: 12 }}>Want all picks + breakdowns + edge data?</div>
          <a href="/" style={{ display: "inline-block", fontSize: 13, color: "#00FF87", textDecoration: "none", border: "1px solid rgba(0,255,135,0.2)", borderRadius: 10, padding: "10px 20px" }}>
            See full model →
          </a>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 40, textAlign: "center", fontSize: 11, color: "#1a1a1a" }}>
          <a href="https://twitter.com/ThisorThatPicks" target="_blank" rel="noopener noreferrer" style={{ color: "#1a1a1a", textDecoration: "none" }}>𝕏 @ThisorThatPicks</a>
          {" · "}
          <a href="/privacy" style={{ color: "#1a1a1a", textDecoration: "none" }}>Privacy</a>
          {" · "}
          <a href="/terms" style={{ color: "#1a1a1a", textDecoration: "none" }}>Terms</a>
        </div>
      </div>
    </div>
  );
}
