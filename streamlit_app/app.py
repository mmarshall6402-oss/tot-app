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


@st.cache_data
def load_data():
    with open(DATA_DIR / "games.json") as f:
        games = json.load(f)
    with open(DATA_DIR / "elo_ratings.json") as f:
        elo = json.load(f)

    df = pd.DataFrame(games)
    df["date"] = pd.to_datetime(df["date"], format="%Y%m%d")
    df["season"] = df["date"].dt.year
    df["winner"] = df["homeTeam"].where(df["homeWon"], df["awayTeam"])
    df["totalRuns"] = df["homeScore"] + df["awayScore"]

    elo_df = (
        pd.Series(elo, name="elo")
        .rename_axis("team")
        .reset_index()
        .sort_values("elo", ascending=True, ignore_index=True)
    )
    return df, elo_df


def style_fig(fig, title, x_title=None, y_title=None, height=380):
    fig.update_layout(
        title=dict(text=title, font=dict(color=INK_PRIMARY, size=16), x=0),
        font=dict(family=FONT, color=INK_SECONDARY, size=13),
        paper_bgcolor=SURFACE,
        plot_bgcolor=SURFACE,
        height=height,
        margin=dict(l=10, r=10, t=50, b=10),
        showlegend=False,
        xaxis=dict(title=x_title, gridcolor=GRID, zerolinecolor=GRID, tickfont=dict(color=INK_MUTED)),
        yaxis=dict(title=y_title, gridcolor=GRID, zerolinecolor=GRID, tickfont=dict(color=INK_MUTED)),
    )
    return fig


def sequential_colors(values):
    lo, hi = values.min(), values.max()
    span = hi - lo or 1
    steps = len(SEQUENTIAL_BLUE)
    return [SEQUENTIAL_BLUE[min(int((v - lo) / span * steps), steps - 1)] for v in values]


df, elo_df = load_data()

st.title("⚾ T|T Picks — MLB Analytics Dashboard")
st.caption("Built on the same Elo ratings and 2022–2025 game logs that power the T|T Picks prediction model.")

all_teams = sorted(set(df["homeTeam"]) | set(df["awayTeam"]))
seasons = sorted(df["season"].unique())

with st.sidebar:
    st.header("Filters")
    season_sel = st.multiselect("Season", seasons, default=seasons)
    team_sel = st.selectbox("Team", ["All teams"] + all_teams)

season_games = df[df["season"].isin(season_sel)]
team_games = (
    season_games[(season_games["homeTeam"] == team_sel) | (season_games["awayTeam"] == team_sel)]
    if team_sel != "All teams"
    else season_games
)

# --- KPI row ---------------------------------------------------------------
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

# --- Elo power rankings ------------------------------------------------
st.subheader("Elo Power Rankings")
st.caption("Current Elo rating for every team — a full snapshot, independent of the season filter.")
colors = sequential_colors(elo_df["elo"])
bar_colors = [CRITICAL if t == team_sel else c for t, c in zip(elo_df["team"], colors)]
fig_elo = go.Figure(go.Bar(x=elo_df["elo"], y=elo_df["team"], orientation="h", marker_color=bar_colors))
st.plotly_chart(style_fig(fig_elo, "", x_title="Elo rating", height=720), use_container_width=True)

left, right = st.columns(2)

# --- Home field advantage by season ----------------------------------------
with left:
    st.subheader("Home Field Advantage")
    by_season = season_games.groupby("season", as_index=False)["homeWon"].mean()
    fig_home = go.Figure(
        go.Bar(x=by_season["season"], y=by_season["homeWon"], marker_color=CATEGORICAL[0], name="Home win %")
    )
    fig_home.add_hline(y=0.5, line_dash="dash", line_color=INK_MUTED)
    fig_home.update_yaxes(tickformat=".0%")
    st.plotly_chart(style_fig(fig_home, "Home win % by season", y_title="Home win %"), use_container_width=True)

# --- Runs scored distribution -----------------------------------------------
with right:
    st.subheader("Scoring Environment")
    fig_runs = go.Figure(
        go.Histogram(x=team_games["totalRuns"], marker_color=SEQUENTIAL_BLUE[3], xbins=dict(size=1))
    )
    st.plotly_chart(
        style_fig(fig_runs, "Total runs scored per game", x_title="Total runs", y_title="Games"),
        use_container_width=True,
    )

# --- Team trend + recent games ----------------------------------------------
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
        st.subheader("Recent Games")
        recent = team_games.sort_values("date", ascending=False).head(15).copy()
        recent["Result"] = recent["winner"].eq(team_sel).map({True: "W", False: "L"})
        recent["Opponent"] = recent.apply(
            lambda r: r["awayTeam"] if r["homeTeam"] == team_sel else r["homeTeam"], axis=1
        )
        recent["Score"] = recent.apply(lambda r: f"{r['awayScore']}–{r['homeScore']}", axis=1)
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
