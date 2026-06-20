import { v7 as uuidv7 } from "uuid";
import { getEnvConfig } from "../../../config/env.js";
import { findUserByEmail, updateUserStatus } from "../lib/userQueries.js";
import { getScopes } from "../lib/permissionQueries.js";
import {
  generateAccessToken,
  generateRefreshToken,
  storeRefreshToken,
} from "../lib/tokenService.js";
import type { IssuedToken } from "../lib/tokenService.js";
import { verifyEmailVerificationCode } from "../lib/emailVerification.js";
import { InvalidVerificationCodeError } from "../errors.js";
import type { User } from "../../../models/postgres/user/user.js";

interface VerifyEmailInput {
  email: string;
  code: string;
}

interface AuthResult {
  user: Pick<User, "id" | "email" | "status" | "createdAt">;
  access: IssuedToken;
  refresh: IssuedToken;
}

// Confirm a signup's email-verification code, activate the account, and — only
// now — issue the session tokens (this is effectively the first login). A wrong
// email and a wrong code both surface as the same error (no account enumeration).
export async function verifyEmail({
  email,
  code,
}: VerifyEmailInput): Promise<AuthResult> {
  const { userAudience } = getEnvConfig().jwt;

  const user = await findUserByEmail(email);
  if (!user || user.status !== "pending") {
    throw new InvalidVerificationCodeError();
  }

  const ok = await verifyEmailVerificationCode(user.id, code);
  if (!ok) throw new InvalidVerificationCodeError();

  await updateUserStatus(user.id, "active");

  const scopes = await getScopes(user.id);
  const sessionId = uuidv7();
  const access = generateAccessToken(userAudience, {
    sub: user.id,
    scopes,
    sid: sessionId,
  });
  const refresh = generateRefreshToken(userAudience, {
    sub: user.id,
    sid: sessionId,
  });
  await storeRefreshToken(
    user.id,
    refresh.jti,
    refresh.expiresAt,
    access.jti,
    access.expiresAt,
  );

  return {
    user: {
      id: user.id,
      email: user.email,
      status: "active",
      createdAt: user.createdAt,
    },
    access,
    refresh,
  };
}
