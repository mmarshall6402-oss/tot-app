"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

const APP_URL = "https://tot-app.vercel.app";

function fmtOdds(o) { return o == null ? "" : o > 0 ? ` (+${o})` : ` (${o})`; }
function shortName(team) {
  const map = {
    "Oakland Athletics":"Athletics","Los Angeles Angels":"Angels","Los Angeles Dodgers":"Dodgers",
    "New York Yankees":"Yankees","New York Mets":"Mets","Chicago White Sox":"White Sox",
    "Chicago Cubs":"Cubs","Boston Red Sox":"Red Sox","Tampa Bay Rays":"Rays",
    "San Francisco Giants":"Giants","San Diego Padres":"Padres","Kansas City Royals":"Royals",
    "Toronto Blue Jays":"Blue Jays","Colorado Rockies":"Rockies","Minnesota Twins":"Twins",
    "Seattle Mariners":"Mariners","Houston Astros":"Astros","Texas Rangers":"Rangers",
    "Cleveland Guardians":"Guardians","Detroit Tigers":"Tigers","Baltimore Orioles":"Orioles",
    "Atlanta Braves":"Braves","Philadelphia Phillies":"Phillies","Washington Nationals":"Nationals",
    "Miami Marlins":"Marlins","Pittsburgh Pirates":"Pirates","St. Louis Cardinals":"Cardinals",
    "Milwaukee Brewers":"Brewers","Cincinnati Reds":"Reds","Arizona Diamondbacks":"Diamondbacks",
  };
  return map[team] || team.split(" ").pop();
}
function etDate(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(d);
  return `${p.find(x=>x.type==="year").value}-${p.find(x=>x.type==="month").value}-${p.find(x=>x.type==="day").value}`;
}
function fmtLabel(dateStr) {
  const [y,m,d] = dateStr.split("-").map(Number);
  return new Date(y,m-1,d).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
}

export default function TweetAdmin() {
  const [authorized, setAuthorized] = useState(false);
  const [tweets, setTweets]         = useState([]);
  const [copied, setCopied]         = useState({});
  const [allCopied, setAllCopied]   = useState(false);
  const [loading, setLoading]       = useState(true);
  const [record, setRecord]         = useState(null);

  useEffect(() => {
    getSupabase().auth.getSession().then(({ data: { session } }) => {
      const email = session?.user?.email?.toLowerCase();
      if (email && ADMIN_EMAILS.includes(email)) {
        setAuthorized(true);
        loadData();
      } else {
        setLoading(false);
      }
    });
  }, []);

  const loadData = async () => {
    const today     = etDate(0);
    const yesterday = etDate(-1);
    const supabase  = getSupabase();

    // Yesterday's record
    const { data: yPicks } = await supabase.from("model_picks").select("result,is_bet")
      .eq("date", yesterday).eq("is_bet", true).in("result", ["win","loss","push"]);
    const yW = (yPicks||[]).filter(p=>p.result==="win").length;
    const yL = (yPicks||[]).filter(p=>p.result==="loss").length;
    setRecord({ wins: yW, losses: yL, date: yesterday });

    // Today's picks
    const { data: cached } = await supabase.from("picks_cache").select("picks").eq("date", today).single();
    const picks = (cached?.picks||[]).filter(p=>p.isBet)
      .sort((a,b)=>(b.filter?.verdict==="CLEAN"?1000:b.filter?.confidence||0)-(a.filter?.verdict==="CLEAN"?1000:a.filter?.confidence||0))
      .slice(0,3);

    if (!picks.length) { setLoading(false); return; }

    const hasY = yW + yL > 0;
    const yLine = hasY ? `📊 Yesterday (${fmtLabel(yesterday)}): ${yW}-${yL} ${yW>yL?"✅":yW<yL?"❌":"➖"}\n\n` : "";
    const ic = { CLEAN:"🔥", BET:"✅" };

    const thread = [
      `${yLine}Today's top ${picks.length} MLB pick${picks.length>1?"s":""} — ${fmtLabel(today)} 🧵👇\n\n${APP_URL}`,
      ...picks.map((p,i) => {
        const f    = p.filter||{};
        const b    = p.breakdown||{};
        const odds = p.pick===p.homeTeam ? p.homeOdds : p.awayOdds;
        const verdict = f.verdict==="CLEAN" ? "CLEAN — all conditions ✅" : "BET";
        const stat  = (b.what_decides||b.preview||"").slice(0,120);
        return [
          `${i+1}/${picks.length} ${ic[f.verdict]||"👀"} ${shortName(p.awayTeam)} @ ${shortName(p.homeTeam)}`,
          `Take: ${shortName(p.pick)}${fmtOdds(odds)} | +${p.edge?.toFixed(1)}% edge`,
          verdict,
          stat ? `\n${stat}` : "",
          `\n${APP_URL}`,
        ].filter(Boolean).join("\n");
      }),
    ];

    setTweets(thread);
    setLoading(false);
  };

  const copy = (text, key) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(c => ({ ...c, [key]: true }));
      setTimeout(() => setCopied(c => ({ ...c, [key]: false })), 2000);
    });
  };

  const copyAll = () => {
    navigator.clipboard.writeText(tweets.join("\n\n---\n\n")).then(() => {
      setAllCopied(true);
      setTimeout(() => setAllCopied(false), 2000);
    });
  };

  const css = `*{box-sizing:border-box;margin:0;padding:0;}body{background:#000;color:#fff;font-family:'Space Grotesk',sans-serif;}`;

  if (loading) return <div style={{minHeight:"100vh",background:"#000",display:"flex",alignItems:"center",justifyContent:"center"}}><style>{css}</style><div style={{color:"#333"}}>Loading…</div></div>;
  if (!authorized) return <div style={{minHeight:"100vh",background:"#000",display:"flex",alignItems:"center",justifyContent:"center"}}><style>{css}</style><div style={{color:"#FF4D4D"}}>Not authorized</div></div>;

  return (
    <div style={{minHeight:"100vh",background:"#000",padding:"24px 20px",maxWidth:520,margin:"0 auto"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@400;700&display=swap');${css}`}</style>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <div style={{fontSize:11,color:"#333",letterSpacing:2,marginBottom:4}}>TWEET ADMIN</div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:20,fontWeight:700}}>T<span style={{color:"#00FF87"}}>|</span>T</div>
        </div>
        {record && <div style={{textAlign:"right",fontSize:12}}>
          <div style={{color:"#333",marginBottom:2}}>Yesterday</div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700}}>
            <span style={{color:"#00FF87"}}>{record.wins}</span>-<span style={{color:"#FF4D4D"}}>{record.losses}</span>
          </div>
        </div>}
      </div>

      {tweets.length === 0 ? (
        <div style={{color:"#333",fontSize:14}}>No BET picks today yet — check back after 10 AM CT.</div>
      ) : (
        <>
          <button onClick={copyAll} style={{width:"100%",background:allCopied?"#00FF87":"rgba(0,255,135,0.08)",color:allCopied?"#000":"#00FF87",border:"1px solid rgba(0,255,135,0.3)",borderRadius:10,padding:"11px 0",fontWeight:800,fontSize:14,cursor:"pointer",marginBottom:16,transition:"all 0.2s"}}>
            {allCopied ? "✓ Full thread copied!" : "⬇ Copy full thread"}
          </button>

          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {tweets.map((t,i) => (
              <div key={i} style={{background:"#080808",border:"1px solid #1a1a1a",borderRadius:12,padding:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,gap:8}}>
                  <div style={{fontSize:10,color:"#333",letterSpacing:1.5}}>{i===0?"HOOK TWEET":`REPLY ${i}/${tweets.length-1}`}</div>
                  <button onClick={()=>copy(t,i)} style={{flexShrink:0,background:copied[i]?"#00FF87":"transparent",color:copied[i]?"#000":"#555",border:"1px solid #1a1a1a",borderRadius:6,padding:"3px 10px",fontSize:11,cursor:"pointer",fontWeight:700,transition:"all 0.2s"}}>
                    {copied[i]?"✓":"Copy"}
                  </button>
                </div>
                <pre style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:13,color:"#aaa",lineHeight:1.6,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{t}</pre>
                <div style={{fontSize:10,color:t.length>280?"#FF4D4D":"#333",marginTop:6,textAlign:"right"}}>{t.length}/280</div>
              </div>
            ))}
          </div>

          <div style={{marginTop:16,fontSize:11,color:"#1a1a1a",textAlign:"center",lineHeight:1.8}}>
            Post the hook tweet first → reply with each pick → pin yesterday's result thread above.
          </div>
        </>
      )}
    </div>
  );
}
