import { createHash } from "node:crypto";
import type { AdapterInstructionPrompt } from "@openmeld/adapter-core";
import type { ComputerFileAccessPolicy } from "@openmeld/schemas/types";

export const COMPUTER_FILE_ACCESS_AWARENESS =
  "Stay within the file access available to this OpenMeld run. Treat denied paths as intentional and continue with the safest useful alternative. Only the Computer owner can change this boundary.";

export function applyComputerFileAccessAwareness(input: {
  policy: ComputerFileAccessPolicy;
  promptPlan: AdapterInstructionPrompt & { fallbackPrompt: string };
}): AdapterInstructionPrompt & { fallbackPrompt: string } {
  if (input.policy.mode === "local_agent_settings") {
    return input.promptPlan;
  }

  const developerInstructions = `${input.promptPlan.developerInstructions}\n\n${COMPUTER_FILE_ACCESS_AWARENESS}`;
  const fingerprint = createHash("sha256")
    .update(developerInstructions, "utf8")
    .digest("hex");
  const epochPrefix = input.promptPlan.instructionEpoch.split(":", 1)[0];
  return {
    ...input.promptPlan,
    developerInstructions,
    fallbackPrompt: `${COMPUTER_FILE_ACCESS_AWARENESS}\n\n${input.promptPlan.fallbackPrompt}`,
    instructionEpoch: `${epochPrefix}:${fingerprint}`,
  };
}
