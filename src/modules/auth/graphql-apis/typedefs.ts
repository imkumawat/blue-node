export const authTypeDefs: string = `#graphql
  type User {
    id: ID!
    email: String!
    createdAt: String!
  }

  type AuthTokens {
    accessToken: String!
    refreshToken: String!
  }

  type AuthPayload {
    user: User!
    tokens: AuthTokens!
  }

  type RegisterResult {
    user: User!
    verificationRequired: Boolean!
  }

  input RegisterInput {
    email: String!
    password: String!
    confirmPassword: String!
    consents: [String!]!
  }

  input LoginInput {
    email: String!
    password: String!
  }

  input VerifyEmailInput {
    email: String!
    code: String!
  }

  type Query {
    me: User @authenticated

    """
    DEMO — placeholder list query that demonstrates the @complexity directive.
    Returns 'echo-item-N' strings up to the given limit.
    Remove once a real list query (e.g. adminListUsers, apiKeys) ships.
    """
    echo(limit: Int! = 10): [String!]!
      @complexity(value: 1, multipliers: ["limit"])
  }

  type Mutation {
    register(input: RegisterInput!): RegisterResult!
      @noAlias
      @rateLimit(max: 5, windowSec: 900)
      @authRateLimit(max: 3, windowSec: 900)
    verifyEmail(input: VerifyEmailInput!): AuthPayload!
      @noAlias
      @rateLimit(max: 10, windowSec: 900)
      @authRateLimit(max: 5, windowSec: 900)
    login(input: LoginInput!): AuthPayload!
      @noAlias
      @rateLimit(max: 30, windowSec: 900)
      @authRateLimit(max: 5, windowSec: 900)
    logout: Boolean! @authenticated
  }
`;
