import { spaceFileUpdateSettingsSchema } from "@openmeld/schemas";
import type {
  SpaceFileUpdateSettings,
  SpaceFileUpdateSettingsCommand,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import type { SpaceRequestInput } from "./types";

export async function spaceFileUpdateSettings(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    fileId: string;
    command: SpaceFileUpdateSettingsCommand;
  }
): Promise<SpaceFileUpdateSettings> {
  const read = input.command.action === "read";
  return await client.requestJson({
    url: `/v1/spaces/${encodeURIComponent(input.spaceId)}/files/${encodeURIComponent(input.fileId)}/update-settings`,
    method: read ? "GET" : "PATCH",
    operation: "space.files.update-settings",
    headers: { "content-type": "application/json" },
    ...(read ? {} : { body: JSON.stringify(input.command) }),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: spaceFileUpdateSettingsSchema,
    invalidMessage: "Invalid file update settings response",
  });
}
