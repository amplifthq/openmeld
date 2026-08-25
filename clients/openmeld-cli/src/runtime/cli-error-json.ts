import type { CliJsonErrorEnvelope } from "@openmeld/schemas";
import { emitCliJsonEnvelope } from "./cli-json-output";

/**
 * The CLI `--json` failure envelope shape, derived from the shared contract in
 * `@openmeld/schemas` so it cannot drift from the runtime schema.
 */
export type CliErrorJsonEnvelope = CliJsonErrorEnvelope;

export function buildCliErrorJsonEnvelope(input: {
  code: string;
  message: string;
  requestId?: string | null;
}): CliErrorJsonEnvelope {
  return {
    schemaVersion: 1,
    type: "error",
    error: {
      code: input.code,
      message: input.message,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    },
  };
}

export function emitCliErrorJson(input: {
  code: string;
  message: string;
  requestId?: string | null;
}): void {
  emitCliJsonEnvelope(buildCliErrorJsonEnvelope(input));
}
