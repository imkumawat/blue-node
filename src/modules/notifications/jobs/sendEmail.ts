import { z } from "zod";
import { getJobQueue } from "../../../jobs/queue.js";
import { sendEmail } from "../../../lib/email/index.js";
import type { EmailMessage } from "../../../lib/email/index.js";

// Job name — namespaced. The producer (enqueueEmail) and the worker (registry)
// share this constant so the name never drifts between the two sides.
export const JOB_SEND_EMAIL = "email:send";

// Lower number = higher priority (BullMQ). OTP/verify are time-sensitive (the
// user is actively waiting), so they jump ahead of bulk mail.
export const EMAIL_PRIORITY = {
  high: 1, // OTP, email-verify
  normal: 5, // receipts, alerts
  low: 10, // non-urgent / bulk-ish
} as const;

// The payload crosses a process boundary (web enqueues -> Redis -> worker), so
// validate it on the way out instead of trusting the queue. A malformed or
// version-skewed job (e.g. left over across a deploy) then fails fast & clearly.
const payloadSchema = z.object({
  to: z.email(),
  subject: z.string().min(1),
  html: z.string().min(1),
  text: z.string().optional(),
});

// Producer side (web process): enqueue an email; the worker delivers it later.
export async function enqueueEmail(
  msg: EmailMessage,
  priority: number = EMAIL_PRIORITY.normal,
): Promise<void> {
  await getJobQueue().add(JOB_SEND_EMAIL, msg, { priority });
}

// Consumer side (worker process): validate the queued payload -> send. Throwing
// lets BullMQ retry (attempts/backoff from defaultJobOptions), then the failed set.
export async function handleSendEmail(payload: unknown): Promise<void> {
  const msg = payloadSchema.parse(payload);
  await sendEmail(msg);
}
