import { html } from "../../../shared/utils/html.js";
import type { SafeHtml } from "../../../shared/utils/html.js";
import { renderPage } from "./layout.js";

export interface MessagePageOptions {
  title: string;
  message: string;
  /** Shown in the footer. Defaults to the layout's 200 OK. */
  status?: string;
}

/**
 * The dead ends — the only two outcomes of /authorize that must NOT redirect.
 *
 * An unknown `client_id` and a `redirect_uri` matching nothing registered are
 * exactly the cases where there is no URI we have any business sending a user to.
 * Redirecting on either would mean trusting a value straight off the request,
 * which is the hole every other check on that endpoint exists to close. So the
 * flow stops here, in a page a person can read.
 *
 * Also used for an expired or missing ticket, where the honest instruction is to
 * start again from the app rather than to retry anything here.
 *
 * Deliberately actionless: no retry button, no link back. Anywhere it could send
 * the user is either unverified or somewhere they cannot usefully go.
 */
export function renderMessagePage(options: MessagePageOptions): SafeHtml {
  return renderPage({
    title: `${options.title} — blue-node`,
    status: options.status,
    body: html`
      <h1>${options.title}</h1>
      <p class="sub">${options.message}</p>
    `,
  });
}
