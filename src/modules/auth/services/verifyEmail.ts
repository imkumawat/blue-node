import { findUserByEmail, updateUserStatus } from "../infra/userQueries.js";
import { createSession } from "./createSession.js";
import type { SessionCredentials } from "./createSession.js";
import { verifyEmailVerificationCode } from "../infra/emailVerification.js";
import { InvalidVerificationCodeError } from "../errors.js";
import type { PublicUser } from "../types.js";

interface VerifyEmailInput {
  email: string;
  code: string;
  /** Recorded on the session — this call is effectively the first login. */
  userAgent: string | null;
  ipAddress: string;
}

interface AuthResult {
  user: PublicUser;
  credentials: SessionCredentials;
}

// Confirm a signup's email-verification code, activate the account, and — only
// now — issue the session tokens (this is effectively the first login). A wrong
// email and a wrong code both surface as the same error (no account enumeration).
export async function verifyEmail({
  email,
  code,
  ipAddress,
  userAgent,
}: VerifyEmailInput): Promise<AuthResult> {
  const user = await findUserByEmail(email);
  if (!user || user.status !== "pending") {
    throw new InvalidVerificationCodeError();
  }

  const ok = await verifyEmailVerificationCode(user.id, code);
  if (!ok) throw new InvalidVerificationCodeError();

  await updateUserStatus(user.id, "active");

  const credentials = await createSession({
    userId: user.id,
    userAgent,
    ipAddress,
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: "active",
      createdAt: user.createdAt,
    },

    credentials,
  };
}
