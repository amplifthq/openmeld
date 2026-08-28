import type { RemoteAgentTurnEnvelope } from "@openmeld/schemas/types";

export type CenterAgentMemoryFrozenTurnContext = {
  interactionEnvironment: NonNullable<
    RemoteAgentTurnEnvelope["interactionEnvironment"]
  >;
  sender: RemoteAgentTurnEnvelope["sender"];
};

export function resolveCenterAgentMemoryFrozenTurnContext(
  turnEnvelope: RemoteAgentTurnEnvelope
): CenterAgentMemoryFrozenTurnContext | null {
  const directEnvironment = turnEnvelope.interactionEnvironment;
  const plannedEnvironment =
    turnEnvelope.contextScopePlan?.interactionEnvironment;
  if (
    directEnvironment &&
    plannedEnvironment &&
    directEnvironment !== plannedEnvironment
  ) {
    return null;
  }
  const interactionEnvironment = directEnvironment ?? plannedEnvironment;
  return interactionEnvironment
    ? { interactionEnvironment, sender: turnEnvelope.sender }
    : null;
}
