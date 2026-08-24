import type {
  RuntimeCoordinatorExecutionTokenAuthorityRecord,
  RuntimeTransportAgentProfileExecutionStateResponse,
} from "@openmeld/schemas/types";
import type {
  RuntimeCoordinatorHeadLifecycleRecord,
  RuntimeCoordinatorRunCommandState,
} from "./runtime-coordinator-authority";

const EXECUTION_STATE_UNAVAILABLE_REASON =
  "runtime_coordinator.execution_state_unavailable";

export async function readRuntimeCoordinatorAgentProfileExecutionState(input: {
  ownerUserId: string;
  ports: {
    readCommandStates: () => Promise<RuntimeCoordinatorRunCommandState[]>;
    readHeadLifecycles: () => Promise<RuntimeCoordinatorHeadLifecycleRecord[]>;
    readTokenAuthority: (
      runtimeCoordinatorExecutionId: string
    ) => Promise<RuntimeCoordinatorExecutionTokenAuthorityRecord | null>;
  };
  targetProfileId: string;
}): Promise<RuntimeTransportAgentProfileExecutionStateResponse> {
  let commandStates: RuntimeCoordinatorRunCommandState[];
  let headLifecycles: RuntimeCoordinatorHeadLifecycleRecord[];
  try {
    [commandStates, headLifecycles] = await Promise.all([
      input.ports.readCommandStates(),
      input.ports.readHeadLifecycles(),
    ]);
  } catch (error) {
    console.warn("[runtime_coordinator.execution_state_index_read_failed]", {
      error: error instanceof Error ? error.message : String(error),
      ownerUserId: input.ownerUserId,
      targetProfileId: input.targetProfileId,
    });
    return unavailableExecutionState();
  }

  const linkedExecutionIds = new Set<string>();
  const headLifecycleState = await readHeadLifecycleExecutionState({
    headLifecycles,
    linkedExecutionIds,
    ownerUserId: input.ownerUserId,
    readTokenAuthority: input.ports.readTokenAuthority,
    targetProfileId: input.targetProfileId,
  });
  if (headLifecycleState.status !== "inactive") {
    return headLifecycleState;
  }

  return await readCommandExecutionState({
    commandStates,
    linkedExecutionIds,
    ownerUserId: input.ownerUserId,
    readTokenAuthority: input.ports.readTokenAuthority,
    targetProfileId: input.targetProfileId,
  });
}

async function readHeadLifecycleExecutionState(input: {
  headLifecycles: RuntimeCoordinatorHeadLifecycleRecord[];
  linkedExecutionIds: Set<string>;
  ownerUserId: string;
  readTokenAuthority: (
    runtimeCoordinatorExecutionId: string
  ) => Promise<RuntimeCoordinatorExecutionTokenAuthorityRecord | null>;
  targetProfileId: string;
}): Promise<RuntimeTransportAgentProfileExecutionStateResponse> {
  for (const head of input.headLifecycles) {
    if (
      head.ownerUserId !== input.ownerUserId ||
      head.targetWakeLifecycleIdentity.targetProfileId !== input.targetProfileId
    ) {
      continue;
    }
    if (head.status === "accepted" || head.status === "waiting") {
      return { status: "active" };
    }
    if (head.status !== "execution_linked") {
      continue;
    }
    const executionId = head.runtimeCoordinatorExecutionId;
    if (!executionId) {
      return unavailableExecutionState();
    }
    input.linkedExecutionIds.add(executionId);
    const linkedState = await readExecutionAuthorityState({
      executionId,
      readTokenAuthority: input.readTokenAuthority,
    });
    if (linkedState.status !== "inactive") {
      return linkedState;
    }
  }

  return { status: "inactive" };
}

async function readCommandExecutionState(input: {
  commandStates: RuntimeCoordinatorRunCommandState[];
  linkedExecutionIds: ReadonlySet<string>;
  ownerUserId: string;
  readTokenAuthority: (
    runtimeCoordinatorExecutionId: string
  ) => Promise<RuntimeCoordinatorExecutionTokenAuthorityRecord | null>;
  targetProfileId: string;
}): Promise<RuntimeTransportAgentProfileExecutionStateResponse> {
  for (const commandState of input.commandStates) {
    if (
      commandState.ownerUserId !== input.ownerUserId ||
      commandState.targetProfileId !== input.targetProfileId ||
      input.linkedExecutionIds.has(commandState.runtimeCoordinatorExecutionId)
    ) {
      continue;
    }
    const commandStateExecution = await readExecutionAuthorityState({
      executionId: commandState.runtimeCoordinatorExecutionId,
      readTokenAuthority: input.readTokenAuthority,
    });
    if (commandStateExecution.status !== "inactive") {
      return commandStateExecution;
    }
  }

  return { status: "inactive" };
}

async function readExecutionAuthorityState(input: {
  executionId: string;
  readTokenAuthority: (
    runtimeCoordinatorExecutionId: string
  ) => Promise<RuntimeCoordinatorExecutionTokenAuthorityRecord | null>;
}): Promise<RuntimeTransportAgentProfileExecutionStateResponse> {
  try {
    const authority = await input.readTokenAuthority(input.executionId);
    if (!authority) {
      console.warn("[runtime_coordinator.execution_state_authority_missing]", {
        runtimeCoordinatorExecutionId: input.executionId,
      });
      return unavailableExecutionState();
    }
    return authority.terminalOutcome
      ? { status: "inactive" }
      : { status: "active" };
  } catch (error) {
    console.warn(
      "[runtime_coordinator.execution_state_authority_read_failed]",
      {
        error: error instanceof Error ? error.message : String(error),
        runtimeCoordinatorExecutionId: input.executionId,
      }
    );
    return unavailableExecutionState();
  }
}

function unavailableExecutionState(): RuntimeTransportAgentProfileExecutionStateResponse {
  return {
    reasonCode: EXECUTION_STATE_UNAVAILABLE_REASON,
    status: "unavailable",
  };
}
