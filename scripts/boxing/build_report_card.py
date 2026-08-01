#!/usr/bin/env python3
"""
Aggregates data/boxing/scorecards.jsonl into a per-judge "Judge Report Card":
  - deviation: for each bout, a judge's diff (fighter_a - fighter_b points)
    minus the median diff across all judges on that same bout
  - mean_abs_deviation: average magnitude of deviation -- how far this judge
    typically sits from the room
  - signed_bias: average signed deviation -- whether the judge consistently
    leans toward fighter_a-slotted fighters (not a real "aggressor/pressure"
    signal -- see NOTE below)
  - deviation_variance: population variance of deviation -- consistency
  - odd_card_out_rate: fraction of bouts where this judge's winner pick
    disagreed with the bout's majority winner

NOTE on scope: the source pitch also asked for "skew toward the pressure
fighter." That requires knowing which fighter was the aggressor/pressure
fighter per bout, which commission result PDFs do not contain -- it would
need a separate tagging pass (e.g. punch-stat data or manual review). Left
out here rather than faked; fighter_a/fighter_b are just "listed first" /
"listed second," with no stylistic meaning.

MIN_FIGHTS enforces a hard cutoff rather than a hierarchical/shrinkage model
per the project's stated risk that thin per-judge samples produce "noise
dressed as insight." Judges below the cutoff are still listed (so the report
isn't silently hiding names) but flagged insufficient_sample=true and should
be visually de-emphasized, not ranked.
"""
import json
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
INPUT_PATH = ROOT / "data" / "boxing" / "scorecards.jsonl"
OUTPUT_PATH = ROOT / "data" / "boxing" / "judge_report_card.json"
MIN_FIGHTS = 8


def load_rows():
    rows = []
    with open(INPUT_PATH) as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def main():
    rows = load_rows()
    if not rows:
        print(f"no rows in {INPUT_PATH} -- run parse_pdfs.py first", file=sys.stderr)
        sys.exit(1)

    by_bout = defaultdict(list)
    for r in rows:
        by_bout[r["bout_id"]].append(r)

    per_judge = defaultdict(list)  # judge -> list of (deviation, dissented_bool)
    for bout_id, bout_rows in by_bout.items():
        diffs = [r["diff"] for r in bout_rows]
        median_diff = statistics.median(diffs)
        bout_winner_sign = 1 if median_diff >= 0 else -1
        for r in bout_rows:
            deviation = r["diff"] - median_diff
            judge_sign = 1 if r["diff"] >= 0 else -1
            dissented = judge_sign != bout_winner_sign and r["diff"] != 0
            per_judge[r["judge"]].append({
                "deviation": deviation,
                "dissented": dissented,
                "alignment_confidence": r["alignment_confidence"],
            })

    report = []
    for judge, samples in sorted(per_judge.items()):
        n = len(samples)
        deviations = [s["deviation"] for s in samples]
        assumed_pct = round(
            100 * sum(1 for s in samples if s["alignment_confidence"] == "assumed") / n, 1
        )
        report.append({
            "judge": judge,
            "n_fights": n,
            "insufficient_sample": n < MIN_FIGHTS,
            "mean_abs_deviation": round(sum(abs(d) for d in deviations) / n, 2),
            "signed_bias": round(sum(deviations) / n, 2),
            "deviation_variance": round(statistics.pvariance(deviations), 2) if n > 1 else None,
            "odd_card_out_rate": round(sum(1 for s in samples if s["dissented"]) / n, 3),
            "pct_rows_assumed_alignment": assumed_pct,
        })

    # Most-fights-first, but only among judges that clear the cutoff -- the
    # ranking itself shouldn't be lead with noise.
    report.sort(key=lambda j: (j["insufficient_sample"], -j["mean_abs_deviation"]))

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "SYNTHETIC_FIXTURE_DATA",
        "source_note": (
            "boxing.nv.gov is network-blocked in this environment, so this "
            "report is built from synthetic fixture PDFs (scripts/boxing/"
            "generate_fixtures.py), not real fight data. Judge and fighter "
            "names are fictional. Re-run parse_pdfs.py + build_report_card.py "
            "against real NAC/NYSAC PDFs to replace this with a real report."
        ),
        "min_fights_cutoff": MIN_FIGHTS,
        "total_fights_parsed": len(by_bout),
        "judges": report,
    }

    OUTPUT_PATH.write_text(json.dumps(output, indent=2))
    print(f"wrote {OUTPUT_PATH} ({len(report)} judges, {len(by_bout)} fights)")


if __name__ == "__main__":
    main()
