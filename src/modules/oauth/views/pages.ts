import type { Scope } from "../../../shared/constants/scopes.js";
import { SCOPES } from "../../../shared/constants/scopes.js";

/**
 * Server-rendered pages for the authorization endpoint.
 *
 * Template strings, no view engine: these two screens are the only HTML this API
 * serves, and a templating dependency for them would cost more than it saves.
 * Same reasoning as lib/email/layout.ts.
 *
 * No inline <script> anywhere — the app-wide CSP allows scripts only from
 * 'self', and these pages need none: a plain form POST does the whole job.
 * Clickjacking is already covered by helmet's frame-ancestors 'none'.
 */

/**
 * Everything interpolated below is escaped, and that is not paranoia:
 * registration is OPEN, so `client_name` is an attacker-chosen string. An
 * unescaped client name is stored XSS on the one page where the user is about to
 * hand over account access.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * What each scope means in plain words. A consent screen listing "read_profile"
 * is not consent — the user has to understand what they are approving.
 *
 * Typed as Record<Scope, string>, so adding a scope to the catalog without
 * writing a description here is a compile error rather than a blank line on the
 * consent screen.
 */
const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  [SCOPES.PROFILE_READ]: "View your email address and account status",
  [SCOPES.PROFILE_WRITE]: "Update your profile",
  [SCOPES.ACCOUNT_DELETE]: "Delete your account",
  [SCOPES.USERS_READ]: "View other users",
  [SCOPES.USERS_WRITE]: "Create and modify other users",
  [SCOPES.USERS_DELETE]: "Delete other users",
  [SCOPES.PERMISSIONS_READ]: "View what permissions a user holds",
  [SCOPES.PERMISSIONS_WRITE]: "Grant and revoke permissions",
  [SCOPES.ADMIN_ACCESS]: "Full administrative access",
};

const STYLES = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    padding: 24px; background: #f4f6f8; color: #14202a;
    font: 15px/1.6 ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
  }
  .card {
    width: 100%; max-width: 420px; background: #fff; border: 1px solid #dde3e8;
    border-radius: 10px; padding: 28px;
  }
  h1 { margin: 0 0 6px; font-size: 19px; letter-spacing: -.01em; }
  p  { margin: 0 0 18px; color: #55656f; }
  .app { font-weight: 600; color: #14202a; }
  ul { list-style: none; margin: 0 0 22px; padding: 0; }
  li { display: flex; gap: 10px; padding: 9px 0; border-top: 1px solid #eef2f4; }
  li::before { content: "\\2022"; color: #00867a; }
  label { display: block; margin-bottom: 14px; font-size: 13px; font-weight: 600; }
  input {
    width: 100%; margin-top: 6px; padding: 10px 12px; font-size: 15px;
    border: 1px solid #cdd6dc; border-radius: 6px; background: #fff; color: inherit;
  }
  .row { display: flex; gap: 10px; }
  button {
    flex: 1; padding: 11px 16px; font-size: 15px; font-weight: 600;
    border-radius: 6px; border: 1px solid transparent; cursor: pointer;
  }
  .allow { background: #00867a; color: #fff; }
  .deny  { background: #fff; color: #55656f; border-color: #cdd6dc; }
  .who   { margin-top: 20px; font-size: 13px; color: #7b8a94; }
  .error {
    margin: 0 0 16px; padding: 10px 12px; border-radius: 6px;
    background: #fdeceb; color: #97231b; font-size: 14px;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #0d141a; color: #e6edf1; }
    .card { background: #141e26; border-color: #253440; }
    h1, .app { color: #e6edf1; }
    p, .deny, .who { color: #93a4ae; }
    li { border-top-color: #1e2c36; }
    input, .deny { background: #0d141a; border-color: #2b3b47; }
    .error { background: #3a1c19; color: #f3b4ae; }
  }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

/**
 * A dead end the user can read — an expired ticket, a missing form token.
 * Rendered rather than redirected: at this point we either have no verified
 * redirect URI or no request left to send anywhere.
 */
export function renderMessagePage(heading: string, message: string): string {
  return page(
    heading,
    `<h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p>`,
  );
}

export function renderConsentPage(params: {
  clientName: string;
  scopes: Scope[];
  userEmail: string;
  ticket: string;
  formAction: string;
}): string {
  const items = params.scopes
    .map((s) => `<li>${escapeHtml(SCOPE_DESCRIPTIONS[s])}</li>`)
    .join("");

  return page(
    `Authorize ${params.clientName}`,
    `<h1>Authorize access</h1>
     <p><span class="app">${escapeHtml(params.clientName)}</span>
        wants access to your account.</p>
     <ul>${items}</ul>
     <form method="post" action="${escapeHtml(params.formAction)}">
       <input type="hidden" name="ticket" value="${escapeHtml(params.ticket)}">
       <div class="row">
         <button class="deny"  type="submit" name="decision" value="deny">Deny</button>
         <button class="allow" type="submit" name="decision" value="allow">Allow</button>
       </div>
     </form>
     <p class="who">Signed in as ${escapeHtml(params.userEmail)}</p>`,
  );
}

export function renderLoginPage(params: {
  clientName: string;
  ticket: string;
  formAction: string;
  error?: string;
}): string {
  const error = params.error
    ? `<p class="error">${escapeHtml(params.error)}</p>`
    : "";

  return page(
    "Sign in",
    `<h1>Sign in to continue</h1>
     <p><span class="app">${escapeHtml(params.clientName)}</span>
        is requesting access to your account.</p>
     ${error}
     <form method="post" action="${escapeHtml(params.formAction)}">
       <input type="hidden" name="ticket" value="${escapeHtml(params.ticket)}">
       <label>Email
         <input type="email" name="email" autocomplete="username" required autofocus>
       </label>
       <label>Password
         <input type="password" name="password" autocomplete="current-password" required>
       </label>
       <div class="row">
         <button class="allow" type="submit">Sign in</button>
       </div>
     </form>`,
  );
}
