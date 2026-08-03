import { getEnvConfig } from "../../../config/env.js";
import { html, raw } from "../../../shared/utils/html.js";
import type { SafeHtml } from "../../../shared/utils/html.js";

/**
 * The document shell every OAuth page shares — the counterpart of
 * lib/email/layout.ts, and for the same reason: the chrome is written once so a
 * page only has to describe what makes it different.
 *
 * Design follows imkumawatmanoj.com: dot-grid background, one blue accent,
 * mono-forward type, a single bordered card. Auth pages lean harder on the mono
 * than the site does, which suits them — and it removes the need for a third
 * typeface, which matters here for the reason below.
 *
 * ── No external requests, deliberately ──
 * The site loads Inter / JetBrains Mono / Bricolage Grotesque from Google Fonts.
 * These pages do not, and will not:
 *
 *   1. It would tell a third party exactly when a user is on the login or consent
 *      screen. Acceptable on a marketing page; not on an auth surface.
 *   2. It puts a render-blocking cross-origin fetch on the critical path of a
 *      time-boxed flow — an authorization code lives 60 seconds.
 *   3. It would mean widening `style-src` and adding `font-src` on the ONE page
 *      that renders an attacker-supplied value (client_name, from open
 *      registration). That is the last place to loosen a policy.
 *
 * So the stacks below name the real fonts first — anyone who has JetBrains Mono
 * installed gets it for free — and fall back to system faces that look near
 * enough. See apis/sendPage.ts for the policy this keeps tight.
 */

const STYLES = `
  :root {
    --bg: #f7f8fa;
    --surface: #ffffff;
    --ink: #17191d;
    --muted: #5b6068;
    --faint: #9aa0a6;
    --accent: #2f53f5;
    --accent-dk: #2544d6;
    --line: #e7e9ee;
    --line-soft: #eef0f3;
    --ok: #1fa463;
    --danger: #c8322b;

    --mono: "JetBrains Mono", ui-monospace, "SF Mono", "Cascadia Mono",
            "Segoe UI Mono", monospace;
    --sans: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  html { -webkit-text-size-adjust: 100%; }

  body {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 40px 20px;
    background: var(--bg);
    color: var(--ink);
    font-family: var(--sans);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;

    /* The site's dot grid, same values. */
    background-image: radial-gradient(
      circle at 1px 1px,
      rgba(23, 25, 29, 0.045) 1px,
      transparent 0
    );
    background-size: 26px 26px;
  }

  /* Narrower than the site's 820px on purpose: one column, one task. */
  .shell { width: 100%; max-width: 420px; }

  /* ---------- top bar: WHICH server is asking ---------- */
  /* Not decoration. A user approving access has to be able to see whose page
     this is, and the address bar is the only other place that says so. */
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
  }
  .host { letter-spacing: 0.06em; }
  .lock { color: var(--faint); }

  /* ---------- card ---------- */
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 28px 26px;
  }

  h1 {
    font-family: var(--mono);
    font-size: 15px;
    font-weight: 500;
    letter-spacing: -0.01em;
  }

  .sub {
    margin-top: 6px;
    font-size: 13.5px;
    color: var(--muted);
  }

  /* ---------- form ---------- */
  form { margin-top: 22px; display: grid; gap: 14px; }

  label {
    display: block;
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--muted);
    margin-bottom: 6px;
  }

  input[type="email"],
  input[type="password"],
  input[type="text"] {
    width: 100%;
    font-family: var(--sans);
    font-size: 14px;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 9px;
    padding: 10px 12px;
  }
  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    border-color: var(--accent);
  }

  /* ---------- buttons ---------- */
  .actions { display: flex; gap: 10px; margin-top: 4px; }

  .btn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    font-family: var(--mono);
    font-size: 13px;
    text-decoration: none;
    padding: 10px 16px;
    border-radius: 9px;
    border: 1px solid var(--line);
    color: var(--ink);
    background: var(--surface);
    cursor: pointer;
    transition:
      transform 0.12s ease,
      border-color 0.12s ease,
      background 0.12s ease;
  }
  .btn:hover { transform: translateY(-1px); border-color: var(--muted); }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .btn.primary:hover { background: var(--accent-dk); border-color: var(--accent-dk); }
  .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

  /* ---------- error strip ---------- */
  /* Deliberately not the accent colour: the accent means "the thing to do next",
     and a failure is not that. */
  .error {
    font-size: 13px;
    color: var(--danger);
    background: #fdf3f2;
    border: 1px solid #f5d9d7;
    border-radius: 9px;
    padding: 9px 11px;
  }

  /* ---------- scope list ---------- */
  .scopes { list-style: none; margin-top: 18px; display: grid; gap: 8px; }
  .scopes li {
    display: flex;
    gap: 9px;
    align-items: flex-start;
    font-size: 13.5px;
    border: 1px solid var(--line-soft);
    border-radius: 9px;
    padding: 9px 11px;
  }
  .scopes .tick { color: var(--ok); flex: 0 0 auto; }
  .scopes code {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--faint);
  }

  /* ---------- footer ---------- */
  .status {
    margin-top: 14px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--faint);
    display: flex;
    gap: 8px;
    justify-content: space-between;
  }
  .status .ok { color: var(--ok); }

  @media (max-width: 420px) {
    .card { padding: 22px 18px; }
    .actions { flex-direction: column-reverse; }
  }
`;

export interface PageOptions {
  /** Browser tab title. Also the only place the product name is repeated. */
  title: string;
  body: SafeHtml;
  /**
   * Shown in the footer, mono, as the site's `200 OK` motif.
   *
   * A parameter rather than a constant because the message page is reached on a
   * 4xx — printing "200 OK" there would be a small lie in the one place whose
   * whole job is to explain what went wrong.
   */
  status?: string;
}

/**
 * Wraps a page body in the shared document.
 *
 * Reads the issuer host from config rather than taking it as an argument: every
 * page shows the same host, so threading an identical parameter through all three
 * screens would only be a place to get it wrong.
 */
export function renderPage(options: PageOptions): SafeHtml {
  const { oauth } = getEnvConfig();
  const host = hostOf(oauth.oauthServerUrl);

  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <!-- An auth page has no business in a search index. -->
        <meta name="robots" content="noindex, nofollow" />
        <title>${options.title}</title>
        <style>
          ${raw(STYLES)}
        </style>
      </head>
      <body>
        <div class="shell">
          <div class="top">
            <span class="host">${host}</span>
            <span class="lock">secure</span>
          </div>

          <div class="card">${options.body}</div>

          <div class="status">
            <span class="ok">${options.status ?? "200 OK"}</span>
            <span>blue-node</span>
          </div>
        </div>
      </body>
    </html>`;
}

/**
 * The host alone, so the top bar reads as an identity rather than a URL.
 *
 * Falls back to the raw value if it will not parse — a malformed issuer is a
 * config error worth surfacing on the page, not worth throwing over while a user
 * is mid-flow.
 */
function hostOf(issuer: string): string {
  try {
    return new URL(issuer).host;
  } catch {
    return issuer;
  }
}
