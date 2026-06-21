import { registerUser } from "../services/registerUser.js";
import { verifyEmail as verifyEmailService } from "../services/verifyEmail.js";
import { loginWithPassword } from "../services/loginWithPassword.js";
import { logoutUser } from "../services/logout.js";
import { getUserById } from "../services/getUserById.js";
import { parseInput } from "../../../shared/utils/parseInput.js";
import { signupSchema, loginSchema, verifyEmailSchema } from "../schemas.js";
import { InvalidRefreshTokenError } from "../errors.js";
import type { GraphQLContext } from "../../../graphql/buildContext.js";
import type { IssuedToken } from "../lib/tokenService.js";

interface AuthLikeResult {
  user: { id: string; email: string; createdAt: Date };
  access: IssuedToken;
  refresh: IssuedToken;
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

function toAuthPayload({ user, access, refresh }: AuthLikeResult) {
  return {
    user,
    tokens: { accessToken: access.token, refreshToken: refresh.token },
  };
}

export const authResolvers = {
  Query: {
    me: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      if (!ctx.user) return null;
      return getUserById(ctx.user.id);
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
      _ctx: GraphQLContext,
    ) => {
      const validated = parseInput(verifyEmailSchema, input);
      const result = await verifyEmailService(validated);
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
      });
      return toAuthPayload(result);
    },

    logout: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      // @authenticated directive guarantees ctx.user (thus accessJti/accessExp
      // — same JWT). Refresh cookie is independent — validate explicitly.
      if (!ctx.rawRefreshToken) throw new InvalidRefreshTokenError();
      await logoutUser({
        userId: ctx.user!.id,
        sessionId: ctx.user!.sessionId,
        accessJti: ctx.accessJti!,
        accessExp: ctx.accessExp!,
        rawRefreshToken: ctx.rawRefreshToken,
      });
      return true;
    },
  },
};
