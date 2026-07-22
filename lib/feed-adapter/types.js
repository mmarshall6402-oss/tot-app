/**
 * lib/feed-adapter/types.js
 *
 * Shared shape contract for FeedAdapters — JSDoc only, no runtime type checking.
 * Downstream code (pick-building, UI) should only ever depend on NormalizedOdds,
 * never on a specific adapter's raw response shape.
 *
 * @typedef {Object} NormalizedOdds
 * @property {string} event_id
 * @property {string} market      - e.g. "moneyline", "pitcher_strikeouts", "batter_home_runs"
 * @property {string} selection   - e.g. a team name or "{player} Over"
 * @property {number|null} line
 * @property {number|null} book_price   - American odds
 * @property {number|null} your_prob    - this app's own model probability (0-1)
 * @property {number|null} fair_prob    - de-vigged market-implied probability (0-1)
 * @property {number|null} edge         - your_prob - fair_prob; null unless both present
 *
 * @typedef {Object} FeedAdapter
 * @property {string} key
 * @property {string[]} markets
 * @property {string[]} regions
 * @property {number} refreshCadenceMs
 * @property {(items: any[]) => number} estimateCredits  - pure, no network; call BEFORE fetch
 * @property {(ctx: object) => Promise<any[]>} fetch
 * @property {(raw: any[], modelOutputs: any) => NormalizedOdds[]} normalize
 */

// Pre-fetch trim only. Callers must already have `orderedItems` sorted by signals
// that exist BEFORE the fetch (lineup-confirmed, soonest commenceTime, today before
// tomorrow, etc.) — never by edge or model probability, neither of which exists
// until after the fetch this trims runs. See lib/feed-adapter/mlb-props.js for the
// concrete ordering it expects from its caller.
export class CreditBudget {
  constructor(ceilingCredits) {
    this.ceiling = ceilingCredits;
  }

  trim(orderedItems, creditsPerItem) {
    if (!creditsPerItem || creditsPerItem <= 0) return orderedItems;
    const maxItems = Math.floor(this.ceiling / creditsPerItem);
    return orderedItems.slice(0, Math.max(0, maxItems));
  }
}
