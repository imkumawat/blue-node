import type { EmailMessage } from "../../../lib/email/index.js";
import { wrapEmail } from "../../../lib/email/layout.js";

// Template returns CONTENT only (no `to`) — the recipient is the caller's
// concern. Caller spreads it: enqueueEmail({ to, ...welcomeEmail({...}) }).
type EmailContent = Omit<EmailMessage, "to">;

export function welcomeEmail({ name }: { name: string }): EmailContent {
  const subject = "Welcome to Blue";
  const text =
    `Hi ${name}, welcome aboard! Your email is verified and your account is ready. ` +
    `If you have any questions, just reply to this email.`;
  const bodyHtml = `
    <p style="margin:0 0 18px;color:#4b5563;font-size:15px;line-height:1.6;">
      Hi ${name}, your email is verified and your account is ready to go. 🎉
    </p>
    <p style="margin:0 0 22px;color:#4b5563;font-size:15px;line-height:1.6;">
      We're glad to have you on board. Whenever you need a hand, just reply to
      this email — we're happy to help.
    </p>
    <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
      You're receiving this because you created a Blue account.
    </p>`;
  const html = wrapEmail({
    title: `Welcome, ${name}!`,
    bodyHtml,
    preview: "Your account is ready",
  });
  return { subject, html, text };
}
