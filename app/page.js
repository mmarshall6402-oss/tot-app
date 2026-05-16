"use client";
export const dynamic = 'force-dynamic';
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const fmtOdds = (o) => (o > 0 ? `+${o}` : `${o}`);

function fmtGameTime(iso) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function fmtDateLabel(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function getWeekDates() {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

const TIER = {
  High:   { color: "#00FF87", bg: "rgba(0,255,135,0.08)", label: "🔥 Value Pick" },
  Medium: { color: "#FFD600", bg: "rgba(255,214,0,0.08)",  label: "✅ Solid Pick" },
  Low:    { color: "#888",    bg: "rgba(136,136,136,0.08)", label: "👀 Lean" },
  Tossup: { color: "#444",    bg: "rgba(68,68,68,0.06)",   label: "🎲 Toss-Up" },
};

function AccuracyPanel({ savedPicks }) {
  const settled = savedPicks.filter(p => p.result !== "pending");
  const total = settled.length;
  const wins = settled.filter(p => p.result === "win").length;
  const winPct = total > 0 ? Math.round((wins / total) * 100) : null;

  const byTier = ["High", "Medium", "Low"].map(tier => {
    const tPicks = settled.filter(p => p.tier === tier);
    const tWins = tPicks.filter(p => p.result === "win").length;
    return {
      tier,
      total: tPicks.length,
      wins: tWins,
      pct: tPicks.length > 0 ? Math.round((tWins / tPicks.length) * 100) : null,
    };
  });

  const tierColor = { High: "#00FF87", Medium: "#FFD600", Low: "#888" };
  const tierLabel = { High: "🔥 Value", Medium: "✅ Solid", Low: "👀 Lean" };

  const rateColor = winPct === null ? "#333" : winPct >= 55 ? "#00FF87" : winPct >= 45 ? "#FFD600" : "#FF4D4D";

  return (
    <div style={{ marginTop: 4 }}>
      <div style={S.drawerSectionLabel}>APP ACCURACY</div>
      <div style={S.accuracyCard}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#555" }}>Overall Hit Rate</span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 700, color: rateColor }}>
            {winPct !== null ? `${winPct}%` : "—"}
          </span>
        </div>
        <div style={{ marginTop: 8, height: 3, background: "#111", borderRadius: 2 }}>
          <div style={{ height: "100%", borderRadius: 2, width: `${winPct || 0}%`, background: rateColor, transition: "width 0.6s ease" }} />
        </div>
        <div style={{ fontSize: 11, color: "#333", marginTop: 6 }}>{total} settled pick{total !== 1 ? "s" : ""}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 10 }}>
        {byTier.map(({ tier, total: t, pct }) => (
          <div key={tier} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: tierColor[tier], width: 64, flexShrink: 0 }}>{tierLabel[tier]}</span>
            <div style={{ flex: 1, height: 3, background: "#111", borderRadius: 2 }}>
              <div style={{ height: "100%", borderRadius: 2, width: `${pct || 0}%`, background: tierColor[tier], transition: "width 0.6s ease" }} />
            </div>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: pct !== null ? tierColor[tier] : "#333", width: 30, textAlign: "right", flexShrink: 0 }}>
              {pct !== null ? `${pct}%` : "—"}
            </span>
            <span style={{ fontSize: 10, color: "#222", flexShrink: 0 }}>({t})</span>
          </div>
        ))}
      </div>
      {total === 0 && (
        <div style={{ fontSize: 12, color: "#333", marginTop: 10, lineHeight: 1.6 }}>
          Save picks and mark results to see accuracy here
        </div>
      )}
    </div>
  );
}

export default function ToT() {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [picks, setPicks] = useState(null);
  const [savedPicks, setSavedPicks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("picks");
  const [sortBy, setSortBy] = useState("confidence");
  const [expanded, setExpanded] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState({});
  const [freePick, setFreePick] = useState(null);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const weekDates = getWeekDates();
  const [selectedDate, setSelectedDate] = useState(weekDates[0]);
  const [steals, setSteals] = useState(null);
  const [isPro, setIsPro] = useState(null);
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => {
    createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setIsPro(null); return; }
    getSupabase()
      .from("subscriptions")
      .select("status")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => setIsPro(["active", "trialing"].includes(data?.status ?? "")));
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    window.history.replaceState({}, "", "/");
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      const { data } = await getSupabase().from("subscriptions").select("status").eq("user_id", user.id).single();
      if (["active", "trialing"].includes(data?.status)) { setIsPro(true); clearInterval(poll); }
      if (attempts >= 6) clearInterval(poll);
    }, 2000);
    return () => clearInterval(poll);
  }, [user?.id]);

  useEffect(() => {
    fetch("/api/free-pick").then(r => r.json()).then(d => setFreePick(d.pick || null)).catch(() => {});
    const t = setInterval(() => setCarouselIdx(i => i + 1), 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!user) return;
    if (activeTab === "picks") fetchPicks(selectedDate);
    if (activeTab === "steals") fetchSteals(selectedDate);
    if (activeTab === "tracker") fetchSaved();
  }, [user, activeTab, selectedDate]);

  useEffect(() => {
    if (user) fetchSaved();
  }, [user]);

  const startCheckout = async (plan) => {
    setCheckingOut(plan);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, userId: user.id, email: user.email }),
      });
      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch (e) {}
    setCheckingOut(false);
  };

  const manageBilling = async () => {
    const res = await fetch("/api/stripe/portal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });
    const { url } = await res.json();
    if (url) window.location.href = url;
  };

  const fetchSteals = async (date) => {
    setSteals(null);
    try {
      const res = await fetch(`/api/steals?date=${date}`);
      const data = await res.json();
      setSteals(data.steals || []);
    } catch (e) { setSteals([]); }
  };

  const fetchPicks = async (date) => {
    setLoading(true);

    try {
      const res = await fetch(`/api/picks?date=${date}`);
      const data = await res.json();
      setPicks(data.picks || []);
    } catch (e) { console.error("picks error", e); setPicks([]); }
    setLoading(false);
  };

  const fetchSaved = async () => {
    setLoading(activeTab === "tracker");
    const { data } = await getSupabase().from("saved_picks").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    setSavedPicks(data || []);
    setLoading(false);
  };

  const savePick = async (pick) => {
    if (saving[pick.id] === "saved") return;
    setSaving(s => ({ ...s, [pick.id]: "saving" }));
    await getSupabase().from("saved_picks").insert({
      user_id: user.id,
      game_id: pick.id,
      home_team: pick.homeTeam,
      away_team: pick.awayTeam,
      pick: pick.pick,
      odds: pick.homeTeam === pick.pick ? pick.homeOdds : pick.awayOdds,
      tier: pick.tier?.level,
      commence_time: pick.commenceTime,
      result: "pending",
    });
    setSaving(s => ({ ...s, [pick.id]: "saved" }));
  };

  const deleteSaved = async (id) => {
    await getSupabase().from("saved_picks").delete().eq("id", id);
    setSavedPicks(p => p.filter(x => x.id !== id));
  };

  const markResult = async (id, result) => {
    await getSupabase().from("saved_picks").update({ result }).eq("id", id);
    setSavedPicks(p => p.map(x => x.id === id ? { ...x, result } : x));
  };

  const signIn = async () => {
    setAuthLoading(true);
    setAuthError("");
    const { error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
    setAuthLoading(false);
  };

  const signUp = async () => {
    setAuthLoading(true);
    setAuthError("");
    const { error } = await getSupabase().auth.signUp({ email, password });
    if (error) setAuthError(error.message);
    else setAuthError("Check your email to confirm.");
    setAuthLoading(false);
  };

  const signInGoogle = async () => {
    await getSupabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  };

  const signOut = async () => {
    await getSupabase().auth.signOut();
    setDrawerOpen(false);
  };

  const sorted = [...(picks || [])].sort((a, b) => {
    if (sortBy === "confidence") {
      const o = { High: 3, Medium: 2, Low: 1 };
      return (o[b.tier?.level] || 0) - (o[a.tier?.level] || 0);
    }
    return new Date(a.commenceTime) - new Date(b.commenceTime);
  });

  const wins = savedPicks.filter(p => p.result === "win").length;
  const losses = savedPicks.filter(p => p.result === "loss").length;
  const total = savedPicks.filter(p => p.result !== "pending").length;
  const winPct = total > 0 ? Math.round((wins / total) * 100) : 0;

  if (!user) return (
    <div style={S.page}>
      <style>{css}</style>
      <div style={S.previewBox}>
        <div style={S.previewTag}>TODAY'S FREE PICK</div>
        {freePick ? (
          <>
            <div style={S.previewMatchup}>{freePick.awayTeam} @ {freePick.homeTeam}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
              <span style={{ ...S.badge, background: TIER[freePick.tier?.level]?.bg, color: TIER[freePick.tier?.level]?.color }}>
                {TIER[freePick.tier?.level]?.label}
              </span>
              <span style={{ fontSize: 13, color: "#555" }}>Take {freePick.pick}</span>
            </div>
            {freePick.breakdown?.preview && <div style={S.previewReason}>{freePick.breakdown.preview}</div>}
            <div style={S.pitchRow}>
              <div style={S.pitchBox}>
                <div style={S.pitchLabel}>HOME SP</div>
                <div style={S.pitchName}>{freePick.breakdown?.pitcher_home || "TBD"}</div>
              </div>
              <div style={S.pitchVs}>VS</div>
              <div style={{ ...S.pitchBox, textAlign: "right" }}>
                <div style={S.pitchLabel}>AWAY SP</div>
                <div style={S.pitchName}>{freePick.breakdown?.pitcher_away || "TBD"}</div>
              </div>
            </div>
          </>
        ) : (
          <div style={{ color: "#333", fontSize: 13 }}>Loading today's free pick…</div>
        )}
        <div style={{ display: "flex", gap: 5, marginTop: 14 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: carouselIdx % 3 === i ? "#00FF87" : "#1a1a1a" }} />
          ))}
        </div>
      </div>
      <div style={S.authBox}>
        <div style={S.logo}>T<span style={{ color: "#00FF87" }}>|</span>T</div>
        <div style={S.authSub}>{authMode === "signin" ? "Sign in to see all picks" : "Create your free account"}</div>
        <button style={S.googleBtn} onClick={signInGoogle}><GoogleIcon /> Continue with Google</button>
        <div style={S.orRow}>
          <div style={S.orLine} />
          <span style={{ color: "#333", fontSize: 12, padding: "0 10px" }}>or</span>
          <div style={S.orLine} />
        </div>
        <input style={S.input} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
        <input style={S.input} type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
        {authError && <div style={S.errMsg}>{authError}</div>}
        <button style={S.primaryBtn} onClick={authMode === "signin" ? signIn : signUp} disabled={authLoading}>
          {authLoading ? "…" : authMode === "signin" ? "Sign In" : "Create Account"}
        </button>
        <div style={S.switchRow}>
          {authMode === "signin" ? "No account? " : "Have an account? "}
          <span style={{ color: "#00FF87", cursor: "pointer" }} onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setAuthError(""); }}>
            {authMode === "signin" ? "Sign up" : "Sign in"}
          </span>
        </div>
      </div>
    </div>
  );

  if (isPro === null) return (
    <div style={{ minHeight: "100vh", background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{css}</style>
      <div style={S.spinner} />
    </div>
  );

  if (!isPro) return (
    <div style={S.page}>
      <style>{css}</style>
      <div style={{ width: "100%", maxWidth: 460 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={S.logo}>T<span style={{ color: "#00FF87" }}>|</span>T <span style={{ color: "#333", fontFamily: "'Space Grotesk',sans-serif", fontSize: 18, fontWeight: 400 }}>Pro</span></div>
          <div style={{ color: "#444", fontSize: 13, marginTop: 8 }}>Sharp MLB picks. Every condition. No noise.</div>
        </div>
        <div style={{ marginBottom: 28 }}>
          {[
            "All daily picks with full model breakdown",
            "Steals — only bets passing every condition",
            "Parlay builder from CLEAN picks only",
            "Pick tracker + personal win rate",
            "Sharp filter: confidence, variance, edge per game",
          ].map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #0d0d0d" }}>
              <span style={{ color: "#00FF87", fontSize: 14, flexShrink: 0 }}>✓</span>
              <span style={{ fontSize: 13, color: "#888" }}>{f}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <button onClick={() => startCheckout("monthly")} disabled={!!checkingOut} style={{ flex: 1, background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 14, padding: "18px 14px", cursor: "pointer", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#555", letterSpacing: 1, marginBottom: 6 }}>MONTHLY</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 28, fontWeight: 700, color: "#fff" }}>$2</div>
            <div style={{ fontSize: 12, color: "#444", marginTop: 4 }}>per month</div>
            {checkingOut === "monthly" && <div style={{ color: "#555", fontSize: 11, marginTop: 6 }}>Redirecting…</div>}
          </button>
          <button onClick={() => startCheckout("annual")} disabled={!!checkingOut} style={{ flex: 1, background: "#0a1a0f", border: "1px solid rgba(0,255,135,0.3)", borderRadius: 14, padding: "18px 14px", cursor: "pointer", textAlign: "center", position: "relative" }}>
            <div style={{ position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)", background: "#00FF87", color: "#000", fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 20, letterSpacing: 0.5, whiteSpace: "nowrap" }}>2 MONTHS FREE</div>
            <div style={{ fontSize: 10, color: "#00FF87", letterSpacing: 1, marginBottom: 6 }}>ANNUAL</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 28, fontWeight: 700, color: "#00FF87" }}>$19.99</div>
            <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>per year · $1.67/mo</div>
            {checkingOut === "annual" && <div style={{ color: "#00FF87", fontSize: 11, marginTop: 6 }}>Redirecting…</div>}
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#1a1a1a", textAlign: "center", marginBottom: 20 }}>Cancel anytime · Secure payment via Stripe</div>
        <button style={{ ...S.primaryBtn, background: "transparent", border: "1px solid #111", color: "#333" }} onClick={signOut}>Sign out</button>
      </div>
    </div>
  );

  return (
    <div style={S.app}>
      <style>{css}</style>

      {drawerOpen && (
        <div style={S.overlay} onClick={() => setDrawerOpen(false)}>
          <div style={S.drawer} onClick={e => e.stopPropagation()}>
            <div style={S.drawerLogo}>T<span style={{ color: "#00FF87" }}>|</span>T</div>
            <div style={S.drawerEmail}>{user.email}</div>
            <div style={S.drawerLine} />
            {["picks", "steals", "tracker"].map(t => (
              <div key={t} style={{ ...S.drawerItem, color: activeTab === t ? "#00FF87" : "#fff" }} onClick={() => { setActiveTab(t); setDrawerOpen(false); }}>
                {t === "picks" ? "⚾" : t === "steals" ? "🔥" : "📊"} {t.charAt(0).toUpperCase() + t.slice(1)}
              </div>
            ))}
            <div style={S.drawerLine} />
            <AccuracyPanel savedPicks={savedPicks} />
            <div style={{ flex: 1 }} />
            <div style={S.drawerLine} />
            <div style={{ ...S.drawerItem, color: "#555" }} onClick={manageBilling}>⚡ Manage Billing</div>
            <div style={{ ...S.drawerItem, color: "#FF4D4D" }} onClick={signOut}>Sign Out</div>
          </div>
        </div>
      )}

      <div style={S.nav}>
        <button style={S.menuBtn} onClick={() => setDrawerOpen(true)}>
          {[0, 1, 2].map(i => <div key={i} style={S.menuLine} />)}
        </button>
        <div style={S.navLogo}>T<span style={{ color: "#00FF87" }}>|</span>T</div>
        <div style={S.navBadge}>MLB</div>
      </div>

      <div style={S.carousel}>
        <div style={S.carouselTag}>FREE PICK</div>
        {freePick ? (
          <>
            <div style={S.carouselMatchup}>{freePick.awayTeam} @ {freePick.homeTeam}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
              <span style={{ ...S.badge, background: TIER[freePick.tier?.level]?.bg, color: TIER[freePick.tier?.level]?.color }}>
                {TIER[freePick.tier?.level]?.label}
              </span>
              <span style={{ fontSize: 12, color: "#555" }}>Take {freePick.pick}</span>
            </div>
            {freePick.breakdown?.preview && (
              <div style={{ fontSize: 12, color: "#555", marginTop: 6, lineHeight: 1.5 }}>{freePick.breakdown.preview}</div>
            )}
          </>
        ) : (
          <div style={{ color: "#333", fontSize: 13 }}>Loading…</div>
        )}
        <div style={{ display: "flex", gap: 5, marginTop: 10 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: carouselIdx % 3 === i ? "#00FF87" : "#1a1a1a" }} />
          ))}
        </div>
      </div>

      {(activeTab === "picks" || activeTab === "steals") && (
        <div style={S.dateScroll}>
          {weekDates.map(date => (
            <button
              key={date}
              style={{
                ...S.dateBtn,
                borderColor: selectedDate === date ? "#00FF87" : "#1a1a1a",
                color: selectedDate === date ? "#00FF87" : "#444",
                background: selectedDate === date ? "rgba(0,255,135,0.05)" : "transparent",
              }}
              onClick={() => setSelectedDate(date)}
            >
              {fmtDateLabel(date)}
            </button>
          ))}
        </div>
      )}

      <div style={S.subNav}>
        <div style={{ display: "flex", gap: 6 }}>
          {["picks", "steals", "tracker"].map(t => (
            <button
              key={t}
              style={{ ...S.tabBtn, borderColor: activeTab === t ? "#00FF87" : "#1a1a1a", color: activeTab === t ? "#00FF87" : "#444" }}
              onClick={() => setActiveTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {activeTab === "picks" && (
          <div style={{ display: "flex", gap: 4 }}>
            {["confidence", "time"].map(s2 => (
              <button
                key={s2}
                style={{ ...S.sortBtn, background: sortBy === s2 ? "#00FF87" : "transparent", color: sortBy === s2 ? "#000" : "#444" }}
                onClick={() => setSortBy(s2)}
              >
                {s2 === "confidence" ? "🎯" : "🕐"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={S.content}>
        {activeTab === "picks" && (
          picks === null ? (
            <div style={S.center}>
              <div style={S.spinner} />
              <div style={{ color: "#333", fontSize: 13, marginTop: 12 }}>Analyzing {fmtDateLabel(selectedDate)}'s games…</div>
            </div>
          ) : sorted.length === 0 ? (
            <div style={S.center}>
              <div style={{ fontSize: 32 }}>⚾</div>
              <div style={{ color: "#fff", fontWeight: 700, marginTop: 8 }}>No games found</div>
              <div style={{ color: "#333", fontSize: 13, marginTop: 4 }}>Try a different date</div>
            </div>
          ) : sorted.map(pick => {
            const isBet   = pick.isBet;
            const edge    = pick.edge || 0;
            const t       = TIER[pick.tier?.level] || TIER.Low;
            const isOpen  = expanded === pick.id;
            const b       = pick.breakdown || {};
            const ls      = pick.liveScore;
            const isSaved = saving[pick.id] === "saved";

            // BET/PASS colors
            const betColor  = "#00FF87";
            const passColor = "#333";
            const cardBorder = isOpen ? (isBet ? betColor : "#2a2a2a") : (isBet ? "rgba(0,255,135,0.25)" : "#1a1a1a");

            return (
              <div key={pick.id} style={{ ...S.card, borderColor: cardBorder }}>
                <div style={S.cardTop}>
                  <div style={{ flex: 1 }}>
                    {/* BET / PASS indicator */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6,
                        letterSpacing: 1.5,
                        background: isBet ? "rgba(0,255,135,0.12)" : "rgba(50,50,50,0.5)",
                        color: isBet ? betColor : passColor,
                        border: `1px solid ${isBet ? "rgba(0,255,135,0.3)" : "#222"}`,
                      }}>
                        {isBet ? "BET" : "PASS"}
                      </span>
                      {/* Confidence % — edge as a simple signal */}
                      <span style={{ fontSize: 11, color: isBet ? "#555" : "#333", fontFamily: "'JetBrains Mono',monospace" }}>
                        {edge.toFixed(1)}% edge
                      </span>
                      {/* Tier as subtle secondary label */}
                      <span style={{ fontSize: 10, color: isBet ? t.color : "#333", opacity: 0.7 }}>
                        {t.label}
                      </span>
                    </div>
                    <div style={S.cardMatchup}>{pick.awayTeam} @ {pick.homeTeam}</div>
                    <div style={S.cardMeta}>
                      {fmtGameTime(pick.commenceTime)} · Take <span style={{ color: isBet ? betColor : "#aaa", fontWeight: 700 }}>{pick.pick}</span>
                    </div>
                    {ls?.status === "Live" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF4D4D", animation: "pulse 1s infinite" }} />
                        <span style={{ fontSize: 12, color: "#FF4D4D", fontWeight: 700 }}>LIVE</span>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{pick.awayTeam} {ls.awayScore} · {pick.homeTeam} {ls.homeScore}</span>
                        <span style={{ fontSize: 11, color: "#444" }}>{ls.inningHalf} {ls.inning}</span>
                      </div>
                    )}
                    {ls?.status === "Final" && (
                      <div style={{ fontSize: 12, color: "#444", marginTop: 4 }}>
                        Final: {pick.awayTeam} {ls.awayScore} · {pick.homeTeam} {ls.homeScore}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
                    <button
                      style={{ ...S.saveBtn, background: isSaved ? "#00FF87" : "transparent", color: isSaved ? "#000" : "#00FF87", borderColor: "#00FF87" }}
                      onClick={() => savePick(pick)}
                    >
                      {isSaved ? "✓ Saved" : "+ Save"}
                    </button>
                    <button
                      style={{ ...S.expandBtn, borderColor: isOpen ? (isBet ? betColor : "#444") : "#222", color: isOpen ? (isBet ? betColor : "#444") : "#333" }}
                      onClick={() => setExpanded(isOpen ? null : pick.id)}
                    >
                      {isOpen ? "▲" : "▼"}
                    </button>
                  </div>
                </div>
                <div style={S.pitchRow}>
                  <div style={S.pitchBox}>
                    <div style={S.pitchLabel}>HOME SP</div>
                    <div style={S.pitchName}>{b.pitcher_home || "TBD"}</div>
                  </div>
                  <div style={S.pitchVs}>VS</div>
                  <div style={{ ...S.pitchBox, textAlign: "right" }}>
                    <div style={S.pitchLabel}>AWAY SP</div>
                    <div style={S.pitchName}>{b.pitcher_away || "TBD"}</div>
                  </div>
                </div>
                {b.preview && <div style={S.preview}>{b.preview}</div>}
                {isOpen && (
                  <div style={{ animation: "fadeUp 0.2s ease" }}>
                    <div style={S.expDivider} />
                    {/* Sharp filter panel */}
                    {pick.filter && (() => {
                      const f = pick.filter;
                      const isClean = f.verdict === "CLEAN";
                      const vColor = { CLEAN: "#00FF87", TRAP: "#FF4D4D", PASS: "#444" }[f.verdict] || "#444";
                      const vBg    = { CLEAN: "rgba(0,255,135,0.06)", TRAP: "rgba(255,77,77,0.06)", PASS: "rgba(30,30,30,0.6)" }[f.verdict] || "transparent";
                      const confColor = f.confidence >= 8 ? "#00FF87" : f.confidence >= 6 ? "#FFD600" : "#FF4D4D";
                      return (
                        <div style={{ ...S.expSection, background: vBg, borderRadius: 10, padding: 12, border: `1px solid ${vColor}33`, marginBottom: 8 }}>
                          {/* Header row */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 11, fontWeight: 800, color: vColor, letterSpacing: 1.5 }}>{f.verdict}</span>
                              {f.isSquareLine && <span style={{ fontSize: 9, color: "#444", letterSpacing: 1 }}>SOFT LINE</span>}
                              {f.lineSignal === "confirming" && <span style={{ fontSize: 9, color: "#00FF87" }}>↑ LINE</span>}
                              {f.lineSignal === "contra"     && <span style={{ fontSize: 9, color: "#FF4D4D" }}>↓ LINE</span>}
                            </div>
                            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: vColor }}>{f.trueEdgePct > 0 ? "+" : ""}{f.trueEdgePct}% edge</span>
                          </div>
                          {/* Stats row */}
                          <div style={{ display: "flex", gap: 14, marginBottom: 8 }}>
                            <div>
                              <div style={{ fontSize: 9, color: "#444", letterSpacing: 1 }}>CONFIDENCE</div>
                              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: confColor, fontWeight: 700 }}>{f.confidence}/{f.confidenceOf || 10}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 9, color: "#444", letterSpacing: 1 }}>VARIANCE</div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: f.variance === "HIGH" ? "#FF4D4D" : f.variance === "MED" ? "#FFD600" : "#00FF87" }}>{f.variance}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 9, color: "#444", letterSpacing: 1 }}>WIN PROB</div>
                              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#fff" }}>{f.trueWinProbPct}%</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 9, color: "#444", letterSpacing: 1 }}>MKT IMPLIED</div>
                              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#fff" }}>{f.sharpImpliedPct}%</div>
                            </div>
                            {f.uncertaintyPct != null && (
                              <div>
                                <div style={{ fontSize: 9, color: "#444", letterSpacing: 1 }}>UNCERTAINTY</div>
                                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: f.uncertaintyPct > 10 ? "#FF4D4D" : f.uncertaintyPct > 6 ? "#FFD600" : "#00FF87" }}>±{f.uncertaintyPct}%</div>
                              </div>
                            )}
                            {f.snr != null && (
                              <div>
                                <div style={{ fontSize: 9, color: "#444", letterSpacing: 1 }}>SNR</div>
                                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: f.snr >= 1.5 ? "#00FF87" : f.snr >= 1.0 ? "#FFD600" : "#FF4D4D" }}>{f.snr}×</div>
                              </div>
                            )}
                            {f.parkFactor !== 0 && (
                              <div>
                                <div style={{ fontSize: 9, color: "#444", letterSpacing: 1 }}>PARK</div>
                                <div style={{ fontSize: 11, color: f.parkFactor >= 1.0 ? "#FF4D4D" : f.parkFactor <= -0.3 ? "#00FF87" : "#888" }}>{f.parkFactor > 0 ? "+" : ""}{f.parkFactor}R</div>
                              </div>
                            )}
                          </div>
                          {/* Failures (why this is a PASS) */}
                          {(f.failures || []).length > 0 && (
                            <div style={{ marginTop: 4 }}>
                              <div style={{ fontSize: 9, color: "#444", letterSpacing: 1, marginBottom: 4 }}>FAILED CONDITIONS</div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                {f.failures.map((fail, i) => (
                                  <span key={i} style={{ fontSize: 10, color: "#FF6B6B", background: "rgba(255,77,77,0.08)", padding: "2px 6px", borderRadius: 4 }}>✗ {fail}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Clean pick celebration */}
                          {isClean && (
                            <div style={{ marginTop: 4, fontSize: 10, color: "#00FF87" }}>✓ All conditions passed — disciplined bet</div>
                          )}
                        </div>
                      );
                    })()}
                    <div style={S.expSection}>
                      <div style={S.expLabel}>RECENT FORM</div>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                        <span style={{ color: "#00FF87", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{pick.homeTeam} →</span>
                        <span style={S.expText}>{b.form_home || "—"}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <span style={{ color: "#FF4D4D", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{pick.awayTeam} →</span>
                        <span style={S.expText}>{b.form_away || "—"}</span>
                      </div>
                    </div>
                    {b.what_decides && (
                      <div style={S.expSection}>
                        <div style={S.expLabel}>WHAT DECIDES THIS GAME</div>
                        <div style={S.expText}>{b.what_decides}</div>
                      </div>
                    )}
                    {b.what_to_sweat && (
                      <div style={S.expSection}>
                        <div style={S.expLabel}>WHAT YOU'RE SWEATING 😅</div>
                        <div style={{ ...S.expText, color: "#FFD600" }}>{b.what_to_sweat}</div>
                      </div>
                    )}
                    {b.honest_lean && (
                      <div style={{ ...S.expSection, background: "#0a0a0a", borderRadius: 10, padding: 12, border: "1px solid #1a1a1a" }}>
                        <div style={S.expLabel}>HONEST LEAN</div>
                        <div style={{ ...S.expText, color: "#fff", fontWeight: 500 }}>{b.honest_lean}</div>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <div style={S.statBox}>
                        <div style={S.statLabel}>{pick.homeTeam}</div>
                        <div style={S.statVal}>{fmtOdds(pick.homeOdds)}</div>
                      </div>
                      <div style={S.statBox}>
                        <div style={S.statLabel}>{pick.awayTeam}</div>
                        <div style={S.statVal}>{fmtOdds(pick.awayOdds)}</div>
                      </div>
                      {b.score_range && (
                        <div style={S.statBox}>
                          <div style={S.statLabel}>Score Range</div>
                          <div style={{ ...S.statVal, fontSize: 12 }}>{b.score_range}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}

        {activeTab === "steals" && (
          steals === null ? (
            <div style={S.center}>
              <div style={S.spinner} />
              <div style={{ color: "#333", fontSize: 13, marginTop: 12 }}>Scanning for CLEAN bets…</div>
            </div>
          ) : steals.length === 0 ? (
            <div style={S.center}>
              <div style={{ fontSize: 32 }}>🔒</div>
              <div style={{ color: "#fff", fontWeight: 700, marginTop: 8 }}>No CLEAN bets {fmtDateLabel(selectedDate)}</div>
              <div style={{ color: "#333", fontSize: 13, marginTop: 4 }}>All conditions must pass — discipline wins long-term</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#00FF87", letterSpacing: 2, marginBottom: 4 }}>
                {steals.length} CLEAN BET{steals.length !== 1 ? "S" : ""} — ALL CONDITIONS PASSED
              </div>
              {steals.map(pick => {
                const f = pick.filter || {};
                const b = pick.breakdown || {};
                const isSaved = saving[pick.id] === "saved";
                const pickOdds = pick.pick === pick.homeTeam ? pick.homeOdds : pick.awayOdds;
                const decOdds = pickOdds > 0 ? 1 + pickOdds / 100 : 1 + 100 / Math.abs(pickOdds);
                const edgeFrac = (f.trueEdgePct || 0) / 100;
                const kB = decOdds - 1;
                const kP = edgeFrac + (1 / decOdds);
                const kellyPct = (Math.max(0, (kB * kP - (1 - kP)) / kB) * 25).toFixed(1);
                return (
                  <div key={pick.id} style={{ ...S.card, borderColor: "rgba(0,255,135,0.35)" }}>
                    <div style={S.cardTop}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5, background: "rgba(0,255,135,0.12)", color: "#00FF87", border: "1px solid rgba(0,255,135,0.3)" }}>
                            BET
                          </span>
                          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#555" }}>
                            +{(f.trueEdgePct || 0).toFixed(1)}% edge
                          </span>
                          <span style={{ fontSize: 10, color: "#00FF87", opacity: 0.7 }}>
                            {f.confidence}/10 conf
                          </span>
                        </div>
                        <div style={S.cardMatchup}>{pick.awayTeam} @ {pick.homeTeam}</div>
                        <div style={S.cardMeta}>
                          {fmtGameTime(pick.commenceTime)} · Take <span style={{ color: "#00FF87", fontWeight: 700 }}>{pick.pick}</span> {fmtOdds(pickOdds)}
                        </div>
                      </div>
                      <button
                        style={{ ...S.saveBtn, background: isSaved ? "#00FF87" : "transparent", color: isSaved ? "#000" : "#00FF87", borderColor: "#00FF87" }}
                        onClick={() => savePick(pick)}
                      >
                        {isSaved ? "✓ Saved" : "+ Save"}
                      </button>
                    </div>
                    <div style={S.pitchRow}>
                      <div style={S.pitchBox}><div style={S.pitchLabel}>HOME SP</div><div style={S.pitchName}>{b.pitcher_home || "TBD"}</div></div>
                      <div style={S.pitchVs}>VS</div>
                      <div style={{ ...S.pitchBox, textAlign: "right" }}><div style={S.pitchLabel}>AWAY SP</div><div style={S.pitchName}>{b.pitcher_away || "TBD"}</div></div>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <div style={S.statBox}>
                        <div style={S.statLabel}>WIN PROB</div>
                        <div style={S.statVal}>{f.trueWinProbPct}%</div>
                      </div>
                      <div style={S.statBox}>
                        <div style={S.statLabel}>MKT IMPLIED</div>
                        <div style={S.statVal}>{f.sharpImpliedPct}%</div>
                      </div>
                      <div style={S.statBox}>
                        <div style={S.statLabel}>VARIANCE</div>
                        <div style={{ ...S.statVal, color: "#00FF87" }}>{f.variance}</div>
                      </div>
                      {f.uncertaintyPct != null && (
                        <div style={S.statBox}>
                          <div style={S.statLabel}>UNCERTAINTY</div>
                          <div style={{ ...S.statVal, color: f.uncertaintyPct > 10 ? "#FF4D4D" : f.uncertaintyPct > 6 ? "#FFD600" : "#00FF87" }}>±{f.uncertaintyPct}%</div>
                        </div>
                      )}
                    </div>
                    {parseFloat(kellyPct) > 0 && (
                      <div style={{ marginTop: 8, fontSize: 11, color: "#00FF87", fontFamily: "'JetBrains Mono',monospace" }}>
                        25% Kelly: <strong>{kellyPct}%</strong> of bankroll
                      </div>
                    )}
                    {b.preview && <div style={S.preview}>{b.preview}</div>}
                  </div>
                );
              })}

              {/* Parlay Cards */}
              {steals.length >= 2 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#333", letterSpacing: 1.5, marginBottom: 10 }}>PARLAY CARDS</div>
                  {[
                    { label: "SAFE", legs: steals.slice(0, 2), color: "#00FF87" },
                    { label: "BALANCED", legs: steals.slice(0, 3), color: "#FFD600" },
                    { label: "AGGRESSIVE", legs: steals.slice(0, 4), color: "#FF4D4D" },
                  ].filter(c => c.legs.length >= 2).map(card => (
                    <div key={card.label} style={{ background: "#080808", border: `1px solid ${card.color}22`, borderRadius: 12, padding: "12px 14px", marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: card.color, letterSpacing: 1 }}>{card.label} — {card.legs.length}-LEG</span>
                        <span style={{ fontSize: 10, color: "#333" }}>CLEAN picks only</span>
                      </div>
                      {card.legs.map((leg, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: i < card.legs.length - 1 ? "1px solid #111" : "none" }}>
                          <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono',monospace" }}>{leg.awayTeam} @ {leg.homeTeam}</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 11, color: "#00FF87", fontWeight: 700 }}>{leg.pick}</span>
                            <span style={{ fontSize: 11, color: "#444", fontFamily: "'JetBrains Mono',monospace" }}>+{(leg.filter?.trueEdgePct || 0).toFixed(1)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </>
          )
        )}

        {activeTab === "tracker" && (
          <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                <div style={S.statCard}><div style={{ ...S.statVal, color: "#00FF87", fontSize: 22 }}>{wins}</div><div style={S.statLabel}>Wins</div></div>
                <div style={S.statCard}><div style={{ ...S.statVal, color: "#FF4D4D", fontSize: 22 }}>{losses}</div><div style={S.statLabel}>Losses</div></div>
                <div style={S.statCard}><div style={{ ...S.statVal, fontSize: 22 }}>{winPct}%</div><div style={S.statLabel}>Win Rate</div></div>
              </div>
              {savedPicks.length === 0 ? (
                <div style={S.center}>
                  <div style={{ fontSize: 32 }}>📊</div>
                  <div style={{ color: "#fff", fontWeight: 700, marginTop: 8 }}>No saved picks yet</div>
                  <div style={{ color: "#333", fontSize: 13, marginTop: 4 }}>Tap + Save on any pick to track it</div>
                </div>
              ) : savedPicks.map(p => (
                <div key={p.id} style={{ ...S.card, borderColor: "#1a1a1a" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={S.cardMatchup}>{p.away_team} @ {p.home_team}</div>
                      <div style={S.cardMeta}>Pick: <span style={{ color: "#00FF87" }}>{p.pick}</span> · {fmtOdds(p.odds)}</div>
                      <div style={{ fontSize: 11, color: "#333", marginTop: 3 }}>
                        {new Date(p.commence_time).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        ...S.badge,
                        background: p.result === "win" ? "rgba(0,255,135,0.1)" : p.result === "loss" ? "rgba(255,77,77,0.1)" : "rgba(136,136,136,0.1)",
                        color: p.result === "win" ? "#00FF87" : p.result === "loss" ? "#FF4D4D" : "#888",
                      }}>
                        {p.result.toUpperCase()}
                      </span>
                      <button style={S.trashBtn} onClick={() => deleteSaved(p.id)}>🗑</button>
                    </div>
                  </div>
                  {p.result === "pending" && (
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <button style={{ ...S.resultBtn, background: "rgba(0,255,135,0.1)", color: "#00FF87", borderColor: "#00FF87" }} onClick={() => markResult(p.id, "win")}>✓ Win</button>
                      <button style={{ ...S.resultBtn, background: "rgba(255,77,77,0.1)", color: "#FF4D4D", borderColor: "#FF4D4D" }} onClick={() => markResult(p.id, "loss")}>✗ Loss</button>
                    </div>
                  )}
                </div>
              ))}
            </>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{background:#000;color:#fff;font-family:'Space Grotesk',sans-serif;}
  input{outline:none;}
  button{cursor:pointer;border:none;font-family:inherit;}
  @keyframes spin{to{transform:rotate(360deg);}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
  @keyframes slideIn{from{transform:translateX(-100%);}to{transform:translateX(0);}}
  @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
  ::-webkit-scrollbar{width:0;height:0;}
`;

const S = {
  page: { minHeight: "100vh", background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20, gap: 20 },
  previewBox: { width: "100%", maxWidth: 480, border: "1px solid #1a1a1a", borderRadius: 16, padding: 20, background: "#080808" },
  previewTag: { fontSize: 10, fontWeight: 700, color: "#00FF87", letterSpacing: 2, marginBottom: 10 },
  previewMatchup: { fontFamily: "'JetBrains Mono',monospace", fontSize: 17, fontWeight: 700 },
  previewReason: { fontSize: 13, color: "#555", marginTop: 10, lineHeight: 1.6 },
  authBox: { width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", gap: 12 },
  logo: { fontFamily: "'JetBrains Mono',monospace", fontSize: 36, fontWeight: 700, textAlign: "center", letterSpacing: -1 },
  authSub: { fontSize: 14, color: "#444", textAlign: "center" },
  googleBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 13, borderRadius: 10, background: "#0d0d0d", border: "1px solid #1a1a1a", color: "#fff", fontSize: 14, fontWeight: 500 },
  orRow: { display: "flex", alignItems: "center" },
  orLine: { flex: 1, height: 1, background: "#1a1a1a" },
  input: { padding: "13px 16px", borderRadius: 10, background: "#080808", border: "1px solid #1a1a1a", color: "#fff", fontSize: 14, width: "100%" },
  primaryBtn: { padding: 14, borderRadius: 10, background: "#00FF87", color: "#000", fontSize: 14, fontWeight: 700, width: "100%" },
  errMsg: { fontSize: 12, color: "#FF4D4D", textAlign: "center" },
  switchRow: { fontSize: 13, color: "#444", textAlign: "center" },
  app: { minHeight: "100vh", width: "100%", background: "#000", display: "flex", flexDirection: "column" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000, display: "flex" },
  drawer: { width: 270, background: "#080808", borderRight: "1px solid #1a1a1a", minHeight: "100vh", padding: 24, display: "flex", flexDirection: "column", gap: 4, animation: "slideIn 0.2s ease", overflowY: "auto" },
  drawerLogo: { fontFamily: "'JetBrains Mono',monospace", fontSize: 24, fontWeight: 700, marginBottom: 4 },
  drawerEmail: { fontSize: 12, color: "#333", marginBottom: 8 },
  drawerLine: { height: 1, background: "#1a1a1a", margin: "12px 0" },
  drawerItem: { padding: "10px 0", fontSize: 15, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 10 },
  drawerSectionLabel: { fontSize: 10, fontWeight: 700, color: "#333", letterSpacing: 1.5, marginBottom: 10 },
  accuracyCard: { background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 10, padding: 12 },
  nav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #111", position: "sticky", top: 0, background: "rgba(0,0,0,0.95)", backdropFilter: "blur(12px)", zIndex: 100 },
  menuBtn: { background: "none", display: "flex", flexDirection: "column", gap: 5, padding: 4 },
  menuLine: { width: 22, height: 1.5, background: "#fff" },
  navLogo: { fontFamily: "'JetBrains Mono',monospace", fontSize: 20, fontWeight: 700, letterSpacing: -1 },
  navBadge: { fontSize: 11, fontWeight: 700, color: "#000", background: "#00FF87", padding: "3px 10px", borderRadius: 20, letterSpacing: 0.5 },
  carousel: { margin: "12px 20px", border: "1px solid #1a1a1a", borderRadius: 12, padding: "14px 16px", background: "#080808", minHeight: 90 },
  carouselTag: { fontSize: 9, fontWeight: 700, color: "#00FF87", letterSpacing: 2, marginBottom: 6 },
  carouselMatchup: { fontFamily: "'JetBrains Mono',monospace", fontSize: 15, fontWeight: 700 },
  dateScroll: { display: "flex", gap: 6, padding: "10px 20px", overflowX: "auto", borderBottom: "1px solid #111" },
  dateBtn: { flexShrink: 0, padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "1px solid", letterSpacing: 0.3, whiteSpace: "nowrap" },
  subNav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", borderBottom: "1px solid #111" },
  tabBtn: { padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: "transparent", border: "1px solid", letterSpacing: 0.3 },
  sortBtn: { width: 30, height: 30, borderRadius: 8, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" },
  content: { flex: 1, padding: "12px 20px 40px", display: "flex", flexDirection: "column", gap: 10, overflowY: "auto" },
  center: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 60, textAlign: "center" },
  spinner: { width: 28, height: 28, border: "2px solid #1a1a1a", borderTopColor: "#00FF87", borderRadius: "50%", animation: "spin 0.7s linear infinite" },
  card: { background: "#080808", border: "1px solid", borderRadius: 14, padding: 14, transition: "border-color 0.2s", animation: "fadeUp 0.3s ease" },
  cardTop: { display: "flex", alignItems: "flex-start", gap: 10 },
  badge: { display: "inline-block", fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 6, letterSpacing: 0.3, marginBottom: 6 },
  cardMatchup: { fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700, marginTop: 2 },
  cardMeta: { fontSize: 12, color: "#444", marginTop: 4 },
  saveBtn: { fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 6, border: "1px solid", letterSpacing: 0.3 },
  expandBtn: { width: 28, height: 28, borderRadius: 6, background: "transparent", border: "1px solid", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" },
  pitchRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 10, padding: "8px 10px", background: "#050505", borderRadius: 8, border: "1px solid #111" },
  pitchBox: { flex: 1 },
  pitchLabel: { fontSize: 9, fontWeight: 700, color: "#333", letterSpacing: 1.5, marginBottom: 2 },
  pitchName: { fontSize: 12, fontWeight: 600, color: "#777" },
  pitchVs: { fontSize: 10, fontWeight: 700, color: "#222" },
  preview: { fontSize: 13, color: "#666", lineHeight: 1.6, marginTop: 10, paddingTop: 10, borderTop: "1px solid #111" },
  expDivider: { height: 1, background: "#111", margin: "12px 0" },
  expSection: { marginBottom: 12 },
  expLabel: { fontSize: 10, fontWeight: 700, color: "#333", letterSpacing: 1.5, marginBottom: 6 },
  expText: { fontSize: 13, color: "#666", lineHeight: 1.6 },
  statBox: { flex: 1, background: "#050505", borderRadius: 8, padding: "8px 10px", border: "1px solid #111" },
  statCard: { background: "#080808", border: "1px solid #1a1a1a", borderRadius: 12, padding: 14, textAlign: "center" },
  statLabel: { fontSize: 10, color: "#333", marginBottom: 3, marginTop: 4 },
  statVal: { fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" },
  trashBtn: { background: "transparent", border: "none", fontSize: 16, cursor: "pointer", padding: 4, opacity: 0.5 },
  resultBtn: { flex: 1, padding: "8px", borderRadius: 8, border: "1px solid", fontSize: 13, fontWeight: 700 },
};
