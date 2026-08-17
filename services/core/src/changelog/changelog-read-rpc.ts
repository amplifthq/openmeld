import {
  changelogQueryResponseSchema,
  changelogQuerySchema,
} from "@openmeld/schemas";
import type {
  ChangelogQuery,
  ChangelogQueryResponse,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  ChangelogSourceError,
  createChangelogService,
} from "./changelog-service";

const changelogService = createChangelogService();

export async function rpcReadChangelog(
  env: CoreBindings,
  input: ChangelogQuery
): Promise<ChangelogQueryResponse> {
  const query = changelogQuerySchema.safeParse(input);
  if (!query.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Changelog query is invalid.",
      status: 400,
    });
  }

  try {
    return changelogQueryResponseSchema.parse(
      await changelogService.query({
        githubToken: env.GITHUB_OPENMELD_API_TOKEN,
        query: query.data,
      })
    );
  } catch (error) {
    console.error("[core.changelog.read_failed]", {
      error: error instanceof Error ? error.message : String(error),
      sourceError: error instanceof ChangelogSourceError,
    });
    throw createCoreRpcHttpError({
      code: "changelog.source_unavailable",
      reason: "The official OpenMeld Changelog is temporarily unavailable.",
      status: 503,
    });
  }
}
