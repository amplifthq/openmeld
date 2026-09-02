import {
  getActiveSpaceWakeProgressResponseSchema,
  getSpaceWakeProgressResponseSchema,
} from "@openmeld/schemas";
import type {
  GetActiveSpaceWakeProgressResponse,
  GetSpaceWakeProgressResponse,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import {
  buildActiveSpaceWakeProgressPath,
  buildSpaceWakeProgressPath,
} from "./routes";
import type { SpaceRequestInput } from "./types";

export async function getSpaceWakeProgress(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    clientMessageId: string;
    includeTiming?: boolean;
    includeWaitReason?: boolean;
    includeWakeStopEligibility?: boolean;
    targetProfileId?: string;
  }
): Promise<GetSpaceWakeProgressResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set("clientMessageId", input.clientMessageId);
  if (input.includeTiming === true) {
    searchParams.set("includeTiming", "true");
  }
  if (input.includeWaitReason === true) {
    searchParams.set("includeWaitReason", "true");
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
    includeTiming?: boolean;
    includeWaitReason?: boolean;
    includeWakeStopEligibility?: boolean;
    targetProfileId?: string;
  }
): Promise<GetActiveSpaceWakeProgressResponse> {
  const searchParams = new URLSearchParams();
  if (input.includeTiming === true) {
    searchParams.set("includeTiming", "true");
  }
  if (input.includeWaitReason === true) {
    searchParams.set("includeWaitReason", "true");
  }
  if (input.includeWakeStopEligibility === true) {
    searchParams.set("includeWakeStopEligibility", "true");
  }
  if (input.targetProfileId) {
    searchParams.set("targetProfileId", input.targetProfileId);
  }

  const query = searchParams.toString();
  return await client.requestJson({
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
}
