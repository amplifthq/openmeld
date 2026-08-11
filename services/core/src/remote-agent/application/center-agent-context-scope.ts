import { freezeCenterAgentContextScopePlan } from "@openmeld/agent-runtime";
import { remoteAgentTurnEnvelopeSchema } from "@openmeld/schemas";
import type { RemoteAgentTurnEnvelope } from "@openmeld/schemas/types";

export function parseCoreOwnedRemoteAgentTurnEnvelope(
  input: unknown
): RemoteAgentTurnEnvelope {
  const envelope = remoteAgentTurnEnvelopeSchema.parse(input);
  return remoteAgentTurnEnvelopeSchema.parse(
    freezeCenterAgentContextScopePlan(envelope)
  );
}

export function discardFrozenContextScopeForNewTurn(
  envelope: RemoteAgentTurnEnvelope
): Omit<RemoteAgentTurnEnvelope, "contextScopePlan"> {
  const { contextScopePlan: _previousContextScopePlan, ...rest } = envelope;
  return rest;
}
