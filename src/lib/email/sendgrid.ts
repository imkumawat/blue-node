import { getEnvConfig } from "../../config/env.js";
import logger from "../../utils/logger.js";

const SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send";

// Provider-agnostic email shape, co-located with the sender. Callers send this;
// `from` is intentionally NOT here — it's fixed config (EMAIL_FROM) the sender
// injects, so callers never repeat it.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string; // optional plaintext fallback (better spam score, no-HTML clients)
}

// Direct SendGrid REST send (no SDK — same raw-fetch pattern as
// lib/captcha/turnstile.ts, zero dependency). Success = 202 with an empty body;
// anything else carries an { errors } array. Throws on failure (fail-loud) so
// the BullMQ email job retries — unlike captcha which fails closed silently.
export async function sendEmail(msg: EmailMessage): Promise<void> {
  const { from, sendgrid } = getEnvConfig().email;
  if (!sendgrid.apiKey || !from) {
    throw new Error(
      "Email not configured: set SENDGRID_API_KEY and EMAIL_FROM",
    );
  }

  // SendGrid requires text/plain BEFORE text/html (MIME order matters).
  const content: { type: string; value: string }[] = [];
  if (msg.text) content.push({ type: "text/plain", value: msg.text });
  content.push({ type: "text/html", value: msg.html });

  const res = await fetch(SENDGRID_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sendgrid.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: msg.to }] }],
      from: { email: from },
      subject: msg.subject,
      content,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status !== 202) {
    const body = await res.text();
    logger.error({ status: res.status, body }, "SendGrid send failed");
    throw new Error(`SendGrid send failed: ${res.status}`);
  }

  logger.info({ to: msg.to, subject: msg.subject }, "email sent");
}
