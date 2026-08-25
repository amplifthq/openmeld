import type {
  CenterAgentTurnDiagnostic,
  RemoteAgentWorkerRuntimeDiagnosticsResponse,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import {
  projectRemoteAgentNativeDeliveryTurnDiagnostic,
  type RemoteAgentNativeDeliveryRecord,
} from "../infrastructure/d1/native-delivery-ledger-repo";
import { resolveRemoteAgentNativeDeliveryRuntimeConversationId } from "./remote-agent-conversation-continuity";
import { readRemoteAgentRuntimeDiagnosticsForConversation } from "./remote-agent-runtime-diagnostics-service";

export async function attachCenterAgentTurnRuntimeEvidence(input: {
  deliveries: RemoteAgentNativeDeliveryRecord[];
  remoteAgentWorker: CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"] | undefined;
}): Promise<CenterAgentTurnDiagnostic[]> {
  const runtimeSourceByConversationId = new Map<
    string,
    RemoteAgentNativeDeliveryRecord
  >();
  const turns = input.deliveries.map((delivery) => {
    let runtimeConversationId: string | null = null;
    try {
      runtimeConversationId =
        resolveRemoteAgentNativeDeliveryRuntimeConversationId(delivery) ?? null;
    } catch (error) {
      logUnavailableRuntime({ delivery, error });
    }
    if (runtimeConversationId) {
      runtimeSourceByConversationId.set(runtimeConversationId, delivery);
    }
    return {
      runtimeConversationId,
      turn: projectRemoteAgentNativeDeliveryTurnDiagnostic(delivery),
    };
  });
  const runtimeDiagnosticsByConversationId = new Map<
    string,
    RemoteAgentWorkerRuntimeDiagnosticsResponse | null
  >();
  await Promise.all(
    [...runtimeSourceByConversationId].map(
      async ([runtimeConversationId, delivery]) => {
        try {
          runtimeDiagnosticsByConversationId.set(
            runtimeConversationId,
            await readRemoteAgentRuntimeDiagnosticsForConversation({
              remoteAgentWorker: input.remoteAgentWorker,
              runtimeConversationId,
              spaceId: delivery.spaceId,
            })
          );
        } catch (error) {
          runtimeDiagnosticsByConversationId.set(runtimeConversationId, null);
          logUnavailableRuntime({ delivery, error });
        }
      }
    )
  );
  return projectCenterAgentTurnRuntimeEvidence({
    runtimeDiagnosticsByConversationId,
    turns,
  });
}

export function projectCenterAgentTurnRuntimeEvidence(input: {
  runtimeDiagnosticsByConversationId: ReadonlyMap<
    string,
    RemoteAgentWorkerRuntimeDiagnosticsResponse | null
  >;
  turns: {
    runtimeConversationId: string | null;
    turn: CenterAgentTurnDiagnostic;
  }[];
}): CenterAgentTurnDiagnostic[] {
  return input.turns.map(({ runtimeConversationId, turn }) => {
    const runtimeDiagnostics = runtimeConversationId
      ? input.runtimeDiagnosticsByConversationId.get(runtimeConversationId)
      : null;
    if (!runtimeDiagnostics) {
      return {
        ...turn,
        runtimeEvidence: null,
        runtimeEvidenceStatus: "unavailable",
      };
    }
    const bySubmissionId = new Map(
      (runtimeDiagnostics.turnObservability ?? []).map((evidence) => [
        evidence.submissionId,
        evidence,
      ])
    );
    const evidence = turn.submissionId
      ? bySubmissionId.get(turn.submissionId)
      : undefined;
    if (!evidence) {
      return {
        ...turn,
        runtimeEvidence: null,
        runtimeEvidenceStatus: "not_recorded",
      };
    }
    const { submissionId: _submissionId, ...runtimeEvidence } = evidence;
    return {
      ...turn,
      runtimeEvidence,
      runtimeEvidenceStatus: "available",
    };
  });
}

function logUnavailableRuntime(input: {
  delivery: RemoteAgentNativeDeliveryRecord;
  error: unknown;
}): void {
  console.warn("[core.center_agent.turn_diagnostics.runtime_unavailable]", {
    dispatchId: input.delivery.dispatchId,
    errorName: input.error instanceof Error ? input.error.name : "UnknownError",
    organizationId: input.delivery.organizationId,
    spaceId: input.delivery.spaceId,
  });
}
