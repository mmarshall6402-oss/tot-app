// app/api/cron/picks/route.js
// Runs at 3 PM UTC (10 AM CT) daily.
// Sends a lightweight SQS message and returns immediately — all heavy work
// (odds fetch, Claude call, Supabase writes) runs in the AWS Lambda function.
// This eliminates Vercel's serverless timeout as a failure mode for picks generation.

import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { timingSafeEqual } from "../../../../lib/auth.js";

const sqs = new SQSClient({ region: process.env.AWS_PICKS_REGION || "us-east-1" });

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = new URL(request.url).searchParams.get("force") === "1";

  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.PICKS_QUEUE_URL,
        MessageBody: JSON.stringify({ force, trigger: "cron", triggeredAt: new Date().toISOString() }),
      })
    );

    return Response.json({ queued: true, force });
  } catch (err) {
    console.error("[cron/picks] failed to enqueue SQS message:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
