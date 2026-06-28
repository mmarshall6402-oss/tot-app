terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ── IAM ─────────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "calibration_lambda" {
  name = "tot-calibration-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic_logs" {
  role       = aws_iam_role.calibration_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ── Lambda ───────────────────────────────────────────────────────────────────────

data "archive_file" "calibration_zip" {
  type        = "zip"
  source_file = "${path.module}/../lambda/calibration_lambda.py"
  output_path = "${path.module}/dist/calibration_lambda.zip"
}

resource "aws_lambda_function" "calibration" {
  filename         = data.archive_file.calibration_zip.output_path
  source_code_hash = data.archive_file.calibration_zip.output_base64sha256
  function_name    = "tot-calibration-snapshot"
  role             = aws_iam_role.calibration_lambda.arn
  handler          = "calibration_lambda.handler"
  runtime          = "python3.12"
  timeout          = 60

  environment {
    variables = {
      SUPABASE_URL              = var.supabase_url
      SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    }
  }
}

# ── EventBridge (nightly cron) ───────────────────────────────────────────────────
# 8 AM UTC = 3 AM CT (winter) / 4 AM CT (summer).
# Runs after the nightly resolve cron (0 8 * * *) so all picks are settled first.

resource "aws_cloudwatch_event_rule" "nightly_calibration" {
  name                = "tot-calibration-nightly"
  description         = "Nightly calibration snapshot for T|T Picks model"
  schedule_expression = "cron(30 8 * * ? *)"
}

resource "aws_cloudwatch_event_target" "calibration_lambda" {
  rule      = aws_cloudwatch_event_rule.nightly_calibration.name
  target_id = "CalibrationLambdaTarget"
  arn       = aws_lambda_function.calibration.arn
}

resource "aws_lambda_permission" "allow_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.calibration.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.nightly_calibration.arn
}

# ── CloudWatch alarm ─────────────────────────────────────────────────────────────
# Alarms if the Lambda throws any error within a 24-hour window.
# Wire an SNS topic to this alarm's alarm_actions for email/PagerDuty alerts.

resource "aws_cloudwatch_metric_alarm" "calibration_errors" {
  alarm_name          = "tot-calibration-lambda-errors"
  alarm_description   = "T|T calibration Lambda failed — check CloudWatch logs"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 86400
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.calibration.function_name
  }
}
