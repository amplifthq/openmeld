import {
  pluginActionResponseSchema,
  pluginActionRpcInputSchema,
  pluginConnectionDescriptionSchema,
  pluginConnectionGrantSchema,
  pluginRuntimeResponseSchema,
} from "@openmeld/schemas";
import type {
  PluginActionRequest,
  PluginActionResponse,
  PluginActionRpcInput,
  PluginRuntimeRequest,
} from "@openmeld/schemas/types";
import { digestCanonicalJson } from "@openmeld/utils";
import { requireDelegatedPluginAction } from "../center-agent/application/delegated-plugin-authorization";
import {
  buildCenterAgentConnectorActionOperationScope,
  readCenterAgentConnectorActionOperationForRecovery,
  readCenterAgentConnectorActionOperationForRequest,
  readConnectorActionReplayPermission,
  recordCenterAgentConnectorActionOperation,
} from "../center-agent/connector-action-operation-repository";
import { ensurePersonalComputer } from "../computer/personal-computer";
import type { CoreBindings } from "../lib/bindings";
import { readOrganizationAccountIdentityProjection } from "../organizations/organization-context";
import {
  createCoreRpcHttpError,
  isRpcReceiverMethodNotImplementedErrorForMethod,
} from "../rpc/errors";
import {
  type ConnectorConnectionRecord,
  listConnectorConnections,
  requireConnectorConnectionForExecution,
} from "./connector-connection-repository";
import { requireConnectorVerificationRead } from "./connector-verification-read";
import {
  pluginPermissionAllows,
  readPluginAccess,
  requirePluginPermission,
  selectPluginConnection,
} from "./plugin-access";
import { preparePluginActionConfirmation } from "./plugin-action-confirmation";
import {
  type PluginRequestExecutionGuard,
  preparePluginActionRequest,
  readPluginActionRequestForOperation,
} from "./plugin-action-requests";
import {
  assertBoundPluginConnection,
  boundPluginConnectionPreference,
  readSpacePluginConnectionBinding,
} from "./plugin-connection-execution-binding";
import { localPluginConnectionGuidance } from "./plugin-connection-guidance";
import { requireLocalPluginCaller } from "./plugin-local-caller";

type Caller = Awaited<ReturnType<typeof requireLocalPluginCaller>>;
type Execution = Extract<
  PluginActionRequest["action"],
  { operation: "execute" }
>;
type Connection = Extract<
  PluginActionResponse,
  { kind: "actions" }
>["connection"];

export async function rpcPluginAction(
  env: CoreBindings,
  value: PluginActionRpcInput
): Promise<PluginActionResponse> {
  const parsed = pluginActionRpcInputSchema.safeParse(value);
  if (!parsed.success) {
    throw failure(
      "plugin.request_invalid",
      "Choose a valid plugin action.",
      400
    );
  }
  const input = parsed.data;
  const caller = await requireLocalPluginCaller(env, input);
  const action = input.request.action;
  const grant = await requireLocalDelegatedAction(caller, action);
  if (action.operation === "connect") {
    return await localPluginConnectionGuidance(env, caller, action);
  }
  if (action.operation === "list") {
    return await listAvailableConnections(env, caller);
  }
  if (action.operation === "execute") {
    const recovered = await recoverOperation(
      env,
      caller,
      action,
      input.request.includeRecoveryReceipt === true
    );
    if (recovered) {
      return recovered;
    }
  }
  const selected = await selectLocalConnection(env, caller, action, grant);
  const connection = await presentConnection(env, caller, selected.connection);
  if (action.operation === "connection") {
    return await openLocalNativeConnection(
      env,
      input,
      caller,
      connection,
      selected.connection,
      action
    );
  }
  const catalog = await callRuntime(env, {
    operation: "list",
    service: action.service,
    ...(action.operation === "actions" ? {} : { actionId: action.actionId }),
  });
  if (catalog.status !== "catalog") {
    throw failure(
      "plugin.catalog_unavailable",
      "The plugin action catalog is unavailable.",
      503
    );
  }
  if (action.operation === "actions") {
    return {
      kind: "actions",
      connection,
      actions: permittedLocalActions(catalog.actions, connection, caller),
    };
  }
  const metadata = catalog.actions.find(
    (candidate) => candidate.id === action.actionId
  );
  if (!metadata) {
    throw failure(
      "plugin.action_unavailable",
      "This action is not available. List the plugin’s actions again.",
      404
    );
  }
  return await executeSelectedAction(
    env,
    input,
    caller,
    action,
    connection,
    metadata.effect ?? "unspecified",
    grant
  );
}

async function openLocalNativeConnection(
  env: CoreBindings,
  input: PluginActionRpcInput,
  caller: Caller,
  connection: Connection,
  record: ConnectorConnectionRecord,
  action: Extract<PluginActionRequest["action"], { operation: "connection" }>
): Promise<PluginActionResponse> {
  const runtime = env.OPENMELD_REMOTE_AGENT_WORKER;
  if (
    !(
      runtime?.describePluginConnection &&
      runtime.createPluginComputerConnection
    )
  ) {
    throw failure(
      "plugin.runtime_unavailable",
      "Plugin connection access is unavailable.",
      503
    );
  }
  const description = pluginConnectionDescriptionSchema.parse(
    await runtime
      .describePluginConnection({
        service: action.service,
        connectionName: record.connectionName,
      })
      .catch(rethrowNativeConnectionReceiverError)
  );
  if (
    !(action.computer && description.nativeHttp) ||
    description.connection?.health.state === "reconnect_required"
  ) {
    return {
      kind: "native_connection",
      connection,
      description,
      nextAction:
        description.connection?.health.state === "reconnect_required"
          ? "Reconnect this account in Plugins."
          : "Use --computer to reuse this account on your cloud Computer. If no native transport is declared, use Plugin actions.",
    };
  }
  const computer = await ensurePersonalComputer(caller.db, caller.ownerUserId);
  const id = await digestCanonicalJson([
    caller.organizationId,
    caller.ownerUserId,
    caller.actorProfileId,
    input.request.dispatchId ?? null,
    "plugin",
    action.key,
  ]);
  const expiresAtMs = Date.now() + 29 * 60 * 1000;
  const grant = pluginConnectionGrantSchema.parse({
    id,
    service: action.service,
    organizationId: caller.organizationId,
    requesterUserId: caller.ownerUserId,
    connectionName: record.connectionName,
    connectionUpdatedAtMs: record.updatedAtMs,
    connectionScope: record.scope,
    expiresAtMs,
    authority: { kind: "local", request: input },
  });
  const result = await runtime
    .createPluginComputerConnection({
      computer,
      grant,
    })
    .catch(rethrowNativeConnectionReceiverError);
  return pluginActionResponseSchema.parse({
    kind: "native_connection",
    connection,
    ...(result as object),
    expiresAtMs,
  });
}

function rethrowNativeConnectionReceiverError(error: unknown): never {
  if (
    ["describePluginConnection", "createPluginComputerConnection"].some(
      (method) => isRpcReceiverMethodNotImplementedErrorForMethod(error, method)
    )
  ) {
    throw failure(
      "plugin.runtime_unavailable",
      "Plugin connection access is temporarily unavailable during the server update. Try again shortly.",
      503
    );
  }
  throw error;
}

/** Internal reauthorization uses the same caller and connection selection as the public operation. */
export async function authorizeLocalPluginConnection(
  env: CoreBindings,
  value: unknown
) {
  const input = pluginActionRpcInputSchema.parse(value);
  if (input.request.action.operation !== "connection") {
    throw failure(
      "plugin.request_invalid",
      "A native connection request is required."
    );
  }
  const caller = await requireLocalPluginCaller(env, input);
  const grant = await requireLocalDelegatedAction(caller, input.request.action);
  const selected = await selectLocalConnection(
    env,
    caller,
    input.request.action,
    grant
  );
  return {
    connection: selected.connection,
    permission: selected.permission,
  };
}

async function selectLocalConnection(
  env: CoreBindings,
  caller: Caller,
  action: Exclude<
    PluginActionRequest["action"],
    { operation: "list" | "connect" }
  >,
  grant: Awaited<ReturnType<typeof requireLocalDelegatedAction>>
) {
  if (action.account === "personal" && !caller.personalAllowed) {
    throw failure(
      "plugin.personal_request_required",
      "Your personal connection cannot be used for someone else’s Wake."
    );
  }
  const binding = await readLocalContinuationBinding(
    env,
    caller,
    action.service
  );
  const preference = boundPluginConnectionPreference(
    binding,
    action.service,
    action.account === "personal" ? "requester" : "shared"
  );
  const selected = await selectPluginConnection({
    db: caller.db,
    organizationId: caller.organizationId,
    requesterUserId: caller.ownerUserId,
    consumer: "local_agent",
    service: action.service,
    preference,
  });
  if (!selected) {
    throw failure(
      "plugin.connection_unavailable",
      "No connection grants this Local Agent access. Review the account in Plugins."
    );
  }
  assertBoundPluginConnection(binding, action.service, selected.connection);
  assertDelegatedConnection(grant, selected.connection);
  return selected;
}

async function executeSelectedAction(
  env: CoreBindings,
  input: PluginActionRpcInput,
  caller: Caller,
  action: Execution,
  connection: Connection,
  effect: "read" | "write" | "destructive" | "unspecified",
  grant: Awaited<ReturnType<typeof requireLocalDelegatedAction>>
): Promise<PluginActionResponse> {
  assertDelegatedEffect(grant, effect);
  if (!pluginPermissionAllows(connection.permission, effect)) {
    throw failure(
      "plugin.action_forbidden",
      "This connection allows read-only access for Local Agents."
    );
  }
  const signature = await requestSignature(
    caller,
    action,
    connection.connectionName
  );
  let requestRoot = caller.authorizedRequestRoot;
  let executionGuard: PluginRequestExecutionGuard | undefined;
  if (effect !== "read") {
    const current = await requireConnectorConnectionForExecution({
      ...caller,
      connectionName: connection.connectionName,
    });
    const access = await readPluginAccess({
      ...caller,
      connectionName: connection.connectionName,
      activeOnly: true,
    });
    if (action.verificationOf) {
      await requireConnectorVerificationRead({
        db: caller.db,
        scope: operationScope(caller, action),
        reference: action.verificationOf,
        effect,
        connection,
        connectionUpdatedAtMs: current.updatedAtMs,
      });
    }
    if (!requestRoot) {
      const { permission: _permission, ...executionConnection } = connection;
      const authorization = await preparePluginActionRequest({
        db: caller.db,
        requestId: action.authorizationRequestId,
        intent: {
          organizationId: caller.organizationId,
          userId: caller.representedUserId,
          actorProfileId: caller.actorProfileId,
          operationId: action.operationId,
          sourceRequestKey: caller.sourceRequestKey ?? null,
          connection: executionConnection,
          connectionUpdatedAtMs: current.updatedAtMs,
          accessRevision: access.revision,
          service: action.service,
          actionId: action.actionId,
          effect,
          input: action.input,
        },
      });
      if (!authorization.root) {
        if (input.request.includeRequestAuthorization) {
          return {
            kind: "authorization_required",
            request: authorization.request,
          };
        }
        throw failure(
          "request_authorization_required",
          "Open your Inbox in OpenMeld to review this Plugin request, then repeat the same command and operation ID.",
          409
        );
      }
      requestRoot = authorization.root;
      executionGuard = authorization.executionGuard;
    }
  }
  if (effect === "destructive" || effect === "unspecified") {
    const { revision } = await readPluginAccess({
      ...caller,
      connectionName: connection.connectionName,
    });
    const confirmation = await preparePluginActionConfirmation({
      ...caller,
      accessRevision: revision,
      requestSignature: signature,
      token: action.confirmationToken,
    });
    if (confirmation) {
      return {
        kind: "confirmation_required",
        actionId: action.actionId,
        operationId: action.operationId,
        connection,
        confirmationToken: confirmation.token,
        expiresAtMs: confirmation.expiresAtMs,
        message:
          "Review this exact action, input, and account with the requester before repeating it with the confirmation token.",
      };
    }
  }
  return await executeAction(
    env,
    {
      ...(await requireLocalPluginCaller(env, input)),
      ...(requestRoot ? { sourceRequestKey: requestRoot } : {}),
    },
    action,
    connection,
    signature,
    effect,
    input.request.includeRecoveryReceipt === true,
    executionGuard
  );
}

function assertDelegatedEffect(
  grant: Awaited<ReturnType<typeof requireLocalDelegatedAction>>,
  effect: string
) {
  if (grant && grant.effect !== effect) {
    throw failure(
      "plugin.delegation_scope_mismatch",
      "This action's effect differs from the delegated authorization."
    );
  }
}

function permittedLocalActions(
  actions: Extract<PluginActionResponse, { kind: "actions" }>["actions"],
  connection: Connection,
  caller: Caller
) {
  return actions.filter(
    (action) =>
      pluginPermissionAllows(
        connection.permission,
        action.effect ?? "unspecified"
      ) &&
      (!caller.delegatedPluginActions ||
        caller.delegatedPluginActions.some(
          (grant) =>
            grant.connectionName === connection.connectionName &&
            grant.actionId === action.id &&
            grant.effect === action.effect &&
            grant.expiresAtMs > Date.now()
        ))
  );
}

async function readLocalContinuationBinding(
  env: CoreBindings,
  caller: Caller,
  service: string
) {
  if (!(caller.sourceSpaceId && caller.sourceSignalId)) {
    return null;
  }
  return await readSpacePluginConnectionBinding(
    env,
    {
      organizationId: caller.organizationId,
      spaceId: caller.sourceSpaceId,
      signalId: caller.sourceSignalId,
      targetProfileId: caller.actorProfileId,
      requesterUserId: caller.representedUserId,
    },
    service
  );
}

async function listAvailableConnections(
  env: CoreBindings,
  caller: Caller
): Promise<PluginActionResponse> {
  const records = await listConnectorConnections({
    db: caller.db,
    organizationId: caller.organizationId,
    userId: caller.ownerUserId,
  });
  const connections: Connection[] = [];
  for (const record of records) {
    if (
      caller.delegatedPluginActions &&
      !caller.delegatedPluginActions.some(
        (grant) =>
          grant.connectionName === record.connectionName &&
          grant.connectionUpdatedAtMs === record.updatedAtMs &&
          grant.connectionOwnerUserId === record.userId &&
          grant.expiresAtMs > Date.now()
      )
    ) {
      continue;
    }
    if (
      record.status !== "active" ||
      (record.scope === "member" && !caller.personalAllowed)
    ) {
      continue;
    }
    const { policy } = await readPluginAccess({
      ...caller,
      connectionName: record.connectionName,
    });
    if (policy.local_agent !== "none") {
      connections.push(await presentConnection(env, caller, record));
    }
  }
  return { kind: "connections", connections };
}

async function presentConnection(
  env: CoreBindings,
  caller: Caller,
  record: ConnectorConnectionRecord
): Promise<Connection> {
  const { policy } = await readPluginAccess({
    ...caller,
    connectionName: record.connectionName,
  });
  if (policy.local_agent === "none") {
    throw failure("plugin.action_forbidden", "Local Agent access was revoked.");
  }
  const identity = await readOrganizationAccountIdentityProjection({
    authWorker: env.OPENMELD_AUTH_WORKER,
    organizationId: caller.organizationId,
    account: { kind: "user_id", userId: record.userId },
  });
  if (
    !(
      identity?.ok &&
      identity.organization.id === caller.organizationId &&
      identity.account?.userId === record.userId
    )
  ) {
    throw failure(
      "plugin.connection_owner_unavailable",
      "The connected account owner could not be verified.",
      503
    );
  }
  return {
    connectionName: record.connectionName,
    service: record.service,
    scope: record.scope,
    ownerUserId: record.userId,
    ownerDisplayName: identity.account.displayName,
    permission: policy.local_agent,
  };
}

function operationScope(caller: Caller, action: Execution) {
  return buildCenterAgentConnectorActionOperationScope({
    ...caller,
    operationId: action.operationId,
    requester: {
      kind: "represented_member",
      representedUserId: caller.representedUserId,
    },
  });
}

async function requestSignature(
  caller: Caller,
  action: Execution,
  connectionName: string
) {
  return await digestCanonicalJson({
    organizationId: caller.organizationId,
    actorProfileId: caller.actorProfileId,
    representedUserId: caller.representedUserId,
    sourceSpaceId: caller.sourceSpaceId,
    operationId: action.operationId,
    service: action.service,
    actionId: action.actionId,
    account: action.account,
    input: action.input,
    connectionName,
    ...(action.verificationOf ? { verificationOf: action.verificationOf } : {}),
  });
}

async function recoverOperation(
  env: CoreBindings,
  caller: Caller,
  action: Execution,
  includeRecoveryReceipt: boolean
): Promise<PluginActionResponse | null> {
  const scope = operationScope(caller, action);
  const existing = await readCenterAgentConnectorActionOperationForRecovery({
    db: caller.db,
    scope,
    actionId: action.actionId,
    service: action.service,
  });
  if (!existing) {
    if (action.replay) {
      throw failure(
        "plugin.replay_receipt_unavailable",
        "Read the original operation receipt before requesting a replay."
      );
    }
    return null;
  }
  await readCenterAgentConnectorActionOperationForRequest({
    db: caller.db,
    scope,
    actionId: action.actionId,
    service: action.service,
    requestSignature: await requestSignature(
      caller,
      action,
      existing.connectionName
    ),
  });
  if (!existing.executionConnection) {
    throw failure(
      "plugin.operation_identity_unavailable",
      "The original operation account is unavailable.",
      503
    );
  }
  const current = await requireConnectorConnectionForExecution({
    ...caller,
    connectionName: existing.executionConnection.connectionName,
  });
  assertDelegatedConnection(
    await requireLocalDelegatedAction(caller, action),
    current
  );
  if (
    current.status !== "active" ||
    current.userId !== existing.executionConnection.ownerUserId ||
    (existing.connectionUpdatedAtMs !== null &&
      current.updatedAtMs !== existing.connectionUpdatedAtMs) ||
    current.scope !== existing.executionConnection.scope ||
    current.service !== action.service
  ) {
    throw failure(
      "plugin.operation_identity_changed",
      "The original operation account is no longer available."
    );
  }
  await presentConnection(env, caller, current);
  const replay = await readLocalReplayPermission(caller, existing);
  if (action.replay && includeRecoveryReceipt && replay.allowed) {
    return null;
  }
  return {
    kind: "execution",
    actionId: action.actionId,
    operationId: action.operationId,
    status: existing.status,
    replayed: true,
    connection: existing.executionConnection,
    providerExecutionId: existing.providerExecutionId,
    ...(includeRecoveryReceipt ? { replay } : {}),
  };
}

async function executeAction(
  env: CoreBindings,
  caller: Caller,
  action: Execution,
  connection: Connection,
  signature: string,
  effect: "read" | "write" | "destructive" | "unspecified",
  includeRecoveryReceipt: boolean,
  executionGuard?: PluginRequestExecutionGuard
): Promise<PluginActionResponse> {
  const grant = await requireLocalDelegatedAction(caller, action);
  const current = await requireConnectorConnectionForExecution({
    ...caller,
    connectionName: connection.connectionName,
  });
  assertDelegatedConnection(grant, current);
  if (
    current.scope !== connection.scope ||
    current.userId !== connection.ownerUserId ||
    current.service !== connection.service
  ) {
    throw failure(
      "plugin.operation_identity_changed",
      "The selected account changed before execution."
    );
  }
  await requirePluginPermission({
    ...caller,
    connectionName: connection.connectionName,
    consumer: "local_agent",
    effect,
  });
  const { permission: _permission, ...executionConnection } = connection;
  const verificationOf = await requireConnectorVerificationRead({
    db: caller.db,
    scope: operationScope(caller, action),
    reference: action.verificationOf,
    effect,
    connection: executionConnection,
    connectionUpdatedAtMs: current.updatedAtMs,
  });
  const operation = {
    db: caller.db,
    organizationId: caller.organizationId,
    actorProfileId: caller.actorProfileId,
    requester: {
      kind: "represented_member" as const,
      representedUserId: caller.representedUserId,
    },
    attribution: {
      actorProfileId: caller.actorProfileId,
      onBehalfOf: {
        profileId: caller.human.profileId,
        userId: caller.representedUserId,
        displayName: caller.human.profileName,
      },
    },
    sourceSpaceId: caller.sourceSpaceId,
    actionId: action.actionId,
    operationId: action.operationId,
    service: action.service,
    connectionName: connection.connectionName,
    executionConnection,
    connectionUpdatedAtMs: current.updatedAtMs,
    requestSignature: signature,
    effect,
    sourceRequestKey: caller.sourceRequestKey,
    effectSignature: await digestCanonicalJson({
      actionId: action.actionId,
      service: action.service,
      input: action.input,
      connectionName: connection.connectionName,
    }),
  };
  const claim = await recordCenterAgentConnectorActionOperation({
    ...operation,
    outcome: "attempted",
    nowMs: Date.now(),
    providerExecutionId: null,
    allowReplay: action.replay === true && includeRecoveryReceipt,
    executionGuard,
  });
  if (!claim.executionAllowed) {
    if (!claim.operation.executionConnection) {
      throw failure(
        "plugin.operation_identity_unavailable",
        "The original operation account is unavailable.",
        503
      );
    }
    return {
      kind: "execution",
      actionId: claim.operation.actionId,
      operationId: claim.operation.operationId,
      connection: claim.operation.executionConnection,
      replayed: true,
      status: claim.operation.status,
      providerExecutionId: claim.operation.providerExecutionId,
      ...(includeRecoveryReceipt
        ? {
            replay: await readLocalReplayPermission(caller, claim.operation),
          }
        : {}),
    };
  }
  const result = await callRuntime(env, {
    operation: "execute",
    actionId: action.actionId,
    service: action.service,
    connectionName: connection.connectionName,
    input: action.input,
    idempotencyKey: await digestCanonicalJson({
      domain: "openmeld.plugins.local.v1",
      ...operationScope(caller, action),
    }),
    authorizedEffect: effect,
  }).catch((error: unknown) => ({
    status: "outcome_unknown" as const,
    providerExecutionId: null,
    error:
      error instanceof Error
        ? error.message
        : "The provider result is unknown.",
  }));
  if (result.status === "catalog") {
    throw failure(
      "plugin.runtime_invalid",
      "The provider returned an invalid execution response.",
      503
    );
  }
  let persisted:
    | Awaited<ReturnType<typeof recordCenterAgentConnectorActionOperation>>
    | undefined;
  try {
    persisted = await recordCenterAgentConnectorActionOperation({
      ...operation,
      outcome: result.status === "pending" ? "outcome_unknown" : result.status,
      nowMs: Date.now(),
      providerExecutionId: result.providerExecutionId,
    });
  } catch {
    return {
      kind: "execution",
      actionId: action.actionId,
      operationId: action.operationId,
      connection: executionConnection,
      replayed: claim.replayed,
      status: "outcome_unknown",
      providerExecutionId: result.providerExecutionId,
      error:
        "The provider result could not be durably recorded. Check the original target; do not issue a new write.",
      ...(includeRecoveryReceipt
        ? {
            executionConfirmation:
              result.status === "completed"
                ? ("executed" as const)
                : ("unknown" as const),
            replay: {
              allowed: false as const,
              reason: "window_unverified" as const,
            },
          }
        : {}),
    };
  }
  return {
    kind: "execution",
    actionId: action.actionId,
    operationId: action.operationId,
    connection: executionConnection,
    ...(verificationOf ? { verificationOf } : {}),
    replayed: claim.replayed,
    status: result.status,
    providerExecutionId: result.providerExecutionId,
    ...(includeRecoveryReceipt
      ? {
          replay: await readLocalReplayPermission(caller, persisted.operation),
        }
      : {}),
    ...(result.status === "completed"
      ? { data: result.data }
      : { error: result.error }),
  };
}

async function readLocalReplayPermission(
  caller: Caller,
  operation: NonNullable<
    Awaited<
      ReturnType<typeof readCenterAgentConnectorActionOperationForRecovery>
    >
  >
) {
  const replay = await readConnectorActionReplayPermission({
    actorProfileId: caller.actorProfileId,
    db: caller.db,
    operation,
    nowMs: Date.now(),
  });
  if (!replay.allowed) {
    return replay;
  }
  if (caller.authorizedRequestRoot) {
    return replay;
  }
  const authority = await readPluginActionRequestForOperation({
    ...caller,
    userId: caller.representedUserId,
    operationId: operation.operationId,
  });
  const remainingWindowMs = Math.min(
    replay.remainingWindowMs,
    (authority?.expiresAtMs ?? 0) - Date.now()
  );
  return remainingWindowMs > 0
    ? { ...replay, remainingWindowMs }
    : { allowed: false as const, reason: "window_unverified" as const };
}

async function callRuntime(env: CoreBindings, input: PluginRuntimeRequest) {
  if (!env.OPENMELD_REMOTE_AGENT_WORKER?.pluginRuntime) {
    throw failure(
      "plugin.runtime_unavailable",
      "Plugin execution is unavailable.",
      503
    );
  }
  const result = await env.OPENMELD_REMOTE_AGENT_WORKER.pluginRuntime(input);
  const parsed = pluginRuntimeResponseSchema.safeParse(result);
  if (!parsed.success) {
    throw failure(
      "plugin.runtime_invalid",
      "The plugin runtime returned an invalid response.",
      503
    );
  }
  return parsed.data;
}

function failure(code: string, reason: string, status = 403) {
  return createCoreRpcHttpError({ code, reason, status });
}

async function requireLocalDelegatedAction(
  caller: Caller,
  action: PluginActionRequest["action"]
) {
  if (!caller.delegatedPluginActions || action.operation === "list") {
    return undefined;
  }
  if (action.operation === "connect" || action.operation === "connection") {
    throw failure(
      "plugin.delegation_scope_mismatch",
      "A delegated action must use its explicitly authorized connection."
    );
  }
  const accountGrants = caller.delegatedPluginActions.filter(
    (candidate) =>
      candidate.connectionScope ===
      (action.account === "personal" ? "member" : "shared")
  );
  const grant = requireDelegatedPluginAction(accountGrants, {
    service: action.service,
    ...(action.operation === "execute" ? { actionId: action.actionId } : {}),
  });
  if (action.operation === "execute") {
    return requireDelegatedPluginAction(accountGrants, {
      service: action.service,
      actionId: action.actionId,
      requestSignature: await digestCanonicalJson({
        actionId: action.actionId,
        service: action.service,
        connectionName: grant.connectionName,
        input: action.input,
      }),
    });
  }
  return grant;
}

function assertDelegatedConnection(
  grant: Awaited<ReturnType<typeof requireLocalDelegatedAction>>,
  connection: ConnectorConnectionRecord
) {
  if (
    grant &&
    (grant.connectionName !== connection.connectionName ||
      grant.connectionUpdatedAtMs !== connection.updatedAtMs ||
      grant.connectionOwnerUserId !== connection.userId ||
      grant.connectionScope !== connection.scope)
  ) {
    throw failure(
      "plugin.delegation_account_changed",
      "The account selected for this delegation has changed."
    );
  }
}
