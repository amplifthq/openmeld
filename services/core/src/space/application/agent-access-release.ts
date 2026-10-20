import { supportsExecutionContextAccess } from "@openmeld/agent-runtime";
import type { SignalEnvelope } from "@openmeld/schemas/types";

/**
 * The message an owner's consent releases. Consent starts a new Session
 * where the harness has Sessions. A harness without them runs the message
 * exactly as a later ordinary message, since an explicit new Session would
 * be refused there. An unknown harness still asks for a new Session.
 */
export function buildReleasedAgentAccessSignal(input: {
  controllerRef: string | null;
  signal: Extract<SignalEnvelope, { type: "signal.text" }>;
  targetProfileId: string;
}): SignalEnvelope {
  if (
    input.controllerRef &&
    !supportsExecutionContextAccess(
      input.controllerRef,
      "workspace",
      "agent_settings"
    )
  ) {
    return input.signal;
  }
  return {
    ...input.signal,
    data: {
      ...input.signal.data,
      contextSelections: {
        ...input.signal.data.contextSelections,
        [input.targetProfileId]: { mode: "new" },
      },
    },
  } as SignalEnvelope;
}
