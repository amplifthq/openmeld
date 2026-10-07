import * as z from "zod/v4";

const eventTime = z.iso.datetime();
export const desktopTransportDiagnosticEventSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      at: eventTime,
      kind: z.literal("request"),
      route: z
        .string()
        .max(160)
        .regex(/^[a-zA-Z0-9/:_-]+$/u),
      method: z.enum([
        "GET",
        "HEAD",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "other",
      ]),
      outcome: z.enum(["ok", "authentication", "http", "network", "admission"]),
      status: z.number().int().min(100).max(599).optional(),
      requestId: z
        .string()
        .regex(/^[a-zA-Z0-9-]{8,80}$/u)
        .optional(),
      elapsedMs: z.number().int().nonnegative(),
    }),
    z.strictObject({
      at: eventTime,
      kind: z.literal("stream"),
      event: z.enum([
        "connecting",
        "open",
        "error",
        "close",
        "cancelled",
        "admission",
      ]),
      code: z.number().int().min(1000).max(4999).optional(),
      stream: z.string().regex(/^[a-f0-9]{16}$/u),
    }),
  ]
);

export const desktopTransportDiagnosticsSchema = z.strictObject({
  format: z.literal(1),
  version: z.string().max(80),
  webBuild: z.string().regex(/^[a-f0-9]{64}$/u),
  events: z.array(desktopTransportDiagnosticEventSchema).max(200),
});
export type DesktopTransportDiagnosticEvent = z.infer<
  typeof desktopTransportDiagnosticEventSchema
>;
