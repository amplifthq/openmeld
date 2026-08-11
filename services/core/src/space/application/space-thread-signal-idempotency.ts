import type {
  SignalEnvelope,
  SpaceThreadSignalPlacement,
} from "@openmeld/schemas/types";

type TextSignal = Extract<SignalEnvelope, { type: "signal.text" }>;

export type ExistingThreadSignalRetry =
  | { status: "missing" }
  | { status: "location_conflict" }
  | {
      status: "replay";
      placement: SpaceThreadSignalPlacement;
      signal: TextSignal;
    };

export function resolveExistingThreadSignalRetry(input: {
  existingSignal: TextSignal | null;
  existingPlacement: SpaceThreadSignalPlacement | null;
  threadId: string;
}): ExistingThreadSignalRetry {
  if (!input.existingSignal) {
    return { status: "missing" };
  }
  if (input.existingPlacement?.threadId !== input.threadId) {
    return { status: "location_conflict" };
  }
  return {
    status: "replay",
    placement: input.existingPlacement,
    signal: input.existingSignal,
  };
}
