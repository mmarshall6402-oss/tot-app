// Shared design tokens + button/card style dictionary for T|T Picks.
// Single source of truth for `S`, replacing the byte-identical copies that
// used to live in app/page.js and app/app/page.js.

export const tokens = {
  color: {
    bg: "#0b0c10",
    surface: "#15171d",
    surfaceRaised: "#12141a",
    border: "#262a33",
    borderStrong: "#383c46",
    textPrimary: "#eef0f2",
    textSecondary: "#969aa1",
    textMuted: "#6d7178",
    brand: "#2FBF71",
    orange: "#D9754A",
    red: "#D9645C",
    yellow: "#D6B23D",
  },
  radius: { sm: 6, md: 8, lg: 10 },
  shadow: { none: "none", chrome: "0 2px 8px rgba(0,0,0,0.25)" },
  transition: "background-color .12s ease, border-color .12s ease, color .12s ease",
};

const t = tokens;

// Generalized solid-fill "accent CTA" builder — covers NFL orange, brand-green
// upgrade/save-active buttons, etc. Replaces ad hoc hand-rolled variants.
export function accentButtonStyle(color, { disabled = false } = {}) {
  return {
    background: disabled ? t.color.surface : color,
    color: disabled ? t.color.textMuted : "#0b0c10",
    border: "none",
    borderRadius: t.radius.md,
    padding: "12px 0",
    fontWeight: 700,
    fontSize: 14,
    width: "100%",
    cursor: disabled ? "default" : "pointer",
    transition: t.transition,
  };
}

export const S = {
  page: { minHeight: "100vh", background: t.color.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20, gap: 20 },
  previewBox: { width: "100%", maxWidth: 480, border: `1px solid ${t.color.border}`, borderRadius: t.radius.lg, padding: 20, background: t.color.surface },
  previewTag: { fontSize: 10, fontWeight: 700, color: t.color.brand, letterSpacing: 2, marginBottom: 10 },
  previewMatchup: { fontFamily: "'JetBrains Mono',monospace", fontSize: 17, fontWeight: 700 },
  previewReason: { fontSize: 13, color: t.color.textSecondary, marginTop: 10, lineHeight: 1.6 },
  authBox: { width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", gap: 12 },
  logo: { fontFamily: "'JetBrains Mono',monospace", fontSize: 36, fontWeight: 700, textAlign: "center", letterSpacing: -1 },
  authSub: { fontSize: 14, color: t.color.textSecondary, textAlign: "center" },
  googleBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 13, borderRadius: t.radius.lg, background: t.color.surfaceRaised, border: `1px solid ${t.color.border}`, color: t.color.textPrimary, fontSize: 14, fontWeight: 500 },
  orRow: { display: "flex", alignItems: "center" },
  orLine: { flex: 1, height: 1, background: t.color.border },
  input: { padding: "13px 16px", borderRadius: t.radius.lg, background: t.color.surfaceRaised, border: `1px solid ${t.color.border}`, color: t.color.textPrimary, fontSize: 14, width: "100%" },
  primaryBtn: { padding: 14, borderRadius: t.radius.lg, background: t.color.brand, color: "#0b0c10", fontSize: 14, fontWeight: 700, width: "100%" },
  errMsg: { fontSize: 12, color: t.color.red, textAlign: "center" },
  switchRow: { fontSize: 13, color: t.color.textMuted, textAlign: "center" },
  app: { minHeight: "100vh", width: "100%", background: t.color.bg, display: "flex", flexDirection: "column" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000, display: "flex" },
  drawer: { width: 270, background: t.color.surfaceRaised, borderRight: `1px solid ${t.color.border}`, minHeight: "100vh", padding: 24, display: "flex", flexDirection: "column", gap: 4, animation: "slideIn 0.2s ease", overflowY: "auto", boxShadow: t.shadow.chrome },
  drawerLogo: { fontFamily: "'JetBrains Mono',monospace", fontSize: 24, fontWeight: 700, marginBottom: 4 },
  drawerEmail: { fontSize: 12, color: t.color.textMuted, marginBottom: 8 },
  drawerLine: { height: 1, background: t.color.border, margin: "12px 0" },
  drawerItem: { padding: "11px 0", fontSize: 15, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 10 },
  drawerSectionLabel: { fontSize: 10, fontWeight: 700, color: t.color.textSecondary, letterSpacing: 1.5, marginBottom: 10 },
  accuracyCard: { background: t.color.surface, border: `1px solid ${t.color.border}`, borderRadius: t.radius.lg, padding: 12 },
  nav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: `1px solid ${t.color.border}`, position: "sticky", top: 0, background: "rgba(11,12,16,0.97)", backdropFilter: "blur(12px)", zIndex: 100, boxShadow: t.shadow.chrome },
  bottomBar: { position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", background: "rgba(11,12,16,0.97)", backdropFilter: "blur(12px)", borderTop: `1px solid ${t.color.border}`, boxShadow: t.shadow.chrome, zIndex: 100, paddingBottom: "env(safe-area-inset-bottom)" },
  menuBtn: { background: "none", display: "flex", flexDirection: "column", gap: 5, padding: 4 },
  menuLine: { width: 22, height: 2, background: t.color.textSecondary, borderRadius: 1 },
  navLogo: { fontFamily: "'JetBrains Mono',monospace", fontSize: 20, fontWeight: 700, letterSpacing: -1 },
  navBadge: { fontSize: 11, fontWeight: 700, color: "#0b0c10", background: t.color.brand, padding: "3px 10px", borderRadius: t.radius.lg, letterSpacing: 0.5 },
  carousel: { margin: "12px 20px", border: `1px solid ${t.color.border}`, borderRadius: t.radius.lg + 4, padding: "16px 18px", background: t.color.surface, height: 100, overflow: "hidden" },
  carouselTag: { fontSize: 9, fontWeight: 700, color: t.color.brand, letterSpacing: 2, marginBottom: 6 },
  carouselMatchup: { fontFamily: "'JetBrains Mono',monospace", fontSize: 15, fontWeight: 700 },
  dateScroll: { display: "flex", gap: 6, padding: "10px 20px", overflowX: "auto", borderBottom: `1px solid ${t.color.border}` },
  dateBtn: { flexShrink: 0, padding: "7px 16px", borderRadius: t.radius.md, fontSize: 12, fontWeight: 600, border: "1px solid", letterSpacing: 0.3, whiteSpace: "nowrap", transition: t.transition },
  subNav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", borderBottom: `1px solid ${t.color.border}` },
  tabBtn: { padding: "6px 16px", borderRadius: t.radius.md, fontSize: 12, fontWeight: 600, background: t.color.surface, border: `1px solid ${t.color.border}`, letterSpacing: 0.3, transition: t.transition },
  sortBtn: { width: 32, height: 32, borderRadius: t.radius.sm, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", background: t.color.surface, border: `1px solid ${t.color.border}`, transition: t.transition },
  content: { flex: 1, padding: "12px 20px 84px", display: "flex", flexDirection: "column", gap: 10, overflowY: "auto" },
  center: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 60, textAlign: "center" },
  spinner: { width: 28, height: 28, border: `2px solid ${t.color.border}`, borderTopColor: t.color.brand, borderRadius: "50%", animation: "spin 0.7s linear infinite" },
  card: { background: t.color.surface, border: "1px solid", borderRadius: t.radius.lg + 4, padding: 16, transition: "border-color 0.2s", animation: "fadeUp 0.3s ease" },
  cardTop: { display: "flex", alignItems: "flex-start", gap: 10 },
  badge: { display: "inline-block", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: t.radius.sm, letterSpacing: 0.3, marginBottom: 6 },
  cardMatchup: { fontFamily: "'JetBrains Mono',monospace", fontSize: 14, fontWeight: 700, marginTop: 2 },
  cardMeta: { fontSize: 12, color: t.color.textMuted, marginTop: 4 },
  saveBtn: { fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: t.radius.sm, border: "1px solid", letterSpacing: 0.3, transition: t.transition },
  expandBtn: { width: 32, height: 32, borderRadius: t.radius.sm, background: t.color.surface, border: `1px solid ${t.color.borderStrong}`, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", color: t.color.textSecondary, transition: t.transition },
  pitchRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 10, padding: "10px 12px", background: t.color.surfaceRaised, borderRadius: t.radius.md, border: `1px solid ${t.color.border}` },
  pitchBox: { flex: 1 },
  pitchLabel: { fontSize: 9, fontWeight: 700, color: t.color.textSecondary, letterSpacing: 1.5, marginBottom: 3 },
  pitchName: { fontSize: 12, fontWeight: 600, color: t.color.textSecondary },
  pitchVs: { fontSize: 10, fontWeight: 700, color: t.color.textSecondary },
  preview: { fontSize: 13, color: t.color.textSecondary, lineHeight: 1.6, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${t.color.border}` },
  expDivider: { height: 1, background: t.color.border, margin: "12px 0" },
  expSection: { marginBottom: 12 },
  expLabel: { fontSize: 10, fontWeight: 700, color: t.color.textSecondary, letterSpacing: 1.5, marginBottom: 6 },
  expText: { fontSize: 13, color: t.color.textSecondary, lineHeight: 1.6 },
  statBox: { flex: 1, background: t.color.surfaceRaised, borderRadius: t.radius.sm, padding: "10px 12px", border: `1px solid ${t.color.border}` },
  statCard: { background: t.color.surface, border: `1px solid ${t.color.border}`, borderRadius: t.radius.md + 4, padding: 14, textAlign: "center" },
  statLabel: { fontSize: 10, color: t.color.textSecondary, marginBottom: 3, marginTop: 4 },
  statVal: { fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" },
  trashBtn: { background: t.color.surface, border: `1px solid ${t.color.border}`, borderRadius: t.radius.sm, fontSize: 15, cursor: "pointer", padding: "4px 8px", opacity: 0.8, transition: t.transition, display: "inline-flex", alignItems: "center", justifyContent: "center" },
  resultBtn: { flex: 1, padding: "10px", borderRadius: t.radius.lg, border: "2px solid", fontSize: 13, fontWeight: 800, transition: t.transition },
  legal: { padding: "14px 20px", borderTop: `1px solid ${t.color.border}`, textAlign: "center", fontSize: 10, color: t.color.textMuted, lineHeight: 1.9 },
};

// Shared CSS for the marketing landing page + embedded pre-auth heroes.
// Class names (.cta-btn, .ghost-btn, .pick-card, .stat-card, .feature-card,
// .testimonial) are canonical — all three call sites use the same names.
export const SHARED_BUTTON_CSS = `
  .pick-card   { background:${t.color.surface}; border:1px solid ${t.color.border}; border-radius:${t.radius.lg + 4}px; padding:14px 16px; transition: border-color .2s; }
  .pick-card:hover { border-color:${t.color.borderStrong}; }

  .cta-btn     { background:${t.color.brand}; color:#0b0c10; font-weight:700; font-size:15px; padding:15px 32px; border:none; border-radius:${t.radius.md}px; cursor:pointer; transition: ${t.transition}; display:inline-block; text-align:center; }
  .cta-btn:hover { background:#3ed184; }

  .ghost-btn   { background:transparent; color:${t.color.textPrimary}; font-weight:600; font-size:14px; padding:13px 28px; border:1px solid ${t.color.border}; border-radius:${t.radius.md}px; cursor:pointer; transition: ${t.transition}; display:inline-block; text-align:center; }
  .ghost-btn:hover { border-color:${t.color.borderStrong}; }

  .stat-card   { background:${t.color.surface}; border:1px solid ${t.color.border}; border-radius:${t.radius.md + 6}px; padding:22px 20px; flex:1; min-width:140px; }

  .feature-card { background:${t.color.surface}; border:1px solid ${t.color.border}; border-radius:${t.radius.md + 8}px; padding:24px; flex:1; min-width:200px; }

  .testimonial { background:${t.color.surface}; border:1px solid ${t.color.border}; border-radius:${t.radius.md + 6}px; padding:22px 20px; }

  .blur-mask   { position:absolute; inset:0; backdrop-filter:blur(5px); background:rgba(0,0,0,0.4); border-radius:${t.radius.lg + 4}px; display:flex; align-items:center; justify-content:center; z-index:2; }
  .lock-badge  { background:rgba(0,0,0,0.8); border:1px solid ${t.color.border}; border-radius:${t.radius.sm}px; padding:6px 12px; font-size:11px; color:${t.color.textMuted}; font-weight:700; letter-spacing:1px; }

  .shimmer-line { background:linear-gradient(90deg,${t.color.surface} 25%,${t.color.surfaceRaised} 50%,${t.color.surface} 75%); background-size:400px 100%; animation: shimmer 1.4s infinite; border-radius:4px; }
`;
