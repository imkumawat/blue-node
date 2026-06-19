import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { AWS_HTTP } from "../../config/appConfig.js";

// Lazy getters (project getter-pattern) — nothing is constructed at import time.
// NOTE: getSecretsClient() runs DURING loadEnv() (via fetchSecrets), so none of
// this may depend on getEnvConfig() (config isn't built yet). region is read
// straight from process.env and AWS_HTTP is a plain constant — both safe
// pre-loadEnv (the documented bootstrap exception to the config-via-getEnvConfig
// rule).
//
// The shared HTTP handler bounds per-call latency on every AWS SDK request.
// Without it a network blip or service degradation hangs the caller
// indefinitely — boot-time fetchSecrets would block task startup, and
// S3/SQS/CloudFront calls would hold request slots forever.
let _base: { region: string; requestHandler: NodeHttpHandler } | undefined;
function awsBase(): { region: string; requestHandler: NodeHttpHandler } {
  if (!_base) {
    _base = {
      region: process.env.AWS_REGION ?? "ap-south-1",
      requestHandler: new NodeHttpHandler({
        connectionTimeout: AWS_HTTP.connectionTimeoutMs,
        requestTimeout: AWS_HTTP.requestTimeoutMs,
      }),
    };
  }
  return _base;
}

let _secretsClient: SecretsManagerClient | undefined;
export function getSecretsClient(): SecretsManagerClient {
  if (!_secretsClient) _secretsClient = new SecretsManagerClient(awsBase());
  return _secretsClient;
}

let _s3Client: S3Client | undefined;
export function getS3Client(): S3Client {
  if (!_s3Client) _s3Client = new S3Client(awsBase());
  return _s3Client;
}

let _sqsClient: SQSClient | undefined;
export function getSqsClient(): SQSClient {
  if (!_sqsClient) _sqsClient = new SQSClient(awsBase());
  return _sqsClient;
}

let _cfClient: CloudFrontClient | undefined;
export function getCfClient(): CloudFrontClient {
  if (!_cfClient) _cfClient = new CloudFrontClient(awsBase());
  return _cfClient;
}
