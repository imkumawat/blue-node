import type { Request, Response, NextFunction } from "express";

export default function responseInterceptor(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const _json = res.json.bind(res);

  res.json = ((body: unknown) => {
    if (
      body !== null &&
      typeof body === "object" &&
      (body as { success?: unknown }).success !== undefined
    ) {
      (body as Record<string, unknown>).requestId = req.requestId;
    }
    return _json(body);
  }) as Response["json"];

  next();
}
