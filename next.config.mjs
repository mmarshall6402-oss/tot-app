/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  reactCompiler: true,
  // lib/elo-db.js reads a seed file via a dynamically-constructed path
  // (readFileSync(join(process.cwd(), seedFile))), which Next's file tracer
  // can't statically resolve — it falls back to over-including, dragging the
  // entire data/retrosheet/ corpus (100+ files, tens of MB) and the backtest
  // odds spreadsheet into every route that touches lib/elo-db.js, including
  // app/api/cron/picks (which has nothing to do with backtesting). Only the
  // backtest admin route actually needs that data.
  outputFileTracingExcludes: {
    "/*": ["./data/retrosheet/**/*", "./data/odds/**/*"],
  },
  outputFileTracingIncludes: {
    "/api/admin/backtest": ["./data/retrosheet/**/*", "./data/odds/**/*"],
  },
};

export default nextConfig;
