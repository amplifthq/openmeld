import {
  createSpaceBodySchema,
  createSpaceResponseSchema,
} from "@openmeld/schemas";
import type { CreateSpaceResponse } from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { currentSpaceAccessHeaders } from "./access-version";
import { buildCreateSpacePath } from "./routes";
import type { CreateSpaceInput } from "./types";

export async function createSpace(
  client: OpenMeldApiClientFoundation,
  input: CreateSpaceInput
): Promise<CreateSpaceResponse> {
  const body = buildCreateSpaceBody(input);
  const parsedBody = createSpaceBodySchema.safeParse(body);

  if (!parsedBody.success) {
    throw new Error(
      parsedBody.error.issues[0]?.message ?? "invalid create space request body"
    );
  }

  return await client.requestJson({
    url: buildCreateSpacePath(),
    operation: "space.create",
    method: "POST",
    headers: {
      ...currentSpaceAccessHeaders(),
      "content-type": "application/json",
    },
    body: JSON.stringify(parsedBody.data),
    requestContext: input.requestContext,
    schema: createSpaceResponseSchema,
    invalidMessage: "invalid create space response",
  });
}

function buildCreateSpaceBody(
  input: CreateSpaceInput
): Record<string, unknown> {
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    ...(input.guide === undefined ? {} : { guide: input.guide }),
    ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
    ...(input.accessMode === undefined ? {} : { accessMode: input.accessMode }),
    ...(input.password === undefined ? {} : { password: input.password }),
  };
}
