export const baseTypeDefs: string = `#graphql
  """
  Marks a field/mutation that may NOT be aliased.
  Used to prevent batch attacks on sensitive auth operations
  (login, register, forgotPassword, etc.) where allowing multiple
  selections per request would enable brute-force.
  """
  directive @noAlias on FIELD_DEFINITION

  """
  Declares the computational cost of resolving a field.
  Used by the complexity plugin to reject expensive queries before execution.
  - value: base cost per resolution
  - multipliers: argument names whose values are multiplied with the base cost
                 (e.g. \`limit\` so users(limit: 100) costs value * 100)
  """
  directive @complexity(value: Int!, multipliers: [String!]) on FIELD_DEFINITION

  """
  Requires the request to carry a valid auth context — ctx.user must exist.
  GraphQL equivalent of the REST \`authenticate()\` middleware.
  Throws InvalidTokenError otherwise. Runs BEFORE resolvers.
  """
  directive @authenticated on FIELD_DEFINITION

  """
  Requires the authenticated user's scopes to include the given scope.
  GraphQL equivalent of the REST \`authorize(...scopes)\` middleware.
  Implicitly requires authentication (no need to also apply @authenticated).
  Throws ForbiddenError if scope missing.
  """
  directive @requireScope(scope: String!) on FIELD_DEFINITION

  """
  Per-operation rate limit. Counts ALL attempts (success + failure).
  Atomic Redis INCR keyed by (fieldName, ipAddress).
  Enforced at didResolveOperation. General DoS / abuse protection.
  """
  directive @rateLimit(max: Int!, windowSec: Int!) on FIELD_DEFINITION

  """
  Auth-specific rate limit. Counts ONLY failures (skipSuccessfulRequests=true equivalent).
  Mirrors REST's authLimiter behavior. Use on auth-sensitive mutations like
  login / forgotPassword / resetPassword where legitimate users shouldn't be
  punished for successful retries.
  Layered with @rateLimit for defense-in-depth.
  """
  directive @authRateLimit(max: Int!, windowSec: Int!) on FIELD_DEFINITION
`;
