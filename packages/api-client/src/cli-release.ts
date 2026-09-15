import { CLI_RELEASE_PATH, cliReleaseSchema } from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "./client";
import { readApiClientJsonResponse } from "./errors";

export async function readCliRelease(client: OpenMeldApiClientFoundation) {
  const response = await client.requestResponse({
    url: CLI_RELEASE_PATH,
    method: "GET",
    operation: "cli.release.read",
  });
  return readApiClientJsonResponse({
    response,
    operation: "cli.release.read",
    schema: cliReleaseSchema,
    invalidMessage: "Invalid CLI release response.",
  });
}
