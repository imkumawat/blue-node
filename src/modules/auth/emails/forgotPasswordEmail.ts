import type { EmailMessage } from "../../../lib/email/index.js";
import { wrapEmail } from "../../../lib/email/layout.js";

// Template returns CONTENT only (no `to`) — the recipient is the caller's
// concern. Caller spreads it: enqueueEmail({ to, ...forgotPasswordEmail({...}) }).
type EmailContent = Omit<EmailMessage, "to">;

export function forgotPasswordEmail({
  code,
  expiresInMin,
}: {
  code: string;
  expiresInMin: number;
}): EmailContent {
  const subject = "Reset your password";
  const text =
    `Use this code to reset your password: ${code}. It expires in ${expiresInMin} minutes. ` +
    `If you didn't request a password reset, ignore this email — your password is unchanged.`;
  const bodyHtml = `
    <p style="margin:0 0 22px;color:#4b5563;font-size:15px;line-height:1.6;">
      Use this code to reset your password. It's valid for the next
      ${expiresInMin} minutes.
    </p>
    <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:12px;padding:20px;text-align:center;margin:0 0 22px;">
      <span style="font-family:'Segoe UI',Arial,sans-serif;font-size:34px;font-weight:700;letter-spacing:10px;color:#4f46e5;">${code}</span>
    </div>
    <p style="margin:0 0 6px;color:#6b7280;font-size:13px;line-height:1.6;">
      For your security, never share this code with anyone.
    </p>
    <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
      Didn't request this? You can safely ignore this email — your password
      stays unchanged.
    </p>`;
  const html = wrapEmail({
    title: "Reset your password",
    bodyHtml,
    preview: `Your password reset code is ${code}`,
  });
  return { subject, html, text };
}
