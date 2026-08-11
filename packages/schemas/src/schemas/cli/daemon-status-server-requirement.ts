import { z } from "zod/v4";
import {
  localCliComponentUpdateProjectionSchema,
  localServiceComponentUpdateProjectionSchema,
} from "../local-components";

export const cliVersionVerdictKindSchema = z.enum([
  "aligned",
  "channel_behind",
  "channel_ahead",
  "channel_unavailable",
  "server_unavailable",
]);

export const serviceVersionVerdictKindSchema = z.enum([
  "aligned",
  "update_available",
  "update_required",
  "unknown",
  "server_unavailable",
]);

export const cliVersionVerdictSchema = z.strictObject({
  kind: cliVersionVerdictKindSchema,
  message: z.string().trim().min(1),
});

export const serviceVersionVerdictSchema = z.strictObject({
  kind: serviceVersionVerdictKindSchema,
  message: z.string().trim().min(1),
});

export const daemonStatusServerRequirementUnavailableReasonSchema = z.enum([
  "signed_out",
  "offline",
  "request_failed",
]);

const availableDaemonStatusServerRequirementSchema = z.strictObject({
  available: z.literal(true),
  generatedAt: z.iso.datetime({ offset: true }),
  cli: localCliComponentUpdateProjectionSchema,
  service: localServiceComponentUpdateProjectionSchema,
  verdict: z.strictObject({
    cli: cliVersionVerdictSchema,
    service: serviceVersionVerdictSchema,
  }),
});

const unavailableDaemonStatusServerRequirementSchema = z.strictObject({
  available: z.literal(false),
  reason: daemonStatusServerRequirementUnavailableReasonSchema,
  detail: z.string().nullable(),
});

export const daemonStatusServerRequirementSchema = z.discriminatedUnion(
  "available",
  [
    availableDaemonStatusServerRequirementSchema,
    unavailableDaemonStatusServerRequirementSchema,
  ]
);

export type CliVersionVerdict = z.infer<typeof cliVersionVerdictSchema>;
export type CliVersionVerdictKind = z.infer<typeof cliVersionVerdictKindSchema>;
export type DaemonStatusServerRequirement = z.infer<
  typeof daemonStatusServerRequirementSchema
>;
export type DaemonStatusServerRequirementUnavailableReason = z.infer<
  typeof daemonStatusServerRequirementUnavailableReasonSchema
>;
export type ServiceVersionVerdict = z.infer<typeof serviceVersionVerdictSchema>;
export type ServiceVersionVerdictKind = z.infer<
  typeof serviceVersionVerdictKindSchema
>;
