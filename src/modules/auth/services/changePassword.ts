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

  await enqueueEmail(
    { to: user.email, ...changePasswordEmail() },
    EMAIL_PRIORITY.high,
  );
}
