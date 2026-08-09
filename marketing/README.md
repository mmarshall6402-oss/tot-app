# Marketing Content Kit

This folder is the source material for generating T\|T marketing content — social posts, emails,
ad copy, landing page sections, blog posts, whatever's next. It exists so that content generation
(by you, or by feeding these files to Claude/another LLM as context) is grounded in what the app
*actually does*, not a stale pitch.

**Start here, in order:**

1. [`../FEATURES.md`](../FEATURES.md) — the exhaustive, engineering-verified feature list. Every
   claim in marketing copy should trace back to something in this file.
2. [`product-overview.md`](./product-overview.md) — the elevant elevator pitches and positioning.
3. [`audience-personas.md`](./audience-personas.md) — who we're writing for, per product surface.
4. [`messaging-pillars.md`](./messaging-pillars.md) — voice, tone, and the claims we're allowed
   to make (and how to hedge the ones that need it).
5. [`feature-benefit-matrix.md`](./feature-benefit-matrix.md) — every feature mapped to a benefit,
   an audience, and a ready-to-use content angle. This is the main content-generation engine.
6. [`proof-points.md`](./proof-points.md) — real numbers, live data sources, and compliance
   language for any performance claim ("we beat Vegas," win rates, etc.).
7. [`content-prompts.md`](./content-prompts.md) — copy-paste prompts for generating specific
   content types (tweet, email subject lines, landing hero, blog outline, ad copy) from this kit.

## Why this exists

The README used to describe T\|T as an MLB-only picks product. The app has since grown into a
combined MLB + NFL betting platform with a full NFL fantasy football suite (rankings, Draft
Assistant, VORP/tiering, backtested projections), an AI chat assistant, and a personal bet
tracker. This folder — and the README rewrite alongside it — brings the *description* of the
product back in line with the *product*, so marketing content stops undersell­ing what's actually
shipped.

## How to use this with an LLM

Paste `FEATURES.md` + the relevant file(s) below into a prompt (or point Claude Code at this
folder) and ask for the specific asset you need. Example:

> Using `marketing/feature-benefit-matrix.md` and `marketing/messaging-pillars.md`, write 5
> tweets announcing the Draft Assistant to our existing MLB audience who don't know we do NFL
> fantasy yet.

Keep this kit current: whenever a feature is added, update `FEATURES.md` first, then add a row to
`feature-benefit-matrix.md`.
