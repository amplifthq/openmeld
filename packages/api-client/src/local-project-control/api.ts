import {
  localProjectControlConnectCandidateRequestSchema,
  localProjectControlConnectDeclaredPathRequestSchema,
  localProjectControlConnectOutcomeSchema,
  localProjectControlDiscoverProjectsRequestSchema,
  localProjectControlDiscoverProjectsResponseSchema,
  localProjectControlRemoveConnectionRequestSchema,
  localProjectControlRemoveConnectionResponseSchema,
  localProjectControlRemoveMissingConnectionsRequestSchema,
  localProjectControlRemoveMissingConnectionsResponseSchema,
  localProjectControlSetDefaultConnectionRequestSchema,
  localProjectControlSetDefaultConnectionResponseSchema,
  peopleComputerTargetSchema,
} from "@openmeld/schemas";
import { buildLocalProjectControlPath } from "./routes";
import type {
  CreateLocalProjectControlApi,
  LocalProjectControlRequestInput,
} from "./types";

export const createLocalProjectControlApi: CreateLocalProjectControlApi = (
  client
) => ({
  discoverPeopleComputerProjects: async (input) => {
    const target = requireValidInput(peopleComputerTargetSchema, {
      deviceId: input.deviceId,
      runtimeLane: input.runtimeLane,
    });
    const {
      deviceId: _deviceId,
      runtimeLane: _runtimeLane,
      ...request
    } = input;
    const body = requireValidInput(
      localProjectControlDiscoverProjectsRequestSchema,
      requestBody(request)
    );
    return await client.requestJson({
      ...requestOptions(input),
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      operation: "people-computer.projects.discover",
      schema: localProjectControlDiscoverProjectsResponseSchema,
      invalidMessage: "Invalid local Project discovery response.",
      url: `/v1/people-computers/${encodeURIComponent(target.deviceId)}/lanes/${encodeURIComponent(target.runtimeLane)}/projects/discover`,
    });
  },
  discoverProjects: async (input) =>
    await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(
        requireValidInput(
          localProjectControlDiscoverProjectsRequestSchema,
          requestBody(input)
        )
      ),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid local Project discovery response",
      method: "POST",
      operation: "local-project-control.discover",
      schema: localProjectControlDiscoverProjectsResponseSchema,
      url: buildLocalProjectControlPath("discover"),
    }),
  connectCandidate: async (input) =>
    await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(
        requireValidInput(
          localProjectControlConnectCandidateRequestSchema,
          requestBody(input)
        )
      ),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid local Project candidate connection response",
      method: "POST",
      operation: "local-project-control.connect-candidate",
      schema: localProjectControlConnectOutcomeSchema,
      url: buildLocalProjectControlPath("connect-candidate"),
    }),
  connectDeclaredPath: async (input) =>
    await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(
        requireValidInput(
          localProjectControlConnectDeclaredPathRequestSchema,
          requestBody(input)
        )
      ),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid local Project folder connection response",
      method: "POST",
      operation: "local-project-control.connect-declared-path",
      schema: localProjectControlConnectOutcomeSchema,
      url: buildLocalProjectControlPath("connect-declared-path"),
    }),
  setDefaultConnection: async (input) =>
    await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(
        requireValidInput(
          localProjectControlSetDefaultConnectionRequestSchema,
          requestBody(input)
        )
      ),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid default local Project connection response",
      method: "POST",
      operation: "local-project-control.set-default",
      schema: localProjectControlSetDefaultConnectionResponseSchema,
      url: buildLocalProjectControlPath("connections/set-default"),
    }),
  removeConnection: async (input) =>
    await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(
        requireValidInput(
          localProjectControlRemoveConnectionRequestSchema,
          requestBody(input)
        )
      ),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid local Project connection removal response",
      method: "POST",
      operation: "local-project-control.remove",
      schema: localProjectControlRemoveConnectionResponseSchema,
      url: buildLocalProjectControlPath("connections/remove"),
    }),
  removeMissingConnections: async (input) =>
    await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(
        requireValidInput(
          localProjectControlRemoveMissingConnectionsRequestSchema,
          requestBody(input)
        )
      ),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid missing local Project connections response",
      method: "POST",
      operation: "local-project-control.remove-missing",
      schema: localProjectControlRemoveMissingConnectionsResponseSchema,
      url: buildLocalProjectControlPath("connections/remove-missing"),
    }),
});

function requestOptions(input: LocalProjectControlRequestInput): {
  requestContext?: LocalProjectControlRequestInput["requestContext"];
  signal?: AbortSignal;
  timeoutMs?: number;
} {
  return {
    ...(input.requestContext === undefined
      ? {}
      : { requestContext: input.requestContext }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  };
}

function requestBody<TInput extends LocalProjectControlRequestInput>(
  input: TInput
): Omit<TInput, keyof LocalProjectControlRequestInput> {
  const {
    requestContext: _requestContext,
    signal: _signal,
    timeoutMs: _timeoutMs,
    ...body
  } = input;
  return body;
}

function requireValidInput<T>(
  schema: {
    safeParse(
      value: unknown
    ):
      | { data: T; success: true }
      | { error: { issues: Array<{ message: string }> }; success: false };
  },
  value: unknown
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Local Project control request is invalid. ${parsed.error.issues[0]?.message ?? "Invalid input."}`
    );
  }
  return parsed.data;
}
