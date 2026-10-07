import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { buildAgentTaskKey } from "@openmeld/schemas";
import type { AiUsageQueryResponse } from "@openmeld/schemas/types";
import { readAgentTaskTerminalOutcome } from "../agent-task-coordination/infrastructure/postgresql/agent-task-coordination-repo";
import { readRemoteAgentNativeDeliveryByExecution } from "../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { readRuntimeCoordinatorExecutionProjectionByDispatch } from "../runtime-transport/infrastructure/postgresql/runtime-coordinator-execution-repo";
// Consumption never writes or derives execution truth. Enrich only from the
// existing execution owners, without exposing task prompts or private titles.
export async function enrichAiUsageExecutions(input: {
  db: PostgresDatabase;
  organizationId: string;
  usage: AiUsageQueryResponse;
}): Promise<AiUsageQueryResponse> {
  if (input.usage.breakdown?.groupBy !== "task") {
    return input.usage;
  }
  let remaining = 20;
  for (const group of input.usage.breakdown.groups) {
    if (!(group.spaceId && group.agentProfileId)) {
      continue;
    }
    const selected = group.dispatchIds.slice(0, remaining);
    remaining -= selected.length;
    group.executionDetailsTruncated =
      group.dispatchIdsTruncated || selected.length < group.dispatchIds.length;
    group.executions = [];
    for (const dispatchId of selected) {
      group.executions.push(
        await readExecutionContext({
          db: input.db,
          organizationId: input.organizationId,
          dispatchId,
          spaceId: group.spaceId,
          agentProfileId: group.agentProfileId,
          runtime: group.runtime,
        })
      );
    }
  }
  return input.usage;
}
async function readExecutionContext(input: {
  db: PostgresDatabase;
  organizationId: string;
  dispatchId: string;
  spaceId: string;
  agentProfileId: string;
  runtime: "local" | "remote";
}) {
  const { dispatchId } = input;
  if (input.runtime === "local") {
    const execution = await readRuntimeCoordinatorExecutionProjectionByDispatch(
      {
        db: input.db,
        dispatchId,
        spaceId: input.spaceId,
        targetProfileId: input.agentProfileId,
      }
    );
    return {
      dispatchId,
      source: "runtime_coordinator" as const,
      status: execution?.status ?? null,
      outcome: execution?.terminalOutcome?.kind ?? null,
      updatedAtMs: execution?.updatedAtMs ?? null,
    };
  }
  const delivery = await readRemoteAgentNativeDeliveryByExecution({
    db: input.db,
    dispatchId,
    spaceId: input.spaceId,
    profileId: input.agentProfileId,
  });
  if (delivery && delivery.organizationId !== input.organizationId) {
    throw new Error("AI usage execution Organization does not match.");
  }
  const terminal = delivery
    ? await readAgentTaskTerminalOutcome({
        db: input.db,
        taskKey: buildAgentTaskKey({
          v: 1,
          kind: "native_delivery",
          deliveryId: delivery.deliveryId,
        }),
      })
    : null;
  return {
    dispatchId,
    source: "native_delivery" as const,
    status: delivery?.status ?? null,
    outcome: terminal?.outcome.status ?? null,
    updatedAtMs: delivery?.updatedAtMs ?? null,
  };
}
