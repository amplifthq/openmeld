import { centerAgentReadChangelogToolRpcInputSchema } from "@openmeld/schemas";
import type {
  CenterAgentReadChangelogToolRpcInput,
  ChangelogQueryResponse,
} from "@openmeld/schemas/types";
import { prepareCenterAgentOrganizationMemberRequest } from "../center-agent/application/anonymous-member-request";
import type { CoreBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import { rpcReadChangelog } from "./changelog-read-rpc";

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

  return await rpcReadChangelog(env, query);
}
