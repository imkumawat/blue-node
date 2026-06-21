import { findUserById, updateUserPassword } from "../lib/userQueries.js";
import {
  verifyPassword,
  hashPassword,
} from "../../../shared/utils/password.js";
import { revokeAllRefreshTokensForUser } from "../lib/tokenService.js";
import {
  enqueueEmail,
  EMAIL_PRIORITY,
} from "../../notifications/jobs/sendEmail.js";
import { changePasswordEmail } from "../emails/changePasswordEmail.js";
import { InvalidCredentialsError, UserNotFoundError } from "../errors.js";
import { disconnectUser } from "../../../websocket/index.js";
import logger from "../../../utils/logger.js";

interface ChangePasswordInput {
  userId: string; // from the authenticated session (req.user.id)
  currentPassword: string;
  newPassword: string;
}

// Authenticated password change. Re-verifies the current password (the access
// token alone isn't enough to change credentials), then rotates the hash and
// revokes ALL sessions — including the caller's; the handler clears cookies and
// the FE re-authenticates. A confirmation email lets the user catch a change
// they didn't make.
export async function changePassword({
  userId,
  currentPassword,
  newPassword,
}: ChangePasswordInput): Promise<void> {
  const user = await findUserById(userId);
  if (!user) throw new UserNotFoundError();

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) throw new InvalidCredentialsError();

  const passwordHash = await hashPassword(newPassword);
  await updateUserPassword(user.id, passwordHash);

  await revokeAllRefreshTokensForUser(user.id);

  // Close all of this user's live sockets across instances — every session is
  // now invalid. Non-fatal (unlike logout): the password and token revocation
  // are ALREADY committed above, so a WS hiccup must not fail a succeeded
  // change. The heartbeat token-expiry close is the backstop.
  await disconnectUser(user.id, "password changed").catch((err) =>
    logger.warn(
      { err, userId: user.id },
      "WS disconnect on password change failed",
    ),
  );

  await enqueueEmail(
    { to: user.email, ...changePasswordEmail() },
    EMAIL_PRIORITY.high,
  );
}
