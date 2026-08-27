import { remoteAgentWorkerRuntimeDiagnosticsResponseSchema } from "@openmeld/schemas";
import type { RemoteAgentWorkerRuntimeDiagnosticsResponse } from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { readRemoteAgentNativeDeliveryByExecution } from "../infrastructure/d1/native-delivery-ledger-repo";
import { resolveRemoteAgentNativeDeliveryRuntimeConversationId } from "./remote-agent-conversation-continuity";

export async function readRemoteAgentRuntimeDiagnosticsForDispatch(input: {
  db: D1Database | undefined;
  dispatchId: string;
  remoteAgentWorker: CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"] | undefined;
  spaceId: string;
  targetProfileId: string;
}): Promise<RemoteAgentWorkerRuntimeDiagnosticsResponse | null> {
  if (!input.db) {
    throw new Error(
      "Remote Agent runtime diagnostics require the Wake evidence store."
    );
  }
  const nativeDelivery = await readRemoteAgentNativeDeliveryByExecution({
    db: input.db,
    dispatchId: input.dispatchId,
    profileId: input.targetProfileId,
    spaceId: input.spaceId,
  });
  if (!nativeDelivery) {
    return null;
  }
  const runtimeConversationId =
    resolveRemoteAgentNativeDeliveryRuntimeConversationId(nativeDelivery);
  if (!runtimeConversationId) {
    return null;
  }
  return readRemoteAgentRuntimeDiagnosticsForConversation({
    remoteAgentWorker: input.remoteAgentWorker,
    runtimeConversationId,
    spaceId: input.spaceId,
  });
}

export async function readRemoteAgentRuntimeDiagnosticsForConversation(input: {
  remoteAgentWorker: CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"] | undefined;
  runtimeConversationId: string;
  spaceId: string;
}): Promise<RemoteAgentWorkerRuntimeDiagnosticsResponse> {
  if (typeof input.remoteAgentWorker?.readRuntimeDiagnostics !== "function") {
    throw new Error(
      "Remote Agent Worker does not expose readRuntimeDiagnostics."
    );
  }
  return remoteAgentWorkerRuntimeDiagnosticsResponseSchema.parse(
    await input.remoteAgentWorker.readRuntimeDiagnostics({
      runtimeConversationId: input.runtimeConversationId,
      spaceId: input.spaceId,
    })
  );
}
