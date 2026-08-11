import { formatOpenMeldCliCommands } from "../runtime/cli-entry-command";
import { runLocalStateAlignment } from "../system/local-state-alignment";
import { buildAgentCheckResult } from "./build-agent-check-result";
import {
  buildBlockedEntryCheckResult,
  ENTRY_CHECK_BLOCKED_ERROR_CODES,
} from "./entry-check-blocked-json";
import { showHumanCheckCard } from "./show-human-check-card";
import type {
  CommandCheckRequirement,
  CommandEntryContext,
  CommandEntryResult,
} from "./types";

export async function runLocalRuntimeStateCheck(input: {
  context: CommandEntryContext;
  requirement: CommandCheckRequirement;
}): Promise<CommandEntryResult> {
  if (input.requirement.mode === "skip") {
    return {
      status: "continue",
    };
  }

  try {
    const report = await runLocalStateAlignment({
      mode: "check",
    });
    if (report.spaceCache.requiresRepair) {
      throw new Error(buildLocalStateRepairRequiredMessage(report));
    }
    return {
      status: "continue",
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error && error.message.trim().length > 0
        ? error.message.trim()
        : "local OpenMeld data update failed";
    if (input.context.jsonOutput) {
      return buildBlockedEntryCheckResult({
        code: ENTRY_CHECK_BLOCKED_ERROR_CODES.localRuntimeState,
        message: errorMessage,
      });
    }
    if (input.context.runtime.resolvedView === "human") {
      showHumanCheckCard({
        presenter: input.context.presenter,
        codePrefix: "command.entry.local_runtime_state.card",
        title: "OpenMeld Local Data Needs Repair",
        status: "OpenMeld could not finish updating local data.",
        why: errorMessage,
        next: "Run `openmeld repair local-state` and retry.",
      });
    } else {
      input.context.presenter.data({
        code: "command.entry.local_runtime_state.blocked",
        payload: buildAgentCheckResult({
          code: "local_state.repair_required",
          status: "blocked",
          reason: errorMessage,
          nextSteps: formatOpenMeldCliCommands(["openmeld repair local-state"]),
          humanActionRequired: false,
          canContinueAfterFix: true,
        }),
      });
    }
    return {
      status: "blocked",
      exitCode: 1,
    };
  }
}

function buildLocalStateRepairRequiredMessage(input: {
  spaceCache: {
    detectedCorruptFiles: number;
    detectedCorruptSpaceConfigFiles: number;
    detectedCorruptMaintenanceFiles: number;
    detectedCorruptDeletionNoticeFiles: number;
  };
}): string {
  const parts: string[] = [];
  if (input.spaceCache.detectedCorruptSpaceConfigFiles > 0) {
    parts.push(
      `${input.spaceCache.detectedCorruptSpaceConfigFiles} space cache file${input.spaceCache.detectedCorruptSpaceConfigFiles === 1 ? "" : "s"}`
    );
  }
  if (input.spaceCache.detectedCorruptMaintenanceFiles > 0) {
    parts.push(
      `${input.spaceCache.detectedCorruptMaintenanceFiles} maintenance file${input.spaceCache.detectedCorruptMaintenanceFiles === 1 ? "" : "s"}`
    );
  }
  if (input.spaceCache.detectedCorruptDeletionNoticeFiles > 0) {
    parts.push(
      `${input.spaceCache.detectedCorruptDeletionNoticeFiles} deletion notice file${input.spaceCache.detectedCorruptDeletionNoticeFiles === 1 ? "" : "s"}`
    );
  }

  const detail = parts.join(", ");
  if (detail) {
    return `local OpenMeld data contains corrupt space state (${detail})`;
  }

  return `local OpenMeld data contains ${input.spaceCache.detectedCorruptFiles} corrupt file${input.spaceCache.detectedCorruptFiles === 1 ? "" : "s"}`;
}
