import { z } from "zod";
import {
  CONSENT_TYPES,
  REQUIRED_CONSENTS,
  type ConsentType,
} from "./constants.js";

// Single source of truth for password strength — reused by signup, reset, and
// change-password so the rules can never drift between flows.
const strongPassword = z
  .string({ error: "Password is required" })
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(
    /[^A-Za-z0-9]/,
    "Password must contain at least one special character",
  );

// Same idea as strongPassword: one email definition so the wording cannot drift
// across signup, login, verify, and the two reset steps. `error` is a function
// rather than a plain string because a bare z.email("Invalid email address")
// answers that to a MISSING field too — the two cases deserve different words.
const emailField = z.email({
  error: (issue) =>
    issue.input === undefined ? "Email is required" : "Invalid email address",
});

export const signupSchema = z
  .object({
    email: emailField,
    password: strongPassword,
    confirmPassword: z.string({ error: "Confirm password is required" }),
    // .trim() before the length checks, not after: it both strips padding from
    // what reaches the DB and makes "   " fail min(1) instead of storing spaces
    // in a NOT NULL column.
    firstName: z
      .string({ error: "First name is required" })
      .trim()
      .min(1, "First name is required")
      .max(50, "First name must be at most 50 characters"),
    lastName: z
      .string({ error: "Last name is required" })
      .trim()
      .min(1, "Last name is required")
      .max(50, "Last name must be at most 50 characters"),
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
  email: emailField,
  password: z
    .string({ error: "Password is required" })
    .min(1, "Password is required")
    .max(72, "Password must be at most 72 characters"),
  // Sent by the FE when a CAPTCHA challenge was required (feature-flagged).
  captchaToken: z.string().optional(),
});

export const verifyEmailSchema = z.object({
  email: emailField,
  // String, never number — leading-zero codes ("000123") must stay N digits.
  // Length matches appConfig OTP.codeLength (6).
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

// Step 1: request a reset code. Only the email — generic 200 either way.
export const forgotPasswordSchema = z.object({
  email: emailField,
});

// Step 2: submit code + new password. Code shape matches verifyEmailSchema.
export const resetPasswordSchema = z
  .object({
    email: emailField,
    code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
    newPassword: strongPassword,
    confirmPassword: z.string({ error: "Confirm password is required" }),
  })
  .superRefine((data, ctx) => {
    if (data.newPassword !== data.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        message: "Confirm password do not match password",
        path: ["confirmPassword"],
      });
    }
  });

// Authenticated change: current password proves identity; new must be strong
// and differ from the current one.
export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string({ error: "Current password is required" })
      .min(1, "Current password is required")
      .max(72, "Password must be at most 72 characters"),
    newPassword: strongPassword,
    confirmPassword: z.string({ error: "Confirm password is required" }),
  })
  .superRefine((data, ctx) => {
    if (data.newPassword !== data.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        message: "Confirm password do not match password",
        path: ["confirmPassword"],
      });
    }
    if (data.currentPassword === data.newPassword) {
      ctx.addIssue({
        code: "custom",
        message: "New password must be different from the current password",
        path: ["newPassword"],
      });
    }
  });

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
