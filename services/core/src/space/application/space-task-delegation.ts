import type { SpaceTaskActor } from "@openmeld/schemas/types";
import type { RemoteAgentNativeDeliveryRecord } from "../../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";

/** Called only after Core authenticates the designated Center and its live delivery. */
export function resolveSpaceTaskRepresentedRequester(
  delivery: Pick<
    RemoteAgentNativeDeliveryRecord,
    | "conversationKind"
    | "spaceId"
    | "routineRunId"
    | "workerSubmitRequest"
    | "executionRecoverySubmitRequest"
  >,
  spaceId: string
): SpaceTaskActor | undefined {
  const request =
    delivery.executionRecoverySubmitRequest ?? delivery.workerSubmitRequest;
  const sender = request?.turnEnvelope.sender;
  if (
    delivery.conversationKind !== "space" ||
    delivery.spaceId !== spaceId ||
    delivery.routineRunId ||
    request?.turnEnvelope.space.id !== spaceId ||
    sender?.kind !== "member" ||
    !sender.verified ||
    !sender.profileId ||
    !sender.ownerUserId
  ) {
    return undefined;
  }
  return {
    profileId: sender.profileId,
    ownerUserId: sender.ownerUserId,
    profileName: sender.displayName,
    profileKind: "human",
  };
}
