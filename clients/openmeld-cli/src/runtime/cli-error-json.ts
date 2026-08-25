import type { CliJsonErrorEnvelope } from "@openmeld/schemas";
import { emitCliJsonEnvelope } from "./cli-json-output";

/**
 * The CLI `--json` failure envelope shape, derived from the shared contract in
 * `@openmeld/schemas` so it cannot drift from the runtime schema.
 */
export type CliErrorJsonEnvelope = CliJsonErrorEnvelope;

type CliErrorJsonInput = Omit<CliJsonErrorEnvelope["error"], "requestId"> & {
  requestId?: string | null;
};

export function buildCliErrorJsonEnvelope(
  input: CliErrorJsonInput
): CliErrorJsonEnvelope {
  const { requestId, ...error } = input;
  return {
    schemaVersion: 1,
    type: "error",
    error: {
      ...error,
      ...(requestId ? { requestId } : {}),
    },
  };
}

export function emitCliErrorJson(input: CliErrorJsonInput): void {
  emitCliJsonEnvelope(buildCliErrorJsonEnvelope(input));
}
