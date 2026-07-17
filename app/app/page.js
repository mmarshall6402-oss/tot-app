"use client";
export const dynamic = 'force-dynamic';
import { useState, useEffect, useRef } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { createClient } from "@supabase/supabase-js";
import NFLSection from "../../components/NFLSection.js";
import ScheduleSection from "../../components/ScheduleSection.js";
import TeamModal, { TeamMatchupLink } from "../../components/TeamModal.js";
import PlayerModal from "../../components/PlayerModal.js";
import DecisionCard from "../../components/DecisionCard.js";
import SkipSummary from "../../components/SkipSummary.js";
import PropCard from "../../components/PropCard.js";
import { impliedWinPct, oddsMovement } from "../../lib/odds-display.js";
import { translateReasons } from "../../lib/reason-labels.js";
import { shouldBetNow } from "../../lib/fair-odds.js";
import { S, tokens, SHARED_BUTTON_CSS, FONT_IMPORT_URL, tabButtonStyle, statTileStyle, iconButtonStyle } from "../../lib/ui-theme.js";
import { CheckIcon, XIcon, TrashIcon, RefreshIcon, ChevronLeftIcon, CloseIcon, HomeIcon, GamesIcon, WalletIcon, UserIcon, TrendingUpIcon, ClockIcon, LockIcon, SearchIcon } from "../../components/icons.js";

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

// Devigged win % for both teams, plus an open→current movement arrow when
// opening odds were captured for this pick. Renders nothing without odds.
function WinPctRow({ homeTeam, awayTeam, homeOdds, awayOdds, openHomeOdds, openAwayOdds }) {
  const wp = impliedWinPct(homeOdds, awayOdds);
  if (!wp) return null;
  const move = oddsMovement(openHomeOdds, homeOdds, openAwayOdds, awayOdds);
  const arrow = move?.direction === "up" ? "▲" : move?.direction === "down" ? "▼" : null;
  const arrowColor = move?.direction === "up" ? "#2FBF71" : move?.direction === "down" ? "#D9645C" : "#555";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6, fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }}>
      <span style={{ color: "#666" }}>{(awayTeam || "").split(" ").pop()} <b style={{ color: "#bbb" }}>{wp.away}%</b></span>
      <span style={{ color: "#3d424f" }}>·</span>
      <span style={{ color: "#666" }}>{(homeTeam || "").split(" ").pop()} <b style={{ color: "#bbb" }}>{wp.home}%</b></span>
      {arrow && (
        <span style={{ color: arrowColor }}>{arrow} {move.delta}% since open</span>
      )}
    </div>
  );
}

const TIER = {
  High:   { color: "#2FBF71", bg: "rgba(47,191,113,0.08)", label: "Value Pick" },
  Medium: { color: "#D6B23D", bg: "rgba(214,178,61,0.08)",  label: "Solid Pick" },
  Low:    { color: "#888",    bg: "rgba(136,136,136,0.08)", label: "Lean" },
  Tossup: { color: "#888",    bg: "rgba(68,68,68,0.06)",   label: "Toss-Up" },
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

  const tierColor = { High: "#2FBF71", Medium: "#D6B23D", Low: "#888" };
  const tierLabel = { High: "Value", Medium: "Solid", Low: "Lean" };
  const rateColor = winPct === null ? "#3d424f" : winPct >= 55 ? "#2FBF71" : winPct >= 45 ? "#D6B23D" : "#D9645C";

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
        <div style={{ marginTop: 8, height: 3, background: "#181b22", borderRadius: 2 }}>
          <div style={{ height: "100%", borderRadius: 2, width: `${winPct || 0}%`, background: rateColor, transition: "width 0.6s ease" }} />
        </div>
        <div style={{ fontSize: 11, color: "#777", marginTop: 6 }}>{decisioned.length} settled pick{decisioned.length !== 1 ? "s" : ""}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 10 }}>
        {byTier.map(({ tier, total: t, pct }) => (
          <div key={tier} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: tierColor[tier], width: 64, flexShrink: 0 }}>{tierLabel[tier]}</span>
            <div style={{ flex: 1, height: 3, background: "#181b22", borderRadius: 2 }}>
              <div style={{ height: "100%", borderRadius: 2, width: `${pct || 0}%`, background: tierColor[tier], transition: "width 0.6s ease" }} />
            </div>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: pct !== null ? tierColor[tier] : "#3d424f", width: 30, textAlign: "right", flexShrink: 0 }}>
              {pct !== null ? `${pct}%` : "—"}
            </span>
            <span style={{ fontSize: 10, color: "#2b2f3a", flexShrink: 0 }}>({t})</span>
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
  const [activeTab, setActiveTab] = useState("home");
  const [sortBy, setSortBy] = useState("edge");
  const [expanded, setExpanded] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [saving, setSaving] = useState({});
  const [freePick, setFreePick] = useState(null);
  const [homeNflPicks, setHomeNflPicks] = useState(null);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const weekDates = getWeekDates();
  const todayStr = weekDates[7];
  const [selectedDate, setSelectedDate] = useState(todayStr);
  // Tracks the most recently selected date so a slow fetch for a date the
  // user has since navigated away from can't clobber newer state on arrival.
  const selectedDateRef = useRef(todayStr);
  useEffect(() => { selectedDateRef.current = selectedDate; }, [selectedDate]);
  const dateScrollRef = useRef(null);
  const todayBtnRef = useRef(null);
  const [steals, setSteals] = useState(null);
  const [trendingProps, setTrendingProps] = useState(null);
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
  const [calStats, setCalStats] = useState(null);
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
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [teamModal, setTeamModal] = useState(null); // { sport, team }
  const openTeam = (sport, team) => { if (team) setTeamModal({ sport, team }); };
  const [playerModal, setPlayerModal] = useState(null); // { sport, id, name }
  const openPlayer = (sport, id, name) => { if (id) setPlayerModal({ sport, id, name }); };
  const [modelStreak, setModelStreak] = useState(null);
  const [teamSearchOpen, setTeamSearchOpen] = useState(false);
  const [teamQuery, setTeamQuery] = useState("");
  const [teamView, setTeamView] = useState(null); // { team, games }
  const [teamViewLoading, setTeamViewLoading] = useState(false);
  const [livePicks, setLivePicks] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [toastQueue, setToastQueue] = useState([]);
  const prevLiveRef = useRef([]);
  const [feedEvents, setFeedEvents] = useState(null);
  const [feedTopPicks, setFeedTopPicks] = useState([]);
  const [feedLoading, setFeedLoading] = useState(false);

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
    fetch("/api/streak").then(r => r.json()).then(d => setModelStreak(d)).catch(() => {});
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
    if (activeTab === "picks" || activeTab === "home") fetchPicks(selectedDate);
    if (activeTab === "parlay" && picksDate !== selectedDate) fetchPicks(selectedDate);
    if (activeTab === "steals") fetchSteals(selectedDate);
    if ((activeTab === "props" || activeTab === "home") && isBeta) fetchProps(selectedDate);
    if (activeTab === "tracker") fetchSaved();
  }, [user, isPro, isBeta, activeTab, selectedDate]);

  useEffect(() => {
    if (user && isPro && activeTab !== "tracker") fetchSaved();
  }, [user, isPro]);

  useEffect(() => {
    if (!upgradeModal) return;
    const onKey = (e) => { if (e.key === "Escape") setUpgradeModal(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [upgradeModal]);

  useEffect(() => {
    if (!showDeleteModal) return;
    const onKey = (e) => { if (e.key === "Escape" && !deleting) setShowDeleteModal(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showDeleteModal, deleting]);

  useEffect(() => {
    if (!showInstallPrompt) return;
    const onKey = (e) => { if (e.key === "Escape") setShowInstallPrompt(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showInstallPrompt]);

  // Home needs today's NFL picks too — the "best bet" hero has to compare
  // across both sports, not just default to MLB. NFLSection.js fetches its
  // own copy of this independently; duplicated here rather than lifting
  // NFLSection's state since the two views can be open on different dates.
  useEffect(() => {
    if (!user || !isPro || activeTab !== "home") return;
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/nfl/picks?date=${selectedDate}`, { headers });
        const data = await res.json();
        setHomeNflPicks(res.ok ? (data.picks || []) : []);
      } catch { setHomeNflPicks([]); }
    })();
  }, [user, isPro, activeTab, selectedDate]);

  // Live tab polling — fetch today's picks every 60s, detect settlements
  useEffect(() => {
    if (!user || !isPro || activeTab !== "live") return;
    setLiveLoading(!livePicks);
    fetchLive();
    const interval = setInterval(fetchLive, 60_000);
    return () => clearInterval(interval);
  }, [user, isPro, activeTab]);

  // Dismiss toasts one at a time after 5s
  useEffect(() => {
    if (!toastQueue.length) return;
    const t = setTimeout(() => setToastQueue(q => q.slice(1)), 5000);
    return () => clearTimeout(t);
  }, [toastQueue]);

  const fetchFeed = async () => {
    if (!user || !isPro) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/activity", { headers });
      const data = await res.json();
      setFeedEvents(data.events || []);
      setFeedTopPicks(data.topPicks || []);
    } catch {}
    setFeedLoading(false);
  };

  useEffect(() => {
    if (!user || !isPro || activeTab !== "feed") return;
    setFeedLoading(!feedEvents);
    fetchFeed();
    const interval = setInterval(fetchFeed, 30_000);
    return () => clearInterval(interval);
  }, [user, isPro, activeTab]);

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

  const manageBilling = () => {
    setDrawerOpen(false);
    setShowCancelModal(true);
  };

  const goToBillingPortal = async (flow) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(flow ? { flow } : {}),
      });
      const data = await res.json();
      if (data.url) { window.location.href = data.url; return; }
      alert(data.error || "Billing portal unavailable. Contact support.");
    } catch (e) {
      alert("Could not open billing portal. Try again later.");
    }
  };

  const changePlan = () => {
    setDrawerOpen(false);
    goToBillingPortal("update");
  };

  const deleteAccount = async () => {
    if (deleteConfirmText !== "DELETE") return;
    setDeleting(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        try { localStorage.removeItem("tot-pro"); } catch {}
        await getSupabase().auth.signOut();
        window.location.href = "/";
        return;
      }
      alert(data.error || "Could not delete account. Contact support.");
    } catch (e) {
      alert("Could not delete account. Try again later.");
    }
    setDeleting(false);
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
    try {
      const s = await fetch("/api/calibration").then(r => r.json());
      setCalStats(s);
    } catch { setCalStats({}); }
  };

  const getAuthHeaders = async () => {
    const { data: { session } } = await getSupabase().auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  };

  const ALL_MLB_TEAMS = [
    "Arizona Diamondbacks","Atlanta Braves","Baltimore Orioles","Boston Red Sox",
    "Chicago Cubs","Chicago White Sox","Cincinnati Reds","Cleveland Guardians",
    "Colorado Rockies","Detroit Tigers","Houston Astros","Kansas City Royals",
    "Los Angeles Angels","Los Angeles Dodgers","Miami Marlins","Milwaukee Brewers",
    "Minnesota Twins","New York Mets","New York Yankees","Oakland Athletics",
    "Philadelphia Phillies","Pittsburgh Pirates","San Diego Padres","San Francisco Giants",
    "Seattle Mariners","St. Louis Cardinals","Tampa Bay Rays","Texas Rangers",
    "Toronto Blue Jays","Washington Nationals",
  ];

  const teamSuggestions = teamQuery.length >= 2
    ? ALL_MLB_TEAMS.filter(t => t.toLowerCase().includes(teamQuery.toLowerCase())).slice(0, 5)
    : [];

  const fetchTeamSchedule = async (team) => {
    setTeamQuery(team);
    setTeamViewLoading(true);
    setTeamView(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/team-schedule?team=${encodeURIComponent(team)}`, { headers });
      const data = await res.json();
      setTeamView(data);
    } catch {}
    setTeamViewLoading(false);
  };

  const clearTeamSearch = () => {
    setTeamSearchOpen(false);
    setTeamQuery("");
    setTeamView(null);
  };

  const showToast = (t) => setToastQueue(q => [...q, { ...t, id: Date.now() }]);

  const fetchLive = async () => {
    if (!user || !isPro) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/picks?date=${todayStr}`, { headers });
      const data = await res.json();
      const next = data.picks || [];

      // Detect any game that just went Final since last poll
      const prev = prevLiveRef.current;
      for (const pick of next) {
        const was = prev.find(p => p.id === pick.id);
        const justFinished = was && was.liveScore?.status !== "Final" && pick.liveScore?.status === "Final";
        if (justFinished) {
          const hs = pick.liveScore.homeScore ?? 0;
          const as = pick.liveScore.awayScore ?? 0;
          const modelWon = pick.pick === pick.homeTeam ? hs > as : as > hs;
          const modelPush = hs === as;
          showToast({
            icon: modelPush ? "push" : modelWon ? "win" : "loss",
            message: `${pick.awayTeam.split(" ").pop()} ${as} · ${pick.homeTeam.split(" ").pop()} ${hs} — Final`,
            sub: modelPush ? "Push" : modelWon ? `${pick.pick.split(" ").pop()} won — model HIT` : `${pick.pick.split(" ").pop()} lost — model MISS`,
            color: modelPush ? "#888" : modelWon ? "#2FBF71" : "#D9645C",
          });
        }
      }
      prevLiveRef.current = next;
      setLivePicks(next);
    } catch {}
    setLiveLoading(false);
  };

  const fetchSteals = async (date) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/steals?date=${date}`, { headers });
      const data = await res.json();
      if (date !== selectedDateRef.current) return; // stale — user navigated away
      setSteals(data.steals || []);
    } catch (e) { if (date === selectedDateRef.current) setSteals(prev => prev ?? []); }
  };

  const fetchProps = async (date) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/props?date=${date}`, { headers });
      const data = await res.json();
      if (date !== selectedDateRef.current) return; // stale — user navigated away
      setTrendingProps(data.picks || []);
    } catch (e) { if (date === selectedDateRef.current) setTrendingProps(prev => prev ?? []); }
  };

  const fetchPicks = async (date, bust = false) => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/picks?date=${date}${bust ? "&bust=1" : ""}`, { headers });
      // A crashed serverless function returns an HTML error page, not JSON —
      // parse defensively so the user sees the HTTP status instead of
      // "Unexpected token '<'".
      let data = null;
      try { data = await res.json(); } catch {}
      if (!res.ok || !data) throw new Error(data?.error || `Server error (${res.status}) — the picks API crashed; check Vercel logs`);
      if (date !== selectedDateRef.current) return; // stale — user navigated away
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
      if (date === selectedDateRef.current) {
        setPicksError(e.message || "Could not load games");
        setPicksDiagnostic(null);
        setPicks(prev => prev ?? []);
      }
    }
    setLoading(false);
  };

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

  // Beta access — set once when user resolves
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

  // Which top-level sport pill should read as "active" — everything that isn't NFL
  // or Settings is an MLB-scoped tab, so it defaults to "mlb" rather than needing
  // every MLB tab id listed out here.
  const currentSport = activeTab === "home" ? "home" : activeTab === "nfl" ? "nfl" : activeTab === "settings" ? "settings" : activeTab === "schedule" ? "schedule" : "mlb";
  // Bottom-tab-bar grouping — Home/Games/Portfolio/Profile. Games covers the
  // whole "today's board" experience (Picks/Steals/Live/Feed/Chat/Props/NFL/
  // Schedule); Portfolio is "my bets" (Tracker/Parlay/Record); everything
  // else maps 1:1. activeTab itself keeps its existing fine-grained values —
  // this is purely a navigation grouping layer on top.
  const navGroup = (tab) => (["tracker", "parlay", "record"].includes(tab) ? "portfolio" : tab === "settings" ? "profile" : tab === "home" ? "home" : "games");
  const NAV_GROUP_DEFAULT = { home: "home", games: "picks", portfolio: "tracker", profile: "settings" };

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
  const landRateColor = landWinPct == null ? "#fff" : landWinPct >= 58 ? "#2FBF71" : landWinPct >= 52 ? "#D6B23D" : "#fff";
  const MOCK_PICKS = [
    { away: "Yankees", home: "Red Sox",   verdict: "CLEAN", pick: "Yankees", odds: "-118", edge: "+4.2%", blur: false, sport: "MLB" },
    { away: "Dodgers", home: "Padres",    verdict: "BET",   pick: "Dodgers", odds: "-132", edge: "+3.1%", blur: false, sport: "MLB" },
    { away: "Bills",   home: "Dolphins",  verdict: null,    pick: "Bills",   odds: "-145", edge: null,    blur: true,  sport: "NFL" },
    { away: "Cubs",    home: "Cardinals", verdict: null,    pick: "Cubs",    odds: "-110", edge: null,    blur: true,  sport: "MLB" },
  ];

  if (!user) return (
    <div style={{ minHeight: "100vh", background: "#0a0b0f", fontFamily: tokens.font.body, color: "#fff", overflowX: "hidden" }}>
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
        .l-glow{background:${tokens.color.border};height:1px;width:100%}
        .l-blur{position:relative;overflow:hidden}
        ${SHARED_BUTTON_CSS}
      `}</style>

      {!showAuth ? (
        <>
          {/* NAV */}
          <nav style={{ position:"sticky",top:0,zIndex:100,background:"rgba(10,11,15,.88)",backdropFilter:"blur(20px)",borderBottom:"1px solid #1c1f26",padding:"13px 20px",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:17,fontWeight:700 }}>T<span style={{ color:"#2FBF71" }}>|</span>T</div>
            <div style={{ display:"flex",gap:10,alignItems:"center" }}>
              <a href="https://twitter.com/ThisorThatPicks" target="_blank" rel="noopener noreferrer" style={{ fontSize:12,color:"#444",textDecoration:"none" }}>𝕏 @ThisorThatPicks</a>
              <button className="cta-btn" style={{ fontSize:12,padding:"8px 18px" }} onClick={() => { setShowAuth(true); setAuthMode("signin"); }}>Sign In →</button>
            </div>
          </nav>

          {/* HERO */}
          <section style={{ padding:"72px 20px 60px",maxWidth:800,margin:"0 auto",textAlign:"center" }}>
            <div className="l-fade" style={{ fontSize:12,color:"#777",fontWeight:500,marginBottom:20 }}>Live today · MLB &amp; NFL</div>
            <h1 className="l-fade2" style={{ fontSize:"clamp(36px,7vw,64px)",fontWeight:600,lineHeight:1.1,letterSpacing:-0.5,marginBottom:18 }}>
              We outperform<br/><span style={{ color:"#2FBF71" }}>Vegas odds</span><br/>with data.
            </h1>
            <p className="l-fade3" style={{ fontSize:"clamp(14px,2.5vw,17px)",color:"#666",lineHeight:1.65,maxWidth:520,margin:"0 auto 32px" }}>
              T|T is a sharp MLB and NFL model that finds genuine edges the books miss — pitcher match-ups, bullpen state, park factors, QB matchups, EPA, and line movement. Not gut feelings. Edges.
            </p>
            <div style={{ display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap",marginBottom:40 }}>
              <button className="cta-btn" onClick={() => { setShowAuth(true); setAuthMode("signup"); }}>Start free →</button>
              <button className="ghost-btn" onClick={() => heroEmailRef.current?.scrollIntoView({ behavior:"smooth" })}>Get daily pick by email</button>
            </div>
            {modelRecord?.total > 0 && (
              <div style={{ display:"inline-flex",gap:28,background: "#10131a",border:"1px solid #242832",borderRadius:14,padding:"13px 24px",flexWrap:"wrap",justifyContent:"center" }}>
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
              <h2 style={{ fontSize:"clamp(22px,4.5vw,32px)",fontWeight:600,letterSpacing:-0.3,lineHeight:1.25 }}>Every game. Every edge.<br/>Every morning.</h2>
              <p style={{ color:"#555",fontSize:13,marginTop:10,lineHeight:1.6 }}>Pro members see all picks, full AI breakdowns, and edge scores for every game on the board.</p>
            </div>
            <div className="l-float" style={{ background: "#10131a",border:"1px solid #242832",borderRadius:26,padding:"18px 15px",boxShadow:"0 40px 80px rgba(0,0,0,.6),0 0 0 1px #111" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,padding:"0 3px" }}>
                <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:14,fontWeight:700 }}>T<span style={{ color:"#2FBF71" }}>|</span>T</div>
                <div style={{ display:"flex",gap:8 }}>
                  {["Home","Games","Portfolio"].map(t => (
                    <div key={t} style={{ fontSize:10,color:t==="Home"?"#2FBF71":"#3d424f",fontWeight:700 }}>{t}</div>
                  ))}
                </div>
              </div>
              {/* Live free pick */}
              {freePick && (
                <div className="pick-card" style={{ marginBottom:8,borderColor:"rgba(47,191,113,.35)" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:7 }}>
                    <span style={{ fontSize:10,color:"#555" }}>7:05 PM CT</span>
                    <span style={{ background:"rgba(47,191,113,.1)",color:"#2FBF71",fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:5,letterSpacing:1 }}>
                      {freePick.filter?.verdict === "CLEAN" ? "Value Pick" : "Solid Pick"}
                    </span>
                  </div>
                  <div style={{ display:"flex",gap:7,marginBottom:7 }}>
                    {[{ side:"AWAY",team:freePick.awayTeam,odds:freePick.awayOdds,isPick:freePick.pick===freePick.awayTeam },
                      { side:"HOME",team:freePick.homeTeam,odds:freePick.homeOdds,isPick:freePick.pick===freePick.homeTeam }].map(({ side,team,odds,isPick }) => (
                      <div key={side} style={{ flex:1,background: "#15171d",border:"1px solid #242832",borderRadius:7,padding:"7px 9px",textAlign:side==="HOME"?"right":"left" }}>
                        <div style={{ fontSize:9,color:"#555",marginBottom:2 }}>{side}</div>
                        <div style={{ fontSize:12,fontWeight:700,color:isPick?"#2FBF71":"#fff" }}>{team?.split(" ").pop()}</div>
                        <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#555",marginTop:1 }}>{odds!=null?fmtOddsL(odds):"—"}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ background:"rgba(47,191,113,.05)",border:"1px solid rgba(47,191,113,.1)",borderRadius:7,padding:"7px 9px" }}>
                    <div style={{ fontSize:10,color:"#2FBF71",fontWeight:700,marginBottom:freePick.breakdown?.preview?3:0 }}>
                      Take {freePick.pick?.split(" ").pop()} · {freePick.edge?.toFixed(1)}% edge
                    </div>
                    {freePick.breakdown?.preview && <div style={{ fontSize:10,color:"#555",lineHeight:1.5 }}>{freePick.breakdown.preview.slice(0,80)}…</div>}
                  </div>
                </div>
              )}
              {/* Blurred mock picks */}
              {MOCK_PICKS.slice(0, freePick ? 3 : 4).map((p, i) => (
                <div key={i} className={`pick-card l-blur`} style={{ marginBottom:8,opacity:p.blur?.7:1 }}>
                  {p.blur && <div className="blur-mask"><div className="lock-badge" style={{ display:"flex", alignItems:"center", gap:6 }}><LockIcon size={11} /> PRO ONLY</div></div>}
                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:5 }}>
                    <span style={{ fontSize:10,color:"#444" }}>{p.sport}</span>
                    {!p.blur && p.verdict && <span style={{ background:p.verdict==="CLEAN"?"rgba(47,191,113,.1)":"rgba(214,178,61,.1)",color:p.verdict==="CLEAN"?"#2FBF71":"#D6B23D",fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:5,letterSpacing:1 }}>{p.verdict==="CLEAN"?"Value":"Solid"}</span>}
                  </div>
                  <div style={{ fontSize:12,fontWeight:700,filter:p.blur?"blur(6px)":"none" }}>{p.away} @ {p.home}</div>
                  {!p.blur && <div style={{ fontSize:10,color:"#2FBF71",marginTop:3 }}>Take {p.pick} {p.odds} · {p.edge}</div>}
                  {p.blur && <div style={{ display:"flex",gap:6,marginTop:5,filter:"blur(5px)" }}><div className="shimmer-line" style={{ height:7,width:"55%" }}/><div className="shimmer-line" style={{ height:7,width:"30%" }}/></div>}
                </div>
              ))}
              <div style={{ marginTop:10,background:"rgba(47,191,113,.05)",border:"1px solid rgba(47,191,113,.1)",borderRadius:11,padding:"11px",textAlign:"center" }}>
                <div style={{ fontSize:11,color:"#2FBF71",fontWeight:700,marginBottom:3 }}>Unlock all picks for $2/mo</div>
                <div style={{ fontSize:10,color:"#444" }}>Full breakdowns · edge scores · parlay builder</div>
              </div>
            </div>
          </section>

          <div className="l-glow" style={{ maxWidth:860,margin:"0 auto" }} />

          {/* HOW IT WORKS */}
          <section style={{ padding:"72px 20px",maxWidth:760,margin:"0 auto" }}>
            <div style={{ marginBottom:36 }}>
              <h2 style={{ fontSize:"clamp(24px,5vw,38px)",fontWeight:600,letterSpacing:-0.3 }}>Built different from the jump</h2>
              <p style={{ color:"#555",fontSize:14,marginTop:10,maxWidth:440,lineHeight:1.6 }}>A multi-layer AND-gate filter, tuned per sport. Every condition must pass — one failure means PASS.</p>
            </div>
            <div>
              {[
                { tag:"MLB DATA LAYER", title:"Pitcher-first analysis",   body:"Starter ERA, WHIP, innings pitched, and sample size. Plus bullpen ERA and K/9 for the full game — starters get the spotlight, bullpens finish ~40% of outs." },
                { tag:"NFL DATA LAYER", title:"Matchup + EPA",            body:"Team offensive/defensive efficiency (EPA per play), recent form, and Elo ratings feed the model's win probability for moneyline, spread, and total." },
                { tag:"BOTH SPORTS",    title:"Market edge scoring",       body:"We compare our model's win probability to the book's implied probability. Only plays with a verified edge after market calibration pass. No phantom edges." },
                { tag:"MLB DATA LAYER", title:"Park + lineup context",     body:"Every MLB pick accounts for park factor, lineup OPS vs pitcher hand, and recent form over the last 10 games. Coors isn't Petco." },
                { tag:"VERDICT",       title:"CLEAN / BET / PASS tiers",  body:"CLEAN passes every condition in the AND-gate. BET passes most. PASS is the honest answer when there's no edge. Some days are zero-bet days — that's correct." },
                { tag:"TRACKER",       title:"Personal tracker + P&L",    body:"Every pick you save — MLB or NFL — auto-resolves. Real-time P&L in dollars based on your unit size. See your actual edge over time, not just win-loss." },
                { tag:"AI",            title:"Claude AI breakdowns",      body:"Every MLB pick has a 2-sentence preview, key deciding factor, main risk, and honest lean. NFL picks show the same underlying model reasoning as plain-English bullets." },
              ].map(({ tag, title, body }, i) => (
                <div key={title} className="feature-card" style={{ display:"flex", gap:20, textAlign:"left" }}>
                  <div style={{ fontFamily:tokens.font.display, fontSize:20, color:"#3d424f", flexShrink:0, width:32 }}>{String(i + 1).padStart(2,"0")}</div>
                  <div>
                    <div style={{ fontSize:10,color:"#2FBF71",fontWeight:700,letterSpacing:1.5,marginBottom:6 }}>{tag}</div>
                    <div style={{ fontSize:15,fontWeight:600,marginBottom:6 }}>{title}</div>
                    <div style={{ fontSize:13,color:"#555",lineHeight:1.65 }}>{body}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="l-glow" style={{ maxWidth:860,margin:"0 auto" }} />

          {/* US VS VEGAS */}
          <section style={{ padding:"72px 20px",maxWidth:860,margin:"0 auto" }}>
            <div style={{ textAlign:"center",marginBottom:44 }}>
              <h2 style={{ fontSize:"clamp(26px,6vw,44px)",fontWeight:600,letterSpacing:-0.3,lineHeight:1.15 }}>Us <span style={{ color:"#2FBF71" }}>{'>'}</span> Vegas</h2>
              <p style={{ color:"#555",fontSize:14,marginTop:12,maxWidth:440,margin:"12px auto 0" }}>The book's built-in juice means you need to hit 52.4% just to break even. We aim higher.</p>
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12,marginBottom:32 }}>
              {[
                { label:"Break-even needed",    us:modelRecord?.pct?`${modelRecord.pct}%`:"—",   them:"52.4%", sub:"win rate" },
                { label:"Model edge per pick",  us:modelRecord?.avgEdge?`+${modelRecord.avgEdge}%`:"+3–5%", them:"0%", sub:"vs vig" },
                { label:"Filter layers",         us:"6-layer",  them:"1-layer",  sub:"AND-gate" },
                { label:"Pick transparency",     us:"Full",     them:"None",     sub:"every condition shown" },
              ].map(({ label, us, them, sub }) => (
                <div key={label} className="stat-card">
                  <div style={{ fontSize:10,color:"#444",letterSpacing:1,marginBottom:10 }}>{label.toUpperCase()}</div>
                  <div style={{ display:"flex",gap:10,alignItems:"flex-end" }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:10,color:"#2FBF71",fontWeight:700,letterSpacing:1,marginBottom:2 }}>T|T</div>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:700,color:"#2FBF71" }}>{us}</div>
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:10,color:"#444",fontWeight:700,letterSpacing:1,marginBottom:2 }}>VEGAS</div>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:700,color:"#3d424f" }}>{them}</div>
                    </div>
                  </div>
                  <div style={{ fontSize:11,color:"#333947",marginTop:6 }}>{sub}</div>
                </div>
              ))}
            </div>
            <div style={{ textAlign:"center",background:"#15171d",border:"1px solid #242832",borderRadius:12,padding:"14px 20px" }}>
              <div style={{ fontSize:12,color:"#333947",lineHeight:1.6 }}>Sports betting carries extreme variance — MLB and NFL alike. Even 60% pickers lose stretches. This is a tool for finding edges, not a guarantee. Bet responsibly.</div>
            </div>
          </section>

          <div className="l-glow" style={{ maxWidth:860,margin:"0 auto" }} />

          {/* PRICING + EMAIL CTA */}
          <section style={{ padding:"72px 20px",maxWidth:820,margin:"0 auto",textAlign:"center" }}>
            <h2 style={{ fontSize:"clamp(26px,5vw,40px)",fontWeight:600,letterSpacing:-0.3,lineHeight:1.15,marginBottom:12 }}>Sharp picks shouldn't<br/>cost sharp money.</h2>
            <p style={{ color:"#555",fontSize:14,marginBottom:40 }}>Start free. Go pro when you're ready.</p>

            <div style={{ display:"flex",gap:14,justifyContent:"center",flexWrap:"wrap",marginBottom:48 }}>
              {/* Free */}
              <div style={{ background:"#15171d",border:"1px solid #242832",borderRadius:20,padding:"26px 24px",flex:"1 1 200px",maxWidth:260,textAlign:"left" }}>
                <div style={{ fontSize:12,color:"#555",fontWeight:700,marginBottom:8,letterSpacing:1 }}>FREE</div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:34,fontWeight:700,marginBottom:3 }}>$0</div>
                <div style={{ fontSize:12,color:"#444",marginBottom:22 }}>forever</div>
                {["1 free pick daily","Email digest every morning","Model record public stats"].map(f => (
                  <div key={f} style={{ display:"flex",gap:8,alignItems:"center",padding:"7px 0",borderBottom:"1px solid #1c1f26",fontSize:12,color:"#666" }}><span style={{ color:"#3d424f" }}>✓</span>{f}</div>
                ))}
                <button className="ghost-btn" style={{ marginTop:18,width:"100%",fontSize:13,padding:"11px" }} onClick={() => { setShowAuth(true); setAuthMode("signup"); }}>Get started free</button>
              </div>
              {/* Pro monthly */}
              <div style={{ background:"rgba(47,191,113,.04)",border:"1px solid rgba(47,191,113,.35)",borderRadius:20,padding:"26px 24px",flex:"1 1 200px",maxWidth:260,textAlign:"left" }}>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8 }}>
                  <div style={{ fontSize:12,color:"#2FBF71",fontWeight:700,letterSpacing:1 }}>PRO MONTHLY</div>
                  <div style={{ fontSize:10,color:"#555",fontWeight:600,letterSpacing:0.5 }}>Most popular</div>
                </div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:34,fontWeight:700,marginBottom:3,color:"#2FBF71" }}>$2</div>
                <div style={{ fontSize:12,color:"#555",marginBottom:22 }}>per month</div>
                {["All picks + full breakdowns","Edge scores + variance data","CLEAN / BET / PASS filter","Parlay builder (CLEAN only)","Personal tracker + P&L"].map(f => (
                  <div key={f} style={{ display:"flex",gap:8,alignItems:"center",padding:"7px 0",borderBottom:"1px solid rgba(47,191,113,.06)",fontSize:12,color:"#888" }}><span style={{ color:"#2FBF71" }}>✓</span>{f}</div>
                ))}
                <button className="cta-btn" style={{ marginTop:18,width:"100%",fontSize:14 }} onClick={() => { setShowAuth(true); setAuthMode("signup"); }}>Start for $2/mo →</button>
              </div>
              {/* Annual */}
              <div style={{ background:"#15171d",border:"1px solid #242832",borderRadius:20,padding:"26px 24px",flex:"1 1 200px",maxWidth:260,textAlign:"left" }}>
                <div style={{ fontSize:12,color:"#555",fontWeight:700,marginBottom:8,letterSpacing:1 }}>PRO ANNUAL</div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:34,fontWeight:700,marginBottom:3 }}>$19.99</div>
                <div style={{ fontSize:12,color:"#444",marginBottom:22 }}>$1.67/mo · 2 months free</div>
                {["Everything in Pro Monthly","Best value for the season","Cancel anytime"].map(f => (
                  <div key={f} style={{ display:"flex",gap:8,alignItems:"center",padding:"7px 0",borderBottom:"1px solid #1c1f26",fontSize:12,color:"#666" }}><span style={{ color:"#3d424f" }}>✓</span>{f}</div>
                ))}
                <button className="ghost-btn" style={{ marginTop:18,width:"100%",fontSize:13,padding:"11px" }} onClick={() => { setShowAuth(true); setAuthMode("signup"); }}>Get annual →</button>
              </div>
            </div>

            {/* Email capture */}
            <div className="l-glow" style={{ marginBottom:52 }} />
            <div ref={heroEmailRef} style={{ maxWidth:420,margin:"0 auto" }}>
              <h3 style={{ fontSize:22,fontWeight:800,letterSpacing:-.5,marginBottom:7 }}>Not ready to pay?</h3>
              <p style={{ color:"#555",fontSize:14,marginBottom:22,lineHeight:1.6 }}>Get one sharp pick every morning — free. No account needed.</p>
              {subStatus === "ok" ? (
                <div style={{ background:"rgba(47,191,113,.08)",border:"1px solid rgba(47,191,113,.2)",borderRadius:14,padding:"18px",textAlign:"center" }}>
                  <div style={{ fontSize:18,fontWeight:800,color:"#2FBF71" }}>You're in. ✓</div>
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
                  <input type="email" required placeholder="your@email.com" aria-label="Email address" value={subEmail} onChange={e => setSubEmail(e.target.value)}
                    style={{ flex:1,background: "#12141a",border:"1px solid #242832",borderRadius:12,padding:"13px 15px",color:"#fff",fontSize:14,outline:"none" }} />
                  <button type="submit" disabled={subStatus==="loading"} className="cta-btn" style={{ flexShrink:0,fontSize:14,padding:"13px 18px" }}>
                    {subStatus==="loading" ? "…" : "Send me picks"}
                  </button>
                </form>
              )}
              {subStatus === "err" && <div style={{ fontSize:12,color:"#D9645C",marginTop:7 }}>Something went wrong.</div>}
            </div>
          </section>

          {/* FOOTER */}
          <footer style={{ borderTop:"1px solid #1c1f26",padding:"24px 20px",textAlign:"center" }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace",fontSize:14,fontWeight:700,marginBottom:10 }}>T<span style={{ color:"#2FBF71" }}>|</span>T</div>
            <div style={{ display:"flex",gap:18,justifyContent:"center",flexWrap:"wrap",fontSize:12,color:"#777" }}>
              <button style={{ background:"none",border:"none",color:"#777",cursor:"pointer",fontSize:12 }} onClick={() => { setShowAuth(true); setAuthMode("signin"); }}>Sign In</button>
              <a href="https://twitter.com/ThisorThatPicks" target="_blank" rel="noopener noreferrer" style={{ color:"#777",textDecoration:"none" }}>𝕏 @ThisorThatPicks</a>
              <a href="/privacy" style={{ color:"#777",textDecoration:"none" }}>Privacy</a>
              <a href="/terms" style={{ color:"#777",textDecoration:"none" }}>Terms</a>
            </div>
            <div style={{ fontSize:11,color:"#777",marginTop:12 }}>For entertainment purposes. Bet responsibly.</div>
          </footer>
        </>
      ) : (
        /* ── AUTH VIEW ── */
        <div style={S.page}>
          <style>{css}</style>
          <div style={S.authBox}>
            <button onClick={() => setShowAuth(false)} style={{ background:"none",border:"none",color:"#777",fontSize:13,cursor:"pointer",alignSelf:"flex-start",marginBottom:8,padding:0,display:"inline-flex",alignItems:"center",gap:4 }}><ChevronLeftIcon size={13} /> Back</button>
            <div style={S.logo}>T<span style={{ color:"#2FBF71" }}>|</span>T</div>
            <div style={S.authSub}>{authMode === "signin" ? "Sign in to see all picks" : "Create your free account"}</div>
            <button style={S.googleBtn} onClick={signInGoogle}><GoogleIcon /> Continue with Google</button>
            <div style={S.orRow}>
              <div style={S.orLine} />
              <span style={{ color:"#777",fontSize:12,padding:"0 10px" }}>or</span>
              <div style={S.orLine} />
            </div>
            <input style={S.input} type="email" placeholder="Email" aria-label="Email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
            <input style={S.input} type="password" placeholder="Password" aria-label="Password" autoComplete={authMode === "signin" ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)} />
            {authError && <div style={S.errMsg} role="alert">{authError}</div>}
            <button style={S.primaryBtn} onClick={authMode === "signin" ? signIn : signUp} disabled={authLoading}>
              {authLoading ? "…" : authMode === "signin" ? "Sign In" : "Create Account"}
            </button>
            <div style={S.switchRow}>
              {authMode === "signin" ? "No account? " : "Have an account? "}
              <button type="button" style={{ background:"none",border:"none",padding:0,fontFamily:"inherit",fontSize:"inherit",color:"#2FBF71",cursor:"pointer" }} onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setAuthError(""); }}>
                {authMode === "signin" ? "Sign up" : "Sign in"}
              </button>
            </div>
            <div style={{ fontSize:10,color:"#777",textAlign:"center",lineHeight:1.7,marginTop:4 }}>
              For entertainment only · Not gambling advice · 21+{" · "}
              <a href="/terms" style={{ color:"#777" }}>Terms</a>{" · "}
              <a href="/privacy" style={{ color:"#777" }}>Privacy</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (isPro === null) return (
    <div style={{ minHeight: "100vh", background: "#0a0b0f", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
      <style>{css}</style>
      <div style={S.spinner} />
      {activatingPro && <div style={{ color: "#2FBF71", fontSize: 13, fontWeight: 600 }}>Activating your account…</div>}
    </div>
  );


  return (
    <div style={S.app}>
      <style>{css}</style>

      {showInstallPrompt && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={() => setShowInstallPrompt(false)}>
          <div style={{ width: "100%", maxWidth: 500, background: "#12141a", borderRadius: "24px 24px 0 0", border: "1px solid #242832", borderBottom: "none", padding: "0 0 max(24px, env(safe-area-inset-bottom)) 0", animation: "slideUp 0.3s cubic-bezier(0.32,0.72,0,1)" }}
            role="dialog" aria-modal="true" aria-label="Install app"
            onClick={e => e.stopPropagation()}>
            {/* Drag handle */}
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: "#2b2f3a" }} />
            </div>
            <div style={{ padding: "16px 24px 24px" }}>
              {/* App identity row */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
                <div style={{ width: 56, height: 56, background: "#0a0b0f", borderRadius: 14, border: "1px solid #242832", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 700, color: "#fff", flexShrink: 0, letterSpacing: -1 }}>
                  T<span style={{ color: "#2FBF71" }}>|</span>T
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 17, color: "#fff", letterSpacing: -0.3 }}>ToT Picks</div>
                  <div style={{ fontSize: 12, color: "#777", marginTop: 2, fontFamily: "'JetBrains Mono',monospace" }}>thisthatpicks.com</div>
                </div>
                <button onClick={() => setShowInstallPrompt(false)} aria-label="Close" style={{ background: "#242832", border: "none", borderRadius: "50%", width: 28, height: 28, color: "#999", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><CloseIcon size={14} /></button>
              </div>

              {installPlatform === "android" ? (
                <>
                  <div style={{ fontSize: 14, color: "#999", marginBottom: 20, lineHeight: 1.5 }}>
                    Install for instant access from your home screen — no browser, no address bar.
                  </div>
                  <button
                    style={{ width: "100%", background: "#2FBF71", color: "#000", border: "none", borderRadius: 14, padding: "15px 0", fontWeight: 800, fontSize: 15, letterSpacing: 0.3, marginBottom: 12 }}
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
                  <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 20, background: "#15171d", borderRadius: 14, border: "1px solid #1c1f26", overflow: "hidden" }}>
                    {[
                      { step: "1", label: "Tap the", bold: "Share", after: " button in Safari", icon: "↑" },
                      { step: "2", label: "Select", bold: "Add to Home Screen", after: "", icon: "+" },
                      { step: "3", label: "Tap", bold: "Add", after: " to confirm", icon: "✓" },
                    ].map(({ step, label, bold, after, icon }, i) => (
                      <div key={step} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderTop: i > 0 ? "1px solid #1c1f26" : "none" }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: "#1b1e26", border: "1px solid #1e1e1e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#2FBF71", flexShrink: 0, fontWeight: 700 }}>{icon}</div>
                        <div style={{ fontSize: 14, color: "#666", lineHeight: 1.4 }}>
                          {label} <span style={{ color: "#fff", fontWeight: 600 }}>{bold}</span>{after}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button style={{ width: "100%", background: "#2FBF71", color: "#000", border: "none", borderRadius: 14, padding: "15px 0", fontWeight: 800, fontSize: 15, letterSpacing: 0.3, marginBottom: 12 }}
                    onClick={() => setShowInstallPrompt(false)}>
                    Got it
                  </button>
                </>
              )}
              <button type="button" style={{ width: "100%", background: "none", border: "none", fontFamily: "inherit", textAlign: "center", fontSize: 13, color: "#777", cursor: "pointer", padding: "4px 0" }}
                onClick={() => { localStorage.setItem("tot-pwa-dismissed", String(Date.now())); setShowInstallPrompt(false); }}>
                Don't show again
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={S.nav}>
        <div style={S.navLogo}>T<span style={{ color: "#2FBF71" }}>|</span>T</div>
        <button
          onClick={() => setSearchOpen(true)}
          aria-label="Search"
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#888", display: "flex", alignItems: "center" }}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </div>

      {/* nflPicks now lives inside components/NFLSection.js (not lifted to this
          parent) — NFL games no longer surface in search results, MLB + tracker still do. */}
      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        picks={picks}
        savedPicks={savedPicks}
        onTeamClick={openTeam}
        onPlayerClick={openPlayer}
        getAuthHeaders={getAuthHeaders}
      />

      {/* Carousel — cycles between free pick, model record, and promo */}
      <div style={S.carousel}>
        {slide.type === "free-pick" && (
          <>
            <div style={S.carouselTag}>FREE PICK</div>
            {freePick ? (
              <>
                <div style={S.carouselMatchup}><TeamMatchupLink sport="mlb" awayTeam={freePick.awayTeam} homeTeam={freePick.homeTeam} onPick={openTeam} /></div>
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
                  <span style={{ color: "#2FBF71" }}>{modelRecord.wins}</span>
                  <span style={{ color: "#888" }}>-</span>
                  <span style={{ color: "#D9645C" }}>{modelRecord.losses}</span>
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
            <div style={{ fontSize: 11, color: "#2FBF71", marginTop: 6 }}>CLEAN = all conditions passed</div>
          </>
        )}
        <div style={{ display: "flex", gap: 5, marginTop: 10 }}>
          {carouselSlides.map((_, i) => (
            <button key={i} type="button" aria-label={`Go to slide ${i + 1}`} style={{ width: 5, height: 5, borderRadius: "50%", background: carouselIdx % carouselSlides.length === i ? "#2FBF71" : "#242832", border: "none", padding: 0, cursor: "pointer" }}
              onClick={() => setCarouselIdx(i)} />
          ))}
        </div>
      </div>

      {(activeTab === "picks" || activeTab === "steals" || activeTab === "parlay" || activeTab === "nfl" || activeTab === "props") && (
        <div ref={dateScrollRef} style={S.dateScroll}>
          {weekDates.map(date => (
            <button
              key={date}
              ref={date === todayStr ? todayBtnRef : null}
              style={{
                ...S.dateBtn,
                borderColor: selectedDate === date ? "#2FBF71" : "#3d424f",
                color: selectedDate === date ? "#2FBF71" : "#999",
                background: selectedDate === date ? "rgba(47,191,113,0.08)" : "#181b22",
              }}
              onClick={() => setSelectedDate(date)}
            >
              {fmtDateLabel(date)}
            </button>
          ))}
        </div>
      )}

      {navGroup(activeTab) === "games" && (
      <div style={{ display: "flex", padding: "8px 20px 0", borderBottom: `1px solid ${tokens.color.border}` }}>
        {[
          { id: "mlb", icon: "⚾", label: "MLB", color: "#2FBF71", tab: "picks" },
          { id: "nfl", icon: "🏈", label: "NFL", color: "#D9754A", tab: "nfl" },
        ].map(({ id, icon, label, color, tab }) => {
          const active = id === "nfl" ? activeTab === "nfl" : activeTab !== "nfl";
          return (
            <button
              key={id}
              onClick={() => setActiveTab(tab)}
              style={{
                ...tabButtonStyle({ active, accent: color }),
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 4px",
              }}
            >
              <span style={{ fontSize: 14 }}>{icon}</span>
              {label}
            </button>
          );
        })}
      </div>
      )}

      {navGroup(activeTab) === "games" && activeTab !== "nfl" && (
      <div style={S.subNav}>
        <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
          {[
            { id: "picks", label: "Picks" },
            { id: "live", label: "Live" },
            { id: "feed", label: "Feed" },
            { id: "steals", label: "Steals" },
            { id: "schedule", label: "Schedule" },
            { id: "chat", label: "Ask AI" },
            ...(isBeta ? [
              { id: "props", label: "Trending" },
            ] : []),
          ].map(({ id, label }) => (
            <button
              key={id}
              style={{ ...tabButtonStyle({ active: activeTab === id }), flexShrink: 0 }}
              onClick={() => {
                if (!isPro && ["steals", "live", "feed", "props"].includes(id)) { setUpgradeModal(true); return; }
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
                style={iconButtonStyle({ active: sortBy === s2 })}
                onClick={() => setSortBy(s2)}
                title={s2 === "edge" ? "Sort by edge" : "Sort by time"}
              >
                {s2 === "edge" ? <TrendingUpIcon size={14} /> : <ClockIcon size={14} />}
              </button>
            ))}
            <button
              style={iconButtonStyle({})}
              onClick={() => fetchPicks(selectedDate, true)}
              title="Refresh picks"
            ><RefreshIcon size={14} /></button>
            {isAdmin && (
              <button
                style={{ ...iconButtonStyle({ active: generating }), fontSize: 11 }}
                onClick={generatePicks}
                disabled={generating}
                title="Force-generate picks for today + tomorrow"
              >{generating ? "…" : "Gen"}</button>
            )}
            <button
              style={iconButtonStyle({ active: teamSearchOpen })}
              onClick={() => { if (teamSearchOpen) { clearTeamSearch(); } else setTeamSearchOpen(true); }}
              title="Search by team"
            ><SearchIcon size={14} /></button>
          </div>
        )}
      </div>
      )}

      {navGroup(activeTab) === "portfolio" && (
      <div style={S.subNav}>
        <div style={{ display: "flex", gap: 6 }}>
          {[
            { id: "tracker", label: "Tracker" },
            { id: "parlay", label: "Parlay" },
            { id: "record", label: "Record" },
          ].map(({ id, label }) => (
            <button
              key={id}
              style={tabButtonStyle({ active: activeTab === id })}
              onClick={() => {
                if (!isPro && ["tracker", "parlay"].includes(id)) { setUpgradeModal(true); return; }
                setActiveTab(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      )}

      {activeTab === "picks" && teamSearchOpen && (
        <div style={{ padding: "10px 20px", borderBottom: "1px solid #242832", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#15171d", border: "1px solid #333947", borderRadius: 10, padding: "8px 12px" }}>
            <span aria-hidden="true" style={{ flexShrink: 0, color: "#555", display: "inline-flex" }}><SearchIcon size={14} /></span>
            <input
              autoFocus
              type="text"
              placeholder="Search team — e.g. Yankees, Dodgers, Red Sox…"
              aria-label="Search team"
              value={teamQuery}
              onChange={e => setTeamQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && teamSuggestions.length === 1) fetchTeamSchedule(teamSuggestions[0]); if (e.key === "Escape") clearTeamSearch(); }}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 14, minWidth: 0 }}
            />
            {teamQuery.length > 0 && (
              <button onClick={() => { setTeamQuery(""); setTeamView(null); }} aria-label="Clear search" style={{ background: "none", border: "none", color: "#555", fontSize: 16, cursor: "pointer", flexShrink: 0, padding: 0, display: "inline-flex" }}><CloseIcon size={14} /></button>
            )}
          </div>
          {teamSuggestions.length > 0 && !teamViewLoading && !teamView && (
            <div style={{ position: "absolute", left: 20, right: 20, top: "calc(100% - 10px)", background: "#181b22", border: "1px solid #333947", borderRadius: 10, zIndex: 50, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.6)" }}>
              {teamSuggestions.map(t => (
                <button
                  key={t}
                  onClick={() => fetchTeamSchedule(t)}
                  style={{ width: "100%", padding: "11px 14px", background: "none", border: "none", color: "#ccc", fontSize: 14, textAlign: "left", cursor: "pointer", borderBottom: "1px solid #242832", display: "flex", alignItems: "center", gap: 10 }}
                >
                  <span aria-hidden="true" style={{ fontSize: 12 }}>⚾</span>
                  {t}
                </button>
              ))}
            </div>
          )}
          {teamViewLoading && (
            <div style={{ fontSize: 12, color: "#555", marginTop: 8, textAlign: "center" }}>Loading schedule…</div>
          )}
        </div>
      )}

      <div style={S.content}>
        {activeTab === "picks" && teamView && (() => {
          const { team, games = [] } = teamView;
          const todayStr2 = new Date().toISOString().slice(0, 10);
          // Get the team's record from the most recent game that has standings
          const recordGame = [...games].reverse().find(g => {
            const norm = s => (s || "").toLowerCase();
            return norm(g.homeTeam).includes(norm(team).split(" ").pop()) ? g.homeRecord
              : norm(g.awayTeam).includes(norm(team).split(" ").pop()) ? g.awayRecord : null;
          });
          const teamRecord = recordGame
            ? (recordGame.homeTeam.toLowerCase().includes(team.toLowerCase().split(" ").pop())
                ? recordGame.homeRecord : recordGame.awayRecord)
            : null;

          const verdictColor = v => ({ CLEAN: "#2FBF71", BET: "#D6B23D", PASS: "#555", TRAP: "#D9645C" })[v] || "#555";
          const verdictLabel = v => ({ CLEAN: "CLEAN", BET: "BET", PASS: "PASS", TRAP: "TRAP" })[v] || v || "—";

          return (
            <div style={{ background: "#12141a", border: "1px solid #242832", borderRadius: 14, overflow: "hidden", marginBottom: 4 }}>
              <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: games.length > 0 ? "1px solid #242832" : "none" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{team}</div>
                  {teamRecord && <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{teamRecord} · {games.length} game{games.length !== 1 ? "s" : ""} this week</div>}
                  {!teamRecord && <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{games.length} game{games.length !== 1 ? "s" : ""} this week</div>}
                </div>
                <button onClick={() => { setTeamView(null); setTeamQuery(""); }} aria-label="Close" style={{ background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer", padding: "0 4px", display: "inline-flex" }}><CloseIcon size={15} /></button>
              </div>
              {games.length === 0 && (
                <div style={{ padding: "16px 14px", fontSize: 13, color: "#555" }}>No games found for {team} this week.</div>
              )}
              {games.map((g, i) => {
                const isHome = g.homeTeam.toLowerCase().includes(team.toLowerCase().split(" ").pop());
                const opponent = isHome ? g.awayTeam : g.homeTeam;
                const opponentRecord = isHome ? g.awayRecord : g.homeRecord;
                const teamOdds = isHome ? g.homeOdds : g.awayOdds;
                const fmtOdds = o => o == null ? "—" : o > 0 ? `+${o}` : `${o}`;
                const verdict = g.filter?.verdict;
                const dateObj = new Date(g.date + "T12:00:00");
                const isToday = g.date === todayStr2;
                const isFuture = g.date > todayStr2;
                const dateLabel = isToday ? "Today" : dateObj.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                const liveStatus = g.liveScore?.status;
                const scoreStr = liveStatus === "Live" || liveStatus === "Final"
                  ? (isHome ? `${g.liveScore.homeScore ?? ""}–${g.liveScore.awayScore ?? ""}` : `${g.liveScore.awayScore ?? ""}–${g.liveScore.homeScore ?? ""}`)
                  : null;
                const gameTime = g.commenceTime
                  ? new Date(g.commenceTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })
                  : null;

                return (
                  <button
                    key={g.date + g.homeTeam}
                    onClick={() => { setSelectedDate(g.date); setTeamView(null); setTeamQuery(""); setTeamSearchOpen(false); }}
                    style={{ width: "100%", background: "none", border: "none", borderBottom: i < games.length - 1 ? "1px solid #111" : "none", padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}
                  >
                    <div style={{ width: 48, flexShrink: 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: isToday ? "#2FBF71" : isFuture ? "#777" : "#444", letterSpacing: 0.5 }}>{dateLabel}</div>
                      {gameTime && !scoreStr && <div style={{ fontSize: 10, color: "#3d424f", marginTop: 1 }}>{gameTime}</div>}
                      {scoreStr && <div style={{ fontSize: 10, color: liveStatus === "Final" ? "#555" : "#D6B23D", marginTop: 1 }}>{liveStatus === "Final" ? "Final" : "LIVE"}</div>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#ccc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {isHome ? "vs " : "@ "}{opponent.split(" ").pop()}
                        {opponentRecord && <span style={{ fontSize: 10, color: "#444", fontWeight: 400, marginLeft: 5 }}>{opponentRecord}</span>}
                      </div>
                      {scoreStr && <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#888", marginTop: 1 }}>{scoreStr}</div>}
                    </div>
                    {verdict && (
                      <div style={{ fontSize: 10, fontWeight: 800, color: verdictColor(verdict), flexShrink: 0, letterSpacing: 0.5 }}>{verdictLabel(verdict)}</div>
                    )}
                    {teamOdds != null && (
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#666", flexShrink: 0, minWidth: 36, textAlign: "right" }}>{fmtOdds(teamOdds)}</div>
                    )}
                    <span style={{ color: "#3d424f", fontSize: 12, flexShrink: 0 }}>›</span>
                  </button>
                );
              })}
            </div>
          );
        })()}

        {activeTab === "picks" && selectedDate === todayStr && modelStreak?.last7 && (modelStreak.last7.wins + modelStreak.last7.losses) > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#10131a", border: "1px solid #242832", borderRadius: 10, padding: "9px 13px" }}>
            <span style={{ fontSize: 11, color: "#555", letterSpacing: 1 }}>LAST 7 DAYS</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700, color: modelStreak.last7.wins > modelStreak.last7.losses ? "#2FBF71" : modelStreak.last7.wins < modelStreak.last7.losses ? "#D9645C" : "#888" }}>
              {modelStreak.last7.wins}–{modelStreak.last7.losses}
            </span>
            <span style={{ fontSize: 11, color: "#444" }}>
              {(() => { const t = modelStreak.last7.wins + modelStreak.last7.losses; const pct = Math.round(modelStreak.last7.wins / t * 100); return `${pct}% this week`; })()}
            </span>
          </div>
        )}

        {activeTab === "picks" && selectedDate === todayStr && picks?.some(p => p.isLock) && (() => {
          const lock = picks.find(p => p.isLock);
          const lockOdds = lock.pick === lock.homeTeam ? lock.homeOdds : lock.awayOdds;
          const fmtO = o => o == null ? "" : o > 0 ? `+${o}` : `${o}`;
          return (
            <div style={{ background: "rgba(47,191,113,0.05)", border: "1px solid rgba(47,191,113,0.3)", borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: "#2FBF71", letterSpacing: 2, display: "inline-flex", alignItems: "center", gap: 5 }}><LockIcon size={11} /> LOCK OF THE DAY</span>
                {lock.filter?.verdict && (
                  <span style={{ fontSize: 10, fontWeight: 800, color: "#000", background: "#2FBF71", padding: "2px 8px", borderRadius: 20, letterSpacing: 1 }}>{lock.filter.verdict}</span>
                )}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
                <TeamMatchupLink sport="mlb" awayTeam={lock.awayTeam} homeTeam={lock.homeTeam} onPick={openTeam} />
              </div>
              <div style={{ fontSize: 13, color: "#2FBF71", fontWeight: 700, marginBottom: 4 }}>
                Take {lock.pick} {fmtO(lockOdds)}
                {lock.edge != null && <span style={{ fontSize: 11, color: "#555", fontWeight: 400, marginLeft: 8 }}>+{lock.edge.toFixed(1)}% edge</span>}
              </div>
              {lock.breakdown?.preview && (
                <div style={{ fontSize: 12, color: "#555", lineHeight: 1.6, marginTop: 6 }}>{lock.breakdown.preview.slice(0, 140)}</div>
              )}
            </div>
          );
        })()}

        {activeTab === "picks" && modelStreak?.streak >= 3 && (
          <div style={{ background: modelStreak.streakType === "win" ? "rgba(47,191,113,0.06)" : "rgba(217,100,92,0.06)", border: `1px solid ${modelStreak.streakType === "win" ? "rgba(47,191,113,0.2)" : "rgba(217,100,92,0.2)"}`, borderRadius: 10, padding: "9px 13px", marginBottom: 6, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>{modelStreak.streakType === "win" ? "🔥" : "📉"}</span>
            <div>
              <span style={{ fontSize: 12, fontWeight: 700, color: modelStreak.streakType === "win" ? "#2FBF71" : "#D9645C" }}>
                {modelStreak.streak}-day {modelStreak.streakType === "win" ? "win" : "loss"} streak
              </span>
              {modelStreak.last7 && (
                <span style={{ fontSize: 11, color: "#555", marginLeft: 8 }}>
                  ({modelStreak.last7.wins}–{modelStreak.last7.losses} last 7 days)
                </span>
              )}
            </div>
          </div>
        )}

        {activeTab === "picks" && modelRecord?.total > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0 4px", flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: "#777", letterSpacing: 1 }}>MODEL RECORD</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 700, color: modelRecord.pct == null ? "#888" : modelRecord.pct >= 55 ? "#2FBF71" : modelRecord.pct >= 50 ? "#D6B23D" : "#D9645C" }}>
              {modelRecord.wins}-{modelRecord.losses}
            </span>
            <span style={{ fontSize: 11, color: "#888" }}>({modelRecord.pct}%)</span>
            <span style={{ fontSize: 10, color: "#2b2f3a" }}>all-time</span>
          </div>
        )}

        {activeTab === "picks" && picks?.length > 0 && (() => {
          const nBet   = picks.filter(p => p.isBet).length;
          const nClean = picks.filter(p => p.filter?.verdict === "CLEAN").length;
          const nPass  = picks.filter(p => !p.isBet).length;
          const quietDay = isPro && nBet === 0 && picks.filter(p => p.filter != null).length > 0;
          return (
            <>
              <div style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid #1c1f26", marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: "#777" }}>{picks.filter(p => p.filter != null).length} games</span>
                {nBet > 0 && <span style={{ fontSize: 11, color: "#2FBF71" }}>{nBet} BET</span>}
                {nClean > 0 && <span style={{ fontSize: 11, color: "#2FBF71", fontWeight: 700 }}>{nClean} CLEAN</span>}
                <span style={{ fontSize: 11, color: "#555" }}>{nPass} PASS</span>
              </div>
              {quietDay && (
                <div style={{ background: "rgba(214,178,61,0.04)", border: "1px solid rgba(214,178,61,0.12)", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#D6B23D" }}>Quiet day — no bets pass the filter</div>
                  <div style={{ fontSize: 11, color: "#555", marginTop: 3 }}>All games are PASS or TRAP. Best picks shown below as leans only. Skipping is the correct play.</div>
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
              const accentColor = isEdge ? "#2FBF71" : "#D6B23D";
              const borderColor = isEdge ? "rgba(47,191,113,0.25)" : "rgba(214,178,61,0.18)";
              return (
                <div style={{ ...S.card, borderColor }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: accentColor, fontWeight: 700, letterSpacing: 1.5 }}>
                      {isEdge ? "TODAY'S FREE PICK" : "TODAY'S LEAN"}
                    </div>
                    {isEdge ? (
                      freePick.filter?.verdict === "CLEAN"
                        ? <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 9px", borderRadius: 5, letterSpacing: 1.5, background: "rgba(47,191,113,0.15)", color: "#2FBF71", border: "1px solid rgba(47,191,113,0.3)" }}>CLEAN</span>
                        : <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 9px", borderRadius: 5, letterSpacing: 1.5, background: "rgba(47,191,113,0.08)", color: "#2FBF71", border: "1px solid rgba(47,191,113,0.2)" }}>BET</span>
                    ) : (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 9px", borderRadius: 5, background: "rgba(214,178,61,0.08)", color: "#D6B23D", border: "1px solid rgba(214,178,61,0.2)" }}>LEAN</span>
                    )}
                  </div>
                  <div style={S.cardMatchup}><TeamMatchupLink sport="mlb" awayTeam={freePick.awayTeam} homeTeam={freePick.homeTeam} onPick={openTeam} /></div>
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
              <div style={{ ...S.card, textAlign: "center", padding: "28px 16px", borderColor: "#242832" }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Quiet day</div>
                <div style={{ fontSize: 13, color: "#555", marginTop: 5, lineHeight: 1.5 }}>
                  No games worth highlighting today.<br/>The model doesn't force picks — zero bets is correct.
                </div>
              </div>
            ) : (
              <div style={{ ...S.card, textAlign: "center", padding: "28px 16px" }}>
                <div style={{ fontWeight: 700 }}>Loading today's pick…</div>
              </div>
            )}
            {[
              { away: "Yankees", home: "Red Sox",   verdict: "CLEAN", pick: "Yankees", odds: "-118", edge: "4.2" },
              { away: "Dodgers", home: "Padres",    verdict: "BET",   pick: "Dodgers", odds: "-132", edge: "3.1" },
              { away: "Astros",  home: "Rangers",   verdict: "BET",   pick: "Rangers", odds: "+104", edge: "2.7" },
            ].map((p, i) => (
              <button key={i} type="button" aria-label="Pro only — tap to upgrade" style={{ ...S.card, display: "block", width: "100%", fontFamily: "inherit", textAlign: "left", position: "relative", overflow: "hidden", cursor: "pointer" }}
                onClick={() => setUpgradeModal(true)}>
                <div style={{ position: "absolute", inset: 0, backdropFilter: "blur(5px)", background: "rgba(0,0,0,0.5)", zIndex: 2, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ background: "rgba(0,0,0,0.9)", border: "1px solid #2b2f3a", borderRadius: 10, padding: "8px 18px", textAlign: "center" }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#2FBF71", letterSpacing: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><LockIcon size={12} /> PRO ONLY</div>
                    <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>Tap to upgrade</div>
                  </div>
                </div>
                <div style={{ filter: "blur(6px)", pointerEvents: "none", userSelect: "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5, background: p.verdict === "CLEAN" ? "rgba(47,191,113,0.15)" : "rgba(47,191,113,0.08)", color: "#2FBF71", border: "1px solid rgba(47,191,113,0.3)" }}>{p.verdict === "CLEAN" ? "CLEAN" : "BET"}</span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#555" }}>+{p.edge}% edge</span>
                  </div>
                  <div style={S.cardMatchup}>{p.away} @ {p.home}</div>
                  <div style={S.cardMeta}>Take <span style={{ color: "#2FBF71" }}>{p.pick}</span> {p.odds}</div>
                </div>
              </button>
            ))}
            <button type="button" style={{ width: "100%", background: "rgba(47,191,113,0.05)", border: "1px solid rgba(47,191,113,0.15)", borderRadius: 12, padding: "16px", textAlign: "center", cursor: "pointer", fontFamily: "inherit" }}
              onClick={() => setUpgradeModal(true)}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#2FBF71", marginBottom: 4 }}>Unlock all picks for $2/mo</div>
              <div style={{ fontSize: 12, color: "#555" }}>Full breakdowns · edge scores · parlay builder</div>
            </button>
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
              <div style={{ color: "#fff", fontWeight: 700 }}>Could not load games</div>
              <div style={{ color: "#777", fontSize: 13, marginTop: 4 }}>{picksError}</div>
              <button style={{ ...S.saveBtn, marginTop: 14 }} onClick={() => fetchPicks(selectedDate, true)}>Retry</button>
            </div>
          ) : sorted.length === 0 ? (
            <div style={S.center}>
              <div style={{ color: "#fff", fontWeight: 700 }}>No games found</div>
              <div style={{ color: "#777", fontSize: 13, marginTop: 4 }}>Try a different date</div>
              {picksDiagnostic && (
                <div style={{ color: "#555", fontSize: 11, marginTop: 10, fontFamily: "'JetBrains Mono',monospace", maxWidth: 280 }}>
                  {fmtDiagnostic(picksDiagnostic)}
                </div>
              )}
            </div>
          ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10, alignItems: "start" }}>
          {sorted.map(pick => {
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

            const betColor  = "#2FBF71";
            const passColor = "#3d424f";
            const isScheduled = pick.homeOdds == null && !pick.filter && pick.tier?.emoji === "📅";
            const resultBorderColor = pickResult === "win" ? "#2FBF71" : pickResult === "loss" ? "#D9645C" : null;
            const cardBorder = resultBorderColor || (isOpen ? (isBet ? betColor : "#333947") : (isBet ? "rgba(47,191,113,0.25)" : isScheduled ? "rgba(79,195,247,0.15)" : "#242832"));

            return (
              <div key={pick.id} style={{ ...S.card, borderColor: cardBorder, gridColumn: isOpen ? "1 / -1" : undefined, cursor: isOpen ? "default" : "pointer" }} onClick={isOpen ? undefined : () => setExpanded(pick.id)}>
              {(() => {
                const badgeRow = (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    {isLock && (
                      <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5, background: "rgba(214,178,61,0.15)", color: "#D6B23D", border: "1px solid rgba(214,178,61,0.5)" }}>
                        LOCK
                      </span>
                    )}
                    {pick.homeOdds == null && !pick.filter ? (
                      isScheduled ? (
                        <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5, background: "rgba(79,195,247,0.1)", color: "#4FC3F7", border: "1px solid rgba(79,195,247,0.3)" }}>
                          SCHEDULED
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5, background: "rgba(60,60,60,0.4)", color: "#555", border: "1px solid #2b2f3a" }}>
                          NO LINE
                        </span>
                      )
                    ) : pick.filter?.verdict === "CLEAN" ? (
                      <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5, background: "rgba(47,191,113,0.15)", color: "#2FBF71", border: "1px solid rgba(47,191,113,0.5)" }}>
                        CLEAN
                      </span>
                    ) : (
                      <span style={{
                        fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5,
                        background: isBet ? "rgba(47,191,113,0.08)" : "rgba(50,50,50,0.5)",
                        color: isBet ? betColor : passColor,
                        border: `1px solid ${isBet ? "rgba(47,191,113,0.2)" : "#2b2f3a"}`,
                      }}>
                        {isBet ? "BET" : "PASS"}
                      </span>
                    )}
                  </div>
                );
                const matchupEl = (
                  <TeamMatchupLink
                    sport="mlb" awayTeam={pick.awayTeam} homeTeam={pick.homeTeam} onPick={openTeam}
                    awayLabel={<>{pick.awayTeam?.split(" ").pop()}{pick.awayRecord && <span style={{ fontSize: 11, color: "#555", fontWeight: 400, marginLeft: 4, whiteSpace: "nowrap" }}>({pick.awayRecord})</span>}</>}
                    homeLabel={<>{pick.homeTeam?.split(" ").pop()}{pick.homeRecord && <span style={{ fontSize: 11, color: "#555", fontWeight: 400, marginLeft: 4, whiteSpace: "nowrap" }}>({pick.homeRecord})</span>}</>}
                  />
                );
                const saveBtnEl = (
                  <button
                    style={{ ...S.saveBtn, background: isSaved ? "#2FBF71" : "transparent", color: isSaved ? "#000" : "#2FBF71", borderColor: "#2FBF71", flexShrink: 0 }}
                    onClick={(e) => { e.stopPropagation(); savePick(pick); }}
                  >
                    {isSaved ? <><CheckIcon size={12} /> Saved</> : "+ Save"}
                  </button>
                );

                return !isOpen ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      {badgeRow}
                      {saveBtnEl}
                    </div>
                    <div style={{ ...S.cardMatchup, marginTop: 6 }}>{matchupEl}</div>
                  </>
                ) : (
                <div style={S.cardTop}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {badgeRow}
                    <div style={S.cardMatchup}>{matchupEl}</div>
                    <div style={S.cardMeta}>
                      {fmtGameTime(pick.commenceTime)}
                      {pick.pick && <> · {isScheduled ? <span style={{ color: "#4FC3F7" }}>Preview</span> : pick.homeOdds == null && !pick.filter ? "Lean" : "Take"} <span style={{ color: isBet ? betColor : isScheduled ? "#4FC3F7" : "#aaa", fontWeight: 700 }}>{pick.pick?.split(" ").pop()}</span></>}
                      {!pick.pick && <span style={{ color: "#444" }}> · No line posted</span>}
                      {isBet && pick.homeOdds != null && <span style={{ color: "#888", fontFamily: "'JetBrains Mono',monospace" }}> · {fmtOdds(pick.pick === pick.homeTeam ? pick.homeOdds : pick.awayOdds)}</span>}
                    </div>
                    <WinPctRow homeTeam={pick.homeTeam} awayTeam={pick.awayTeam} homeOdds={pick.homeOdds} awayOdds={pick.awayOdds} openHomeOdds={pick.openHomeOdds} openAwayOdds={pick.openAwayOdds} />
                    <div style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 7 }}>
                      <div style={{ flex: 1, height: 3, background: "#181b22", borderRadius: 2 }}>
                        <div style={{ height: "100%", borderRadius: 2, width: `${Math.min(100, edge * 6)}%`, background: isBet ? t.color : "#2b2f3a", transition: "width 0.5s ease" }} />
                      </div>
                      {pick.filter && <span style={{ fontSize: 10, color: isBet ? t.color : "#3d424f", fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{edge.toFixed(1)}%</span>}
                    </div>
                    {ls?.status === "Live" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#D9645C", animation: "pulse 1s infinite" }} />
                        <span style={{ fontSize: 12, color: "#D9645C", fontWeight: 700 }}>LIVE</span>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{pick.awayTeam} {ls.awayScore} · {pick.homeTeam} {ls.homeScore}</span>
                        <span style={{ fontSize: 11, color: "#888" }}>{ls.inningHalf} {ls.inning}</span>
                      </div>
                    )}
                    {ls?.status === "Final" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                        {pickResult && (
                          <span style={{
                            fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5,
                            background: pickResult === "win" ? "rgba(47,191,113,0.12)" : pickResult === "loss" ? "rgba(217,100,92,0.12)" : "rgba(214,178,61,0.08)",
                            color: pickResult === "win" ? "#2FBF71" : pickResult === "loss" ? "#D9645C" : "#D6B23D",
                            border: `1px solid ${pickResult === "win" ? "rgba(47,191,113,0.3)" : pickResult === "loss" ? "rgba(217,100,92,0.3)" : "rgba(214,178,61,0.3)"}`,
                          }}>
                            {pickResult === "win" ? "WIN" : pickResult === "loss" ? "LOSS" : "TIE"}
                          </span>
                        )}
                        <span style={{ fontSize: 12, color: "#888" }}>
                          Final · {pick.awayTeam} {ls.awayScore} – {pick.homeTeam} {ls.homeScore}
                        </span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
                    {saveBtnEl}
                    {pick.homeOdds != null && (() => {
                      const inParlay = parlayLegs.has(pick.id);
                      return (
                        <button
                          style={{ ...S.saveBtn, background: inParlay ? "rgba(214,178,61,0.12)" : "transparent", color: inParlay ? "#D6B23D" : "#3d424f", borderColor: inParlay ? "#D6B23D" : "#2b2f3a" }}
                          onClick={() => setParlayLegs(prev => { const n = new Map(prev); inParlay ? n.delete(pick.id) : n.set(pick.id, { game: pick, teamPick: pick.pick }); return n; })}
                        >
                          {inParlay ? <><CheckIcon size={12} /> Parlay</> : "+ Parlay"}
                        </button>
                      );
                    })()}
                    <button
                      style={{ ...S.expandBtn, borderColor: isOpen ? (isBet ? betColor : "#444") : "#2b2f3a", color: isOpen ? (isBet ? betColor : "#444") : "#3d424f" }}
                      onClick={() => setExpanded(isOpen ? null : pick.id)}
                    >
                      {isOpen ? "▲" : "▼"}
                    </button>
                  </div>
                </div>
                );
              })()}
                {isOpen && (
                  <div style={{ animation: "fadeUp 0.2s ease" }}>
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
                    <div style={S.expDivider} />
                    {pick.filter && (() => {
                      const f = pick.filter;
                      const isClean = f.verdict === "CLEAN";
                      const vColor = { CLEAN: "#2FBF71", TRAP: "#D9645C", PASS: "#444" }[f.verdict] || "#444";
                      const vBg    = { CLEAN: "rgba(47,191,113,0.06)", TRAP: "rgba(217,100,92,0.06)", PASS: "rgba(30,30,30,0.6)" }[f.verdict] || "transparent";
                      const confColor = f.confidence >= 8 ? "#2FBF71" : f.confidence >= 6 ? "#D6B23D" : "#D9645C";
                      return (
                        <div style={{ ...S.expSection, background: vBg, borderRadius: 10, padding: 12, border: `1px solid ${vColor}33`, marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 11, fontWeight: 800, color: vColor, letterSpacing: 1.5 }}>{f.verdict}</span>
                              {f.isSquareLine && <span style={{ fontSize: 9, color: "#888", letterSpacing: 1 }}>SOFT LINE</span>}
                              {f.lineSignal === "confirming" && <span style={{ fontSize: 9, color: "#2FBF71" }}>↑ LINE</span>}
                              {f.lineSignal === "contra"     && <span style={{ fontSize: 9, color: "#D9645C" }}>↓ LINE</span>}
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
                              <div style={{ fontSize: 11, fontWeight: 700, color: f.variance === "HIGH" ? "#D9645C" : f.variance === "MED" ? "#D6B23D" : "#2FBF71" }}>{f.variance}</div>
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
                                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: f.uncertaintyPct > 10 ? "#D9645C" : f.uncertaintyPct > 6 ? "#D6B23D" : "#2FBF71" }}>±{f.uncertaintyPct}%</div>
                              </div>
                            )}
                            {f.snr != null && (
                              <div>
                                <div style={{ fontSize: 9, color: "#888", letterSpacing: 1 }}>SNR</div>
                                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: f.snr >= 1.5 ? "#2FBF71" : f.snr >= 1.0 ? "#D6B23D" : "#D9645C" }}>{f.snr}×</div>
                              </div>
                            )}
                            {f.parkFactor !== 0 && (
                              <div>
                                <div style={{ fontSize: 9, color: "#888", letterSpacing: 1 }}>PARK</div>
                                <div style={{ fontSize: 11, color: f.parkFactor >= 1.0 ? "#D9645C" : f.parkFactor <= -0.3 ? "#2FBF71" : "#888" }}>{f.parkFactor > 0 ? "+" : ""}{f.parkFactor}R</div>
                              </div>
                            )}
                          </div>
                          {(f.failures || []).length > 0 && (
                            <div style={{ marginTop: 4 }}>
                              <div style={{ fontSize: 9, color: "#888", letterSpacing: 1, marginBottom: 4 }}>FAILED CONDITIONS</div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                {f.failures.map((fail, i) => (
                                  <span key={i} style={{ fontSize: 10, color: "#FF6B6B", background: "rgba(217,100,92,0.08)", padding: "2px 6px", borderRadius: 4 }}>✗ {fail}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {isClean && !f.halfSize && (
                            <div style={{ marginTop: 4, fontSize: 10, color: "#2FBF71" }}>✓ All conditions passed — disciplined bet</div>
                          )}
                          {isClean && f.halfSize && (
                            <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
                              <div style={{ fontSize: 10, color: "#2FBF71" }}>✓ All conditions passed — disciplined bet</div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#D6B23D", background: "rgba(214,178,61,0.08)", border: "1px solid rgba(214,178,61,0.25)", borderRadius: 6, padding: "3px 8px", display: "inline-block" }}>
                                ⚠ HALF SIZE — pick-side bullpen ERA &gt;6.00, variance elevated
                              </div>
                            </div>
                          )}
                          {(() => {
                            const reasons = translateReasons(f.confidenceReasons, "mlb").slice(0, 5);
                            const pickOdds = pick.pick === pick.homeTeam ? pick.homeOdds : pick.awayOdds;
                            const betNow = pick.modelProb != null ? shouldBetNow(pickOdds, pick.modelProb / 100) : null;
                            return (
                              <>
                                {reasons.length > 0 && (
                                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                                    <div style={{ fontSize: 9, color: "#888", letterSpacing: 1, marginBottom: 6 }}>WHY THIS SCORE</div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                      {reasons.map((r, i) => (
                                        <div key={i} style={{ fontSize: 11, color: "#ccc", display: "flex", gap: 6 }}>
                                          <span style={{ color: r.sign === "-" ? "#D9645C" : "#2FBF71", flexShrink: 0 }}>{r.sign === "-" ? "✗" : "✓"}</span>
                                          <span>{r.text}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {betNow && (
                                  <div style={{ marginTop: 10, background: "#181b22", borderRadius: 8, padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <div style={{ fontSize: 10, color: "#888" }}>
                                      Current <b style={{ color: "#ccc" }}>{fmtOdds(betNow.currentOdds)}</b> · Fair <b style={{ color: "#ccc" }}>{fmtOdds(betNow.fairOdds)}</b>
                                    </div>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: betNow.verdict === "bet" ? "#2FBF71" : "#D6B23D" }}>
                                      {betNow.verdict === "bet" ? "Bet Now" : "Wait"}
                                    </div>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      );
                    })()}
                    <div style={S.expSection}>
                      <div style={S.expLabel}>RECENT FORM</div>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                        <span style={{ color: "#2FBF71", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{pick.homeTeam} →</span>
                        <span style={S.expText}>{b.form_home || "—"}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <span style={{ color: "#D9645C", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{pick.awayTeam} →</span>
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
                        <div style={S.expLabel}>WHAT YOU'RE SWEATING</div>
                        <div style={{ ...S.expText, color: "#D6B23D" }}>{b.what_to_sweat}</div>
                      </div>
                    )}
                    {b.honest_lean && (
                      <div style={{ ...S.expSection, background: "#12141a", borderRadius: 10, padding: 12, border: "1px solid #242832" }}>
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
                      style={{ marginTop: 12, width: "100%", background: "transparent", border: "1px solid #242832", borderRadius: 10, padding: "9px 0", color: "#777", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                      onClick={() => {
                        const odds = pick.pick === pick.homeTeam ? pick.homeOdds : pick.awayOdds;
                        const fmtO = o => o == null ? "" : o > 0 ? ` (+${o})` : ` (${o})`;
                        const text = `${pick.awayTeam} @ ${pick.homeTeam}\nTake ${pick.pick}${fmtO(odds)} — ${pick.edge?.toFixed(1)}% edge\n\nthisthatpicks.com | @ThisorThatPicks`;
                        if (navigator.share) {
                          navigator.share({ text, url: "https://thisthatpicks.com" }).catch(() => {});
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
          })}
          </div>
          )
        )}

        {activeTab === "picks" && isPro && parlayLegs.size >= 2 && (
          <button
            style={{ width: "100%", marginTop: 4, padding: "10px 14px", background: "rgba(214,178,61,0.06)", border: "1px solid rgba(214,178,61,0.2)", borderRadius: 12, color: "#D6B23D", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
            onClick={() => setActiveTab("parlay")}
          >
            <span>{parlayLegs.size}-leg parlay ready</span>
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
              <div style={{ color: "#fff", fontWeight: 700 }}>No CLEAN bets {fmtDateLabel(selectedDate)}</div>
              <div style={{ color: "#777", fontSize: 13, marginTop: 4 }}>All conditions must pass — discipline wins long-term</div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#2FBF71", letterSpacing: 2 }}>
                  {steals.length} CLEAN BET{steals.length !== 1 ? "S" : ""} — ALL CONDITIONS PASSED
                </div>
                <button
                  onClick={copySteals}
                  style={{ fontSize: 11, color: copied ? "#2FBF71" : "#3d424f", background: "transparent", border: "1px solid #242832", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace" }}
                >
                  {copied ? <><CheckIcon size={12} /> Copied</> : "Copy"}
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
                  <div key={pick.id} style={{ ...S.card, borderColor: "rgba(47,191,113,0.35)" }}>
                    <div style={S.cardTop}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5, background: "rgba(47,191,113,0.12)", color: "#2FBF71", border: "1px solid rgba(47,191,113,0.3)" }}>
                            BET
                          </span>
                          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#999" }}>
                            +{(f.trueEdgePct || 0).toFixed(1)}% edge
                          </span>
                          <span style={{ fontSize: 10, color: "#2FBF71", opacity: 0.7 }}>
                            {f.confidence}/10 conf
                          </span>
                        </div>
                        <div style={S.cardMatchup}><TeamMatchupLink sport="mlb" awayTeam={pick.awayTeam} homeTeam={pick.homeTeam} onPick={openTeam} /></div>
                        <div style={S.cardMeta}>
                          {fmtGameTime(pick.commenceTime)} · Take <span style={{ color: "#2FBF71", fontWeight: 700 }}>{pick.pick}</span> {fmtOdds(pickOdds)}
                        </div>
                        <WinPctRow homeTeam={pick.homeTeam} awayTeam={pick.awayTeam} homeOdds={pick.homeOdds} awayOdds={pick.awayOdds} openHomeOdds={pick.openHomeOdds} openAwayOdds={pick.openAwayOdds} />
                      </div>
                      <button
                        style={{ ...S.saveBtn, background: isSaved ? "#2FBF71" : "transparent", color: isSaved ? "#000" : "#2FBF71", borderColor: "#2FBF71" }}
                        onClick={() => savePick(pick)}
                      >
                        {isSaved ? <><CheckIcon size={12} /> Saved</> : "+ Save"}
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
                        <div style={{ ...S.statVal, color: "#2FBF71" }}>{f.variance}</div>
                      </div>
                      {f.uncertaintyPct != null && (
                        <div style={S.statBox}>
                          <div style={S.statLabel}>UNCERTAINTY</div>
                          <div style={{ ...S.statVal, color: f.uncertaintyPct > 10 ? "#D9645C" : f.uncertaintyPct > 6 ? "#D6B23D" : "#2FBF71" }}>±{f.uncertaintyPct}%</div>
                        </div>
                      )}
                    </div>
                    {parseFloat(kellyPct) > 0 && (
                      <div style={{ marginTop: 10, background: "#050505", border: "1px solid #242832", borderRadius: 8, padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ fontSize: 9, color: "#777", letterSpacing: 1 }}>SUGGESTED STAKE</div>
                          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, fontWeight: 700, color: "#2FBF71" }}>{kellyPct}% of bankroll</div>
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
                    { label: "SAFE", legs: steals.slice(0, 2), color: "#2FBF71" },
                    { label: "BALANCED", legs: steals.slice(0, 3), color: "#D6B23D" },
                    { label: "AGGRESSIVE", legs: steals.slice(0, 4), color: "#D9645C" },
                  ].filter(c => c.legs.length >= 2).filter((c, i, arr) => i === 0 || c.legs.length > arr[i - 1].legs.length).map(card => {
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
                      <div key={card.label} style={{ background: "#10131a", border: `1px solid ${card.color}22`, borderRadius: 12, padding: "12px 14px", marginBottom: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: card.color, letterSpacing: 1 }}>{card.label} — {card.legs.length}-LEG</span>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 700, color: card.color }}>{comboAmerican}</div>
                            <div style={{ fontSize: 10, color: "#777" }}>${payout10} profit on $10</div>
                          </div>
                        </div>
                        {card.legs.map((leg, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: i < card.legs.length - 1 ? "1px solid #111" : "none" }}>
                            <TeamMatchupLink sport="mlb" awayTeam={leg.awayTeam} homeTeam={leg.homeTeam} onPick={openTeam} style={{ fontSize: 12, fontFamily: "'JetBrains Mono',monospace" }} />
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 11, color: "#2FBF71", fontWeight: 700 }}>{leg.pick}</span>
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
                <div style={{ background: "#10131a", border: "1px solid rgba(214,178,61,0.2)", borderRadius: 14, padding: 16, marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#999", letterSpacing: 1.5, marginBottom: 4 }}>COMBINED ODDS</div>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 28, fontWeight: 700, color: parlayLegsList.length >= 2 ? "#D6B23D" : "#3d424f" }}>{parlayAmerican}</div>
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
                          style={{ width: 70, background: "#181b22", border: "1px solid #2b2f3a", borderRadius: 6, color: "#fff", fontSize: 15, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, padding: "4px 8px", textAlign: "right" }}
                        />
                      </div>
                      {parlayLegsList.length >= 2 && (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 16, fontWeight: 700, color: "#2FBF71" }}>${(parseFloat(parlayProfit) + parlayStake).toFixed(2)}</div>
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
                          <TeamMatchupLink sport="mlb" awayTeam={game.awayTeam} homeTeam={game.homeTeam} onPick={openTeam} style={{ fontSize: 11, color: "#999" }} />
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#D6B23D" }}>{teamPick}{o != null ? ` ${fmtOdds(o)}` : ""}</div>
                        </div>
                        <button
                          style={{ fontSize: 11, color: "#D9645C", background: "transparent", border: "1px solid #242832", borderRadius: 6, padding: "4px 10px", cursor: "pointer", flexShrink: 0 }}
                          onClick={() => setParlayLegs(prev => { const n = new Map(prev); n.delete(game.id); return n; })}
                        aria-label="Close"><CloseIcon size={13} /></button>
                      </div>
                    );
                  })}
                  {parlayLegsList.length >= 2 && (
                    <button
                      style={{ width: "100%", marginTop: 10, padding: "8px 0", background: "transparent", border: "1px solid #242832", borderRadius: 8, color: "#777", fontSize: 11, cursor: "pointer" }}
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
                    <div key={game.id} style={{ ...S.card, borderColor: leg ? "rgba(214,178,61,0.25)" : "#242832", marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: "#999", marginBottom: 8 }}>
                        {fmtGameTime(game.commenceTime)}
                        {game.isBet && <span style={{ color: "#2FBF71", fontWeight: 700, marginLeft: 6 }}>BET ↑</span>}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          style={{ flex: 1, padding: "10px 8px", borderRadius: 10, border: `1px solid ${awaySel ? "#D6B23D" : "#242832"}`, background: awaySel ? "rgba(214,178,61,0.1)" : "transparent", cursor: "pointer", textAlign: "left" }}
                          onClick={() => selectSide(game.awayTeam)}
                        >
                          <div style={{ fontSize: 10, color: "#999", marginBottom: 3 }}>AWAY</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: awaySel ? "#D6B23D" : "#fff" }}>{game.awayTeam.split(" ").pop()}</div>
                          {game.awayOdds != null && <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: awaySel ? "#D6B23D" : "#555", marginTop: 2 }}>{fmtOdds(game.awayOdds)}</div>}
                        </button>
                        <div style={{ display: "flex", alignItems: "center", fontSize: 11, color: "#2b2f3a", flexShrink: 0 }}>@</div>
                        <button
                          style={{ flex: 1, padding: "10px 8px", borderRadius: 10, border: `1px solid ${homeSel ? "#D6B23D" : "#242832"}`, background: homeSel ? "rgba(214,178,61,0.1)" : "transparent", cursor: "pointer", textAlign: "right" }}
                          onClick={() => selectSide(game.homeTeam)}
                        >
                          <div style={{ fontSize: 10, color: "#999", marginBottom: 3 }}>HOME</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: homeSel ? "#D6B23D" : "#fff" }}>{game.homeTeam.split(" ").pop()}</div>
                          {game.homeOdds != null && <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: homeSel ? "#D6B23D" : "#555", marginTop: 2 }}>{fmtOdds(game.homeOdds)}</div>}
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
            <div style={{ background: "#10131a", border: "1px solid #242832", borderRadius: 14, padding: "16px 16px 12px", marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#777", letterSpacing: 1, marginBottom: 4 }}>PROFIT / LOSS</div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 28, fontWeight: 700, color: pnl >= 0 ? "#2FBF71" : "#D9645C" }}>
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
                      style={{ width: 60, background: "#181b22", border: "1px solid #2b2f3a", borderRadius: 6, color: "#fff", fontSize: 14, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, padding: "4px 8px", textAlign: "right" }}
                    />
                  </div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                <div style={S.statCard}><div style={{ ...S.statVal, color: "#2FBF71", fontSize: 18 }}>{wins}</div><div style={S.statLabel}>Wins</div></div>
                <div style={S.statCard}><div style={{ ...S.statVal, color: "#D9645C", fontSize: 18 }}>{losses}</div><div style={S.statLabel}>Losses</div></div>
                <div style={S.statCard}><div style={{ ...S.statVal, fontSize: 18 }}>{decisioned > 0 ? winPct : "—"}%</div><div style={S.statLabel}>Win Rate</div></div>
                <div style={S.statCard}>
                  <div style={{ ...S.statVal, fontSize: 18, color: streakType === "win" ? "#2FBF71" : streakType === "loss" ? "#D9645C" : "#3d424f" }}>
                    {streakLen > 0 ? `${streakType === "win" ? "W" : "L"}${streakLen}` : "—"}
                  </div>
                  <div style={S.statLabel}>Streak</div>
                </div>
              </div>
            </div>
            {savedPicks.length === 0 ? (
              <div style={S.center}>
                <div style={{ color: "#fff", fontWeight: 700 }}>No saved picks yet</div>
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
                                borderColor: snapshot.isDragging ? "#2FBF71" : p.result === "win" ? "rgba(47,191,113,0.2)" : p.result === "loss" ? "rgba(217,100,92,0.2)" : "#242832",
                                marginBottom: 8,
                                ...provided.draggableProps.style,
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flex: 1 }}>
                                  <div {...provided.dragHandleProps} style={{ color: "#444", fontSize: 16, paddingTop: 2, cursor: "grab", userSelect: "none" }}>⠿</div>
                                  <div style={{ flex: 1 }}>
                                    <div style={S.cardMatchup}><TeamMatchupLink sport={p.sport === "nfl" ? "nfl" : "mlb"} awayTeam={p.away_team} homeTeam={p.home_team} onPick={openTeam} /></div>
                                    <div style={S.cardMeta}>Pick: <span style={{ color: "#2FBF71" }}>{p.pick}</span> · {fmtOdds(p.odds)}</div>
                                    <div style={{ fontSize: 11, color: "#777", marginTop: 3 }}>
                                      {new Date(p.commence_time).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                                    </div>
                                  </div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{
                                    ...S.badge,
                                    background: p.result === "win" ? "rgba(47,191,113,0.1)" : p.result === "loss" ? "rgba(217,100,92,0.1)" : p.result === "push" ? "rgba(214,178,61,0.1)" : "rgba(136,136,136,0.1)",
                                    color: p.result === "win" ? "#2FBF71" : p.result === "loss" ? "#D9645C" : p.result === "push" ? "#D6B23D" : "#888",
                                  }}>
                                    {p.result === "push" ? "TIE" : p.result.toUpperCase()}
                                  </span>
                                  <button style={S.trashBtn} aria-label="Delete" onClick={() => deleteSaved(p.id)}><TrashIcon size={13} /></button>
                                </div>
                              </div>
                              {p.result === "pending" && (
                                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                                  <button style={{ ...S.resultBtn, background: "rgba(47,191,113,0.1)", color: "#2FBF71", borderColor: "#2FBF71", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }} onClick={() => markResult(p.id, "win")}><CheckIcon size={13} /> Win</button>
                                  <button style={{ ...S.resultBtn, background: "rgba(217,100,92,0.1)", color: "#D9645C", borderColor: "#D9645C", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }} onClick={() => markResult(p.id, "loss")}><XIcon size={13} /> Loss</button>
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
                                  return <div style={{ marginTop: 10, fontSize: 12, color: "#888", lineHeight: 1.6, borderTop: "1px solid #242832", paddingTop: 10 }}>This game was postponed, cancelled, or ended in a tie — the pick didn't settle and your stake is returned.</div>;
                                }

                                return (
                                  <div style={{ marginTop: 10, borderTop: "1px solid #242832", paddingTop: 10 }}>
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
              <div style={{ background: "#10131a", border: "1px solid #242832", borderRadius: 14, padding: "14px 16px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 10, color: "#888", letterSpacing: 1.5, marginBottom: 4 }}>ALL-TIME MODEL RECORD</div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 700 }}>
                    <span style={{ color: "#2FBF71" }}>{totalW}</span>
                    <span style={{ color: "#777" }}>-</span>
                    <span style={{ color: "#D9645C" }}>{totalL}</span>
                    {winPct !== null && <span style={{ fontSize: 13, color: "#888", marginLeft: 10 }}>{winPct}%</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#777", marginBottom: 4 }}>{Object.keys(calRecord || {}).length} days tracked</div>
                  <button onClick={() => { setCalRecord(null); fetchCalRecord(); }} style={{ background: "none", border: "1px solid #3d424f", borderRadius: 6, color: "#888", fontSize: 10, cursor: "pointer", padding: "3px 8px", display: "inline-flex", alignItems: "center", gap: 4 }}><RefreshIcon size={11} /> Refresh</button>
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
                    : rec.wins > rec.losses ? "rgba(47,191,113,0.15)"
                    : rec.losses > rec.wins ? "rgba(217,100,92,0.15)"
                    : "rgba(214,178,61,0.15)";
                  const borderColor = !hasData ? (isToday ? "#2FBF71" : "#242832")
                    : rec.wins > rec.losses ? "rgba(47,191,113,0.4)"
                    : rec.losses > rec.wins ? "rgba(217,100,92,0.4)"
                    : "rgba(214,178,61,0.4)";
                  const textColor = !hasData ? (isFuture ? "#2b2f3a" : isToday ? "#2FBF71" : "#444")
                    : rec.wins > rec.losses ? "#2FBF71"
                    : rec.losses > rec.wins ? "#D9645C"
                    : "#D6B23D";

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
                {[["#2FBF71", "Win day"], ["#D9645C", "Loss day"], ["#D6B23D", "Split"]].map(([color, label]) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#777" }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: color, opacity: 0.6 }} />
                    {label}
                  </div>
                ))}
              </div>

              {/* ── Calibration analytics ── */}
              {calStats && (calStats.probBuckets?.length > 0 || calStats.confBuckets?.length > 0) && (() => {
                const { probBuckets = [], confBuckets = [], verdictBuckets = [], varianceBuckets = [], avgDelta, total } = calStats;
                const biasColor = avgDelta == null ? "#888" : avgDelta < -10 ? "#D9645C" : avgDelta > 10 ? "#2FBF71" : "#D6B23D";
                const biasLabel = avgDelta == null ? "—" : avgDelta < 0 ? "overconfident" : "underconfident";

                const TH = ({ children }) => (
                  <th style={{ fontSize: 9, color: "#555", fontWeight: 700, letterSpacing: 1, padding: "4px 6px", textAlign: "right", whiteSpace: "nowrap" }}>{children}</th>
                );
                const TD = ({ children, color, left }) => (
                  <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: color || "#888", padding: "5px 6px", textAlign: left ? "left" : "right", borderTop: "1px solid #111" }}>{children}</td>
                );

                return (
                  <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}>
                    {/* Overall bias */}
                    <div style={{ background: "#10131a", border: "1px solid #242832", borderRadius: 12, padding: "12px 14px" }}>
                      <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, fontWeight: 700, marginBottom: 8 }}>OVERALL BIAS</div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 700, color: biasColor }}>
                          {avgDelta != null ? `${avgDelta > 0 ? "+" : ""}${avgDelta}pp` : "—"}
                        </span>
                        <span style={{ fontSize: 12, color: "#555" }}>{biasLabel}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#3d424f", marginTop: 4 }}>{total} resolved bets · delta = actual − predicted</div>
                    </div>

                    {/* Probability calibration */}
                    <div style={{ background: "#10131a", border: "1px solid #242832", borderRadius: 12, padding: "12px 14px" }}>
                      <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, fontWeight: 700, marginBottom: 10 }}>PROBABILITY CALIBRATION</div>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr>
                              <TH>Bucket</TH>
                              <TH>Predicted</TH>
                              <TH>Actual</TH>
                              <TH>Delta</TH>
                              <TH>CLV</TH>
                              <TH>n</TH>
                            </tr>
                          </thead>
                          <tbody>
                            {probBuckets.map(b => {
                              const delta = b.actual != null && b.predicted != null ? parseFloat((b.actual - b.predicted).toFixed(1)) : null;
                              const dc = delta == null ? "#555" : delta < -15 ? "#D9645C" : delta < 0 ? "#D6B23D" : "#2FBF71";
                              return (
                                <tr key={b.label}>
                                  <TD left color="#aaa">{b.label}{b.n < 20 ? " *" : ""}</TD>
                                  <TD>{b.predicted != null ? `${b.predicted}%` : "—"}</TD>
                                  <TD color={b.actual != null ? (b.actual >= (b.predicted || 0) ? "#2FBF71" : "#D9645C") : "#555"}>{b.actual != null ? `${b.actual}%` : "—"}</TD>
                                  <TD color={dc}>{delta != null ? `${delta > 0 ? "+" : ""}${delta}pp` : "—"}</TD>
                                  <TD color={b.avgClv != null ? (b.avgClv >= 0 ? "#2FBF71" : "#D9645C") : "#555"}>{b.avgClv != null ? `${b.avgClv > 0 ? "+" : ""}${b.avgClv}pp` : "—"}</TD>
                                  <TD color={b.n > 0 ? "#666" : "#3d424f"}>{b.n}</TD>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ fontSize: 10, color: "#3d424f", marginTop: 8 }}>* n &lt; 20 — too small to interpret</div>
                    </div>

                    {/* Confidence calibration */}
                    {confBuckets.some(b => b.n > 0) && (
                      <div style={{ background: "#10131a", border: "1px solid #242832", borderRadius: 12, padding: "12px 14px" }}>
                        <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, fontWeight: 700, marginBottom: 10 }}>CONFIDENCE CALIBRATION</div>
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                              <tr>
                                <TH>Confidence</TH>
                                <TH>W-L</TH>
                                <TH>Win%</TH>
                                <TH>Avg CLV</TH>
                                <TH>n</TH>
                              </tr>
                            </thead>
                            <tbody>
                              {confBuckets.filter(b => b.n > 0).map(b => {
                                const losses = b.n - b.wins;
                                return (
                                  <tr key={b.label}>
                                    <TD left color="#aaa">{b.label}</TD>
                                    <TD color="#666">{b.wins}-{losses}</TD>
                                    <TD color={b.actual != null ? (b.actual >= 55 ? "#2FBF71" : b.actual >= 45 ? "#D6B23D" : "#D9645C") : "#555"}>{b.actual != null ? `${b.actual}%` : "—"}</TD>
                                    <TD color={b.avgClv != null ? (b.avgClv >= 0 ? "#2FBF71" : "#D9645C") : "#555"}>{b.avgClv != null ? `${b.avgClv > 0 ? "+" : ""}${b.avgClv}pp` : "—"}</TD>
                                    <TD color="#666">{b.n}</TD>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Verdict & Variance */}
                    {(verdictBuckets.some(b => b.n > 0) || varianceBuckets.length > 0) && (
                      <div style={{ display: "flex", gap: 10 }}>
                        {verdictBuckets.some(b => b.n > 0) && (
                          <div style={{ flex: 1, background: "#10131a", border: "1px solid #242832", borderRadius: 12, padding: "12px 14px" }}>
                            <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, fontWeight: 700, marginBottom: 10 }}>VERDICT</div>
                            {verdictBuckets.filter(b => b.n > 0).map(b => {
                              const pct = b.actual;
                              const pctColor = pct != null ? (pct >= 55 ? "#2FBF71" : pct >= 45 ? "#D6B23D" : "#D9645C") : "#555";
                              return (
                                <div key={b.label} style={{ marginBottom: 8 }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                                    <span style={{ fontSize: 11, color: b.label === "CLEAN" ? "#2FBF71" : "#D6B23D", fontWeight: 700 }}>{b.label}</span>
                                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: pctColor }}>{pct != null ? `${pct}%` : "—"}</span>
                                  </div>
                                  <div style={{ height: 3, background: "#181b22", borderRadius: 2 }}>
                                    <div style={{ height: "100%", borderRadius: 2, width: `${pct || 0}%`, background: pctColor }} />
                                  </div>
                                  <div style={{ fontSize: 10, color: "#3d424f", marginTop: 2 }}>{b.n} bets · {b.wins}W{b.avgClv != null ? ` · CLV ${b.avgClv > 0 ? "+" : ""}${b.avgClv}pp` : ""}</div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {varianceBuckets.length > 0 && (
                          <div style={{ flex: 1, background: "#10131a", border: "1px solid #242832", borderRadius: 12, padding: "12px 14px" }}>
                            <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, fontWeight: 700, marginBottom: 10 }}>VARIANCE</div>
                            {varianceBuckets.map(b => {
                              const pct = b.actual;
                              const pctColor = pct != null ? (pct >= 55 ? "#2FBF71" : pct >= 45 ? "#D6B23D" : "#D9645C") : "#555";
                              return (
                                <div key={b.label} style={{ marginBottom: 8 }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                                    <span style={{ fontSize: 11, color: "#aaa", fontWeight: 700 }}>{b.label} VAR</span>
                                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: pctColor }}>{pct != null ? `${pct}%` : "—"}</span>
                                  </div>
                                  <div style={{ height: 3, background: "#181b22", borderRadius: 2 }}>
                                    <div style={{ height: "100%", borderRadius: 2, width: `${pct || 0}%`, background: pctColor }} />
                                  </div>
                                  <div style={{ fontSize: 10, color: "#3d424f", marginTop: 2 }}>{b.n} bets</div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })()}

        {activeTab === "feed" && (() => {
          const events = feedEvents || [];

          const fmtAgo = (secs) => {
            if (secs < 60) return "just now";
            if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
            return `${Math.floor(secs / 3600)}h ago`;
          };

          const tierColor = t => ({ High: "#2FBF71", Medium: "#D6B23D", Low: "#888" })[t] || "#555";
          const tierLabel = t => ({ High: "CLEAN", Medium: "BET", Low: "LEAN" })[t] || t || "";

          return (
            <div>
              {/* Top picks today */}
              {feedTopPicks.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: 2, marginBottom: 8 }}>MOST TRACKED TODAY</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {feedTopPicks.map((g, i) => (
                      <div key={i} style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 16, fontWeight: 700, color: "#555", minWidth: 20 }}>{i + 1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#ccc" }}>{g.away} @ {g.home}</div>
                          {g.tier && <div style={{ fontSize: 10, color: tierColor(g.tier), marginTop: 2 }}>{tierLabel(g.tier)}</div>}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#2FBF71", flexShrink: 0 }}>{g.count} tracking</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Activity feed */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: 2 }}>LIVE ACTIVITY</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {feedLoading && <div style={{ width: 12, height: 12, border: "2px solid #2b2f3a", borderTopColor: "#2FBF71", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />}
                  <button onClick={fetchFeed} aria-label="Refresh" style={{ background: "none", border: "none", color: "#555", fontSize: 12, cursor: "pointer", padding: 0, display: "inline-flex" }}><RefreshIcon size={13} /></button>
                </div>
              </div>

              {!feedLoading && events.length === 0 && (
                <div style={{ ...S.center, padding: 40 }}>
                  <div style={{ fontSize: 13, color: "#555" }}>No recent activity yet. Be the first to track a pick today.</div>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {events.map((e, i) => {
                  const isHit  = e.type === "hit";
                  const isMiss = e.type === "miss";
                  const isTrack = e.type === "tracked";
                  const color = isHit ? "#2FBF71" : isMiss ? "#D9645C" : "#555";

                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #1c1f26" }}>
                      <span style={{ flexShrink: 0, color, display: "inline-flex" }}>
                        {isHit ? <CheckIcon size={14} /> : isMiss ? <XIcon size={14} /> : <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#555", display: "inline-block" }} />}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: "#ccc", lineHeight: 1.4 }}>
                          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#444" }}>{e.handle} </span>
                          {isTrack && <>tracked <span style={{ color: "#fff", fontWeight: 700 }}>{e.pick}</span>{e.tier && <span style={{ color: tierColor(e.tier), fontSize: 10, marginLeft: 6 }}>{tierLabel(e.tier)}</span>}</>}
                          {isHit && <>hit <span style={{ color: "#2FBF71", fontWeight: 700 }}>{e.pick}</span>{e.pnl != null && <span style={{ color: "#2FBF71", fontWeight: 700, marginLeft: 4 }}>+${e.pnl.toFixed(2)}</span>}</>}
                          {isMiss && <>missed on <span style={{ color: "#D9645C", fontWeight: 700 }}>{e.pick}</span></>}
                        </div>
                        {(e.awayTeam || e.homeTeam) && (
                          <div style={{ fontSize: 10, color: "#3d424f", marginTop: 2 }}>
                            {e.awayTeam?.split(" ").pop()} @ {e.homeTeam?.split(" ").pop()}
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: "#3d424f", flexShrink: 0 }}>{fmtAgo(e.ago)}</div>
                    </div>
                  );
                })}
              </div>

              <div style={{ fontSize: 10, color: "#2b2f3a", textAlign: "center", marginTop: 16 }}>
                All activity is anonymized. Updates every 30s.
              </div>
            </div>
          );
        })()}

        {activeTab === "live" && (() => {
          const games = livePicks || [];
          const fmtO = o => o == null ? "—" : o > 0 ? `+${o}` : `${o}`;
          const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" }) : "";
          const vcol = v => ({ CLEAN: "#2FBF71", BET: "#D6B23D", PASS: "#555", TRAP: "#D9645C" })[v] || "#555";

          const inProgress = games.filter(g => g.liveScore?.status === "Live");
          const upcoming   = games.filter(g => !g.liveScore?.status || g.liveScore.status === "Preview" || g.liveScore.status === "Scheduled");
          const finished   = games.filter(g => g.liveScore?.status === "Final");

          const LiveCard = ({ g }) => {
            const live   = g.liveScore || {};
            const isLive = live.status === "Live";
            const isFin  = live.status === "Final";
            const hs     = live.homeScore ?? "–";
            const as     = live.awayScore ?? "–";
            const modelPick = g.pick;
            const modelWon  = isFin && g.homeOdds != null
              ? (modelPick === g.homeTeam ? (live.homeScore ?? 0) > (live.awayScore ?? 0) : (live.awayScore ?? 0) > (live.homeScore ?? 0))
              : null;
            const verdict = g.filter?.verdict;
            const odds    = modelPick === g.homeTeam ? g.homeOdds : g.awayOdds;
            const isSaved = savedPicks.some(p => p.game_id === g.id);
            const inningLabel = live.inning ? `${live.inningHalf === "top" ? "▲" : "▼"}${live.inning}` : "";

            return (
              <div style={{ background: "#15171d", border: `1px solid ${isLive ? "rgba(214,178,61,0.25)" : isFin ? "#242832" : "#242832"}`, borderRadius: 14, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {isLive && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#D6B23D", display: "inline-block", animation: "pulse 1.5s ease-in-out infinite" }} />}
                    <span style={{ fontSize: 10, fontWeight: 700, color: isLive ? "#D6B23D" : isFin ? "#555" : "#888", letterSpacing: 1.5 }}>
                      {isLive ? `LIVE ${inningLabel}` : isFin ? "FINAL" : fmtTime(g.commenceTime)}
                    </span>
                  </div>
                  {verdict && (
                    <span style={{ fontSize: 10, fontWeight: 800, color: vcol(verdict), letterSpacing: 1 }}>{verdict}</span>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: modelPick === g.awayTeam ? 700 : 400, color: modelPick === g.awayTeam ? "#fff" : "#888" }}>{g.awayTeam.split(" ").pop()}</div>
                    <div style={{ fontSize: 10, color: "#444", marginTop: 1 }}>{g.awayRecord || "away"}</div>
                  </div>
                  {(isLive || isFin) ? (
                    <div style={{ textAlign: "center", minWidth: 64 }}>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 700, letterSpacing: 2 }}>
                        <span style={{ color: (live.awayScore ?? 0) > (live.homeScore ?? 0) ? "#fff" : "#555" }}>{as}</span>
                        <span style={{ color: "#3d424f", margin: "0 4px" }}>·</span>
                        <span style={{ color: (live.homeScore ?? 0) > (live.awayScore ?? 0) ? "#fff" : "#555" }}>{hs}</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ textAlign: "center", minWidth: 48, fontSize: 10, color: "#3d424f" }}>@</div>
                  )}
                  <div style={{ flex: 1, textAlign: "right" }}>
                    <div style={{ fontSize: 13, fontWeight: modelPick === g.homeTeam ? 700 : 400, color: modelPick === g.homeTeam ? "#fff" : "#888" }}>{g.homeTeam.split(" ").pop()}</div>
                    <div style={{ fontSize: 10, color: "#444", marginTop: 1 }}>{g.homeRecord || "home"}</div>
                  </div>
                </div>

                <div style={{ borderTop: "1px solid #242832", marginTop: 10, paddingTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 12 }}>
                    <span style={{ color: "#555" }}>Model: </span>
                    <span style={{ color: "#2FBF71", fontWeight: 700 }}>{modelPick.split(" ").pop()}</span>
                    <span style={{ color: "#444", marginLeft: 6, fontSize: 11 }}>{fmtO(odds)}</span>
                  </div>
                  {isFin && modelWon !== null && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: modelWon ? "#2FBF71" : "#D9645C" }}>
                      {modelWon ? "HIT" : "MISS"}
                    </span>
                  )}
                  {isLive && modelPick && (
                    <span style={{ fontSize: 11, color: "#555" }}>
                      {modelPick === g.homeTeam
                        ? ((live.homeScore ?? 0) > (live.awayScore ?? 0) ? "⬆️ Winning" : (live.homeScore ?? 0) < (live.awayScore ?? 0) ? "⬇️ Losing" : "Even")
                        : ((live.awayScore ?? 0) > (live.homeScore ?? 0) ? "⬆️ Winning" : (live.awayScore ?? 0) < (live.homeScore ?? 0) ? "⬇️ Losing" : "Even")}
                    </span>
                  )}
                  {!isLive && !isFin && isSaved && <span style={{ fontSize: 10, color: "#2FBF71", display: "inline-flex", alignItems: "center", gap: 3 }}><CheckIcon size={11} /> Tracked</span>}
                </div>
              </div>
            );
          };

          return (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>AUTO-REFRESHES EVERY 60s</div>
                {liveLoading && <div style={{ width: 14, height: 14, border: "2px solid #2b2f3a", borderTopColor: "#D6B23D", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />}
                <button onClick={fetchLive} style={{ background: "none", border: "none", color: "#555", fontSize: 12, cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", gap: 4 }}><RefreshIcon size={12} /> Refresh</button>
              </div>

              {!liveLoading && games.length === 0 && (
                <div style={{ ...S.center, padding: 40 }}>
                  <div style={{ fontSize: 14, color: "#555" }}>No games loaded yet. Check back after 10 AM CT when picks drop.</div>
                </div>
              )}

              {inProgress.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#D6B23D", letterSpacing: 2, marginBottom: 8 }}>IN PROGRESS</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {inProgress.map(g => <LiveCard key={g.id} g={g} />)}
                  </div>
                </div>
              )}

              {upcoming.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: 2, marginBottom: 8 }}>UP NEXT</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {upcoming.map(g => <LiveCard key={g.id} g={g} />)}
                  </div>
                </div>
              )}

              {finished.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#444", letterSpacing: 2, marginBottom: 8 }}>FINISHED</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {finished.map(g => <LiveCard key={g.id} g={g} />)}
                  </div>
                </div>
              )}
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
                          style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 8, padding: "7px 13px", color: "#888", fontSize: 12, cursor: "pointer" }}>
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
                      background: m.role === "user" ? "rgba(47,191,113,0.12)" : "#1c1f26",
                      border: `1px solid ${m.role === "user" ? "rgba(47,191,113,0.2)" : "#242832"}`,
                      fontSize: 13, color: m.role === "user" ? "#e0e0e0" : "#ccc", lineHeight: 1.6, whiteSpace: "pre-wrap",
                    }}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div style={{ display: "flex", gap: 4, padding: "8px 4px" }}>
                    {[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#3d424f", animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />)}
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
                  style={{ flex: 1, background: "#12141a", border: "1px solid #242832", borderRadius: 20, padding: "10px 16px", color: "#fff", fontSize: 13, outline: "none" }}
                />
                <button onClick={() => sendChat(chatInput)} disabled={chatLoading || !chatInput.trim()}
                  style={{ background: chatInput.trim() ? "#2FBF71" : "#242832", border: "none", borderRadius: 20, padding: "10px 18px", color: chatInput.trim() ? "#000" : "#444", fontSize: 13, fontWeight: 700, cursor: chatInput.trim() ? "pointer" : "default", transition: "all 0.15s" }}>
                  Send
                </button>
              </div>
            </div>
          );
        })()}

        {activeTab === "home" && (() => {
          // Best bet has to be compared across both sports, not default to
          // MLB just because /api/free-pick only covers MLB (there's no free
          // NFL equivalent — NFL real picks are Pro-only everywhere else too,
          // so free users only ever see the MLB free pick here).
          const nflBets = isPro ? (homeNflPicks || []).filter(p => p.isBet) : [];
          const bestNfl = nflBets.length ? [...nflBets].sort((a, b) => (b.edge || 0) - (a.edge || 0))[0] : null;
          const hasMlbHero = freePick && !freePick._quietDay;
          const useNflHero = bestNfl && (!hasMlbHero || (bestNfl.edge || 0) > (freePick.edge || 0));
          const heroPick = useNflHero ? bestNfl : (hasMlbHero ? freePick : null);
          const heroSport = useNflHero ? "nfl" : "mlb";

          const mlbTop = (picks || []).filter(p => p.isBet && !(heroSport === "mlb" && p.id === heroPick?.id)).map(p => ({ p, sport: "mlb" }));
          const nflTop = nflBets.filter(p => !(heroSport === "nfl" && p.id === heroPick?.id)).map(p => ({ p, sport: "nfl" }));
          const top3 = [...mlbTop, ...nflTop].sort((a, b) => (b.p.edge || 0) - (a.p.edge || 0)).slice(0, 3);

          const isSkip = (p) => !p.isBet && (p.filter?.verdict === "PASS" || p.filter?.verdict === "TRAP");
          const mlbSkipped = (picks || []).filter(p => isSkip(p) && !(heroSport === "mlb" && p.id === heroPick?.id)).map(p => ({ p, sport: "mlb" }));
          const nflSkipped = (homeNflPicks || []).filter(p => isSkip(p) && !(heroSport === "nfl" && p.id === heroPick?.id)).map(p => ({ p, sport: "nfl" }));
          const skipped = [...mlbSkipped, ...nflSkipped];

          return (
          <div style={{ padding: "16px 20px 84px", display: "flex", flexDirection: "column", gap: 20 }}>
            {heroPick ? (
              <DecisionCard pick={heroPick} sport={heroSport} S={S} savePick={savePick} saving={saving} />
            ) : (
              <div style={S.center}>
                <div style={{ color: "#777", fontSize: 13 }}>No standout bet today — check back tomorrow.</div>
              </div>
            )}

            {isPro ? (
              top3.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#999", letterSpacing: 0.5, marginBottom: 10 }}>TOP 3 TODAY</div>
                  <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 2 }}>
                    {top3.map(({ p, sport }) => (
                      <div key={`${sport}-${p.id}`} style={{ width: 220, flexShrink: 0 }}>
                        <DecisionCard pick={p} sport={sport} S={S} savePick={savePick} saving={saving} compact />
                      </div>
                    ))}
                  </div>
                </div>
              )
            ) : (
              <div style={{ ...S.card, borderColor: "rgba(47,191,113,0.2)", textAlign: "center", padding: "20px 16px" }}>
                <div style={{ fontSize: 13, color: "#999", marginBottom: 10 }}>Unlock today's full slate and every Decision Card</div>
                <button style={{ ...S.saveBtn, background: "#2FBF71", color: "#000", borderColor: "#2FBF71" }} onClick={() => setUpgradeModal(true)}>Upgrade to Pro</button>
              </div>
            )}

            {isPro && <SkipSummary picks={skipped} />}

            {isBeta && isPro && trendingProps && trendingProps.length > 0 && (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#999", letterSpacing: 0.5 }}>⚾ MLB TRENDING PROPS</div>
                  <button
                    style={{ background: "transparent", border: "none", color: "#2FBF71", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}
                    onClick={() => setActiveTab("props")}
                  >
                    View all →
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {trendingProps.slice(0, 3).map((pick, i) => (
                    <PropCard key={`${pick.marketType}-${pick.playerId ?? pick.player}-${i}`} pick={pick} S={S} />
                  ))}
                </div>
              </div>
            )}
          </div>
          );
        })()}

        {activeTab === "nfl" && (
          <NFLSection
            S={S}
            getAuthHeaders={getAuthHeaders}
            isPro={isPro}
            isAdmin={isAdmin}
            setUpgradeModal={setUpgradeModal}
            savePick={savePick}
            saving={saving}
            selectedDate={selectedDate}
            onTeamClick={openTeam}
          />
        )}

        {activeTab === "schedule" && (
          <ScheduleSection S={S} getAuthHeaders={getAuthHeaders} onTeamClick={openTeam} />
        )}

        {activeTab === "settings" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 14, padding: "16px 18px" }}>
              <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, fontWeight: 700, marginBottom: 10 }}>ACCOUNT</div>
              <div style={{ fontSize: 14, color: "#fff", marginBottom: 6 }}>{user?.email}</div>
              <span style={{
                display: "inline-block", fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, letterSpacing: 0.5,
                background: isPro ? "rgba(47,191,113,0.1)" : "rgba(136,136,136,0.1)",
                color: isPro ? "#2FBF71" : "#888",
                border: `1px solid ${isPro ? "rgba(47,191,113,0.3)" : "#3d424f"}`,
              }}>
                {isPro ? "PRO" : "FREE"}
              </span>
            </div>

            <div style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 14, padding: "16px 18px" }}>
              <AccuracyPanel savedPicks={savedPicks} />
            </div>
            <a href="https://twitter.com/ThisorThatPicks" target="_blank" rel="noopener noreferrer"
              style={{ display: "block", textAlign: "center", padding: "10px 12px", fontSize: 13, color: "#1DA1F2", textDecoration: "none" }}>
              𝕏 @ThisorThatPicks
            </a>

            <div style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 14, padding: "16px 18px" }}>
              <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, fontWeight: 700, marginBottom: 10 }}>PREFERENCES</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 13, color: "#ccc" }}>Unit size</div>
                  <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>Used for Tracker P&L and the cancel-flow summary</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 13, color: "#999" }}>$</span>
                  <input
                    type="number"
                    value={unitSize}
                    onChange={e => setUnitSize(Math.max(1, parseInt(e.target.value) || 10))}
                    style={{ width: 64, background: "#181b22", border: "1px solid #2b2f3a", borderRadius: 6, color: "#fff", fontSize: 14, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, padding: "6px 8px", textAlign: "right" }}
                  />
                </div>
              </div>
            </div>

            <div style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 14, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, fontWeight: 700, marginBottom: 2 }}>BILLING</div>
              {isPro ? (
                <>
                  <button style={{ ...S.saveBtn, textAlign: "left", padding: "10px 12px" }} onClick={changePlan}>Change Plan</button>
                  <button style={{ ...S.saveBtn, textAlign: "left", padding: "10px 12px", color: "#D9645C", borderColor: "rgba(217,100,92,0.3)" }} onClick={manageBilling}>Cancel Subscription</button>
                </>
              ) : (
                <button style={{ ...S.saveBtn, textAlign: "left", padding: "10px 12px", background: "#2FBF71", color: "#000", borderColor: "#2FBF71" }} onClick={() => setUpgradeModal(true)}>Upgrade to Pro</button>
              )}
            </div>

            <button
              style={{ ...S.saveBtn, textAlign: "left", padding: "10px 12px", color: "#D9645C", borderColor: "rgba(217,100,92,0.3)" }}
              onClick={signOut}
            >
              Sign Out
            </button>

            <div style={{ background: "#15171d", border: "1px solid rgba(217,100,92,0.2)", borderRadius: 14, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 10, color: "#D9645C", letterSpacing: 1.5, fontWeight: 700, marginBottom: 2 }}>DANGER ZONE</div>
              <button
                style={{ ...S.saveBtn, textAlign: "left", padding: "10px 12px", color: "#D9645C", borderColor: "rgba(217,100,92,0.3)" }}
                onClick={() => { setDeleteConfirmText(""); setShowDeleteModal(true); }}
              >
                Delete Account
              </button>
            </div>
          </div>
        )}

        {activeTab === "props" && isBeta && (
          trendingProps === null ? (
            <div style={S.center}>
              <div style={S.spinner} />
              <div style={{ color: "#777", fontSize: 13, marginTop: 12 }}>Scanning K's and HR's for edges…</div>
            </div>
          ) : trendingProps.length === 0 ? (
            <div style={S.center}>
              <div style={{ fontSize: 32 }}>📈</div>
              <div style={{ color: "#fff", fontWeight: 700, marginTop: 8 }}>No trending props {fmtDateLabel(selectedDate)}</div>
              <div style={{ color: "#777", fontSize: 13, marginTop: 4 }}>Check back closer to game time — lines and lineups are still posting</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#2FBF71", letterSpacing: 2, marginBottom: 4 }}>
                {trendingProps.length} TRENDING PICK{trendingProps.length !== 1 ? "S" : ""} — SORTED BY EDGE
              </div>
              {trendingProps.map((pick, i) => (
                <PropCard key={`${pick.marketType}-${pick.playerId ?? pick.player}-${i}`} pick={pick} S={S} />
              ))}
            </>
          )
        )}

      </div>

      {upgradeModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={() => setUpgradeModal(false)}>
          <div style={{ width: "100%", maxWidth: 500, background: "#12141a", borderRadius: "24px 24px 0 0", border: "1px solid #242832", borderBottom: "none", padding: "0 0 max(24px, env(safe-area-inset-bottom)) 0", animation: "slideUp 0.3s cubic-bezier(0.32,0.72,0,1)" }}
            role="dialog" aria-modal="true" aria-label="Upgrade to Pro"
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: "#2b2f3a" }} />
            </div>
            <div style={{ padding: "16px 24px 8px" }}>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
                  T<span style={{ color: "#2FBF71" }}>|</span>T <span style={{ color: "#777", fontFamily: tokens.font.body, fontSize: 16, fontWeight: 400 }}>Pro</span>
                </div>
                <div style={{ color: "#666", fontSize: 13 }}>Unlock all picks, edge scores, and AI breakdowns</div>
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <button onClick={() => startCheckout("monthly")} disabled={!!checkingOut}
                  style={{ flex: 1, background: "#15171d", border: "1px solid #242832", borderRadius: 14, padding: "16px 12px", cursor: "pointer", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#999", letterSpacing: 1, marginBottom: 4 }}>MONTHLY</div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 26, fontWeight: 700, color: "#fff" }}>$2</div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>per month</div>
                  {checkingOut === "monthly" && <div style={{ color: "#999", fontSize: 11, marginTop: 4 }}>Redirecting…</div>}
                </button>
                <button onClick={() => startCheckout("annual")} disabled={!!checkingOut}
                  style={{ flex: 1, background: "#0a1a0f", border: "1px solid rgba(47,191,113,0.35)", borderRadius: 14, padding: "16px 12px", cursor: "pointer", textAlign: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ fontSize: 10, color: "#2FBF71", letterSpacing: 1 }}>ANNUAL</div>
                    <div style={{ fontSize: 9, color: "#2FBF71", fontWeight: 700 }}>2 months free</div>
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 26, fontWeight: 700, color: "#2FBF71" }}>$19.99</div>
                  <div style={{ fontSize: 12, color: "#999", marginTop: 3 }}>$1.67/mo · 2 months free</div>
                  {checkingOut === "annual" && <div style={{ color: "#2FBF71", fontSize: 11, marginTop: 4 }}>Redirecting…</div>}
                </button>
              </div>
              <div style={{ fontSize: 11, color: "#3d424f", textAlign: "center", marginBottom: 14 }}>Cancel anytime · Secure payment via Stripe</div>
              <div style={{ borderTop: "1px solid #111", paddingTop: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: "#555", textAlign: "center", marginBottom: 10 }}>Have an access code?</div>
                {codeStatus === "ok" ? (
                  <div style={{ textAlign: "center", fontSize: 14, color: "#2FBF71", fontWeight: 700 }}>✓ Access granted — welcome in!</div>
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
                    <input type="text" placeholder="Enter code" aria-label="Access code" value={accessCode}
                      onChange={e => setAccessCode(e.target.value.toUpperCase())}
                      style={{ ...S.input, flex: 1, letterSpacing: 3, fontFamily: "'JetBrains Mono',monospace", textAlign: "center", fontSize: 15 }} />
                    <button type="submit" disabled={codeStatus === "loading"}
                      style={{ background: codeStatus === "invalid" ? "#D9645C" : "#2FBF71", color: "#000", border: "none", borderRadius: 10, padding: "0 18px", fontWeight: 800, fontSize: 13, cursor: "pointer", flexShrink: 0 }}>
                      {codeStatus === "loading" ? "…" : codeStatus === "invalid" ? <><XIcon size={12} /> Invalid</> : "Apply"}
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

      {toastQueue.length > 0 && (() => {
        const t = toastQueue[0];
        return (
          <div style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", zIndex: 9998, width: "calc(100% - 40px)", maxWidth: 420, background: "#181b22", border: `1px solid ${t.color}44`, borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.7)", animation: "fadeUp 0.3s ease" }}>
            <span style={{ flexShrink: 0, color: t.color }}>
              {t.icon === "win" ? <CheckIcon size={18} /> : t.icon === "loss" ? <XIcon size={18} /> : <span style={{ fontSize: 18, lineHeight: 1 }}>–</span>}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 2 }}>{t.message}</div>
              <div style={{ fontSize: 11, color: t.color }}>{t.sub}</div>
            </div>
            <button onClick={() => setToastQueue(q => q.slice(1))} aria-label="Dismiss" style={{ background: "none", border: "none", color: "#555", fontSize: 16, cursor: "pointer", flexShrink: 0, display: "inline-flex" }}><CloseIcon size={14} /></button>
          </div>
        );
      })()}

      {showCancelModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={() => setShowCancelModal(false)}>
          <div style={{ width: "100%", maxWidth: 500, background: "#12141a", borderRadius: "24px 24px 0 0", border: "1px solid #242832", borderBottom: "none", padding: "0 0 max(28px, env(safe-area-inset-bottom)) 0", animation: "slideUp 0.3s cubic-bezier(0.32,0.72,0,1)" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: "#2b2f3a" }} />
            </div>
            <div style={{ padding: "16px 24px 8px" }}>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Before you go…</div>
                <div style={{ fontSize: 13, color: "#555", lineHeight: 1.6 }}>Here's what your Pro membership is doing for you:</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                {decisioned > 0 && (
                  <div style={statTileStyle()}>
                    <div style={{ fontFamily: tokens.font.mono, fontSize: 22, fontWeight: 700, color: winPct >= 55 ? "#2FBF71" : winPct >= 50 ? "#D6B23D" : "#D9645C" }}>{winPct}%</div>
                    <div style={{ fontSize: 10, color: "#444", marginTop: 3, letterSpacing: 1 }}>YOUR WIN RATE</div>
                    <div style={{ fontSize: 11, color: "#3d424f", marginTop: 2 }}>{decisioned} settled picks</div>
                  </div>
                )}
                {pnl !== 0 && (
                  <div style={statTileStyle()}>
                    <div style={{ fontFamily: tokens.font.mono, fontSize: 22, fontWeight: 700, color: pnl >= 0 ? "#2FBF71" : "#D9645C" }}>{pnl >= 0 ? "+" : ""}${Math.abs(pnl).toFixed(0)}</div>
                    <div style={{ fontSize: 10, color: "#444", marginTop: 3, letterSpacing: 1 }}>YOUR P&L</div>
                    <div style={{ fontSize: 11, color: "#3d424f", marginTop: 2 }}>at ${unitSize}/unit</div>
                  </div>
                )}
                {modelRecord?.pct != null && (
                  <div style={statTileStyle()}>
                    <div style={{ fontFamily: tokens.font.mono, fontSize: 22, fontWeight: 700, color: modelRecord.pct >= 55 ? "#2FBF71" : "#D6B23D" }}>{modelRecord.pct}%</div>
                    <div style={{ fontSize: 10, color: "#444", marginTop: 3, letterSpacing: 1 }}>MODEL WIN RATE</div>
                    <div style={{ fontSize: 11, color: "#3d424f", marginTop: 2 }}>{modelRecord.wins}–{modelRecord.losses} all-time</div>
                  </div>
                )}
                {modelStreak?.streak >= 2 && (
                  <div style={{ ...statTileStyle(), background: modelStreak.streakType === "win" ? "rgba(47,191,113,0.05)" : "rgba(217,100,92,0.05)", border: `1px solid ${modelStreak.streakType === "win" ? "rgba(47,191,113,0.2)" : "rgba(217,100,92,0.15)"}` }}>
                    <div style={{ fontFamily: tokens.font.mono, fontSize: 22, fontWeight: 700, color: modelStreak.streakType === "win" ? "#2FBF71" : "#D9645C" }}>{modelStreak.streak}</div>
                    <div style={{ fontSize: 10, color: "#444", marginTop: 3, letterSpacing: 1 }}>DAY {modelStreak.streakType === "win" ? "WIN" : "LOSS"} STREAK</div>
                    <div style={{ fontSize: 11, color: "#3d424f", marginTop: 2 }}>{modelStreak.streakType === "win" ? "Model is hot" : "Bounce-back due"}</div>
                  </div>
                )}
              </div>

              <div style={{ background: "rgba(47,191,113,0.04)", border: "1px solid rgba(47,191,113,0.12)", borderRadius: 12, padding: "12px 16px", marginBottom: 16, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>You're paying less than a coffee a month.</div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 700, color: "#2FBF71" }}>$2/month</div>
                <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>for 30 days of sharp picks, AI breakdowns, and edge scores</div>
              </div>

              <button
                style={{ width: "100%", background: "#2FBF71", color: "#000", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 800, cursor: "pointer", marginBottom: 10 }}
                onClick={() => setShowCancelModal(false)}>
                Keep Pro — stay sharp
              </button>
              <button
                style={{ width: "100%", background: "transparent", border: "1px solid #242832", borderRadius: 12, padding: "12px", fontSize: 13, color: "#444", cursor: "pointer", marginBottom: 4 }}
                onClick={() => { setShowCancelModal(false); goToBillingPortal("cancel"); }}>
                Cancel subscription →
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={() => !deleting && setShowDeleteModal(false)}>
          <div style={{ width: "100%", maxWidth: 500, background: "#12141a", borderRadius: "24px 24px 0 0", border: "1px solid rgba(217,100,92,0.25)", borderBottom: "none", padding: "0 0 max(28px, env(safe-area-inset-bottom)) 0", animation: "slideUp 0.3s cubic-bezier(0.32,0.72,0,1)" }}
            role="dialog" aria-modal="true" aria-label="Delete your account"
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: "#2b2f3a" }} />
            </div>
            <div style={{ padding: "16px 24px 8px" }}>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: "#D9645C" }}>Delete your account?</div>
                <div style={{ fontSize: 13, color: "#666", lineHeight: 1.6 }}>
                  This cancels any active subscription and permanently erases your picks, tracker history, and login. This can't be undone.
                </div>
              </div>

              <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>Type <strong style={{ color: "#fff" }}>DELETE</strong> to confirm</div>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                aria-label="Type DELETE to confirm account deletion"
                style={{ ...S.input, width: "100%", boxSizing: "border-box", textAlign: "center", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 14 }}
              />

              <button
                style={{ width: "100%", background: deleteConfirmText === "DELETE" ? "#D9645C" : "#242832", color: deleteConfirmText === "DELETE" ? "#fff" : "#555", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 800, cursor: deleteConfirmText === "DELETE" ? "pointer" : "not-allowed", marginBottom: 10 }}
                disabled={deleteConfirmText !== "DELETE" || deleting}
                onClick={deleteAccount}>
                {deleting ? "Deleting…" : "Permanently delete my account"}
              </button>
              <button
                style={{ width: "100%", background: "transparent", border: "1px solid #242832", borderRadius: 12, padding: "12px", fontSize: 13, color: "#444", cursor: "pointer", marginBottom: 4 }}
                disabled={deleting}
                onClick={() => setShowDeleteModal(false)}>
                Never mind
              </button>
            </div>
          </div>
        </div>
      )}

      <TeamModal
        open={!!teamModal}
        sport={teamModal?.sport}
        team={teamModal?.team}
        onClose={() => setTeamModal(null)}
        getAuthHeaders={getAuthHeaders}
        S={S}
      />

      <PlayerModal
        open={!!playerModal}
        sport={playerModal?.sport}
        playerId={playerModal?.id}
        playerName={playerModal?.name}
        onClose={() => setPlayerModal(null)}
        getAuthHeaders={getAuthHeaders}
        S={S}
      />

      <div style={S.legal}>
        For entertainment only · Not gambling advice · Must be 21+ in a legal jurisdiction
        {" · "}
        <a href="/terms" style={{ color: "#777", textDecoration: "underline" }}>Terms</a>
        {" · "}
        <a href="/privacy" style={{ color: "#777", textDecoration: "underline" }}>Privacy</a>
        <br />
        Problem gambling? Call <span style={{ color: "#777" }}>1-800-GAMBLER</span>
      </div>

      <div style={S.bottomBar}>
        {[
          { group: "home", Icon: HomeIcon, label: "Home" },
          { group: "games", Icon: GamesIcon, label: "Games" },
          { group: "portfolio", Icon: WalletIcon, label: "Portfolio" },
          { group: "profile", Icon: UserIcon, label: "Profile" },
        ].map(({ group, Icon, label }) => {
          const active = navGroup(activeTab) === group;
          return (
            <button
              key={group}
              onClick={() => setActiveTab(NAV_GROUP_DEFAULT[group])}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                background: "none", border: "none", cursor: "pointer", padding: "8px 4px",
                color: active ? "#2FBF71" : "#555",
              }}
            >
              <Icon size={18} />
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.2 }}>{label}</span>
            </button>
          );
        })}
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

function SearchOverlay({ open, onClose, picks, nflPicks, savedPicks, onTeamClick, onPlayerClick, getAuthHeaders }) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [remote, setRemote] = useState({ teams: [], players: [] });
  const [remoteLoading, setRemoteLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) { setQuery(""); setActiveId(null); setRemote({ teams: [], players: [] }); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Global team/player directory search (independent of today's loaded games)
  // — debounced since it hits the network, unlike the instant local filters below.
  useEffect(() => {
    if (!open) return;
    const q2 = query.trim();
    if (q2.length < 2) { setRemote({ teams: [], players: [] }); return; }
    let cancelled = false;
    setRemoteLoading(true);
    const t = setTimeout(async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/search?q=${encodeURIComponent(q2)}`, { headers });
        const data = await res.json();
        if (!cancelled) setRemote({ teams: data.teams || [], players: data.players || [] });
      } catch {
        if (!cancelled) setRemote({ teams: [], players: [] });
      } finally {
        if (!cancelled) setRemoteLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, query, getAuthHeaders]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const matchesGame = (p) => !q || (p.homeTeam || "").toLowerCase().includes(q) || (p.awayTeam || "").toLowerCase().includes(q);
  const matchesTracker = (p) => !q || (p.home_team || "").toLowerCase().includes(q) || (p.away_team || "").toLowerCase().includes(q) || (p.pick || "").toLowerCase().includes(q);

  const gameResults = q ? (picks || []).filter(matchesGame).slice(0, 20) : [];
  const nflResults = q ? (nflPicks || []).filter(matchesGame).slice(0, 20) : [];
  const trackerResults = q ? (savedPicks || []).filter(matchesTracker).slice(0, 20) : [];
  const { teams: teamResults, players: playerResults } = remote;

  const renderGameRow = (p, prefix, sport = "mlb") => {
    const isOpen = activeId === `${prefix}-${p.id}`;
    return (
      <div key={`${prefix}-${p.id}`}>
        <div
          onClick={() => setActiveId(isOpen ? null : `${prefix}-${p.id}`)}
          role="button" tabIndex={0}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveId(isOpen ? null : `${prefix}-${p.id}`); } }}
          aria-expanded={isOpen}
          style={{ padding: "10px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1c1f26" }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#eee" }}><TeamMatchupLink sport={sport} awayTeam={p.awayTeam} homeTeam={p.homeTeam} onPick={onTeamClick} /></div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{fmtGameTime(p.commenceTime)}{p.pick ? ` · Take ${p.pick}` : ""}</div>
          </div>
          <span aria-hidden="true" style={{ color: "#444", fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
        </div>
        {isOpen && (
          <div style={{ padding: "0 16px 14px", background: "#10131a" }}>
            <WinPctRow homeTeam={p.homeTeam} awayTeam={p.awayTeam} homeOdds={p.homeOdds} awayOdds={p.awayOdds} openHomeOdds={p.openHomeOdds} openAwayOdds={p.openAwayOdds} />
            {p.filter && (
              <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
                {p.filter.verdict} · {(p.edge || 0).toFixed(1)}% edge {p.homeOdds != null && `· ${fmtOdds(p.pick === p.homeTeam ? p.homeOdds : p.awayOdds)}`}
              </div>
            )}
            {p.breakdown?.preview && <div style={{ fontSize: 12, color: "#666", marginTop: 6, lineHeight: 1.5 }}>{p.breakdown.preview}</div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 16px 16px" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, background: "#12141a", border: "1px solid #1e1e1e", borderRadius: 16, overflow: "hidden", maxHeight: "76vh", display: "flex", flexDirection: "column", animation: "fadeUp 0.15s ease" }}
        role="dialog" aria-modal="true" aria-label="Search">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid #242832" }}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveId(null); }}
            placeholder="Search teams, players, games, tracker history…"
            aria-label="Search teams, players, games, tracker history"
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "#fff", fontSize: 15 }}
          />
          <button onClick={onClose} aria-label="Close search" style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 4, display: "inline-flex" }}><CloseIcon size={16} /></button>
        </div>
        <div style={{ overflowY: "auto", padding: q ? "6px 0" : "0" }}>
          {!q && (
            <div style={{ padding: "36px 20px", textAlign: "center", color: "#444", fontSize: 13 }}>
              Type a team or player name to search MLB/NFL, or your tracker history.
            </div>
          )}
          {q && !remoteLoading && !teamResults.length && !playerResults.length && !gameResults.length && !nflResults.length && !trackerResults.length && (
            <div style={{ padding: "36px 20px", textAlign: "center", color: "#444", fontSize: 13 }}>
              No matches for "{query}"
            </div>
          )}
          {teamResults.length > 0 && (
            <div>
              <div style={{ padding: "8px 16px 4px", fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: 1.5 }}>TEAMS</div>
              {teamResults.map(t => (
                <div
                  key={`team-${t.sport}-${t.name}`}
                  onClick={() => { onTeamClick(t.sport, t.name); onClose(); }}
                  role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTeamClick(t.sport, t.name); onClose(); } }}
                  style={{ padding: "10px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1c1f26" }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#eee" }}>{t.name}</div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: t.sport === "nfl" ? "#D9754A" : "#2FBF71", letterSpacing: 0.5 }}>{t.sport.toUpperCase()}</span>
                </div>
              ))}
            </div>
          )}
          {playerResults.length > 0 && (
            <div>
              <div style={{ padding: "12px 16px 4px", fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: 1.5 }}>PLAYERS</div>
              {playerResults.map(p => (
                <div
                  key={`player-${p.sport}-${p.id}`}
                  onClick={() => { onPlayerClick(p.sport, p.id, p.name); onClose(); }}
                  role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPlayerClick(p.sport, p.id, p.name); onClose(); } }}
                  style={{ padding: "10px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1c1f26" }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#eee" }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{p.team}{p.position ? ` · ${p.position}` : ""}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: p.sport === "nfl" ? "#D9754A" : "#2FBF71", letterSpacing: 0.5 }}>{p.sport.toUpperCase()}</span>
                </div>
              ))}
            </div>
          )}
          {gameResults.length > 0 && (
            <div>
              <div style={{ padding: "8px 16px 4px", fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: 1.5 }}>MLB GAMES</div>
              {gameResults.map(p => renderGameRow(p, "g", "mlb"))}
            </div>
          )}
          {nflResults.length > 0 && (
            <div>
              <div style={{ padding: "12px 16px 4px", fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: 1.5 }}>NFL GAMES</div>
              {nflResults.map(p => renderGameRow(p, "n", "nfl"))}
            </div>
          )}
          {trackerResults.length > 0 && (
            <div>
              <div style={{ padding: "12px 16px 4px", fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: 1.5 }}>TRACKER HISTORY</div>
              {trackerResults.map(p => {
                const isOpen = activeId === `t-${p.id}`;
                const resultColor = p.result === "win" ? "#2FBF71" : p.result === "loss" ? "#D9645C" : p.result === "push" ? "#D6B23D" : "#666";
                return (
                  <div key={p.id}>
                    <div
                      onClick={() => setActiveId(isOpen ? null : `t-${p.id}`)}
                      role="button" tabIndex={0}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveId(isOpen ? null : `t-${p.id}`); } }}
                      aria-expanded={isOpen}
                      style={{ padding: "10px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1c1f26" }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#eee" }}><TeamMatchupLink sport={p.sport === "nfl" ? "nfl" : "mlb"} awayTeam={p.away_team} homeTeam={p.home_team} onPick={onTeamClick} /></div>
                        <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>Take {p.pick} {p.odds != null ? fmtOdds(p.odds) : ""}</div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: resultColor, textTransform: "uppercase" }}>{p.result}</span>
                    </div>
                    {isOpen && (
                      <div style={{ padding: "0 16px 14px", background: "#10131a", fontSize: 12, color: "#666" }}>
                        {p.commence_time ? new Date(p.commence_time).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : ""} · Tier: {p.tier || "—"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const css = `
  @import url('${FONT_IMPORT_URL}');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{background:#000;color:#fff;font-family:${tokens.font.body};}
  h1,h2,h3{font-family:${tokens.font.display};}
  input{outline:none;}
  button{cursor:pointer;border:none;font-family:inherit;}
  @keyframes spin{to{transform:rotate(360deg);}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
  @keyframes slideIn{from{transform:translateX(-100%);}to{transform:translateX(0);}}
  @keyframes slideUp{from{transform:translateY(100%);}to{transform:translateY(0);}}
  @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
  ::-webkit-scrollbar{width:0;height:0;}
`;

