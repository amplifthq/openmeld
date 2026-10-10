import type { SignalEnvelope } from "@openmeld/protocol";
import {
  executionContextSelectionSchema,
  spaceEvidenceReferencesSchema,
  spaceWorkHandoffSchema,
} from "@openmeld/schemas";
import { createCoreRpcHttpError } from "../../rpc/errors";

/** A publication receipt belongs to its authorized sender. */
export function assertSameSpaceSignalReplay(input: {
  existing: SignalEnvelope;
  authorProfileId: string;
  handoff: unknown;
  evidenceRefs?: unknown;
  contextSelection?: unknown;
  text: string;
  targetProfileIds: string[];
}) {
  if (input.existing.profile.profileId !== input.authorProfileId) {
    throw createCoreRpcHttpError({
      status: 409,
      code: "space.signal.client_message_id_conflict",
      reason:
        "This message ID belongs to another sender. Send a new message from the composer.",
    });
  }
  if (input.existing.type !== "signal.text") {
    return;
  }
  const previous = input.existing.data.meta?.workHandoff;
  const previousRefs = input.existing.data.meta?.evidenceRefs;
  if (!(previous || input.handoff || previousRefs || input.evidenceRefs)) {
    return;
  }
  if (
    input.existing.data.text !== input.text.trim() ||
    JSON.stringify(input.existing.data.messageEnvelope?.activationTargets) !==
      JSON.stringify(input.targetProfileIds) ||
    JSON.stringify(spaceWorkHandoffSchema.optional().parse(previous)) !==
      JSON.stringify(spaceWorkHandoffSchema.optional().parse(input.handoff)) ||
    (previous?.schemaVersion === 2 &&
      JSON.stringify(
        executionContextSelectionSchema
          .optional()
          .parse(input.existing.data.contextSelection)
      ) !==
        JSON.stringify(
          executionContextSelectionSchema
            .optional()
            .parse(input.contextSelection)
        )) ||
    JSON.stringify(
      spaceEvidenceReferencesSchema.optional().parse(previousRefs)
    ) !==
      JSON.stringify(
        spaceEvidenceReferencesSchema.optional().parse(input.evidenceRefs)
      )
  ) {
    throw createCoreRpcHttpError({
      status: 409,
      code: "space.handoff.mutation_conflict",
      reason:
        "This handoff identity was already used for different work. Create a new handoff instead.",
    });
  }
}
