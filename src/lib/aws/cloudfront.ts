import { getSignedUrl, getSignedCookies } from "@aws-sdk/cloudfront-signer";
import { CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { getCfClient } from "./client.js";
import { getEnvConfig } from "../../config/env.js";

function getSigningConfig(): { keyPairId: string; privateKey: string } {
  const { keyPairId, privateKey } = getEnvConfig().aws.cloudfront;
  if (!keyPairId || !privateKey) {
    throw new Error(
      "CloudFront signing not configured — set CLOUDFRONT_KEY_PAIR_ID and CLOUDFRONT_PRIVATE_KEY",
    );
  }
  return { keyPairId, privateKey };
}

/**
 * Generate a signed URL for private CloudFront file access.
 * Use this instead of S3 signed URLs — file served from CDN edge, S3 never exposed.
 */
export function createSignedUrl(
  domain: string,
  key: string,
  expiresIn?: number,
): string {
  const { keyPairId, privateKey } = getSigningConfig();
  const { signedUrlExpiry } = getEnvConfig().aws.cloudfront;
  const url = `https://${domain}/${key}`;
  const dateLessThan = new Date(
    Date.now() + (expiresIn ?? signedUrlExpiry) * 1000,
  ).toISOString();
  return getSignedUrl({ url, keyPairId, privateKey, dateLessThan });
}

/**
 * Generate signed cookies for access to multiple files under a path pattern.
 * Use when a user needs access to an entire folder (e.g. all files in a candidate report).
 * Set these cookies on the response — browser sends them automatically on CF requests.
 */
export function createSignedCookies(
  domain: string,
  pattern: string,
  expiresIn?: number,
) {
  const { keyPairId, privateKey } = getSigningConfig();
  const { signedCookieExpiry } = getEnvConfig().aws.cloudfront;
  const url = `https://${domain}/${pattern}`;
  const dateLessThan = new Date(
    Date.now() + (expiresIn ?? signedCookieExpiry) * 1000,
  ).toISOString();
  return getSignedCookies({ url, keyPairId, privateKey, dateLessThan });
}

/**
 * Invalidate cached paths in a CloudFront distribution.
 * Call after updating/deleting a file so CDN stops serving the stale version.
 */
export async function invalidatePaths(
  distributionId: string,
  paths: string[],
): Promise<void> {
  if (!distributionId) {
    throw new Error(
      "CloudFront distributionId is required for cache invalidation",
    );
  }
  await getCfClient().send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        Paths: { Quantity: paths.length, Items: paths },
        // unique reference per invalidation request — required by AWS
        CallerReference: Date.now().toString(),
      },
    }),
  );
}
