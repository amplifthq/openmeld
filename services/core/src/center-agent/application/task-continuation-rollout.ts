import type { CoreBindings } from "../../lib/bindings";

export function shouldWriteDestinationNeutralTaskContinuations(
  env: Pick<
    CoreBindings,
    "OPENMELD_TASK_CONTINUATION_DESTINATION_NEUTRAL_ENABLED"
  >
): boolean {
  return env.OPENMELD_TASK_CONTINUATION_DESTINATION_NEUTRAL_ENABLED === "true";
}
