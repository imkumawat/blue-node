/**
 * HTML interpolation where escaping is the DEFAULT, not something to remember.
 *
 * The pages this builds carry values we do not control. `client_name` is the
 * sharpest: registration is open (RFC 7591 DCR), so anyone can register a client
 * with any name, and that name is rendered on the consent screen — on the same
 * origin that holds the first-party session cookie. Unescaped, that is stored
 * XSS with a self-service submission form.
 *
 * A helper you must remember to call fails the first time someone forgets. So the
 * template tag escapes every interpolation, and inserting pre-built markup takes
 * an explicit `raw()` — the unsafe path is the one you have to type out.
 */

/**
 * Markup that is already safe to insert. Only `html` and `raw` produce it, so a
 * plain string can never be mistaken for one.
 */
export class SafeHtml {
  constructor(readonly value: string) {}

  toString(): string {
    return this.value;
  }
}

/**
 * Escapes text for HTML.
 *
 * All five characters, not just the three that matter in text: quotes make the
 * result safe inside a QUOTED attribute too, which is where most of these values
 * end up (`value="..."` on the hidden ticket field).
 *
 * ⚠️ NOT safe for every context, and pretending otherwise is the usual mistake:
 *   - unquoted attributes — a space is enough to break out; always quote
 *   - inside <script> — needs JS escaping, or better, do not put data there
 *   - inside a URL — needs encodeURIComponent
 *   - inside <style> — needs CSS escaping
 * These pages deliberately have no script and no interpolated URLs, which is
 * what keeps this one escaper sufficient.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Marks a string as already-safe markup, skipping escaping.
 *
 * For fragments this module itself built — a list of `<li>` rows, say. Never for
 * anything that came from a request, a database row, or a config value.
 */
export function raw(value: string): SafeHtml {
  return new SafeHtml(value);
}

/**
 * Builds markup, escaping every interpolated value.
 *
 * Returns SafeHtml rather than a string so nesting works: a nested `html` result
 * is recognised as safe and inlined, instead of being escaped a second time into
 * visible tag soup.
 *
 * Arrays are joined with no separator, which is what a list of rendered rows
 * wants. null and undefined render as nothing rather than the strings "null" and
 * "undefined".
 */
export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): SafeHtml {
  let out = strings[0] ?? "";

  for (let i = 0; i < values.length; i += 1) {
    out += stringify(values[i]) + (strings[i + 1] ?? "");
  }

  return new SafeHtml(out);
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(stringify).join("");

  return escapeHtml(String(value));
}
