import type { AccountInvalidationFrame } from "@openmeld/schemas";
import type { CoreBindings } from "../lib/bindings";

export async function publishAccountInvalidation(input: {
  env: CoreBindings;
  frame: AccountInvalidationFrame;
  organizationId: string;
  userIds: readonly string[];
}): Promise<void> {
  const namespace = input.env.OPENMELD_ACCOUNT_INVALIDATIONS;
  if (!namespace) {
    return;
  }
  await Promise.all(
    [...new Set(input.userIds)].map(async (userId) => {
      try {
        const id = namespace.idFromName(`${input.organizationId}:${userId}`);
        await namespace.get(id).notify(input.frame);
      } catch (error) {
        // The durable projection has already completed. The next poll or
        // reconnect will recover this missed, non-authoritative hint.
        console.warn("[core.openmeld.account_invalidation_failed]", {
          error: error instanceof Error ? error.message : String(error),
          organizationId: input.organizationId,
          userId,
          type: input.frame.type,
        });
      }
    })
  );
}
