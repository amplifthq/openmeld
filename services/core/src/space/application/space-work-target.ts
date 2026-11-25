import { createHash } from "node:crypto";
import type {
  CenterAgentWorkTargetRecord,
  CenterAgentWorkTargetRequest,
  CenterAgentWorkTargetSourceInput,
  SignalEnvelope,
  SpaceTask,
} from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../../rpc/errors";
import { SpaceTaskDeliveryRepository } from "../infrastructure/sql/space-task-delivery-repo";
import { SpaceTaskRepository } from "../infrastructure/sql/space-task-repo";
import {
  bindWorkTargetSource,
  readSpaceWorkTarget,
  readWorkTargetConversationScope,
  readWorkTargetSource,
  writeSpaceWorkTarget,
} from "../infrastructure/sql/space-work-target-repo";

type Source = Extract<SignalEnvelope, { type: "signal.text" }>;
type Selection = NonNullable<CenterAgentWorkTargetRequest["selection"]>;
type Observed = {
  scope: string | null;
  record: CenterAgentWorkTargetRecord | null;
  task: SpaceTask | null;
};
export type SpaceWorkTargetInput = Omit<
  CenterAgentWorkTargetSourceInput,
  "sourceOwnerUserId"
>;

/** Caller owns the SQLite transaction. Immutable source receipts fence old
 * callbacks from the per-author default for a new message. */
export function accessSpaceWorkTarget(
  sql: SqlStorage,
  input: SpaceWorkTargetInput,
  read: (id: string) => Source | null,
  isSourceSpaceOwner: boolean
) {
  const source = read(input.sourceSignalId);
  const binding = readWorkTargetSource(sql, input.sourceSignalId);
  requireCurrentSource(source, input, binding?.source_revision);
  const observed = observeWorkTarget(sql, input, source, binding, read);
  const { record } = observed;
  if (!input.selection) {
    return { record, selectionRequired: !(binding && record) };
  }
  const signature = createHash("sha256")
    .update(
      JSON.stringify({
        choice: input.selection.choice,
        referenceSourceSignalId: input.referenceSourceSignalId ?? null,
      })
    )
    .digest("hex");
  if (binding) {
    if (binding.selection_signature !== signature || !record) {
      throw conflict("selection_already_bound");
    }
    return { record, selectionRequired: false };
  }
  if (
    (record?.revision ?? 0) !== input.selection.expectedRevision ||
    (record?.sourceSignalId ?? null) !== input.selection.expectedSourceSignalId
  ) {
    throw conflict("revision_conflict");
  }
  const selected = selectTarget(
    sql,
    input.selection,
    source,
    observed,
    input.executorProfileId,
    isSourceSpaceOwner,
    read
  );
  bindWorkTargetSource(sql, {
    signalId: source.id,
    sourceRevision: source.data.meta?.messageRevision ?? 0,
    conversationId: input.logicalConversationId,
    scope: selected.scope,
    signature,
    actorProfileId: source.profile.profileId,
  });
  return { record: selected.record, selectionRequired: false };
}

function observeWorkTarget(
  sql: SqlStorage,
  input: SpaceWorkTargetInput,
  source: Source,
  binding: ReturnType<typeof readWorkTargetSource>,
  read: (id: string) => Source | null
): Observed {
  if (
    binding &&
    binding.logical_conversation_id !== input.logicalConversationId
  ) {
    throw conflict("source_scope_changed");
  }
  const task = taskForSource(sql, source, input.executorProfileId);
  const reference = input.referenceSourceSignalId
    ? readWorkTargetSource(sql, input.referenceSourceSignalId)
    : null;
  if (input.referenceSourceSignalId && !reference) {
    throw conflict("reference_unavailable");
  }
  let scope =
    reference?.scope_key ??
    readWorkTargetConversationScope(
      sql,
      input.logicalConversationId,
      source.profile.profileId
    );
  if (task) {
    if (reference && reference.scope_key !== `task:${task.taskId}`) {
      throw conflict("source_scope_changed");
    }
    scope = `task:${task.taskId}`;
  }
  if (binding) {
    if (reference && reference.scope_key !== binding.scope_key) {
      throw conflict("source_scope_changed");
    }
    scope = binding.scope_key;
  }
  return {
    scope,
    task,
    record: scope ? readCurrentTarget(sql, scope, read) : null,
  };
}

function selectTarget(
  sql: SqlStorage,
  selection: Selection,
  source: Source,
  observed: Observed,
  executor: string,
  isSpaceOwner: boolean,
  read: (id: string) => Source | null
) {
  const choice = selection.choice;
  if (
    observed.task &&
    !maySelectTask(observed.task, source, executor, isSpaceOwner)
  ) {
    throw conflict("source_authority_required");
  }
  if (choice.kind === "inherit") {
    if (!(observed.record && observed.scope)) {
      throw conflict("inherit_unavailable");
    }
    return { scope: observed.scope, record: observed.record };
  }
  const correction = choice.relationship === "correction";
  if (correction && !observed.record) {
    throw conflict("correction_unavailable");
  }
  if (correction) {
    assertMayCorrect(sql, source, observed, executor, isSpaceOwner, read);
  }
  let scope = observed.scope;
  if (!correction) {
    if (observed.task && observed.record) {
      throw conflict("work_already_bound");
    }
    scope = observed.task
      ? `task:${observed.task.taskId}`
      : `request:${source.id}`;
  }
  if (
    !scope ||
    (source.profile.kind !== "human" && source.profile.kind !== "agent")
  ) {
    throw conflict("source_authority_required");
  }
  const record = writeSpaceWorkTarget(sql, {
    scopeKey: scope,
    expectedRevision: correction ? selection.expectedRevision : 0,
    target: choice.target,
    sourceSignalId: source.id,
    sourceRevision: source.data.meta?.messageRevision ?? 0,
    sourceProfileId: source.profile.profileId,
    sourceProfileKind: source.profile.kind,
  });
  return { scope, record };
}

function assertMayCorrect(
  sql: SqlStorage,
  source: Source,
  observed: Observed,
  executor: string,
  isSpaceOwner: boolean,
  read: (id: string) => Source | null
) {
  const taskId = observed.scope?.startsWith("task:")
    ? observed.scope.slice(5)
    : null;
  if (!taskId) {
    const origin = observed.scope?.startsWith("request:")
      ? read(observed.scope.slice(8))
      : null;
    if (!origin || origin.profile.profileId !== source.profile.profileId) {
      throw conflict("source_authority_required");
    }
  } else if (source.profile.kind === "agent" && !observed.task) {
    throw conflict("source_authority_required");
  }
  if (
    taskId &&
    !maySelectTask(
      new SpaceTaskRepository(sql).readTask(taskId),
      source,
      executor,
      isSpaceOwner
    )
  ) {
    throw conflict("source_authority_required");
  }
}

function requireCurrentSource(
  source: Source | null,
  input: SpaceWorkTargetInput,
  boundRevision: number | undefined
): asserts source is Source {
  const editedAt = source?.data.meta?.editedAt ?? 0;
  const revision = source?.data.meta?.messageRevision ?? 0;
  if (
    !source ||
    source.profile.profileId !== input.sourceAuthorProfileId ||
    source.data.meta?.recalledAt ||
    !Number.isFinite(editedAt) ||
    editedAt > input.admittedAtMs ||
    (boundRevision !== undefined && boundRevision !== revision) ||
    (boundRevision === undefined && revision !== 0)
  ) {
    throw conflict("source_changed");
  }
}

function readCurrentTarget(
  sql: SqlStorage,
  scope: string,
  read: (id: string) => Source | null
) {
  const record = readSpaceWorkTarget(sql, scope);
  if (!record) {
    return null;
  }
  const source = read(record.sourceSignalId);
  if (
    !source ||
    source.profile.profileId !== record.sourceProfileId ||
    source.profile.kind !== record.sourceProfileKind ||
    source.data.meta?.recalledAt ||
    (source.data.meta?.messageRevision ?? 0) !== record.sourceRevision
  ) {
    sql.exec("DELETE FROM space_work_targets WHERE scope_key = ?", scope);
    return null;
  }
  return record;
}

/** Use Task-owned publication receipts. A Wake execution taskId is unrelated. */
function taskForSource(sql: SqlStorage, source: Source, executor: string) {
  const tasks = new SpaceTaskRepository(sql);
  if (source.data.taskDraft) {
    const receipt = tasks.readOperation(`message:${source.id}`)?.receipt;
    if (!receipt || receipt.task.sourceSignalId !== source.id) {
      throw conflict("task_source_unavailable");
    }
    return tasks.readTask(receipt.task.taskId);
  }
  if (source.data.meta?.purpose !== "space_task_handoff") {
    return null;
  }
  const taskId = new SpaceTaskDeliveryRepository(sql).readHandoffTaskId(
    source.id,
    executor
  );
  if (!taskId) {
    throw conflict("task_source_unavailable");
  }
  return tasks.readTask(taskId);
}

function maySelectTask(
  task: SpaceTask | null,
  source: Source,
  executor: string,
  isSpaceOwner: boolean
) {
  if (!task) {
    return false;
  }
  if (source.profile.kind === "agent") {
    return (
      task.assignee?.profileId === executor ||
      task.reviewer?.profileId === executor
    );
  }
  return (
    source.profile.kind === "human" &&
    (isSpaceOwner ||
      [
        task.requestedBy.profileId,
        task.assignee?.profileId,
        task.reviewer?.profileId,
      ].includes(source.profile.profileId))
  );
}

function conflict(reason: string) {
  return createCoreRpcHttpError({
    status: 409,
    code: `center_agent.work_target.${reason}`,
    reason:
      "Read the current work target and its source before selecting or continuing work.",
  });
}
