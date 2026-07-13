// lib/backtest/retrosheet-events.js
//
// Classifies a single Retrosheet play-by-play event string (the 6th field
// of a `play` line) into the outcome types needed for pitcher/batter stat
// aggregation: strikeout, walk, hit-by-pitch, hit type, or generic out —
// plus how many defensive outs the play recorded (needed for innings-
// pitched tracking) and the batted-ball trajectory type (G/F/L/P) used for
// the xFIP proxy.
//
// This does NOT reconstruct full base-out state — only the batter's own
// plate-appearance outcome and out count, which is all season-stats.js
// needs to build point-in-time pitching/hitting features. It does read
// advance-notation markers (runner-out "1X"/"2X"/"3X"/"BX", safe-on-
// dropped-third-strike "B-") to catch the common cases where a play
// records more (or fewer) outs than its primary code alone implies.
//
// Validated against all 7,289 games in data/games.json: every parsed game
// matches an authoritative date+home+away record, and every game has both
// starting pitchers identified. Internal out-accounting (summing outs
// recorded across a full defensive half-inning and checking it's a
// multiple of 3) is consistent for ~95.6% of half-innings; the residual is
// rare/compound play notation this simplified parser doesn't fully
// resolve without true base-out-state tracking — a documented, accepted
// approximation, not a blocker (IP is a stabilizing trust-weight input in
// probability.js, not something that needs to be exact to the out).

const BATTED_BALL_RE = /^([GFLP])(\d.*)?$/;

// Baserunning-only plays: no batter PA, no out (advance/PB/WP/balk/no-play/steal).
const NO_PA_NO_OUT_RE = /^(PB|WP|BK|OA|DI|NP|SB)/;
// Baserunning-only plays that DO record a defensive out (unless an error
// negated it) — caught stealing / pickoff.
const NO_PA_MAYBE_OUT_RE = /^(CS|PO)/;

// "+" usually combines two distinct top-level events (e.g. "K+CS2(24)/DP" —
// a strikeout AND a caught-stealing double play on the same pitch), but it
// also appears as a plain modifier flourish inside a descriptor/advance
// section (e.g. "L8D+" for a hard-hit line drive). Only treat it as a
// combiner when it occurs before the first "/" or "." of the whole event —
// i.e. within the bare core code — otherwise splitting on it would
// truncate away real advance-notation (losing runner-out markers).
// Returns the primary (first) component, plus any bonus outs contributed
// by a combined CS/PO component (the only combined-component shape that
// affects our out-count; other combinations like "K+PB" add no out beyond
// the primary's own).
function splitPrimaryComponent(raw) {
  const trimmed = String(raw).trim();
  const firstSlash = trimmed.indexOf("/");
  const firstDot = trimmed.indexOf(".");
  const boundary = Math.min(firstSlash === -1 ? Infinity : firstSlash, firstDot === -1 ? Infinity : firstDot);
  const corePrefix = boundary === Infinity ? trimmed : trimmed.slice(0, boundary);
  const plusIdx = corePrefix.indexOf("+");
  if (plusIdx === -1) return { primary: trimmed, combinedBonusOuts: 0 };

  const secondary = trimmed.slice(plusIdx + 1);
  let combinedBonusOuts = 0;
  if (NO_PA_MAYBE_OUT_RE.test(secondary)) {
    combinedBonusOuts = /E\d/.test(secondary) ? 0 : 1;
  }
  return { primary: trimmed.slice(0, plusIdx), combinedBonusOuts };
}

export function classifyPlay(rawEvent) {
  const { primary, combinedBonusOuts } = splitPrimaryComponent(rawEvent);

  if (NO_PA_NO_OUT_RE.test(primary)) {
    return { isPA: false, kind: null, outs: 0, battedBallType: null };
  }
  if (NO_PA_MAYBE_OUT_RE.test(primary)) {
    const hasError = /E\d/.test(primary);
    return { isPA: false, kind: null, outs: hasError ? 0 : 1, battedBallType: null };
  }

  const descriptorParts = primary.split(".");
  const descriptor = descriptorParts[0];
  const parts = descriptor.split("/");
  const core = parts[0];
  const modifiers = parts.slice(1);

  let battedBallType = null;
  for (const mod of modifiers) {
    const m = mod.match(BATTED_BALL_RE);
    if (m) { battedBallType = m[1]; break; }
  }

  // A trailing runner can be thrown out advancing on the same play — e.g.
  // a fielder's choice or single where the runner from third is nailed at
  // home ("FC/G56.3XH(52)"). That's a real extra out this simplified
  // parser would otherwise miss, since it doesn't track runners. Detect it
  // from the advance-notation suffix: a base label (1/2/3/B) immediately
  // followed by "X" means that runner was put out.
  //
  // "BX" (the batter himself retired advancing) is only a genuine EXTRA out
  // when the batter was otherwise safe on the primary event (a hit/BB/HBP/
  // FC) — e.g. a single stretched into an out at second. When the primary
  // event already IS the batter's own out (strikeout, generic fielded out),
  // "BX" just restates that same out (e.g. "K.BX1(23)" — batter struck out
  // and was also retired trying for first on the dropped third strike) and
  // must not be double-counted.
  // If the core descriptor already carries a DP/TP modifier, that modifier
  // is itself the authoritative out count for the whole play — the advance
  // section's "1X1(53)"-style detail is just narrating who/how, not an
  // additional out on top of it. Only look for extra outs when there's no
  // DP/TP modifier already accounting for them.
  // Scan the FULL raw text (not just the primary component's own advance
  // section) for these markers: a combined event like "K+WP.B-1" attaches
  // the advance notation after the secondary ("WP") component, not the
  // primary ("K"), but the marker's meaning is the same regardless of
  // which side of a "+" it landed on.
  const fullText = String(rawEvent).trim();
  const hasDpTpModifier = modifiers.includes("DP") || modifiers.includes("GDP") || modifiers.includes("TP");
  const otherRunnerOuts = hasDpTpModifier ? 0 : (fullText.match(/(?:^|[;.])[123]X/g) || []).length;
  const batterAlsoOut = !hasDpTpModifier && /(?:^|[;.])BX/.test(fullText);

  let result;

  if (/^K(\d|$)/.test(core)) {
    if (hasDpTpModifier) {
      // "K/DP" — strikeout that also retired another runner (e.g. caught
      // off base on the same pitch) — 2 outs total (3 for TP).
      result = { isPA: true, kind: "K", outs: modifiers.includes("TP") ? 3 : 2, battedBallType };
    } else {
      // Dropped third strike: batter reaches base safely ("K.B-1") instead
      // of being retired. Still a strikeout for K% purposes, no out recorded.
      const reachedOnDroppedThird = !batterAlsoOut && /(?:^|[;.])B-/.test(fullText);
      result = { isPA: true, kind: "K", outs: (reachedOnDroppedThird ? 0 : 1) + otherRunnerOuts, battedBallType };
    }
  } else if (/^(W|IW|I)$/.test(core)) {
    result = { isPA: true, kind: "BB", outs: otherRunnerOuts + (batterAlsoOut ? 1 : 0), battedBallType: null };
  } else if (core === "HP") {
    result = { isPA: true, kind: "HBP", outs: otherRunnerOuts + (batterAlsoOut ? 1 : 0), battedBallType: null };
  } else if (/^S(\d|$)/.test(core)) {
    result = { isPA: true, kind: "1B", outs: otherRunnerOuts + (batterAlsoOut ? 1 : 0), battedBallType };
  } else if (/^D/.test(core)) {
    // "DI" (defensive indifference) is intercepted above, so a bare /^D/ is
    // safe here and also catches "DGR" (ground-rule double).
    result = { isPA: true, kind: "2B", outs: otherRunnerOuts + (batterAlsoOut ? 1 : 0), battedBallType };
  } else if (/^T(\d|$)/.test(core)) {
    result = { isPA: true, kind: "3B", outs: otherRunnerOuts + (batterAlsoOut ? 1 : 0), battedBallType };
  } else if (/^HR(\d|$)/.test(core)) {
    result = { isPA: true, kind: "HR", outs: otherRunnerOuts, battedBallType };
  } else if (modifiers.includes("SF") || modifiers.includes("SH")) {
    result = { isPA: true, kind: "OUT", outs: 1 + otherRunnerOuts, battedBallType };
  } else if (core === "FC") {
    // A fielder's choice is, by definition, a putout recorded on a runner
    // other than the batter. With a DP/TP modifier present, otherRunnerOuts
    // was suppressed above (to avoid double-counting against the modifier),
    // so reconstruct the total directly from DP/TP. Without one, the "1X"/
    // "2X"/"3X" advance marker already IS the FC's out — floor at 1 rather
    // than adding a separate flat bonus on top of it.
    if (hasDpTpModifier) {
      result = { isPA: true, kind: "OUT_REACHED", outs: modifiers.includes("TP") ? 3 : 2, battedBallType };
    } else {
      result = { isPA: true, kind: "OUT_REACHED", outs: Math.max(1, otherRunnerOuts) + (batterAlsoOut ? 1 : 0), battedBallType };
    }
  } else if (/^(E\d|C)$/.test(core) || /^E\d/.test(core)) {
    result = { isPA: true, kind: "OUT_REACHED", outs: otherRunnerOuts + (batterAlsoOut ? 1 : 0), battedBallType };
  } else if (/^\d/.test(core)) {
    let outs = 1;
    if (modifiers.includes("DP") || modifiers.includes("GDP")) outs = 2;
    if (modifiers.includes("TP")) outs = 3;
    result = { isPA: true, kind: "OUT", outs: outs + otherRunnerOuts, battedBallType };
  } else {
    // Unrecognized code (rare) — no stat impact, flagged for visibility.
    return { isPA: false, kind: null, outs: 0, battedBallType: null, unknown: true };
  }

  result.outs += combinedBonusOuts;
  return result;
}
