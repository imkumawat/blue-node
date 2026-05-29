import { getDb } from "../../../lib/db/postgres/client.js";
import { consentLogs } from "../../../models/postgres/user/consentLog.js";

interface LogConsentPayload {
  consentType: string;
  consentVersion: string;
  ipAddress: string;
  userAgent?: string | null;
  platform?: string;
}

export async function logConsent(
  userId: string,
  {
    consentType,
    consentVersion,
    ipAddress,
    userAgent,
    platform,
  }: LogConsentPayload,
): Promise<void> {
  await getDb()
    .insert(consentLogs)
    .values({
      userId,
      consentType,
      consentVersion,
      ipAddress,
      userAgent: userAgent ?? null,
      platform: platform ?? "web",
    });
}
