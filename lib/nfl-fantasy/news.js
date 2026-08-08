// ESPN's public news feed (site.api.espn.com) — same unofficial-API family
// and defensive-parse posture as lib/nfl-roster.js: free, no key, degrades to
// [] on any fetch/shape failure rather than throwing, so the news route can
// still return the injury report when ESPN is unavailable.

const ESPN_NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news";
const NEWS_TTL = 1000 * 60 * 15;

let _newsCache = null;
let _newsCacheTime = 0;

function toHeadline(article) {
  return {
    id: article?.id ?? null,
    headline: article?.headline || null,
    description: article?.description || null,
    published: article?.published || null,
    link: article?.links?.web?.href || null,
    image: article?.images?.[0]?.url || null,
  };
}

export async function fetchNFLHeadlines(limit = 20) {
  if (_newsCache && Date.now() - _newsCacheTime < NEWS_TTL) return _newsCache.slice(0, limit);
  try {
    const res = await fetch(`${ESPN_NEWS_URL}?limit=${limit}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`ESPN news ${res.status}`);
    const json = await res.json();
    const headlines = (json?.articles || []).map(toHeadline).filter(a => a.headline);
    _newsCache = headlines;
    _newsCacheTime = Date.now();
    return headlines.slice(0, limit);
  } catch {
    return _newsCache ? _newsCache.slice(0, limit) : [];
  }
}
