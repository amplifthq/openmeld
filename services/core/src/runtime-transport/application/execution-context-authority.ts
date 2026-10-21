import {
  supportsExecutionContextAccess as supportsContextAccess,
  supportsExecutionContextSelection,
} from "@openmeld/agent-runtime";
import {
  executionContextAssignmentSchema,
  executionContextCompletionSchema,
  executionContextLegacyAssociationSchema,
} from "@openmeld/schemas";
import type {
  ExecutionContextAssignment,
  ExecutionContextCompletion,
  ExecutionContextDiagnostics,
  ExecutionContextScope,
  ExecutionContextTask,
} from "@openmeld/schemas/types";
import { isRequestChainEnforced } from "../../member-agent/member-agents-feature";
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
// The context most recently accepted in one discussion scope. It indexes the
// accepted Wake associations above and never selects work on its own.
const LATEST_ASSOCIATION_PREFIX =
  "runtime-coordinator:execution-context-scope-latest:v1:";
// Scopes accepted before the latest index existed are resolved by a bounded
// scan; a larger or unverifiable history asks for an explicit choice instead of
// guessing.
const LATEST_ASSOCIATION_BACKFILL_LIMIT = 32;
const HISTORY_SELECTION_REQUIRED =
  "execution_context.history_selection_required";
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

export async function readWakeExecutionContextDiagnostics(input: {
  storage: Pick<Storage, "get">;
  targetWakeLifecycleId: string;
  spaceId: string;
  targetProfileId: string;
}): Promise<ExecutionContextDiagnostics> {
  const wake = readWakeContext(
    await input.storage.get(wakeContextKey(input.targetWakeLifecycleId))
  );
  if (!wake) {
    return {
      readStatus: "not_recorded",
      reasonCode: "execution_context.assignment_not_recorded",
    };
  }
  const context = requireContext(
    await input.storage.get(CONTEXT_PREFIX + wake.contextId)
  );
  if (
    context.assignment.id !== wake.contextId ||
    context.assignment.scope.spaceId !== input.spaceId ||
    context.assignment.scope.targetProfileId !== input.targetProfileId
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.scope_mismatch"
    );
  }
  return {
    readStatus: "found",
    contextId: context.assignment.id,
    access: context.assignment.access,
    permissionSource:
      context.assignment.permissionSource ?? "context_restriction",
    workspace: context.assignment.workspace,
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

/** Retain history, but stop offering the replaced context for automatic routing. */
export async function retireRecoveredContextSourceAssociation(input: {
  storage: Pick<DurableObjectTransaction, "get" | "delete">;
  sourceContextId: string;
  replacementContextId: string;
}): Promise<void> {
  const source = requireContext(
    await input.storage.get(CONTEXT_PREFIX + input.sourceContextId)
  );
  const replacement = requireContext(
    await input.storage.get(CONTEXT_PREFIX + input.replacementContextId)
  );
  if (
    replacement.assignment.forkSource?.contextId !== source.assignment.id ||
    !sameScope(source.assignment.scope, replacement.assignment.scope) ||
    source.bindingId !== replacement.bindingId ||
    source.agentControllerRef !== replacement.agentControllerRef ||
    source.openMeldServiceRuntimeId !== replacement.openMeldServiceRuntimeId
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.source_scope_mismatch"
    );
  }
  await input.storage.delete(
    `${ASSOCIATION_PREFIX}${scopeKey(source.assignment.scope)}:${source.assignment.id}`
  );
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
  /** Contexts that still hold reserved, waiting, or recovery-held work. */
  outstandingExecutionContextIds?: ReadonlySet<string>;
  startIndependentClaudeContext?: boolean;
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

/**
 * Invariant 4 (design-plans/member-agent-program.md §9): once the chain is
 * enforced, every accepted context has a chain rooted at a human Profile.
 */
/** Per Wake: one Session can serve Wakes with different roots. */
function withWakeRequestChain(
  assignment: ExecutionContextAssignment,
  request: Pick<ContextRequest, "requestChain">
): ExecutionContextAssignment {
  return request.requestChain
    ? { ...assignment, requestChain: request.requestChain }
    : assignment;
}

export function assertContextRequestChain(
  request: Pick<ContextRequest, "requestChain">
): void {
  if (isRequestChainEnforced() && request.requestChain?.[0]?.kind !== "human") {
    throw new ExecutionContextSelectionError(
      "execution_context.request_chain_required"
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
  assertContextRequestChain(request);
  const implicitRequest =
    request.selection.mode === "auto" && request.required === false;
  if (
    implicitRequest &&
    !supportsExecutionContextSelection(
      snapshot.controllerSnapshot.agentControllerRef
    )
  ) {
    // An unsupported harness keeps its existing Binding conversation, even when
    // an earlier harness of this Profile used Contexts. Retained Context history
    // belongs to that earlier harness and is never selected here.
    return { record: input.record, writes: {} };
  }
  if (
    snapshot.controllerSnapshot.agentControllerRef === "builtin:antigravity" &&
    request.selection.mode === "fork"
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.fork_unsupported"
    );
  }
  const source = await resolveContextSource(input, request, snapshot);
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
    !input.contextModeActive &&
    !input.startIndependentClaudeContext
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
        executionContext: withWakeRequestChain(context.assignment, request),
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
      ...latestScopeContextWrite(
        request.scope,
        context.assignment.id,
        input.record.targetWakeLifecycleId
      ),
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
  if (!isContextOnExecutionTarget(context, snapshot)) {
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
      ...latestScopeContextWrite(
        assignment.scope,
        assignment.id,
        input.record.targetWakeLifecycleId
      ),
      [wakeContextKey(input.record.targetWakeLifecycleId)]: createWakeContext(
        input.record,
        assignment.id
      ),
    },
  };
}

async function resolveContextSource(
  input: AssignmentInput,
  request: ContextRequest,
  snapshot: AcceptedSnapshot
): Promise<ContextSource | null> {
  const selection = request.selection;
  if (selection.mode === "new") {
    return null;
  }
  if (selection.mode === "auto") {
    return await resolveAutoContextSource(input, request, snapshot);
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

/**
 * Continues the discussion's most recently accepted context.
 *
 * Another context of the same scope that still holds work on this execution
 * target makes the choice ambiguous, so the requester must pick one. A latest
 * context bound to another Binding, Service runtime, or Controller cannot run
 * here: the Wake starts a fresh context instead of failing, and the retained
 * history stays queryable.
 */
async function resolveAutoContextSource(
  input: AssignmentInput,
  request: ContextRequest,
  snapshot: AcceptedSnapshot
): Promise<ContextSource | null> {
  const latestContextId = await readLatestScopeContextId(
    input.storage,
    request.scope
  );
  const candidates = new Set(
    await listOutstandingScopeContextIds(input, request.scope, snapshot)
  );
  if (latestContextId) {
    candidates.add(latestContextId);
  }
  if (candidates.size > 1) {
    throw new ExecutionContextSelectionError(
      "execution_context.selection_required"
    );
  }
  const [contextId] = candidates;
  if (!contextId) {
    return null;
  }
  const context = requireContext(
    await input.storage.get(CONTEXT_PREFIX + contextId)
  );
  if (!isContextOnExecutionTarget(context, snapshot)) {
    console.info(
      "[core.runtime_transport.execution_context_auto_fresh_after_target_change]",
      {
        previousContextId: context.assignment.id,
        targetWakeLifecycleId: input.record.targetWakeLifecycleId,
      }
    );
    return null;
  }
  return { context };
}

async function readLatestScopeContextId(
  storage: Storage,
  scope: ExecutionContextScope
): Promise<string | null> {
  const pointer = await storage.get<{ contextId?: unknown }>(
    LATEST_ASSOCIATION_PREFIX + scopeKey(scope)
  );
  if (typeof pointer?.contextId === "string" && pointer.contextId) {
    return pointer.contextId;
  }
  const associations = [
    ...(
      await storage.list<unknown>({
        prefix: `${ASSOCIATION_PREFIX + scopeKey(scope)}:`,
        limit: LATEST_ASSOCIATION_BACKFILL_LIMIT + 1,
      })
    ).values(),
  ];
  if (associations.length === 0) {
    return null;
  }
  if (associations.length > LATEST_ASSOCIATION_BACKFILL_LIMIT) {
    throw new ExecutionContextSelectionError(HISTORY_SELECTION_REQUIRED);
  }
  // Each association names the last Wake accepted into its context; that
  // Wake's head was created in the same transaction that wrote the association
  // and the latest index, so its creation time orders the contexts the way the
  // index does. The head's `acceptedAtMs` moves when a waiting Wake is later
  // promoted, and a context's own creation time does not move when it is
  // continued, so neither can stand in for this order.
  const accepted = associations.map(readScopeAssociation);
  const heads = await storage.get<unknown>(
    accepted.map((association) =>
      buildRuntimeCoordinatorHeadLifecycleStorageKey(
        association.targetWakeLifecycleId
      )
    )
  );
  let latest: { contextId: string; acceptedAtMs: number } | null = null;
  let tied = false;
  for (const association of accepted) {
    const head = heads.get(
      buildRuntimeCoordinatorHeadLifecycleStorageKey(
        association.targetWakeLifecycleId
      )
    );
    if (
      !isRuntimeCoordinatorHeadLifecycleRecord(head) ||
      head.acceptedDispatchSnapshot?.executionContext?.id !==
        association.contextId ||
      !Number.isSafeInteger(head.createdAtMs) ||
      head.createdAtMs < 0
    ) {
      throw new ExecutionContextSelectionError(HISTORY_SELECTION_REQUIRED);
    }
    if (!latest || head.createdAtMs > latest.acceptedAtMs) {
      latest = {
        contextId: association.contextId,
        acceptedAtMs: head.createdAtMs,
      };
      tied = false;
    } else if (head.createdAtMs === latest.acceptedAtMs) {
      tied = true;
    }
  }
  if (tied) {
    throw new ExecutionContextSelectionError(HISTORY_SELECTION_REQUIRED);
  }
  return latest?.contextId ?? null;
}

function readScopeAssociation(value: unknown): {
  contextId: string;
  targetWakeLifecycleId: string;
} {
  const record =
    value && typeof value === "object"
      ? (value as { contextId?: unknown; targetWakeLifecycleId?: unknown })
      : {};
  if (
    typeof record.contextId !== "string" ||
    !record.contextId ||
    typeof record.targetWakeLifecycleId !== "string" ||
    !record.targetWakeLifecycleId
  ) {
    throw new ExecutionContextSelectionError(HISTORY_SELECTION_REQUIRED);
  }
  return {
    contextId: record.contextId,
    targetWakeLifecycleId: record.targetWakeLifecycleId,
  };
}

async function listOutstandingScopeContextIds(
  input: AssignmentInput,
  scope: ExecutionContextScope,
  snapshot: AcceptedSnapshot
): Promise<string[]> {
  const contextIds = [...(input.outstandingExecutionContextIds ?? [])];
  if (contextIds.length === 0) {
    return [];
  }
  const contexts = await input.storage.get<unknown>(
    contextIds.map((contextId) => CONTEXT_PREFIX + contextId)
  );
  // Work held on another Binding, Service runtime, or Controller cannot be
  // continued here, so it is not a choice this Wake could offer.
  return contextIds.filter((contextId) => {
    const raw = contexts.get(CONTEXT_PREFIX + contextId);
    if (raw === undefined) {
      return false;
    }
    const context = requireContext(raw);
    return (
      sameScope(context.assignment.scope, scope) &&
      isContextOnExecutionTarget(context, snapshot)
    );
  });
}

function isContextOnExecutionTarget(
  context: ContextRecord,
  snapshot: AcceptedSnapshot
): boolean {
  return (
    context.bindingId === snapshot.controllerSnapshot.bindingId &&
    context.openMeldServiceRuntimeId === snapshot.openMeldServiceRuntimeId &&
    context.agentControllerRef ===
      snapshot.controllerSnapshot.agentControllerRef
  );
}

function latestScopeContextWrite(
  scope: ExecutionContextScope,
  contextId: string,
  targetWakeLifecycleId: string
): Record<string, unknown> {
  return {
    [LATEST_ASSOCIATION_PREFIX + scopeKey(scope)]: {
      contextId,
      targetWakeLifecycleId,
    },
  };
}

/**
 * Whether the harness can confirm a fork boundary from the source's own
 * retained history, so a fork may be assigned before one is frozen.
 *
 * Codex exposes a thread's settled turns through a read that takes no writer
 * lock, so read-only preparation can name the newest completed turn even while
 * another App Server holds that thread. Claude Code's fork needs the exact
 * boundary message identified up front, so a source with no frozen checkpoint
 * has no point a fork could be cut at and keeps the stricter rule.
 */
function confirmsOwnForkBoundary(agentControllerRef: string): boolean {
  return agentControllerRef === "builtin:codex";
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
    !source ||
    (checkpoint.success &&
      checkpoint.data.contextId !== source.context.assignment.id)
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.fork_checkpoint_unavailable"
    );
  }
  // A frozen checkpoint stays authoritative. Without one, the source's own
  // retained association is the identity to inherit: an interrupted or occupied
  // dispatch records the native conversation as a candidate without ever
  // freezing a completed prefix, which is exactly the case a handoff forks from.
  const nativeConversationId = checkpoint.success
    ? checkpoint.data.nativeConversationId
    : source.context.nativeConversationId;
  const runtimeWorkspaceFingerprint = checkpoint.success
    ? checkpoint.data.runtimeWorkspaceFingerprint
    : source.context.runtimeWorkspaceFingerprint;
  const completedHistoryId = checkpoint.success
    ? checkpoint.data.completedHistoryId
    : undefined;
  const boundaryIsConfirmable =
    Boolean(completedHistoryId) ||
    confirmsOwnForkBoundary(source.context.agentControllerRef);
  if (
    !(
      nativeConversationId &&
      runtimeWorkspaceFingerprint &&
      boundaryIsConfirmable
    )
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.fork_checkpoint_unavailable"
    );
  }
  return {
    contextId: source.context.assignment.id,
    sourceWakeId: request.selection.sourceWakeId,
    nativeConversationId,
    ...(completedHistoryId ? { completedHistoryId } : {}),
    workspace: source.context.assignment.workspace,
    runtimeWorkspaceFingerprint,
    ...(source.context.assignment.folderId
      ? { folderId: source.context.assignment.folderId }
      : {}),
  };
}

function createContext(
  record: RuntimeCoordinatorHeadLifecycleRecord,
  snapshot: AcceptedSnapshot,
  request: ContextRequest,
  source: ContextSource | null
): ContextRecord {
  const selection = request.selection;
  const forkSource = forkCheckpoint(request, source);
  const inheritsAgentSettings =
    (snapshot.controllerSnapshot.agentControllerRef === "builtin:codex" ||
      snapshot.controllerSnapshot.agentControllerRef ===
        "builtin:claude-code" ||
      snapshot.controllerSnapshot.agentControllerRef ===
        "builtin:antigravity") &&
    selection.mode !== "resume" &&
    !selection.access &&
    (selection.mode === "new" ||
      !source ||
      source.context.assignment.permissionSource === "agent_settings");
  const implicitPreferences =
    inheritsAgentSettings ||
    (selection.mode === "auto" &&
      !source &&
      snapshot.controllerSnapshot.agentControllerRef === "builtin:codex")
      ? ({
          access: "workspace",
          workspace: forkSource?.workspace ?? "current",
        } as const)
      : {};
  const preferences: Partial<
    Pick<
      ExecutionContextAssignment,
      "access" | "folderId" | "projectWork" | "workspace"
    >
  > =
    selection.mode === "resume" ? {} : { ...implicitPreferences, ...selection };
  if (
    selection.mode === "fork" &&
    preferences.projectWork &&
    !matchesSelectedProjectWork(
      preferences.projectWork,
      source?.context.assignment.projectWork
    )
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.project_work_changed_requires_new_task"
    );
  }
  const projectWork =
    selection.mode === "fork"
      ? source?.context.assignment.projectWork
      : (preferences.projectWork ?? source?.context.assignment.projectWork);
  // Explicit choice, then the continued or forked Session's folder. Without
  // either the Service uses the Profile default, as before folders existed.
  // A fork with a new folderId is "continue in another folder".
  const folderId = preferences.folderId ?? source?.context.assignment.folderId;
  const workspace =
    preferences.workspace ?? forkSource?.workspace ?? "isolated";
  const workspaceDefault = resolveAssignmentWorkspaceDefault(
    request,
    workspace,
    Boolean(forkSource)
  );
  return {
    assignment: {
      version: 1,
      id: crypto.randomUUID(),
      scope: request.scope,
      ...(inheritsAgentSettings
        ? { permissionSource: "agent_settings" as const }
        : {}),
      access:
        preferences.access ??
        source?.context.assignment.access ??
        "space_context",
      ...(projectWork ? { projectWork } : {}),
      ...(folderId ? { folderId } : {}),
      workspace,
      ...(workspaceDefault ? { workspaceDefault } : {}),
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

/**
 * A non-owner root defaults to an isolated copy of a git folder. Only a
 * workspace left to the default qualifies: an explicit choice or a forked
 * Session's workspace stays. The Service checks for git and reports back.
 */
function resolveAssignmentWorkspaceDefault(
  request: ContextRequest,
  workspace: ExecutionContextAssignment["workspace"],
  forked: boolean
): ExecutionContextAssignment["workspaceDefault"] {
  const selection = request.selection;
  const explicit = selection.mode !== "resume" && Boolean(selection.workspace);
  return workspace === "current" && !explicit && !forked
    ? request.workspaceDefault
    : undefined;
}

function matchesSelectedProjectWork(
  selection: ExecutionContextAssignment["projectWork"],
  retained: ExecutionContextAssignment["projectWork"]
): boolean {
  return (
    selection?.projectId === retained?.projectId &&
    selection?.repositoryFingerprint === retained?.repositoryFingerprint &&
    (selection?.commit === undefined || selection.commit === retained?.commit)
  );
}

function assertContextPreferences(
  context: ContextRecord,
  request: ContextRequest,
  createsContext: boolean
): void {
  const assignment = context.assignment;
  if (
    !supportsContextAccess(
      context.agentControllerRef,
      assignment.access,
      assignment.permissionSource
    )
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.controller_access_unsupported"
    );
  }
  if (assignment.projectWork && assignment.access === "space_context") {
    throw new ExecutionContextSelectionError(
      "execution_context.project_work_requires_workspace_access"
    );
  }
  assertAssignmentFolder(assignment);
  if (
    assignment.access === "space_context" &&
    assignment.workspace !== "isolated"
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.space_context_requires_isolated_workspace"
    );
  }
  if (
    context.agentControllerRef === "builtin:claude-code" &&
    assignment.permissionSource !== "agent_settings" &&
    assignment.access === "workspace" &&
    assignment.workspace !== "isolated"
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.claude_project_requires_isolated_workspace"
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
  if (selection.folderId && selection.folderId !== assignment.folderId) {
    throw new ExecutionContextSelectionError(
      "execution_context.folder_changed_requires_new_task"
    );
  }
  if (
    selection.projectWork &&
    !matchesSelectedProjectWork(selection.projectWork, assignment.projectWork)
  ) {
    throw new ExecutionContextSelectionError(
      "execution_context.project_work_changed_requires_new_task"
    );
  }
}

/** A folder is a user folder: no Space-only work, no Project repository. */
function assertAssignmentFolder(assignment: ExecutionContextAssignment): void {
  if (!assignment.folderId) {
    return;
  }
  if (assignment.access === "space_context") {
    throw new ExecutionContextSelectionError(
      "execution_context.folder_requires_workspace_access"
    );
  }
  if (assignment.projectWork) {
    throw new ExecutionContextSelectionError(
      "execution_context.folder_conflicts_with_project_work"
    );
  }
}

export async function resolveExecutionContextTask(
  storage: Pick<Storage, "get">,
  assignment: ExecutionContextAssignment,
  service: {
    /** The Service resolves workspaceDefault (executionContextVersion 7). */
    resolvesWorkspaceDefault: boolean;
  } = { resolvesWorkspaceDefault: false }
): Promise<ExecutionContextTask> {
  const context = requireContext(
    await storage.get(CONTEXT_PREFIX + assignment.id)
  );
  if (!sameScope(context.assignment.scope, assignment.scope)) {
    throw new ExecutionContextSelectionError(
      "execution_context.scope_mismatch"
    );
  }
  // The chain stays in Core; installed Services parse tasks strictly. A
  // stored context that already recorded its workspace no longer carries the
  // hint; an older Service keeps today's behavior and runs the assigned one.
  const {
    requestChain: _requestChain,
    workspaceDefault: _workspaceDefault,
    ...serviceAssignment
  } = assignment;
  // A redelivered Wake follows the context once its workspace is recorded.
  const workspaceDefault = service.resolvesWorkspaceDefault
    ? context.assignment.workspaceDefault
    : undefined;
  return {
    ...serviceAssignment,
    ...(assignment.workspaceDefault
      ? {
          workspace: context.assignment.workspace,
          ...(workspaceDefault ? { workspaceDefault } : {}),
        }
      : {}),
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
  // Only an unresolved default lets the Service choose the workspace.
  if (
    completion.workspace &&
    !context.assignment.workspaceDefault &&
    completion.workspace !== context.assignment.workspace
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
      assignment: resolveContextWorkspace(context.assignment, input.completion),
      nativeConversationId: input.completion.nativeConversationId,
      runtimeWorkspaceFingerprint: input.completion.runtimeWorkspaceFingerprint,
    },
    ...(input.freezeCheckpoint
      ? { [key]: { ...wake, completion: input.completion } }
      : {}),
  });
}

/**
 * The first native evidence fixes the workspace of a context that had a
 * default: the Service's choice, or the assigned workspace when an older
 * Service ran it without the hint. Later Wakes resume in that workspace.
 */
function resolveContextWorkspace(
  assignment: ExecutionContextAssignment,
  completion: ExecutionContextCompletion
): ExecutionContextAssignment {
  if (!assignment.workspaceDefault) {
    return assignment;
  }
  const { workspaceDefault: _resolved, ...resolved } = assignment;
  return {
    ...resolved,
    workspace: completion.workspace ?? assignment.workspace,
  };
}
