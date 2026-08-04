import type { Response } from "express";
import { StatusCodes } from "http-status-codes";

import type { SafeHtml } from "../../../shared/utils/html.js";

/**
 * Sending the server-rendered OAuth pages.
 *
 * Lives in apis/ rather than views/ because these touch `res`. Views return
 * markup and nothing else, so a test can assert on the HTML without an Express
 * mock, and the transport concerns — status, content type, CSP — stay here.
 *
 * There are deliberately TWO senders rather than one with an optional argument.
 * The difference is load-bearing, and an omitted optional argument fails
 * silently: the form submits, nothing happens, and the only trace is a line in
 * the browser console.
 */

/**
 * The policy both pages share.
 *
 * `script-src 'none'` because neither page has any script. That is tighter than
 * the app-wide policy and it is the second line of defence behind escaping: even
 * if a value reached the document unescaped, there is no context here in which a
 * script could run.
 */
function baseCsp(): string[] {
  return [
    "default-src 'self'",
    "script-src 'none'",
    "style-src 'self' 'unsafe-inline'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ];
}

/**
 * A page with no form, or whose form does not end in a redirect.
 *
 * The error/message page, and any dead end.
 */
export function sendPage(
  res: Response,
  page: SafeHtml,
  status: number = StatusCodes.OK,
): void {
  res.setHeader(
    "Content-Security-Policy",
    [...baseCsp(), "form-action 'self'"].join("; "),
  );

  res.status(status).type("html").send(page.value);
}

export interface FormPage {
  page: SafeHtml;
  /**
   * The client's redirect URI — ALREADY matched against its registered list.
   * Never a value straight off the request.
   */
  redirectUri: string;
  status?: number;
}

/**
 * A page whose form POST will end in a redirect to the client.
 *
 * This needs its own CSP, and the reason is easy to miss: `form-action` governs
 * not only where a form may POST, but where that POST's response may REDIRECT to
 * — Chrome and Safari validate the whole chain. Under the app-wide
 * `form-action 'self'`, the 302 that actually completes the OAuth flow is blocked
 * and the user is left looking at the page they just submitted, with no error
 * anywhere except the browser console.
 *
 * So the page carrying the form also names the one extra source it must be
 * allowed to reach. Nothing is relaxed globally, and the allowance is exactly one
 * origin — one already matched against this client's registered redirect URIs.
 */
export function sendFormPage(res: Response, form: FormPage): void {
  res.setHeader(
    "Content-Security-Policy",
    [...baseCsp(), `form-action 'self' ${cspSourceFor(form.redirectUri)}`].join(
      "; ",
    ),
  );

  res
    .status(form.status ?? StatusCodes.OK)
    .type("html")
    .send(form.page.value);
}

/**
 * A CSP source expression for one redirect URI.
 *
 * Non-special schemes — the private-use callbacks native apps register, like
 * com.example.app:/cb — have no origin, so `new URL(...).origin` is the string
 * "null". CSP accepts a bare scheme as a source, which is the right granularity
 * there anyway.
 */
function cspSourceFor(redirectUri: string): string {
  const url = new URL(redirectUri);
  return url.origin === "null" ? url.protocol : url.origin;
}
