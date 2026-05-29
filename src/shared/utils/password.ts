import bcrypt from "bcrypt";
import { getEnvConfig } from "../../config/env.js";

export async function hashPassword(plain: string): Promise<string> {
  const { saltRounds } = getEnvConfig().auth;
  return bcrypt.hash(plain, saltRounds);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
