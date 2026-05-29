# TypeScript Reference (blue-node)

A practical, production-focused cheatsheet. Examples are mostly drawn from this
codebase so they map to real usage. Read top-to-bottom once, then use as a lookup.

## Table of contents

1. [The mental model — how to "know" what to do](#1-the-mental-model)
2. [Basic annotations](#2-basic-annotations)
3. [`type` vs `interface`](#3-type-vs-interface)
4. [Union & literal types](#4-union--literal-types)
5. [`as const` + derived types](#5-as-const--derived-types)
6. [Generics](#6-generics)
7. [Utility types (production workhorses)](#7-utility-types)
8. [Type narrowing & guards](#8-type-narrowing--guards)
9. [Type assertions (`as`, `!`, `satisfies`)](#9-type-assertions)
10. [Strict null handling (`?.` `??` `?:`)](#10-strict-null-handling)
11. [`unknown` vs `any` vs `never`](#11-unknown-vs-any-vs-never)
12. [Inference helpers (`typeof`, `z.infer`, indexed access)](#12-inference-helpers)
13. [Module augmentation & `.d.ts`](#13-module-augmentation--dts)
14. [`import type`](#14-import-type)
15. [Index signatures & `Record`](#15-index-signatures--record)
16. [Function & callback types](#16-function--callback-types)
17. [Mapped & conditional types (advanced)](#17-mapped--conditional-types-advanced)
18. [Library patterns (Express, Zod, Drizzle, Apollo)](#18-library-patterns)
19. [Quick "when do I reach for X" table](#19-quick-reference-table)

---

## 1. The mental model

You do NOT write complex types from memory. The workflow:

1. **Annotate params + return types.** This is ~80% of daily work.
2. **Let TS guide you.** Red squiggle / `tsc --noEmit` tells you WHERE a type is
   wrong. Hover any variable in the IDE to SEE its inferred type.
3. **Recognize the signal** for when a simple annotation isn't enough:
   - Output type **depends on** the input → reach for a **generic**.
   - `any` / `unknown` creeping into a return → add a type or generic.
   - Same shape repeated → name it (`type` / `interface`).
   - A library "should have a type for this" → check its docs (`z.infer`,
     `GraphQLFieldResolver`). You COPY these patterns, you don't invent them.
4. **Start ugly, then refine.** `as any` is a valid escape hatch while learning;
   replace it once it compiles.

TS tells you the PROBLEM. You choose the SOLUTION.

---

## 2. Basic annotations

```ts
// variable (usually let TS infer; annotate only when not obvious)
const port: number = 3000;
const name = "manoj"; // inferred as string — annotation redundant

// function params + return (ALWAYS annotate for exported/public functions)
function add(a: number, b: number): number {
  return a + b;
}

// arrow
const greet = (who: string): string => `hi ${who}`;

// async always returns a Promise
async function load(id: string): Promise<User> {
  /* ... */
}

// void = returns nothing
function log(msg: string): void {
  console.error(msg);
}
```

Rule of thumb: **annotate params + return on public functions; let locals infer.**

---

## 3. `type` vs `interface`

Both describe object shapes. Differences:

```ts
// interface — for object shapes that may be EXTENDED / augmented
interface User {
  id: string;
  email: string;
}
interface User {
  // declaration merging — same name merges (augmentation!)
  createdAt: Date;
}

// type — for unions, intersections, primitives, tuples, function types
type ID = string;
type Status = "active" | "inactive"; // union (interface can't do this)
type WithTimestamps = User & { updatedAt: Date }; // intersection
type Handler = (req: Request) => void; // function type
```

Practical guideline:

- **`interface`** for public object shapes / things others extend or augment.
- **`type`** for unions, intersections, function types, anything not a plain object.
- When in doubt for a plain object: either works. This codebase uses both.

---

## 4. Union & literal types

```ts
type Audience = "nodeforge:user" | "nodeforge:admin"; // string literal union
type Level = "info" | "warn" | "error";

let env: "development" | "production" | "test";

// union of types
type Id = string | number;

// narrowing a union (see §8)
function fmt(x: string | number): string {
  return typeof x === "number" ? x.toFixed(2) : x;
}
```

Literal unions are everywhere in production — far safer than bare `string`,
because the compiler rejects typos.

---

## 5. `as const` + derived types

`as const` freezes an object/array into **literal, readonly** types. Combine with
indexed access to derive a union from values — used for scopes/enums-as-objects.

```ts
// from this codebase: src/shared/constants/scopes.ts
export const SCOPES = {
  READ_PROFILE: "read_profile",
  WRITE_PROFILE: "write_profile",
  ADMIN_ACCESS: "admin_access",
} as const;
// without as const: each value is `string`
// with as const:    READ_PROFILE is the literal "read_profile", object is readonly

// derive a union of the VALUES:
export type Scope = (typeof SCOPES)[keyof typeof SCOPES];
//  typeof SCOPES                      -> { READ_PROFILE: "read_profile"; ... }
//  keyof typeof SCOPES                -> "READ_PROFILE" | "WRITE_PROFILE" | ...
//  (typeof SCOPES)[keyof typeof SCOPES] -> "read_profile" | "write_profile" | ...

function authorize(...scopes: Scope[]) {}
authorize(SCOPES.READ_PROFILE); // ok
authorize("read_profile"); // ok (literal matches)
authorize("hacker"); // compile error
```

**Prefer `const` object + `as const` over TS `enum`** (enums have runtime quirks;
const objects are simpler and tree-shakeable).

---

## 6. Generics

A generic lets a function/type work for MANY types while PRESERVING the type
(instead of falling back to `any`). Reach for it when **output depends on input**.

```ts
// simplest: identity preserves the type
function first<T>(arr: T[]): T | undefined {
  return arr[0];
}
first([1, 2, 3]); // T = number  -> number | undefined
first(["a", "b"]); // T = string  -> string | undefined

// constraint: T must extend something
function lengthOf<T extends { length: number }>(x: T): number {
  return x.length;
}

// default type param
interface ApiResult<T = unknown> {
  data: T;
  success: boolean;
}

// from this codebase: src/shared/utils/parseInput.ts
// "return type depends on the Zod schema passed in" -> generic
export function parseInput<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
): z.infer<T> {
  // <- output derived from input T
  const result = schema.safeParse(data);
  if (!result.success) throw new ValidationError(result.error.issues);
  return result.data;
}

// from this codebase: GraphQL resolver wrapper preserves resolver type
type Resolver<P, A> = GraphQLFieldResolver<P, GraphQLContext, A>;
function requireAuth<P, A>(resolver: Resolver<P, A>): Resolver<P, A> {
  return (parent, args, ctx, info) => {
    if (!ctx.user) throw new InvalidTokenError();
    return resolver(parent, args, ctx, info);
  };
}
```

Naming convention: `T` (type), `K` (key), `V` (value), `P` (parent), `A` (args),
`R` (result). Just conventions — any name works.

**Signal to use a generic:** you'd otherwise write `any`, OR you'd duplicate the
same function for different types, OR the caller loses type info on the return.

---

## 7. Utility types

Built-in helpers that transform existing types. The daily workhorses:

```ts
interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

Pick<User, "id" | "email">; // { id: string; email: string }
Omit<User, "passwordHash">; // User without passwordHash
Partial<User>; // all fields optional
Required<User>; // all fields required
Readonly<User>; // all fields readonly
Record<string, number>; // { [k: string]: number }
Record<Scope, string>; // object keyed by each Scope literal
NonNullable<string | null>; // string

// from functions/values:
type Args = Parameters<typeof parseInput>; // [schema, data] tuple
type Ret = ReturnType<typeof getUserById>; // Promise<User>
type Plain = Awaited<Promise<User>>; // User (unwraps a Promise)

// real use from this codebase (userQueries.ts):
function createUser(): Promise<
  Pick<User, "id" | "email" | "status" | "createdAt">
> {}
```

`Pick`, `Omit`, `Partial`, `Record`, `Awaited`, `ReturnType` cover most needs.

---

## 8. Type narrowing & guards

Convert a broad type to a specific one via a runtime check. TS follows the check.

```ts
function handle(x: unknown) {
  if (typeof x === "string") x.toUpperCase(); // x: string here
  if (typeof x === "number") x.toFixed(2); // x: number here
}

// instanceof — narrow unknown error to Error (used everywhere in catch blocks)
try {
  /* ... */
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
}

// Array.isArray — header can be string | string[] | undefined
const xff = req.headers["x-forwarded-for"];
const value = Array.isArray(xff) ? xff[0] : xff;

// "key" in obj — narrow by property presence (used in GraphQL plugins)
if (arg && "value" in arg.value) return String(arg.value.value);

// truthiness / null check
if (!user) return null; // after this, user is non-null

// discriminated union — narrow by a shared literal "tag" field
type Result = { kind: "ok"; data: string } | { kind: "err"; message: string };
function show(r: Result) {
  if (r.kind === "ok") return r.data; // r is the ok variant
  return r.message; // r is the err variant
}
// real use (Apollo response): ctx.response.body.kind === "single" ? ... : ...
```

---

## 9. Type assertions

Tell TS "trust me" when you know more than it does. Use sparingly.

```ts
// as — assert a type (no runtime effect, just compile-time)
const el = req.headers["x-platform"] as string | undefined;

// as const — literal + readonly (see §5)
const opts = { sameSite: "lax" } as const; // sameSite is "lax", not string

// non-null assertion ! — "this is not null/undefined, trust me"
const user = req.user!; // req.user was AuthUser | null

// double assertion (escape hatch — when types truly don't overlap)
const x = something as unknown as TargetType;

// satisfies — check a value matches a type WITHOUT widening it
const config = {
  port: 3000,
  host: "localhost",
} satisfies Record<string, string | number>;
// config.port stays number (not widened); but it's checked against the type
```

**`as` is a promise to the compiler, not a runtime cast.** If you lie, you get a
runtime crash. For real runtime validation use Zod (§18), not `as`.

---

## 10. Strict null handling

With `strict: true` (this project), `null`/`undefined` are tracked.

```ts
let x: string | undefined;
x.toUpperCase(); // error: x might be undefined

// optional chaining ?. — short-circuits to undefined if null/undefined
req.user?.id; // undefined if req.user is null

// nullish coalescing ?? — fallback ONLY for null/undefined (not "" or 0)
const level = process.env.LOG_LEVEL ?? "info";
const platform = (req.headers["x-platform"] as string | undefined) ?? "web";

// optional property ?:
interface Opts {
  timeout?: number;
} // timeout may be absent

// noUncheckedIndexedAccess (on in this project): arr[i] is T | undefined
const arr = ["a", "b"];
const item = arr[0]; // string | undefined — must handle the undefined case
```

`??` vs `||`: `??` only falls back on null/undefined; `||` falls back on any
falsy (`""`, `0`, `false`). Prefer `??` unless you really want falsy-fallback.

---

## 11. `unknown` vs `any` vs `never`

```ts
let a: any; // disables type checking — AVOID (defeats TS). Lints warn.
let u: unknown; // "I don't know the type" — SAFE, must narrow before use
let n: never; // "this never happens" — exhaustiveness, impossible states

// unknown forces a check (good for boundaries — caught errors, JSON, req.body)
function parse(json: string): unknown {
  return JSON.parse(json);
}
const data = parse(s);
if (typeof data === "object" && data !== null) {
  /* narrow first */
}

// never — exhaustive switch (compile error if you miss a case)
function area(shape: "circle" | "square"): number {
  switch (shape) {
    case "circle":
      return 1;
    case "square":
      return 2;
    default: {
      const _x: never = shape;
      return _x;
    } // errors if a case is unhandled
  }
}
```

Rule: at boundaries (HTTP body, JSON, `catch (err)`) use `unknown`, then narrow.
Avoid `any`. Use `never` for exhaustiveness checks.

---

## 12. Inference helpers

Derive types from existing values/schemas instead of writing them twice.

```ts
// typeof — get the type of a value
const defaults = { retries: 3, timeout: 5000 };
type Defaults = typeof defaults; // { retries: number; timeout: number }

// indexed access T[K] — pull a property's type out
type EnvName = AppConfig["env"]; // the type of AppConfig.env
type JsonFn = Response["json"]; // the type of res.json

// z.infer — derive a TS type from a Zod schema (single source of truth)
const signupSchema = z.object({ email: z.string(), password: z.string() });
type SignupInput = z.infer<typeof signupSchema>; // { email: string; password: string }

// Drizzle inferred row types
type User = typeof users.$inferSelect; // shape when you SELECT
type NewUser = typeof users.$inferInsert; // shape when you INSERT (defaults optional)
```

These are LIBRARY patterns — you learn them from the library's docs, then reuse.

---

## 13. Module augmentation & `.d.ts`

Add fields to types you don't own (Express, Node, ws). Used in
`src/types/index.d.ts`.

```ts
// add custom fields to Express's Request (so req.user etc. are typed everywhere)
import type { AuthUser } from "../modules/auth/services/verifyToken.js";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user: AuthUser | null;
    }
  }
}

// augment a specific module
declare module "http" {
  interface IncomingMessage {
    requestId?: string;
    rawBody?: Buffer;
  }
}

export {}; // makes the file a module — required for `declare global`
```

`.d.ts` = **declaration file**: types only, no runtime code, never compiled to JS.
TS auto-loads any `.d.ts` inside the `include` paths. The filename is arbitrary.

---

## 14. `import type`

Type-only imports are erased at compile (zero runtime cost). Helps bundlers and
avoids accidental runtime dependencies.

```ts
import type { Request, Response } from "express"; // erased at compile
import { Router } from "express"; // kept (runtime value)

// mixed
import express, { type Express } from "express";
```

This project's ESLint auto-fixes value-only-used-as-type imports to `import type`.

---

## 15. Index signatures & `Record`

```ts
// index signature — object with arbitrary keys of a known value type
interface Cache {
  [key: string]: number;
}

// Record<K, V> — cleaner equivalent
type Cache2 = Record<string, number>;

// keyed by a literal union — forces ALL keys present (used in constants.ts)
const CONSENT_VERSIONS: Record<ConsentType, string> = {
  /* every ConsentType */
};
// ^ if you add a ConsentType and forget its version here -> compile error
```

---

## 16. Function & callback types

```ts
// function type alias
type Middleware = (req: Request, res: Response, next: NextFunction) => void;

// callback param typed inline
arr.map((x: string) => x.length);

// higher-order: function returning a function (factory middleware pattern)
function validate(schema: z.ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    /* inner params inferred from RequestHandler */
  };
}

// optional + rest params
function authorize(...scopes: Scope[]): RequestHandler {}
function build(name: string, opts?: Options): void {}
```

When a function returns a typed function (like `RequestHandler`), the inner
params are **inferred** from that return type — no need to re-annotate them.

---

## 17. Mapped & conditional types (advanced)

You rarely write these by hand early on, but you'll read them in libraries.

```ts
// mapped type — transform each key of a type
type Optional<T> = { [K in keyof T]?: T[K] }; // like Partial<T>
type Stringify<T> = { [K in keyof T]: string };

// conditional type — type-level if/else
type IsString<T> = T extends string ? true : false;
type Unwrap<T> = T extends Promise<infer U> ? U : T; // `infer` extracts a type
```

If you find yourself needing these, look up the exact pattern — don't memorize.

---

## 18. Library patterns

### Express

```ts
import type { Request, Response, NextFunction, RequestHandler } from "express";

// direct middleware
function mw(req: Request, res: Response, next: NextFunction): void {}

// factory middleware (returns RequestHandler; inner params inferred)
function factory(arg: string): RequestHandler {
  return (req, _res, next) => {
    next();
  };
}
```

### Zod (runtime validation + types from one schema)

```ts
import { z } from "zod";
const schema = z.object({ email: z.string().email(), age: z.number().int() });
type Input = z.infer<typeof schema>; // derive the TS type
const parsed = schema.parse(data); // runtime validate (throws)
const safe = schema.safeParse(data); // { success, data | error }
```

Zod is how you validate at boundaries — because TS types are ERASED at runtime,
TS alone can't check incoming HTTP/JSON data. Zod does the runtime check.

### Drizzle

```ts
export const users = pgTable("users", {
  /* columns */
});
export type User = typeof users.$inferSelect; // row shape
export type NewUser = typeof users.$inferInsert; // insert shape
```

### Apollo / GraphQL

```ts
import type { ApolloServerPlugin } from "@apollo/server";
import type { GraphQLFieldResolver, GraphQLSchema } from "graphql";

function createPlugin(
  schema: GraphQLSchema,
): ApolloServerPlugin<GraphQLContext> {}
type Resolver<P, A> = GraphQLFieldResolver<P, GraphQLContext, A>;
```

---

## 19. Quick reference table

| You want to...                    | Reach for                                    |
| --------------------------------- | -------------------------------------------- |
| Type a function input/output      | param + return annotation (§2)               |
| One of a fixed set of strings     | literal union `"a" \| "b"` (§4)              |
| Freeze constants + derive a union | `as const` + `T[keyof typeof T]` (§5)        |
| Output type depends on input      | **generic** `<T>` (§6)                       |
| Subset / variation of a type      | `Pick` / `Omit` / `Partial` / `Record` (§7)  |
| Narrow `unknown` / a union        | `typeof` / `instanceof` / `in` / `kind` (§8) |
| "Trust me, it's type X"           | `as` / `!` (sparingly) (§9)                  |
| Handle maybe-missing value        | `?.` / `??` / `?:` (§10)                     |
| Boundary input (HTTP/JSON/error)  | `unknown` then narrow (§11)                  |
| Type from a value/schema          | `typeof` / `z.infer` / `$inferSelect` (§12)  |
| Add fields to Express/Node types  | module augmentation in `.d.ts` (§13)         |
| Validate runtime data             | Zod `.parse` / `.safeParse` (§18)            |

---

### Golden rules

1. Annotate params + returns; let locals infer.
2. Prefer `unknown` over `any`; narrow before use.
3. `as const` + literal unions over `enum`.
4. Use a generic when the output type depends on the input.
5. TS types vanish at runtime — validate boundaries with Zod.
6. TS tells you WHERE; you choose the fix. Start simple, refine.
