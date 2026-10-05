/** Keep a small permanent fence after content erasure so late RPCs cannot revive it. */
export const ACCOUNT_ERASED_KEY = "openmeld:account-erased";
const ACCOUNT_ERASURE_RESTART =
  "Account content erased; old capabilities revoked.";

/** The expected restart revokes old capabilities; a fresh stub acknowledges it. */
export async function acknowledgeAccountErasure(
  operation: () => Promise<void>
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== ACCOUNT_ERASURE_RESTART
    ) {
      throw error;
    }
    await operation();
  }
}

export async function requireRetainedAccountStorage(
  storage: DurableObjectStorage
): Promise<void> {
  if (await storage.get(ACCOUNT_ERASED_KEY)) {
    throw new Error("This workspace was permanently deleted.");
  }
}

export async function eraseAccountStorage(
  ctx: DurableObjectState
): Promise<void> {
  await ctx.storage.deleteAlarm();
  await ctx.storage.deleteAll();
  await ctx.storage.put(ACCOUNT_ERASED_KEY, true);
  await ctx.storage.sync();
  // Revoke already-issued RPC capabilities and discard in-memory file/content caches.
  // The durable retry reads the fence and acknowledges the completed erasure.
  ctx.abort(ACCOUNT_ERASURE_RESTART);
}
