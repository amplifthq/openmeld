import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";

export type DispatchSourceSignalContext = {
  profileId: string | null;
  profileKind: "agent" | "human" | "system" | null;
  profileHandle: string | null;
  profileMentionLabel: string | null;
  text: string;
};

/** The Space-owned dispatch snapshot is the source content boundary. */
export async function readDispatchSourceSignalContext(input: {
  message: OpenMeldDaemonDispatchQueueMessage;
}): Promise<DispatchSourceSignalContext> {
  const snapshot = input.message.sourceSignalSnapshot;
  const text = snapshot?.text?.trim();
  if (snapshot && text) {
    return await {
      profileId: normalizeOptionalText(snapshot.profileId),
      profileKind: snapshot.profileKind ?? null,
      profileHandle: null,
      profileMentionLabel: normalizeOptionalText(snapshot.profileMentionLabel),
      text,
    };
  }
  // Historical dispatches without a snapshot retain their explicit source ID;
  // they cannot gain an author identity through a private Space storage read.
  return await {
    profileId: null,
    profileKind: null,
    profileHandle: null,
    profileMentionLabel: null,
    text: `reply to source event ${input.message.sourceEventId}`,
  };
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  return value?.trim() || null;
}
