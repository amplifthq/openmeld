import { formatOpenMeldCliCommands } from "../runtime/cli-entry-command";
import { collectSkillsReadinessSnapshot } from "../skills/installation-inventory";
import { buildAgentCheckResult } from "./build-agent-check-result";
import type {
  CommandCheckRequirement,
  CommandEntryContext,
  CommandEntryResult,
} from "./types";

export async function runSkillsCheck(input: {
  context: CommandEntryContext;
  requirement: CommandCheckRequirement;
}): Promise<CommandEntryResult> {
  if (input.requirement.mode === "skip") {
    return {
      status: "continue",
    };
  }

  const snapshot = await collectSkillsReadinessSnapshot().catch(() => null);
  if (!(snapshot && input.context.runtime.resolvedView === "agent")) {
    return {
      status: "continue",
    };
  }
  input.context.presenter.data({
    code: "command.entry.skills.status",
    payload: buildAgentCheckResult({
      code: "skills.status",
      status: snapshot.status === "up_to_date" ? "ok" : "blocked",
      reason:
        snapshot.status === "up_to_date"
          ? "OpenMeld skills are up to date."
          : "OpenMeld skills must be updated before agents rely on OpenMeld instructions.",
      nextSteps: formatOpenMeldCliCommands(["openmeld setup"]),
      humanActionRequired: false,
      canContinueAfterFix: snapshot.status === "up_to_date",
      details: snapshot,
    }),
  });
  return {
    status: "continue",
  };
}
