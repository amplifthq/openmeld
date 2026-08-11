import { runCliUpdateCheck } from "./check-cli-update";
import { runDisclaimerCheck } from "./check-disclaimer";
import { runLocalRuntimeStateCheck } from "./check-local-runtime-state";
import { runSelectedProfileCheck } from "./check-selected-profile";
import { runServiceCheck } from "./check-service";
import { runSignInCheck } from "./check-sign-in";
import { runSkillsCheck } from "./check-skills";
import { getCommandCheckRequirements } from "./command-check-requirements";
import { resetCurrentCommandCheckState } from "./current-command-check-state";
import type {
  CommandCheckName,
  CommandEntryContext,
  CommandEntryResult,
} from "./types";

const CHECK_RUNNERS: Record<
  CommandCheckName,
  (input: {
    context: CommandEntryContext;
    requirement: ReturnType<
      typeof getCommandCheckRequirements
    >[CommandCheckName];
  }) => Promise<CommandEntryResult>
> = {
  disclaimer: runDisclaimerCheck,
  cliUpdate: runCliUpdateCheck,
  signIn: runSignInCheck,
  selectedProfile: runSelectedProfileCheck,
  localRuntimeState: runLocalRuntimeStateCheck,
  service: runServiceCheck,
  skills: runSkillsCheck,
};

const CHECK_STAGES = [
  "before-entry",
  "after-sign-in",
  "after-profile",
  "status-only",
] as const;

const CHECK_ORDER: CommandCheckName[] = [
  "disclaimer",
  "cliUpdate",
  "localRuntimeState",
  "signIn",
  "selectedProfile",
  "service",
  "skills",
];

export async function runCommandEntryFlow(
  context: CommandEntryContext
): Promise<CommandEntryResult> {
  resetCurrentCommandCheckState();
  const requirements = getCommandCheckRequirements(context.entryName);

  for (const stage of CHECK_STAGES) {
    for (const checkName of CHECK_ORDER) {
      const requirement = requirements[checkName];
      if (requirement.mode === "skip" || requirement.stage !== stage) {
        continue;
      }
      const result = await CHECK_RUNNERS[checkName]({
        context,
        requirement,
      });
      if (result.status !== "continue") {
        return result;
      }
    }
  }

  return {
    status: "continue",
  };
}
