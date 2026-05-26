"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

const SERVICE_URL = "/api/admin/codes";

export default function CodesAdmin() {
  const [authorized, setAuthorized] = useState(false);
  const [codes, setCodes]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [label, setLabel]           = useState("");
  const [maxUses, setMaxUses]       = useState("");
  const [creating, setCreating]     = useState(false);
  const [token, setToken]           = useState("");
  const [regen, setRegen]           = useState(null); // null | "loading" | "ok" | "err"

  useEffect(() => {
    getSupabase().auth.getSession().then(async ({ data: { session } }) => {
      const email = session?.user?.email?.toLowerCase();
      if (email && ADMIN_EMAILS.includes(email)) {
        setAuthorized(true);
        setToken(session.access_token);
        fetchCodes(session.access_token);
      } else {
        setLoading(false);
      }
    });
  }, []);

  const fetchCodes = async (tok) => {
    const res = await fetch(SERVICE_URL, { headers: { Authorization: `Bearer ${tok || token}` } });
    const d = await res.json();
    setCodes(d.codes || []);
    setLoading(false);
  };

  const createCode = async () => {
    setCreating(true);
    const res = await fetch(SERVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ label: label || "Unnamed", uses_max: maxUses ? parseInt(maxUses) : null }),
    });
    const d = await res.json();
    if (d.code) { setLabel(""); setMaxUses(""); fetchCodes(); }
    setCreating(false);
  };

  const deleteCode = async (id) => {
    await fetch(`${SERVICE_URL}?id=${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    fetchCodes();
  };

  const regenBreakdowns = async () => {
    setRegen("loading");
    try {
      const cronSecret = prompt("Enter CRON_SECRET:");
      if (!cronSecret) { setRegen(null); return; }
      const res = await fetch("/api/cron/picks?force=1", { headers: { Authorization: `Bearer ${cronSecret}` } });
      setRegen(res.ok ? "ok" : "err");
      setTimeout(() => setRegen(null), 4000);
    } catch { setRegen("err"); setTimeout(() => setRegen(null), 4000); }
  };

  const css = `*{box-sizing:border-box;margin:0;padding:0;}body{background:#000;color:#fff;font-family:'Space Grotesk',sans-serif;}input{outline:none;}button{cursor:pointer;font-family:inherit;}`;

  if (loading) return <div style={{minHeight:"100vh",background:"#000",display:"flex",alignItems:"center",justifyContent:"center"}}><style>{css}</style><div style={{color:"#555"}}>Loading…</div></div>;
  if (!authorized) return <div style={{minHeight:"100vh",background:"#000",display:"flex",alignItems:"center",justifyContent:"center"}}><style>{css}</style><div style={{color:"#FF4D4D"}}>Not authorized</div></div>;

  return (
    <div style={{minHeight:"100vh",background:"#000",padding:"24px 20px",maxWidth:500,margin:"0 auto"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@400;700&display=swap');${css}`}</style>

      <div style={{marginBottom:24,display:"flex",alignItems:"flex-end",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:11,color:"#555",letterSpacing:2,marginBottom:4}}>ACCESS CODES</div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:22,fontWeight:700}}>T<span style={{color:"#00FF87"}}>|</span>T Admin</div>
        </div>
        <button onClick={regenBreakdowns} disabled={regen==="loading"}
          style={{background:regen==="ok"?"rgba(0,255,135,0.1)":regen==="err"?"rgba(255,77,77,0.1)":"#111",color:regen==="ok"?"#00FF87":regen==="err"?"#FF4D4D":"#777",border:`1px solid ${regen==="ok"?"rgba(0,255,135,0.3)":regen==="err"?"rgba(255,77,77,0.3)":"#222"}`,borderRadius:8,padding:"8px 12px",fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
          {regen==="loading"?"Generating…":regen==="ok"?"✓ Done":regen==="err"?"✗ Failed":"⚡ Regen Picks"}
        </button>
      </div>

      {/* Create new code */}
      <div style={{background:"#0d0d0d",border:"1px solid #222",borderRadius:14,padding:16,marginBottom:20}}>
        <div style={{fontSize:12,fontWeight:700,color:"#888",letterSpacing:1,marginBottom:12}}>CREATE CODE</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <input placeholder="Label (e.g. brother Mike)" value={label} onChange={e=>setLabel(e.target.value)}
            style={{background:"#111",border:"1px solid #2a2a2a",borderRadius:10,padding:"11px 14px",color:"#fff",fontSize:14}} />
          <input placeholder="Max uses (leave blank = unlimited)" value={maxUses} onChange={e=>setMaxUses(e.target.value)} type="number"
            style={{background:"#111",border:"1px solid #2a2a2a",borderRadius:10,padding:"11px 14px",color:"#fff",fontSize:14}} />
          <button onClick={createCode} disabled={creating}
            style={{background:"#00FF87",color:"#000",border:"none",borderRadius:10,padding:"12px",fontWeight:800,fontSize:14,opacity:creating?0.7:1}}>
            {creating ? "Creating…" : "Generate Code"}
          </button>
        </div>
      </div>

      {/* Code list */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {codes.length === 0 && <div style={{color:"#555",fontSize:13,textAlign:"center",padding:20}}>No codes yet</div>}
        {codes.map(c => (
          <div key={c.id} style={{background:"#0d0d0d",border:"1px solid #222",borderRadius:12,padding:"12px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:700,color:"#00FF87",letterSpacing:2}}>{c.code}</div>
              <div style={{fontSize:12,color:"#777",marginTop:2}}>{c.label || "Unnamed"} · {c.uses_count}/{c.uses_max ?? "∞"} uses</div>
              {c.expires_at && <div style={{fontSize:11,color:"#555",marginTop:1}}>Expires {new Date(c.expires_at).toLocaleDateString()}</div>}
            </div>
            <button onClick={()=>deleteCode(c.id)}
              style={{background:"rgba(255,77,77,0.1)",color:"#FF4D4D",border:"1px solid rgba(255,77,77,0.2)",borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:700}}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
