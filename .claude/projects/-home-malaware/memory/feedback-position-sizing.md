---
name: feedback-position-sizing
description: Position sizing rule for tot-app: half unit when CLEAN + strong edge but bullpen ERA > 6.00 on pick side
metadata:
  type: feedback
---

When a pick is CLEAN with a strong edge BUT the pick-side bullpen ERA is over 6.00 — drop recommended unit size by half. The edge is real, the variance is also real.

**Why:** High bullpen ERA introduces significant variance even when the model signal is clean. User wants to be disciplined about size in these cases.

**How to apply:** In tot-app filter layer and pick card UI — when `filter.verdict === "CLEAN"` and pick-side bullpen ERA > 6.00, surface a "HALF SIZE" or "REDUCE SIZE" warning. Apply to Kelly calculations and any unit size recommendations.
