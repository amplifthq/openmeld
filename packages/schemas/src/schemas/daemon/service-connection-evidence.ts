import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";
import { peopleComputerTargetSchema } from "../http/people-computers";
import { openMeldRequestContextSchema } from "./profile-identity";
import { daemonServiceLaneSchema } from "./service-contract";

const timestamp = z.int().nonnegative();
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);

export const serviceConnectionEvidenceEventSchema = z.strictObject({
  kind: z.enum([
    "connecting",
    "transport_open",
    "registered",
    "disconnected",
    "retry_scheduled",
    "credential_cache",
    "reply_reconsideration",
  ]),
  connectionId: z.string().uuid(),
  firstAtMs: timestamp,
  lastAtMs: timestamp,
  count: z.int().min(1).max(10_000_000),
  phase: z.enum([
    "credentials",
    "opening",
    "registering",
    "online",
    "waiting",
    "stopping",
  ]),
  reason: z.enum([
    "auth_unavailable",
    "auth_rejected",
    "auth_expired",
    "auth_missing",
    "network_unreachable",
    "open_timeout",
    "socket_closed",
    "heartbeat_timeout",
    "context_changed",
    "credential_changed",
    "account_changed",
    "metadata_unavailable",
    "credential_available",
    "space_changed",
    "recovered",
    "stopped",
    "unknown",
  ]),
  durationMs: timestamp.optional(),
  retryAtMs: timestamp.optional(),
  lastHeartbeatAckAtMs: timestamp.optional(),
  closeCode: z.int().min(1000).max(4999).optional(),
  nativeErrorCode: z
    .enum([
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "EPIPE",
      "CERT_HAS_EXPIRED",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
    ])
    .optional(),
  requestId: identifier.optional(),
  eventLoopDelayMs: timestamp.optional(),
});

export const serviceConnectionIncidentSchema = z
  .strictObject({
    v: z.literal(1),
    incidentId: z.string().uuid(),
    deviceId: identifier,
    runtimeLane: daemonServiceLaneSchema,
    serviceSessionId: z.string().uuid(),
    serviceVersion: z.string().regex(/^[0-9][0-9A-Za-z.+-]{0,63}$/u),
    startedAtMs: timestamp,
    endedAtMs: timestamp,
    outcome: z.enum(["recovered", "interrupted"]),
    evidenceTruncated: z.boolean(),
    events: z.array(serviceConnectionEvidenceEventSchema).min(1).max(100),
  })
  .refine((value) => value.endedAtMs >= value.startedAtMs, {
    message: "Invalid incident interval.",
  });

export const serviceConnectionIncidentReportSchema = z.strictObject({
  uploaderServiceSessionId: z.string().uuid(),
  incident: serviceConnectionIncidentSchema,
});

export const serviceConnectionIncidentReceiptSchema = z.strictObject({
  incidentId: z.string().uuid(),
  receivedAtMs: timestamp,
});

export const serviceConnectionIncidentsReadRpcInputSchema =
  peopleComputerTargetSchema.extend({ context: openMeldRequestContextSchema });
export const serviceConnectionIncidentReportRpcInputSchema =
  serviceConnectionIncidentsReadRpcInputSchema.extend({
    report: serviceConnectionIncidentReportSchema,
  });

export const serviceConnectionIncidentsResponseSchema = z.strictObject({
  incidents: z
    .array(
      serviceConnectionIncidentSchema.safeExtend({ receivedAtMs: timestamp })
    )
    .max(20),
});

export const serviceConnectionEvidenceJournalSchema = z.strictObject({
  v: z.literal(1),
  entries: z
    .array(
      z.strictObject({
        incident: serviceConnectionIncidentSchema,
        uploadedAtMs: timestamp.nullable(),
      })
    )
    .max(32),
});

export const serviceConnectionTraceDiagnosticsSchema = z.strictObject({
  status: z.enum(["available", "unavailable"]),
  incidents: z
    .array(
      z.strictObject({
        incidentId: z.string().uuid(),
        deviceId: identifier,
        runtimeLane: daemonServiceLaneSchema,
        startedAtMs: timestamp,
        endedAtMs: timestamp,
        outcome: z.enum(["recovered", "interrupted"]),
      })
    )
    .max(20),
});

export type ServiceConnectionEvidenceEvent = zod.infer<
  typeof serviceConnectionEvidenceEventSchema
>;
export type ServiceConnectionIncident = zod.infer<
  typeof serviceConnectionIncidentSchema
>;
export type ServiceConnectionIncidentReport = zod.infer<
  typeof serviceConnectionIncidentReportSchema
>;
export type ServiceConnectionIncidentReceipt = zod.infer<
  typeof serviceConnectionIncidentReceiptSchema
>;
export type ServiceConnectionIncidentsResponse = zod.infer<
  typeof serviceConnectionIncidentsResponseSchema
>;
export type ServiceConnectionIncidentsReadRpcInput = zod.infer<
  typeof serviceConnectionIncidentsReadRpcInputSchema
>;
export type ServiceConnectionIncidentReportRpcInput = zod.infer<
  typeof serviceConnectionIncidentReportRpcInputSchema
>;
export type ServiceConnectionEvidenceJournal = zod.infer<
  typeof serviceConnectionEvidenceJournalSchema
>;
