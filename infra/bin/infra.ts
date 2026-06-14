#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { TotAppInfraStack } from "../lib/infra-stack";

const app = new cdk.App();

new TotAppInfraStack(app, "TotAppInfraStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
});
