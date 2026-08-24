import {
  areAgentTaskTerminalOutcomesEqual,
  buildAgentTaskKey,
} from "@openmeld/schemas";
import type {
  AgentTaskHandle,
  AgentTaskTerminalOutcome,
  RuntimeCoordinatorFailurePublicationCommand,
  RuntimeCoordinatorFailurePublicationFinalMessageKind,
  RuntimeCoordinatorFinalizationCommand,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { readAgentTaskTerminalOutcome } from "../infrastructure/d1/agent-task-coordination-repo";
import {
  recordAndEnqueueAgentTaskTerminalOutcome,
  recordAndEnqueueAgentTaskTerminalOutcomeIfMatching,
  recordAndEnqueueAgentTaskTerminalOutcomeWithStoredOutcome,
} from "./agent-task-terminal-outcome-service";

type RuntimeCoordinatorTaskTerminalRecord = {
  nowMs: number;
  outcome: AgentTaskTerminalOutcome;
  task: AgentTaskHandle & { kind: "space_wake" };
};

type RuntimeCoordinatorTaskOutcomeWriteResult = {
  expectedOutcome: AgentTaskTerminalOutcome;
  matches: boolean;
  storedOutcome: AgentTaskTerminalOutcome;
};

type RuntimeCoordinatorTaskOutcomeInspectionResult = {
  expectedOutcome: AgentTaskTerminalOutcome;
  matches: boolean;
  storedOutcome: AgentTaskTerminalOutcome | null;
};

export function projectRuntimeCoordinatorFinalizationTaskTerminalRecord(input: {
  command: RuntimeCoordinatorFinalizationCommand;
  publishedSignalId: string | null;
  publishState: "invalid_space_action" | "reply_published";
}): RuntimeCoordinatorTaskTerminalRecord | null {
  const sourceClientMessageId =
    input.command.dispatchFact.sourceClientMessageId;
  if (!sourceClientMessageId) {
    return null;
  }

  const payload = input.command.acceptedResult.taskResult.payload;
  const occurredAtMs =
    ("telemetry" in payload ? payload.telemetry?.completedAtMs : undefined) ??
    input.command.createdAtMs;
  const task = buildSpaceWakeTaskHandle({
    sourceClientMessageId,
    spaceId: input.command.spaceId,
    targetProfileId: input.command.targetProfileId,
  });
  if (input.publishState === "invalid_space_action") {
    return {
      nowMs: input.command.createdAtMs,
      outcome: {
        errorCode: "agent_task.invalid_space_action",
        eventId: input.command.finalizationCommandId,
        occurredAtMs,
        publishedSignalId: input.publishedSignalId,
        status: "failed",
      },
      task,
    };
  }
  if (payload.status === "failed") {
    return {
      nowMs: input.command.createdAtMs,
      outcome: {
        errorCode: payload.errorCode ?? "agent_task.child_failed",
        eventId: input.command.finalizationCommandId,
        occurredAtMs,
        publishedSignalId: input.publishedSignalId,
        status: "failed",
      },
      task,
    };
  }
  const spaceAction =
    "spaceAction" in payload ? payload.spaceAction : undefined;
  if (spaceAction?.type === "stay_silent") {
    return {
      nowMs: input.command.createdAtMs,
      outcome: {
        errorCode: null,
        eventId: input.command.finalizationCommandId,
        occurredAtMs,
        publishedSignalId: input.publishedSignalId,
        status: "stayed_silent",
      },
      task,
    };
  }
  return {
    nowMs: input.command.createdAtMs,
    outcome: {
      errorCode: null,
      eventId: input.command.finalizationCommandId,
      occurredAtMs,
      publishedSignalId: input.publishedSignalId,
      status: "succeeded",
    },
    task,
  };
}

export function projectRuntimeCoordinatorPublicationFailedTaskTerminalRecord(input: {
  command: RuntimeCoordinatorFinalizationCommand;
  occurredAtMs: number;
  publishedSignalId: string;
  reasonCode: string;
}): RuntimeCoordinatorTaskTerminalRecord | null {
  const sourceClientMessageId =
    input.command.dispatchFact.sourceClientMessageId;
  if (!sourceClientMessageId) {
    return null;
  }
  return {
    nowMs: input.occurredAtMs,
    outcome: {
      errorCode: input.reasonCode,
      eventId: input.command.finalizationCommandId,
      occurredAtMs: input.occurredAtMs,
      publishedSignalId: input.publishedSignalId,
      status: "publication_failed",
    },
    task: buildSpaceWakeTaskHandle({
      sourceClientMessageId,
      spaceId: input.command.spaceId,
      targetProfileId: input.command.targetProfileId,
    }),
  };
}

export function projectRuntimeCoordinatorFailureTaskTerminalRecord(input: {
  command: RuntimeCoordinatorFailurePublicationCommand;
  finalMessageKind: RuntimeCoordinatorFailurePublicationFinalMessageKind;
  publishedSignalId: string;
}): RuntimeCoordinatorTaskTerminalRecord | null {
  const sourceClientMessageId =
    input.command.targetWakeLifecycleIdentity.clientMessageId;
  if (!sourceClientMessageId) {
    return null;
  }

  let status: AgentTaskTerminalOutcome["status"] = "failed";
  if (
    input.finalMessageKind === "status" ||
    input.finalMessageKind === "success_reply"
  ) {
    status = "succeeded";
  }
  return {
    nowMs: input.command.createdAtMs,
    outcome: {
      errorCode: status === "failed" ? input.command.reasonCode : null,
      eventId: input.command.failurePublicationCommandId,
      occurredAtMs: input.command.createdAtMs,
      publishedSignalId: input.publishedSignalId,
      status,
    },
    task: buildSpaceWakeTaskHandle({
      sourceClientMessageId,
      spaceId: input.command.spaceId,
      targetProfileId: input.command.targetProfileId,
    }),
  };
}

export async function recordRuntimeCoordinatorFinalizationTaskOutcome(input: {
  command: RuntimeCoordinatorFinalizationCommand;
  db: D1Database;
  env: CoreBindings;
  publishedSignalId: string | null;
  publishState: "invalid_space_action" | "reply_published";
}): Promise<RuntimeCoordinatorTaskOutcomeWriteResult | null> {
  const record = projectRuntimeCoordinatorFinalizationTaskTerminalRecord(input);
  if (!record) {
    return null;
  }
  const storedOutcome =
    await recordAndEnqueueAgentTaskTerminalOutcomeWithStoredOutcome({
      db: input.db,
      env: input.env,
      ...record,
    });
  return {
    expectedOutcome: record.outcome,
    matches: areAgentTaskTerminalOutcomesEqual(storedOutcome, record.outcome),
    storedOutcome,
  };
}

export async function recordRuntimeCoordinatorPublicationFailedTaskOutcome(input: {
  command: RuntimeCoordinatorFinalizationCommand;
  db: D1Database;
  env: CoreBindings;
  occurredAtMs: number;
  publishedSignalId: string;
  reasonCode: string;
}): Promise<RuntimeCoordinatorTaskOutcomeWriteResult | null> {
  const record =
    projectRuntimeCoordinatorPublicationFailedTaskTerminalRecord(input);
  if (!record) {
    return null;
  }
  const write = await recordAndEnqueueAgentTaskTerminalOutcomeIfMatching({
    db: input.db,
    env: input.env,
    ...record,
  });
  return {
    expectedOutcome: record.outcome,
    matches: write.matches,
    storedOutcome: write.storedOutcome,
  };
}

export async function inspectRuntimeCoordinatorPublicationFailedTaskOutcome(input: {
  command: RuntimeCoordinatorFinalizationCommand;
  db: D1Database;
  occurredAtMs: number;
  publishedSignalId: string;
  reasonCode: string;
}): Promise<RuntimeCoordinatorTaskOutcomeInspectionResult | null> {
  const record =
    projectRuntimeCoordinatorPublicationFailedTaskTerminalRecord(input);
  if (!record) {
    return null;
  }
  const stored = await readAgentTaskTerminalOutcome({
    db: input.db,
    taskKey: buildAgentTaskKey(record.task),
  });
  return {
    expectedOutcome: record.outcome,
    matches:
      !stored ||
      areAgentTaskTerminalOutcomesEqual(stored.outcome, record.outcome),
    storedOutcome: stored?.outcome ?? null,
  };
}

export async function recordRuntimeCoordinatorFailureTaskOutcome(input: {
  command: RuntimeCoordinatorFailurePublicationCommand;
  db: D1Database | undefined;
  env: CoreBindings;
  finalMessageKind: RuntimeCoordinatorFailurePublicationFinalMessageKind;
  publishedSignalId: string;
}): Promise<void> {
  const record = projectRuntimeCoordinatorFailureTaskTerminalRecord(input);
  if (!(record && input.db)) {
    return;
  }
  await recordAndEnqueueAgentTaskTerminalOutcome({
    db: input.db,
    env: input.env,
    ...record,
  });
}

export async function recordRuntimeCoordinatorStoppedTaskOutcome(input: {
  db: D1Database | undefined;
  env: CoreBindings;
  eventId: string;
  occurredAtMs: number;
  publishedSignalId: string;
  reasonCode: string;
  sourceClientMessageId: string | null;
  spaceId: string;
  targetProfileId: string;
}): Promise<void> {
  const record = projectRuntimeCoordinatorStoppedTaskTerminalRecord(input);
  if (!(input.db && record)) {
    return;
  }
  await recordAndEnqueueAgentTaskTerminalOutcome({
    db: input.db,
    env: input.env,
    ...record,
  });
}

export async function recordRuntimeCoordinatorExecutionFailureTaskOutcome(input: {
  db: D1Database | undefined;
  env: CoreBindings;
  eventId: string;
  occurredAtMs: number;
  publishedSignalId: string;
  reasonCode: string;
  sourceClientMessageId: string | null;
  spaceId: string;
  targetProfileId: string;
}): Promise<void> {
  if (!(input.db && input.sourceClientMessageId)) {
    return;
  }
  await recordAndEnqueueAgentTaskTerminalOutcome({
    db: input.db,
    env: input.env,
    nowMs: input.occurredAtMs,
    outcome: {
      errorCode: input.reasonCode,
      eventId: input.eventId,
      occurredAtMs: input.occurredAtMs,
      publishedSignalId: input.publishedSignalId,
      status: "failed",
    },
    task: buildSpaceWakeTaskHandle({
      sourceClientMessageId: input.sourceClientMessageId,
      spaceId: input.spaceId,
      targetProfileId: input.targetProfileId,
    }),
  });
}

export function projectRuntimeCoordinatorStoppedTaskTerminalRecord(input: {
  eventId: string;
  occurredAtMs: number;
  publishedSignalId: string;
  reasonCode: string;
  sourceClientMessageId: string | null;
  spaceId: string;
  targetProfileId: string;
}): RuntimeCoordinatorTaskTerminalRecord | null {
  if (!input.sourceClientMessageId) {
    return null;
  }
  return {
    nowMs: input.occurredAtMs,
    outcome: {
      errorCode: input.reasonCode,
      eventId: input.eventId,
      occurredAtMs: input.occurredAtMs,
      publishedSignalId: input.publishedSignalId,
      status: "stopped",
    },
    task: buildSpaceWakeTaskHandle({
      sourceClientMessageId: input.sourceClientMessageId,
      spaceId: input.spaceId,
      targetProfileId: input.targetProfileId,
    }),
  };
}

function buildSpaceWakeTaskHandle(input: {
  sourceClientMessageId: string;
  spaceId: string;
  targetProfileId: string;
}): AgentTaskHandle & { kind: "space_wake" } {
  return {
    kind: "space_wake",
    sourceClientMessageId: input.sourceClientMessageId,
    spaceId: input.spaceId,
    targetProfileId: input.targetProfileId,
    v: 1,
  };
}
