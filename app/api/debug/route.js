export async function GET() {
  // Quick Claude smoke test
  let claudeOk = false;
  let claudeError = null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 20,
        messages: [{ role: "user", content: "reply: ok" }],
      }),
    });
    const d = await res.json();
    claudeOk = !!d.content?.[0]?.text;
    if (!claudeOk) claudeError = JSON.stringify(d).slice(0, 200);
  } catch (e) {
    claudeError = e.message;
  }

  return Response.json({
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    hasSportsDataKey: !!process.env.SPORTSDATA_API_KEY,
    hasSportsGameOddsKey: !!process.env.SPORTSGAMEODDS_API_KEY,
    claudeOk,
    claudeError,
  });
}
