// app/admin/fantasy-schedule/page.js
// Upload a schedule-difficulty screenshot (e.g. a weekly matchup grid) —
// Claude's vision capability extracts it, weeks 15-17 (fantasy playoffs) get
// folded into Cheat Sheet rankings via lib/nfl-fantasy/schedule-adjustment.js.
// Protected: only accessible if logged in as admin email.
"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function FantasyScheduleImport() {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState(null);
  const [season, setSeason] = useState(new Date().getFullYear());
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
    if (!file) return;
    setUploading(true); setError(""); setResult(null);
    try {
      const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
      const { data: { session } } = await supabase.auth.getSession();
      const imageBase64 = await fileToBase64(file);
      const res = await fetch("/api/admin/fantasy-schedule-import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ imageBase64, mediaType: file.type, season, source: file.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
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
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>T<span style={{ color: "#00FF87" }}>|</span>T Fantasy Schedule Import</div>
      <a href="/admin" style={{ fontSize: 11, color: "#444" }}>&larr; Admin</a>

      <div style={{ marginTop: 24, maxWidth: 480 }}>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 16, lineHeight: 1.6 }}>
          Upload a schedule-difficulty screenshot (a weekly matchup grid, one row per player) — typically
          opponent run-defense strength. Claude extracts the data and folds weeks 15-17 (fantasy playoffs)
          directly into the Cheat Sheet rankings, weighted toward RBs (and rushing QBs) since run-defense
          strength isn&apos;t a receiving signal.
        </div>
        <input type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] || null)}
          style={{ display: "block", marginBottom: 12, color: "#fff" }} />
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: "#888", marginRight: 8 }}>Season</label>
          <input type="number" value={season} onChange={e => setSeason(e.target.value)}
            style={{ background: "#111", border: "1px solid #333", color: "#fff", padding: "6px 10px", borderRadius: 6, width: 100 }} />
        </div>
        <button onClick={upload} disabled={!file || uploading}
          style={{ background: "#00FF87", color: "#000", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, cursor: file && !uploading ? "pointer" : "default", opacity: file && !uploading ? 1 : 0.5 }}>
          {uploading ? "Extracting…" : "Upload & Extract"}
        </button>

        {error && <div style={{ color: "#FF4D4D", fontSize: 12, marginTop: 12 }}>{error}</div>}
        {result && (
          <div style={{ color: "#00FF87", fontSize: 12, marginTop: 12 }}>
            Extracted {result.playersExtracted} players, stored {result.rowsStored} weekly rows.
          </div>
        )}
      </div>
    </div>
  );
}
