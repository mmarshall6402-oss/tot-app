// app/api/free-pick/route.js
// Delegates to /api/picks and returns the single highest-edge BET pick
// This ensures the free pick always uses the same model as the main picks page

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function GET() {
  try {
    const date = new Date().toISOString().split("T")[0];

    // Fetch today's picks from the main model
    const res  = await fetch(`${BASE_URL}/api/picks?date=${date}`);
    const data = await res.json();
    const picks = data?.picks || [];

    // Return the top BET pick (already sorted by edge descending)
    const topBet = picks.find(p => p.isBet);

    // Fallback: if no BET picks today, return the highest-edge pick regardless
    const pick = topBet || picks[0] || null;

    return Response.json({ pick });
  } catch (e) {
    return Response.json({ pick: null, error: e.message });
  }
}
