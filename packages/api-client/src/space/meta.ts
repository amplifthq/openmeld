import {
  patchSpaceMetaBodySchema,
  patchSpaceMetaResponseSchema,
} from "@openmeld/schemas";
import type { SpaceMeta } from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildSpaceMetaPath } from "./routes";
import type { UpdateSpaceMetaInput } from "./types";

export async function updateSpaceMeta(
  client: OpenMeldApiClientFoundation,
  input: UpdateSpaceMetaInput
): Promise<SpaceMeta> {
  const parsedBody = patchSpaceMetaBodySchema.safeParse({
    ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    ...(input.guide === undefined ? {} : { guide: input.guide }),
  });

  if (!parsedBody.success) {
    throw new Error(
      parsedBody.error.issues[0]?.message ??
        "invalid Space metadata request body"
    );
  }

  return await client.requestJson({
    url: buildSpaceMetaPath(input.spaceId),
    operation: "space.meta.update",
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(parsedBody.data),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: patchSpaceMetaResponseSchema,
    invalidMessage: "invalid Space metadata response",
  });
}
