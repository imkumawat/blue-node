import { getEnvConfig } from "../../../config/env.js";
import { html } from "../../../shared/utils/html.js";
import type { SafeHtml } from "../../../shared/utils/html.js";
import { renderPage } from "./layout.js";

export interface LoginPageOptions {
  /** From open registration — escaped like every other interpolated value. */
  clientName: string;
  ticket: string;
  /**
   * Whatever the auth module already decided is safe to show: wrong credentials,
   * locked out, email not verified, account suspended. The message is not
   * composed here, because which of those a caller may reveal is an auth decision,
   * not a presentation one.
   */
  error?: string;
}

/**
 * Sign-in, shown when /authorize finds no valid first-party session — and shown
 * again, with `error` set, after a failed attempt.
 *
 * The ticket is what makes re-rendering possible: the pending authorization is
 * held server-side, so a failed sign-in returns to this same page without losing
 * the client, the scopes or the redirect URI. Nothing about the OAuth request
 * travels through the form.
 *
 * Signing in here establishes the browser session for real, not just for this
 * hop, which is why the next app — or this one again — skips straight to consent.
 *
 * ── No CAPTCHA widget here, and it is not an oversight ──
 * The captcha gate exists (CAPTCHA_ENABLED, Turnstile) and guards the first-party
 * login. Rendering its widget on THIS page would need `script-src` to allow
 * challenges.cloudflare.com plus a `frame-src` for its iframe — on the one page
 * that renders an attacker-chosen string. Loosening the policy there to add a
 * bot defence is a poor trade, so the gate stays where it already works and this
 * page relies on the same per-IP and per-(email|ip) lockout every login does.
 * If it is ever wanted here, the widget and the CSP change land together.
 */
export function renderLoginPage(options: LoginPageOptions): SafeHtml {
  const { oauth } = getEnvConfig();

  return renderPage({
    title: `Sign in — blue-node`,
    body: html`
      <h1>Sign in to continue</h1>
      <p class="sub">
        ${options.clientName} is requesting access to your account.
      </p>

      <form method="post" action="${oauth.authorizePath}">
        <input type="hidden" name="ticket" value="${options.ticket}" />

        ${options.error
          ? html`<p class="error" role="alert">${options.error}</p>`
          : null}

        <div>
          <label for="email">EMAIL</label>
          <!-- autocomplete matters on a page a password manager has never seen:
               without it, nothing is offered and the user retypes credentials. -->
          <input
            id="email"
            type="email"
            name="email"
            autocomplete="username"
            required
            autofocus
          />
        </div>

        <div>
          <label for="password">PASSWORD</label>
          <input
            id="password"
            type="password"
            name="password"
            autocomplete="current-password"
            required
          />
        </div>

        <div class="actions">
          <button class="btn primary" type="submit">Sign in</button>
        </div>
      </form>
    `,
  });
}
