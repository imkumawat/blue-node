// Provider-neutral email entry. Callers import from here, never the provider
// file (sendgrid.js) directly — so the provider can be swapped without touching
// them. Mirrors lib/captcha's index boundary.
export { sendEmail } from "./sendgrid.js";
export type { EmailMessage } from "./sendgrid.js";
