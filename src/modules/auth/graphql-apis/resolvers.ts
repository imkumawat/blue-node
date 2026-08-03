import { registerUser } from "../services/registerUser.js";
import { verifyEmail as verifyEmailService } from "../services/verifyEmail.js";
import { loginWithPassword } from "../services/loginWithPassword.js";
import { logoutUser } from "../services/logout.js";
import { parseInput } from "../../../shared/utils/parseInput.js";
import { signupSchema, loginSchema, verifyEmailSchema } from "../schemas.js";
import { InvalidRefreshTokenError, UserNotFoundError } from "../errors.js";

import type { GraphQLContext } from "../../../graphql/buildContext.js";
import type { SessionCredentials } from "../services/createSession.js";
import type { PublicUser } from "../types.js";

interface AuthLikeResult {
  user: PublicUser;
  credentials: SessionCredentials;
}

interface RegisterArgs {
  input: {
    email: string;
    password: string;
    confirmPassword: string;
    consents: string[];
  };
}

interface LoginArgs {
  input: { email: string; password: string };
}

interface VerifyEmailArgs {
  input: { email: string; code: string };
}

interface EchoArgs {
  limit: number;
}

function toAuthPayload({ user, credentials }: AuthLikeResult) {
  return {
    user,
    tokens: {
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
    },
  };
}

export const authResolvers = {
  Query: {
    me: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      if (!ctx.session) return null;
      // Load via the per-request DataLoader (batches + caches within the request).
      const user = await ctx.loaders.userById.load(ctx.session.userId);
      if (!user) throw new UserNotFoundError();
      return user;
    },

    echo: (_parent: unknown, { limit }: EchoArgs) =>
      Array.from({ length: limit }, (_, i) => `echo-item-${i + 1}`),
  },

  Mutation: {
    register: async (
      _parent: unknown,
      { input }: RegisterArgs,
      ctx: GraphQLContext,
    ) => {
      const validated = parseInput(signupSchema, input);
      const { user } = await registerUser({
        email: validated.email,
        firstName: validated.firstName,
        lastName: validated.lastName,
        password: validated.password,
        consents: validated.consents,
        consentMeta: {
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          platform: ctx.platform,
        },
      });
      // No tokens — the user verifies their email before logging in.
      return { user, verificationRequired: true };
    },

    verifyEmail: async (
      _parent: unknown,
      { input }: VerifyEmailArgs,
      ctx: GraphQLContext,
    ) => {
      const validated = parseInput(verifyEmailSchema, input);
      const result = await verifyEmailService({
        ...validated,
        userAgent: ctx.userAgent,
        ipAddress: ctx.ipAddress,
      });
      return toAuthPayload(result);
    },

    login: async (
      _parent: unknown,
      { input }: LoginArgs,
      ctx: GraphQLContext,
    ) => {
      const validated = parseInput(loginSchema, input);
      const result = await loginWithPassword({
        ...validated,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      return toAuthPayload(result);
    },

    logout: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      // @authenticated directive guarantees ctx.session (thus accessJti/accessExp
      // — same JWT). Refresh cookie is independent — validate explicitly.
      if (!ctx.rawRefreshToken) throw new InvalidRefreshTokenError();
      await logoutUser({
        userId: ctx.session!.userId,
        sessionId: ctx.session!.sessionId,
      });
      return true;
    },
  },
};
