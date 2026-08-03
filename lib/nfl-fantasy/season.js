// NFL season "year" runs Sept-Feb; before March it's still last season's
// playoffs/offseason, so anything asking "what season is it" (rankings
// refresh, Sleeper league lookup) should target the season about to start.
export function currentNflSeason(now = new Date()) {
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}
