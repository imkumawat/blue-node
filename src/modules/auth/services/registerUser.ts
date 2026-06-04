import { getEnvConfig } from "../../../config/env.js";
import { DEFAULT_USER_SCOPES } from "../../../shared/constants/scopes.js";
import {
  CONSENT_VERSIONS,
  DEFAULT_CONSENT_VERSION,
  type ConsentType,
} from "../constants.js";
import { findUserByEmail, createUser } from "../lib/userQueries.js";
import { hashPassword } from "../../../shared/utils/password.js";
import { grantScopes } from "../lib/permissionQueries.js";
import { logConsent } from "../lib/consentQueries.js";
import { createEmailVerificationCode } from "../lib/emailVerification.js";
import {
  enqueueEmail,
  EMAIL_PRIORITY,
} from "../../notifications/jobs/sendEmail.js";
import { verificationEmail } from "../emails/verificationEmail.js";
import { EmailAlreadyExistsError } from "../errors.js";
import type { User } from "../../../models/postgres/user/user.js";

interface ConsentMeta {
  ipAddress: string;
  userAgent?: string | null;
  platform?: string;
}

interface RegisterInput {
  email: string;
  password: string;
  consents: ConsentType[];
  consentMeta: ConsentMeta;
}

interface RegisterResult {
  user: Pick<User, "id" | "email" | "status" | "createdAt">;
}

export async function registerUser({
  email,
  password,
  consents,
  consentMeta,
}: RegisterInput): Promise<RegisterResult> {
  const existing = await findUserByEmail(email);
  if (existing) throw new EmailAlreadyExistsError();

  const passwordHash = await hashPassword(password);
  const user = await createUser({ email, passwordHash, status: "pending" });

  await grantScopes(user.id, [...DEFAULT_USER_SCOPES]);

  await Promise.all(
    consents.map((consentType) =>
      logConsent(user.id, {
        consentType,
        consentVersion:
          CONSENT_VERSIONS[consentType] ?? DEFAULT_CONSENT_VERSION,
        ...consentMeta,
      }),
    ),
  );

  // Email verification: issue a one-time code + queue the email. NO tokens here
  // — the user logs in only after verifying via POST /v1/auth/verify-email.
  const code = await createEmailVerificationCode(user.id);
  const { ttlSec } = getEnvConfig().otp;
  await enqueueEmail(
    {
      to: user.email,
      ...verificationEmail({ code, expiresInMin: ttlSec / 60 }),
    },
    EMAIL_PRIORITY.high,
  );

  return { user };
}
