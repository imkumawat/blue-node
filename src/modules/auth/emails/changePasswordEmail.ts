import type { EmailMessage } from "../../../lib/email/index.js";
import { wrapEmail } from "../../../lib/email/layout.js";

// Template returns CONTENT only (no `to`) — the recipient is the caller's
// concern. Caller spreads it: enqueueEmail({ to, ...changePasswordEmail() }).
type EmailContent = Omit<EmailMessage, "to">;

// Security notification sent AFTER a successful password change. Carries no
// secrets — its job is to let the user catch a change they didn't make.
export function changePasswordEmail(): EmailContent {
  const subject = "Your password was changed";
  const text =
    `Your account password was just changed. If this was you, no action is needed. ` +
    `If you didn't change your password, reset it immediately and contact support.`;
  const bodyHtml = `
    <p style="margin:0 0 22px;color:#4b5563;font-size:15px;line-height:1.6;">
      Your account password was just changed. If this was you, no action is
      needed.
    </p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px 18px;margin:0 0 22px;">
      <p style="margin:0;color:#b91c1c;font-size:14px;line-height:1.6;font-weight:600;">
        Didn't change your password?
      </p>
      <p style="margin:6px 0 0;color:#7f1d1d;font-size:13px;line-height:1.6;">
        Reset it immediately and contact support — your account may be at risk.
      </p>
    </div>
    <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
      This is a security notification for your Blue account.
    </p>`;
  const html = wrapEmail({
    title: "Your password was changed",
    bodyHtml,
    preview: "Your account password was just changed",
  });
  return { subject, html, text };
}
