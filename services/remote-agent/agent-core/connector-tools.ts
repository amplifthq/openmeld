import {
  CENTER_AGENT_APP_CONNECTOR_SERVICES,
  CENTER_AGENT_OPENMELD_IDENTITY_REQUIRED_CODE,
  centerAgentConnectorConnectionSelectionSchema,
  centerAgentReadConnectorActionOperationResponseSchema,
  centerAgentRecordConnectorActionOperationResponseSchema,
  openConnectorRuntimeActionListSchema,
  openConnectorRuntimeActionOperationMetaSchema,
  openConnectorRuntimeActionSearchResultListSchema,
  openConnectorRuntimeActionSuccessEnvelopeSchema,
} from "@openmeld/schemas";
import type {
  ConnectorService,
  OpenConnectorRuntimeAction,
  RemoteAgentTurnEnvelope,
} from "@openmeld/schemas/types";
import {
  integer,
  maxLength,
  maxValue,
  minLength,
  minValue,
  number,
  object,
  optional,
  picklist,
  pipe,
  record,
  string,
  trim,
  unknown as unknownSchema,
} from "valibot";
import type {
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "./callback-context";
import { digestCanonicalJson } from "./canonical-json";
import {
  type CenterAgentAppConnectorService,
  getConnectedAppDisplayName,
} from "./connector-service-presentation";
import { callCoreRpc, requireCoreRpc } from "./core-rpc";
import {
  isRemoteAgentDestructiveConfirmationResult,
  resolveRemoteAgentDestructiveAuthorization,
  resolveRemoteAgentRoutineDestructiveActionBlock,
  resolveRemoteAgentRoutineExternalWriteBlock,
} from "./destructive-authorization";
import type { RemoteAgentConnectorExecutionConfig } from "./github-tools";
import {
  buildRemoteAgentToolContext,
  resolveOrganizationMemberTurnEnvelopeSpeaker,
  resolveVerifiedTurnEnvelopeSpeaker,
} from "./tool-context";
import type { RemoteAgentToolDefinition } from "./tool-definition";

const TRAILING_SLASH_PATTERN = /\/+$/u;
const LEGACY_DESTRUCTIVE_ACTION_TERMS = [
  "delete",
  "destroy",
  "drop",
  "erase",
  "merge",
  "purge",
  "remove",
  "trash",
] as const;
const DESTRUCTIVE_ACTION_PATTERN = new RegExp(
  `(?:^|[._\\-\\s])(${LEGACY_DESTRUCTIVE_ACTION_TERMS.join("|")})(?:$|[._\\-\\s])`,
  "iu"
);
const LEGACY_READ_ACTION_ID_PATTERN = /\.(?:get|list)_[a-z0-9_]+$/iu;
const OPENCONNECTOR_ACTION_SEARCH_LIMIT = 50;
const GITHUB_DEDICATED_ACTION_INSTRUCTION =
  "This Apps list never reports GitHub access. For a GitHub request, call the matching github_* tool; it will verify the requested Organization or member GitHub connection.";
export const REMOTE_AGENT_CONNECTOR_TOOL_NAMES = [
  "openmeld_list_connected_apps",
  "openmeld_list_app_actions",
  "openmeld_execute_app_action",
] as const;

export type RemoteAgentConnectorToolName =
  (typeof REMOTE_AGENT_CONNECTOR_TOOL_NAMES)[number];
type ConnectorToolDefinition =
  RemoteAgentToolDefinition<RemoteAgentConnectorToolName>;
type ConnectorToolDependencies = {
  connectorExecution?: RemoteAgentConnectorExecutionConfig;
  coreWorker: RemoteAgentCoreWorkerBinding;
  storage: RemoteAgentStorage;
  submissionId: string;
};
type ConnectorActionOperationRequest = {
  actionId: string;
  input: Record<string, unknown>;
  operationId: string;
  providerIdempotencyKey?: string;
  service: ConnectorService;
};
type ExecuteAppActionRequest = ConnectorActionOperationRequest & {
  destructiveConfirmationToken?: string;
  service: CenterAgentAppConnectorService;
};

const connectorServiceInputSchema = picklist(
  CENTER_AGENT_APP_CONNECTOR_SERVICES
);
const listAppActionsInputSchema = object({
  limit: optional(pipe(number(), integer(), minValue(1), maxValue(500))),
  offset: optional(pipe(number(), integer(), minValue(0), maxValue(10_000))),
  query: optional(pipe(string(), trim(), minLength(1), maxLength(160))),
  service: connectorServiceInputSchema,
});
const executeAppActionInputSchema = object({
  actionId: pipe(string(), trim(), minLength(1), maxLength(160)),
  destructiveConfirmationToken: optional(
    pipe(string(), trim(), minLength(1), maxLength(512))
  ),
  input: record(string(), unknownSchema()),
  operationId: pipe(string(), trim(), minLength(1), maxLength(256)),
  service: connectorServiceInputSchema,
});

export function getRemoteAgentConnectorToolDefinitions(
  input: ConnectorToolDependencies
): ConnectorToolDefinition[] {
  return [
    {
      name: "openmeld_list_connected_apps",
      description:
        "List the non-GitHub Apps currently available to this Center Agent. Linked member requests use that member's connection first and fall back to Organization access. Connected Message Channel members use Organization access only. Routines use Organization access when no delegated member connection is available.",
      input: object({}),
      execute: async () => {
        const toolContext = await buildRemoteAgentToolContext({
          storage: input.storage,
          submissionId: input.submissionId,
          toolName: "openmeld_list_connected_apps",
        });
        const requester = resolveConnectorTurnRequester(
          toolContext.turnEnvelope
        );
        const apps = await Promise.all(
          CENTER_AGENT_APP_CONNECTOR_SERVICES.map(async (service) => {
            const selection = await resolveConnectorConnection({
              connectionPreference: requester.connectionPreference,
              coreWorker: input.coreWorker,
              requesterUserId: requester.requesterUserId,
              service,
              toolContext,
            });
            return {
              connected: Boolean(selection.connection),
              name: getConnectedAppDisplayName(service),
              scope: selection.connection?.scope ?? null,
              selection: selection.selection,
              service,
            };
          })
        );
        return {
          apps,
          github: {
            connectionStatus: "not_checked" as const,
            instruction: GITHUB_DEDICATED_ACTION_INSTRUCTION,
          },
        };
      },
    },
    {
      name: "openmeld_list_app_actions",
      description:
        "Discover the OpenConnector actions OpenMeld can run for one connected App. The result includes each action's exact id, description, effect, required scopes, input schema, and output schema. This tool does not read or change provider data. Call it before executing an unfamiliar action. When the user asked for a provider outcome and one returned action matches with clear required input, continue in the same turn with openmeld_execute_app_action; do not report discovery as the requested outcome.",
      input: listAppActionsInputSchema,
      execute: async (payload) => {
        const request = payload as {
          limit?: number;
          offset?: number;
          query?: string;
          service: CenterAgentAppConnectorService;
        };
        const toolContext = await buildRemoteAgentToolContext({
          storage: input.storage,
          submissionId: input.submissionId,
          toolName: "openmeld_list_app_actions",
        });
        const requester = resolveConnectorTurnRequester(
          toolContext.turnEnvelope
        );
        await requireAvailableConnectorConnection({
          connectionPreference: requester.connectionPreference,
          coreWorker: input.coreWorker,
          requesterUserId: requester.requesterUserId,
          service: request.service,
          toolContext,
        });
        const actions = await listOpenConnectorActions({
          connectorExecution: input.connectorExecution,
          service: request.service,
        });
        const query = request.query?.trim();
        const matchingActions = query
          ? await searchOpenConnectorActions({
              actions,
              connectorExecution: input.connectorExecution,
              query,
              service: request.service,
            })
          : actions;
        const offset = request.offset ?? 0;
        const visibleActions =
          request.limit === undefined
            ? matchingActions.slice(offset)
            : matchingActions.slice(offset, offset + request.limit);
        return {
          actions: visibleActions.map(toModelVisibleAction),
          availableCount: actions.length,
          hasMore: offset + visibleActions.length < matchingActions.length,
          matchingCount: matchingActions.length,
          nextOffset:
            offset + visibleActions.length < matchingActions.length
              ? offset + visibleActions.length
              : null,
          offset,
          service: request.service,
        };
      },
    },
    {
      name: "openmeld_execute_app_action",
      description:
        "Execute one exact action previously discovered with openmeld_list_app_actions. This can read or change provider data, so use the action description, effect, and input schema literally. A successful execution returns both data and its outputSchema; interpret the data through that schema, and use a declared aggregate or estimate field instead of counting one returned page. For a write effect, the current request must explicitly authorize this exact action and target, or clearly confirm the exact write proposed in your immediately preceding message. An earlier explicit request for this exact write continues to authorize it when a short reply only supplies a missing field or target within that request; the short reply cannot invent or broaden the action. Bare Yes or OK is authority only after your immediately preceding message proposed one exact write and target. A linked user's explicit request, a connected Message Channel member's explicit request through Organization access, or an explicit Routine instruction authorizes ordinary non-destructive writes without a second confirmation. An interactive destructive action requires linked OpenMeld identity and one separate confirmation. Routines do not currently support destructive actions and receive routine_destructive_action_unsupported with zero side effects. Choose a stable operationId and reuse it when retrying this exact action. OpenMeld attributes and durably records every execution. GitHub uses its dedicated github_* tools instead.",
      endsTurnAfter: (result) =>
        isRemoteAgentDestructiveConfirmationResult(result),
      input: executeAppActionInputSchema,
      execute: (payload) =>
        executeAppAction({
          dependencies: input,
          request: payload as ExecuteAppActionRequest,
        }),
    },
  ];
}

async function executeAppAction(input: {
  dependencies: ConnectorToolDependencies;
  request: ExecuteAppActionRequest;
}) {
  const toolContext = await buildRemoteAgentToolContext({
    storage: input.dependencies.storage,
    submissionId: input.dependencies.submissionId,
    toolName: "openmeld_execute_app_action",
  });
  await requireMemberResearchReadOnlyConnectorAction({
    actionId: input.request.actionId,
    connectorExecution: input.dependencies.connectorExecution,
    service: input.request.service,
    toolContext,
  });
  const connectedMemberPolicy =
    await resolveConnectedMessageChannelActionPolicy({
      actionId: input.request.actionId,
      connectorExecution: input.dependencies.connectorExecution,
      service: input.request.service,
      toolContext,
    });
  if (connectedMemberPolicy.blockedResult) {
    return connectedMemberPolicy.blockedResult;
  }
  const externalWriteBlock =
    resolveRemoteAgentRoutineExternalWriteBlock(toolContext);
  const policyAction =
    connectedMemberPolicy.action ??
    (externalWriteBlock
      ? await requireOpenConnectorAction({
          actionId: input.request.actionId,
          connectorExecution: input.dependencies.connectorExecution,
          service: input.request.service,
        })
      : undefined);
  if (
    externalWriteBlock &&
    policyAction &&
    resolveConnectorActionEffect(policyAction) !== "read"
  ) {
    return {
      actionId: policyAction.id,
      ...externalWriteBlock,
    };
  }
  const existingOperation = await readConnectorActionOperation({
    actionId: input.request.actionId,
    coreWorker: input.dependencies.coreWorker,
    operationId: input.request.operationId,
    service: input.request.service,
    toolContext,
  });
  const routineAction =
    !existingOperation && toolContext.turnEnvelope?.trigger.source === "routine"
      ? (policyAction ??
        (await requireOpenConnectorAction({
          actionId: input.request.actionId,
          connectorExecution: input.dependencies.connectorExecution,
          service: input.request.service,
        })))
      : undefined;
  let executionAction = routineAction ?? policyAction;
  if (routineAction && isDestructiveConnectorAction(routineAction)) {
    const block = resolveRemoteAgentRoutineDestructiveActionBlock(toolContext);
    if (!block) {
      throw new Error(
        "Routine destructive authorization lost its verified Routine context."
      );
    }
    return {
      actionId: routineAction.id,
      ...block,
    };
  }
  let confirmedSelection:
    | Awaited<ReturnType<typeof requireAvailableConnectorConnection>>
    | undefined;
  if (!existingOperation) {
    executionAction =
      routineAction ??
      (await requireOpenConnectorAction({
        actionId: input.request.actionId,
        connectorExecution: input.dependencies.connectorExecution,
        service: input.request.service,
      }));
    if (isDestructiveConnectorAction(executionAction)) {
      const requester = resolveConnectorTurnRequester(toolContext.turnEnvelope);
      confirmedSelection = await requireAvailableConnectorConnection({
        connectionPreference: requester.connectionPreference,
        coreWorker: input.dependencies.coreWorker,
        requesterUserId: requester.requesterUserId,
        service: input.request.service,
        toolContext,
      });
      const authorization = await resolveRemoteAgentDestructiveAuthorization({
        actionDescription: `${executionAction.name}: ${executionAction.description}, using ${executionAction.id} with input ${JSON.stringify(
          input.request.input
        )}`,
        actionId: executionAction.id,
        actionInput: {
          input: input.request.input,
          service: input.request.service,
        },
        executionIdentity: {
          connectionName: confirmedSelection.connection.connectionName,
          ownerUserId: confirmedSelection.connection.userId,
        },
        storage: input.dependencies.storage,
        submissionId: input.dependencies.submissionId,
        token: input.request.destructiveConfirmationToken,
        tokenFieldName: "destructiveConfirmationToken",
        toolContext,
      });
      if (!authorization.authorized) {
        return {
          actionId: executionAction.id,
          ...authorization.result,
        };
      }
    }
  }
  const operation = await prepareConnectorActionOperation({
    ...input,
    confirmedSelection,
    existingOperation,
    toolContext,
  });
  const run = await runAndFinalizeConnectorAction({
    ...input,
    ...operation,
    toolContext,
  });
  const attribution = (() => {
    if (operation.selection) {
      return {
        connectionName: operation.connectionName,
        connectionOwner: {
          displayName: operation.selection.connection.ownerDisplayName,
          userId: operation.selection.connection.userId,
        },
        scope: operation.selection.connection.scope,
        selection: operation.selection.selection,
        service: input.request.service,
      };
    }
    if (operation.executionConnection) {
      return {
        connectionName: operation.connectionName,
        connectionOwner: {
          displayName: operation.executionConnection.ownerDisplayName,
          userId: operation.executionConnection.ownerUserId,
        },
        scope: operation.executionConnection.scope,
        selection:
          operation.executionConnection.scope === "shared"
            ? ("shared" as const)
            : ("requester" as const),
        service: input.request.service,
      };
    }
    return {
      connectionName: operation.connectionName,
      service: input.request.service,
    };
  })();
  return {
    actionId: input.request.actionId,
    attribution,
    data: run.data,
    operationId: input.request.operationId,
    outputSchema: run.outputSchema,
    providerExecutionId: run.providerExecutionId,
    replayed: operation.coreOperationReplayed,
  };
}

async function requireMemberResearchReadOnlyConnectorAction(input: {
  actionId: string;
  connectorExecution?: RemoteAgentConnectorExecutionConfig;
  service: CenterAgentAppConnectorService;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}): Promise<void> {
  if (input.toolContext.turnEnvelope?.trigger.source !== "member_research") {
    return;
  }
  const action = await requireOpenConnectorAction(input);
  if (resolveConnectorActionEffect(action) !== "read") {
    throw new Error(
      "Member research can only execute connected App actions declared read."
    );
  }
}

async function resolveConnectedMessageChannelActionPolicy(input: {
  actionId: string;
  connectorExecution?: RemoteAgentConnectorExecutionConfig;
  service: CenterAgentAppConnectorService;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}): Promise<{
  action?: OpenConnectorRuntimeAction;
  blockedResult?: {
    actionId: string;
    errorCode: typeof CENTER_AGENT_OPENMELD_IDENTITY_REQUIRED_CODE;
    identityRequired: true;
    message: string;
  };
}> {
  const speaker = resolveOrganizationMemberTurnEnvelopeSpeaker(
    input.toolContext.turnEnvelope
  );
  if (!(speaker && "kind" in speaker)) {
    return {};
  }
  const action = await requireOpenConnectorAction(input);
  const effect = resolveConnectorActionEffect(action);
  // Registered `write` is the action owner's ordinary-member policy. Actions
  // declared destructive, or without a known effect, still require identity.
  if (effect === "read" || effect === "write") {
    return { action };
  }
  return {
    blockedResult: {
      actionId: action.id,
      errorCode: CENTER_AGENT_OPENMELD_IDENTITY_REQUIRED_CODE,
      identityRequired: true,
      message:
        "This action requires a linked OpenMeld identity because it is destructive or does not declare a safe effect. Complete the independent safe work first, then use the one-time setup action to continue this exact request.",
    },
  };
}

async function prepareConnectorActionOperation(input: {
  confirmedSelection?: Awaited<
    ReturnType<typeof requireAvailableConnectorConnection>
  >;
  dependencies: ConnectorToolDependencies;
  existingOperation: Awaited<ReturnType<typeof readConnectorActionOperation>>;
  request: ExecuteAppActionRequest;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}) {
  let connectionName = input.existingOperation?.connectionName;
  let selection = input.confirmedSelection as
    | Awaited<ReturnType<typeof requireAvailableConnectorConnection>>
    | undefined;
  if (!input.existingOperation) {
    if (!selection) {
      const requester = resolveConnectorTurnRequester(
        input.toolContext.turnEnvelope
      );
      selection = await requireAvailableConnectorConnection({
        connectionPreference: requester.connectionPreference,
        coreWorker: input.dependencies.coreWorker,
        requesterUserId: requester.requesterUserId,
        service: input.request.service,
        toolContext: input.toolContext,
      });
    }
    connectionName = selection.connection.connectionName;
  }
  if (!connectionName) {
    throw new Error(
      `OpenMeld could not resolve the connection for operation ${input.request.operationId}.`
    );
  }
  const requestSignature = await buildConnectorActionRequestSignature({
    actionId: input.request.actionId,
    connectionName,
    input: input.request.input,
    service: input.request.service,
  });
  const claim = await recordConnectorActionOperation({
    actionId: input.request.actionId,
    connectionName,
    coreWorker: input.dependencies.coreWorker,
    operationId: input.request.operationId,
    outcome: "attempted",
    providerExecutionId: null,
    requestSignature,
    service: input.request.service,
    toolContext: input.toolContext,
  });
  return {
    connectionName,
    coreOperationReplayed: claim.replayed,
    executionConnection:
      input.existingOperation?.executionConnection ??
      claim.executionConnection ??
      null,
    requestSignature,
    selection,
  };
}

export async function runAndFinalizeConnectorAction(input: {
  connectionName: string;
  dependencies: ConnectorToolDependencies;
  request: ConnectorActionOperationRequest;
  requestSignature: string;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}): Promise<OpenConnectorActionRun> {
  let run: OpenConnectorActionRun;
  try {
    run = await runOpenConnectorAction({
      actionId: input.request.actionId,
      connectorExecution: input.dependencies.connectorExecution,
      connectionName: input.connectionName,
      idempotencyKey:
        input.request.providerIdempotencyKey ?? input.request.operationId,
      input: input.request.input,
    });
  } catch (error) {
    await finalizeFailedConnectorAction({ ...input, error });
    throw error;
  }
  try {
    await recordConnectorActionOperation({
      actionId: input.request.actionId,
      connectionName: input.connectionName,
      coreWorker: input.dependencies.coreWorker,
      operationId: input.request.operationId,
      outcome: "completed",
      providerExecutionId: run.providerExecutionId,
      requestSignature: input.requestSignature,
      service: input.request.service,
      toolContext: input.toolContext,
    });
  } catch (finalizationError) {
    throw new Error(
      `OpenConnector action ${input.request.actionId} completed at the provider, but OpenMeld could not finalize operation ${input.request.operationId}. Retry this exact action with the same operationId.`,
      { cause: finalizationError }
    );
  }
  return run;
}

async function finalizeFailedConnectorAction(input: {
  connectionName: string;
  dependencies: ConnectorToolDependencies;
  error: unknown;
  request: ConnectorActionOperationRequest;
  requestSignature: string;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}): Promise<void> {
  if (input.error instanceof OpenConnectorOperationPendingError) {
    throw input.error;
  }
  try {
    await recordConnectorActionOperation({
      actionId: input.request.actionId,
      connectionName: input.connectionName,
      coreWorker: input.dependencies.coreWorker,
      operationId: input.request.operationId,
      outcome:
        input.error instanceof OpenConnectorActionError
          ? input.error.outcome
          : "outcome_unknown",
      providerExecutionId:
        input.error instanceof OpenConnectorActionError
          ? input.error.providerExecutionId
          : null,
      requestSignature: input.requestSignature,
      service: input.request.service,
      toolContext: input.toolContext,
    });
  } catch (finalizationError) {
    throw new Error(
      `OpenConnector action ${input.request.actionId} did not complete cleanly, and OpenMeld could not finalize operation ${input.request.operationId}. Retry this exact action with the same operationId.`,
      {
        cause: new AggregateError(
          [input.error, finalizationError],
          "Provider action and Core operation finalization both failed."
        ),
      }
    );
  }
}

async function listOpenConnectorActions(input: {
  connectorExecution?: RemoteAgentConnectorExecutionConfig;
  service: CenterAgentAppConnectorService;
}): Promise<OpenConnectorRuntimeAction[]> {
  const runtime = requireConnectorRuntime(input.connectorExecution);
  const response = await runtime.fetch(
    `${runtime.baseUrl}/v1/actions?service=${encodeURIComponent(input.service)}`,
    {
      headers: { authorization: `Bearer ${runtime.runtimeToken}` },
      method: "GET",
    }
  );
  const envelope = await readRuntimeEnvelope(response);
  if (
    !(response.ok && envelope.success === true && Array.isArray(envelope.data))
  ) {
    throw new Error(
      `OpenConnector could not list ${input.service} actions: ${envelope.message ?? `HTTP ${response.status}`}`
    );
  }
  const parsedActions = openConnectorRuntimeActionListSchema.safeParse(
    envelope.data
  );
  if (!parsedActions.success) {
    throw new Error(
      `OpenConnector returned an invalid action catalog: ${parsedActions.error.issues[0]?.message ?? "unknown contract error"}`
    );
  }
  return parsedActions.data.filter((action) => {
    if (action.service !== input.service) {
      throw new Error(
        `OpenConnector returned action ${action.id} for an unexpected service.`
      );
    }
    return action.execution.locallyExecutable;
  });
}

async function searchOpenConnectorActions(input: {
  actions: OpenConnectorRuntimeAction[];
  connectorExecution?: RemoteAgentConnectorExecutionConfig;
  query: string;
  service: CenterAgentAppConnectorService;
}): Promise<OpenConnectorRuntimeAction[]> {
  const runtime = requireConnectorRuntime(input.connectorExecution);
  const searchUrl = new URL(`${runtime.baseUrl}/v1/actions/search`);
  searchUrl.searchParams.set("q", input.query);
  searchUrl.searchParams.set("service", input.service);
  searchUrl.searchParams.set(
    "limit",
    String(OPENCONNECTOR_ACTION_SEARCH_LIMIT)
  );
  const response = await runtime.fetch(searchUrl.toString(), {
    headers: { authorization: `Bearer ${runtime.runtimeToken}` },
    method: "GET",
  });
  const envelope = await readRuntimeEnvelope(response);
  if (
    !(response.ok && envelope.success === true && Array.isArray(envelope.data))
  ) {
    throw new Error(
      `OpenConnector could not search ${input.service} actions: ${envelope.message ?? `HTTP ${response.status}`}`
    );
  }
  const parsedResults =
    openConnectorRuntimeActionSearchResultListSchema.safeParse(envelope.data);
  if (!parsedResults.success) {
    throw new Error(
      `OpenConnector returned invalid action search results: ${parsedResults.error.issues[0]?.message ?? "unknown contract error"}`
    );
  }

  const actionsById = new Map(
    input.actions.map((action) => [action.id, action])
  );
  return parsedResults.data.flatMap((result) => {
    if (result.service !== input.service) {
      throw new Error(
        `OpenConnector returned action ${result.id} for an unexpected service.`
      );
    }
    const action = actionsById.get(result.id);
    return action ? [action] : [];
  });
}

async function requireOpenConnectorAction(input: {
  actionId: string;
  connectorExecution?: RemoteAgentConnectorExecutionConfig;
  service: CenterAgentAppConnectorService;
}): Promise<OpenConnectorRuntimeAction> {
  const actions = await listOpenConnectorActions(input);
  const action = actions.find((candidate) => candidate.id === input.actionId);
  if (!action) {
    throw new Error(
      `OpenConnector action ${input.actionId} is not available for ${input.service}. Call openmeld_list_app_actions again.`
    );
  }
  return action;
}

function isDestructiveConnectorAction(
  action: OpenConnectorRuntimeAction
): boolean {
  return (
    action.effect === "destructive" ||
    DESTRUCTIVE_ACTION_PATTERN.test(`${action.id} ${action.name}`)
  );
}

function resolveConnectorActionEffect(
  action: OpenConnectorRuntimeAction
): OpenConnectorRuntimeAction["effect"] {
  if (isDestructiveConnectorAction(action)) {
    return "destructive";
  }
  if (action.effect) {
    return action.effect;
  }
  if (LEGACY_READ_ACTION_ID_PATTERN.test(action.id)) {
    return "read";
  }
  return undefined;
}

async function runOpenConnectorAction(input: {
  actionId: string;
  connectorExecution?: RemoteAgentConnectorExecutionConfig;
  connectionName: string;
  idempotencyKey: string;
  input: Record<string, unknown>;
}): Promise<OpenConnectorActionRun> {
  const runtime = requireConnectorRuntime(input.connectorExecution);
  let response: Response;
  try {
    response = await runtime.fetch(
      `${runtime.baseUrl}/v1/actions/${encodeURIComponent(input.actionId)}`,
      {
        body: JSON.stringify({
          connectionName: input.connectionName,
          input: input.input,
        }),
        headers: {
          authorization: `Bearer ${runtime.runtimeToken}`,
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
        },
        method: "POST",
      }
    );
  } catch (error) {
    throw new OpenConnectorActionError({
      cause: error,
      message: `OpenConnector action ${input.actionId} did not return a response.`,
      outcome: "outcome_unknown",
    });
  }
  const envelope = await readRuntimeEnvelope(response);
  if (!(response.ok && envelope.success === true)) {
    if (envelope.errorCode === "idempotency_request_in_progress") {
      throw new OpenConnectorOperationPendingError({
        actionId: input.actionId,
        operationId: input.idempotencyKey,
        providerExecutionId: null,
      });
    }
    const operationMeta = readActionOperationMeta({
      actionId: input.actionId,
      meta: envelope.meta,
    });
    throw new OpenConnectorActionError({
      message: `OpenConnector action ${input.actionId} failed${envelope.errorCode ? ` (${envelope.errorCode})` : ""}: ${envelope.message ?? `HTTP ${response.status}`}`,
      outcome:
        operationMeta?.executionId || response.status < 500
          ? "failed"
          : "outcome_unknown",
      providerExecutionId: operationMeta?.executionId ?? null,
    });
  }
  const successEnvelope = readSuccessfulActionEnvelope({
    actionId: input.actionId,
    envelope,
  });
  return {
    data: successEnvelope.data,
    outputSchema: successEnvelope.outputSchema,
    providerExecutionId: successEnvelope.meta.executionId,
  };
}

function requireConnectorRuntime(
  input: RemoteAgentConnectorExecutionConfig | undefined
): {
  baseUrl: string;
  fetch: typeof fetch;
  runtimeToken: string;
} {
  const baseUrl = input?.baseUrl?.trim().replace(TRAILING_SLASH_PATTERN, "");
  const runtimeToken = input?.runtimeToken?.trim();
  if (!(baseUrl && runtimeToken)) {
    throw new Error("OpenConnector runtime is not configured.");
  }
  return {
    baseUrl,
    fetch: (input?.fetch ?? fetch).bind(globalThis),
    runtimeToken,
  };
}

function toModelVisibleAction(action: OpenConnectorRuntimeAction) {
  return {
    description: action.description,
    effect: resolveConnectorActionEffect(action) ?? "unspecified",
    id: action.id,
    inputSchema: action.inputSchema,
    name: action.name,
    outputSchema: action.outputSchema,
    requiredScopes: action.requiredScopes,
  };
}

async function resolveConnectorConnection(input: {
  connectionPreference: "automatic" | "shared";
  coreWorker: RemoteAgentCoreWorkerBinding;
  requesterUserId: string | null;
  service: ConnectorService;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}) {
  const resolveConnection = requireCoreRpc(
    input.coreWorker.centerAgentResolveConnectorConnection,
    "centerAgentResolveConnectorConnection"
  );
  const selection = centerAgentConnectorConnectionSelectionSchema.parse(
    await resolveConnection({
      connectionPreference: input.connectionPreference,
      context: input.toolContext.context,
      requesterUserId: input.requesterUserId,
      service: input.service,
    })
  );
  if (
    selection.connection &&
    selection.connection.organizationId !==
      input.toolContext.context.activeOrganizationId
  ) {
    throw new Error(
      `Core returned a ${input.service} connection from another Organization.`
    );
  }
  return selection;
}

async function requireAvailableConnectorConnection(
  input: Parameters<typeof resolveConnectorConnection>[0]
) {
  const selection = await resolveConnectorConnection(input);
  if (!(selection.connection && selection.selection)) {
    throw new Error(
      `${getConnectedAppDisplayName(input.service as CenterAgentAppConnectorService)} is not connected for this request. Open Center Agent → Apps and connect an account.`
    );
  }
  return {
    connection: selection.connection,
    selection: selection.selection,
  };
}

function resolveConnectorTurnRequester(
  turnEnvelope: RemoteAgentTurnEnvelope | undefined
): {
  connectionPreference: "automatic" | "shared";
  requesterUserId: string | null;
} {
  if (turnEnvelope?.trigger.source === "member_research") {
    return { connectionPreference: "shared", requesterUserId: null };
  }
  const speaker = resolveVerifiedTurnEnvelopeSpeaker(turnEnvelope);
  if (
    turnEnvelope?.sender.kind === "routine" &&
    turnEnvelope.trigger.source === "routine"
  ) {
    if (!speaker) {
      throw new Error(
        "App tools require the Routine's verified delegated member context."
      );
    }
    return {
      connectionPreference: "automatic",
      requesterUserId: speaker.userId,
    };
  }
  if (speaker) {
    return {
      connectionPreference: "automatic",
      requesterUserId: speaker.userId,
    };
  }
  const organizationMemberSpeaker =
    resolveOrganizationMemberTurnEnvelopeSpeaker(turnEnvelope);
  if (organizationMemberSpeaker && "kind" in organizationMemberSpeaker) {
    return { connectionPreference: "shared", requesterUserId: null };
  }
  throw new Error("App tools require a verified Organization member turn.");
}

export async function readConnectorActionOperation(input: {
  actionId: string;
  coreWorker: RemoteAgentCoreWorkerBinding;
  operationId: string;
  service: ConnectorService;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}) {
  const speakerMember = requireConnectorActionSpeaker(input.toolContext);
  return centerAgentReadConnectorActionOperationResponseSchema.parse(
    await callCoreRpc(
      input.coreWorker,
      "centerAgentReadConnectorActionOperation",
      {
        actionId: input.actionId,
        context: input.toolContext.context,
        operationId: input.operationId,
        service: input.service,
        speakerMember,
      },
      (binding, payload) =>
        binding.centerAgentReadConnectorActionOperation?.(payload)
    )
  ).operation;
}

export async function recordConnectorActionOperation(input: {
  actionId: string;
  connectionName: string;
  coreWorker: RemoteAgentCoreWorkerBinding;
  operationId: string;
  outcome: "attempted" | "completed" | "failed" | "outcome_unknown";
  providerExecutionId: string | null;
  requestSignature: string;
  service: ConnectorService;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}) {
  const speakerMember = requireConnectorActionSpeaker(input.toolContext);
  return centerAgentRecordConnectorActionOperationResponseSchema.parse(
    await callCoreRpc(
      input.coreWorker,
      "centerAgentRecordConnectorActionOperation",
      {
        actionId: input.actionId,
        connectionName: input.connectionName,
        context: input.toolContext.context,
        operationId: input.operationId,
        outcome: input.outcome,
        providerExecutionId: input.providerExecutionId,
        requestSignature: input.requestSignature,
        service: input.service,
        speakerMember,
      },
      (binding, payload) =>
        binding.centerAgentRecordConnectorActionOperation?.(payload)
    )
  );
}

function requireConnectorActionSpeaker(
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>
) {
  const speakerMember = resolveOrganizationMemberTurnEnvelopeSpeaker(
    toolContext.turnEnvelope
  );
  if (!speakerMember) {
    throw new Error(
      "App actions require an active Organization member attribution."
    );
  }
  return speakerMember;
}

class OpenConnectorActionError extends Error {
  readonly outcome: "failed" | "outcome_unknown";
  readonly providerExecutionId: string | null;

  constructor(input: {
    cause?: unknown;
    message: string;
    outcome: "failed" | "outcome_unknown";
    providerExecutionId?: string | null;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "OpenConnectorActionError";
    this.outcome = input.outcome;
    this.providerExecutionId = input.providerExecutionId ?? null;
  }
}

class OpenConnectorOperationPendingError extends Error {
  constructor(input: {
    actionId: string;
    operationId: string;
    providerExecutionId: string | null;
  }) {
    super(
      `OpenConnector action ${input.actionId} is still running${input.providerExecutionId ? ` as provider execution ${input.providerExecutionId}` : ""}. Retry this exact action later with operationId ${input.operationId}.`
    );
    this.name = "OpenConnectorOperationPendingError";
  }
}

async function readRuntimeEnvelope(response: Response): Promise<{
  data?: unknown;
  errorCode?: string;
  message?: string;
  meta?: unknown;
  outputSchema?: unknown;
  success?: boolean;
}> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("OpenConnector returned invalid JSON.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("OpenConnector returned an invalid runtime response.");
  }
  const recordValue = payload as Record<string, unknown>;
  return {
    data: recordValue.data,
    errorCode:
      typeof recordValue.errorCode === "string"
        ? recordValue.errorCode
        : undefined,
    message:
      typeof recordValue.message === "string" ? recordValue.message : undefined,
    meta: recordValue.meta,
    outputSchema: recordValue.outputSchema,
    success:
      typeof recordValue.success === "boolean"
        ? recordValue.success
        : undefined,
  };
}

type OpenConnectorActionRun = {
  data: unknown;
  outputSchema: OpenConnectorRuntimeAction["outputSchema"];
  providerExecutionId: string;
};

function readSuccessfulActionEnvelope(input: {
  actionId: string;
  envelope: Awaited<ReturnType<typeof readRuntimeEnvelope>>;
}) {
  const parsed = openConnectorRuntimeActionSuccessEnvelopeSchema.safeParse({
    data: input.envelope.data,
    message: input.envelope.message,
    meta: input.envelope.meta,
    outputSchema: input.envelope.outputSchema,
    success: input.envelope.success,
  });
  if (!parsed.success) {
    throw new Error(
      `OpenConnector action ${input.actionId} returned an invalid successful execution response.`
    );
  }
  if (parsed.data.meta.actionId !== input.actionId) {
    throw new Error(
      `OpenConnector action ${input.actionId} returned metadata for ${parsed.data.meta.actionId}.`
    );
  }
  return parsed.data;
}

function readActionOperationMeta(input: {
  actionId: string;
  meta: unknown;
  requireCompletedMetadata?: boolean;
}) {
  const parsed = openConnectorRuntimeActionOperationMetaSchema.safeParse(
    input.meta
  );
  if (!parsed.success) {
    if (input.requireCompletedMetadata) {
      throw new Error(
        `OpenConnector action ${input.actionId} returned invalid operation metadata.`
      );
    }
    return null;
  }
  if (parsed.data.actionId !== input.actionId) {
    throw new Error(
      `OpenConnector action ${input.actionId} returned mismatched operation metadata.`
    );
  }
  return parsed.data;
}

async function buildConnectorActionRequestSignature(
  value: unknown
): Promise<string> {
  return await digestCanonicalJson(value);
}
