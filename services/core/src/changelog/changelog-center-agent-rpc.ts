import {
  centerAgentReadChangelogToolRpcInputSchema,
  changelogQueryResponseSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentReadChangelogToolRpcInput,
  ChangelogQueryResponse,
} from "@openmeld/schemas/types";
import { prepareCenterAgentOrganizationMemberRequest } from "../center-agent/application/anonymous-member-request";
import type { CoreBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  ChangelogSourceError,
  createChangelogService,
} from "./changelog-service";

const changelogService = createChangelogService();

export async function rpcCenterAgentReadChangelog(
  env: CoreBindings,
  input: CenterAgentReadChangelogToolRpcInput
): Promise<ChangelogQueryResponse> {
  const parsed = centerAgentReadChangelogToolRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Center Agent Changelog request is invalid.",
      status: 400,
    });
  }

  const { context, speakerMember, ...query } = parsed.data;
  await prepareCenterAgentOrganizationMemberRequest(
    env,
    context,
    speakerMember
  );

  try {
    return changelogQueryResponseSchema.parse(
      await changelogService.query({
        githubToken: env.GITHUB_OPENMELD_API_TOKEN,
        query,
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
