import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as path from "path";

export class TotAppInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new NodejsFunction(this, "PingSupabaseFunction", {
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(__dirname, "../lambda/ping-supabase/index.mjs"),
      handler: "handler",
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL ?? "",
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      },
      timeout: cdk.Duration.seconds(30),
    });
  }
}
