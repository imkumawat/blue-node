import type { IncomingMessage } from "http";
import { getEnvConfig } from "../config/env.js";

/**
 * Sentinel value returned when no client IP can be determined.
 * Used instead of null/undefined so callers (rate limiters, audit logs,
 * NOT NULL DB columns) get a predictable string without null-handling.
 */
export const UNKNOWN_IP = "0.0.0.0";

// How each proxy sets X-Forwarded-For (XFF):
//
//   AWS ALB:    auto-appends real client IP → XFF: <client>
//               with CF in front            → XFF: <client>, <cloudflare-egress>
//
//   Cloudflare: appends client IP to XFF + sets cf-connecting-ip: <client>
//               cf-connecting-ip is simpler but only trustworthy when actually behind CF
//
//   Nginx:      does NOT set XFF by default — must configure explicitly:
//                 proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
//                 proxy_set_header X-Real-IP $remote_addr;  (optional, single IP convenience)
//
// PROXY_HOP_COUNT = number of proxy layers in front of this app:
//   ALB only        → 1  (XFF: client)
//   CF + ALB        → 2  (XFF: client, cf-egress)
//   Nginx + ALB     → 2  (XFF: client, nginx)
//   CF + Nginx + ALB → 3
//   local dev       → 0  (no proxy, use socket)

export function getClientIp(req: IncomingMessage): string {
  const { hopCount } = getEnvConfig().proxy;
  const xForwardedFor = req.headers["x-forwarded-for"] as string | undefined;

  if (xForwardedFor && hopCount > 0) {
    const ips = xForwardedFor.split(",");
    // each proxy appends the IP it sees — real client IP is at position -(hop count)
    return ips.at(-hopCount)?.trim() || UNKNOWN_IP;
  }

  // no proxy in front (local dev) — direct TCP connection
  return req.socket?.remoteAddress || UNKNOWN_IP;
}
