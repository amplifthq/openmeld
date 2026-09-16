import { localAgentReasoningPreferencesRpcSchema } from "@openmeld/schemas";
import type { LocalAgentReasoningPreferencesRpc } from "@openmeld/schemas/types";
import { resolveRuntimeTransportOwnerShard } from "../../dispatch/infrastructure/runtime-transport/runtime-transport-shard";
import type { CoreBindings } from "../../lib/bindings";
import { resolveActiveOrganizationMembership } from "../../organizations/organization-context";
import { createCoreRpcHttpError } from "../../rpc/errors";

export async function reasoningPreferences(
  env: CoreBindings,
  input: LocalAgentReasoningPreferencesRpc
) {
  const parsed = localAgentReasoningPreferencesRpcSchema.safeParse(input);
  if (
    !parsed.success ||
    parsed.data.context.actorContext.profileKind !== "human"
  ) {
    throw createCoreRpcHttpError({
      code: "forbidden",
      reason: "Only the account owner can manage reasoning streaming.",
      status: 403,
    });
  }
  const membership = await resolveActiveOrganizationMembership({
    env,
    context: parsed.data.context,
  });
  if (!membership.ok) {
    throw createCoreRpcHttpError({
      code: membership.code,
      reason: membership.message,
      status: membership.status,
    });
  }
  return resolveRuntimeTransportOwnerShard(
    env,
    membership.userId
  ).rpcReasoningPreferences(
    parsed.data.enabled === undefined ? {} : { enabled: parsed.data.enabled }
  );
}
