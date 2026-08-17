import { changelogQueryResponseSchema } from "@openmeld/schemas";
import type { ChangelogQuery } from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildChangelogPath } from "./routes";
import type { CreateChangelogApi } from "./types";

export const createChangelogApi: CreateChangelogApi = (
  client: OpenMeldApiClientFoundation
) => ({
  readChangelog: (query) => readChangelog(client, query),
});

export async function readChangelog(
  client: OpenMeldApiClientFoundation,
  query: ChangelogQuery = {}
) {
  return await client.requestJson({
    url: buildChangelogPath(query),
    operation: "changelog.read",
    method: "GET",
    schema: changelogQueryResponseSchema,
    invalidMessage: "invalid Changelog response",
  });
}
