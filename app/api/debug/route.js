export async function GET() {
  return Response.json({
    hasOddsKey: !!process.env.ODDS_API_KEY,
    keyLength: process.env.ODDS_API_KEY?.length,
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
  });
}
