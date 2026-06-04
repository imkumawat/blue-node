import { JOB_SEND_EMAIL, handleSendEmail } from "./sendEmail.js";

// The job map this module contributes to the central registry (jobs/registry.ts),
// keyed by job name. Typed inline (rather than importing JobHandler from the
// registry) to keep the dependency one-way: registry -> this module, never back.
export const notificationJobs: Record<
  string,
  (payload: unknown) => Promise<void>
> = {
  [JOB_SEND_EMAIL]: handleSendEmail,
};
