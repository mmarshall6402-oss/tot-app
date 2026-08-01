#!/usr/bin/env python3
"""
Parses athletic-commission event-result PDFs into per-judge scorecard rows.

Input:  PDFs under data/boxing/fixtures/ (or any directory passed as argv[1])
Output: data/boxing/scorecards.jsonl -- one row per (judge, bout)

Handles two layouts (see generate_fixtures.py for full description):
  - "roster order": judges listed once in the event header, bout scores
    assumed to follow that same order. Rows get alignment_confidence="assumed".
  - "named per bout": each score line names its judge directly. Rows get
    alignment_confidence="confirmed".

This is the part of the project expected to be "60% of the work" against
real PDFs (format drift across states/years). Keep the two code paths
(roster-order vs named) separate and easy to extend with a third when real
NAC/NYSAC PDFs turn out to differ from both fixtures -- don't try to force
a single regex to cover every layout.
"""
import json
import re
import sys
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_INPUT_DIR = ROOT / "data" / "boxing" / "fixtures"
OUTPUT_PATH = ROOT / "data" / "boxing" / "scorecards.jsonl"

RE_EVENT = re.compile(r"^Event:\s*(.+)$")
RE_DATE_VENUE = re.compile(r"^Date:\s*(\S+)\s+Venue:\s*(.+)$")
RE_JUDGES = re.compile(r"^Judges:\s*(.+)$")
RE_BOUT = re.compile(r"^Bout\s+(\d+):\s*(.+?)\s+vs\.?\s+(.+)$")
RE_RESULT = re.compile(r"^Result:\s*(.+?)\s+wins by\s+(.+)$")
RE_SCORES = re.compile(r"^Scores:\s*(.+)$")
RE_SCORE_PAIR = re.compile(r"(\d+)\s*-\s*(\d+)")
RE_JUDGE_LINE = re.compile(r"^Judge\s+(.+?):\s*(\d+)\s*-\s*(\d+)$")


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def parse_pdf(path):
    """Yields scorecard row dicts for one PDF. Raises on unrecognized layout
    so failures surface loudly instead of silently emitting bad rows."""
    with pdfplumber.open(path) as pdf:
        text = "\n".join(p.extract_text() or "" for p in pdf.pages)
    lines = [l.strip() for l in text.splitlines() if l.strip()]

    event_name = date = venue = None
    judge_roster = None
    for line in lines:
        if m := RE_EVENT.match(line):
            event_name = m.group(1)
        elif m := RE_DATE_VENUE.match(line):
            date, venue = m.group(1), m.group(2)
        elif m := RE_JUDGES.match(line):
            judge_roster = [j.strip() for j in m.group(1).split(",")]

    if not event_name or not date:
        raise ValueError(f"{path.name}: could not find Event/Date header lines")

    event_slug = f"{slugify(event_name)}_{date}"
    layout = "roster_order" if judge_roster else "named_per_bout"

    bout_num = fighter_a = fighter_b = decision = None
    i = 0
    while i < len(lines):
        line = lines[i]
        if m := RE_BOUT.match(line):
            bout_num, fighter_a, fighter_b = m.group(1), m.group(2), m.group(3)
        elif m := RE_RESULT.match(line):
            decision = m.group(2)
        elif m := RE_SCORES.match(line):
            if judge_roster is None:
                raise ValueError(f"{path.name} bout {bout_num}: 'Scores:' line "
                                  f"but no event-level judge roster found")
            pairs = RE_SCORE_PAIR.findall(m.group(1))
            if len(pairs) != len(judge_roster):
                raise ValueError(
                    f"{path.name} bout {bout_num}: {len(pairs)} scores but "
                    f"{len(judge_roster)} rostered judges -- cannot align safely"
                )
            for judge, (a, b) in zip(judge_roster, pairs):
                yield _row(event_name, date, venue, event_slug, bout_num,
                           fighter_a, fighter_b, decision, judge, int(a), int(b),
                           "assumed", layout, path.name)
        elif m := RE_JUDGE_LINE.match(line):
            judge, a, b = m.group(1), int(m.group(2)), int(m.group(3))
            yield _row(event_name, date, venue, event_slug, bout_num,
                       fighter_a, fighter_b, decision, judge, a, b,
                       "confirmed", layout, path.name)
        i += 1


def _row(event_name, date, venue, event_slug, bout_num, fighter_a, fighter_b,
         decision, judge, score_a, score_b, alignment_confidence, layout, source_file):
    return {
        "event": event_name,
        "date": date,
        "venue": venue,
        "bout_id": f"{event_slug}_bout{bout_num}",
        "fighter_a": fighter_a,
        "fighter_b": fighter_b,
        "decision": decision,
        "judge": judge,
        "score_a": score_a,
        "score_b": score_b,
        "diff": score_a - score_b,
        "alignment_confidence": alignment_confidence,
        "layout": layout,
        "source_file": source_file,
    }


def main():
    input_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_INPUT_DIR
    pdf_paths = sorted(input_dir.glob("*.pdf"))
    if not pdf_paths:
        print(f"no PDFs found in {input_dir}", file=sys.stderr)
        sys.exit(1)

    rows, failures = [], []
    for path in pdf_paths:
        try:
            rows.extend(parse_pdf(path))
        except Exception as e:
            failures.append((path.name, str(e)))

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")

    print(f"parsed {len(rows)} judge-scorecard rows from "
          f"{len(pdf_paths) - len(failures)}/{len(pdf_paths)} PDFs -> {OUTPUT_PATH}")
    if failures:
        print(f"\n{len(failures)} PDF(s) failed to parse (format drift -- "
              f"needs a new layout handler, not a silent skip):", file=sys.stderr)
        for name, err in failures:
            print(f"  {name}: {err}", file=sys.stderr)


if __name__ == "__main__":
    main()
