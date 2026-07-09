"use client";
export const dynamic = 'force-dynamic';
import { useState, useEffect, useRef } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { createClient } from "@supabase/supabase-js";
import NFLSection from "../components/NFLSection.js";

// Single shared instance — sign-out and auth listeners must share the same client
// so state changes propagate correctly. Calling createClient() on every request
// creates isolated instances that don't share in-memory auth state.
let _supabase = null;
const getSupabase = () => {
  if (!_supabase) _supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return _supabase;
};

const fmtOdds = (o) => o == null ? "—" : (o > 0 ? `+${o}` : `${o}`);

function fmtGameTime(iso) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getWeekDates() {
  const dates = [];
  const today = new Date();
  for (let i = -7; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(localDateStr(d));
  }
  return dates;
}

function fmtDateLabel(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const tomorrow  = new Date(); tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  if (d.toDateString() === today.toDateString())     return "Today";
  if (d.toDateString() === tomorrow.toDateString())  return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// Summarizes why no games came back — surfaces which odds source(s) failed
// (bad/missing API key, rate limit, etc.) vs. a genuine off day.
function fmtDiagnostic(d) {
  const parts = [];
  if (d.mlbSchedule) parts.push(`MLB schedule: ${d.mlbSchedule.ok ? `${d.mlbSchedule.games} games` : d.mlbSchedule.error}`);
  const o = d.odds || {};
  for (const key of ["toa", "sgo", "espn"]) {
    const s = o[key];
    if (!s) continue;
    parts.push(`${key.toUpperCase()}: ${s.ok ? `${s.games} games` : s.error}`);
  }
  return parts.join(" · ");
}

const TIER = {
  High:   { color: "#00FF87", bg: "rgba(0,255,135,0.08)", label: "🔥 Value Pick" },
  Medium: { color: "#FFD600", bg: "rgba(255,214,0,0.08)",  label: "✅ Solid Pick" },
  Low:    { color: "#888",    bg: "rgba(136,136,136,0.08)", label: "👀 Lean" },
  Tossup: { color: "#888",    bg: "rgba(68,68,68,0.06)",   label: "🎲 Toss-Up" },
};

function AccuracyPanel({ savedPicks }) {
  // Exclude push from win-rate denominator (push = stake returned, no P&L impact)
  const settled = savedPicks.filter(p => p.result !== "pending");
  const decisioned = settled.filter(p => p.result !== "push");
  const wins = decisioned.filter(p => p.result === "win").length;
  const winPct = decisioned.length > 0 ? Math.round((wins / decisioned.length) * 100) : null;

  const byTier = ["High", "Medium", "Low"].map(tier => {
    const tPicks = decisioned.filter(p => p.tier === tier);
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
          <span style={{ fontSize: 12, color: "#999" }}>Overall Hit Rate</span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 700, color: rateColor }}>
            {winPct !== null ? `${winPct}%` : "—"}
          </span>
        </div>
        <div style={{ marginTop: 8, height: 3, background: "#111", borderRadius: 2 }}>
          <div style={{ height: "100%", borderRadius: 2, width: `${winPct || 0}%`, background: rateColor, transition: "width 0.6s ease" }} />
        </div>
        <div style={{ fontSize: 11, color: "#777", marginTop: 6 }}>{decisioned.length} settled pick{decisioned.length !== 1 ? "s" : ""}</div>
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
      {settled.length === 0 && (
        <div style={{ fontSize: 12, color: "#777", marginTop: 10, lineHeight: 1.6 }}>
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
  const [picksError, setPicksError] = useState(null);
  const [picksDiagnostic, setPicksDiagnostic] = useState(null);
  const [savedPicks, setSavedPicks] = useState([]);
  const [gameRecaps, setGameRecaps] = useState({});
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("picks");
  const [sortBy, setSortBy] = useState("edge");
  const [expanded, setExpanded] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState({});
  const [freePick, setFreePick] = useState(null);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const weekDates = getWeekDates();
  const todayStr = weekDates[7];
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const dateScrollRef = useRef(null);
  const todayBtnRef = useRef(null);
  const [steals, setSteals] = useState(null);
  const [parlayLegs, setParlayLegs] = useState(new Map()); // id -> { game, teamPick }
  const [parlayStake, setParlayStake] = useState(10);
  const [picksDate, setPicksDate] = useState(null); // tracks which date picks were loaded for
  const [isPro, setIsPro] = useState(null);
  const [isBeta, setIsBeta] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [modelRecord, setModelRecord] = useState(null);
  const [unitSize, setUnitSize] = useState(10);
  const [copied, setCopied] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [calRecord, setCalRecord] = useState(null);
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [showAuth, setShowAuth] = useState(false);
  const heroEmailRef = useRef(null);
  const [subEmail, setSubEmail] = useState("");
  const [subStatus, setSubStatus] = useState(null); // null | "loading" | "ok" | "err"
  const [accessCode, setAccessCode] = useState("");
  const [codeStatus, setCodeStatus] = useState(null); // null | "loading" | "ok" | "invalid"
  const [installPlatform, setInstallPlatform] = useState(null); // 'ios' | 'android'
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [upgradeModal, setUpgradeModal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [activatingPro, setActivatingPro] = useState(false);
  const [nflSubTab, setNflSubTab] = useState("picks");

  // Auth state — use the shared singleton so getAuthHeaders() shares the same session.
  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = sb.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  // After 6 PM local time today's games are done — default to tomorrow's picks.
  // Must be useEffect (not useState initializer) to avoid SSR/client hydration mismatch.
  useEffect(() => {
    if (new Date().getHours() >= 18) setSelectedDate(d => d === weekDates[7] ? weekDates[8] : d);
    // Restore cached pro status client-side only (localStorage not available during SSR)
    try {
      const c = localStorage.getItem("tot-pro");
      if (c) { const { v, e } = JSON.parse(c); if (Date.now() < e) setIsPro(v); }
    } catch {}
  }, []);

  // Subscription check
  useEffect(() => {
    if (!user) { setIsPro(null); return; }
    const admins = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
    if (admins.includes(user.email?.toLowerCase())) { setIsPro(true); return; }
    getSupabase()
      .from("subscriptions")
      .select("status")
      .eq("user_id", user.id)
      .single()
      .then(({ data, error }) => {
        if (error && error.code !== "PGRST116") { setIsPro(false); return; }
        const pro = ["active", "trialing"].includes(data?.status ?? "");
        setIsPro(pro);
        try { localStorage.setItem("tot-pro", JSON.stringify({ v: pro, e: Date.now() + 5 * 60 * 1000 })); } catch {}
      })
      .catch(() => setIsPro(false));
  }, [user?.id]);

  // Poll for subscription after checkout redirect
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    window.history.replaceState({}, "", "/app");
    setActivatingPro(true);
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      const { data } = await getSupabase().from("subscriptions").select("status").eq("user_id", user.id).single();
      if (["active", "trialing"].includes(data?.status)) {
        setIsPro(true);
        setActivatingPro(false);
        try { localStorage.setItem("tot-pro", JSON.stringify({ v: true, e: Date.now() + 5 * 60 * 1000 })); } catch {}
        clearInterval(poll);
      }
      if (attempts >= 6) { setActivatingPro(false); clearInterval(poll); }
    }, 2000);
    return () => clearInterval(poll);
  }, [user?.id]);

  // Load free pick, global model record, start carousel
  useEffect(() => {
    fetch("/api/free-pick").then(r => r.json()).then(d => {
      setFreePick(d.pick || null);
      if (d.quietDay) setFreePick({ _quietDay: true });
    }).catch(() => {});
    fetch("/api/model-record").then(r => r.json()).then(d => setModelRecord(d)).catch(() => {});
    const t = setInterval(() => setCarouselIdx(i => i + 1), 3000);
    return () => clearInterval(t);
  }, []);

  // Scroll date strip to Today on load
  useEffect(() => {
    if (todayBtnRef.current && dateScrollRef.current) {
      const strip = dateScrollRef.current;
      const btn = todayBtnRef.current;
      strip.scrollLeft = btn.offsetLeft - strip.clientWidth / 2 + btn.offsetWidth / 2;
    }
  }, []);

  // Capture Android/Chrome native install prompt before it fires
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Show install prompt after user is engaged (logged in, 4s on page, not already installed)
  useEffect(() => {
    if (!user) return;
    const isStandalone = window.navigator.standalone || window.matchMedia("(display-mode: standalone)").matches;
    if (isStandalone) return;
    const dismissedAt = localStorage.getItem("tot-pwa-dismissed");
    if (dismissedAt && Date.now() - parseInt(dismissedAt) < 7 * 24 * 60 * 60 * 1000) return;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (!isIOS && !deferredPrompt) return;
    const platform = isIOS ? "ios" : "android";
    const timer = setTimeout(() => { setInstallPlatform(platform); setShowInstallPrompt(true); }, 4000);
    return () => clearTimeout(timer);
  }, [user, deferredPrompt]);

  // Record tab: load for any logged-in user (model performance is not subscription-gated)
  useEffect(() => {
    if (user && activeTab === "record") fetchCalRecord();
  }, [user, activeTab]);

  // Tab data fetching — only runs after isPro resolves to avoid premature API calls
  // that return 403 (no subscription) and set picks to [].
  useEffect(() => {
    if (!user || !isPro) return;
    if (activeTab === "picks") fetchPicks(selectedDate);
    if (activeTab === "parlay" && picksDate !== selectedDate) fetchPicks(selectedDate);
    if (activeTab === "steals") fetchSteals(selectedDate);
    if (activeTab === "tracker") fetchSaved();
  }, [user, isPro, activeTab, selectedDate]);

  useEffect(() => {
    if (user && isPro && activeTab !== "tracker") fetchSaved();
  }, [user, isPro]);

  const startCheckout = async (plan) => {
    setCheckingOut(plan);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ plan, email: user.email }),
      });
      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch (e) {}
    setCheckingOut(false);
  };

  const manageBilling = async () => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.url) { window.location.href = data.url; return; }
      alert(data.error || "Billing portal unavailable. Contact support.");
    } catch (e) {
      alert("Could not open billing portal. Try again later.");
    }
  };

  const copySteals = () => {
    if (!steals?.length) return;
    const lines = steals.map(p => {
      const o = p.pick === p.homeTeam ? p.homeOdds : p.awayOdds;
      return `${p.awayTeam} @ ${p.homeTeam} — Take ${p.pick} (${fmtOdds(o)}) | Edge: +${(p.filter?.trueEdgePct || 0).toFixed(1)}%`;
    });
    const text = `ToT CLEAN Bets — ${new Date().toLocaleDateString()}\n\n${lines.join("\n")}`;
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const fetchCalRecord = async () => {
    try {
      const d = await fetch("/api/daily-record").then(r => r.json());
      setCalRecord(d && !d.error ? d : {});
    } catch { setCalRecord({}); }
  };

  const getAuthHeaders = async () => {
    const { data: { session } } = await getSupabase().auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  };

  const fetchSteals = async (date) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/steals?date=${date}`, { headers });
      const data = await res.json();
      setSteals(data.steals || []);
    } catch (e) { setSteals(prev => prev ?? []); }
  };

  const fetchPicks = async (date, bust = false) => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/picks?date=${date}${bust ? "&bust=1" : ""}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      const next = data.picks || [];
      setPicksError(null);
      setPicksDiagnostic(data.diagnostic || null);
      setPicks(next);
      setPicksDate(prev => {
        // Only reset parlay legs when the date changes (not on tab switch re-fetch)
        if (prev !== date) {
          setParlayLegs(new Map(
            next.filter(p => p.isBet && p.homeOdds != null)
                .map(p => [p.id, { game: p, teamPick: p.pick }])
          ));
        }
        return date;
      });
    } catch (e) {
      console.error("picks error", e);
      setPicksError(e.message || "Could not load games");
      setPicksDiagnostic(null);
      setPicks(prev => prev ?? []);
    }
    setLoading(false);
  };

  // Fetch recaps for final games on the picks page
  useEffect(() => {
    if (!picks?.length) return;
    const finals = picks.filter(p => p.liveScore?.status === "Final" && p.id && !gameRecaps[p.id]);
    if (!finals.length) return;
    (async () => {
      const headers = await getAuthHeaders();
      const entries = await Promise.all(finals.map(async p => {
        try {
          const hs = p.liveScore.homeScore, as2 = p.liveScore.awayScore;
          const result = hs === as2 ? "push" : (hs > as2) === (p.pick === p.homeTeam) ? "win" : "loss";
          const date = p.commenceTime?.split("T")[0] || "";
          const params = new URLSearchParams({ gamePk: p.id, homeTeam: p.homeTeam, awayTeam: p.awayTeam, date, pick: p.pick || "", result, edge: p.edge != null ? String(p.edge) : "", tier: p.tier?.level || "" });
          const res = await fetch(`/api/tracker/game-recap?${params}`, { headers });
          const data = await res.json();
          return [p.id, data.error ? "error" : data];
        } catch { return [p.id, "error"]; }
      }));
      setGameRecaps(prev => ({ ...prev, ...Object.fromEntries(entries) }));
    })();
  }, [picks]);

  const fetchSaved = async () => {
    setLoading(activeTab === "tracker");
    // Auto-resolve any pending picks whose games are finished
    const headers = await getAuthHeaders();
    await fetch("/api/tracker/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ userId: user.id }),
    }).catch(() => {});
    const { data } = await getSupabase().from("saved_picks").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    const picks = data || [];
    const gameIds = picks.map(p => p.game_id).filter(Boolean);
    let modelData = {};
    if (gameIds.length) {
      const { data: mp } = await getSupabase().from("model_picks").select("game_id,home_score,away_score,edge").in("game_id", gameIds);
      if (mp) mp.forEach(r => { modelData[r.game_id] = r; });
    }
    const merged = picks.map(p => ({ ...p, ...(modelData[p.game_id] || {}) }));
    setSavedPicks(merged);

    // Auto-fetch recaps for all resolved picks. NFL has no recap source yet
    // (game-recap is MLB-boxscore-specific) — mark those "error" directly instead of
    // fetching, so the tracker card shows "details unavailable" rather than getting
    // stuck on "Loading game details..." forever.
    const resolvedAll = merged.filter(p => p.result !== "pending" && p.result !== "push" && p.game_id);
    const mlbResolved = resolvedAll.filter(p => p.sport !== "nfl");
    const nflEntries = resolvedAll.filter(p => p.sport === "nfl").map(p => [p.game_id, "error"]);
    if (resolvedAll.length) {
      const headers = await getAuthHeaders();
      const recapEntries = await Promise.all(
        mlbResolved.map(async p => {
          try {
            const date = p.commence_time?.split("T")[0] || "";
            const params = new URLSearchParams({ gamePk: p.game_id, homeTeam: p.home_team, awayTeam: p.away_team, date, pick: p.pick || "", result: p.result || "", edge: p.edge != null ? String(p.edge) : "", tier: p.tier || "" });
            const res = await fetch(`/api/tracker/game-recap?${params}`, { headers });
            const data = await res.json();
            return [p.game_id, data.error ? "error" : data];
          } catch {
            return [p.game_id, "error"];
          }
        })
      );
      setGameRecaps(prev => ({ ...prev, ...Object.fromEntries([...recapEntries, ...nflEntries]) }));
    }

    setLoading(false);
  };

  // sport: "mlb" (default, existing behavior) | "nfl". NFL picks carry a market_type
  // (moneyline/spread/total) and, for spread/total, a line — needed by
  // app/api/tracker/resolve to grade them correctly, since NFL games have 3 markets
  // per pick.id rather than MLB's 1. pick.id already includes the market suffix
  // (e.g. "<gameId>-spread"), so the existing user_id+game_id uniqueness still holds.
  const savePick = async (pick, sport = "mlb") => {
    if (saving[pick.id] === "saved") return;
    if (savedPicks.some(p => p.game_id === pick.id)) return;
    setSaving(s => ({ ...s, [pick.id]: "saving" }));
    const odds = sport === "nfl"
      ? (pick.marketType === "spread" ? (pick.pick === pick.homeTeam ? pick.homeSpreadOdds : pick.awaySpreadOdds)
        : pick.marketType === "total" ? (pick.pick === "Over" ? pick.overOdds : pick.underOdds)
        : (pick.pick === pick.homeTeam ? pick.homeOdds : pick.awayOdds))
      : (pick.homeTeam === pick.pick ? pick.homeOdds : pick.awayOdds);
    await getSupabase().from("saved_picks").upsert({
      user_id: user.id,
      game_id: pick.id,
      home_team: pick.homeTeam,
      away_team: pick.awayTeam,
      pick: pick.pick,
      odds,
      tier: pick.tier?.level,
      commence_time: pick.commenceTime,
      result: "pending",
      sport,
      market_type: sport === "nfl" ? pick.marketType : "moneyline",
      line: sport === "nfl" ? (pick.marketType === "spread" ? pick.spread : pick.marketType === "total" ? pick.total : null) : null,
      edge: sport === "nfl" ? pick.edge : null,
    }, { onConflict: "user_id,game_id" });
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

  const handleDragEnd = (result) => {
    const { source, destination } = result;
    if (!destination) return;
    const newPicks = Array.from(savedPicks);
    const [moved] = newPicks.splice(source.index, 1);
    newPicks.splice(destination.index, 0, moved);
    setSavedPicks(newPicks);
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

  const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  const isAdmin = !!user?.email && adminEmails.includes(user.email.toLowerCase());

  useEffect(() => {
    if (!user?.email) { setIsBeta(false); return; }
    const betas = (process.env.NEXT_PUBLIC_BETA_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
    setIsBeta(betas.includes(user.email.toLowerCase()));
  }, [user?.email]);

  const generatePicks = async () => {
    setGenerating(true);
    try {
      const headers = await getAuthHeaders();
      await fetch("/api/admin/regen", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({}) });
      await fetchPicks(selectedDate, true);
    } catch (e) { console.error("regen error", e); }
    setGenerating(false);
  };

  const sorted = [...(picks || [])].sort((a, b) => {
    if (sortBy === "time") return new Date(a.commenceTime) - new Date(b.commenceTime);
    const vRank = { CLEAN: 3, BET: 2, PASS: 1, TRAP: 0 };
    const va = vRank[a.filter?.verdict] ?? (a.isBet ? 2 : 1);
    const vb = vRank[b.filter?.verdict] ?? (b.isBet ? 2 : 1);
    if (vb !== va) return vb - va;
    return (b.edge || 0) - (a.edge || 0);
  });

  // Parlay builder computed values
  const parlayLegsList = [...parlayLegs.values()];
  const parlayDec = parlayLegsList.reduce((acc, { game, teamPick }) => {
    const o = teamPick === game.homeTeam ? game.homeOdds : game.awayOdds;
    if (!o) return acc;
    return acc * (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
  }, 1);
  const parlayAmerican = parlayLegsList.length < 2 ? "—"
    : parlayDec >= 2 ? `+${Math.round((parlayDec - 1) * 100)}`
    : `-${Math.round(100 / (parlayDec - 1))}`;
  const parlayProfit = parlayLegsList.length >= 2 ? ((parlayDec - 1) * parlayStake).toFixed(2) : "0.00";

  // Tracker stats — push = stake returned, doesn't count for win/loss rate
  const wins    = savedPicks.filter(p => p.result === "win").length;
  const losses  = savedPicks.filter(p => p.result === "loss").length;
  const pushes  = savedPicks.filter(p => p.result === "push").length;
  const total   = savedPicks.filter(p => p.result !== "pending").length;
  const decisioned = wins + losses;
  const winPct  = decisioned > 0 ? Math.round((wins / decisioned) * 100) : 0;

  const pnl = savedPicks.filter(p => p.result !== "pending" && p.result !== "push").reduce((sum, p) => {
    if (!p.odds) return sum; // no odds data for past games
    if (p.result === "win") {
      const o = p.odds;
      return sum + (o > 0 ? unitSize * o / 100 : unitSize * 100 / Math.abs(o));
    }
    return sum - unitSize;
  }, 0);

  // Current streak (skips pushes)
  const settledByDate = [...savedPicks]
    .filter(p => p.result !== "pending" && p.result !== "push")
    .sort((a, b) => new Date(b.commence_time) - new Date(a.commence_time));
  let streakLen = 0, streakType = null;
  if (settledByDate.length) {
    streakType = settledByDate[0].result;
    for (const p of settledByDate) { if (p.result === streakType) streakLen++; else break; }
  }

  // Carousel slides: [free pick, model record, promo]
  const carouselSlides = [
    { type: "free-pick" },
    { type: "record" },
    { type: "promo" },
  ];
  const slide = carouselSlides[carouselIdx % carouselSlides.length];

  const fmtOddsL = o => o == null ? "" : o > 0 ? `+${o}` : `${o}`;
  const landWinPct = modelRecord?.pct;
  const landRateColor = landWinPct == null ? "#fff" : landWinPct >= 58 ? "#00FF87" : landWinPct >= 52 ? "#FFD600" : "#fff";
  const MOCK_PICKS = [
    { away: "Yankees", home: "Red Sox",   verdict: "CLEAN", pick: "Yankees", odds: "-118", edge: "+4.2%", blur: false },
    { away: "Dodgers", home: "Padres",    verdict: "BET",   pick: "Dodgers", odds: "-132", edge: "+3.1%", blur: false },
    { away: "Astros",  home: "Rangers",   verdict: null,    pick: "Rangers", odds: "+104", edge: null,    blur: true  },
    { away: "Cubs",    home: "Cardinals", verdict: null,    pick: "Cubs",    odds: "-110", edge: null,    blur: true  },
  ];

  if (!user) return (
    <div style={{ minHeight: "100vh", background: "#000", fontFamily: "'Space Grotesk',sans-serif", color: "#fff", overflowX: "hidden" }}>
      <style>{`
        ${css}
        @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        .l-fade{animation:fadeUp .6s ease both}
        .l-fade2{animation:fadeUp .6s .15s ease both}
        .l-fade3{animation:fadeUp .6s .3s ease both}
        .l-float{animation:float 4s ease-in-out infinite}
        .l-cta{background:#00FF87;color:#000;font-weight:800;font-size:15px;padding:14px 28px;border:none;border-radius:12px;cursor:pointer;transition:opacity .15s,transform .15s;display:inline-block;text-align:center}
        .l-cta:hover{opacity:.9;transform:translateY(-1px)}
        .l-ghost{background:transparent;color:#fff;font-weight:700;font-size:14px;padding:13px 24px;border:1px solid #333;border-radius:12px;cursor:pointer;transition:border-color .2s;display:inline-block;text-align:center}
        .l-ghost:hover{border-color:#555}
        .l-glow{background:linear-gradient(90deg,transparent,rgba(0,255,135,.35),transparent);height:1px;width:100%}
        .l-pick{background:#080808;border:1px solid #1a1a1a;border-radius:14px;padding:13px 15px}
        .l-blur{position:relative;overflow:hidden}
        .l-mask{position:absolute;inset:0;backdrop-filter:blur(5px);background:rgba(0,0,0,.4);border-radius:14px;display:flex;align-items:center;justify-content:center;z-index:2}
        .l-lock{background:rgba(0,0,0,.8);border:1px solid #222;border-radius:8px;padding:5px 11px;font-size:10px;color:#555;font-weight:700;letter-spacing:1px}
        .l-shim{background:linear-gradient(90deg,#111 25%,#1a1a1a 50%,#111 75%);background-size:400px 100%;animation:shimmer 1.4s infinite;border-radius:4px}
        .l-feat{background:#060606;border:1px solid #111;border-radius:18px;padding:22px;flex:1;min-width:200px}
        .l-stat{background:#080808;border:1px solid #1a1a1a;border-radius:16px;padding:20px;flex:1;min-width:130px}
      `}</style>

      {!showAuth ? (
        <>
          {/* NAV */}
          <nav style={{ position:"sticky",top:0,zIndex:100,background:"rgba(0,0,0,.88)",backdropFilter:"blur(20px)",borderBottom:"1px solid #0d0d0d",padding:"13px 20px",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:17,fontWeight:700 }}>T<span style={{ color:"#00FF87" }}>|</span>T</div>
            <div style={{ display:"flex",gap:10,alignItems:"center" }}>
              <a href="https://twitter.com/ThisorThatPicks" target="_blank" rel="noopener noreferrer" style={{ fontSize:12,color:"#444",textDecoration:"none" }}>𝕏 @ThisorThatPicks</a>
              <button className="l-cta" style={{ fontSize:12,padding:"8px 18px" }} onClick={() => { setShowAuth(true); setAuthMode("signin"); }}>Sign In →</button>
            </div>
          </nav>

          {/* HERO */}
          <section style={{ padding:"72px 20px 60px",maxWidth:800,margin:"0 auto",textAlign:"center" }}>
            <div className="l-fade" style={{ display:"inline-flex",alignItems:"center",gap:8,background:"rgba(0,255,135,.06)",border:"1px solid rgba(0,255,135,.15)",borderRadius:40,padding:"5px 13px",marginBottom:24 }}>
              <span style={{ width:7,height:7,borderRadius:"50%",background:"#00FF87",animation:"pulse 1.5s ease-in-out infinite",display:"inline-block" }} />
              <span style={{ fontSize:11,color:"#00FF87",fontWeight:700,letterSpacing:1.5 }}>LIVE TODAY · MLB</span>
            </div>
            <h1 className="l-fade2" style={{ fontSize:"clamp(38px,8vw,72px)",fontWeight:800,lineHeight:1.05,letterSpacing:-2,marginBottom:18 }}>
              We outperform<br/><span style={{ color:"#00FF87" }}>Vegas odds</span><br/>with data.
            </h1>
            <p className="l-fade3" style={{ fontSize:"clamp(14px,2.5vw,17px)",color:"#666",lineHeight:1.65,maxWidth:520,margin:"0 auto 32px" }}>
              T|T is a sharp MLB model that finds genuine edges the books miss — pitcher match-ups, bullpen state, park factors, and line movement. Not gut feelings. Edges.
            </p>
            <div style={{ display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap",marginBottom:40 }}>
              <button className="l-cta" onClick={() => { setShowAuth(true); setAuthMode("signup"); }}>Start free →</button>
              <button className="l-ghost" onClick={() => heroEmailRef.current?.scrollIntoView({ behavior:"smooth" })}>Get daily pick by email</button>
            </div>
            {modelRecord?.total > 0 && (
              <div style={{ display:"inline-flex",gap:28,background:"#080808",border:"1px solid #1a1a1a",borderRadius:14,padding:"13px 24px",flexWrap:"wrap",justifyContent:"center" }}>
                {[
                  { label:"Win Rate", value:`${landWinPct}%`, color:landRateColor },
                  { label:"Record",   value:`${modelRecord.wins}-${modelRecord.losses}`, color:"#fff" },
                  { label:"Picks Tracked", value:`${modelRecord.total}+`, color:"#fff" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ textAlign:"center" }}>
                    <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:20,fontWeight:700,color }}>{value}</div>
                    <div style={{ fontSize:10,color:"#444",marginTop:2,letterSpacing:1 }}>{label.toUpperCase()}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="l-glow" style={{ maxWidth:860,margin:"0 auto" }} />

          {/* APP MOCKUP */}
          <section style={{ padding:"72px 20px",maxWidth:480,margin:"0 auto" }}>
            <div style={{ textAlign:"center",marginBottom:32 }}>
              <div style={{ fontSize:11,color:"#00FF87",fontWeight:700,letterSpacing:2,marginBottom:8 }}>THE APP</div>
              <h2 style={{ fontSize:"clamp(24px,5vw,36px)",fontWeight:800,letterSpacing:-1,lineHeight:1.2 }}>Every game. Every edge.<br/>Every morning.</h2>
              <p style={{ color:"#555",fontSize:13,marginTop:10,lineHeight:1.6 }}>Pro members see all picks, full AI breakdowns, and edge scores for every game on the board.</p>
            </div>
            <div className="l-float" style={{ background:"#080808",border:"1px solid #1a1a1a",borderRadius:26,padding:"18px 15px",boxShadow:"0 40px 80px rgba(0,0,0,.6),0 0 0 1px #111" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,padding:"0 3px" }}>
                <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:14,fontWeight:700 }}>T<span style={{ color:"#00FF87" }}>|</span>T</div>
                <div style={{ display:"flex",gap:8 }}>
                  {["⚾ Picks","💎 Steals","📊 Tracker"].map(t => (
                    <div key={t} style={{ fontSize:10,color:t==="⚾ Picks"?"#00FF87":"#333",fontWeight:700 }}>{t}</div>
                  ))}
                </div>
              </div>
              {/* Live free pick */}
              {freePick && (
                <div className="l-pick" style={{ marginBottom:8,borderColor:"rgba(0,255,135,.2)",boxShadow:"0 0 30px rgba(0,255,135,.08)" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:7 }}>
                    <span style={{ fontSize:10,color:"#555" }}>7:05 PM CT</span>
                    <span style={{ background:"rgba(0,255,135,.1)",color:"#00FF87",fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:5,letterSpacing:1 }}>
                      {freePick.filter?.verdict === "CLEAN" ? "🔥 Value Pick" : "✅ Solid Pick"}
                    </span>
                  </div>
                  <div style={{ display:"flex",gap:7,marginBottom:7 }}>
                    {[{ side:"AWAY",team:freePick.awayTeam,odds:freePick.awayOdds,isPick:freePick.pick===freePick.awayTeam },
                      { side:"HOME",team:freePick.homeTeam,odds:freePick.homeOdds,isPick:freePick.pick===freePick.homeTeam }].map(({ side,team,odds,isPick }) => (
                      <div key={side} style={{ flex:1,background:"#0d0d0d",border:"1px solid #1a1a1a",borderRadius:7,padding:"7px 9px",textAlign:side==="HOME"?"right":"left" }}>
                        <div style={{ fontSize:9,color:"#555",marginBottom:2 }}>{side}</div>
                        <div style={{ fontSize:12,fontWeight:700,color:isPick?"#00FF87":"#fff" }}>{team?.split(" ").pop()}</div>
                        <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#555",marginTop:1 }}>{odds!=null?fmtOddsL(odds):"—"}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ background:"rgba(0,255,135,.05)",border:"1px solid rgba(0,255,135,.1)",borderRadius:7,padding:"7px 9px" }}>
                    <div style={{ fontSize:10,color:"#00FF87",fontWeight:700,marginBottom:freePick.breakdown?.preview?3:0 }}>
                      Take {freePick.pick?.split(" ").pop()} · {freePick.edge?.toFixed(1)}% edge
                    </div>
                    {freePick.breakdown?.preview && <div style={{ fontSize:10,color:"#555",lineHeight:1.5 }}>{freePick.breakdown.preview.slice(0,80)}…</div>}
                  </div>
                </div>
              )}
              {/* Blurred mock picks */}
              {MOCK_PICKS.slice(0, freePick ? 3 : 4).map((p, i) => (
                <div key={i} className={`l-pick l-blur`} style={{ marginBottom:8,opacity:p.blur?.7:1 }}>
                  {p.blur && <div className="l-mask"><div className="l-lock">🔒 PRO ONLY</div></div>}
                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:5 }}>
                    <span style={{ fontSize:10,color:"#444" }}>MLB</span>
                    {!p.blur && p.verdict && <span style={{ background:p.verdict==="CLEAN"?"rgba(0,255,135,.1)":"rgba(255,214,0,.1)",color:p.verdict==="CLEAN"?"#00FF87":"#FFD600",fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:5,letterSpacing:1 }}>{p.verdict==="CLEAN"?"🔥 Value":"✅ Solid"}</span>}
                  </div>
                  <div style={{ fontSize:12,fontWeight:700,filter:p.blur?"blur(6px)":"none" }}>{p.away} @ {p.home}</div>
                  {!p.blur && <div style={{ fontSize:10,color:"#00FF87",marginTop:3 }}>Take {p.pick} {p.odds} · {p.edge}</div>}
                  {p.blur && <div style={{ display:"flex",gap:6,marginTop:5,filter:"blur(5px)" }}><div className="l-shim" style={{ height:7,width:"55%" }}/><div className="l-shim" style={{ height:7,width:"30%" }}/></div>}
                </div>
              ))}
              <div style={{ marginTop:10,background:"rgba(0,255,135,.05)",border:"1px solid rgba(0,255,135,.1)",borderRadius:11,padding:"11px",textAlign:"center" }}>
                <div style={{ fontSize:11,color:"#00FF87",fontWeight:700,marginBottom:3 }}>Unlock all picks for $2/mo</div>
                <div style={{ fontSize:10,color:"#444" }}>Full breakdowns · edge scores · parlay builder</div>
              </div>
            </div>
          </section>

          <div className="l-glow" style={{ maxWidth:860,margin:"0 auto" }} />

          {/* HOW IT WORKS */}
          <section style={{ padding:"72px 20px",maxWidth:1060,margin:"0 auto" }}>
            <div style={{ textAlign:"center",marginBottom:44 }}>
              <div style={{ fontSize:11,color:"#00FF87",fontWeight:700,letterSpacing:2,marginBottom:8 }}>HOW IT WORKS</div>
              <h2 style={{ fontSize:"clamp(24px,5vw,38px)",fontWeight:800,letterSpacing:-1 }}>Built different from the jump</h2>
              <p style={{ color:"#555",fontSize:14,marginTop:10,maxWidth:440,margin:"10px auto 0",lineHeight:1.6 }}>A six-layer AND-gate filter. Every condition must pass — one failure means PASS.</p>
            </div>
            <div style={{ display:"flex",gap:14,flexWrap:"wrap" }}>
              {[
                { icon:"⚾", tag:"DATA LAYER 1", title:"Pitcher-first analysis",   body:"Starter ERA, WHIP, innings pitched, and sample size. Plus bullpen ERA and K/9 for the full game — starters get the spotlight, bullpens finish ~40% of outs." },
                { icon:"📐", tag:"DATA LAYER 2", title:"Market edge scoring",       body:"We compare our model's win probability to the book's implied probability. Only plays with a verified edge above 2.5% after market calibration pass. No phantom edges." },
                { icon:"🏟️", tag:"DATA LAYER 3", title:"Park + lineup context",     body:"Every pick accounts for park factor, lineup OPS vs pitcher hand, and recent form over the last 10 games. Coors isn't Petco." },
                { icon:"⚡", tag:"VERDICT",       title:"CLEAN / BET / PASS tiers",  body:"CLEAN passes every condition in the AND-gate. BET passes most. PASS is the honest answer when there's no edge. Some days are zero-bet days — that's correct." },
                { icon:"📊", tag:"TRACKER",       title:"Personal tracker + P&L",    body:"Every pick you save auto-resolves. Real-time P&L in dollars based on your unit size. See your actual edge over time, not just win-loss." },
                { icon:"🤖", tag:"AI",            title:"Claude AI breakdowns",      body:"Every pick has a 2-sentence preview, key deciding factor, main risk, and honest lean — from the same AI reasoning layer that powers the pick." },
              ].map(({ icon, tag, title, body }) => (
                <div key={title} className="l-feat" style={{ minWidth:"calc(33% - 10px)",flex:"1 1 260px" }}>
                  <div style={{ fontSize:10,color:"#00FF87",fontWeight:700,letterSpacing:1.5,marginBottom:10 }}>{tag}</div>
                  <div style={{ fontSize:20,marginBottom:8 }}>{icon}</div>
                  <div style={{ fontSize:15,fontWeight:700,marginBottom:7 }}>{title}</div>
                  <div style={{ fontSize:13,color:"#555",lineHeight:1.65 }}>{body}</div>
                </div>
              ))}
            </div>
          </section>

          <div className="l-glow" style={{ maxWidth:860,margin:"0 auto" }} />

          {/* US VS VEGAS */}
          <section style={{ padding:"72px 20px",maxWidth:860,margin:"0 auto" }}>
            <div style={{ textAlign:"center",marginBottom:44 }}>
              <div style={{ fontSize:11,color:"#00FF87",fontWeight:700,letterSpacing:2,marginBottom:8 }}>THE NUMBERS</div>
              <h2 style={{ fontSize:"clamp(26px,6vw,48px)",fontWeight:800,letterSpacing:-2,lineHeight:1.1 }}>Us <span style={{ color:"#00FF87" }}>{'>'}</span> Vegas</h2>
              <p style={{ color:"#555",fontSize:14,marginTop:12,maxWidth:440,margin:"12px auto 0" }}>The book's built-in juice means you need to hit 52.4% just to break even. We aim higher.</p>
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12,marginBottom:32 }}>
              {[
                { label:"Break-even needed",    us:modelRecord?.pct?`${modelRecord.pct}%`:"—",   them:"52.4%", sub:"win rate" },
                { label:"Model edge per pick",  us:modelRecord?.avgEdge?`+${modelRecord.avgEdge}%`:"+3–5%", them:"0%", sub:"vs vig" },
                { label:"Filter layers",         us:"6-layer",  them:"1-layer",  sub:"AND-gate" },
                { label:"Pick transparency",     us:"Full",     them:"None",     sub:"every condition shown" },
              ].map(({ label, us, them, sub }) => (
                <div key={label} className="l-stat">
                  <div style={{ fontSize:10,color:"#444",letterSpacing:1,marginBottom:10 }}>{label.toUpperCase()}</div>
                  <div style={{ display:"flex",gap:10,alignItems:"flex-end" }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:10,color:"#00FF87",fontWeight:700,letterSpacing:1,marginBottom:2 }}>T|T</div>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:700,color:"#00FF87" }}>{us}</div>
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:10,color:"#444",fontWeight:700,letterSpacing:1,marginBottom:2 }}>VEGAS</div>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:700,color:"#333" }}>{them}</div>
                    </div>
                  </div>
                  <div style={{ fontSize:11,color:"#2a2a2a",marginTop:6 }}>{sub}</div>
                </div>
              ))}
            </div>
            <div style={{ textAlign:"center",background:"#060606",border:"1px solid #0d0d0d",borderRadius:12,padding:"14px 20px" }}>
              <div style={{ fontSize:12,color:"#2a2a2a",lineHeight:1.6 }}>MLB carries extreme variance. Even 60% pickers lose stretches. This is a tool for finding edges, not a guarantee. Bet responsibly.</div>
            </div>
          </section>

          <div className="l-glow" style={{ maxWidth:860,margin:"0 auto" }} />

          {/* PRICING + EMAIL CTA */}
          <section style={{ padding:"72px 20px",maxWidth:820,margin:"0 auto",textAlign:"center" }}>
            <div style={{ fontSize:11,color:"#00FF87",fontWeight:700,letterSpacing:2,marginBottom:12 }}>PRICING</div>
            <h2 style={{ fontSize:"clamp(26px,5vw,42px)",fontWeight:800,letterSpacing:-1.5,lineHeight:1.1,marginBottom:12 }}>Sharp picks shouldn't<br/>cost sharp money.</h2>
            <p style={{ color:"#555",fontSize:14,marginBottom:40 }}>Start free. Go pro when you're ready.</p>

            <div style={{ display:"flex",gap:14,justifyContent:"center",flexWrap:"wrap",marginBottom:48 }}>
              {/* Free */}
              <div style={{ background:"#060606",border:"1px solid #111",borderRadius:20,padding:"26px 24px",flex:"1 1 200px",maxWidth:260,textAlign:"left" }}>
                <div style={{ fontSize:12,color:"#555",fontWeight:700,marginBottom:8,letterSpacing:1 }}>FREE</div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:34,fontWeight:700,marginBottom:3 }}>$0</div>
                <div style={{ fontSize:12,color:"#444",marginBottom:22 }}>forever</div>
                {["1 free pick daily","Email digest every morning","Model record public stats"].map(f => (
                  <div key={f} style={{ display:"flex",gap:8,alignItems:"center",padding:"7px 0",borderBottom:"1px solid #0d0d0d",fontSize:12,color:"#666" }}><span style={{ color:"#333" }}>✓</span>{f}</div>
                ))}
                <button className="l-ghost" style={{ marginTop:18,width:"100%",fontSize:13,padding:"11px" }} onClick={() => { setShowAuth(true); setAuthMode("signup"); }}>Get started free</button>
              </div>
              {/* Pro monthly */}
              <div style={{ background:"rgba(0,255,135,.04)",border:"1px solid rgba(0,255,135,.2)",borderRadius:20,padding:"26px 24px",flex:"1 1 200px",maxWidth:260,textAlign:"left",position:"relative" }}>
                <div style={{ position:"absolute",top:-12,left:"50%",transform:"translateX(-50%)",background:"#00FF87",color:"#000",fontSize:10,fontWeight:800,padding:"3px 13px",borderRadius:20,letterSpacing:1,whiteSpace:"nowrap" }}>MOST POPULAR</div>
                <div style={{ fontSize:12,color:"#00FF87",fontWeight:700,marginBottom:8,letterSpacing:1 }}>PRO MONTHLY</div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:34,fontWeight:700,marginBottom:3,color:"#00FF87" }}>$2</div>
                <div style={{ fontSize:12,color:"#555",marginBottom:22 }}>per month</div>
                {["All picks + full breakdowns","Edge scores + variance data","CLEAN / BET / PASS filter","Parlay builder (CLEAN only)","Personal tracker + P&L"].map(f => (
                  <div key={f} style={{ display:"flex",gap:8,alignItems:"center",padding:"7px 0",borderBottom:"1px solid rgba(0,255,135,.06)",fontSize:12,color:"#888" }}><span style={{ color:"#00FF87" }}>✓</span>{f}</div>
                ))}
                <button className="l-cta" style={{ marginTop:18,width:"100%",fontSize:14 }} onClick={() => { setShowAuth(true); setAuthMode("signup"); }}>Start for $2/mo →</button>
              </div>
              {/* Annual */}
              <div style={{ background:"#060606",border:"1px solid #111",borderRadius:20,padding:"26px 24px",flex:"1 1 200px",maxWidth:260,textAlign:"left" }}>
                <div style={{ fontSize:12,color:"#555",fontWeight:700,marginBottom:8,letterSpacing:1 }}>PRO ANNUAL</div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:34,fontWeight:700,marginBottom:3 }}>$19.99</div>
                <div style={{ fontSize:12,color:"#444",marginBottom:22 }}>$1.67/mo · 2 months free</div>
                {["Everything in Pro Monthly","Best value for the season","Cancel anytime"].map(f => (
                  <div key={f} style={{ display:"flex",gap:8,alignItems:"center",padding:"7px 0",borderBottom:"1px solid #0d0d0d",fontSize:12,color:"#666" }}><span style={{ color:"#333" }}>✓</span>{f}</div>
                ))}
                <button className="l-ghost" style={{ marginTop:18,width:"100%",fontSize:13,padding:"11px" }} onClick={() => { setShowAuth(true); setAuthMode("signup"); }}>Get annual →</button>
              </div>
            </div>

            {/* Email capture */}
            <div className="l-glow" style={{ marginBottom:52 }} />
            <div ref={heroEmailRef} style={{ maxWidth:420,margin:"0 auto" }}>
              <h3 style={{ fontSize:22,fontWeight:800,letterSpacing:-.5,marginBottom:7 }}>Not ready to pay?</h3>
              <p style={{ color:"#555",fontSize:14,marginBottom:22,lineHeight:1.6 }}>Get one sharp pick every morning — free. No account needed.</p>
              {subStatus === "ok" ? (
                <div style={{ background:"rgba(0,255,135,.08)",border:"1px solid rgba(0,255,135,.2)",borderRadius:14,padding:"18px",textAlign:"center" }}>
                  <div style={{ fontSize:18,fontWeight:800,color:"#00FF87" }}>You're in. ✓</div>
                  <div style={{ fontSize:13,color:"#555",marginTop:5 }}>First pick lands tomorrow morning.</div>
                </div>
              ) : (
                <form onSubmit={async e => {
                  e.preventDefault();
                  if (!subEmail.trim()) return;
                  setSubStatus("loading");
                  try {
                    const r = await fetch("/api/subscribe", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ email:subEmail.trim() }) });
                    setSubStatus(r.ok ? "ok" : "err");
                  } catch { setSubStatus("err"); }
                }} style={{ display:"flex",gap:10 }}>
                  <input type="email" required placeholder="your@email.com" value={subEmail} onChange={e => setSubEmail(e.target.value)}
                    style={{ flex:1,background:"#0a0a0a",border:"1px solid #1a1a1a",borderRadius:12,padding:"13px 15px",color:"#fff",fontSize:14,outline:"none" }} />
                  <button type="submit" disabled={subStatus==="loading"} className="l-cta" style={{ flexShrink:0,fontSize:14,padding:"13px 18px" }}>
                    {subStatus==="loading" ? "…" : "Send me picks"}
                  </button>
                </form>
              )}
              {subStatus === "err" && <div style={{ fontSize:12,color:"#FF4D4D",marginTop:7 }}>Something went wrong.</div>}
            </div>
          </section>

          {/* FOOTER */}
          <footer style={{ borderTop:"1px solid #0d0d0d",padding:"24px 20px",textAlign:"center" }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:14,fontWeight:700,marginBottom:10 }}>T<span style={{ color:"#00FF87" }}>|</span>T</div>
            <div style={{ display:"flex",gap:18,justifyContent:"center",flexWrap:"wrap",fontSize:12,color:"#333" }}>
              <button style={{ background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:12 }} onClick={() => { setShowAuth(true); setAuthMode("signin"); }}>Sign In</button>
              <a href="https://twitter.com/ThisorThatPicks" target="_blank" rel="noopener noreferrer" style={{ color:"#333",textDecoration:"none" }}>𝕏 @ThisorThatPicks</a>
              <a href="/privacy" style={{ color:"#333",textDecoration:"none" }}>Privacy</a>
              <a href="/terms" style={{ color:"#333",textDecoration:"none" }}>Terms</a>
            </div>
            <div style={{ fontSize:11,color:"#1a1a1a",marginTop:12 }}>For entertainment purposes. Bet responsibly.</div>
          </footer>
        </>
      ) : (
        /* ── AUTH VIEW ── */
        <div style={S.page}>
          <style>{css}</style>
          <div style={S.authBox}>
            <button onClick={() => setShowAuth(false)} style={{ background:"none",border:"none",color:"#777",fontSize:13,cursor:"pointer",alignSelf:"flex-start",marginBottom:8,padding:0 }}>← Back</button>
            <div style={S.logo}>T<span style={{ color:"#00FF87" }}>|</span>T</div>
            <div style={S.authSub}>{authMode === "signin" ? "Sign in to see all picks" : "Create your free account"}</div>
            <button style={S.googleBtn} onClick={signInGoogle}><GoogleIcon /> Continue with Google</button>
            <div style={S.orRow}>
              <div style={S.orLine} />
              <span style={{ color:"#777",fontSize:12,padding:"0 10px" }}>or</span>
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
              <span style={{ color:"#00FF87",cursor:"pointer" }} onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setAuthError(""); }}>
                {authMode === "signin" ? "Sign up" : "Sign in"}
              </span>
            </div>
            <div style={{ fontSize:10,color:"#222",textAlign:"center",lineHeight:1.7,marginTop:4 }}>
              For entertainment only · Not gambling advice · 21+{" · "}
              <a href="/terms" style={{ color:"#222" }}>Terms</a>{" · "}
              <a href="/privacy" style={{ color:"#222" }}>Privacy</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (isPro === null) return (
    <div style={{ minHeight: "100vh", background: "#000", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
      <style>{css}</style>
      <div style={S.spinner} />
      {activatingPro && <div style={{ color: "#00FF87", fontSize: 13, fontWeight: 600 }}>Activating your account…</div>}
    </div>
  );


  return (
    <div style={S.app}>
      <style>{css}</style>

      {showInstallPrompt && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={() => setShowInstallPrompt(false)}>
          <div style={{ width: "100%", maxWidth: 500, background: "#0a0a0a", borderRadius: "24px 24px 0 0", border: "1px solid #1a1a1a", borderBottom: "none", padding: "0 0 max(24px, env(safe-area-inset-bottom)) 0", animation: "slideUp 0.3s cubic-bezier(0.32,0.72,0,1)" }}
            onClick={e => e.stopPropagation()}>
            {/* Drag handle */}
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: "#222" }} />
            </div>
            <div style={{ padding: "16px 24px 24px" }}>
              {/* App identity row */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
                <div style={{ width: 56, height: 56, background: "#000", borderRadius: 14, border: "1px solid #1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 700, color: "#fff", flexShrink: 0, letterSpacing: -1 }}>
                  T<span style={{ color: "#00FF87" }}>|</span>T
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 17, color: "#fff", letterSpacing: -0.3 }}>ToT Picks</div>
                  <div style={{ fontSize: 12, color: "#777", marginTop: 2, fontFamily: "'JetBrains Mono',monospace" }}>tot-app.vercel.app</div>
                </div>
                <button onClick={() => setShowInstallPrompt(false)} style={{ background: "#1a1a1a", border: "none", borderRadius: "50%", width: 28, height: 28, color: "#999", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>✕</button>
              </div>

              {installPlatform === "android" ? (
                <>
                  <div style={{ fontSize: 14, color: "#999", marginBottom: 20, lineHeight: 1.5 }}>
                    Install for instant access from your home screen — no browser, no address bar.
                  </div>
                  <button
                    style={{ width: "100%", background: "#00FF87", color: "#000", border: "none", borderRadius: 14, padding: "15px 0", fontWeight: 800, fontSize: 15, letterSpacing: 0.3, marginBottom: 12 }}
                    onClick={async () => {
                      if (deferredPrompt) {
                        deferredPrompt.prompt();
                        const { outcome } = await deferredPrompt.userChoice;
                        setDeferredPrompt(null);
                        if (outcome === "accepted") localStorage.setItem("tot-pwa-dismissed", String(Date.now()));
                      }
                      setShowInstallPrompt(false);
                    }}>
                    Add to Home Screen
                  </button>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 20, background: "#0d0d0d", borderRadius: 14, border: "1px solid #141414", overflow: "hidden" }}>
                    {[
                      { step: "1", label: "Tap the", bold: "Share", after: " button in Safari", icon: "↑" },
                      { step: "2", label: "Select", bold: "Add to Home Screen", after: "", icon: "+" },
                      { step: "3", label: "Tap", bold: "Add", after: " to confirm", icon: "✓" },
                    ].map(({ step, label, bold, after, icon }, i) => (
                      <div key={step} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderTop: i > 0 ? "1px solid #141414" : "none" }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: "#141414", border: "1px solid #1e1e1e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#00FF87", flexShrink: 0, fontWeight: 700 }}>{icon}</div>
                        <div style={{ fontSize: 14, color: "#666", lineHeight: 1.4 }}>
                          {label} <span style={{ color: "#fff", fontWeight: 600 }}>{bold}</span>{after}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button style={{ width: "100%", background: "#00FF87", color: "#000", border: "none", borderRadius: 14, padding: "15px 0", fontWeight: 800, fontSize: 15, letterSpacing: 0.3, marginBottom: 12 }}
                    onClick={() => setShowInstallPrompt(false)}>
                    Got it
                  </button>
                </>
              )}
              <div style={{ textAlign: "center", fontSize: 13, color: "#2a2a2a", cursor: "pointer", padding: "4px 0" }}
                onClick={() => { localStorage.setItem("tot-pwa-dismissed", String(Date.now())); setShowInstallPrompt(false); }}>
                Don't show again
              </div>
            </div>
          </div>
        </div>
      )}

      {drawerOpen && (
        <div style={S.overlay} onClick={() => setDrawerOpen(false)}>
          <div style={S.drawer} onClick={e => e.stopPropagation()}>
            <div style={S.drawerLogo}>T<span style={{ color: "#00FF87" }}>|</span>T</div>
            <div style={S.drawerEmail}>{user.email}</div>
            <div style={S.drawerLine} />
            {[
              { id: "picks", icon: "⚾", label: "Picks" },
              { id: "steals", icon: "🔥", label: "Steals" },
              { id: "parlay", icon: "🎲", label: "Parlay" },
              { id: "tracker", icon: "📊", label: "Tracker" },
              { id: "record", icon: "📅", label: "Record" },
              { id: "chat", icon: "💬", label: "Assistant" },
              ...(isBeta ? [
                { id: "nfl", icon: "🏈", label: "NFL", beta: true },
              ] : []),
            ].map(({ id, icon, label, beta }) => (
              <div key={id} style={{ ...S.drawerItem, color: activeTab === id ? (beta ? "#FF6B35" : "#00FF87") : "#fff" }} onClick={() => { setActiveTab(id); setDrawerOpen(false); }}>
                {icon} {label}
              </div>
            ))}
            <div style={S.drawerLine} />
            <AccuracyPanel savedPicks={savedPicks} />
            <div style={{ flex: 1 }} />
            <div style={S.drawerLine} />
            <a href="https://twitter.com/ThisorThatPicks" target="_blank" rel="noopener noreferrer"
              style={{ ...S.drawerItem, color: "#1DA1F2", textDecoration: "none" }}>
              𝕏 @ThisorThatPicks
            </a>
            <div style={S.drawerLine} />
            {isPro ? (
              <div style={{ ...S.drawerItem, color: "#999" }} onClick={manageBilling}>⚡ Manage Billing</div>
            ) : (
              <div style={{ ...S.drawerItem, color: "#00FF87" }} onClick={() => { setDrawerOpen(false); setUpgradeModal(true); }}>⚡ Upgrade to Pro</div>
            )}
            <div style={{ ...S.drawerItem, color: "#FF4D4D" }} onClick={signOut}>Sign Out</div>
          </div>
        </div>
      )}

      <div style={S.nav}>
        <button style={S.menuBtn} onClick={() => setDrawerOpen(true)}>
          {[0, 1, 2].map(i => <div key={i} style={S.menuLine} />)}
        </button>
        <div style={S.navLogo}>T<span style={{ color: "#00FF87" }}>|</span>T</div>
        {isBeta ? (
          <div style={{ display: "flex", gap: 4, background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 14, padding: 3 }}>
            {[
              { sport: "mlb", icon: "⚾", label: "MLB", tab: "picks", color: "#00FF87" },
              { sport: "nfl", icon: "🏈", label: "NFL", tab: "nfl",   color: "#FF6B35" },
            ].map(({ sport, icon, label, tab, color }) => {
              const active = activeTab === tab || (sport === "mlb" && ["picks","steals","parlay","tracker","record","chat"].includes(activeTab));
              return (
                <button key={sport} onClick={() => setActiveTab(tab)}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 10,
                    border: "none", cursor: "pointer", letterSpacing: 0.3,
                    background: active ? (sport === "mlb" ? "rgba(0,255,135,0.12)" : "rgba(255,107,53,0.12)") : "transparent",
                    color: active ? color : "#444",
                    transition: "all 0.15s",
                  }}>
                  <span style={{ fontSize: 14 }}>{icon}</span>
                  {label}
                </button>
              );
            })}
          </div>
        ) : (
          <div style={S.navBadge}>MLB ✓</div>
        )}
      </div>

      {/* Carousel — cycles between free pick, model record, and promo */}
      {activeTab !== "nfl" && <div style={S.carousel}>
        {slide.type === "free-pick" && (
          <>
            <div style={S.carouselTag}>FREE PICK</div>
            {freePick ? (
              <>
                <div style={S.carouselMatchup}>{freePick.awayTeam} @ {freePick.homeTeam}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                  <span style={{ ...S.badge, background: TIER[freePick.tier?.level]?.bg, color: TIER[freePick.tier?.level]?.color }}>
                    {TIER[freePick.tier?.level]?.label}
                  </span>
                  <span style={{ fontSize: 12, color: "#999" }}>Take {freePick.pick}</span>
                </div>
              </>
            ) : (
              <div style={{ color: "#777", fontSize: 13 }}>No actionable bet today — check back tomorrow</div>
            )}
          </>
        )}
        {slide.type === "record" && (
          <>
            <div style={S.carouselTag}>MODEL RECORD</div>
            {modelRecord?.total > 0 ? (
              <>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 20, fontWeight: 700, marginTop: 4 }}>
                  <span style={{ color: "#00FF87" }}>{modelRecord.wins}</span>
                  <span style={{ color: "#888" }}>-</span>
                  <span style={{ color: "#FF4D4D" }}>{modelRecord.losses}</span>
                </div>
                <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
                  {modelRecord.pct}% win rate · {modelRecord.total} tracked bets
                </div>
              </>
            ) : (
              <div style={{ color: "#777", fontSize: 13, marginTop: 4 }}>Track record populates as picks resolve</div>
            )}
          </>
        )}
        {slide.type === "promo" && (
          <>
            <div style={S.carouselTag}>SHARP FILTER</div>
            <div style={{ fontSize: 13, color: "#888", marginTop: 4, lineHeight: 1.5 }}>
              Every bet must pass 13+ conditions: confidence, variance, edge, juice, park factor, pitcher quality & more.
            </div>
            <div style={{ fontSize: 11, color: "#00FF87", marginTop: 6 }}>⚡ CLEAN = all conditions passed</div>
          </>
        )}
        <div style={{ display: "flex", gap: 5, marginTop: 10 }}>
          {carouselSlides.map((_, i) => (
            <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: carouselIdx % carouselSlides.length === i ? "#00FF87" : "#1a1a1a", cursor: "pointer" }}
              onClick={() => setCarouselIdx(i)} />
          ))}
        </div>
      </div>}

      {(activeTab === "picks" || activeTab === "steals" || activeTab === "parlay") && (
        <div ref={dateScrollRef} style={S.dateScroll}>
          {weekDates.map(date => (
            <button
              key={date}
              ref={date === todayStr ? todayBtnRef : null}
              style={{
                ...S.dateBtn,
                borderColor: selectedDate === date ? "#00FF87" : "#333",
                color: selectedDate === date ? "#00FF87" : "#999",
                background: selectedDate === date ? "rgba(0,255,135,0.08)" : "#111",
              }}
              onClick={() => setSelectedDate(date)}
            >
              {fmtDateLabel(date)}
            </button>
          ))}
        </div>
      )}

      {activeTab !== "nfl" && <div style={S.subNav}>
        <div style={{ display: "flex", gap: 6 }}>
          {[
            { id: "picks", label: "Picks" },
            { id: "steals", label: "Steals" },
            { id: "parlay", label: "🎲 Parlay" },
            { id: "tracker", label: "Tracker" },
            { id: "record", label: "📅 Record" },
            { id: "chat", label: "💬 Ask AI" },
          ].map(({ id, label }) => (
            <button
              key={id}
              style={{ ...S.tabBtn, borderColor: activeTab === id ? "#00FF87" : "#333", color: activeTab === id ? "#00FF87" : "#999", background: activeTab === id ? "rgba(0,255,135,0.08)" : "#111" }}
              onClick={() => {
                if (!isPro && ["steals", "parlay", "tracker"].includes(id)) { setUpgradeModal(true); return; }
                setActiveTab(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {activeTab === "picks" && (
          <div style={{ display: "flex", gap: 4 }}>
            {["edge", "time"].map(s2 => (
              <button
                key={s2}
                style={{ ...S.sortBtn, background: sortBy === s2 ? "#00FF87" : "#111", color: sortBy === s2 ? "#000" : "#999", border: `1px solid ${sortBy === s2 ? "#00FF87" : "#333"}` }}
                onClick={() => setSortBy(s2)}
              >
                {s2 === "edge" ? "📈" : "🕐"}
              </button>
            ))}
            <button
              style={{ ...S.sortBtn, fontSize: 13 }}
              onClick={() => fetchPicks(selectedDate, true)}
              title="Refresh picks"
            >↺</button>
            {isAdmin && (
              <button
                style={{ ...S.sortBtn, fontSize: 11, background: generating ? "rgba(0,255,135,0.1)" : "#111", color: generating ? "#00FF87" : "#555", borderColor: generating ? "#00FF87" : "#333" }}
                onClick={generatePicks}
                disabled={generating}
                title="Force-generate picks for today + tomorrow"
              >{generating ? "…" : "⚡ Gen"}</button>
            )}
          </div>
        )}
      </div>}

      {activeTab !== "nfl" && <div style={S.content}>
        {activeTab === "picks" && modelRecord?.total > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0 4px", flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: "#777", letterSpacing: 1 }}>MODEL RECORD</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 700, color: modelRecord.pct == null ? "#888" : modelRecord.pct >= 55 ? "#00FF87" : modelRecord.pct >= 50 ? "#FFD600" : "#FF4D4D" }}>
              {modelRecord.wins}-{modelRecord.losses}
            </span>
            <span style={{ fontSize: 11, color: "#888" }}>({modelRecord.pct}%)</span>
            <span style={{ fontSize: 10, color: "#222" }}>all-time</span>
          </div>
        )}

        {activeTab === "picks" && picks?.length > 0 && (() => {
          const nBet   = picks.filter(p => p.isBet).length;
          const nClean = picks.filter(p => p.filter?.verdict === "CLEAN").length;
          const nPass  = picks.filter(p => !p.isBet).length;
          const quietDay = isPro && nBet === 0 && picks.filter(p => p.filter != null).length > 0;
          return (
            <>
              <div style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid #0d0d0d", marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: "#777" }}>{picks.filter(p => p.filter != null).length} games</span>
                {nBet > 0 && <span style={{ fontSize: 11, color: "#00FF87" }}>{nBet} BET</span>}
                {nClean > 0 && <span style={{ fontSize: 11, color: "#00FF87", fontWeight: 700 }}>⚡ {nClean} CLEAN</span>}
                <span style={{ fontSize: 11, color: "#555" }}>{nPass} PASS</span>
              </div>
              {quietDay && (
                <div style={{ background: "rgba(255,214,0,0.04)", border: "1px solid rgba(255,214,0,0.12)", borderRadius: 10, padding: "10px 14px", marginBottom: 10, display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 16 }}>😴</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#FFD600" }}>Quiet day — no bets pass the filter</div>
                    <div style={{ fontSize: 11, color: "#555", marginTop: 3 }}>All games are PASS or TRAP. Best picks shown below as leans only. Skipping is the correct play.</div>
                  </div>
                </div>
              )}
            </>
          );
        })()}

        {activeTab === "picks" && !isPro && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {freePick && !freePick._quietDay ? (() => {
              const isEdge = freePick.filter?.verdict === "CLEAN" || freePick.isBet;
              const isLean = !isEdge;
              const pickOdds = freePick.pick === freePick.homeTeam ? freePick.homeOdds : freePick.awayOdds;
              const accentColor = isEdge ? "#00FF87" : "#FFD600";
              const borderColor = isEdge ? "rgba(0,255,135,0.25)" : "rgba(255,214,0,0.18)";
              return (
                <div style={{ ...S.card, borderColor }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: accentColor, fontWeight: 700, letterSpacing: 1.5 }}>
                      {isEdge ? "TODAY'S FREE PICK" : "TODAY'S LEAN"}
                    </div>
                    {isEdge ? (
                      freePick.filter?.verdict === "CLEAN"
                        ? <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 9px", borderRadius: 5, letterSpacing: 1.5, background: "rgba(0,255,135,0.15)", color: "#00FF87", border: "1px solid rgba(0,255,135,0.3)" }}>⚡ CLEAN</span>
                        : <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 9px", borderRadius: 5, letterSpacing: 1.5, background: "rgba(0,255,135,0.08)", color: "#00FF87", border: "1px solid rgba(0,255,135,0.2)" }}>BET</span>
                    ) : (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 9px", borderRadius: 5, background: "rgba(255,214,0,0.08)", color: "#FFD600", border: "1px solid rgba(255,214,0,0.2)" }}>👀 LEAN</span>
                    )}
                  </div>
                  <div style={S.cardMatchup}>
                    {freePick.awayTeam}{freePick.awayRecord && <span style={{ fontSize: 11, color: "#555", fontWeight: 400, marginLeft: 4 }}>({freePick.awayRecord})</span>}
                    {" @ "}
                    {freePick.homeTeam}{freePick.homeRecord && <span style={{ fontSize: 11, color: "#555", fontWeight: 400, marginLeft: 4 }}>({freePick.homeRecord})</span>}
                  </div>
                  <div style={S.cardMeta}>
                    {fmtGameTime(freePick.commenceTime)} · Take{" "}
                    <span style={{ color: accentColor, fontWeight: 700 }}>{freePick.pick}</span>
                    {pickOdds != null && <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{" "}{fmtOdds(pickOdds)}</span>}
                    {isEdge && freePick.edge > 0 && <span style={{ color: "#555", fontFamily: "'JetBrains Mono',monospace" }}>{" "}+{freePick.edge?.toFixed(1)}% edge</span>}
                  </div>
                  {isLean && (
                    <div style={{ fontSize: 10, color: "#555", marginTop: 6, lineHeight: 1.5 }}>
                      No sharp edge today — model's highest-conviction lean. Not a bet, just a direction.
                    </div>
                  )}
                  {freePick.breakdown?.preview && <div style={{ ...S.preview, marginTop: 6 }}>{freePick.breakdown.preview.slice(0, 100)}…</div>}
                </div>
              );
            })() : freePick?._quietDay ? (
              <div style={{ ...S.card, textAlign: "center", padding: "28px 16px", borderColor: "#1a1a1a" }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>😴</div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Quiet day</div>
                <div style={{ fontSize: 13, color: "#555", marginTop: 5, lineHeight: 1.5 }}>
                  No games worth highlighting today.<br/>The model doesn't force picks — zero bets is correct.
                </div>
              </div>
            ) : (
              <div style={{ ...S.card, textAlign: "center", padding: "28px 16px" }}>
                <div style={{ fontSize: 22, marginBottom: 8 }}>⚾</div>
                <div style={{ fontWeight: 700 }}>Loading today's pick…</div>
              </div>
            )}
            {[
              { away: "Yankees", home: "Red Sox",   verdict: "CLEAN", pick: "Yankees", odds: "-118", edge: "4.2" },
              { away: "Dodgers", home: "Padres",    verdict: "BET",   pick: "Dodgers", odds: "-132", edge: "3.1" },
              { away: "Astros",  home: "Rangers",   verdict: "BET",   pick: "Rangers", odds: "+104", edge: "2.7" },
            ].map((p, i) => (
              <div key={i} style={{ ...S.card, position: "relative", overflow: "hidden", cursor: "pointer" }}
                onClick={() => setUpgradeModal(true)}>
                <div style={{ position: "absolute", inset: 0, backdropFilter: "blur(5px)", background: "rgba(0,0,0,0.5)", zIndex: 2, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ background: "rgba(0,0,0,0.9)", border: "1px solid #222", borderRadius: 10, padding: "8px 18px", textAlign: "center" }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#00FF87", letterSpacing: 1 }}>🔒 PRO ONLY</div>
                    <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>Tap to upgrade</div>
                  </div>
                </div>
                <div style={{ filter: "blur(6px)", pointerEvents: "none", userSelect: "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5, background: p.verdict === "CLEAN" ? "rgba(0,255,135,0.15)" : "rgba(0,255,135,0.08)", color: "#00FF87", border: "1px solid rgba(0,255,135,0.3)" }}>{p.verdict === "CLEAN" ? "⚡ CLEAN" : "BET"}</span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#555" }}>+{p.edge}% edge</span>
                  </div>
                  <div style={S.cardMatchup}>{p.away} @ {p.home}</div>
                  <div style={S.cardMeta}>Take <span style={{ color: "#00FF87" }}>{p.pick}</span> {p.odds}</div>
                </div>
              </div>
            ))}
            <div style={{ background: "rgba(0,255,135,0.05)", border: "1px solid rgba(0,255,135,0.15)", borderRadius: 12, padding: "16px", textAlign: "center", cursor: "pointer" }}
              onClick={() => setUpgradeModal(true)}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#00FF87", marginBottom: 4 }}>⚡ Unlock all picks for $2/mo</div>
              <div style={{ fontSize: 12, color: "#555" }}>Full breakdowns · edge scores · parlay builder</div>
            </div>
          </div>
        )}

        {activeTab === "picks" && isPro && (
          picks === null ? (
            <div style={S.center}>
              <div style={S.spinner} />
              <div style={{ color: "#777", fontSize: 13, marginTop: 12 }}>Analyzing {fmtDateLabel(selectedDate)}'s games…</div>
            </div>
          ) : picksError ? (
            <div style={S.center}>
              <div style={{ fontSize: 32 }}>⚠️</div>
              <div style={{ color: "#fff", fontWeight: 700, marginTop: 8 }}>Could not load games</div>
              <div style={{ color: "#777", fontSize: 13, marginTop: 4 }}>{picksError}</div>
              <button style={{ ...S.saveBtn, marginTop: 14 }} onClick={() => fetchPicks(selectedDate, true)}>Retry</button>
            </div>
          ) : sorted.length === 0 ? (
            <div style={S.center}>
              <div style={{ fontSize: 32 }}>⚾</div>
              <div style={{ color: "#fff", fontWeight: 700, marginTop: 8 }}>No games found</div>
              <div style={{ color: "#777", fontSize: 13, marginTop: 4 }}>Try a different date</div>
              {picksDiagnostic && (
                <div style={{ color: "#555", fontSize: 11, marginTop: 10, fontFamily: "'JetBrains Mono',monospace", maxWidth: 280 }}>
                  {fmtDiagnostic(picksDiagnostic)}
                </div>
              )}
            </div>
          ) : sorted.map(pick => {
            const isBet   = pick.isBet;
            const isLock  = pick.isLock === true;
            const edge    = pick.edge || 0;
            const t       = TIER[pick.tier?.level] || TIER.Low;
            const isOpen  = expanded === pick.id;
            const b       = pick.breakdown || {};
            const ls      = pick.liveScore;
            const isSaved = saving[pick.id] === "saved";

            // Compute result if game is final
            let pickResult = null;
            if (ls?.status === "Final" && ls.homeScore !== null && ls.awayScore !== null) {
              if (ls.homeScore === ls.awayScore) {
                pickResult = "push";
              } else {
                const homeWon = ls.homeScore > ls.awayScore;
                const pickedHome = pick.pick === pick.homeTeam;
                pickResult = (homeWon === pickedHome) ? "win" : "loss";
              }
            }

            const betColor  = "#00FF87";
            const passColor = "#333";
            const isScheduled = pick.homeOdds == null && !pick.filter && pick.tier?.emoji === "📅";
            const resultBorderColor = pickResult === "win" ? "#00FF87" : pickResult === "loss" ? "#FF4D4D" : null;
            const cardBorder = resultBorderColor || (isOpen ? (isBet ? betColor : "#2a2a2a") : (isBet ? "rgba(0,255,135,0.25)" : isScheduled ? "rgba(79,195,247,0.15)" : "#1a1a1a"));

            return (
              <div key={pick.id} style={{ ...S.card, borderColor: cardBorder }}>
                <div style={S.cardTop}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      {isLock && (
                        <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5, background: "rgba(255,215,0,0.15)", color: "#FFD700", border: "1px solid rgba(255,215,0,0.5)" }}>
                          🔒 LOCK
                        </span>
                      )}
                      {pick.homeOdds == null && !pick.filter ? (
                        isScheduled ? (
                          <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5, background: "rgba(79,195,247,0.1)", color: "#4FC3F7", border: "1px solid rgba(79,195,247,0.3)" }}>
                            📅 SCHEDULED
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5, background: "rgba(60,60,60,0.4)", color: "#555", border: "1px solid #222" }}>
                            📋 NO LINE
                          </span>
                        )
                      ) : pick.filter?.verdict === "CLEAN" ? (
                        <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5, background: "rgba(0,255,135,0.15)", color: "#00FF87", border: "1px solid rgba(0,255,135,0.5)" }}>
                          ⚡ CLEAN
                        </span>
                      ) : (
                        <span style={{
                          fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5,
                          background: isBet ? "rgba(0,255,135,0.08)" : "rgba(50,50,50,0.5)",
                          color: isBet ? betColor : passColor,
                          border: `1px solid ${isBet ? "rgba(0,255,135,0.2)" : "#222"}`,
                        }}>
                          {isBet ? "BET" : "PASS"}
                        </span>
                      )}
                      {pick.filter && <span style={{ fontSize: 11, color: isBet ? "#555" : "#333", fontFamily: "'JetBrains Mono',monospace" }}>
                        {edge.toFixed(1)}% edge
                      </span>}
                      {isBet && (
                        <span style={{ fontSize: 10, color: t.color, opacity: 0.7 }}>
                          {t.label}
                        </span>
                      )}
                    </div>
                    <div style={S.cardMatchup}>
                      {pick.awayTeam}{pick.awayRecord && <span style={{ fontSize: 11, color: "#555", fontWeight: 400, marginLeft: 4 }}>({pick.awayRecord})</span>}
                      {" @ "}
                      {pick.homeTeam}{pick.homeRecord && <span style={{ fontSize: 11, color: "#555", fontWeight: 400, marginLeft: 4 }}>({pick.homeRecord})</span>}
                    </div>
                    <div style={S.cardMeta}>
                      {fmtGameTime(pick.commenceTime)}
                      {pick.pick && <> · {isScheduled ? <span style={{ color: "#4FC3F7" }}>Preview</span> : pick.homeOdds == null && !pick.filter ? "Lean" : "Take"} <span style={{ color: isBet ? betColor : isScheduled ? "#4FC3F7" : "#aaa", fontWeight: 700 }}>{pick.pick}</span></>}
                      {!pick.pick && <span style={{ color: "#444" }}> · No line posted</span>}
                      {isBet && pick.homeOdds != null && <span style={{ color: "#888", fontFamily: "'JetBrains Mono',monospace" }}> · {fmtOdds(pick.pick === pick.homeTeam ? pick.homeOdds : pick.awayOdds)}</span>}
                    </div>
                    <div style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 7 }}>
                      <div style={{ flex: 1, height: 3, background: "#111", borderRadius: 2 }}>
                        <div style={{ height: "100%", borderRadius: 2, width: `${Math.min(100, edge * 6)}%`, background: isBet ? t.color : "#222", transition: "width 0.5s ease" }} />
                      </div>
                      {pick.filter && <span style={{ fontSize: 10, color: isBet ? t.color : "#333", fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{edge.toFixed(1)}%</span>}
                    </div>
                    {ls?.status === "Live" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF4D4D", animation: "pulse 1s infinite" }} />
                        <span style={{ fontSize: 12, color: "#FF4D4D", fontWeight: 700 }}>LIVE</span>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{pick.awayTeam} {ls.awayScore} · {pick.homeTeam} {ls.homeScore}</span>
                        <span style={{ fontSize: 11, color: "#888" }}>{ls.inningHalf} {ls.inning}</span>
                      </div>
                    )}
                    {ls?.status === "Final" && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {pickResult && (
                            <span style={{
                              fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5,
                              background: pickResult === "win" ? "rgba(0,255,135,0.12)" : pickResult === "loss" ? "rgba(255,77,77,0.12)" : "rgba(255,214,0,0.08)",
                              color: pickResult === "win" ? "#00FF87" : pickResult === "loss" ? "#FF4D4D" : "#FFD600",
                              border: `1px solid ${pickResult === "win" ? "rgba(0,255,135,0.3)" : pickResult === "loss" ? "rgba(255,77,77,0.3)" : "rgba(255,214,0,0.3)"}`,
                            }}>
                              {pickResult === "win" ? "WIN" : pickResult === "loss" ? "LOSS" : "TIE"}
                            </span>
                          )}
                          <span style={{ fontSize: 12, color: "#888" }}>
                            Final · {pick.awayTeam} {ls.awayScore} – {pick.homeTeam} {ls.homeScore}
                          </span>
                        </div>
                        {(() => {
                          const recap = gameRecaps[pick.id];
                          if (!recap || recap === "loading") return <div style={{ fontSize: 11, color: "#333", marginTop: 6 }}>Generating recap...</div>;
                          if (recap === "error") return null;
                          return <div style={{ fontSize: 12, color: "#777", lineHeight: 1.65, marginTop: 8, paddingTop: 8, borderTop: "1px solid #111" }}>{recap.paragraph}</div>;
                        })()}
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
                    {pick.homeOdds != null && (() => {
                      const inParlay = parlayLegs.has(pick.id);
                      return (
                        <button
                          style={{ ...S.saveBtn, background: inParlay ? "rgba(255,214,0,0.12)" : "transparent", color: inParlay ? "#FFD600" : "#333", borderColor: inParlay ? "#FFD600" : "#222" }}
                          onClick={() => setParlayLegs(prev => { const n = new Map(prev); inParlay ? n.delete(pick.id) : n.set(pick.id, { game: pick, teamPick: pick.pick }); return n; })}
                        >
                          {inParlay ? "✓ Parlay" : "+ Parlay"}
                        </button>
                      );
                    })()}
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
                    {pick.filter && (() => {
                      const f = pick.filter;
                      const isClean = f.verdict === "CLEAN";
                      const vColor = { CLEAN: "#00FF87", TRAP: "#FF4D4D", PASS: "#444" }[f.verdict] || "#444";
                      const vBg    = { CLEAN: "rgba(0,255,135,0.06)", TRAP: "rgba(255,77,77,0.06)", PASS: "rgba(30,30,30,0.6)" }[f.verdict] || "transparent";
                      const confColor = f.confidence >= 8 ? "#00FF87" : f.confidence >= 6 ? "#FFD600" : "#FF4D4D";
                      return (
                        <div style={{ ...S.expSection, background: vBg, borderRadius: 10, padding: 12, border: `1px solid ${vColor}33`, marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 11, fontWeight: 800, color: vColor, letterSpacing: 1.5 }}>{f.verdict}</span>
                              {f.isSquareLine && <span style={{ fontSize: 9, color: "#888", letterSpacing: 1 }}>SOFT LINE</span>}
                              {f.lineSignal === "confirming" && <span style={{ fontSize: 9, color: "#00FF87" }}>↑ LINE</span>}
                              {f.lineSignal === "contra"     && <span style={{ fontSize: 9, color: "#FF4D4D" }}>↓ LINE</span>}
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: vColor }}>{f.trueEdgePct > 0 ? "+" : ""}{f.trueEdgePct}% edge</span>
                              {(f.variancePenalty > 0 || f.samplePenalty > 0 || f.lineupPenalty > 0) && (
                                <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>
                                  raw {f.rawEdgePct > 0 ? "+" : ""}{f.rawEdgePct}%
                                  {f.variancePenalty > 0 && ` −${f.variancePenalty}% var`}
                                  {f.samplePenalty > 0 && ` −${f.samplePenalty}% sample`}
                                  {f.lineupPenalty > 0 && ` −${f.lineupPenalty}% lineup`}
                                </div>
                              )}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 14, marginBottom: 8, flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontSize: 9, color: "#888", letterSpacing: 1 }}>CONFIDENCE</div>
                              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: confColor, fontWeight: 700 }}>{f.confidence}/{f.confidenceOf || 10}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 9, color: "#888", letterSpacing: 1 }}>VARIANCE</div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: f.variance === "HIGH" ? "#FF4D4D" : f.variance === "MED" ? "#FFD600" : "#00FF87" }}>{f.variance}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 9, color: "#888", letterSpacing: 1 }}>WIN PROB</div>
                              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#fff" }}>{f.trueWinProbPct}%</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 9, color: "#888", letterSpacing: 1 }}>MKT IMPLIED</div>
                              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#fff" }}>{f.sharpImpliedPct}%</div>
                            </div>
                            {f.uncertaintyPct != null && (
                              <div>
                                <div style={{ fontSize: 9, color: "#888", letterSpacing: 1 }}>UNCERTAINTY</div>
                                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: f.uncertaintyPct > 10 ? "#FF4D4D" : f.uncertaintyPct > 6 ? "#FFD600" : "#00FF87" }}>±{f.uncertaintyPct}%</div>
                              </div>
                            )}
                            {f.snr != null && (
                              <div>
                                <div style={{ fontSize: 9, color: "#888", letterSpacing: 1 }}>SNR</div>
                                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: f.snr >= 1.5 ? "#00FF87" : f.snr >= 1.0 ? "#FFD600" : "#FF4D4D" }}>{f.snr}×</div>
                              </div>
                            )}
                            {f.parkFactor !== 0 && (
                              <div>
                                <div style={{ fontSize: 9, color: "#888", letterSpacing: 1 }}>PARK</div>
                                <div style={{ fontSize: 11, color: f.parkFactor >= 1.0 ? "#FF4D4D" : f.parkFactor <= -0.3 ? "#00FF87" : "#888" }}>{f.parkFactor > 0 ? "+" : ""}{f.parkFactor}R</div>
                              </div>
                            )}
                          </div>
                          {(f.failures || []).length > 0 && (
                            <div style={{ marginTop: 4 }}>
                              <div style={{ fontSize: 9, color: "#888", letterSpacing: 1, marginBottom: 4 }}>FAILED CONDITIONS</div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                {f.failures.map((fail, i) => (
                                  <span key={i} style={{ fontSize: 10, color: "#FF6B6B", background: "rgba(255,77,77,0.08)", padding: "2px 6px", borderRadius: 4 }}>✗ {fail}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {isClean && !f.halfSize && (
                            <div style={{ marginTop: 4, fontSize: 10, color: "#00FF87" }}>✓ All conditions passed — disciplined bet</div>
                          )}
                          {isClean && f.halfSize && (
                            <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
                              <div style={{ fontSize: 10, color: "#00FF87" }}>✓ All conditions passed — disciplined bet</div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#FFD600", background: "rgba(255,214,0,0.08)", border: "1px solid rgba(255,214,0,0.25)", borderRadius: 6, padding: "3px 8px", display: "inline-block" }}>
                                ⚠ HALF SIZE — pick-side bullpen ERA &gt;6.00, variance elevated
                              </div>
                            </div>
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
                    {/* Share button */}
                    <button
                      style={{ marginTop: 12, width: "100%", background: "transparent", border: "1px solid #1a1a1a", borderRadius: 10, padding: "9px 0", color: "#777", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                      onClick={() => {
                        const odds = pick.pick === pick.homeTeam ? pick.homeOdds : pick.awayOdds;
                        const fmtO = o => o == null ? "" : o > 0 ? ` (+${o})` : ` (${o})`;
                        const text = `${pick.awayTeam} @ ${pick.homeTeam}\nTake ${pick.pick}${fmtO(odds)} — ${pick.edge?.toFixed(1)}% edge\n\ntot-app.vercel.app | @ThisorThatPicks`;
                        if (navigator.share) {
                          navigator.share({ text, url: "https://tot-app.vercel.app" }).catch(() => {});
                        } else {
                          navigator.clipboard.writeText(text).then(() => alert("Copied to clipboard!")).catch(() => {});
                        }
                      }}
                    >
                      ↗ Share this pick
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}

        {activeTab === "picks" && isPro && parlayLegs.size >= 2 && (
          <button
            style={{ width: "100%", marginTop: 4, padding: "10px 14px", background: "rgba(255,214,0,0.06)", border: "1px solid rgba(255,214,0,0.2)", borderRadius: 12, color: "#FFD600", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
            onClick={() => setActiveTab("parlay")}
          >
            <span>🎲 {parlayLegs.size}-leg parlay ready</span>
            <span style={{ fontSize: 11, color: "#999" }}>Open builder →</span>
          </button>
        )}

        {activeTab === "steals" && (
          steals === null ? (
            <div style={S.center}>
              <div style={S.spinner} />
              <div style={{ color: "#777", fontSize: 13, marginTop: 12 }}>Scanning for CLEAN bets…</div>
            </div>
          ) : steals.length === 0 ? (
            <div style={S.center}>
              <div style={{ fontSize: 32 }}>🔒</div>
              <div style={{ color: "#fff", fontWeight: 700, marginTop: 8 }}>No CLEAN bets {fmtDateLabel(selectedDate)}</div>
              <div style={{ color: "#777", fontSize: 13, marginTop: 4 }}>All conditions must pass — discipline wins long-term</div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#00FF87", letterSpacing: 2 }}>
                  {steals.length} CLEAN BET{steals.length !== 1 ? "S" : ""} — ALL CONDITIONS PASSED
                </div>
                <button
                  onClick={copySteals}
                  style={{ fontSize: 11, color: copied ? "#00FF87" : "#333", background: "transparent", border: "1px solid #1a1a1a", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace" }}
                >
                  {copied ? "✓ Copied" : "Copy"}
                </button>
              </div>
              {steals.map(pick => {
                const f = pick.filter || {};
                const b = pick.breakdown || {};
                const isSaved = saving[pick.id] === "saved";
                const pickOdds = pick.pick === pick.homeTeam ? pick.homeOdds : pick.awayOdds;
                const decOdds = pickOdds ? (pickOdds > 0 ? 1 + pickOdds / 100 : 1 + 100 / Math.abs(pickOdds)) : null;
                const edgeFrac = (f.trueEdgePct || 0) / 100;
                const kB = decOdds ? decOdds - 1 : null;
                const kP = decOdds ? edgeFrac + (1 / decOdds) : null;
                const kellyPct = (kB && kP) ? (Math.max(0, (kB * kP - (1 - kP)) / kB) * 25).toFixed(1) : "0.0";
                return (
                  <div key={pick.id} style={{ ...S.card, borderColor: "rgba(0,255,135,0.35)" }}>
                    <div style={S.cardTop}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5, background: "rgba(0,255,135,0.12)", color: "#00FF87", border: "1px solid rgba(0,255,135,0.3)" }}>
                            BET
                          </span>
                          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#999" }}>
                            +{(f.trueEdgePct || 0).toFixed(1)}% edge
                          </span>
                          <span style={{ fontSize: 10, color: "#00FF87", opacity: 0.7 }}>
                            {f.confidence}/10 conf
                          </span>
                        </div>
                        <div style={S.cardMatchup}>
                          {pick.awayTeam}{pick.awayRecord && <span style={{ fontSize: 11, color: "#555", fontWeight: 400, marginLeft: 4 }}>({pick.awayRecord})</span>}
                          {" @ "}
                          {pick.homeTeam}{pick.homeRecord && <span style={{ fontSize: 11, color: "#555", fontWeight: 400, marginLeft: 4 }}>({pick.homeRecord})</span>}
                        </div>
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
                      <div style={{ marginTop: 10, background: "#050505", border: "1px solid #1a1a1a", borderRadius: 8, padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ fontSize: 9, color: "#777", letterSpacing: 1 }}>SUGGESTED STAKE</div>
                          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, fontWeight: 700, color: "#00FF87" }}>{kellyPct}% of bankroll</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 9, color: "#777", letterSpacing: 1 }}>25% KELLY</div>
                          <div style={{ fontSize: 11, color: "#999" }}>disciplined sizing</div>
                        </div>
                      </div>
                    )}
                    {b.preview && <div style={S.preview}>{b.preview}</div>}
                  </div>
                );
              })}

              {/* Parlay Cards with combined odds */}
              {steals.length >= 2 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#777", letterSpacing: 1.5, marginBottom: 10 }}>PARLAY CARDS</div>
                  {[
                    { label: "SAFE", legs: steals.slice(0, 2), color: "#00FF87" },
                    { label: "BALANCED", legs: steals.slice(0, 3), color: "#FFD600" },
                    { label: "AGGRESSIVE", legs: steals.slice(0, 4), color: "#FF4D4D" },
                  ].filter(c => c.legs.length >= 2).map(card => {
                    const comboDec = card.legs.reduce((acc, leg) => {
                      const o = leg.pick === leg.homeTeam ? leg.homeOdds : leg.awayOdds;
                      if (!o) return acc;
                      return acc * (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
                    }, 1);
                    const comboAmerican = comboDec >= 2
                      ? `+${Math.round((comboDec - 1) * 100)}`
                      : comboDec > 1
                      ? `${Math.round(-100 / (comboDec - 1))}`
                      : "—";
                    const payout10 = ((comboDec - 1) * 10).toFixed(0);
                    return (
                      <div key={card.label} style={{ background: "#080808", border: `1px solid ${card.color}22`, borderRadius: 12, padding: "12px 14px", marginBottom: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: card.color, letterSpacing: 1 }}>{card.label} — {card.legs.length}-LEG</span>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 700, color: card.color }}>{comboAmerican}</div>
                            <div style={{ fontSize: 10, color: "#777" }}>${payout10} profit on $10</div>
                          </div>
                        </div>
                        {card.legs.map((leg, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: i < card.legs.length - 1 ? "1px solid #111" : "none" }}>
                            <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono',monospace" }}>{leg.awayTeam} @ {leg.homeTeam}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 11, color: "#00FF87", fontWeight: 700 }}>{leg.pick}</span>
                              <span style={{ fontSize: 11, color: "#888", fontFamily: "'JetBrains Mono',monospace" }}>+{(leg.filter?.trueEdgePct || 0).toFixed(1)}%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )
        )}

        {activeTab === "parlay" && (
          <>
            {picks === null && (
              <div style={S.center}><div style={S.spinner} /></div>
            )}
            {picks !== null && (
              <>
                {/* Header: odds + stake */}
                <div style={{ background: "#080808", border: "1px solid rgba(255,214,0,0.2)", borderRadius: 14, padding: 16, marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#999", letterSpacing: 1.5, marginBottom: 4 }}>COMBINED ODDS</div>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 28, fontWeight: 700, color: parlayLegsList.length >= 2 ? "#FFD600" : "#333" }}>{parlayAmerican}</div>
                      <div style={{ fontSize: 11, color: "#777", marginTop: 2 }}>{parlayLegsList.length} leg{parlayLegsList.length !== 1 ? "s" : ""} selected</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#999", letterSpacing: 1.5, marginBottom: 6 }}>STAKE</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 13, color: "#999" }}>$</span>
                        <input
                          type="number"
                          min="1"
                          step="any"
                          value={parlayStake}
                          onChange={e => setParlayStake(Math.max(1, parseFloat(e.target.value) || 1))}
                          style={{ width: 70, background: "#111", border: "1px solid #222", borderRadius: 6, color: "#fff", fontSize: 15, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, padding: "4px 8px", textAlign: "right" }}
                        />
                      </div>
                      {parlayLegsList.length >= 2 && (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 16, fontWeight: 700, color: "#00FF87" }}>${(parseFloat(parlayProfit) + parlayStake).toFixed(2)}</div>
                          <div style={{ fontSize: 10, color: "#999" }}>+${parlayProfit} profit</div>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Selected legs */}
                  {parlayLegsList.length === 0 ? (
                    <div style={{ fontSize: 13, color: "#777", textAlign: "center", padding: "8px 0" }}>Tap any game below to add legs</div>
                  ) : parlayLegsList.map(({ game, teamPick }) => {
                    const o = teamPick === game.homeTeam ? game.homeOdds : game.awayOdds;
                    return (
                      <div key={game.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid #111" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, color: "#999" }}>{game.awayTeam} @ {game.homeTeam}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#FFD600" }}>{teamPick}{o != null ? ` ${fmtOdds(o)}` : ""}</div>
                        </div>
                        <button
                          style={{ fontSize: 11, color: "#FF4D4D", background: "transparent", border: "1px solid #1a1a1a", borderRadius: 6, padding: "4px 10px", cursor: "pointer", flexShrink: 0 }}
                          onClick={() => setParlayLegs(prev => { const n = new Map(prev); n.delete(game.id); return n; })}
                        >✕</button>
                      </div>
                    );
                  })}
                  {parlayLegsList.length >= 2 && (
                    <button
                      style={{ width: "100%", marginTop: 10, padding: "8px 0", background: "transparent", border: "1px solid #1a1a1a", borderRadius: 8, color: "#777", fontSize: 11, cursor: "pointer" }}
                      onClick={() => setParlayLegs(new Map())}
                    >Clear all</button>
                  )}
                </div>

                {/* All games */}
                <div style={{ fontSize: 10, fontWeight: 700, color: "#777", letterSpacing: 1.5, marginBottom: 8 }}>ALL GAMES — {fmtDateLabel(selectedDate).toUpperCase()}</div>
                {picks.length === 0 ? (
                  <div style={{ color: "#777", fontSize: 13, textAlign: "center", padding: 24 }}>No games for this date</div>
                ) : picks.map(game => {
                  const leg = parlayLegs.get(game.id);
                  const homeSel = leg?.teamPick === game.homeTeam;
                  const awaySel = leg?.teamPick === game.awayTeam;
                  const selectSide = (teamPick) => setParlayLegs(prev => {
                    const n = new Map(prev);
                    if (leg?.teamPick === teamPick) { n.delete(game.id); } else { n.set(game.id, { game, teamPick }); }
                    return n;
                  });
                  return (
                    <div key={game.id} style={{ ...S.card, borderColor: leg ? "rgba(255,214,0,0.25)" : "#1a1a1a", marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: "#999", marginBottom: 8 }}>
                        {fmtGameTime(game.commenceTime)}
                        {game.isBet && <span style={{ color: "#00FF87", fontWeight: 700, marginLeft: 6 }}>BET ↑</span>}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          style={{ flex: 1, padding: "10px 8px", borderRadius: 10, border: `1px solid ${awaySel ? "#FFD600" : "#1a1a1a"}`, background: awaySel ? "rgba(255,214,0,0.1)" : "transparent", cursor: "pointer", textAlign: "left" }}
                          onClick={() => selectSide(game.awayTeam)}
                        >
                          <div style={{ fontSize: 10, color: "#999", marginBottom: 3 }}>AWAY</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: awaySel ? "#FFD600" : "#fff" }}>{game.awayTeam.split(" ").pop()}</div>
                          {game.awayOdds != null && <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: awaySel ? "#FFD600" : "#555", marginTop: 2 }}>{fmtOdds(game.awayOdds)}</div>}
                        </button>
                        <div style={{ display: "flex", alignItems: "center", fontSize: 11, color: "#222", flexShrink: 0 }}>@</div>
                        <button
                          style={{ flex: 1, padding: "10px 8px", borderRadius: 10, border: `1px solid ${homeSel ? "#FFD600" : "#1a1a1a"}`, background: homeSel ? "rgba(255,214,0,0.1)" : "transparent", cursor: "pointer", textAlign: "right" }}
                          onClick={() => selectSide(game.homeTeam)}
                        >
                          <div style={{ fontSize: 10, color: "#999", marginBottom: 3 }}>HOME</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: homeSel ? "#FFD600" : "#fff" }}>{game.homeTeam.split(" ").pop()}</div>
                          {game.homeOdds != null && <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: homeSel ? "#FFD600" : "#555", marginTop: 2 }}>{fmtOdds(game.homeOdds)}</div>}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}

        {activeTab === "tracker" && (
          <>
            {/* ROI header */}
            <div style={{ background: "#080808", border: "1px solid #1a1a1a", borderRadius: 14, padding: "16px 16px 12px", marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#777", letterSpacing: 1, marginBottom: 4 }}>PROFIT / LOSS</div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 28, fontWeight: 700, color: pnl >= 0 ? "#00FF87" : "#FF4D4D" }}>
                    {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                  </div>
                  <div style={{ fontSize: 11, color: "#777", marginTop: 2 }}>flat ${unitSize}/bet · {total} settled{pushes > 0 ? ` · ${pushes} tie` : ""}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: "#777", letterSpacing: 1, marginBottom: 4 }}>UNIT SIZE</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 13, color: "#999" }}>$</span>
                    <input
                      type="number"
                      value={unitSize}
                      onChange={e => setUnitSize(Math.max(1, parseInt(e.target.value) || 10))}
                      style={{ width: 60, background: "#111", border: "1px solid #222", borderRadius: 6, color: "#fff", fontSize: 14, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, padding: "4px 8px", textAlign: "right" }}
                    />
                  </div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                <div style={S.statCard}><div style={{ ...S.statVal, color: "#00FF87", fontSize: 18 }}>{wins}</div><div style={S.statLabel}>Wins</div></div>
                <div style={S.statCard}><div style={{ ...S.statVal, color: "#FF4D4D", fontSize: 18 }}>{losses}</div><div style={S.statLabel}>Losses</div></div>
                <div style={S.statCard}><div style={{ ...S.statVal, fontSize: 18 }}>{decisioned > 0 ? winPct : "—"}%</div><div style={S.statLabel}>Win Rate</div></div>
                <div style={S.statCard}>
                  <div style={{ ...S.statVal, fontSize: 18, color: streakType === "win" ? "#00FF87" : streakType === "loss" ? "#FF4D4D" : "#333" }}>
                    {streakLen > 0 ? `${streakType === "win" ? "W" : "L"}${streakLen}` : "—"}
                  </div>
                  <div style={S.statLabel}>Streak</div>
                </div>
              </div>
            </div>
            {savedPicks.length === 0 ? (
              <div style={S.center}>
                <div style={{ fontSize: 32 }}>📊</div>
                <div style={{ color: "#fff", fontWeight: 700, marginTop: 8 }}>No saved picks yet</div>
                <div style={{ color: "#777", fontSize: 13, marginTop: 4 }}>Tap + Save on any pick to track it</div>
              </div>
            ) : (
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="tracker">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef}>
                      {savedPicks.map((p, idx) => (
                        <Draggable key={p.id} draggableId={String(p.id)} index={idx}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              style={{
                                ...S.card,
                                borderColor: snapshot.isDragging ? "#00FF87" : p.result === "win" ? "rgba(0,255,135,0.2)" : p.result === "loss" ? "rgba(255,77,77,0.2)" : "#1a1a1a",
                                marginBottom: 8,
                                ...provided.draggableProps.style,
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flex: 1 }}>
                                  <div {...provided.dragHandleProps} style={{ color: "#444", fontSize: 16, paddingTop: 2, cursor: "grab", userSelect: "none" }}>⠿</div>
                                  <div style={{ flex: 1 }}>
                                    <div style={S.cardMatchup}>{p.away_team} @ {p.home_team}</div>
                                    <div style={S.cardMeta}>Pick: <span style={{ color: "#00FF87" }}>{p.pick}</span> · {fmtOdds(p.odds)}</div>
                                    <div style={{ fontSize: 11, color: "#777", marginTop: 3 }}>
                                      {new Date(p.commence_time).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                                    </div>
                                  </div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{
                                    ...S.badge,
                                    background: p.result === "win" ? "rgba(0,255,135,0.1)" : p.result === "loss" ? "rgba(255,77,77,0.1)" : p.result === "push" ? "rgba(255,214,0,0.1)" : "rgba(136,136,136,0.1)",
                                    color: p.result === "win" ? "#00FF87" : p.result === "loss" ? "#FF4D4D" : p.result === "push" ? "#FFD600" : "#888",
                                  }}>
                                    {p.result === "push" ? "TIE" : p.result.toUpperCase()}
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
                              {p.result !== "pending" && (() => {
                                const recap = gameRecaps[p.game_id];
                                const edgeStr = p.edge != null ? `+${Number(p.edge).toFixed(1)}%` : null;

                                const buildParagraph = (d) => {
                                  const winner = d.homeRuns > d.awayRuns ? d.homeName : d.awayName;
                                  const loser  = winner === d.homeName ? d.awayName : d.homeName;
                                  const wRuns  = winner === d.homeName ? d.homeRuns : d.awayRuns;
                                  const lRuns  = winner === d.homeName ? d.awayRuns : d.homeRuns;
                                  const wHits  = winner === d.homeName ? d.homeHits : d.awayHits;
                                  const wStarter = winner === d.homeName ? d.homeStarter : d.awayStarter;
                                  const lStarter = winner === d.homeName ? d.awayStarter : d.homeStarter;
                                  const wNotables = (winner === d.homeName ? d.homeNotables : d.awayNotables) || [];
                                  const correct = p.result === "win";

                                  let s = `The model had the ${p.pick}${edgeStr ? ` at ${edgeStr} edge` : ""} — `;
                                  s += correct
                                    ? `and they delivered. `
                                    : `but it didn't pan out. `;
                                  s += `${winner} beat ${loser} ${wRuns}–${lRuns}`;
                                  if (wHits != null) s += ` on ${wHits} hits`;
                                  s += `. `;

                                  if (wStarter) {
                                    s += `${wStarter.name} started for the winners, going ${wStarter.ip} innings with ${wStarter.k} strikeouts and ${wStarter.er} earned run${wStarter.er !== 1 ? "s" : ""}. `;
                                  }
                                  if (lStarter) {
                                    s += `${lStarter.name} started for ${loser}, allowing ${lStarter.er} run${lStarter.er !== 1 ? "s" : ""} in ${lStarter.ip} innings. `;
                                  }
                                  if (wNotables.length) {
                                    const notes = wNotables.map(n => {
                                      let parts = [`${n.h} hit${n.h !== 1 ? "s" : ""}`];
                                      if (n.rbi) parts.push(`${n.rbi} RBI`);
                                      if (n.hr) parts.push(`${n.hr} HR`);
                                      return `${n.name.split(" ").pop()} (${parts.join(", ")})`;
                                    });
                                    s += `Offensively, ${notes.join(" and ")} led the way for ${winner}.`;
                                  }
                                  return s;
                                };

                                if (p.result === "push") {
                                  return <div style={{ marginTop: 10, fontSize: 12, color: "#888", lineHeight: 1.6, borderTop: "1px solid #1a1a1a", paddingTop: 10 }}>This game was postponed, cancelled, or ended in a tie — the pick didn't settle and your stake is returned.</div>;
                                }

                                return (
                                  <div style={{ marginTop: 10, borderTop: "1px solid #1a1a1a", paddingTop: 10 }}>
                                    {(!recap || recap === "loading") && <div style={{ fontSize: 12, color: "#444" }}>Loading game details...</div>}
                                    {recap === "error" && <div style={{ fontSize: 12, color: "#555" }}>Game details unavailable.</div>}
                                    {recap && recap !== "loading" && recap !== "error" && (
                                      <div style={{ fontSize: 12, color: "#888", lineHeight: 1.7 }}>{recap.paragraph || "No recap available."}</div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            )}
          </>
        )}

        {activeTab === "record" && calRecord === null && (
          <div style={{ textAlign: "center", color: "#777", padding: 40, fontSize: 13 }}>Loading record...</div>
        )}

        {activeTab === "record" && calRecord !== null && (() => {
          const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
          const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
          const { y, m } = calMonth;
          const firstDay = new Date(y, m, 1).getDay();
          const daysInMonth = new Date(y, m + 1, 0).getDate();
          const today = new Date().toISOString().split("T")[0];
          const allDays = [...Array(firstDay).fill(null), ...Array(daysInMonth).fill(0).map((_, i) => i + 1)];
          while (allDays.length % 7 !== 0) allDays.push(null);

          const totalW = Object.values(calRecord || {}).reduce((s, d) => s + (d.wins || 0), 0);
          const totalL = Object.values(calRecord || {}).reduce((s, d) => s + (d.losses || 0), 0);
          const winPct = (totalW + totalL) > 0 ? Math.round(totalW / (totalW + totalL) * 100) : null;

          return (
            <div>
              {/* Header stats */}
              <div style={{ background: "#080808", border: "1px solid #1a1a1a", borderRadius: 14, padding: "14px 16px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 10, color: "#888", letterSpacing: 1.5, marginBottom: 4 }}>ALL-TIME MODEL RECORD</div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 700 }}>
                    <span style={{ color: "#00FF87" }}>{totalW}</span>
                    <span style={{ color: "#777" }}>-</span>
                    <span style={{ color: "#FF4D4D" }}>{totalL}</span>
                    {winPct !== null && <span style={{ fontSize: 13, color: "#888", marginLeft: 10 }}>{winPct}%</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#777", marginBottom: 4 }}>{Object.keys(calRecord || {}).length} days tracked</div>
                  <button onClick={() => { setCalRecord(null); fetchCalRecord(); }} style={{ background: "none", border: "1px solid #333", borderRadius: 6, color: "#888", fontSize: 10, cursor: "pointer", padding: "3px 8px" }}>↻ Refresh</button>
                </div>
              </div>

              {/* Month nav */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, padding: "0 4px" }}>
                <button onClick={() => setCalMonth(({ y: py, m: pm }) => pm === 0 ? { y: py - 1, m: 11 } : { y: py, m: pm - 1 })}
                  style={{ background: "none", border: "none", color: "#999", fontSize: 18, cursor: "pointer", padding: "4px 8px" }}>‹</button>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{MONTHS[m]} {y}</div>
                <button onClick={() => setCalMonth(({ y: py, m: pm }) => pm === 11 ? { y: py + 1, m: 0 } : { y: py, m: pm + 1 })}
                  style={{ background: "none", border: "none", color: "#999", fontSize: 18, cursor: "pointer", padding: "4px 8px" }}>›</button>
              </div>

              {/* Day labels */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", marginBottom: 4 }}>
                {DAYS.map(d => <div key={d} style={{ textAlign: "center", fontSize: 10, color: "#777", padding: "4px 0" }}>{d}</div>)}
              </div>

              {/* Calendar grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 }}>
                {allDays.map((day, i) => {
                  if (!day) return <div key={i} />;
                  const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const rec = (calRecord || {})[dateStr];
                  const isToday = dateStr === today;
                  const isFuture = dateStr > today;
                  const hasData = rec && (rec.wins + rec.losses) > 0;
                  const dayColor = !hasData ? "transparent"
                    : rec.wins > rec.losses ? "rgba(0,255,135,0.15)"
                    : rec.losses > rec.wins ? "rgba(255,77,77,0.15)"
                    : "rgba(255,214,0,0.15)";
                  const borderColor = !hasData ? (isToday ? "#00FF87" : "#1a1a1a")
                    : rec.wins > rec.losses ? "rgba(0,255,135,0.4)"
                    : rec.losses > rec.wins ? "rgba(255,77,77,0.4)"
                    : "rgba(255,214,0,0.4)";
                  const textColor = !hasData ? (isFuture ? "#222" : isToday ? "#00FF87" : "#444")
                    : rec.wins > rec.losses ? "#00FF87"
                    : rec.losses > rec.wins ? "#FF4D4D"
                    : "#FFD600";

                  return (
                    <div key={i} style={{ background: dayColor, border: `1px solid ${borderColor}`, borderRadius: 8, padding: "6px 4px", textAlign: "center", minHeight: 52, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
                      <div style={{ fontSize: 11, color: textColor, fontWeight: isToday ? 700 : 400 }}>{day}</div>
                      {hasData && (
                        <>
                          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, fontWeight: 700, color: textColor }}>
                            {rec.wins}-{rec.losses}
                          </div>
                          {rec.picked != null && rec.picked > rec.wins + rec.losses + (rec.pushes || 0) && (
                            <div style={{ fontSize: 8, color: "#555" }}>{rec.wins + rec.losses}/{rec.picked}</div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {totalW + totalL === 0 && (
                <div style={{ textAlign: "center", color: "#555", fontSize: 12, marginTop: 12, padding: "10px 0" }}>
                  No resolved picks yet — results post the morning after each game.
                </div>
              )}

              {/* Legend */}
              <div style={{ display: "flex", gap: 16, marginTop: 14, justifyContent: "center" }}>
                {[["#00FF87", "Win day"], ["#FF4D4D", "Loss day"], ["#FFD600", "Split"]].map(([color, label]) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#777" }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: color, opacity: 0.6 }} />
                    {label}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {activeTab === "chat" && (() => {
          const sendChat = async (text) => {
            if (!text?.trim() || chatLoading) return;
            const userMsg = { role: "user", content: text.trim() };
            const newMessages = [...chatMessages, userMsg];
            setChatMessages(newMessages);
            setChatInput("");
            setChatLoading(true);
            try {
              const headers = await getAuthHeaders();
              const picksContext = picks?.filter(p => p.isBet) || [];
              const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }));
              const res = await fetch("/api/chat", {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ messages: apiMessages, picksContext }),
              });
              const data = await res.json();
              setChatMessages(prev => [...prev, { role: "assistant", content: data.reply || "Sorry, something went wrong." }]);
            } catch {
              setChatMessages(prev => [...prev, { role: "assistant", content: "Failed to connect. Try again." }]);
            } finally {
              setChatLoading(false);
              setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
            }
          };

          const suggestions = ["What are today's best bets?", "Any value underdogs?", "Biggest pitcher mismatches?", "Build me a 3-leg parlay"];

          return (
            <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 220px)", minHeight: 400 }}>
              {/* Messages */}
              <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
                {chatMessages.length === 0 && (
                  <div style={{ padding: "24px 0 16px" }}>
                    <div style={{ fontSize: 13, color: "#555", marginBottom: 14, textAlign: "center" }}>Ask me about today's games</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {suggestions.map(s => (
                        <button key={s} onClick={() => sendChat(s)}
                          style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 20, padding: "7px 13px", color: "#888", fontSize: 12, cursor: "pointer" }}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {chatMessages.map((m, i) => (
                  <div key={i} style={{ marginBottom: 12, display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                    <div style={{
                      maxWidth: "85%", padding: "10px 14px", borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                      background: m.role === "user" ? "rgba(0,255,135,0.12)" : "#0d0d0d",
                      border: `1px solid ${m.role === "user" ? "rgba(0,255,135,0.2)" : "#1a1a1a"}`,
                      fontSize: 13, color: m.role === "user" ? "#e0e0e0" : "#ccc", lineHeight: 1.6, whiteSpace: "pre-wrap",
                    }}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div style={{ display: "flex", gap: 4, padding: "8px 4px" }}>
                    {[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#333", animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />)}
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              {/* Input */}
              <div style={{ display: "flex", gap: 8, paddingTop: 10, borderTop: "1px solid #111" }}>
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), sendChat(chatInput))}
                  placeholder="Ask about today's games..."
                  style={{ flex: 1, background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 20, padding: "10px 16px", color: "#fff", fontSize: 13, outline: "none" }}
                />
                <button onClick={() => sendChat(chatInput)} disabled={chatLoading || !chatInput.trim()}
                  style={{ background: chatInput.trim() ? "#00FF87" : "#1a1a1a", border: "none", borderRadius: 20, padding: "10px 18px", color: chatInput.trim() ? "#000" : "#444", fontSize: 13, fontWeight: 700, cursor: chatInput.trim() ? "pointer" : "default", transition: "all 0.15s" }}>
                  Send
                </button>
              </div>
            </div>
          );
        })()}

      </div>}

      {upgradeModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={() => setUpgradeModal(false)}>
          <div style={{ width: "100%", maxWidth: 500, background: "#0a0a0a", borderRadius: "24px 24px 0 0", border: "1px solid #1a1a1a", borderBottom: "none", padding: "0 0 max(24px, env(safe-area-inset-bottom)) 0", animation: "slideUp 0.3s cubic-bezier(0.32,0.72,0,1)" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: "#222" }} />
            </div>
            <div style={{ padding: "16px 24px 8px" }}>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
                  T<span style={{ color: "#00FF87" }}>|</span>T <span style={{ color: "#777", fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 400 }}>Pro</span>
                </div>
                <div style={{ color: "#666", fontSize: 13 }}>Unlock all picks, edge scores, and AI breakdowns</div>
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <button onClick={() => startCheckout("monthly")} disabled={!!checkingOut}
                  style={{ flex: 1, background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 14, padding: "16px 12px", cursor: "pointer", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#999", letterSpacing: 1, marginBottom: 4 }}>MONTHLY</div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 26, fontWeight: 700, color: "#fff" }}>$2</div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>per month</div>
                  {checkingOut === "monthly" && <div style={{ color: "#999", fontSize: 11, marginTop: 4 }}>Redirecting…</div>}
                </button>
                <button onClick={() => startCheckout("annual")} disabled={!!checkingOut}
                  style={{ flex: 1, background: "#0a1a0f", border: "1px solid rgba(0,255,135,0.3)", borderRadius: 14, padding: "16px 12px", cursor: "pointer", textAlign: "center", position: "relative" }}>
                  <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", background: "#00FF87", color: "#000", fontSize: 9, fontWeight: 800, padding: "2px 10px", borderRadius: 20, letterSpacing: 0.5, whiteSpace: "nowrap" }}>2 MONTHS FREE</div>
                  <div style={{ fontSize: 10, color: "#00FF87", letterSpacing: 1, marginBottom: 4 }}>ANNUAL</div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 26, fontWeight: 700, color: "#00FF87" }}>$19.99</div>
                  <div style={{ fontSize: 12, color: "#999", marginTop: 3 }}>$1.67/mo · 2 months free</div>
                  {checkingOut === "annual" && <div style={{ color: "#00FF87", fontSize: 11, marginTop: 4 }}>Redirecting…</div>}
                </button>
              </div>
              <div style={{ fontSize: 11, color: "#333", textAlign: "center", marginBottom: 14 }}>Cancel anytime · Secure payment via Stripe</div>
              <div style={{ borderTop: "1px solid #111", paddingTop: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: "#555", textAlign: "center", marginBottom: 10 }}>Have an access code?</div>
                {codeStatus === "ok" ? (
                  <div style={{ textAlign: "center", fontSize: 14, color: "#00FF87", fontWeight: 700 }}>✓ Access granted — welcome in!</div>
                ) : (
                  <form onSubmit={async e => {
                    e.preventDefault();
                    if (!accessCode.trim() || !user) return;
                    setCodeStatus("loading");
                    try {
                      const r = await fetch("/api/redeem-code", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ code: accessCode.trim(), userId: user.id }),
                      });
                      if (r.ok) {
                        setCodeStatus("ok");
                        setTimeout(() => { setIsPro(true); try { localStorage.setItem("tot-pro", JSON.stringify({ v: true, e: Date.now() + 5 * 60 * 1000 })); } catch {} }, 600);
                      } else {
                        setCodeStatus("invalid");
                        setTimeout(() => setCodeStatus(null), 3000);
                      }
                    } catch { setCodeStatus("invalid"); setTimeout(() => setCodeStatus(null), 3000); }
                  }} style={{ display: "flex", gap: 8 }}>
                    <input type="text" placeholder="Enter code" value={accessCode}
                      onChange={e => setAccessCode(e.target.value.toUpperCase())}
                      style={{ ...S.input, flex: 1, letterSpacing: 3, fontFamily: "'JetBrains Mono',monospace", textAlign: "center", fontSize: 15 }} />
                    <button type="submit" disabled={codeStatus === "loading"}
                      style={{ background: codeStatus === "invalid" ? "#FF4D4D" : "#00FF87", color: "#000", border: "none", borderRadius: 10, padding: "0 18px", fontWeight: 800, fontSize: 13, cursor: "pointer", flexShrink: 0 }}>
                      {codeStatus === "loading" ? "…" : codeStatus === "invalid" ? "✗ Invalid" : "Apply"}
                    </button>
                  </form>
                )}
              </div>
              <button style={{ width: "100%", background: "transparent", border: "none", color: "#444", fontSize: 13, padding: "8px 0", marginBottom: 4, cursor: "pointer" }}
                onClick={() => setUpgradeModal(false)}>
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === "nfl" && isBeta && (
        <NFLSection
          S={S}
          getAuthHeaders={getAuthHeaders}
          isPro={isPro}
          isAdmin={isAdmin}
          setUpgradeModal={setUpgradeModal}
          savePick={savePick}
          saving={saving}
          selectedDate={selectedDate}
        />
      )}

      <div style={S.legal}>
        For entertainment only · Not gambling advice · Must be 21+ in a legal jurisdiction
        {" · "}
        <a href="/terms" style={{ color: "#222", textDecoration: "underline" }}>Terms</a>
        {" · "}
        <a href="/privacy" style={{ color: "#222", textDecoration: "underline" }}>Privacy</a>
        <br />
        Problem gambling? Call <span style={{ color: "#777" }}>1-800-GAMBLER</span>
      </div>
    </div>
  );
}

const fmtO = o => o == null ? "—" : o > 0 ? `+${o}` : `${o}`;

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
  @keyframes slideUp{from{transform:translateY(100%);}to{transform:translateY(0);}}
  @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
  ::-webkit-scrollbar{width:0;height:0;}
`;

const S = {
  page: { minHeight: "100vh", background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20, gap: 20 },
  previewBox: { width: "100%", maxWidth: 480, border: "1px solid #2a2a2a", borderRadius: 16, padding: 20, background: "#0d0d0d" },
  previewTag: { fontSize: 10, fontWeight: 700, color: "#00FF87", letterSpacing: 2, marginBottom: 10 },
  previewMatchup: { fontFamily: "'JetBrains Mono',monospace", fontSize: 17, fontWeight: 700 },
  previewReason: { fontSize: 13, color: "#888", marginTop: 10, lineHeight: 1.6 },
  authBox: { width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", gap: 12 },
  logo: { fontFamily: "'JetBrains Mono',monospace", fontSize: 36, fontWeight: 700, textAlign: "center", letterSpacing: -1 },
  authSub: { fontSize: 14, color: "#888", textAlign: "center" },
  googleBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 13, borderRadius: 10, background: "#141414", border: "1px solid #2a2a2a", color: "#fff", fontSize: 14, fontWeight: 500 },
  orRow: { display: "flex", alignItems: "center" },
  orLine: { flex: 1, height: 1, background: "#222" },
  input: { padding: "13px 16px", borderRadius: 10, background: "#0d0d0d", border: "1px solid #2a2a2a", color: "#fff", fontSize: 14, width: "100%" },
  primaryBtn: { padding: 14, borderRadius: 10, background: "#00FF87", color: "#000", fontSize: 14, fontWeight: 700, width: "100%" },
  errMsg: { fontSize: 12, color: "#FF4D4D", textAlign: "center" },
  switchRow: { fontSize: 13, color: "#777", textAlign: "center" },
  app: { minHeight: "100vh", width: "100%", background: "#000", display: "flex", flexDirection: "column" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000, display: "flex" },
  drawer: { width: 270, background: "#0a0a0a", borderRight: "1px solid #222", minHeight: "100vh", padding: 24, display: "flex", flexDirection: "column", gap: 4, animation: "slideIn 0.2s ease", overflowY: "auto" },
  drawerLogo: { fontFamily: "'JetBrains Mono',monospace", fontSize: 24, fontWeight: 700, marginBottom: 4 },
  drawerEmail: { fontSize: 12, color: "#666", marginBottom: 8 },
  drawerLine: { height: 1, background: "#222", margin: "12px 0" },
  drawerItem: { padding: "11px 0", fontSize: 15, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 10 },
  drawerSectionLabel: { fontSize: 10, fontWeight: 700, color: "#999", letterSpacing: 1.5, marginBottom: 10 },
  accuracyCard: { background: "#111", border: "1px solid #222", borderRadius: 10, padding: 12 },
  nav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #1a1a1a", position: "sticky", top: 0, background: "rgba(0,0,0,0.97)", backdropFilter: "blur(12px)", zIndex: 100 },
  menuBtn: { background: "none", display: "flex", flexDirection: "column", gap: 5, padding: 4 },
  menuLine: { width: 22, height: 2, background: "#ccc", borderRadius: 1 },
  navLogo: { fontFamily: "'JetBrains Mono',monospace", fontSize: 20, fontWeight: 700, letterSpacing: -1 },
  navBadge: { fontSize: 11, fontWeight: 700, color: "#000", background: "#00FF87", padding: "3px 10px", borderRadius: 20, letterSpacing: 0.5 },
  carousel: { margin: "12px 20px", border: "1px solid #222", borderRadius: 14, padding: "16px 18px", background: "#0d0d0d", height: 100, overflow: "hidden" },
  carouselTag: { fontSize: 9, fontWeight: 700, color: "#00FF87", letterSpacing: 2, marginBottom: 6 },
  carouselMatchup: { fontFamily: "'JetBrains Mono',monospace", fontSize: 15, fontWeight: 700 },
  dateScroll: { display: "flex", gap: 6, padding: "10px 20px", overflowX: "auto", borderBottom: "1px solid #1a1a1a" },
  dateBtn: { flexShrink: 0, padding: "7px 16px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "1px solid", letterSpacing: 0.3, whiteSpace: "nowrap" },
  subNav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", borderBottom: "1px solid #1a1a1a" },
  tabBtn: { padding: "6px 16px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: "#111", border: "1px solid #2a2a2a", letterSpacing: 0.3 },
  sortBtn: { width: 32, height: 32, borderRadius: 8, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", background: "#111", border: "1px solid #2a2a2a" },
  content: { flex: 1, padding: "12px 20px 40px", display: "flex", flexDirection: "column", gap: 10, overflowY: "auto" },
  center: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 60, textAlign: "center" },
  spinner: { width: 28, height: 28, border: "2px solid #222", borderTopColor: "#00FF87", borderRadius: "50%", animation: "spin 0.7s linear infinite" },
  card: { background: "#0d0d0d", border: "1px solid", borderRadius: 14, padding: 16, transition: "border-color 0.2s", animation: "fadeUp 0.3s ease" },
  cardTop: { display: "flex", alignItems: "flex-start", gap: 10 },
  badge: { display: "inline-block", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 6, letterSpacing: 0.3, marginBottom: 6 },
  cardMatchup: { fontFamily: "'JetBrains Mono',monospace", fontSize: 14, fontWeight: 700, marginTop: 2 },
  cardMeta: { fontSize: 12, color: "#777", marginTop: 4 },
  saveBtn: { fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid", letterSpacing: 0.3 },
  expandBtn: { width: 32, height: 32, borderRadius: 8, background: "#111", border: "1px solid #333", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", color: "#888" },
  pitchRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 10, padding: "10px 12px", background: "#080808", borderRadius: 10, border: "1px solid #222" },
  pitchBox: { flex: 1 },
  pitchLabel: { fontSize: 9, fontWeight: 700, color: "#999", letterSpacing: 1.5, marginBottom: 3 },
  pitchName: { fontSize: 12, fontWeight: 600, color: "#aaa" },
  pitchVs: { fontSize: 10, fontWeight: 700, color: "#888" },
  preview: { fontSize: 13, color: "#888", lineHeight: 1.6, marginTop: 10, paddingTop: 10, borderTop: "1px solid #1a1a1a" },
  expDivider: { height: 1, background: "#1a1a1a", margin: "12px 0" },
  expSection: { marginBottom: 12 },
  expLabel: { fontSize: 10, fontWeight: 700, color: "#999", letterSpacing: 1.5, marginBottom: 6 },
  expText: { fontSize: 13, color: "#999", lineHeight: 1.6 },
  statBox: { flex: 1, background: "#080808", borderRadius: 8, padding: "10px 12px", border: "1px solid #222" },
  statCard: { background: "#0d0d0d", border: "1px solid #222", borderRadius: 12, padding: 14, textAlign: "center" },
  statLabel: { fontSize: 10, color: "#999", marginBottom: 3, marginTop: 4 },
  statVal: { fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" },
  trashBtn: { background: "#111", border: "1px solid #222", borderRadius: 6, fontSize: 15, cursor: "pointer", padding: "4px 8px", opacity: 0.8 },
  resultBtn: { flex: 1, padding: "10px", borderRadius: 10, border: "2px solid", fontSize: 13, fontWeight: 800 },
  legal: { padding: "14px 20px", borderTop: "1px solid #111", textAlign: "center", fontSize: 10, color: "#777", lineHeight: 1.9 },
};
