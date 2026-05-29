import type { z } from "zod";
import { ValidationError } from "../errors/ValidationError.js";

export function parseInput<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(result.error.issues);
  }
  return result.data;
}
