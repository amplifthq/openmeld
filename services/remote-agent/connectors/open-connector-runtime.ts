import {
  openConnectorRuntimeActionListSchema,
  openConnectorRuntimeActionOperationMetaSchema,
  openConnectorRuntimeActionSearchResultListSchema,
  openConnectorRuntimeActionSuccessEnvelopeSchema,
} from "@openmeld/schemas";
import type {
  ConnectorService,
  OpenConnectorRuntimeAction,
} from "@openmeld/schemas/types";
export type ConnectorExecutionConfig = {
  baseUrl?: string;
  fetch?: typeof fetch;
  runtimeToken?: string;
};
const TRAILING_SLASH_PATTERN = /\/+$/u;
const OPENCONNECTOR_ACTION_SEARCH_LIMIT = 50;
export async function listOpenConnectorActions(input: {
  connectorExecution?: ConnectorExecutionConfig;
  service: ConnectorService;
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

export async function searchOpenConnectorActions(input: {
  actions: OpenConnectorRuntimeAction[];
  connectorExecution?: ConnectorExecutionConfig;
  query: string;
  service: ConnectorService;
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

export async function requireOpenConnectorAction(input: {
  actionId: string;
  connectorExecution?: ConnectorExecutionConfig;
  service: ConnectorService;
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

export async function runOpenConnectorAction(input: {
  actionId: string;
  connectorExecution?: ConnectorExecutionConfig;
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

function requireConnectorRuntime(input: ConnectorExecutionConfig | undefined): {
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

export class OpenConnectorActionError extends Error {
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

export class OpenConnectorOperationPendingError extends Error {
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

export type OpenConnectorActionRun = {
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
