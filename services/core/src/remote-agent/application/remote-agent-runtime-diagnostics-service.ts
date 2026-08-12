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
}): Promise<RemoteAgentWorkerRuntimeDiagnosticsResponse> {
  if (!input.db) {
    throw new Error(
      "Remote Agent runtime diagnostics require the Wake evidence store."
    );
  }
  if (typeof input.remoteAgentWorker?.readRuntimeDiagnostics !== "function") {
    throw new Error(
      "Remote Agent Worker does not expose readRuntimeDiagnostics."
    );
  }
  const nativeDelivery = await readRemoteAgentNativeDeliveryByExecution({
    db: input.db,
    dispatchId: input.dispatchId,
    profileId: input.targetProfileId,
    spaceId: input.spaceId,
  });
  if (!nativeDelivery) {
    throw new Error(
      "Remote Agent runtime diagnostics require a native delivery record."
    );
  }
  const runtimeConversationId =
    resolveRemoteAgentNativeDeliveryRuntimeConversationId(nativeDelivery);
  if (!runtimeConversationId) {
    throw new Error(
      "Remote Agent runtime diagnostics require a frozen runtime conversation identity."
    );
  }
  return remoteAgentWorkerRuntimeDiagnosticsResponseSchema.parse(
    await input.remoteAgentWorker.readRuntimeDiagnostics({
      runtimeConversationId,
      spaceId: input.spaceId,
    })
  );
}
