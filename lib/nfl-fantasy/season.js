// NFL season "year" runs Sept-Feb; before March it's still last season's
// playoffs/offseason, so anything computed "for this season" should target
// the season about to start (or already underway). Shared by the rankings
// cron and the in-season nflverse-refresh cron so they can't drift onto
// different target seasons.
export function currentNflSeason(now = new Date()) {
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}
