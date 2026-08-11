import { cliJsonOutputEnvelopeSchema } from "@openmeld/schemas";
import type {
  CliCommandFailure,
  CliCommandResult,
  CliErrorPayload,
  CliFailureKind,
} from "../../shared/types";

/**
 * Pure parse of a CLI `--json` invocation (stdout + exit code + optional spawn
 * error) into a typed result. No I/O — fully unit-testable.
 */
export function parseCliJsonResult(input: {
  stdout: string;
  exitCode: number;
  spawnError?: string | null;
  /** The process launched but was killed (timeout / maxBuffer) — stdout is
   * incomplete, so the envelope (emitted last) is untrustworthy. */
  terminated?: boolean;
}): CliCommandResult {
  if (input.spawnError) {
    return failure({
      kind: "spawn_failed",
      error: { code: "desktop.spawn_failed", message: input.spawnError },
      input,
    });
  }

  if (input.terminated) {
    return failure({
      kind: "timed_out",
      error: {
        code: "desktop.timed_out",
        message:
          "openmeld did not finish (timed out or produced too much output)",
      },
      input,
    });
  }

  const line = lastJsonObjectLine(input.stdout);
  if (line === null) {
    return failure({
      kind: "parse_failed",
      error: {
        code: "desktop.parse_failed",
        message: "no JSON envelope found on stdout",
      },
      input,
    });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return failure({
      kind: "parse_failed",
      error: {
        code: "desktop.parse_failed",
        message: "stdout JSON envelope was not valid JSON",
      },
      input,
    });
  }

  const validation = cliJsonOutputEnvelopeSchema.safeParse(parsed);
  if (!validation.success) {
    return failure({
      kind: "parse_failed",
      error: {
        code: "desktop.parse_failed",
        message: "stdout JSON envelope did not match the CLI --json schema",
      },
      input,
    });
  }

  const envelope = validation.data;
  if (envelope.type === "error") {
    return failure({
      kind: "cli_error",
      error: envelope.error,
      input,
    });
  }

  const { schemaVersion: _schemaVersion, type, ...data } = envelope;

  if (input.exitCode !== 0) {
    return failure({
      kind: "nonzero_exit",
      error: {
        code: "desktop.nonzero_exit",
        message: `command exited ${input.exitCode} with a non-error envelope`,
      },
      input,
    });
  }

  return {
    ok: true,
    type,
    data,
    exitCode: input.exitCode,
  };
}

function failure(args: {
  kind: CliFailureKind;
  error: CliErrorPayload;
  input: { stdout: string; exitCode: number };
}): CliCommandFailure {
  return {
    ok: false,
    kind: args.kind,
    error: args.error,
    exitCode: args.input.exitCode,
    rawStdout: args.input.stdout,
  };
}

/**
 * Returns the last line of stdout that looks like a JSON object, or null.
 * The CLI emits its envelope LAST and as a single line (`outJsonLine` →
 * `JSON.stringify` with no indentation), so "last `{...}` line wins" is exact;
 * this depends on that single-line contract (clients/openmeld-cli COMMAND_CONTRACTS).
 */
function lastJsonObjectLine(stdout: string): string | null {
  const candidates = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));
  return candidates.at(-1) ?? null;
}
