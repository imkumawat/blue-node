import { getEnvConfig } from "../../../config/env.js";
import { html } from "../../../shared/utils/html.js";
import type { SafeHtml } from "../../../shared/utils/html.js";
import type { Scope } from "../../../shared/constants/scopes.js";
import { renderPage } from "./layout.js";
import { SCOPE_DESCRIPTIONS } from "./scopeDescriptions.js";

export interface ConsentPageOptions {
  /**
   * Straight from the client's registration, which is OPEN — anyone can register
   * any name. It is the one value on these pages an attacker chooses, and it is
   * escaped by the `html` tag like everything else. Registration also refuses
   * angle brackets, but that is the second layer; this is the one that matters.
   */
  clientName: string;
  /** So the user can see WHICH of their accounts is about to be delegated. */
  userEmail: string;
  /**
   * Exactly the scopes that will be granted if this form is approved.
   *
   * The caller must pass the same set it goes on to record. Showing one set and
   * granting another is not a display bug — it is a user consenting to something
   * they were never shown, and it is a mistake this codebase has made before.
   */
  scopes: Scope[];
  /** Ties the POST back to the pending authorization it belongs to. */
  ticket: string;
}

/**
 * The approval screen.
 *
 * Reached only when the request is not already covered by a standing grant, so
 * every scope listed is something new being asked for.
 *
 * Deny is a real outcome, not a way out of the page: it posts like Allow does and
 * sends the user back to the client with `error=access_denied`. An app is entitled
 * to know it was refused, and leaving the user on a dead page would strand the
 * flow instead of ending it.
 *
 * Allow is the primary button and sits on the right, after Deny. The destructive
 * reading here is granting access, not refusing it, so the affirmative action is
 * the one that has to be deliberate — not the one under the cursor by default.
 */
export function renderConsentPage(options: ConsentPageOptions): SafeHtml {
  const { oauth } = getEnvConfig();

  return renderPage({
    title: `Authorize ${options.clientName} — blue-node`,
    body: html`
      <h1>${options.clientName} wants access</h1>
      <p class="sub">Signed in as ${options.userEmail}</p>

      <ul class="scopes">
        ${options.scopes.map(
          (scope) =>
            html`<li>
              <span class="tick" aria-hidden="true">✓</span>
              <span>
                ${SCOPE_DESCRIPTIONS[scope]}<br />
                <code>${scope}</code>
              </span>
            </li>`,
        )}
      </ul>

      <form method="post" action="${oauth.authorizePath}">
        <input type="hidden" name="ticket" value="${options.ticket}" />
        <div class="actions">
          <button class="btn" type="submit" name="decision" value="deny">
            Deny
          </button>
          <button
            class="btn primary"
            type="submit"
            name="decision"
            value="allow"
          >
            Allow
          </button>
        </div>
      </form>
    `,
  });
}
