import type { CliJsonEntryCheckBlockedErrorCode } from "@openmeld/schemas";
import { emitCliErrorJson } from "../runtime/cli-error-json";
import type { CommandEntryJsonError, CommandEntryResult } from "./types";

/**
 * Stable machine-readable error codes for entry-check blocks emitted under
 * `--json`. These intentionally match the agent-view payload codes so a single
 * blocked state maps to one stable code regardless of output mode.
 *
 * `cliUpdate` emits this envelope under `--json` when the running CLI is below
 * the published required-update floor (`openmeld.minRequiredCliVersion`). An
 * available-but-optional update never blocks and stays silent under `--json`.
 * See `check-cli-update.ts` / `cli-update-assessment.ts`.
 */
export const ENTRY_CHECK_BLOCKED_ERROR_CODES = {
  signIn: "auth.authentication_required",
  selectedProfile: "profile.required",
  localRuntimeState: "local_state.repair_required",
  cliUpdate: "upgrade.required",
} as const satisfies Record<string, CliJsonEntryCheckBlockedErrorCode>;

export function buildBlockedEntryCheckResult(
  jsonError: CommandEntryJsonError
): CommandEntryResult {
  return {
    status: "blocked",
    exitCode: 1,
    jsonError,
  };
}

/**
 * Applies the side effects of a finished entry-check result. Under `--json` a
 * blocked result prints exactly one canonical CLI error envelope; otherwise the
 * blocking check already rendered through the presenter. Returns whether the
 * command body should run.
 */
export function applyEntryCheckResult(input: {
  result: CommandEntryResult;
  jsonOutput: boolean;
}): boolean {
  const { result, jsonOutput } = input;
  if (result.status === "continue") {
    return true;
  }
  if (result.status === "blocked") {
    if (jsonOutput && result.jsonError) {
      emitCliErrorJson(result.jsonError);
    }
    process.exitCode = result.exitCode;
  }
  return false;
}
