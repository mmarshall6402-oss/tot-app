# Ready-to-Use Content Prompts

Copy-paste these into Claude (or any LLM) alongside the referenced files as context. Swap the
bracketed parts. Always attach `proof-points.md` when a prompt could produce a stats claim.

---

### Daily "Steals" social post
> Context: `FEATURES.md` (§1, §3), `messaging-pillars.md`, `proof-points.md`
> Write 3 versions of a tweet (under 240 characters) announcing today's top Steal pick: [team A]
> vs [team B], pick: [team], edge: [X%], verdict: [CLEAN/BET]. Voice: terse, numbers-first, no
> hype words. Do not state a win-rate number — only reference today's specific edge.

### Weekly fantasy "regression watch" post
> Context: `FEATURES.md` (§3), `feature-benefit-matrix.md` row "Expected-vs-actual regression
> tracking", `audience-personas.md` (Fantasy Manager)
> Write a short post (150–250 words) flagging 3 players whose actual PPG is diverging from their
> projection this week: [player, position, expected PPG, actual PPG, direction]. Frame as a
> buy-low/sell-high signal for the Fantasy Manager persona. End with a one-line CTA to check the
> full Cheat Sheet.

### Pre-draft Draft Assistant launch/awareness post
> Context: `FEATURES.md` (§3, Draft Assistant), `product-overview.md` differentiators,
> `audience-personas.md` (Fantasy Manager)
> Write a launch announcement (email subject + 3 body paragraphs) introducing the Draft Assistant
> to users who currently only use the betting side of the app. Lead with the pain point (freezing
> up on the clock), explain what it does (roster-need-aware picks, snake-draft turn tracking,
> Sleeper sync), end with a CTA to try it before their next draft.

### "How the model works" credibility/long-form post
> Context: `README.md` Prediction Model section, `FEATURES.md` §12, `messaging-pillars.md` pillar
> "Model over gut"
> Write a ~500-word blog post explaining the verdict system (CLEAN/BET/PASS/TRAP) and the
> automatic exclusion rules, aimed at a skeptical sharp-bettor audience. Use the exact factor
> weights table from the README. Tone: direct, no hype, comfortable admitting when the model
> passes.

### Landing page hero variant test
> Context: `product-overview.md` elevator pitches, `messaging-pillars.md`
> Generate 5 alternate hero headline + subheadline pairs for the landing page (current: "We
> outperform Vegas odds with data."). Keep each headline under 8 words. Subheadline should
> reference both MLB/NFL betting and fantasy in one sentence, matching `app/landing/page.js`'s
> existing subheadline style.

### Email digest subject line batch
> Context: `audience-personas.md` (Weekend Warrior), `messaging-pillars.md` tone-by-channel table
> Write 8 subject lines for the daily email digest, varying by whether today has a CLEAN pick, a
> BET-only day, or a PASS-heavy day (no strong pick). Keep under 50 characters. Warm but
> efficient tone, per the email tone guidance.

### Cross-sell: MLB users → NFL/Fantasy
> Context: `feature-benefit-matrix.md` row "NFL picks + depth charts", `audience-personas.md`
> Write a short in-app or email nudge (under 80 words) telling an MLB-only user that NFL betting
> and fantasy tools are already included in their subscription — no upsell, just awareness.

---

## General-purpose prompt template

> You are writing [content type] for T\|T, a combined MLB/NFL betting + NFL fantasy platform.
> Voice and constraints: see `marketing/messaging-pillars.md`.
> Feature facts: see `FEATURES.md` and `marketing/feature-benefit-matrix.md` — do not invent
> features or numbers not present in these files.
> Any performance/stats claim must follow `marketing/proof-points.md` guardrails.
> Audience: [persona from marketing/audience-personas.md].
> Task: [specific ask].
