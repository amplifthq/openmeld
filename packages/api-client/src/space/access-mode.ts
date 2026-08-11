import {
  setSpaceAccessModeBodySchema,
  spaceAccessModeStateSchema,
} from "@openmeld/schemas";
import type { SpaceAccessModeState } from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildSpaceAccessModePath } from "./routes";
import type { SetSpaceAccessModeInput } from "./types";

export async function setSpaceAccessMode(
  client: OpenMeldApiClientFoundation,
  input: SetSpaceAccessModeInput
): Promise<SpaceAccessModeState> {
  const parsedBody = setSpaceAccessModeBodySchema.safeParse({
    accessMode: input.accessMode,
    ...(input.password === undefined ? {} : { password: input.password }),
  });

  if (!parsedBody.success) {
    throw new Error(
      parsedBody.error.issues[0]?.message ??
        "invalid space access mode request body"
    );
  }

  return await client.requestJson({
    url: buildSpaceAccessModePath(input.spaceId),
    operation: "space.access_mode.set",
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(parsedBody.data),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    schema: spaceAccessModeStateSchema,
    invalidMessage: "invalid space access mode response",
  });
}
