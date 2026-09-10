import {
  getActiveSpaceWakeProgressResponseSchema,
  getSpaceWakeProgressResponseSchema,
} from "@openmeld/schemas";
import type {
  GetActiveSpaceWakeProgressResponse,
  GetSpaceWakeProgressResponse,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { OpenMeldApiClientInvalidResponseError } from "../errors";
import {
  buildActiveSpaceWakeProgressPath,
  buildSpaceWakeProgressPath,
} from "./routes";
import type { SpaceRequestInput } from "./types";

export async function getSpaceWakeProgress(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    clientMessageId: string;
    includePreviewText?: boolean;
    includeSourceContext?: boolean;
    includeTiming?: boolean;
    includeWaitReason?: boolean;
    includeDeviceWait?: boolean;
    includeWakeStopEligibility?: boolean;
    targetProfileId?: string;
  }
): Promise<GetSpaceWakeProgressResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set("clientMessageId", input.clientMessageId);
  if (input.includePreviewText === true) {
    searchParams.set("includePreviewText", "true");
  }
  if (input.includeSourceContext === true) {
    searchParams.set("includeSourceContext", "true");
  }
  if (input.includeTiming === true) {
    searchParams.set("includeTiming", "true");
  }
  if (input.includeWaitReason === true) {
    searchParams.set("includeWaitReason", "true");
  }
  if (input.includeDeviceWait === true) {
    searchParams.set("includeDeviceWait", "true");
  }
  if (input.includeWakeStopEligibility === true) {
    searchParams.set("includeWakeStopEligibility", "true");
  }
  if (input.targetProfileId) {
    searchParams.set("targetProfileId", input.targetProfileId);
  }

  const query = searchParams.toString();
  return await client.requestJson({
    url: `${buildSpaceWakeProgressPath(input.spaceId)}?${query}`,
    operation: "space.wake_progress",
    method: "GET",
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: getSpaceWakeProgressResponseSchema,
    invalidMessage: "invalid wake progress response",
  });
}

export async function getActiveSpaceWakeProgress(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    includePageInfo?: boolean;
    includePreviewText?: boolean;
    includeSourceContext?: boolean;
    includeTiming?: boolean;
    includeWaitReason?: boolean;
    includeDeviceWait?: boolean;
    includeWakeStopEligibility?: boolean;
    targetProfileId?: string;
    sourceProfileId?: string;
  }
): Promise<GetActiveSpaceWakeProgressResponse> {
  const searchParams = new URLSearchParams();
  if (input.includePageInfo === true) {
    searchParams.set("includePageInfo", "true");
  }
  if (input.includePreviewText === true) {
    searchParams.set("includePreviewText", "true");
  }
  if (input.includeSourceContext === true) {
    searchParams.set("includeSourceContext", "true");
  }
  if (input.includeTiming === true) {
    searchParams.set("includeTiming", "true");
  }
  if (input.includeWaitReason === true) {
    searchParams.set("includeWaitReason", "true");
  }
  if (input.includeDeviceWait === true) {
    searchParams.set("includeDeviceWait", "true");
  }
  if (input.includeWakeStopEligibility === true) {
    searchParams.set("includeWakeStopEligibility", "true");
  }
  if (input.targetProfileId) {
    searchParams.set("targetProfileId", input.targetProfileId);
  }
  if (input.sourceProfileId) {
    searchParams.set("sourceProfileId", input.sourceProfileId);
  }

  const query = searchParams.toString();
  const response = await client.requestJson({
    url: query
      ? `${buildActiveSpaceWakeProgressPath(input.spaceId)}?${query}`
      : buildActiveSpaceWakeProgressPath(input.spaceId),
    operation: "space.active_wake_progress",
    method: "GET",
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: getActiveSpaceWakeProgressResponseSchema,
    invalidMessage: "invalid active wake progress response",
  });

  if (
    input.sourceProfileId &&
    response.query.sourceProfileId !== input.sourceProfileId
  ) {
    throw new OpenMeldApiClientInvalidResponseError({
      message:
        "Active Wake progress did not confirm the requested source profile filter.",
      operation: "space.active_wake_progress",
      status: 200,
      rawBody: JSON.stringify(response),
      schemaIssue: {
        message:
          "The response source profile did not match the requested source profile.",
        path: ["query", "sourceProfileId"],
      },
    });
  }

  if (input.includePageInfo === true && response.pageInfo === undefined) {
    throw new OpenMeldApiClientInvalidResponseError({
      message:
        "Active Wake progress did not confirm the requested page information.",
      operation: "space.active_wake_progress",
      status: 200,
      rawBody: JSON.stringify(response),
      schemaIssue: {
        message: "The response did not include the requested page information.",
        path: ["pageInfo"],
      },
    });
  }

  return response;
}
