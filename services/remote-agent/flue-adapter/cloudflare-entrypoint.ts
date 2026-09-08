import {
  remoteAgentWorkerAdmissionRejectedResponseSchema,
  remoteAgentWorkerCancellationRequestSchema,
  remoteAgentWorkerCancellationResponseSchema,
  remoteAgentWorkerExecutionInputQuerySchema,
  remoteAgentWorkerExecutionInputRequestSchema,
  remoteAgentWorkerExecutionInputResponseSchema,
  remoteAgentWorkerExecutionQueryResponseSchema,
  remoteAgentWorkerExecutionQuerySchema,
  remoteAgentWorkerReadUsageDiagnosticsRequestSchema,
  remoteAgentWorkerRuntimeDiagnosticsRequestSchema,
  remoteAgentWorkerRuntimeDiagnosticsResponseSchema,
  remoteAgentWorkerSubmitTurnResponseSchema,
} from "@openmeld/schemas";
import type {
  RemoteAgentWorkerCancellationResponse,
  RemoteAgentWorkerExecutionQueryResponse,
  RemoteAgentWorkerRuntimeDiagnosticsResponse,
  RemoteAgentWorkerSubmitTurnRequest,
  RemoteAgentWorkerSubmitTurnResponse,
} from "@openmeld/schemas/types";
import {
  buildRemoteAgentName,
  parseRemoteAgentSubmitTurnRequest,
  resolveRemoteAgentTurnEnvelopeAdmissionRejection,
} from "../agent-core/submission";

type CenterAgentStub = DurableObjectStub & {
  receiveExecutionInput(input: unknown): Promise<unknown>;
  readExecutionInput(input: unknown): Promise<unknown>;
  cancelExecution(input: unknown): Promise<unknown>;
  readExecutionState(input: unknown): Promise<unknown>;
  reconcileExecution(input: unknown): Promise<unknown>;
  readRuntimeDiagnostics?: (input: { spaceId: string }) => Promise<unknown>;
  readUsageDiagnostics?: (input: {
    organizationId?: string;
    spaceId: string;
  }) => Promise<unknown>;
  submitConversationTurn?: (
    input: RemoteAgentWorkerSubmitTurnRequest
  ) => Promise<unknown>;
};

export type CenterAgentNamespace = {
  get(id: DurableObjectId): CenterAgentStub;
  idFromName(name: string): DurableObjectId;
};

export async function receiveExecutionInputInCenterAgent(input: {
  namespace: CenterAgentNamespace;
  request: unknown;
}) {
  const request = remoteAgentWorkerExecutionInputRequestSchema.parse(
    input.request
  );
  const stub = input.namespace.get(
    input.namespace.idFromName(buildRemoteAgentName(request.target))
  );
  return remoteAgentWorkerExecutionInputResponseSchema.parse(
    await stub.receiveExecutionInput(request)
  );
}

export async function readExecutionInputFromCenterAgent(input: {
  namespace: CenterAgentNamespace;
  request: unknown;
}) {
  const request = remoteAgentWorkerExecutionInputQuerySchema.parse(
    input.request
  );
  const stub = input.namespace.get(
    input.namespace.idFromName(buildRemoteAgentName(request.target))
  );
  return remoteAgentWorkerExecutionInputResponseSchema.parse(
    await stub.readExecutionInput(request)
  );
}

export async function submitConversationTurnToCenterAgent(input: {
  namespace: CenterAgentNamespace;
  request: unknown;
}): Promise<RemoteAgentWorkerSubmitTurnResponse> {
  const request = parseRemoteAgentSubmitTurnRequest(input.request);
  console.info("[remote_agent.admission.received]", {
    dispatchId: request.dispatchId,
    idempotencyKey: request.idempotencyKey,
    organizationId: request.organizationId,
    spaceId: request.spaceId,
  });
  const rejection = resolveRemoteAgentTurnEnvelopeAdmissionRejection({
    agentName: buildRemoteAgentName(request),
    requestContext: request,
  });
  if (rejection) {
    console.warn("[remote_agent.admission.rejected]", {
      dispatchId: request.dispatchId,
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      reasonCode: rejection.reasonCode,
      spaceId: request.spaceId,
    });
    return remoteAgentWorkerAdmissionRejectedResponseSchema.parse({
      idempotencyKey: request.idempotencyKey,
      message: rejection.message,
      outcome: "rejected",
      reasonCode: rejection.reasonCode,
      v: 1,
    });
  }
  const stub = input.namespace.get(
    input.namespace.idFromName(buildRemoteAgentName(request))
  );
  if (typeof stub.submitConversationTurn !== "function") {
    throw new Error(
      "Flue Center Agent Durable Object does not expose submitConversationTurn."
    );
  }
  const ack = await stub.submitConversationTurn(request);
  console.info("[remote_agent.admission.ack_returned]", {
    dispatchId: request.dispatchId,
    idempotencyKey: request.idempotencyKey,
    organizationId: request.organizationId,
    spaceId: request.spaceId,
  });
  return remoteAgentWorkerSubmitTurnResponseSchema.parse(ack);
}

export async function readUsageDiagnosticsFromCenterAgent(input: {
  namespace: CenterAgentNamespace;
  request: unknown;
}): Promise<unknown> {
  const request = remoteAgentWorkerReadUsageDiagnosticsRequestSchema.parse(
    input.request
  );
  const { runtimeConversationId, ...diagnosticsInput } = request;
  const stub = input.namespace.get(
    input.namespace.idFromName(runtimeConversationId)
  );
  if (typeof stub.readUsageDiagnostics !== "function") {
    throw new Error(
      "Flue Center Agent Durable Object does not expose readUsageDiagnostics."
    );
  }
  return await stub.readUsageDiagnostics(diagnosticsInput);
}

export async function readRuntimeDiagnosticsFromCenterAgent(input: {
  namespace: CenterAgentNamespace;
  request: unknown;
}): Promise<RemoteAgentWorkerRuntimeDiagnosticsResponse> {
  const request = remoteAgentWorkerRuntimeDiagnosticsRequestSchema.parse(
    input.request
  );
  const { runtimeConversationId, ...diagnosticsInput } = request;
  const stub = input.namespace.get(
    input.namespace.idFromName(runtimeConversationId)
  );
  if (typeof stub.readRuntimeDiagnostics !== "function") {
    throw new Error(
      "Flue Center Agent Durable Object does not expose readRuntimeDiagnostics."
    );
  }
  return remoteAgentWorkerRuntimeDiagnosticsResponseSchema.parse(
    await stub.readRuntimeDiagnostics(diagnosticsInput)
  );
}

export async function readExecutionStateFromCenterAgent(input: {
  namespace: CenterAgentNamespace;
  request: unknown;
}): Promise<RemoteAgentWorkerExecutionQueryResponse> {
  const request = remoteAgentWorkerExecutionQuerySchema.parse(input.request);
  const stub = input.namespace.get(
    input.namespace.idFromName(request.conversationId ?? request.spaceId)
  );
  return remoteAgentWorkerExecutionQueryResponseSchema.parse(
    await stub.readExecutionState(request)
  );
}

export async function reconcileExecutionInCenterAgent(input: {
  namespace: CenterAgentNamespace;
  request: unknown;
}): Promise<RemoteAgentWorkerExecutionQueryResponse> {
  const request = remoteAgentWorkerExecutionQuerySchema.parse(input.request);
  const stub = input.namespace.get(
    input.namespace.idFromName(request.conversationId ?? request.spaceId)
  );
  return remoteAgentWorkerExecutionQueryResponseSchema.parse(
    await stub.reconcileExecution(request)
  );
}

export async function cancelExecutionInCenterAgent(input: {
  namespace: CenterAgentNamespace;
  request: unknown;
}): Promise<RemoteAgentWorkerCancellationResponse> {
  const request = remoteAgentWorkerCancellationRequestSchema.parse(
    input.request
  );
  const stub = input.namespace.get(
    input.namespace.idFromName(request.conversationId ?? request.spaceId)
  );
  return remoteAgentWorkerCancellationResponseSchema.parse(
    await stub.cancelExecution(request)
  );
}
