# T|T Picks — MLB Analytics Dashboard
# Run: streamlit run streamlit_app/app.py
from pathlib import Path
import json

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Validated palette (see project dataviz reference) — light-surface values.
CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"]
SEQUENTIAL_BLUE = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]
GOOD, CRITICAL = "#0ca30c", "#d03b3b"
INK_PRIMARY, INK_SECONDARY, INK_MUTED = "#0b0b0b", "#52514e", "#898781"
GRID, SURFACE = "#e1e0d9", "#fcfcfb"
FONT = "system-ui, -apple-system, Segoe UI, sans-serif"

st.set_page_config(page_title="T|T Picks — MLB Dashboard", page_icon="⚾", layout="wide")


ELO_VARIANTS = {
    "Overall": "overall",
    "Home": "home",
    "Away": "away",
    "vs LHP": "vsLHP",
    "vs RHP": "vsRHP",
    "Bullpen (index)": "bullpen",
    "Last 30 Days": "last30",
}


@st.cache_data
def load_data():
    with open(DATA_DIR / "games.json") as f:
        games = json.load(f)
    with open(DATA_DIR / "elo_ratings.json") as f:
        elo = json.load(f)

    df = pd.DataFrame(games)
    df["date"] = pd.to_datetime(df["date"], format="%Y%m%d")
    df["season"] = df["date"].dt.year
    df["homeWon"] = df["homeWon"].astype(bool)
    df["winner"] = df["homeTeam"].where(df["homeWon"], df["awayTeam"])
    df["totalRuns"] = df["homeScore"] + df["awayScore"]

    elo_df = (
        pd.Series(elo, name="elo")
        .rename_axis("team")
        .reset_index()
        .sort_values("elo", ascending=True, ignore_index=True)
    )

    splits_path = DATA_DIR / "elo_splits.json"
    elo_splits_df = pd.DataFrame()
    if splits_path.exists():
        with open(splits_path) as f:
            elo_splits_df = pd.DataFrame.from_dict(json.load(f), orient="index")

    calibration_path = DATA_DIR / "calibration_curve.json"
    calibration = None
    if calibration_path.exists():
        with open(calibration_path) as f:
            calibration = json.load(f)

    return df, elo_df, elo_splits_df, calibration


def style_fig(fig, title, x_title=None, y_title=None, height=380, show_legend=False):
    fig.update_layout(
        title=dict(text=title, font=dict(color=INK_PRIMARY, size=16), x=0),
        font=dict(family=FONT, color=INK_SECONDARY, size=13),
        paper_bgcolor=SURFACE,
        plot_bgcolor=SURFACE,
        height=height,
        margin=dict(l=10, r=10, t=50, b=10),
        showlegend=show_legend,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0),
        xaxis=dict(title=x_title, gridcolor=GRID, zerolinecolor=GRID, tickfont=dict(color=INK_MUTED)),
        yaxis=dict(title=y_title, gridcolor=GRID, zerolinecolor=GRID, tickfont=dict(color=INK_MUTED)),
    )
    return fig


def sequential_colors(values):
    lo, hi = values.min(), values.max()
    span = hi - lo or 1
    steps = len(SEQUENTIAL_BLUE)
    return [SEQUENTIAL_BLUE[min(int((v - lo) / span * steps), steps - 1)] for v in values]


df, elo_df, elo_splits_df, calibration = load_data()

st.title("⚾ T|T Picks — MLB Analytics Dashboard")
st.caption("Built on the same Elo ratings, game logs, and calibration pipeline that power the T|T Picks prediction model.")

all_teams = sorted(set(df["homeTeam"]) | set(df["awayTeam"]))
seasons = sorted(df["season"].unique())

with st.sidebar:
    st.header("Filters")
    st.caption("Applies to the Team Analytics tab only — Model Calibration is season-independent by design.")
    season_sel = st.multiselect("Season", seasons, default=seasons)
    team_sel = st.selectbox("Team", ["All teams"] + all_teams)

tab_team, tab_model = st.tabs(["Team Analytics", "Model Calibration"])

# ============================================================================
# Tab 1 — Team Analytics
# ============================================================================
with tab_team:
    if not season_sel:
        st.warning("Select at least one season.")
    else:
        season_games = df[df["season"].isin(season_sel)]
        team_games = (
            season_games[(season_games["homeTeam"] == team_sel) | (season_games["awayTeam"] == team_sel)]
            if team_sel != "All teams"
            else season_games
        )

        # --- KPI row ---------------------------------------------------
        col1, col2, col3, col4 = st.columns(4)
        col1.metric("Games in view", f"{len(team_games):,}")

        if team_sel != "All teams":
            wins = int((team_games["winner"] == team_sel).sum())
            losses = len(team_games) - wins
            win_pct = wins / len(team_games) if len(team_games) else 0
            team_elo = elo_df.loc[elo_df["team"] == team_sel, "elo"]
            col2.metric(f"{team_sel} record", f"{wins}-{losses}")
            col3.metric("Win %", f"{win_pct:.1%}")
            col4.metric("Current Elo", f"{team_elo.iloc[0]:,.0f}" if len(team_elo) else "—")
        else:
            col2.metric("Seasons covered", len(season_sel))
            col3.metric("Avg total runs / game", f"{team_games['totalRuns'].mean():.2f}" if len(team_games) else "—")
            col4.metric("League home win %", f"{team_games['homeWon'].mean():.1%}" if len(team_games) else "—")

        st.divider()

        # --- Elo power rankings -----------------------------------------
        st.subheader("Elo Power Rankings")

        if not elo_splits_df.empty:
            variant_label = st.radio("Rating", list(ELO_VARIANTS.keys()), horizontal=True)
            variant_key = ELO_VARIANTS[variant_label]
            rank_df = (
                elo_splits_df[variant_key]
                .dropna()
                .rename("elo")
                .rename_axis("team")
                .reset_index()
                .sort_values("elo", ascending=True, ignore_index=True)
            )
            captions = {
                "overall": "Current overall Elo rating for every team — a full snapshot, independent of the season filter.",
                "home": "Elo computed only from games played at home.",
                "away": "Elo computed only from games played on the road.",
                "vsLHP": "Elo computed only from games where the team's lineup faced a left-handed starter.",
                "vsRHP": "Elo computed only from games where the team's lineup faced a right-handed starter.",
                "bullpen": "A synthetic index rescaled from rolling bullpen ERA — not a textbook Elo (bullpens don't have their own wins/losses), but plotted on the same 1500-centered scale for comparison.",
                "last30": "A fresh Elo computed using only the trailing 30 days of games — recent form, not blended with full-season strength.",
            }
            st.caption(captions[variant_key])
        else:
            rank_df = elo_df
            st.caption("Current Elo rating for every team — a full snapshot, independent of the season filter.")

        colors = sequential_colors(rank_df["elo"])
        bar_colors = [CRITICAL if t == team_sel else c for t, c in zip(rank_df["team"], colors)]
        fig_elo = go.Figure(go.Bar(x=rank_df["elo"], y=rank_df["team"], orientation="h", marker_color=bar_colors))
        st.plotly_chart(style_fig(fig_elo, "", x_title="Elo rating", height=720), use_container_width=True)

        left, right = st.columns(2)

        # --- Home field advantage by season ------------------------------
        with left:
            st.subheader("Home Field Advantage")
            by_season = season_games.groupby("season", as_index=False)["homeWon"].mean()
            fig_home = go.Figure(
                go.Bar(x=by_season["season"], y=by_season["homeWon"], marker_color=CATEGORICAL[0], name="Home win %")
            )
            fig_home.add_hline(y=0.5, line_dash="dash", line_color=INK_MUTED)
            fig_home.update_yaxes(tickformat=".0%")
            st.plotly_chart(style_fig(fig_home, "Home win % by season", y_title="Home win %"), use_container_width=True)

        # --- Runs scored distribution -------------------------------------
        with right:
            st.subheader("Scoring Environment")
            fig_runs = go.Figure(
                go.Histogram(x=team_games["totalRuns"], marker_color=SEQUENTIAL_BLUE[3], xbins=dict(size=1))
            )
            st.plotly_chart(
                style_fig(fig_runs, "Total runs scored per game", x_title="Total runs", y_title="Games"),
                use_container_width=True,
            )

        # --- Team trend + recent games -------------------------------------
        if team_sel != "All teams":
            st.divider()
            left2, right2 = st.columns([3, 2])

            with left2:
                st.subheader(f"{team_sel} — Win % by Season")
                trend = (
                    team_games.assign(win=team_games["winner"] == team_sel)
                    .groupby("season", as_index=False)["win"]
                    .mean()
                )
                fig_trend = go.Figure(
                    go.Scatter(
                        x=trend["season"],
                        y=trend["win"],
                        mode="lines+markers",
                        line=dict(color=CATEGORICAL[0], width=2),
                        marker=dict(size=8, color=CATEGORICAL[0]),
                    )
                )
                fig_trend.add_hline(y=0.5, line_dash="dash", line_color=INK_MUTED)
                fig_trend.update_xaxes(dtick=1, tickformat="d")
                fig_trend.update_yaxes(tickformat=".0%")
                st.plotly_chart(style_fig(fig_trend, "", y_title="Win %"), use_container_width=True)

            with right2:
                if not elo_splits_df.empty and team_sel in elo_splits_df.index:
                    st.subheader("Elo Breakdown")
                    team_row = elo_splits_df.loc[team_sel]
                    league_avg = elo_splits_df.mean(numeric_only=True)
                    breakdown = pd.DataFrame(
                        {
                            "Metric": list(ELO_VARIANTS.keys()),
                            team_sel: [team_row.get(k) for k in ELO_VARIANTS.values()],
                            "League Avg": [round(league_avg.get(k), 1) for k in ELO_VARIANTS.values()],
                        }
                    )
                    st.dataframe(breakdown, use_container_width=True, hide_index=True)

                st.subheader("Recent Games")
                recent = team_games.sort_values("date", ascending=False).head(15).copy()
                is_home = recent["homeTeam"] == team_sel
                recent["Result"] = recent["winner"].eq(team_sel).map({True: "W", False: "L"})
                recent["Opponent"] = recent["awayTeam"].where(is_home, recent["homeTeam"])
                # Always team's score first, opponent's second — regardless of home/away.
                recent["Score"] = recent["homeScore"].where(is_home, recent["awayScore"]).astype(str) + "–" + \
                    recent["awayScore"].where(is_home, recent["homeScore"]).astype(str)
                recent["Date"] = recent["date"].dt.strftime("%b %-d, %Y")

                def color_result(val):
                    color = GOOD if val == "W" else CRITICAL
                    return f"color: {color}; font-weight: 600"

                table = recent[["Date", "Opponent", "Score", "Result"]].reset_index(drop=True)
                st.dataframe(
                    table.style.map(color_result, subset=["Result"]),
                    use_container_width=True,
                    hide_index=True,
                )
        else:
            st.info("Pick a team in the sidebar to see its season trend and recent results.")

# ============================================================================
# Tab 2 — Model Calibration
# ============================================================================
with tab_model:
    if not calibration:
        st.warning(
            "No calibration data found. Run `npm run calibration-curve` to generate "
            "data/calibration_curve.json from data/calibration/historical-rows.json."
        )
    else:
        st.subheader("Model Calibration — raw vs. isotonic-corrected")
        train_seasons = ", ".join(calibration["trainSeasons"])
        st.caption(
            f"Isotonic curve fit on {train_seasons} ({calibration['trainGameCount']:,} games). "
            "The chart below evaluates it on the held-out 2025 season only — games the curve "
            "never saw during fitting — so this is a genuine out-of-sample result, not an "
            "in-sample fit shown back to itself."
        )

        view = calibration.get("holdout") or calibration["all"]
        view_label = "2025 holdout (out-of-sample)" if calibration.get("holdout") else "all seasons (in-sample)"

        raw_buckets = pd.DataFrame(view["raw"]["buckets"]).dropna(subset=["actual"])
        cal_buckets = pd.DataFrame(view["calibrated"]["buckets"]).dropna(subset=["actual"])

        kcol1, kcol2, kcol3 = st.columns(3)
        kcol1.metric("Evaluation set", "2025 (holdout)" if calibration.get("holdout") else "All seasons", help=f"{view_label} — N = {view['raw']['n']:,} games")
        kcol2.metric("Brier score — raw", f"{view['raw']['brier']:.4f}")
        kcol3.metric(
            "Brier score — calibrated",
            f"{view['calibrated']['brier']:.4f}",
            delta=f"{view['calibrated']['brier'] - view['raw']['brier']:.4f}",
            delta_color="inverse",
        )

        fig_cal = go.Figure()
        fig_cal.add_trace(
            go.Scatter(
                x=[0, 1], y=[0, 1], mode="lines",
                line=dict(dash="dash", color=INK_MUTED, width=1.5),
                name="Perfect calibration",
                hoverinfo="skip",
            )
        )
        # x = the true mean predicted probability of the games actually inside
        # each bucket (NOT the fixed bin midpoint) — a real value that scatters
        # game-by-game, not a synthetic stand-in.
        fig_cal.add_trace(
            go.Scatter(
                x=raw_buckets["meanPredicted"], y=raw_buckets["actual"],
                mode="lines+markers",
                line=dict(color=CRITICAL, width=2),
                marker=dict(size=9, color=CRITICAL),
                name=f"Raw model (Brier {view['raw']['brier']:.3f})",
                customdata=raw_buckets["n"],
                hovertemplate="Mean predicted %{x:.1%} · Actual %{y:.1%}<br>n=%{customdata}<extra>Raw</extra>",
            )
        )
        fig_cal.add_trace(
            go.Scatter(
                x=cal_buckets["meanPredicted"], y=cal_buckets["actual"],
                mode="lines+markers",
                line=dict(color=GOOD, width=2),
                marker=dict(size=9, color=GOOD),
                name=f"Isotonic-calibrated (Brier {view['calibrated']['brier']:.3f})",
                customdata=cal_buckets["n"],
                hovertemplate="Mean predicted %{x:.1%} · Actual %{y:.1%}<br>n=%{customdata}<extra>Calibrated</extra>",
            )
        )
        fig_cal.update_xaxes(tickformat=".0%", range=[0.1, 0.9])
        fig_cal.update_yaxes(tickformat=".0%", range=[0.1, 0.9])
        st.caption("Predicted probability vs. actual win rate")
        fig_cal = style_fig(
            fig_cal, "",
            x_title="Predicted win probability", y_title="Actual win rate",
            height=460, show_legend=True,
        )
        st.plotly_chart(fig_cal, use_container_width=True)
        st.caption(
            "The raw model is systematically overconfident at the extremes — underdogs win more "
            "often than predicted, favorites win less often than predicted. The isotonic "
            "correction pulls both tails back toward y = x. Lower Brier score is better "
            "(0 = perfect, 0.25 = uninformative coin-flip baseline)."
        )
        st.caption(
            "Each series buckets games by its own probability — raw model probability for the red "
            "line, isotonic-calibrated probability for the green line — so the same bucket label "
            "(e.g. 15–22%) can hold a different set of games in each series, and \"actual\" is that "
            "series' own win rate for its own games. That's why the calibrated series has no dashes "
            "at the extremes to fill: the correction moves games out of the 15–36% and 78–85% bands "
            "entirely, because the raw model's overconfident predictions in that range don't survive "
            "calibration. It also means a single bucket can look like it moved the \"wrong\" way "
            "between series without the calibration being wrong — it's comparing two different game "
            "sets, not the same games re-scored. The Brier scores above are the only apples-to-apples "
            "comparison."
        )

        with st.expander("Bucket-level detail"):
            bucket_order = {label: i for i, label in enumerate(raw_buckets["label"])}
            raw_detail = raw_buckets[["label", "n", "meanPredicted", "actual"]].rename(
                columns={"n": "N (raw)", "meanPredicted": "Predicted (raw)", "actual": "Win rate (raw bucket)"}
            )
            cal_detail = cal_buckets[["label", "n", "meanPredicted", "actual"]].rename(
                columns={"n": "N (calibrated)", "meanPredicted": "Predicted (calibrated)", "actual": "Win rate (calibrated bucket)"}
            )
            detail = raw_detail.merge(cal_detail, on="label", how="outer")
            detail["_order"] = detail["label"].map(bucket_order)
            detail = detail.sort_values("_order").drop(columns="_order").rename(columns={"label": "Bucket"})
            detail = detail[
                ["Bucket", "N (raw)", "Predicted (raw)", "Win rate (raw bucket)",
                 "N (calibrated)", "Predicted (calibrated)", "Win rate (calibrated bucket)"]
            ]
            pct = lambda v: f"{v:.1%}" if pd.notna(v) else "—"
            n_fmt = lambda v: f"{v:.0f}" if pd.notna(v) else "—"
            for col in ["Predicted (raw)", "Win rate (raw bucket)", "Predicted (calibrated)", "Win rate (calibrated bucket)"]:
                detail[col] = detail[col].map(pct)
            for col in ["N (raw)", "N (calibrated)"]:
                detail[col] = detail[col].map(n_fmt)
            st.dataframe(detail, use_container_width=True, hide_index=True)
