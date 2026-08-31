import {
  createSpaceThreadBodySchema,
  createSpaceThreadResponseSchema,
  getSpaceThreadResponseSchema,
  listSpaceThreadEventsResponseSchema,
  listSpaceThreadSignalsQuerySchema,
  listSpaceThreadSignalsResponseSchema,
  listSpaceThreadsResponseSchema,
  postSpaceThreadSignalBodySchema,
  postSpaceThreadSignalResponseSchema,
  toCompatibleSpaceAddressingRequestWireValue,
} from "@openmeld/schemas";
import type {
  CreateSpaceThreadBody,
  CreateSpaceThreadResponse,
  GetSpaceThreadResponse,
  ListSpaceThreadEventsResponse,
  ListSpaceThreadSignalsResponse,
  ListSpaceThreadsResponse,
  PostSpaceThreadSignalBody,
  PostSpaceThreadSignalResponse,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { currentSpaceAddressingHeaders } from "./addressing-contract";
import {
  buildSpaceThreadEventsPath,
  buildSpaceThreadPath,
  buildSpaceThreadSignalsPath,
  buildSpaceThreadsPath,
} from "./routes";
import type { SpaceRequestInput } from "./types";

export async function createSpaceThread(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & CreateSpaceThreadBody
): Promise<CreateSpaceThreadResponse> {
  const body = {
    rootSignalId: input.rootSignalId,
    clientMutationId: input.clientMutationId,
  };
  const parsedBody = createSpaceThreadBodySchema.safeParse(body);
  if (!parsedBody.success) {
    throw new Error(
      parsedBody.error.issues[0]?.message ?? "Invalid thread request"
    );
  }
  return await client.requestJson({
    url: buildSpaceThreadsPath(input.spaceId),
    operation: "space.thread.create",
    method: "POST",
    headers: currentSpaceAddressingHeaders("application/json"),
    body: JSON.stringify(parsedBody.data),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: createSpaceThreadResponseSchema,
    invalidMessage: "invalid thread create response",
  });
}

export async function listSpaceThreads(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput
): Promise<ListSpaceThreadsResponse> {
  return await client.requestJson({
    url: buildSpaceThreadsPath(input.spaceId),
    operation: "space.thread.list",
    method: "GET",
    headers: currentSpaceAddressingHeaders(),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: listSpaceThreadsResponseSchema,
    invalidMessage: "invalid thread list response",
  });
}

export async function getSpaceThread(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & { threadId: string }
): Promise<GetSpaceThreadResponse> {
  return await client.requestJson({
    url: buildSpaceThreadPath(input.spaceId, input.threadId),
    operation: "space.thread.get",
    method: "GET",
    headers: currentSpaceAddressingHeaders(),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: getSpaceThreadResponseSchema,
    invalidMessage: "invalid thread detail response",
  });
}

export async function listSpaceThreadEvents(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & { threadId: string }
): Promise<ListSpaceThreadEventsResponse> {
  return await client.requestJson({
    url: buildSpaceThreadEventsPath(input.spaceId, input.threadId),
    operation: "space.thread.events",
    method: "GET",
    headers: currentSpaceAddressingHeaders(),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: listSpaceThreadEventsResponseSchema,
    invalidMessage: "invalid thread events response",
  });
}

export async function listSpaceThreadSignals(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    afterSignalId?: string;
    limit?: number;
    threadId: string;
  }
): Promise<ListSpaceThreadSignalsResponse> {
  const parsedQuery = listSpaceThreadSignalsQuerySchema.safeParse({
    afterSignalId: input.afterSignalId,
    limit: input.limit,
  });
  if (!parsedQuery.success) {
    throw new Error(
      parsedQuery.error.issues[0]?.message ??
        "Invalid bounded thread signals query"
    );
  }
  const hasBoundedQuery = parsedQuery.data.afterSignalId !== undefined;
  return await client.requestJson({
    url: buildSpaceThreadSignalsPath(
      input.spaceId,
      input.threadId,
      hasBoundedQuery
        ? {
            afterSignalId: parsedQuery.data.afterSignalId as string,
            limit: parsedQuery.data.limit as number,
          }
        : undefined
    ),
    operation: "space.thread.signals",
    method: "GET",
    headers: currentSpaceAddressingHeaders(),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: listSpaceThreadSignalsResponseSchema,
    invalidMessage: "invalid thread signals response",
  });
}

export async function postSpaceThreadSignal(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    threadId: string;
    body: PostSpaceThreadSignalBody;
  }
): Promise<PostSpaceThreadSignalResponse> {
  const parsedBody = postSpaceThreadSignalBodySchema.safeParse(input.body);
  if (!parsedBody.success) {
    throw new Error(
      parsedBody.error.issues[0]?.message ?? "Invalid thread message"
    );
  }
  return await client.requestJson({
    url: buildSpaceThreadSignalsPath(input.spaceId, input.threadId),
    operation: "space.thread.send",
    method: "POST",
    headers: currentSpaceAddressingHeaders("application/json"),
    body: JSON.stringify(
      toCompatibleSpaceAddressingRequestWireValue(parsedBody.data)
    ),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: postSpaceThreadSignalResponseSchema,
    invalidMessage: "invalid thread message response",
  });
}
