import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { AWS_HTTP } from "../../config/appConfig.js";

const region = process.env.AWS_REGION ?? "ap-south-1";

// Shared HTTP handler bounds per-call latency on every AWS SDK request.
// Without these, a network blip or service degradation hangs the caller
// indefinitely — boot-time `fetchSecrets` would prevent task startup, and
// S3/SQS/CloudFront calls would hold request slots forever.
const requestHandler = new NodeHttpHandler({
  connectionTimeout: AWS_HTTP.connectionTimeoutMs,
  requestTimeout: AWS_HTTP.requestTimeoutMs,
});

const base = { region, requestHandler };

export const secretsClient = new SecretsManagerClient(base);
export const s3Client = new S3Client(base);
export const sqsClient = new SQSClient(base);
export const cfClient = new CloudFrontClient(base);
