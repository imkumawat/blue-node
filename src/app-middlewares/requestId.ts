import type { Request, Response, NextFunction } from "express";
import { generateId } from "../utils/generateId.js";

export default function requestId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers["x-request-id"];
  const raw = Array.isArray(incoming) ? incoming[0] : incoming;
  const id = raw
    ? raw.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) || generateId()
    : generateId();
  req.requestId = id;
  res.setHeader("X-Request-ID", id);
  next();
}
