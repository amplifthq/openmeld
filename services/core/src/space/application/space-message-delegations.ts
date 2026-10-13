import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type {
  GetSpaceMessageDetailsResponse,
  GetSpaceWakeProgressResponse,
  SpaceMessageDelegatedTask,
  SpaceMessageDelegations,
} from "@openmeld/schemas/types";
import {
  type AgentDelegationChildRecord,
  listAgentDelegationsByParentTasks,
} from "../../agent-task-coordination/infrastructure/postgresql/agent-delegation-repo";
import { listSpaceNativeDeliveryTaskIdentities } from "../../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { readCoreRpcHttpStatus } from "../../rpc/errors";

type MessageReader = (
  spaceId: string,
  signalId: string
) => Promise<GetSpaceMessageDetailsResponse>;
type ProgressReader = (
  spaceId: string,
  clientMessageId: string,
  targetProfileId: string
) => Promise<GetSpaceWakeProgressResponse>;
type TargetReader = (
  spaceId: string,
  profileId: string
) => Promise<string | null>;

/** Call only after the source message has passed the ordinary Space read boundary. */
export async function readSpaceMessageDelegations(input: {
  db: PostgresDatabase;
  details: GetSpaceMessageDetailsResponse;
  after?: string;
  readMessage: MessageReader;
  readProgress: ProgressReader;
  readTarget: TargetReader;
}): Promise<SpaceMessageDelegations> {
  const sourceSignalId =
    input.details.wakeContext.sourceSignalId.value ??
    input.details.message.signalId;
  const parents = await listSpaceNativeDeliveryTaskIdentities({
    db: input.db,
    spaceId: input.details.query.spaceId,
    sourceSignalId,
  });
  const page = await listAgentDelegationsByParentTasks({
    db: input.db,
    parents: parents.map((parent) => ({
      organizationId: parent.organizationId,
      task: { v: 1, kind: "native_delivery", deliveryId: parent.deliveryId },
    })),
    after: input.after,
  });
  const groups: SpaceMessageDelegations["groups"] = [];
  for (const record of page.records) {
    const parent = parents.find(
      (candidate) =>
        record.parentTask.kind === "native_delivery" &&
        candidate.deliveryId === record.parentTask.deliveryId &&
        candidate.organizationId === record.organizationId
    );
    if (!parent) {
      throw new Error("space.delegation_parent_mismatch");
    }
    const children: SpaceMessageDelegatedTask[] = [];
    // Bound cross-Space work; do not fan out hundreds of simultaneous DO calls.
    for (let offset = 0; offset < record.children.length; offset += 4) {
      children.push(
        ...(await Promise.all(
          record.children.slice(offset, offset + 4).map((child, index) =>
            readDelegatedChild({
              child,
              key: `${record.delegationId}:${offset + index}`,
              readMessage: input.readMessage,
              readProgress: input.readProgress,
              readTarget: input.readTarget,
            })
          )
        ))
      );
    }
    groups.push({
      delegationId: record.delegationId,
      coordinatorProfileId: parent.profileId,
      completionPolicy: record.completionPolicy,
      children,
    });
  }
  // A membership change or personal deletion during cross-Space I/O must win.
  await input.readMessage(
    input.details.query.spaceId,
    input.details.message.signalId
  );
  return { groups, nextCursor: page.nextCursor };
}

async function readDelegatedChild(input: {
  child: AgentDelegationChildRecord;
  key: string;
  readMessage: MessageReader;
  readProgress: ProgressReader;
  readTarget: TargetReader;
}): Promise<SpaceMessageDelegatedTask> {
  const { child } = input;
  const unavailable: SpaceMessageDelegatedTask = {
    key: input.key,
    availability: "unavailable",
    coordinationState: child.state,
    role: child.role,
    spaceId: null,
    sourceSignalId: null,
    resultSignalId: null,
    targetProfileId: null,
    targetLabel: null,
    taskPreview: null,
    progress: null,
    outcome: null,
  };
  if (child.task.kind !== "space_wake") {
    return unavailable;
  }
  const task = child.task;
  try {
    const progressResponse = await input.readProgress(
      task.spaceId,
      task.sourceClientMessageId,
      task.targetProfileId
    );
    const progress =
      progressResponse.items.find(
        (item) =>
          item.clientMessageId === task.sourceClientMessageId &&
          item.targetProfileId === task.targetProfileId
      ) ?? null;
    if (!progress?.sourceSignalId) {
      if (child.activatedAtMs === null && child.state !== "terminal") {
        const label = await input.readTarget(
          task.spaceId,
          task.targetProfileId
        );
        return label
          ? {
              ...unavailable,
              availability: "readable",
              spaceId: task.spaceId,
              targetProfileId: task.targetProfileId,
              targetLabel: label,
            }
          : unavailable;
      }
      return unavailable;
    }
    const details = await input.readMessage(
      task.spaceId,
      progress.sourceSignalId
    );
    if (
      details.wakeContext.clientMessageId.value !==
        task.sourceClientMessageId ||
      !details.wakeContext.targets.some(
        (target) => target.targetProfileId === task.targetProfileId
      )
    ) {
      return unavailable;
    }
    const resultSignalId = await readVisibleResultSignalId(
      input.readMessage,
      task.spaceId,
      child.terminalOutcome?.publishedSignalId
    );
    return {
      ...unavailable,
      availability: "readable",
      spaceId: task.spaceId,
      sourceSignalId: progress.sourceSignalId,
      resultSignalId,
      targetProfileId: task.targetProfileId,
      targetLabel: progress.targetLabel,
      taskPreview: progress.sourceContext?.messagePreview ?? null,
      progress,
      // The result pointer is separately authorized; never forward an unreadable locator.
      outcome: child.terminalOutcome
        ? { ...child.terminalOutcome, publishedSignalId: resultSignalId }
        : null,
      taskContext: details.wakeContext.targets.find(
        (target) => target.targetProfileId === task.targetProfileId
      )?.taskContext,
    };
  } catch (error) {
    if (isUnavailableMessage(error)) {
      return unavailable;
    }
    throw error;
  }
}

async function readVisibleResultSignalId(
  readMessage: MessageReader,
  spaceId: string,
  signalId: string | null | undefined
): Promise<string | null> {
  if (!signalId) {
    return null;
  }
  try {
    const result = await readMessage(spaceId, signalId);
    return result.message.signalId;
  } catch (error) {
    if (!isUnavailableMessage(error)) {
      throw error;
    }
    return null;
  }
}

function isUnavailableMessage(error: unknown): boolean {
  const status = readCoreRpcHttpStatus(error);
  return status === 401 || status === 403 || status === 404;
}
