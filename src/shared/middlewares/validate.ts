import type { RequestHandler } from "express";
import type { z } from "zod";
import { ValidationError } from "../errors/ValidationError.js";

export function validate<T extends z.ZodTypeAny>(schema: T): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      return next(new ValidationError(errors));
    }
    req.body = result.data;
    next();
  };
}
