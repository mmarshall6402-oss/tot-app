import Link from "next/link";
import { getJudgeReportCard } from "../../lib/boxing/report.js";
import { tokens } from "../../lib/ui-theme.js";

const t = tokens;

function fmtSigned(n) {
  if (n == null) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

export const metadata = { title: "Judge Report Card | T|T Picks" };

export default function BoxingJudgeReportCard() {
  const data = getJudgeReportCard();

  return (
    <div style={{ minHeight: "100vh", background: t.color.bg, color: t.color.textPrimary, fontFamily: t.font.body, padding: "40px 20px 80px", maxWidth: 900, margin: "0 auto" }}>
      <style>{`@import url('${"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap"}'); *{box-sizing:border-box;} table{border-collapse:collapse;width:100%;} th,td{text-align:left;padding:10px 12px;font-size:13px;} th{font-size:10px;letter-spacing:1px;color:${t.color.textSecondary};text-transform:uppercase;border-bottom:1px solid ${t.color.border};} tr+tr td{border-top:1px solid ${t.color.border};}`}</style>

      <Link href="/" style={{ fontSize: 13, color: t.color.textMuted, textDecoration: "none" }}>← Back</Link>

      <h1 style={{ fontFamily: t.font.display, fontSize: 30, fontWeight: 600, margin: "20px 0 6px" }}>Judge Report Card</h1>
      <p style={{ color: t.color.textSecondary, fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
        Per-judge deviation from the median scorecard, aggregated across parsed event results.
      </p>

      {!data ? (
        <p style={{ color: t.color.red }}>No report data found. Run the boxing pipeline scripts first (see README).</p>
      ) : (
        <>
          {data.source === "SYNTHETIC_FIXTURE_DATA" && (
            <div style={{ background: `${t.color.yellow}1a`, border: `1px solid ${t.color.yellow}`, borderRadius: t.radius.md, padding: "12px 14px", marginBottom: 24, fontSize: 13, lineHeight: 1.6, color: t.color.textPrimary }}>
              <strong>⚠ Synthetic fixture data.</strong> {data.source_note}
            </div>
          )}

          <div style={{ display: "flex", gap: 20, marginBottom: 24, fontSize: 13, color: t.color.textSecondary }}>
            <span><strong style={{ color: t.color.textPrimary }}>{data.judges.length}</strong> judges</span>
            <span><strong style={{ color: t.color.textPrimary }}>{data.total_fights_parsed}</strong> fights parsed</span>
            <span>min. {data.min_fights_cutoff} fights to rank</span>
            <span>generated {new Date(data.generated_at).toLocaleDateString()}</span>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Judge</th>
                  <th>Fights</th>
                  <th>Mean |Deviation|</th>
                  <th>Signed Bias</th>
                  <th>Deviation Variance</th>
                  <th>Odd-Card-Out Rate</th>
                  <th>Assumed Alignment</th>
                </tr>
              </thead>
              <tbody>
                {data.judges.map((j) => (
                  <tr key={j.judge} style={{ opacity: j.insufficient_sample ? 0.5 : 1 }}>
                    <td style={{ fontWeight: 600 }}>
                      {j.judge}
                      {j.insufficient_sample && (
                        <span style={{ marginLeft: 8, fontSize: 10, color: t.color.textMuted, fontWeight: 400 }}>
                          insufficient sample
                        </span>
                      )}
                    </td>
                    <td style={{ fontFamily: t.font.mono }}>{j.n_fights}</td>
                    <td style={{ fontFamily: t.font.mono }}>{j.mean_abs_deviation}</td>
                    <td style={{ fontFamily: t.font.mono, color: j.signed_bias > 0.5 ? t.color.orange : j.signed_bias < -0.5 ? t.color.red : t.color.textPrimary }}>
                      {fmtSigned(j.signed_bias)}
                    </td>
                    <td style={{ fontFamily: t.font.mono }}>{j.deviation_variance ?? "—"}</td>
                    <td style={{ fontFamily: t.font.mono }}>{(j.odd_card_out_rate * 100).toFixed(1)}%</td>
                    <td style={{ fontFamily: t.font.mono, color: t.color.textSecondary }}>{j.pct_rows_assumed_alignment}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 28, fontSize: 12, color: t.color.textMuted, lineHeight: 1.8 }}>
            <strong style={{ color: t.color.textSecondary }}>Methodology.</strong>{" "}Deviation is a judge&apos;s scored
            point margin minus the median margin among all judges on that bout. &quot;Assumed alignment&quot; is the
            share of a judge&apos;s rows where the source PDF didn&apos;t explicitly label which score belonged to
            which judge — those rows are inferred from a fixed judge-roster order and should be weighted with more
            caution. Judges below the minimum-fights cutoff are shown but not ranked, to avoid presenting thin
            samples as signal.
          </div>
        </>
      )}
    </div>
  );
}
