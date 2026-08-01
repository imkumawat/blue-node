import type { User } from "../../models/postgres/user/user.js";

/**
 * The user fields safe to hand outside this module.
 *
 * One type rather than a Pick repeated per service: signup, verify-email, login
 * and the GraphQL `User` type all return a user, and if their shapes drift then
 * a field is silently missing on one path — exactly what happened before, where
 * `me` had no name and a page reload lost it.
 *
 * passwordHash is the reason this exists at all: the raw row carries it, so
 * anything returning `User` unfiltered leaks the hash.
 */
export type PublicUser = Pick<
  User,
  "id" | "email" | "firstName" | "lastName" | "status" | "createdAt"
>;

/**
 * The auth context every transport attaches to a request.
 *
 * Lives at the module root rather than inside a service because two different
 * verifiers produce it and everything downstream consumes it — no single service
 * owns it. Two fields are nullable rather than absent so that the middlewares, the
 * GraphQL context and the WS layer never have to care which token FORMAT arrived.
 */
export interface AuthUser {
  id: string;
  scopes: string[];
  /** Server-generated per login; stable across token rotation. */
  sessionId: string;
  /** Unix seconds. The WS layer closes sockets once this passes. */
  exp: number;
}
