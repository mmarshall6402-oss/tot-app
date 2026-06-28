output "lambda_function_name" {
  value = aws_lambda_function.calibration.function_name
}

output "lambda_function_arn" {
  value = aws_lambda_function.calibration.arn
}

output "eventbridge_rule_arn" {
  value = aws_cloudwatch_event_rule.nightly_calibration.arn
}

output "cloudwatch_alarm_name" {
  value = aws_cloudwatch_metric_alarm.calibration_errors.alarm_name
}
