// Provider-neutral captcha entry. Callers import from here, never the provider
// transport (turnstile.js) directly — so the provider can be swapped without
// touching them. Mirrors lib/email's transport structure.
export { verifyCaptcha } from "./turnstile.js";
