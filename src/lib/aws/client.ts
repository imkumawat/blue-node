import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";

const region = process.env.AWS_REGION ?? "ap-south-1";

export const secretsClient = new SecretsManagerClient({ region });
export const s3Client = new S3Client({ region });
export const sqsClient = new SQSClient({ region });
export const cfClient = new CloudFrontClient({ region });
