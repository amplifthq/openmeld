import * as z from "zod/v4";

// Age limits priority, not validity. A valid zone remains useful offline.
export const USER_TIME_ZONE_INTERACTIVE_PRIORITY_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeUserTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 128) {
    return null;
  }
  const timeZone = value.trim();
  if (!timeZone || timeZone.startsWith("+") || timeZone.startsWith("-")) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions()
      .timeZone;
  } catch {
    return null;
  }
}

export const userTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .transform((value, context) => {
    const timeZone = normalizeUserTimeZone(value);
    if (timeZone) {
      return timeZone;
    }
    context.addIssue({ code: "custom", message: "Expected an IANA timezone" });
    return z.NEVER;
  });
export const userTimeZoneObservationSourceSchema = z.enum([
  "web",
  "desktop",
  "service",
]);
export const userTimeZoneObservationSchema = z.strictObject({
  timeZone: userTimeZoneSchema,
  source: userTimeZoneObservationSourceSchema,
});
export const userTimeContextSchema = z
  .strictObject({
    timeZone: userTimeZoneSchema,
    source: z.enum(["web", "desktop", "service", "utc"]),
    observedAtMs: z.number().int().nonnegative().nullable(),
  })
  .refine(
    (value) =>
      value.source === "utc"
        ? value.timeZone === "UTC" && value.observedAtMs === null
        : value.observedAtMs !== null,
    {
      message:
        "UTC fallback must be explicit; observations need a server timestamp",
    }
  );
export const userRequestTimeContextSchema = z.strictObject({
  // The cloud dates accepted input. This anchor does not move during Queue/retry.
  submittedAtMs: z.number().int().nonnegative(),
  userTime: userTimeContextSchema,
});
export type UserTimeZoneObservation = z.infer<
  typeof userTimeZoneObservationSchema
>;
export type UserTimeContext = z.infer<typeof userTimeContextSchema>;
export type UserRequestTimeContext = z.infer<
  typeof userRequestTimeContextSchema
>;

export function observeUserTimeZone(
  source: UserTimeZoneObservation["source"]
): UserTimeZoneObservation | null {
  try {
    const timeZone = normalizeUserTimeZone(
      Intl.DateTimeFormat().resolvedOptions().timeZone
    );
    return timeZone ? { timeZone, source } : null;
  } catch {
    return null;
  }
}

export function resolveUserTimeContext(value: unknown): UserTimeContext {
  const parsed = userTimeContextSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : { timeZone: "UTC", source: "utc", observedAtMs: null };
}
