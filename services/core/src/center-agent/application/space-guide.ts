import { createHash } from "node:crypto";
import {
  centerAgentReadSpaceGuideRequestSchema,
  centerAgentReadSpaceGuideResponseSchema,
} from "@openmeld/schemas";
import { createDispatchContinuationSpaceAccessContext } from "@openmeld/space";
import type { CoreBindings } from "../../lib/bindings";
import { prepareRemoteAgentExecutionAccess } from "../../remote-agent/application/remote-agent-execution-access";
import { createCoreRpcHttpError } from "../../rpc/errors";
import { readSpaceGuide } from "../../space/application/space-guide";

export async function centerAgentReadSpaceGuide(
  env: CoreBindings,
  value: unknown
) {
  const parsed = centerAgentReadSpaceGuideRequestSchema.safeParse(value);
  if (!(parsed.success && parsed.data.context.agentControllerConversationId)) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "space.guide.invalid_input",
      reason: "An admitted execution is required to read its Space guide.",
    });
  }
  const context = parsed.data.context;
  const { caller, delivery } = await prepareRemoteAgentExecutionAccess(env, {
    context,
    submissionId: context.agentControllerConversationId as string,
    effect: "read",
  });
  if (
    "personalExecution" in caller ||
    delivery.conversationKind !== "space" ||
    delivery.routineRunId
  ) {
    throw createCoreRpcHttpError({
      status: 403,
      code: "space.guide.unsupported_source",
      reason: "This execution cannot read a shared Space guide.",
    });
  }
  const guide = await readSpaceGuide({
    env,
    organizationId: delivery.organizationId,
    spaceId: delivery.spaceId,
    spaceAccess: createDispatchContinuationSpaceAccessContext({
      requestContext: context,
      dispatchId: delivery.dispatchId,
      sourceSignalId: delivery.triggerMessageId,
      targetProfileId: delivery.profileId,
      spaceId: delivery.spaceId,
    }),
  });
  return centerAgentReadSpaceGuideResponseSchema.parse({
    guide,
    sourceRef: {
      kind: "space_guide",
      spaceId: delivery.spaceId,
      state: "current",
      version: createHash("sha256")
        .update(guide ?? "", "utf8")
        .digest("hex"),
    },
  });
}
