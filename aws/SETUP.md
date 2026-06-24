# AWS Setup — Picks Generator

## Prerequisites

```bash
npm install -g aws-sam-cli
aws configure  # set Access Key ID, Secret, region (us-east-1 recommended)
```

## First deploy

```bash
cd aws

# Build (esbuild bundles the Lambda + lib files)
sam build

# Deploy interactively — fills in parameters and creates a samconfig.toml for future runs
sam deploy --guided \
  --parameter-overrides \
    SupabaseUrl="https://YOUR_PROJECT.supabase.co" \
    SupabaseServiceRoleKey="YOUR_SERVICE_ROLE_KEY" \
    AnthropicApiKey="YOUR_ANTHROPIC_KEY" \
    TheOddsApiKey="YOUR_ODDS_API_KEY" \
    SportsGameOddsApiKey="YOUR_SGO_KEY" \
    AppUrl="https://YOUR_APP.vercel.app"
```

## After deploying

Copy the `PicksQueueUrl` from the Outputs section. Add these to Vercel environment variables:

| Variable | Value |
|---|---|
| `PICKS_QUEUE_URL` | The SQS queue URL from Outputs |
| `AWS_PICKS_REGION` | `us-east-1` (or whichever region you deployed to) |
| `AWS_ACCESS_KEY_ID` | IAM user with `sqs:SendMessage` permission on the queue |
| `AWS_SECRET_ACCESS_KEY` | Corresponding secret |

## Subsequent deploys

```bash
cd aws
sam build && sam deploy
```

## Monitoring

- **CloudWatch Logs**: `/aws/lambda/tot-picks-generator`
- **DLQ**: `tot-picks-dlq` — any messages here mean the Lambda threw an unhandled error. Check the logs.
- **Vercel logs**: the cron route now just logs `{ queued: true }` — if you see an error here it means the SQS send failed (usually a credential or queue URL issue)

## IAM policy for Vercel credentials

Create an IAM user with only this policy (least privilege):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:us-east-1:YOUR_ACCOUNT_ID:tot-picks-queue"
    }
  ]
}
```

## Triggering manually

```bash
# Force regenerate today's picks (bypasses cache guard)
aws sqs send-message \
  --queue-url YOUR_QUEUE_URL \
  --message-body '{"force": "1", "trigger": "manual"}'
```
