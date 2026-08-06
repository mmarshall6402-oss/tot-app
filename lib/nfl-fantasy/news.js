// ESPN's public news feed — same site.api.espn.com host and UNVERIFIED-until-
// exercised-live posture as lib/nfl-roster.js (this environment's outbound
// access to ESPN is blocked, so the endpoint/shape below is from ESPN's
// well-established public site-API family, not confirmed against a live
// call here). Parsed defensively and degrades to [] on any failure/shape
// mismatch, matching every other external fetch in lib/nfl-fantasy/* —
// a broken news feed should never take down the tracker page around it.
import { findMentionedNFLPlayers } from "../nfl-roster.js";

const ESPN_NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=25";
const NEWS_TTL = 1000 * 60 * 15;

let _newsCache = null;
let _newsCacheTime = 0;

async function fetchRawArticles() {
  const res = await fetch(ESPN_NEWS_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`ESPN news ${res.status}`);
  const json = await res.json();
  return Array.isArray(json?.articles) ? json.articles : [];
}

// Tags each headline with any rostered players mentioned in its
// headline+description, via the same scan findMentionedNFLPlayers already
// runs for the fantasy Q&A tool — no separate player-matching logic to keep
// in sync.
export async function fetchNFLNews() {
  if (_newsCache && Date.now() - _newsCacheTime < NEWS_TTL) return _newsCache;
  try {
    const articles = await fetchRawArticles();
    const tagged = await Promise.all(articles.map(async (a) => {
      const headline = a?.headline || null;
      const description = a?.description || "";
      if (!headline) return null;
      const mentioned = await findMentionedNFLPlayers(`${headline} ${description}`);
      return {
        headline,
        description: description || null,
        published: a?.published || null,
        url: a?.links?.web?.href || null,
        mentionedPlayers: mentioned.map((p) => ({ espnId: String(p.id), name: p.name, team: p.team, position: p.position })),
      };
    }));
    const result = tagged.filter(Boolean);
    _newsCache = result;
    _newsCacheTime = Date.now();
    return result;
  } catch (e) {
    console.warn("[nfl-fantasy/news] fetch failed:", e.message);
    return _newsCache || [];
  }
}
