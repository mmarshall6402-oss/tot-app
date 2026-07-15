// lib/backtest/metrics.js
//
// Statistical validation primitives for the backtesting engine. Pure
// functions only — no I/O, no Supabase, so they can be unit-smoke-tested
// standalone and reused identically across Tier 1/2/3 runners.

const EPS = 1e-6;

// ─── Brier score / log loss ────────────────────────────────────────────────
// preds: [{ p: predictedProb, outcome: 0|1 }]

export function brierScore(preds) {
  if (!preds.length) return null;
  const sum = preds.reduce((s, { p, outcome }) => s + (p - outcome) ** 2, 0);
  return sum / preds.length;
}

export function logLoss(preds) {
  if (!preds.length) return null;
  const sum = preds.reduce((s, { p, outcome }) => {
    const pc = Math.min(1 - EPS, Math.max(EPS, p));
    return s - (outcome === 1 ? Math.log(pc) : Math.log(1 - pc));
  }, 0);
  return sum / preds.length;
}

// ─── Wilson score interval (95% CI on a proportion) ────────────────────────

export function wilsonInterval(wins, n, z = 1.96) {
  if (!n) return { lo: null, hi: null };
  const phat = wins / n;
  const denom = 1 + (z * z) / n;
  const center = phat + (z * z) / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n);
  return { lo: (center - margin) / denom, hi: (center + margin) / denom };
}

// ─── Calibration bucketing ──────────────────────────────────────────────────
// preds: [{ p: predictedProb, outcome: 0|1 }]
// buckets: [{ label, lo, hi, mid }] — same shape app/api/calibration/route.js
// already uses, so the two dashboards render calibration tables identically.
// Defaults to 10 buckets of 7pp each across the model's clamp range [0.15,0.85].

export function defaultBuckets(lo = 0.15, hi = 0.85, count = 10) {
  const width = (hi - lo) / count;
  return Array.from({ length: count }, (_, i) => {
    const bLo = lo + i * width;
    const bHi = bLo + width;
    return {
      label: `${Math.round(bLo * 100)}-${Math.round(bHi * 100)}%`,
      lo: bLo,
      hi: i === count - 1 ? bHi + EPS : bHi,
      mid: (bLo + bHi) / 2,
    };
  });
}

export function calibrationBuckets(preds, buckets = defaultBuckets()) {
  return buckets.map(({ label, lo, hi, mid }) => {
    const slice = preds.filter(({ p }) => p >= lo && p < hi);
    const wins = slice.filter(({ outcome }) => outcome === 1).length;
    const n = slice.length;
    const actual = n > 0 ? wins / n : null;
    const { lo: ciLo, hi: ciHi } = wilsonInterval(wins, n);
    return { label, predicted: mid, n, wins, actual, ciLo, ciHi };
  });
}

// ─── Isotonic regression (Pool Adjacent Violators Algorithm) ───────────────
// Fits a non-decreasing step function minimizing squared error between
// predicted probability (x) and actual outcome (y ∈ {0,1}). Standard
// technique for recalibrating a probabilistic model without assuming a
// parametric form (unlike Platt scaling). Ties on x are pre-aggregated into
// a single weighted point so tied inputs get one consistent fitted value.

export function isotonicFit(pairs) {
  const groups = new Map();
  for (const { x, y } of pairs) {
    const g = groups.get(x) ?? { sum: 0, count: 0 };
    g.sum += y;
    g.count += 1;
    groups.set(x, g);
  }
  const points = [...groups.entries()]
    .map(([x, g]) => ({ x: Number(x), y: g.sum / g.count, w: g.count }))
    .sort((a, b) => a.x - b.x);

  const blocks = [];
  for (const p of points) {
    blocks.push({ sumY: p.y * p.w, w: p.w, minX: p.x, maxX: p.x });
    while (blocks.length >= 2) {
      const b2 = blocks[blocks.length - 1];
      const b1 = blocks[blocks.length - 2];
      if (b1.sumY / b1.w > b2.sumY / b2.w) {
        blocks.splice(blocks.length - 2, 2, {
          sumY: b1.sumY + b2.sumY,
          w: b1.w + b2.w,
          minX: b1.minX,
          maxX: b2.maxX,
        });
      } else {
        break;
      }
    }
  }

  const controlPoints = [];
  for (const b of blocks) {
    const mean = b.sumY / b.w;
    controlPoints.push({ x: b.minX, y: mean });
    if (b.maxX !== b.minX) controlPoints.push({ x: b.maxX, y: mean });
  }
  return controlPoints;
}

export function isotonicPredict(controlPoints, x) {
  if (!controlPoints.length) return x;
  const first = controlPoints[0];
  const last = controlPoints[controlPoints.length - 1];
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;
  for (let i = 0; i < controlPoints.length - 1; i++) {
    const a = controlPoints[i];
    const b = controlPoints[i + 1];
    if (x >= a.x && x <= b.x) {
      if (b.x === a.x) return a.y;
      const t = (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return last.y;
}
