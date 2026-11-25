import {
  getPostgresDatabase,
  withPostgresRequest,
} from "@openmeld/db/postgresql";
import {
  CREDENTIAL_CONFIRMATION_DECLINED_CODE,
  CREDENTIAL_CONFIRMATION_REQUIRED_CODE,
  formatCredentialConfirmationRequiredMessage,
  type RequestCredential,
  riskWindowExecutionsResponseSchema,
  SENSITIVE_OPERATION_ROOT_NOT_OWNER_CODE,
  SENSITIVE_OPERATION_SOURCE_REQUIRED_CODE,
  type SensitiveOperation,
  type SensitiveOperationOutcome,
  type SensitiveOperationSourceKind,
  TASK_CREDENTIAL_REJECTED_CODE,
  taskCredentialResolutionSchema,
} from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { readAuthProfileFacts } from "../../auth/application/profile-facts-reader";
import { resolveRuntimeTransportOwnerShard } from "../../dispatch/infrastructure/runtime-transport/runtime-transport-shard";
import type { CoreBindings } from "../../lib/bindings";
import { isRequestChainEnforced } from "../../member-agent/member-agents-feature";
import { createCoreRpcHttpError } from "../../rpc/errors";
import {
  asQueryable,
  insertSensitiveOperationAuditEvent,
} from "../infrastructure/postgresql/sensitive-operation-repo";
import { resolveCredentialConfirmation } from "./credential-confirmation-service";
import { withPermissionModeAuditAttribution } from "./permission-mode-audit-context";

// Sources for sensitive operations (design-plans/member-agent-program.md
// §4.7, §6). A task credential passes only when its chain root is the Profile
// owner; the owner's Web or App session passes; the CLI credential passes
// unless the owner has a running task with another root (decision 5a0 in
// member-agent-program-reviews/5-credentials.md), and then waits for the
// owner's confirmation. Every decision is audited.

export type SensitiveOperationRequest = {
  agentProfileId: string | null;
  context: OpenMeldRequestContext | undefined;
  credential: RequestCredential | undefined;
  /** The operation's own input; the digest binds a confirmation to it. */
  digestInput: unknown;
  operation: SensitiveOperation;
};

type Decision = {
  chainRootProfileId: string | null;
  confirmationId: string | null;
  sourceKind: SensitiveOperationSourceKind;
  taskExecutionId: string | null;
};

/** The signed-in account, its Organization and its own Human Profile. */
export type SensitiveOperationCaller = {
  humanProfileId: string | null;
  organizationId: string;
  userId: string;
};
type Caller = SensitiveOperationCaller;

export async function runSensitiveOperation<T>(
  env: CoreBindings,
  request: SensitiveOperationRequest,
  run: () => Promise<T>
): Promise<T> {
  if (!isRequestChainEnforced()) {
    return await run();
  }
  const caller = requireCaller(request.context);
  if (!request.credential) {
    // Without credential facts a request counts as the CLI credential.
    await writeAudit(env, {
      caller,
      decision: {
        chainRootProfileId: caller.humanProfileId,
        confirmationId: null,
        sourceKind: "cli_credential",
        taskExecutionId: null,
      },
      outcome: "rejected",
      reasonCode: SENSITIVE_OPERATION_SOURCE_REQUIRED_CODE,
      request,
    });
    throw createCoreRpcHttpError({
      code: SENSITIVE_OPERATION_SOURCE_REQUIRED_CODE,
      reason: "OpenMeld could not tell how this request was signed in.",
      status: 403,
    });
  }
  const decision = await decideSource(env, {
    caller,
    credential: request.credential,
    request,
  });
  let result: T;
  let permissionModeChangeCommitted = false;
  const requestId = request.context?.actorContext.requestId;
  if (!requestId) {
    throw new Error("sensitive_operation.request_id_missing");
  }
  try {
    result = await withPermissionModeAuditAttribution(
      {
        ...decision,
        actorUserId: caller.userId,
        organizationId: caller.organizationId,
        requestId,
        onPermissionModeChangeCommitted: () => {
          permissionModeChangeCommitted = true;
        },
      },
      run
    );
  } catch (error) {
    await writeAudit(env, {
      caller,
      decision,
      outcome: "failed",
      reasonCode: readErrorCode(error),
      request,
    });
    throw error;
  }
  if (
    request.operation === "binding_permission_mode" &&
    (permissionModeChangeCommitted ||
      (typeof result === "object" &&
        result !== null &&
        "status" in result &&
        (result.status === "unchanged" || result.status === "conflict")))
  ) {
    // A committed change already has its transactional audit. An unchanged or
    // conflicting write must not be presented as a successful mode change.
    return result;
  }
  // The change is done: a failed audit write is reported, never turned into
  // a failure of the operation.
  await writeAudit(env, {
    caller,
    decision,
    outcome: "succeeded",
    request,
  }).catch((error: unknown) => {
    console.error("[core.sensitive_operation.audit_failed]", {
      agentProfileId: request.agentProfileId,
      error: error instanceof Error ? error.message : String(error),
      event: "core.sensitive_operation.audit_failed",
      operation: request.operation,
      outcome: "succeeded",
    });
  });
  return result;
}

/**
 * The decision alone, for an operation another service performs (Auth's
 * Agent Profile deletion). Refusals throw and are audited here; the caller
 * reports the outcome with recordSensitiveOperationOutcome.
 */
export async function authorizeSensitiveOperation(
  env: CoreBindings,
  input: {
    caller: SensitiveOperationCaller;
    credential: RequestCredential;
    request: Omit<SensitiveOperationRequest, "context" | "credential">;
  }
): Promise<Decision> {
  return await decideSource(env, {
    caller: input.caller,
    credential: input.credential,
    request: { ...input.request, context: undefined, credential: undefined },
  });
}

export async function recordSensitiveOperationOutcome(
  env: CoreBindings,
  input: {
    caller: SensitiveOperationCaller;
    decision: Decision;
    outcome: SensitiveOperationOutcome;
    reasonCode: string | null;
    request: Pick<SensitiveOperationRequest, "agentProfileId" | "operation">;
  }
): Promise<void> {
  await writeAudit(env, {
    caller: input.caller,
    decision: input.decision,
    outcome: input.outcome,
    reasonCode: input.reasonCode,
    request: {
      ...input.request,
      context: undefined,
      credential: undefined,
      digestInput: null,
    },
  });
}

function requireCaller(context: OpenMeldRequestContext | undefined): Caller {
  const userId = context?.actorContext.callerPrincipalId;
  const organizationId = context?.activeOrganizationId;
  if (!(userId && organizationId)) {
    throw createCoreRpcHttpError({
      code: SENSITIVE_OPERATION_SOURCE_REQUIRED_CODE,
      reason: "Sign in to an Organization to make this change.",
      status: 403,
    });
  }
  return {
    humanProfileId:
      context.actorContext.profileKind === "human"
        ? context.actorContext.openMeldProfileId
        : null,
    organizationId,
    userId,
  };
}

async function decideSource(
  env: CoreBindings,
  input: {
    caller: Caller;
    credential: RequestCredential;
    request: SensitiveOperationRequest;
  }
): Promise<Decision> {
  const { caller, credential, request } = input;
  let decision: Decision;
  if (credential.taskCredential) {
    // Any task of the owner's OS user can read another task's credential,
    // across Service lanes too, so an owner-rooted credential still sits in
    // the owner-wide risk window (decision 5a0).
    decision = await decideTaskCredential(env, {
      caller,
      request,
      taskCredential: credential.taskCredential,
    });
  } else {
    decision = {
      chainRootProfileId: caller.humanProfileId,
      confirmationId: null,
      sourceKind:
        credential.kind === "interactive_session"
          ? "web_session"
          : "cli_credential",
      taskExecutionId: null,
    };
    if (credential.kind === "interactive_session") {
      return decision;
    }
  }
  const window = await readRiskWindow(env, caller);
  if (!window.open) {
    return decision;
  }
  const confirmation = await resolveCredentialConfirmation({
    agentProfileId: request.agentProfileId,
    blockingRootProfileId: window.blockingRootProfileId,
    clientConfirmationId: credential.confirmationId ?? null,
    db: requireDatabase(env),
    nowMs: Date.now(),
    operation: request.operation,
    organizationId: caller.organizationId,
    ownerUserId: caller.userId,
    requestDigest: await digestSensitiveRequest(request),
  });
  const confirmed: Decision = {
    ...decision,
    confirmationId: confirmation.confirmationId,
  };
  if (confirmation.status === "approved") {
    return confirmed;
  }
  const declined = confirmation.status === "declined";
  await writeAudit(env, {
    caller,
    decision: confirmed,
    outcome: declined ? "declined" : "confirmation_required",
    reasonCode: window.reasonCode,
    request,
  });
  throw createCoreRpcHttpError(
    declined
      ? {
          code: CREDENTIAL_CONFIRMATION_DECLINED_CODE,
          reason: "The Agent owner declined this change.",
          status: 403,
        }
      : {
          code: CREDENTIAL_CONFIRMATION_REQUIRED_CODE,
          reason: formatCredentialConfirmationRequiredMessage(
            confirmation.confirmationId
          ),
          status: 409,
        }
  );
}

async function decideTaskCredential(
  env: CoreBindings,
  input: {
    caller: Caller;
    request: SensitiveOperationRequest;
    taskCredential: NonNullable<RequestCredential["taskCredential"]>;
  }
): Promise<Decision> {
  const { caller, request } = input;
  const resolution = taskCredentialResolutionSchema.parse(
    await resolveRuntimeTransportOwnerShard(
      env,
      caller.userId
    ).rpcResolveTaskCredential(input.taskCredential)
  );
  const rejected = async (
    reasonCode: string,
    decision: Decision,
    code: string,
    reason: string
  ): Promise<never> => {
    await writeAudit(env, {
      caller,
      decision,
      outcome: "rejected",
      reasonCode,
      request,
    });
    throw createCoreRpcHttpError({ code, reason, status: 403 });
  };
  if (resolution.status === "rejected") {
    return await rejected(
      resolution.reasonCode,
      {
        chainRootProfileId: null,
        confirmationId: null,
        sourceKind: "task_credential",
        taskExecutionId: input.taskCredential.runtimeCoordinatorExecutionId,
      },
      TASK_CREDENTIAL_REJECTED_CODE,
      "This task's credential is no longer valid."
    );
  }
  const decision: Decision = {
    chainRootProfileId: resolution.rootProfileId,
    confirmationId: null,
    sourceKind: "task_credential",
    taskExecutionId: resolution.runtimeCoordinatorExecutionId,
  };
  if (!resolution.rootProfileId) {
    return await rejected(
      "task_credential.chain_missing",
      decision,
      TASK_CREDENTIAL_REJECTED_CODE,
      "This task has no requester OpenMeld can verify."
    );
  }
  const facts = await readAuthProfileFacts({
    authWorker: env.OPENMELD_AUTH_WORKER,
    profileIds: [resolution.rootProfileId],
  });
  if (!facts) {
    await writeAudit(env, {
      caller,
      decision,
      outcome: "rejected",
      reasonCode: "sensitive_operation.identity_unavailable",
      request,
    });
    throw createCoreRpcHttpError({
      code: "sensitive_operation.identity_unavailable",
      reason: "OpenMeld could not verify who asked for this task.",
      status: 503,
    });
  }
  const root = facts.get(resolution.rootProfileId);
  if (
    !(
      root &&
      root.profileKind === "human" &&
      root.status === "active" &&
      root.ownerUserId === caller.userId
    )
  ) {
    return await rejected(
      "sensitive_operation.root_not_owner",
      decision,
      SENSITIVE_OPERATION_ROOT_NOT_OWNER_CODE,
      "Only a task the Agent owner asked for can make this change."
    );
  }
  return decision;
}

type RiskWindow =
  | { open: false }
  | {
      open: true;
      blockingRootProfileId: string | null;
      reasonCode: string;
    };

/**
 * Open when any running task of this owner, for a Profile in this
 * Organization, has a root the owner does not own (decision 5a0). Fails
 * closed: an unverifiable state counts as open.
 */
async function readRiskWindow(
  env: CoreBindings,
  caller: Caller
): Promise<RiskWindow> {
  const unverifiable: RiskWindow = {
    blockingRootProfileId: null,
    open: true,
    reasonCode: "risk_window_unverifiable",
  };
  const response = riskWindowExecutionsResponseSchema.parse(
    await resolveRuntimeTransportOwnerShard(
      env,
      caller.userId
    ).rpcReadRiskWindowExecutions({ ownerUserId: caller.userId })
  );
  if (response.status === "unavailable") {
    return unverifiable;
  }
  const { executions } = response;
  if (executions.length === 0) {
    return { open: false };
  }
  const facts = await readAuthProfileFacts({
    authWorker: env.OPENMELD_AUTH_WORKER,
    profileIds: executions.flatMap((execution) => [
      execution.targetProfileId,
      ...(execution.rootProfileId ? [execution.rootProfileId] : []),
    ]),
  });
  if (!facts) {
    return unverifiable;
  }
  for (const execution of executions) {
    const target = facts.get(execution.targetProfileId);
    if (target && target.organizationId !== caller.organizationId) {
      continue;
    }
    const root = execution.rootProfileId
      ? facts.get(execution.rootProfileId)
      : null;
    if (
      !(
        target &&
        root &&
        root.profileKind === "human" &&
        root.ownerUserId === caller.userId
      )
    ) {
      return {
        blockingRootProfileId: execution.rootProfileId,
        open: true,
        reasonCode: "risk_window_open",
      };
    }
  }
  return { open: false };
}

export async function digestSensitiveRequest(
  request: Pick<
    SensitiveOperationRequest,
    "agentProfileId" | "digestInput" | "operation"
  >
): Promise<string> {
  const material = stableStringify({
    agentProfileId: request.agentProfileId,
    input: request.digestInput ?? null,
    operation: request.operation,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(material)
  );
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function compareKeys(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => compareKeys(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function readErrorCode(error: unknown): string {
  const code =
    error && typeof error === "object"
      ? ((error as { code?: unknown }).code ??
        (error as { cause?: { code?: unknown } }).cause?.code)
      : undefined;
  return typeof code === "string" && code.trim()
    ? code.trim().slice(0, 160)
    : "operation_failed";
}

function requireDatabase(env: CoreBindings) {
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "sensitive_operation.store_unavailable",
      reason: "OpenMeld could not check this change right now.",
      status: 503,
    });
  }
  return db;
}

async function writeAudit(
  env: CoreBindings,
  input: {
    caller: Caller;
    decision: Decision;
    outcome: SensitiveOperationOutcome;
    reasonCode?: string | null;
    request: SensitiveOperationRequest;
  }
): Promise<void> {
  await insertSensitiveOperationAuditEvent({
    db: asQueryable(requireDatabase(env)),
    event: {
      actorUserId: input.caller.userId,
      agentProfileId: input.request.agentProfileId,
      chainRootProfileId: input.decision.chainRootProfileId,
      confirmationId: input.decision.confirmationId,
      createdAtMs: Date.now(),
      id: crypto.randomUUID(),
      operation: input.request.operation,
      organizationId: input.caller.organizationId,
      outcome: input.outcome,
      reasonCode: input.reasonCode ?? null,
      sourceKind: input.decision.sourceKind,
      taskExecutionId: input.decision.taskExecutionId,
    },
  });
}

type GatewaySensitiveInput = {
  context?: OpenMeldRequestContext;
  requestCredential?: RequestCredential;
};

/**
 * The Gateway-facing wrapper: decides the source, then runs the operation
 * with the credential removed, so the task credential never travels past
 * this boundary. The digest covers the operation's own input only.
 */
export async function runGatewaySensitiveOperation<
  I extends GatewaySensitiveInput,
  T,
>(
  env: CoreBindings,
  input: I,
  options: {
    agentProfileId: string | null;
    context?: OpenMeldRequestContext;
    operation: SensitiveOperation;
  },
  run: (input: Omit<I, "requestCredential">) => Promise<T>
): Promise<T> {
  const { requestCredential, ...operationInput } = input;
  if (!isRequestChainEnforced()) {
    return await run(operationInput);
  }
  const {
    context: _context,
    password: _password,
    spaceAccess: _spaceAccess,
    ...digestInput
  } = operationInput as Record<string, unknown>;
  // One connection for the decision, the operation and its audit row.
  return await withPostgresRequest(env.OPENMELD_POSTGRESQL, () =>
    runSensitiveOperation(
      env,
      {
        agentProfileId: options.agentProfileId,
        context: options.context ?? input.context,
        credential: requestCredential,
        digestInput,
        operation: options.operation,
      },
      () => run(operationInput)
    )
  );
}
