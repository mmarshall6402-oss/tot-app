#!/usr/bin/env python3
"""
Generates SYNTHETIC fixture PDFs that mimic the real Nevada Athletic
Commission (NAC) event-result bulletin format (confirmed via public search
of boxing.nv.gov result PDFs: header with event/date/venue, per-bout lines
with a decision type and judges' scores like "98-90; 97-91; 98-90").

boxing.nv.gov is network-blocked in this environment, so real PDFs can't be
downloaded here. These fixtures let the parser (parse_pdfs.py) and the
aggregation logic (build_report_card.py) be built and tested end-to-end
today. Every name below is fictional. Swap this script out for a real
downloader once boxing.nv.gov (or an equivalent mirror) is reachable, and
the rest of the pipeline should keep working unchanged as long as real
PDFs match one of the two layouts modeled here.

Two layouts are generated to model the exact ambiguity the source data
carries: NAC bulletins are not guaranteed to label which score belongs to
which judge on every bout.
  - Layout A ("roster order"): judges are listed once in the event header;
    each bout's three scores are assumed to follow that same left-to-right
    order. This is an assumption, not a guarantee -- parse_pdfs.py marks
    rows extracted this way as alignment_confidence="assumed".
  - Layout B ("named per bout"): each bout explicitly labels judge name ->
    score. parse_pdfs.py marks these rows alignment_confidence="confirmed".
"""
import random
from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

random.seed(42)

FIXTURES_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "boxing" / "fixtures"

# Ground-truth judge bias model (points added toward Fighter A) + noise sd.
# Used only to generate plausible synthetic scores -- NOT fed into the
# aggregation pipeline, which must recover this signal purely from the
# generated "PDF" text like it would from a real one.
JUDGES = {
    "J. Alvarez":     {"bias": 0.0, "noise": 1.0},
    "R. Kimura":      {"bias": 0.0, "noise": 1.0},
    "D. Whitfield":   {"bias": 3.0, "noise": 1.5},   # consistent home-cook lean
    "S. Okafor":      {"bias": 0.0, "noise": 3.5},   # high variance / erratic
    "M. Delacroix":   {"bias": -1.5, "noise": 1.0},
    "T. Pruitt":      {"bias": 0.5, "noise": 1.2},
    "C. Ibsen":       {"bias": 0.0, "noise": 1.0},   # thin sample (< cutoff)
    "N. Farrow":      {"bias": 0.0, "noise": 1.0},   # thin sample (< cutoff)
}
THIN_JUDGES = {"C. Ibsen", "N. Farrow"}

FIGHTERS = [
    "Marcus Bellweather", "Andre Suchet", "Tyrell Osei", "Paulo Nakada",
    "Isaiah Ford", "Kenji Watanabe", "Devon Marchetti", "Ruben Castillo",
    "Elias Grant", "Hector Salomon", "Wade Fontaine", "Bruno Kessler",
    "Nate Ohara", "Victor Amaechi", "Leo Standish", "Tomas Reyes",
]

EVENTS = [
    ("Silverline Arena Fight Night 1",  "03-02-24", "Silverline Arena, Las Vegas, NV"),
    ("Copperfield Pavilion Showdown",   "06-14-24", "Copperfield Pavilion, Las Vegas, NV"),
    ("Desert Ring Classic",             "09-21-24", "Desert Ring Classic, Las Vegas, NV"),
    ("Harborline Fight Series 4",       "12-07-24", "Harborline Arena, Las Vegas, NV"),
    ("Silverline Arena Fight Night 2",  "02-15-25", "Silverline Arena, Las Vegas, NV"),
    ("Copperfield Pavilion Showdown 2", "05-10-25", "Copperfield Pavilion, Las Vegas, NV"),
    ("Desert Ring Classic 2",           "08-16-25", "Desert Ring Classic, Las Vegas, NV"),
    ("Harborline Fight Series 5",       "11-01-25", "Harborline Arena, Las Vegas, NV"),
]

decision_label = lambda diffs: (
    "Unanimous Decision" if len({d > 0 for d in diffs}) == 1
    else "Split Decision"
)


def gen_bout(fighter_a, fighter_b, judge_names):
    true_diff = random.choice([2, 3, 4, 6, 8, 10, -2, -3, -4])
    diffs, scores = [], []
    for j in judge_names:
        cfg = JUDGES[j]
        d = true_diff + cfg["bias"] + random.gauss(0, cfg["noise"])
        d = max(-16, min(16, round(d / 2) * 2))  # even, boxing-plausible spread
        diffs.append(d)
        a_score = 96 + d // 2
        b_score = 96 - d // 2
        scores.append((a_score, b_score))
    return diffs, scores, decision_label(diffs)


def render_layout_a(event_name, date, venue, bouts, judge_roster, path):
    c = canvas.Canvas(str(path), pagesize=letter)
    y = 750
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, y, "FICTIONAL STATE ATHLETIC COMMISSION -- FIXTURE DATA ONLY")
    y -= 20
    c.setFont("Helvetica-Bold", 12)
    c.drawString(50, y, f"Event: {event_name}")
    y -= 16
    c.setFont("Helvetica", 11)
    c.drawString(50, y, f"Date: {date}    Venue: {venue}")
    y -= 16
    c.drawString(50, y, f"Judges: {', '.join(judge_roster)}")
    y -= 26
    for i, (fa, fb, diffs, scores, decision) in enumerate(bouts, start=1):
        score_str = "; ".join(f"{a}-{b}" for a, b in scores)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(50, y, f"Bout {i}: {fa} vs. {fb}")
        y -= 14
        c.setFont("Helvetica", 10)
        c.drawString(60, y, f"Result: {fa} wins by {decision}")
        y -= 14
        c.drawString(60, y, f"Scores: {score_str}")
        y -= 20
    c.save()


def render_layout_b(event_name, date, venue, bouts, path):
    c = canvas.Canvas(str(path), pagesize=letter)
    y = 750
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, y, "FICTIONAL STATE ATHLETIC COMMISSION -- FIXTURE DATA ONLY")
    y -= 20
    c.setFont("Helvetica-Bold", 12)
    c.drawString(50, y, f"Event: {event_name}")
    y -= 16
    c.setFont("Helvetica", 11)
    c.drawString(50, y, f"Date: {date}    Venue: {venue}")
    y -= 26
    for i, (fa, fb, diffs, scores, decision, judge_names) in enumerate(bouts, start=1):
        c.setFont("Helvetica-Bold", 10)
        c.drawString(50, y, f"Bout {i}: {fa} vs. {fb}")
        y -= 14
        c.setFont("Helvetica", 10)
        c.drawString(60, y, f"Result: {fa} wins by {decision}")
        y -= 14
        for j, (a, b) in zip(judge_names, scores):
            c.drawString(60, y, f"Judge {j}: {a}-{b}")
            y -= 13
        y -= 8
    c.save()


def main():
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    fighter_pool = list(FIGHTERS)
    core_judges = [j for j in JUDGES if j not in THIN_JUDGES]

    for idx, (event_name, date, venue) in enumerate(EVENTS):
        layout_a = idx % 2 == 0
        n_bouts = random.randint(4, 6)
        pairs = random.sample(fighter_pool, n_bouts * 2)

        if layout_a:
            roster = random.sample(core_judges, 3)
            bouts = []
            for b in range(n_bouts):
                fa, fb = pairs[2 * b], pairs[2 * b + 1]
                judges_for_bout = roster
                # occasionally swap in a thin-sample judge to model rotation
                if random.random() < 0.15:
                    judges_for_bout = roster[:2] + [random.choice(list(THIN_JUDGES))]
                diffs, scores, decision = gen_bout(fa, fb, judges_for_bout)
                bouts.append((fa, fb, diffs, scores, decision))
            path = FIXTURES_DIR / f"{date}_LayoutA_{idx}.pdf"
            render_layout_a(event_name, date, venue, bouts, roster, path)
        else:
            bouts = []
            for b in range(n_bouts):
                fa, fb = pairs[2 * b], pairs[2 * b + 1]
                judges_for_bout = random.sample(core_judges, 3)
                if random.random() < 0.15:
                    judges_for_bout = judges_for_bout[:2] + [random.choice(list(THIN_JUDGES))]
                diffs, scores, decision = gen_bout(fa, fb, judges_for_bout)
                bouts.append((fa, fb, diffs, scores, decision, judges_for_bout))
            path = FIXTURES_DIR / f"{date}_LayoutB_{idx}.pdf"
            render_layout_b(event_name, date, venue, bouts, path)

        print(f"wrote {path.name}")


if __name__ == "__main__":
    main()
