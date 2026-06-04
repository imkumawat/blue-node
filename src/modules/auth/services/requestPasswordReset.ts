import { getEnvConfig } from "../../../config/env.js";
import { findUserByEmail } from "../lib/userQueries.js";
import { createPasswordResetCode } from "../lib/passwordReset.js";
import {
  enqueueEmail,
  EMAIL_PRIORITY,
} from "../../notifications/jobs/sendEmail.js";
import { forgotPasswordEmail } from "../emails/forgotPasswordEmail.js";

interface RequestPasswordResetInput {
  email: string;
}

// Resolves the SAME way whether or not the email exists / the account is active
// — the caller always returns a generic 200, so an attacker can't probe which
// emails are registered. The code + email side effects only fire for a real,
// active account.
export async function requestPasswordReset({
  email,
}: RequestPasswordResetInput): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user || user.status !== "active") return;

  const code = await createPasswordResetCode(user.id);
  const { ttlSec } = getEnvConfig().otp;
  await enqueueEmail(
    {
      to: user.email,
      ...forgotPasswordEmail({ code, expiresInMin: ttlSec / 60 }),
    },
    EMAIL_PRIORITY.high,
  );
}
