// Types for consuming the OpenMeld CLI's machine-readable `--json` surface.
// Contract: clients/openmeld-cli/COMMAND_CONTRACTS.md → "Machine-readable output".

/** A successful CLI `--json` envelope: { schemaVersion, type, ...result }. */
export type CliSuccessEnvelope = {
  schemaVersion: number;
  type: string;
} & Record<string, unknown>;

/** The CLI `--json` error envelope payload. */
export type CliErrorPayload = {
  code: string;
  message: string;
  requestId?: string;
};

/** Why a command did not produce a usable success envelope. */
export type CliFailureKind =
  /** The `openmeld` process could not be launched (e.g. ENOENT, not on PATH). */
  | "spawn_failed"
  /** The process launched but was killed (timeout or output exceeded maxBuffer). */
  | "timed_out"
  /** The CLI emitted a structured `{ type: "error", ... }` envelope. */
  | "cli_error"
  /** Exited non-zero but without a parseable error envelope. */
  | "nonzero_exit"
  /** stdout had no parseable JSON envelope. */
  | "parse_failed";

export type CliCommandSuccess = {
  ok: true;
  /** The envelope `type`, e.g. "daemon.status" / "agents.detect". */
  type: string;
  /** The envelope minus `schemaVersion`/`type`. */
  data: Record<string, unknown>;
  exitCode: number;
};

export type CliCommandFailure = {
  ok: false;
  kind: CliFailureKind;
  error: CliErrorPayload;
  exitCode: number;
  rawStdout: string;
};

export type CliCommandResult = CliCommandSuccess | CliCommandFailure;
