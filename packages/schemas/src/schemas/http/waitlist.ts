import * as z from "zod/v4";

const normalizedEmailSchema = z
  .string()
  .trim()
  .min(1, { message: "Email is required" })
  .max(320, { message: "Email is invalid" })
  .email({ message: "Email is invalid" })
  .transform((value) => value.toLowerCase());

export const waitlistJoinStatusSchema = z.enum(["created", "already_exists"]);

export const joinWaitlistBodySchema = z.strictObject({
  email: normalizedEmailSchema,
});

export const joinWaitlistResponseSchema = z.strictObject({
  ok: z.literal(true),
  status: waitlistJoinStatusSchema,
});

export const waitlistErrorCodeSchema = z.enum(["waitlist.invalid_input"]);

export const waitlistErrorResponseSchema = z.strictObject({
  ok: z.literal(false),
  code: waitlistErrorCodeSchema,
  message: z.string().min(1),
});
