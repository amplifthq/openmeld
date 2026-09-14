import {
  executionContextAssignmentSchema,
  executionContextCompletionSchema,
  executionContextLegacyAssociationSchema,
} from "@openmeld/schemas";
import type {
  ExecutionContextAssignment,
  ExecutionContextCompletion,
  ExecutionContextScope,
  ExecutionContextTask,
} from "@openmeld/schemas/types";
import type { LegacyContextAssociation } from "./agent-profile-context-migration";
import {
  buildRuntimeCoordinatorHeadLifecycleStorageKey,
  isRuntimeCoordinatorHeadLifecycleRecord,
  type RuntimeCoordinatorHeadLifecycleRecord,
} from "./runtime-coordinator-authority";

const CONTEXT_PREFIX = "runtime-coordinator:execution-context:v1:";
const NATIVE_CONTEXT_PREFIX =
  "runtime-coordinator:execution-context-native:v1:";
const ASSOCIATION_PREFIX = "runtime-coordinator:execution-context-scope:v1:";
const WAKE_CONTEXT_PREFIX = "runtime-coordinator:execution-context-wake:v1:";
type ContextRecord = {
  legacyAssociation?: LegacyContextAssociation;
  assignment: ExecutionContextAssignment;
  bindingId: string;
  openMeldServiceRuntimeId: string;
  agentControllerRef: string;
  createdAtMs: number;
  nativeConversationId: string | null;
  runtimeWorkspaceFingerprint: string | null;
};
type Storage = Pick<DurableObjectTransaction, "get" | "list" | "put">;
type WakeContextRecord = {
  contextId: string;
  ownerUserId: string;
  dispatchId: string;
  runtimeCoordinatorExecutionId: string | null;
  completion?: ExecutionContextCompletion;
};

function wakeContextKey(wakeId: string): string {
  return WAKE_CONTEXT_PREFIX + encodeURIComponent(wakeId);
}

function readWakeContext(value: unknown): WakeContextRecord | null {
  if (value === undefined) {
    return null;
  }
  const record =
    value && typeof value === "object"
      ? (value as Partial<WakeContextRecord>)
      : {};
  if (
    typeof record.contextId !== "string" ||
    !record.contextId ||
    typeof record.ownerUserId !== "string" ||
    !record.ownerUserId ||
    typeof record.dispatchId !== "string" ||
    !record.dispatchId ||
    (record.runtimeCoordinatorExecutionId !== null &&
      typeof record.runtimeCoordinatorExecutionId !== "string")
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.evidence_unavailable"
    );
  }
  if (
    record.completion &&
    !executionContextCompletionSchema.safeParse(record.completion).success
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.evidence_unavailable"
    );
  }
  return record as WakeContextRecord;
}

function createWakeContext(
  record: RuntimeCoordinatorHeadLifecycleRecord,
  contextId: string
): WakeContextRecord {
  return {
    contextId,
    ownerUserId: record.ownerUserId,
    dispatchId: record.primaryDispatchId,
    runtimeCoordinatorExecutionId: record.runtimeCoordinatorExecutionId,
  };
}

export class ExecutionContextSelectionError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string) {
    super(reasonCode);
    this.reasonCode = reasonCode;
  }
}

function scopeKey(scope: ExecutionContextScope): string {
  return [
    scope.targetProfileId,
    scope.organizationId,
    scope.requesterProfileId,
    scope.spaceId,
    scope.threadId ?? "main",
  ]
    .map(encodeURIComponent)
    .join(":");
}

export async function hasRetainedExecutionContexts(input: {
  targetProfileId: string;
  storage: Pick<Storage, "list">;
}): Promise<boolean> {
  const associations = await input.storage.list({
    prefix: `${ASSOCIATION_PREFIX}${encodeURIComponent(input.targetProfileId)}:`,
    limit: 1,
  });
  return associations.size > 0;
}

function requireContext(value: unknown): ContextRecord {
  const record =
    value && typeof value === "object" ? (value as Partial<ContextRecord>) : {};
  const assignment = executionContextAssignmentSchema.safeParse(
    record.assignment
  );
  if (
    !assignment.success ||
    (record.legacyAssociation !== undefined &&
      !executionContextLegacyAssociationSchema.safeParse(
        record.legacyAssociation
      ).success) ||
    typeof record.bindingId !== "string" ||
    !record.bindingId ||
    typeof record.openMeldServiceRuntimeId !== "string" ||
    !record.openMeldServiceRuntimeId ||
    typeof record.agentControllerRef !== "string" ||
    !record.agentControllerRef ||
    typeof record.createdAtMs !== "number" ||
    !Number.isSafeInteger(record.createdAtMs) ||
    record.createdAtMs < 0 ||
    (record.nativeConversationId !== null &&
      (typeof record.nativeConversationId !== "string" ||
        !record.nativeConversationId))
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.evidence_unavailable"
    );
  }
  if (
    record.runtimeWorkspaceFingerprint !== null &&
    typeof record.runtimeWorkspaceFingerprint !== "string"
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.evidence_unavailable"
    );
  }
  return {
    ...(record.legacyAssociation
      ? { legacyAssociation: record.legacyAssociation }
      : {}),
    assignment: assignment.data,
    bindingId: record.bindingId,
    openMeldServiceRuntimeId: record.openMeldServiceRuntimeId,
    agentControllerRef: record.agentControllerRef,
    createdAtMs: record.createdAtMs,
    nativeConversationId: record.nativeConversationId,
    runtimeWorkspaceFingerprint: record.runtimeWorkspaceFingerprint,
  };
}

function sameScope(
  a: ExecutionContextScope,
  b: ExecutionContextScope
): boolean {
  return scopeKey(a) === scopeKey(b);
}

// Resolves from accepted Wake associations in this Coordinator's transaction.
// It returns writes so rejected admission never creates a context or native work.
type AssignmentPlan = {
  record: RuntimeCoordinatorHeadLifecycleRecord;
  writes: Record<string, unknown>;
};
type AssignmentInput = {
  legacyAssociation?: LegacyContextAssociation;
  contextModeActive?: boolean;
  record: RuntimeCoordinatorHeadLifecycleRecord;
  storage: Storage;
  authorizedContinuationSourceWakeId?: string;
};
type AcceptedSnapshot = NonNullable<
  RuntimeCoordinatorHeadLifecycleRecord["acceptedDispatchSnapshot"]
>;
type ContextRequest = NonNullable<AcceptedSnapshot["contextRequest"]>;
type ContextSource = {
  context: ContextRecord;
  completion?: ExecutionContextCompletion;
};

async function retainAcceptedContextDecision(
  input: AssignmentInput,
  snapshot: AcceptedSnapshot
): Promise<AssignmentPlan | null> {
  const existing = await input.storage.get(
    buildRuntimeCoordinatorHeadLifecycleStorageKey(
      input.record.targetWakeLifecycleId
    )
  );
  if (existing === undefined) {
    if (snapshot.executionContext) {
      throw new ExecutionContextSelectionError(
        "execution_context.assignment_not_accepted"
      );
    }
    if (
      await input.storage.get(
        wakeContextKey(input.record.targetWakeLifecycleId)
      )
    ) {
      throw new ExecutionContextSelectionError(
        "execution_context.wake_already_assigned"
      );
    }
    return null;
  }
  if (
    !isRuntimeCoordinatorHeadLifecycleRecord(existing) ||
    existing.primaryDispatchId !== input.record.primaryDispatchId
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.assignment_not_accepted"
    );
  }
  const acceptedId = existing.acceptedDispatchSnapshot?.executionContext?.id;
  if (snapshot.executionContext?.id !== acceptedId) {
    throw new ExecutionContextSelectionError(
      "execution_context.assignment_not_accepted"
    );
  }
  if (!acceptedId) {
    return { record: input.record, writes: {} };
  }
  const key = wakeContextKey(input.record.targetWakeLifecycleId);
  const wake = readWakeContext(await input.storage.get(key));
  if (
    !wake ||
    wake.contextId !== acceptedId ||
    wake.dispatchId !== input.record.primaryDispatchId ||
    wake.ownerUserId !== input.record.ownerUserId
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.assignment_not_accepted"
    );
  }
  if (
    wake.runtimeCoordinatorExecutionId &&
    input.record.runtimeCoordinatorExecutionId &&
    wake.runtimeCoordinatorExecutionId !==
      input.record.runtimeCoordinatorExecutionId
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.result_mismatch"
    );
  }
  return {
    record: input.record,
    writes: {
      [key]: {
        ...wake,
        runtimeCoordinatorExecutionId:
          input.record.runtimeCoordinatorExecutionId ??
          wake.runtimeCoordinatorExecutionId,
      },
    },
  };
}

function assertContextRequestScope(
  input: AssignmentInput,
  request: ContextRequest
): void {
  if (
    request.scope.targetProfileId !==
      input.record.targetWakeLifecycleIdentity.targetProfileId ||
    request.scope.spaceId !== input.record.targetWakeLifecycleIdentity.spaceId
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.scope_mismatch"
    );
  }
}

function assertLegacyFallbackAllowed(
  input: AssignmentInput,
  reasonCode: string
): void {
  if (input.contextModeActive) {
    throw new ExecutionContextSelectionError(reasonCode);
  }
}

export async function prepareExecutionContextAssignment(
  input: AssignmentInput
): Promise<AssignmentPlan> {
  const snapshot = input.record.acceptedDispatchSnapshot;
  if (!snapshot) {
    return { record: input.record, writes: {} };
  }
  const retained = await retainAcceptedContextDecision(input, snapshot);
  if (retained) {
    return retained;
  }
  if (input.authorizedContinuationSourceWakeId) {
    return await resumeAuthorizedWork(
      input,
      snapshot,
      input.authorizedContinuationSourceWakeId
    );
  }
  const request = snapshot.contextRequest;
  if (!request) {
    assertLegacyFallbackAllowed(
      input,
      "execution_context.required_after_activation"
    );
    return { record: input.record, writes: {} };
  }
  assertContextRequestScope(input, request);
  const implicitRequest =
    request.selection.mode === "auto" && request.required === false;
  if (
    implicitRequest &&
    !supportsContextAccess(
      snapshot.controllerSnapshot.agentControllerRef,
      "space_context"
    )
  ) {
    // An unsupported harness keeps its existing Binding conversation. Do not
    // select retained Context history from a previously configured harness.
    assertLegacyFallbackAllowed(
      input,
      "execution_context.harness_unsupported_after_activation"
    );
    return { record: input.record, writes: {} };
  }
  const source = await resolveContextSource(input, request);
  if (source) {
    assertContextBinding(source.context, snapshot);
    if (!sameScope(source.context.assignment.scope, request.scope)) {
      throw new ExecutionContextSelectionError(
        "execution_context.source_scope_mismatch"
      );
    }
  }
  if (
    !source &&
    implicitRequest &&
    request.scope.threadId === null &&
    !input.contextModeActive
  ) {
    return { record: input.record, writes: {} };
  }
  const createsContext =
    !source ||
    request.selection.mode === "new" ||
    request.selection.mode === "fork";
  const selectedContext =
    source && !createsContext
      ? source.context
      : createContext(input.record, snapshot, request, source);
  const context = input.legacyAssociation
    ? { ...selectedContext, legacyAssociation: input.legacyAssociation }
    : selectedContext;
  assertContextPreferences(context, request, createsContext);
  const associationKey = `${ASSOCIATION_PREFIX}${scopeKey(request.scope)}:${context.assignment.id}`;
  return {
    record: {
      ...input.record,
      acceptedDispatchSnapshot: {
        ...snapshot,
        executionContext: context.assignment,
      },
    },
    writes: {
      ...(createsContext || input.legacyAssociation
        ? { [CONTEXT_PREFIX + context.assignment.id]: context }
        : {}),
      [associationKey]: {
        contextId: context.assignment.id,
        targetWakeLifecycleId: input.record.targetWakeLifecycleId,
      },
      [wakeContextKey(input.record.targetWakeLifecycleId)]: createWakeContext(
        input.record,
        context.assignment.id
      ),
    },
  };
}

export async function claimLegacyExecutionContext(input: {
  association: LegacyContextAssociation;
  storage: Storage;
}): Promise<void> {
  if (!input.association.nativeConversationId) {
    return;
  }
  const key =
    NATIVE_CONTEXT_PREFIX +
    [
      input.association.openMeldServiceRuntimeId,
      input.association.agentControllerRef,
      input.association.nativeConversationId,
    ]
      .map(encodeURIComponent)
      .join(":");
  const owner = await input.storage.get<string>(key);
  if (owner && owner !== input.association.id) {
    throw new ExecutionContextSelectionError(
      "execution_context.native_identity_conflict"
    );
  }
  await input.storage.put(key, input.association.id);
}

export async function attachLegacyAssociationToExecutionContext(input: {
  contextId: string;
  association: LegacyContextAssociation;
  storage: Storage;
}): Promise<void> {
  const key = CONTEXT_PREFIX + input.contextId;
  const record = requireContext(await input.storage.get(key));
  await input.storage.put(key, {
    ...record,
    legacyAssociation: input.association,
  });
}

function assertContextBinding(
  context: ContextRecord,
  snapshot: AcceptedSnapshot
): void {
  if (
    context.bindingId !== snapshot.controllerSnapshot.bindingId ||
    context.openMeldServiceRuntimeId !== snapshot.openMeldServiceRuntimeId ||
    context.agentControllerRef !==
      snapshot.controllerSnapshot.agentControllerRef
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.source_scope_mismatch"
    );
  }
}

async function readSourceHead(
  input: AssignmentInput,
  sourceWakeId: string
): Promise<RuntimeCoordinatorHeadLifecycleRecord> {
  const head = await input.storage.get(
    buildRuntimeCoordinatorHeadLifecycleStorageKey(sourceWakeId)
  );
  if (
    !isRuntimeCoordinatorHeadLifecycleRecord(head) ||
    head.ownerUserId !== input.record.ownerUserId ||
    head.targetWakeLifecycleIdentity.targetProfileId !==
      input.record.targetWakeLifecycleIdentity.targetProfileId ||
    head.targetWakeLifecycleIdentity.spaceId !==
      input.record.targetWakeLifecycleIdentity.spaceId
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.source_unavailable"
    );
  }
  return head;
}

async function resumeAuthorizedWork(
  input: AssignmentInput,
  snapshot: AcceptedSnapshot,
  sourceWakeId: string
): Promise<AssignmentPlan> {
  const head = await readSourceHead(input, sourceWakeId);
  const assignment = head.acceptedDispatchSnapshot?.executionContext;
  if (!assignment) {
    return { record: input.record, writes: {} };
  }
  const context = requireContext(
    await input.storage.get(CONTEXT_PREFIX + assignment.id)
  );
  assertContextBinding(context, snapshot);
  if (
    snapshot.contextRequest &&
    snapshot.contextRequest.scope.organizationId !==
      assignment.scope.organizationId
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.source_scope_mismatch"
    );
  }
  return {
    record: {
      ...input.record,
      acceptedDispatchSnapshot: {
        ...snapshot,
        contextRequest: head.acceptedDispatchSnapshot?.contextRequest,
        executionContext: assignment,
      },
    },
    writes: {
      [wakeContextKey(input.record.targetWakeLifecycleId)]: createWakeContext(
        input.record,
        assignment.id
      ),
    },
  };
}

async function resolveContextSource(
  input: AssignmentInput,
  request: ContextRequest
): Promise<ContextSource | null> {
  const selection = request.selection;
  if (selection.mode === "new") {
    return null;
  }
  if (selection.mode === "auto") {
    const associations = await input.storage.list<{ contextId: string }>({
      prefix: `${ASSOCIATION_PREFIX + scopeKey(request.scope)}:`,
      limit: 2,
    });
    if (associations.size > 1) {
      throw new ExecutionContextSelectionError(
        "execution_context.selection_required"
      );
    }
    const association = [...associations.values()][0];
    return association
      ? {
          context: requireContext(
            await input.storage.get(CONTEXT_PREFIX + association.contextId)
          ),
        }
      : null;
  }
  const wake = readWakeContext(
    await input.storage.get(wakeContextKey(selection.sourceWakeId))
  );
  if (!wake || wake.ownerUserId !== input.record.ownerUserId) {
    throw new ExecutionContextSelectionError(
      "execution_context.source_unavailable"
    );
  }
  const context = requireContext(
    await input.storage.get(CONTEXT_PREFIX + wake.contextId)
  );
  if (context.assignment.id !== wake.contextId) {
    throw new ExecutionContextSelectionError(
      "execution_context.evidence_unavailable"
    );
  }
  return { context, completion: wake.completion };
}

function forkCheckpoint(
  request: ContextRequest,
  source: ContextSource | null
): ExecutionContextAssignment["forkSource"] {
  if (request.selection.mode !== "fork") {
    return undefined;
  }
  const checkpoint = executionContextCompletionSchema.safeParse(
    source?.completion
  );
  if (
    !(source && checkpoint.success) ||
    checkpoint.data.contextId !== source.context.assignment.id ||
    !checkpoint.data.completedHistoryId
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.fork_checkpoint_unavailable"
    );
  }
  return {
    contextId: source.context.assignment.id,
    sourceWakeId: request.selection.sourceWakeId,
    nativeConversationId: checkpoint.data.nativeConversationId,
    completedHistoryId: checkpoint.data.completedHistoryId,
    workspace: source.context.assignment.workspace,
    runtimeWorkspaceFingerprint: checkpoint.data.runtimeWorkspaceFingerprint,
  };
}

function createContext(
  record: RuntimeCoordinatorHeadLifecycleRecord,
  snapshot: AcceptedSnapshot,
  request: ContextRequest,
  source: ContextSource | null
): ContextRecord {
  const selection = request.selection;
  const preferences: Partial<
    Pick<ExecutionContextAssignment, "access" | "workspace">
  > = selection.mode === "resume" ? {} : selection;
  const forkSource = forkCheckpoint(request, source);
  return {
    assignment: {
      version: 1,
      id: crypto.randomUUID(),
      scope: request.scope,
      access:
        preferences.access ??
        source?.context.assignment.access ??
        "space_context",
      workspace: preferences.workspace ?? "isolated",
      ...(forkSource ? { forkSource } : {}),
    },
    bindingId: snapshot.controllerSnapshot.bindingId,
    openMeldServiceRuntimeId: snapshot.openMeldServiceRuntimeId,
    agentControllerRef: snapshot.controllerSnapshot.agentControllerRef,
    createdAtMs: record.createdAtMs,
    nativeConversationId: null,
    runtimeWorkspaceFingerprint: null,
  };
}

function supportsContextAccess(
  agentControllerRef: string,
  access: ExecutionContextAssignment["access"]
): boolean {
  return (
    agentControllerRef === "builtin:codex" ||
    (agentControllerRef === "builtin:claude-code" && access === "space_context")
  );
}

function assertContextPreferences(
  context: ContextRecord,
  request: ContextRequest,
  createsContext: boolean
): void {
  const assignment = context.assignment;
  if (!supportsContextAccess(context.agentControllerRef, assignment.access)) {
    throw new ExecutionContextSelectionError(
      "execution_context.controller_access_unsupported"
    );
  }
  if (
    assignment.access === "space_context" &&
    assignment.workspace !== "isolated"
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.space_context_requires_isolated_workspace"
    );
  }
  const selection = request.selection;
  if (createsContext || selection.mode === "resume") {
    return;
  }
  if (selection.access && selection.access !== assignment.access) {
    throw new ExecutionContextSelectionError(
      "execution_context.access_changed_requires_new_task"
    );
  }
  if (selection.workspace && selection.workspace !== assignment.workspace) {
    throw new ExecutionContextSelectionError(
      "execution_context.workspace_changed_requires_new_task"
    );
  }
}

export async function resolveExecutionContextTask(
  storage: Pick<Storage, "get">,
  assignment: ExecutionContextAssignment
): Promise<ExecutionContextTask> {
  const context = requireContext(
    await storage.get(CONTEXT_PREFIX + assignment.id)
  );
  if (!sameScope(context.assignment.scope, assignment.scope)) {
    throw new ExecutionContextSelectionError(
      "execution_context.scope_mismatch"
    );
  }
  return {
    ...assignment,
    ...(context.legacyAssociation
      ? { legacyAssociation: context.legacyAssociation }
      : {}),
    nativeConversationId: context.nativeConversationId,
    runtimeWorkspaceFingerprint: context.runtimeWorkspaceFingerprint,
  };
}

type ContextCompletionInput = {
  storage: Pick<DurableObjectStorage, "transaction">;
  headId: string;
  dispatchId: string;
  runtimeCoordinatorExecutionId: string;
  contextId: string | undefined;
  completion: ExecutionContextCompletion | undefined;
};

function validateResultWake(
  wake: WakeContextRecord | null,
  input: Omit<ContextCompletionInput, "storage">
): WakeContextRecord | null {
  if (!(wake || input.contextId || input.completion)) {
    return null;
  }
  if (
    !wake ||
    wake.contextId !== input.contextId ||
    wake.dispatchId !== input.dispatchId ||
    wake.runtimeCoordinatorExecutionId !== input.runtimeCoordinatorExecutionId
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.result_mismatch"
    );
  }
  return wake;
}

function assertCompletionIdentity(
  context: ContextRecord,
  wake: WakeContextRecord,
  completion: ExecutionContextCompletion
): void {
  if (
    completion.contextId !== context.assignment.id ||
    wake.contextId !== context.assignment.id
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.result_mismatch"
    );
  }
  if (
    context.nativeConversationId &&
    context.nativeConversationId !== completion.nativeConversationId
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.native_identity_mismatch"
    );
  }
  if (
    context.runtimeWorkspaceFingerprint &&
    context.runtimeWorkspaceFingerprint !==
      completion.runtimeWorkspaceFingerprint
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.workspace_changed"
    );
  }
  if (
    wake.completion?.completedHistoryId &&
    wake.completion.completedHistoryId !== completion.completedHistoryId
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.checkpoint_mismatch"
    );
  }
}

export async function recordExecutionContextCandidate(
  input: ContextCompletionInput
): Promise<void> {
  await input.storage.transaction((storage) =>
    recordExecutionContextEvidence({
      ...input,
      storage,
      freezeCheckpoint: false,
    })
  );
}

// A native result proposal can require another turn. Only the durable accepted
// finalization command may make its completed prefix available to later forks.
export async function recordExecutionContextCompletion(
  input: ContextCompletionInput
): Promise<void> {
  await input.storage.transaction((storage) =>
    recordExecutionContextCompletionInTransaction({ ...input, storage })
  );
}

export async function recordExecutionContextCompletionInTransaction(
  input: Omit<ContextCompletionInput, "storage"> & { storage: Storage }
): Promise<void> {
  await recordExecutionContextEvidence({ ...input, freezeCheckpoint: true });
}

async function recordExecutionContextEvidence(
  input: Omit<ContextCompletionInput, "storage"> & {
    storage: Storage;
    freezeCheckpoint: boolean;
  }
): Promise<void> {
  const storage = input.storage;
  const key = wakeContextKey(input.headId);
  const wake = validateResultWake(
    readWakeContext(await storage.get(key)),
    input
  );
  if (!(wake && input.completion)) {
    return;
  }
  const context = requireContext(
    await storage.get(CONTEXT_PREFIX + wake.contextId)
  );
  assertCompletionIdentity(context, wake, input.completion);
  const nativeKey =
    NATIVE_CONTEXT_PREFIX +
    [
      context.openMeldServiceRuntimeId,
      context.agentControllerRef,
      input.completion.nativeConversationId,
    ]
      .map(encodeURIComponent)
      .join(":");
  const nativeOwner = await storage.get<string>(nativeKey);
  if (nativeOwner && nativeOwner !== wake.contextId) {
    throw new ExecutionContextSelectionError(
      "execution_context.native_identity_conflict"
    );
  }
  await storage.put({
    [nativeKey]: wake.contextId,
    [CONTEXT_PREFIX + wake.contextId]: {
      ...context,
      nativeConversationId: input.completion.nativeConversationId,
      runtimeWorkspaceFingerprint: input.completion.runtimeWorkspaceFingerprint,
    },
    ...(input.freezeCheckpoint
      ? { [key]: { ...wake, completion: input.completion } }
      : {}),
  });
}
