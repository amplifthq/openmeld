const CONFIRMED_PUBLICATION_CHECKPOINT_ATTEMPTS = 2;

export async function persistConfirmedPublicationCheckpoint(
  checkpoint: () => Promise<void>
): Promise<{ error: unknown; persisted: false } | { persisted: true }> {
  let lastError: unknown = new Error(
    "Confirmed publication checkpoint was not attempted"
  );
  for (
    let attempt = 0;
    attempt < CONFIRMED_PUBLICATION_CHECKPOINT_ATTEMPTS;
    attempt += 1
  ) {
    try {
      await checkpoint();
      return { persisted: true };
    } catch (error) {
      lastError = error;
    }
  }
  return { error: lastError, persisted: false };
}
