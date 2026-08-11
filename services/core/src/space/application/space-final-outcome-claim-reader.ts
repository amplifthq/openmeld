import type { CoreBindings } from "../../lib/bindings";
import { resolveSpaceStub } from "../../rpc/space-ref";

export type SpaceFinalOutcomeClaim = {
  outcome: "failure" | "stopped" | "success" | "unknown";
  signalId: string;
};

export async function readSpaceFinalOutcomeClaim(input: {
  dispatchId: string;
  env: CoreBindings;
  spaceId: string;
  targetProfileId: string;
}): Promise<SpaceFinalOutcomeClaim | null> {
  const space = input.env.OPENMELD_SPACES
    ? resolveSpaceStub(input.env.OPENMELD_SPACES, input.spaceId)
    : null;
  if (!space) {
    return null;
  }
  const result = await space.rpcReadFinalReplyClaimOutcome({
    dispatchId: input.dispatchId,
    profileId: input.targetProfileId,
    spaceId: input.spaceId,
  });
  return result.signalId && result.outcome
    ? { outcome: result.outcome, signalId: result.signalId }
    : null;
}
