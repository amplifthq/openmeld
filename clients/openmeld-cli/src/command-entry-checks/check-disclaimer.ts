import { runOnboardingDisclaimerGate } from "../onboarding/disclaimer";
import type {
  CommandCheckRequirement,
  CommandEntryContext,
  CommandEntryResult,
} from "./types";

export async function runDisclaimerCheck(input: {
  context: CommandEntryContext;
  requirement: CommandCheckRequirement;
}): Promise<CommandEntryResult> {
  if (input.requirement.mode === "skip") {
    return {
      status: "continue",
    };
  }

  const accepted = await runOnboardingDisclaimerGate({
    runtime: input.context.runtime,
    presenter: input.context.presenter,
    interactive: input.context.allowPrompt,
    codePrefix: "command.entry.disclaimer",
  });
  if (accepted) {
    return {
      status: "continue",
    };
  }
  return {
    status: "cancelled",
  };
}
