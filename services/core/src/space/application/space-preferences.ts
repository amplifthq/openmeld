import {
  type SpacePreferencesRpc,
  spacePreferencesRpcSchema,
} from "@openmeld/schemas";
import { resolveRuntimeTransportOwnerShard } from "../../dispatch/infrastructure/runtime-transport/runtime-transport-shard";
import type { CoreBindings } from "../../lib/bindings";
import { resolveActiveOrganizationMembership } from "../../organizations/organization-context";
import { createCoreRpcHttpError } from "../../rpc/errors";

export async function spacePreferences(
  env: CoreBindings,
  input: SpacePreferencesRpc
) {
  const parsed = spacePreferencesRpcSchema.safeParse(input);
  if (
    !parsed.success ||
    parsed.data.context.actorContext.profileKind !== "human"
  ) {
    throw createCoreRpcHttpError({
      code: "forbidden",
      reason: "Only the account owner can manage Space preferences.",
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
  ).rpcSpacePreferences(
    parsed.data.automaticWakeEnabled === undefined
      ? {}
      : { automaticWakeEnabled: parsed.data.automaticWakeEnabled }
  );
}
