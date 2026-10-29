import { spaceMetaSchema } from "@openmeld/schemas";
import type { SpaceAccessContext } from "@openmeld/space";
import type { CoreBindings } from "../../lib/bindings";
import { createCoreRpcHttpError } from "../../rpc/errors";
import { resolveSpaceStub } from "../../rpc/space-ref";

/** Read the owning Space through its normal current-access projection. */
export async function readSpaceGuide(input: {
  env: CoreBindings;
  organizationId: string;
  spaceAccess: SpaceAccessContext;
  spaceId: string;
}): Promise<string | null> {
  const stub = resolveSpaceStub(input.env.OPENMELD_SPACES, input.spaceId);
  if (!stub) {
    throw new Error("space.guide.owner_unavailable");
  }
  const parsed = spaceMetaSchema.safeParse(
    await stub.rpcGetMeta({
      spaceAccess: input.spaceAccess,
      spaceId: input.spaceId,
    })
  );
  if (
    !parsed.success ||
    parsed.data.spaceId !== input.spaceId ||
    parsed.data.organizationId !== input.organizationId
  ) {
    throw createCoreRpcHttpError({
      status: 502,
      code: "space.guide.invalid_source",
      reason: "The current Space guide could not be verified.",
    });
  }
  return parsed.data.guide?.trim() || null;
}
