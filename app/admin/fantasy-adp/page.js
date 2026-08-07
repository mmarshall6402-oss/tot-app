// app/admin/fantasy-adp/page.js
// Paste a consensus-ADP list (copied from FantasyPros/Sleeper/ESPN — a CSV
// export with a header row, or just a bare ranked list off a webpage) and
// it's parsed and folded into the Cheat Sheet as "our rank vs. market ADP".
// Protected: only accessible if logged in as admin email.
"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

export default function FantasyAdpImport() {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [season, setSeason] = useState(new Date().getFullYear());
  const [source, setSource] = useState("");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user;
      if (u?.email && ADMIN_EMAILS.includes(u.email.toLowerCase())) setAuthorized(true);
      setLoading(false);
    });
  }, []);

  const upload = async () => {
    if (!text.trim()) return;
    setUploading(true); setError(""); setResult(null);
    try {
      const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/admin/fantasy-adp-import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ text, season, source: source || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setResult(data);
    } catch (e) {
      setError(e.message);
    }
    setUploading(false);
  };

  if (loading) return <div style={{ minHeight: "100vh", background: "#000" }} />;
  if (!authorized) return (
    <div style={{ minHeight: "100vh", background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#444", fontSize: 14 }}>Unauthorized</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#000", color: "#fff", padding: "24px 20px", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>T<span style={{ color: "#00FF87" }}>|</span>T Fantasy ADP Import</div>
      <a href="/admin" style={{ fontSize: 11, color: "#444" }}>&larr; Admin</a>

      <div style={{ marginTop: 24, maxWidth: 560 }}>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 16, lineHeight: 1.6 }}>
          Paste a consensus ADP list — a CSV export with a header row (Player/Pos/Team/ADP,
          any order), or just a bare ranked list copied off a webpage (&quot;1 Ja&apos;Marr Chase WR CIN&quot;
          per line). Row order becomes the ADP when no explicit ADP column is found. Each import fully
          replaces the season&apos;s stored ADP board.
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)}
          placeholder={"Player,Pos,Team,ADP\nJa'Marr Chase,WR,CIN,1.2\nBijan Robinson,RB,ATL,2.1\n..."}
          rows={12}
          style={{ display: "block", width: "100%", background: "#111", border: "1px solid #333", color: "#fff", borderRadius: 8, padding: 10, fontFamily: "monospace", fontSize: 12, marginBottom: 12, resize: "vertical" }} />
        <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: 11, color: "#888", marginRight: 8 }}>Season</label>
            <input type="number" value={season} onChange={e => setSeason(e.target.value)}
              style={{ background: "#111", border: "1px solid #333", color: "#fff", padding: "6px 10px", borderRadius: 6, width: 100 }} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 11, color: "#888", marginRight: 8 }}>Source (optional)</label>
            <input type="text" value={source} onChange={e => setSource(e.target.value)} placeholder="FantasyPros PPR overall, 8/7"
              style={{ background: "#111", border: "1px solid #333", color: "#fff", padding: "6px 10px", borderRadius: 6, width: "100%" }} />
          </div>
        </div>
        <button onClick={upload} disabled={!text.trim() || uploading}
          style={{ background: "#00FF87", color: "#000", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, cursor: text.trim() && !uploading ? "pointer" : "default", opacity: text.trim() && !uploading ? 1 : 0.5 }}>
          {uploading ? "Importing…" : "Import"}
        </button>

        {error && <div style={{ color: "#FF4D4D", fontSize: 12, marginTop: 12 }}>{error}</div>}
        {result && (
          <div style={{ color: "#00FF87", fontSize: 12, marginTop: 12 }}>
            Parsed {result.rowsParsed} rows, stored {result.rowsStored} players.
          </div>
        )}
      </div>
    </div>
  );
}
