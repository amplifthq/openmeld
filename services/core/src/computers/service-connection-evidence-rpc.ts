import {
  serviceConnectionIncidentReportRpcInputSchema,
  serviceConnectionIncidentsReadRpcInputSchema,
} from "@openmeld/schemas";
import type {
  ServiceConnectionIncidentReportRpcInput,
  ServiceConnectionIncidentsReadRpcInput,
} from "@openmeld/schemas/types";
import { type CoreBindings, wakeEvidenceDb } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  readServiceConnectionIncidents,
  storeServiceConnectionIncident,
} from "./service-connection-evidence-repo";

export function createServiceConnectionEvidenceRpc(dependencies: {
  requireOwnerUserId: (
    context: ServiceConnectionIncidentsReadRpcInput["context"]
  ) => string;
  requireOwnedDevice: (
    env: CoreBindings,
    ownerUserId: string,
    deviceId: string
  ) => Promise<void>;
  requireUploader: (
    env: CoreBindings,
    ownerUserId: string,
    input: ServiceConnectionIncidentReportRpcInput
  ) => Promise<void>;
}) {
  return {
    async read(
      env: CoreBindings,
      input: ServiceConnectionIncidentsReadRpcInput
    ) {
      const parsed =
        serviceConnectionIncidentsReadRpcInputSchema.safeParse(input);
      if (!parsed.success) {
        throw invalidIncident();
      }
      const ownerUserId = dependencies.requireOwnerUserId(parsed.data.context);
      await dependencies.requireOwnedDevice(
        env,
        ownerUserId,
        parsed.data.deviceId
      );
      return await readServiceConnectionIncidents({
        db: requireEvidenceDb(env),
        ownerUserId,
        target: parsed.data,
        nowMs: Date.now(),
      });
    },
    async report(
      env: CoreBindings,
      input: ServiceConnectionIncidentReportRpcInput
    ) {
      const parsed =
        serviceConnectionIncidentReportRpcInputSchema.safeParse(input);
      if (!parsed.success) {
        throw invalidIncident();
      }
      const request = parsed.data;
      const ownerUserId = dependencies.requireOwnerUserId(request.context);
      if (
        request.deviceId !== request.report.incident.deviceId ||
        request.runtimeLane !== request.report.incident.runtimeLane
      ) {
        throw invalidIncident();
      }
      await dependencies.requireUploader(env, ownerUserId, request);
      return await storeServiceConnectionIncident({
        db: requireEvidenceDb(env),
        ownerUserId,
        incident: request.report.incident,
        nowMs: Date.now(),
      });
    },
  };
}

function invalidIncident() {
  return createCoreRpcHttpError({
    status: 400,
    code: "invalid_payload",
    reason: "Invalid connection incident.",
  });
}

function requireEvidenceDb(env: CoreBindings) {
  const db = wakeEvidenceDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      code: "computer.connection_incidents.unavailable",
      reason: "Connection history is temporarily unavailable.",
    });
  }
  return db;
}
