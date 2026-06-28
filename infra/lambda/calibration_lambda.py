"""
Nightly calibration snapshot Lambda.

Reads all resolved bets from Supabase model_picks, computes:
  - Probability calibration buckets (predicted vs actual win rate)
  - Confidence calibration buckets (monotonicity check)
  - Verdict/variance breakdowns
  - Brier score and log loss (scalar summary metrics)
  - avgDelta (overall over/under confidence bias in pp)

Writes one row to calibration_snapshots, then exits.
No external deps — pure Python 3.12 stdlib.
"""
import json
import math
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}


def _req(method: str, path: str, body=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = dict(_HEADERS)
    if body is not None:
        headers["Prefer"] = "return=minimal"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def _fetch_picks():
    # PostgREST: select only what we need; in-list filter uses in.(a,b,c) syntax.
    # Supabase default page size is 1000; a full MLB season of bets is <300 rows.
    qs = "select=result%2Cfeatures&is_bet=eq.true&result=in.(win%2Closs%2Cpush)"
    return _req("GET", f"model_picks?{qs}") or []


def _f(row, field):
    """Safe feature field accessor."""
    return (row.get("features") or {}).get(field)


def _bucket(rows, field, ranges, clv_rows):
    out = []
    for rng in ranges:
        lo, hi, mid = rng["lo"], rng["hi"], rng.get("mid")
        slice_ = [r for r in rows if _f(r, field) is not None and lo <= _f(r, field) < hi]
        wins = sum(1 for r in slice_ if r["result"] == "win")
        clv_sl = [r for r in clv_rows if _f(r, field) is not None and lo <= _f(r, field) < hi]
        avg_clv = (
            round(sum(_f(r, "clv") for r in clv_sl) / len(clv_sl), 1)
            if clv_sl else None
        )
        out.append({
            "label":     rng["label"],
            "predicted": mid,
            "n":         len(slice_),
            "wins":      wins,
            "actual":    round(wins / len(slice_) * 100, 1) if slice_ else None,
            "avgClv":    avg_clv,
            "clvN":      len(clv_sl),
        })
    return out


def _brier_logloss(decided):
    scored = [r for r in decided if _f(r, "true_win_prob_pct") is not None]
    if not scored:
        return None, None
    eps = 1e-15
    brier = sum(
        (_f(r, "true_win_prob_pct") / 100 - (1 if r["result"] == "win" else 0)) ** 2
        for r in scored
    ) / len(scored)
    ll = -sum(
        (1 if r["result"] == "win" else 0)
            * math.log(max(eps, _f(r, "true_win_prob_pct") / 100))
        + (0 if r["result"] == "win" else 1)
            * math.log(max(eps, 1 - _f(r, "true_win_prob_pct") / 100))
        for r in scored
    ) / len(scored)
    return round(brier, 4), round(ll, 4)


def _compute(data):
    decided = [r for r in data if r["result"] != "push"]
    clv_rows = [r for r in data if _f(r, "clv") is not None]

    if not decided:
        return None

    prob_buckets = _bucket(decided, "true_win_prob_pct", [
        {"label": "51–53%", "lo": 51,  "hi": 53,  "mid": 52},
        {"label": "53–55%", "lo": 53,  "hi": 55,  "mid": 54},
        {"label": "55–57%", "lo": 55,  "hi": 57,  "mid": 56},
        {"label": "57–60%", "lo": 57,  "hi": 60,  "mid": 58.5},
        {"label": "60–65%", "lo": 60,  "hi": 65,  "mid": 62.5},
        {"label": "65%+",       "lo": 65,  "hi": 999, "mid": 67},
    ], clv_rows)

    conf_buckets = _bucket(decided, "confidence", [
        {"label": "6.5–7.0", "lo": 6.5,  "hi": 7.0},
        {"label": "7.0–7.5", "lo": 7.0,  "hi": 7.5},
        {"label": "7.5–8.0", "lo": 7.5,  "hi": 8.0},
        {"label": "8.0–8.5", "lo": 8.0,  "hi": 8.5},
        {"label": "8.5+",        "lo": 8.5,  "hi": 999},
    ], clv_rows)

    verdict_buckets = []
    for verdict in ["CLEAN", "BET"]:
        sl = [r for r in decided if _f(r, "verdict") == verdict]
        wins = sum(1 for r in sl if r["result"] == "win")
        clv_sl = [r for r in clv_rows if _f(r, "verdict") == verdict]
        avg_clv = (
            round(sum(_f(r, "clv") for r in clv_sl) / len(clv_sl), 1) if clv_sl else None
        )
        verdict_buckets.append({
            "label":  verdict,
            "n":      len(sl),
            "wins":   wins,
            "actual": round(wins / len(sl) * 100, 1) if sl else None,
            "avgClv": avg_clv,
            "clvN":   len(clv_sl),
        })

    variance_buckets = []
    for var in ["LOW", "MED", "HIGH"]:
        sl = [r for r in decided if _f(r, "variance") == var]
        if not sl:
            continue
        wins = sum(1 for r in sl if r["result"] == "win")
        variance_buckets.append({
            "label":  var,
            "n":      len(sl),
            "wins":   wins,
            "actual": round(wins / len(sl) * 100, 1),
        })

    populated = [b for b in prob_buckets if b["actual"] is not None and b["predicted"] is not None]
    avg_delta = (
        round(sum(b["actual"] - b["predicted"] for b in populated) / len(populated), 1)
        if populated else None
    )

    brier, log_loss = _brier_logloss(decided)

    return {
        "run_at":          datetime.now(timezone.utc).isoformat(),
        "total_picks":     len(decided),
        "brier_score":     brier,
        "log_loss":        log_loss,
        "avg_delta":       avg_delta,
        "prob_buckets":    prob_buckets,
        "conf_buckets":    conf_buckets,
        "verdict_buckets": verdict_buckets,
        "variance_buckets": variance_buckets,
    }


def handler(event, context):
    data = _fetch_picks()
    snapshot = _compute(data)

    if snapshot is None:
        print("no resolved bets — skipping snapshot")
        return {"statusCode": 200, "body": "no resolved bets"}

    _req("POST", "calibration_snapshots", snapshot)

    summary = {
        "total":     snapshot["total_picks"],
        "brier":     snapshot["brier_score"],
        "log_loss":  snapshot["log_loss"],
        "avg_delta": snapshot["avg_delta"],
    }
    print(json.dumps(summary))
    return {"statusCode": 200, "body": json.dumps(summary)}
