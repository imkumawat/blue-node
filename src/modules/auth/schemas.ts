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

export const signupSchema = z
  .object({
    email: z
      .string({ error: "Email is required" })
      .email("Invalid email address"),
    password: strongPassword,
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
  // Sent by the FE when a CAPTCHA challenge was required (feature-flagged).
  captchaToken: z.string().optional(),
});

export const verifyEmailSchema = z.object({
  email: z.email("Invalid email address"),
  // String, never number — leading-zero codes ("000123") must stay N digits.
  // Length matches appConfig OTP.codeLength (6).
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

// Step 1: request a reset code. Only the email — generic 200 either way.
export const forgotPasswordSchema = z.object({
  email: z.email("Invalid email address"),
});

// Step 2: submit code + new password. Code shape matches verifyEmailSchema.
export const resetPasswordSchema = z
  .object({
    email: z.email("Invalid email address"),
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
