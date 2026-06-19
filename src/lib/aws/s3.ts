import {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import { getS3Client } from "./client.js";
import { getEnvConfig } from "../../config/env.js";

/**
 * Upload a file to S3.
 */
export async function uploadFile(
  bucket: string,
  key: string,
  body: Buffer | Readable,
  contentType: string,
  metadata: Record<string, string> = {},
): Promise<string> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: metadata,
      // enforce server-side encryption
      ServerSideEncryption: "AES256",
    }),
  );
  return key;
}

/**
 * Generate a signed URL for temporary private file access (GET).
 * Expires in 24h.
 */
export async function getSignedDownloadUrl(
  bucket: string,
  key: string,
): Promise<string> {
  const { signedUrlExpiry } = getEnvConfig().aws.s3;

  // verify object exists before generating URL — avoids leaking signed URLs for missing keys
  await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));

  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: signedUrlExpiry },
  );
}

/**
 * Generate a presigned URL for FE to upload directly to S3 (PUT).
 * Expires in 15min. Caller must pass the exact contentType the FE will use.
 * FE must set Content-Type header to match, otherwise S3 will reject the request.
 */
export async function getPresignedUploadUrl(
  bucket: string,
  key: string,
  contentType: string,
  maxSizeBytes?: number,
): Promise<string> {
  const { presignedUrlExpiry } = getEnvConfig().aws.s3;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ServerSideEncryption: "AES256",
    ...(maxSizeBytes && { ContentLength: maxSizeBytes }),
  });

  return getSignedUrl(getS3Client(), command, {
    expiresIn: presignedUrlExpiry,
  });
}

/**
 * Delete a file from S3.
 * S3 DeleteObject is idempotent — no error if key does not exist.
 */
export async function deleteFile(bucket: string, key: string): Promise<void> {
  await getS3Client().send(
    new DeleteObjectCommand({ Bucket: bucket, Key: key }),
  );
}
