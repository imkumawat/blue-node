import { z } from "zod";
import {
  CONSENT_TYPES,
  REQUIRED_CONSENTS,
  type ConsentType,
} from "./constants.js";

export const signupSchema = z
  .object({
    email: z
      .string({ error: "Email is required" })
      .email("Invalid email address"),
    password: z
      .string({ error: "Password is required" })
      .min(8, "Password must be at least 8 characters")
      .max(72, "Password must be at most 72 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[0-9]/, "Password must contain at least one number")
      .regex(
        /[^A-Za-z0-9]/,
        "Password must contain at least one special character",
      ),
    confirmPassword: z.string({ error: "Confirm password is required" }),
    consents: z.array(
      z.enum(Object.values(CONSENT_TYPES) as [ConsentType, ...ConsentType[]], {
        error: "Invalid consent type",
      }),
      { error: "Consents must be an array" },
    ),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        message: "Confirm password do not match password",
        path: ["confirmPassword"],
      });
    }

    const missing = REQUIRED_CONSENTS.filter((c) => !data.consents.includes(c));
    if (missing.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `Required consents must be accepted: ${missing.join(", ")}`,
        path: ["consents"],
      });
    }
  });

export const loginSchema = z.object({
  email: z
    .string({ error: "Email is required" })
    .email("Invalid email address"),
  password: z
    .string({ error: "Password is required" })
    .min(1, "Password is required")
    .max(72, "Password must be at most 72 characters"),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
