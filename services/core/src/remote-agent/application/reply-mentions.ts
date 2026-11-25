import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  remoteAgentResolveReplyMentionsRequestSchema,
  remoteAgentResolveReplyMentionsResponseSchema,
} from "@openmeld/schemas";
import { readResolvedOrganizationSpaceMember } from "../../center-agent/center-agent-repository";
import type { CoreBindings } from "../../lib/bindings";
import { createCoreRpcHttpError } from "../../rpc/errors";
import { rpcGetSpaceMemberDirectory } from "../../rpc/methods";
import { resolveSpaceHumanMentionTargets } from "../../space/application/human-mention-targets";
import { SpaceSignalAuthoringError } from "../../space/application/space-signal-service";
import { prepareRemoteAgentExecutionAccess } from "./remote-agent-execution-access";

export async function resolveRemoteAgentReplyMentions(
  env: CoreBindings,
  value: unknown
) {
  const { context, mentionProfileIds } =
    remoteAgentResolveReplyMentionsRequestSchema.parse(value);
  const submissionId = context.agentControllerConversationId;
  if (!submissionId) {
    throw new Error(
      "An admitted execution is required to prepare reply mentions."
    );
  }
  const { delivery } = await prepareRemoteAgentExecutionAccess(env, {
    context,
    submissionId,
    effect: "read",
  });
  if (delivery.conversationKind !== "space") {
    throw createCoreRpcHttpError({
      status: 400,
      code: "space.addressing.target_invalid",
      reason: "Human Mentions require a Space destination.",
    });
  }
  const db = getPostgresDatabase(env);
  if (!db) {
    throw new Error("Mention identity store is unavailable.");
  }
  const directory = await rpcGetSpaceMemberDirectory(env, {
    context,
    spaceId: delivery.spaceId,
  });
  const targets = await resolveSpaceHumanMentionTargets({
    profileIds: mentionProfileIds,
    readSpaceMember: (id) => {
      const member = directory.members.find((entry) => entry.profileId === id);
      return member ? { ...member, profileName: member.displayName } : null;
    },
    readOrganizationProfile: (profileId) =>
      readResolvedOrganizationSpaceMember({
        db,
        organizationId: delivery.organizationId,
        profileId,
      }),
  }).catch((error: unknown) => {
    if (error instanceof SpaceSignalAuthoringError) {
      throw createCoreRpcHttpError({
        status: error.status,
        code: error.code,
        reason: error.message,
      });
    }
    throw error;
  });
  return remoteAgentResolveReplyMentionsResponseSchema.parse({
    spaceId: delivery.spaceId,
    targets: targets.map(({ ownerUserId: _ownerUserId, ...target }) => target),
  });
}
