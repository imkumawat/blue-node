import type { EmailMessage } from "../../../lib/email/index.js";

// Template returns CONTENT only (no `to`) — the recipient is the caller's
// concern. Caller spreads it: enqueueEmail({ to, ...verificationEmail({...}) }).
type EmailContent = Omit<EmailMessage, "to">;

export function verificationEmail({
  code,
  expiresInMin,
}: {
  code: string;
  expiresInMin: number;
}): EmailContent {
  const subject = "Verify your email";
  const text =
    `Your verification code is ${code}. It expires in ${expiresInMin} minutes. ` +
    `If you didn't sign up, ignore this email.`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#111;">Verify your email</h2>
      <p style="color:#444;">Use this code to verify your email address:</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#111;">${code}</p>
      <p style="color:#777;font-size:14px;">This code expires in ${expiresInMin} minutes.</p>
      <p style="color:#999;font-size:12px;">If you didn't sign up, you can safely ignore this email.</p>
    </div>`;
  return { subject, html, text };
}
