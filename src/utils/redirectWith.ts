import type { Response } from "express";

export type RedirectParams = Record<
  string,
  string | number | boolean | null | undefined
>;

type RedirectLocation = "query" | "fragment";

function redirect(
  res: Response,
  uri: string,
  params: RedirectParams,
  location: RedirectLocation = "query",
): void {
  const url = new URL(uri);

  const target =
    location === "query" ? url.searchParams : new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value != null) {
      target.set(key, String(value));
    }
  }

  if (location === "fragment") {
    url.hash = target.toString();
  }

  res.redirect(302, url.toString());
}

export function redirectWithAuthorizationCode(
  res: Response,
  uri: string,
  params: RedirectParams,
): void {
  redirect(res, uri, params);
}

export function redirectWithAuthorizationError(
  res: Response,
  uri: string,
  params: RedirectParams,
): void {
  redirect(res, uri, params);
}

export function redirectWithAccessToken(
  res: Response,
  uri: string,
  params: RedirectParams,
): void {
  redirect(res, uri, params, "fragment");
}
