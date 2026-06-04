import { findUserByEmail, updateUserPassword } from "../lib/userQueries.js";
import { verifyPasswordResetCode } from "../lib/passwordReset.js";
import { revokeAllRefreshTokensForUser } from "../lib/tokenService.js";
import { hashPassword } from "../../../shared/utils/password.js";
import {
  enqueueEmail,
  EMAIL_PRIORITY,
} from "../../notifications/jobs/sendEmail.js";
import { changePasswordEmail } from "../emails/changePasswordEmail.js";
import { InvalidVerificationCodeError } from "../errors.js";

interface ResetPasswordInput {
  email: string;
  code: string;
  newPassword: string;
}

// Unknown email, inactive account, and wrong/expired code ALL surface as the
// same error — no account enumeration, no signal about which step failed.
// On success: set the new password, kill every session (a reset assumes the old
// credentials are compromised), and send a confirmation. No tokens are issued —
// the reset may be happening on a device the user won't keep logged in.
export async function resetPassword({
  email,
  code,
  newPassword,
}: ResetPasswordInput): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user || user.status !== "active") {
    throw new InvalidVerificationCodeError();
  }

  const ok = await verifyPasswordResetCode(user.id, code);
  if (!ok) throw new InvalidVerificationCodeError();

  const passwordHash = await hashPassword(newPassword);
  await updateUserPassword(user.id, passwordHash);

  // Revoke every refresh token — old sessions can no longer be renewed.
  await revokeAllRefreshTokensForUser(user.id);

  await enqueueEmail(
    { to: user.email, ...changePasswordEmail() },
    EMAIL_PRIORITY.high,
  );
}
