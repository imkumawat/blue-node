import { getEnvConfig } from "../../../config/env.js";
import { DEFAULT_USER_SCOPES } from "../../../shared/constants/scopes.js";
import {
  CONSENT_VERSIONS,
  DEFAULT_CONSENT_VERSION,
  type ConsentType,
} from "../constants.js";
import { findUserByEmail, createUser } from "../lib/userQueries.js";
import { hashPassword } from "../../../shared/utils/password.js";
import { grantScopes, getScopes } from "../lib/permissionQueries.js";
import {
  generateAccessToken,
  generateRefreshToken,
  storeRefreshToken,
} from "../lib/tokenService.js";
import type { IssuedToken } from "../lib/tokenService.js";
import { logConsent } from "../lib/consentQueries.js";
import { EmailAlreadyExistsError } from "../errors.js";
import type { User } from "../../../models/postgres/user/user.js";

interface ConsentMeta {
  ipAddress: string;
  userAgent?: string | null;
  platform?: string;
}

interface RegisterInput {
  email: string;
  password: string;
  consents: ConsentType[];
  consentMeta: ConsentMeta;
}

interface AuthResult {
  user: Pick<User, "id" | "email" | "status" | "createdAt">;
  access: IssuedToken;
  refresh: IssuedToken;
}

export async function registerUser({
  email,
  password,
  consents,
  consentMeta,
}: RegisterInput): Promise<AuthResult> {
  const { userAudience } = getEnvConfig().jwt;

  const existing = await findUserByEmail(email);
  if (existing) throw new EmailAlreadyExistsError();

  const passwordHash = await hashPassword(password);
  const user = await createUser({ email, passwordHash });

  await grantScopes(user.id, [...DEFAULT_USER_SCOPES]);
  const scopes = await getScopes(user.id);

  const access = generateAccessToken(user.id, scopes, userAudience);
  const refresh = generateRefreshToken(user.id, userAudience);
  await storeRefreshToken(
    user.id,
    refresh.jti,
    refresh.expiresAt,
    access.jti,
    access.expiresAt,
  );

  await Promise.all(
    consents.map((consentType) =>
      logConsent(user.id, {
        consentType,
        consentVersion:
          CONSENT_VERSIONS[consentType] ?? DEFAULT_CONSENT_VERSION,
        ...consentMeta,
      }),
    ),
  );

  return { user, access, refresh };
}
