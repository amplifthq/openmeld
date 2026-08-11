import {
  dbCommandFactSummarySchema,
  dbDiagnosticsPayloadSchema,
  dbFactSnapshotSchema,
} from "@openmeld/schemas";
import type {
  DbCommandFactSummary,
  DbDiagnosticsPayload,
  DbFactSnapshot,
} from "@openmeld/schemas/types";

export const buildDbFactSnapshot = (input: DbFactSnapshot): DbFactSnapshot => {
  return dbFactSnapshotSchema.parse(input);
};

export const buildDbDiagnosticsPayload = (
  input: DbDiagnosticsPayload
): DbDiagnosticsPayload => {
  return dbDiagnosticsPayloadSchema.parse(input);
};

export const buildDbCommandFactSummary = (
  input: DbCommandFactSummary
): DbCommandFactSummary => {
  return dbCommandFactSummarySchema.parse(input);
};
