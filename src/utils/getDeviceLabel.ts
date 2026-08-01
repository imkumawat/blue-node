/**
 * A short human label for a device, derived from its User-Agent.
 *
 * For example: "Chrome on Windows", "Safari on iOS", "Firefox".
 *
 * This is DECORATION, never identity. It exists so a person can recognise their
 * own device in a "where you're logged in" list, or read it in an audit trail.
 * Nothing is ever authorised from it and a User-Agent is trivially forged, so a
 * wrong guess costs nothing — which is also why this stays a handful of regexes
 * rather than a UA-parsing dependency that needs updating as browsers ship.
 *
 * Takes the header value rather than the request, so it is pure and testable
 * without constructing one.
 */

/**
 * Non-browser callers: API tools and mobile networking stacks.
 *
 * Checked BEFORE browsers because these name themselves unambiguously, while a
 * browser match is a guess from engine tokens that tools sometimes borrow.
 *
 * okhttp and CFNetwork are the standard HTTP stacks on Android and iOS, so in
 * practice they mean "our mobile app" rather than a named product — which is the
 * useful thing to show in a device list.
 */
function clientFrom(userAgent: string): string | null {
  if (/PostmanRuntime\//i.test(userAgent)) return "Postman";
  if (/insomnia\//i.test(userAgent)) return "Insomnia";
  if (/Thunder ?Client/i.test(userAgent)) return "Thunder Client";
  if (/HTTPie\//i.test(userAgent)) return "HTTPie";
  if (/^curl\//i.test(userAgent)) return "curl";
  if (/^axios\//i.test(userAgent)) return "axios";
  if (/okhttp\//i.test(userAgent)) return "Android app";
  if (/CFNetwork\//.test(userAgent)) return "iOS app";
  if (/^(node|undici|got)\//i.test(userAgent)) return "Node client";
  return null;
}

/**
 * Order matters here and is the whole subtlety of UA sniffing: Edge and Opera
 * both also claim "Chrome" in their UA, and Chrome in turn also claims "Safari".
 * Checking generically first would label every Edge user as Chrome, so the most
 * specific token has to win.
 */
function browserFrom(userAgent: string): string | null {
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/OPR\//.test(userAgent)) return "Opera";
  if (/Chrome\//.test(userAgent)) return "Chrome";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Safari\//.test(userAgent)) return "Safari";
  return null;
}

/** iOS before macOS: an iPhone UA also contains "Mac OS X". */
function osFrom(userAgent: string): string | null {
  if (/Windows NT/.test(userAgent)) return "Windows";
  if (/iPhone|iPad|iPod/.test(userAgent)) return "iOS";
  if (/Mac OS X/.test(userAgent)) return "macOS";
  if (/Android/.test(userAgent)) return "Android";
  if (/Linux/.test(userAgent)) return "Linux";
  return null;
}

/**
 * Returns null when nothing recognisable is present — including for a missing
 * header, so callers can pass `req.headers["user-agent"]` straight through
 * without a guard. Callers should treat null as "unknown device" and store it.
 */
export function getDeviceLabel(userAgent: string | null): string | null {
  if (!userAgent) return null;

  // A tool that names itself needs no OS suffix — "Postman on Windows" would be
  // both wrong (Postman does not send an OS) and noisier than "Postman".
  const client = clientFrom(userAgent);
  if (client) return client;

  const browser = browserFrom(userAgent);
  const os = osFrom(userAgent);

  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? null;
}
