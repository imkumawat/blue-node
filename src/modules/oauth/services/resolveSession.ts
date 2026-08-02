import type { Request } from "express";
import { verifySessionToken, type AuthSession } from "../../auth/index.js";

export async function resolveSession(
  req: Request,
): Promise<AuthSession | null> {
  const token = req.cookies?.access_token as string | undefined;
  if (!token) return null;

  const record = await verifySessionToken(token);
  if (!record) return null;
  return record;
}
