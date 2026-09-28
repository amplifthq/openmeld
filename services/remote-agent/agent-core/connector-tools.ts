import {
  CENTER_AGENT_APP_CONNECTOR_SERVICES,
  CENTER_AGENT_OPENMELD_IDENTITY_REQUIRED_CODE,
  centerAgentConnectorConnectionSelectionSchema,
  centerAgentReadConnectorActionOperationResponseSchema,
  centerAgentRecordConnectorActionOperationResponseSchema,
  isLinearIssueCreateAction,
} from "@openmeld/schemas";
import type {
  ConnectorService,
  OpenConnectorRuntimeAction,
  RemoteAgentTurnEnvelope,
} from "@openmeld/schemas/types";
import { digestCanonicalJson } from "@openmeld/utils";
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
import type { ConnectorExecutionConfig } from "../connectors/open-connector-runtime";
import {
  listOpenConnectorActions,
  OpenConnectorActionError,
  type OpenConnectorActionRun,
  OpenConnectorOperationPendingError,
  requireOpenConnectorAction,
  runOpenConnectorAction,
  searchOpenConnectorActions,
} from "../connectors/open-connector-runtime";
import type {
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "./callback-context";
import { recordRemoteAgentNavigationTarget } from "./callback-context";
import {
  type CenterAgentAppConnectorService,
  getConnectedAppDisplayName,
} from "./connector-service-presentation";
import { callCoreRpc, requireCoreRpc } from "./core-rpc";
import {
  resolveRemoteAgentDestructiveAuthorization,
  resolveRemoteAgentRoutineDestructiveActionBlock,
  resolveRemoteAgentRoutineExternalWriteBlock,
} from "./destructive-authorization";
import {
  readLinearIssueDestination,
  requireProjectIssueActionDestination,
} from "./project-issue-routing";
import { tagRemoteAgentResultSources } from "./result-access";
import { attachCreatedLinearIssueToSourceTask } from "./space-task-linear-binding";
import {
  buildRemoteAgentToolContext,
  resolveOrganizationMemberTurnEnvelopeSpeaker,
  resolveVerifiedTurnEnvelopeSpeaker,
} from "./tool-context";
import type { RemoteAgentToolDefinition } from "./tool-definition";

const GITHUB_DEDICATED_ACTION_INSTRUCTION =
  "This Plugins list never reports GitHub access. For a GitHub request, call the matching github_* tool; it will verify the requested Organization or member GitHub connection.";
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
  connectorExecution?: ConnectorExecutionConfig;
  coreWorker: RemoteAgentCoreWorkerBinding;
  storage: RemoteAgentStorage;
  submissionId: string;
};
type ConnectorActionOperationRequest = {
  actionId: string;
  connectionPreference?: "requester" | "shared";
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
  connectionPreference: optional(picklist(["requester", "shared"])),
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
        "List the non-GitHub Plugins available to this Agent for the current requester, subject to each account's Agent access settings. Verified member requests can use their own connection; personal Remote Agents can use a personal connection only for their owner's request. Shared connections follow Organization access. Connected Message Channel members use shared access only. Routines use their verified delegated member identity.",
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
        const connection = await requireAvailableConnectorConnection({
          storage: input.storage,
          submissionId: input.submissionId,
          connectionPreference: requester.connectionPreference,
          coreWorker: input.coreWorker,
          requesterUserId: requester.requesterUserId,
          service: request.service,
          toolContext,
        });
        return await listConnectorActionCatalog({
          ...request,
          connectorExecution: input.connectorExecution,
          readOnly: connection.permission === "read",
        });
      },
    },
    {
      name: "openmeld_execute_app_action",
      description:
        "Execute one exact action previously discovered with openmeld_list_app_actions. This can read or change provider data, so use the action description, effect, and input schema literally. The discovered action's effect declares whether this call is a read, ordinary external write, or destructive external write. A successful execution returns provider data and the action catalog's outputSchema; interpret the data through that schema, and use a declared aggregate or estimate field instead of counting one returned page. An interactive destructive action requires linked OpenMeld identity and returns an exact action preview and token. If the verified user already authorized that action and target, use the token with unchanged input now; otherwise ask first. Routines do not currently support destructive actions and receive routine_destructive_action_unsupported with zero side effects. Choose a stable operationId and reuse it when retrying this exact action. Set connectionPreference to requester or shared when the user explicitly chooses their own or the Organization account; do not substitute another account. A connection continuation may pin the exact account on the server. OpenMeld attributes and durably records every execution. GitHub uses its dedicated github_* tools instead.",
      input: executeAppActionInputSchema,
      execute: (payload) =>
        executeAppAction({
          dependencies: input,
          request: payload as ExecuteAppActionRequest,
        }),
    },
  ];
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This action owner must compose the existing identity, routine, connection, confirmation, and operation-claim checks in one ordered flow.
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
    readDeclaredConnectorActionEffect(policyAction) !== "read"
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
  assertOperationIdentityPreference(
    existingOperation,
    input.request.connectionPreference
  );
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
  let issueResolution: Awaited<
    ReturnType<typeof requireProjectIssueActionDestination>
  > | null = null;
  if (routineAction && requiresHighRiskConnectorActionPolicy(routineAction)) {
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
    issueResolution = await resolveNewLinearIssueRouting({
      action: executionAction,
      dependencies: input.dependencies,
      request: input.request,
      toolContext,
    });
    if (requiresHighRiskConnectorActionPolicy(executionAction)) {
      const requester = resolveConnectorTurnRequester(
        toolContext.turnEnvelope,
        input.request.connectionPreference
      );
      confirmedSelection = await requireAvailableConnectorConnection({
        storage: input.dependencies.storage,
        submissionId: input.dependencies.submissionId,
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
    effect: resolveActionEffect(executionAction),
    toolContext,
  });
  const run = await runAndFinalizeConnectorAction({
    ...input,
    ...operation,
    toolContext,
  });
  const spaceTask = await attachLinearIssueSpaceTaskBestEffort({
    dependencies: input.dependencies,
    issueResolution,
    request: input.request,
    resultData: run.data,
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
  return tagRemoteAgentResultSources(
    {
      actionId: input.request.actionId,
      attribution,
      data: run.data,
      operationId: input.request.operationId,
      outputSchema: executionAction?.outputSchema,
      providerExecutionId: run.providerExecutionId,
      replayed: operation.coreOperationReplayed,
      ...(spaceTask ? { spaceTask } : {}),
    },
    [
      {
        kind: "plugin_connection",
        service: input.request.service,
        connectionName: operation.connectionName,
        connectionUpdatedAtMs: operation.selection?.connection.updatedAtMs,
      },
    ]
  );
}

async function resolveNewLinearIssueRouting(input: {
  action: OpenConnectorRuntimeAction;
  dependencies: ConnectorToolDependencies;
  request: ExecuteAppActionRequest;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}) {
  const destination = readLinearIssueDestination({
    actionId: input.action.id,
    actionInput: input.request.input,
    service: input.request.service,
  });
  if (!destination) {
    return null;
  }
  return await requireProjectIssueActionDestination({
    coreWorker: input.dependencies.coreWorker,
    destination,
    toolContext: input.toolContext,
  });
}

async function attachLinearIssueSpaceTaskBestEffort(input: {
  dependencies: ConnectorToolDependencies;
  issueResolution: Awaited<
    ReturnType<typeof requireProjectIssueActionDestination>
  > | null;
  request: ExecuteAppActionRequest;
  resultData: unknown;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}) {
  if (
    input.request.service !== "linear" ||
    !isLinearIssueCreateAction(input.request.actionId)
  ) {
    return null;
  }
  try {
    return await attachCreatedLinearIssueToSourceTask({
      actionInput: input.request.input,
      coreWorker: input.dependencies.coreWorker,
      data: input.resultData,
      projectId: input.issueResolution?.projectId ?? null,
      toolContext: input.toolContext,
    });
  } catch (error) {
    return {
      linked: false,
      reason: `Linear created the issue, but Task linking failed: ${error instanceof Error ? error.message : String(error)}. Retry only the association.`,
      task: null,
    };
  }
}

function assertOperationIdentityPreference(
  operation: Awaited<ReturnType<typeof readConnectorActionOperation>>,
  preference: ExecuteAppActionRequest["connectionPreference"]
) {
  if (!(operation && preference)) {
    return;
  }
  const expected = preference === "requester" ? "member" : "shared";
  if (operation.executionConnection?.scope !== expected) {
    throw new Error(
      "plugin.operation_identity_mismatch: An existing operation must retain its original account; it cannot be replayed as another identity."
    );
  }
}

export async function requireMemberResearchReadOnlyConnectorAction(input: {
  action?: OpenConnectorRuntimeAction;
  actionId: string;
  connectorExecution?: ConnectorExecutionConfig;
  service: ConnectorService;
  toolContext: Awaited<ReturnType<typeof buildRemoteAgentToolContext>>;
}): Promise<void> {
  if (input.toolContext.turnEnvelope?.trigger.source !== "member_research") {
    return;
  }
  const action = input.action ?? (await requireOpenConnectorAction(input));
  if (readDeclaredConnectorActionEffect(action) !== "read") {
    throw new Error(
      "Member research can only execute connected App actions declared read."
    );
  }
}

export async function resolveConnectedMessageChannelActionPolicy(input: {
  action?: OpenConnectorRuntimeAction;
  actionId: string;
  connectorExecution?: ConnectorExecutionConfig;
  service: ConnectorService;
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
  const action = input.action ?? (await requireOpenConnectorAction(input));
  const effect = readDeclaredConnectorActionEffect(action);
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
  effect: "read" | "write" | "destructive" | "unspecified";
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
        input.toolContext.turnEnvelope,
        input.request.connectionPreference
      );
      selection = await requireAvailableConnectorConnection({
        storage: input.dependencies.storage,
        submissionId: input.dependencies.submissionId,
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
    effect: input.effect,
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

export function requiresHighRiskConnectorActionPolicy(
  action: OpenConnectorRuntimeAction
): boolean {
  // An omitted effect is missing safety evidence, not evidence that the action
  // is safe. Keep it behind the same policy boundary as destructive actions.
  return action.effect === "destructive" || action.effect === undefined;
}

function resolveActionEffect(action: OpenConnectorRuntimeAction | undefined) {
  return action?.effect ?? ("unspecified" as const);
}

function readDeclaredConnectorActionEffect(
  action: OpenConnectorRuntimeAction
): OpenConnectorRuntimeAction["effect"] {
  return action.effect;
}

function toModelVisibleAction(action: OpenConnectorRuntimeAction) {
  return {
    description: action.description,
    effect: readDeclaredConnectorActionEffect(action) ?? "unspecified",
    id: action.id,
    inputSchema: action.inputSchema,
    name: action.name,
    outputSchema: action.outputSchema,
    requiredScopes: action.requiredScopes,
  };
}

// Identity/permission resolution stays with the caller; every connector uses
// the same executable runtime catalog, schemas, filtering, and pagination.
export async function listConnectorActionCatalog(input: {
  connectorExecution?: ConnectorExecutionConfig;
  limit?: number;
  offset?: number;
  query?: string;
  readOnly: boolean;
  service: ConnectorService;
}) {
  const catalog = await listOpenConnectorActions(input);
  const actions = input.readOnly
    ? catalog.filter((action) => action.effect === "read")
    : catalog;
  const query = input.query?.trim();
  const matchingActions = query
    ? await searchOpenConnectorActions({ ...input, actions, query })
    : actions;
  const offset = input.offset ?? 0;
  const visibleActions =
    input.limit === undefined
      ? matchingActions.slice(offset)
      : matchingActions.slice(offset, offset + input.limit);
  const hasMore = offset + visibleActions.length < matchingActions.length;
  return {
    actions: visibleActions.map(toModelVisibleAction),
    availableCount: actions.length,
    hasMore,
    matchingCount: matchingActions.length,
    nextOffset: hasMore ? offset + visibleActions.length : null,
    offset,
    service: input.service,
  };
}

async function resolveConnectorConnection(input: {
  connectionPreference: "automatic" | "requester" | "shared";
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
      includeAccessPolicy: true,
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
  input: Parameters<typeof resolveConnectorConnection>[0] &
    Pick<ConnectorToolDependencies, "storage" | "submissionId">
) {
  const selection = await resolveConnectorConnection(input);
  if (!(selection.connection && selection.selection)) {
    if (input.toolContext.turnEnvelope?.organization.webUrl) {
      await recordRemoteAgentNavigationTarget({
        storage: input.storage,
        submissionId: input.submissionId,
        target: {
          kind: "plugin_connection",
          service: input.service,
          scope: input.connectionPreference === "shared" ? "shared" : "choose",
        },
      });
    }
    throw new Error(
      `${getConnectedAppDisplayName(input.service as CenterAgentAppConnectorService)} is not available for this request. Review the account and Agent access using the Plugin connection action, or open Plugins. An unavailable selection does not prove the account is disconnected; reconnecting cannot override denied Agent or provider permissions.`
    );
  }
  return {
    connection: selection.connection,
    permission: selection.permission,
    selection: selection.selection,
  };
}

function resolveConnectorTurnRequester(
  turnEnvelope: RemoteAgentTurnEnvelope | undefined,
  requested?: "requester" | "shared"
): {
  connectionPreference: "automatic" | "requester" | "shared";
  requesterUserId: string | null;
} {
  if (turnEnvelope?.trigger.source === "member_research") {
    if (requested === "requester") {
      throw new Error("plugin.requester_identity_unavailable");
    }
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
      connectionPreference: requested ?? "automatic",
      requesterUserId: speaker.userId,
    };
  }
  if (speaker) {
    return {
      connectionPreference: requested ?? "automatic",
      requesterUserId: speaker.userId,
    };
  }
  const organizationMemberSpeaker =
    resolveOrganizationMemberTurnEnvelopeSpeaker(turnEnvelope);
  if (organizationMemberSpeaker && "kind" in organizationMemberSpeaker) {
    if (requested === "requester") {
      throw new Error("plugin.requester_identity_unavailable");
    }
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
  effect?: "read" | "write" | "destructive" | "unspecified";
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
        effect: input.effect,
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

async function buildConnectorActionRequestSignature(
  value: unknown
): Promise<string> {
  return await digestCanonicalJson(value);
}
