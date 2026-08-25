import type { z } from "zod/v4";

type RemoteAgentTurnEnvelopeSchema =
  typeof import("../../schemas/runtime/remote-agent-turn-envelope")["remoteAgentTurnEnvelopeSchema"];
type RemoteAgentTurnEnvelopeSenderSchema =
  typeof import("../../schemas/runtime/remote-agent-turn-envelope")["remoteAgentTurnEnvelopeSenderSchema"];
type RemoteAgentTurnEnvelopeSpaceSchema =
  typeof import("../../schemas/runtime/remote-agent-turn-envelope")["remoteAgentTurnEnvelopeSpaceSchema"];
type RemoteAgentTurnEnvelopeOrganizationSchema =
  typeof import("../../schemas/runtime/remote-agent-turn-envelope")["remoteAgentTurnEnvelopeOrganizationSchema"];
type RemoteAgentTurnEnvelopeCenterAgentSchema =
  typeof import("../../schemas/runtime/remote-agent-turn-envelope")["remoteAgentTurnEnvelopeCenterAgentSchema"];
type RemoteAgentTurnEnvelopeTriggerSchema =
  typeof import("../../schemas/runtime/remote-agent-turn-envelope")["remoteAgentTurnEnvelopeTriggerSchema"];
type RemoteAgentTurnEnvelopeMemorySchema =
  typeof import("../../schemas/runtime/remote-agent-turn-envelope")["remoteAgentTurnEnvelopeMemorySchema"];
type RemoteAgentTurnEnvelopeMemoryItemSchema =
  typeof import("../../schemas/runtime/remote-agent-turn-envelope")["remoteAgentTurnEnvelopeMemoryItemSchema"];
type RemoteAgentTurnEnvelopeMemorySourceSchema =
  typeof import("../../schemas/runtime/remote-agent-turn-envelope")["remoteAgentTurnEnvelopeMemorySourceSchema"];
type RemoteAgentTurnEnvelopeMemorySubjectSchema =
  typeof import("../../schemas/runtime/remote-agent-turn-envelope")["remoteAgentTurnEnvelopeMemorySubjectSchema"];
type CenterAgentContextHandlingSchema =
  typeof import("../../schemas/runtime/remote-agent-turn-envelope")["centerAgentContextHandlingSchema"];
type CenterAgentContextScopePlanSchema =
  typeof import("../../schemas/runtime/remote-agent-turn-envelope")["centerAgentContextScopePlanSchema"];
type CenterAgentRequesterIdentitySchema =
  typeof import("../../schemas/runtime/remote-agent-turn-envelope")["centerAgentRequesterIdentitySchema"];
type CenterAgentResultAudienceSchema =
  typeof import("../../schemas/runtime/remote-agent-turn-envelope")["centerAgentResultAudienceSchema"];
type RemoteAgentWorkLoopCheckpointSchema =
  typeof import("../../schemas/runtime/remote-agent-turn-envelope")["remoteAgentWorkLoopCheckpointSchema"];
type RemoteAgentWorkLoopContinuationSchema =
  typeof import("../../schemas/runtime/remote-agent-turn-envelope")["remoteAgentWorkLoopContinuationSchema"];

export type RemoteAgentTurnEnvelope = z.infer<RemoteAgentTurnEnvelopeSchema>;
export type RemoteAgentTurnEnvelopeSender =
  z.infer<RemoteAgentTurnEnvelopeSenderSchema>;
export type RemoteAgentTurnEnvelopeSpace =
  z.infer<RemoteAgentTurnEnvelopeSpaceSchema>;
export type RemoteAgentTurnEnvelopeOrganization =
  z.infer<RemoteAgentTurnEnvelopeOrganizationSchema>;
export type RemoteAgentTurnEnvelopeCenterAgent =
  z.infer<RemoteAgentTurnEnvelopeCenterAgentSchema>;
export type RemoteAgentTurnEnvelopeTrigger =
  z.infer<RemoteAgentTurnEnvelopeTriggerSchema>;
export type RemoteAgentTurnEnvelopeMemory =
  z.infer<RemoteAgentTurnEnvelopeMemorySchema>;
export type RemoteAgentTurnEnvelopeMemoryItem =
  z.infer<RemoteAgentTurnEnvelopeMemoryItemSchema>;
export type RemoteAgentTurnEnvelopeMemorySource =
  z.infer<RemoteAgentTurnEnvelopeMemorySourceSchema>;
export type RemoteAgentTurnEnvelopeMemorySubject =
  z.infer<RemoteAgentTurnEnvelopeMemorySubjectSchema>;
export type CenterAgentContextHandling =
  z.infer<CenterAgentContextHandlingSchema>;
export type CenterAgentContextScopePlan =
  z.infer<CenterAgentContextScopePlanSchema>;
export type CenterAgentRequesterIdentity =
  z.infer<CenterAgentRequesterIdentitySchema>;
export type CenterAgentResultAudience =
  z.infer<CenterAgentResultAudienceSchema>;
export type RemoteAgentWorkLoopCheckpoint =
  z.infer<RemoteAgentWorkLoopCheckpointSchema>;
export type RemoteAgentWorkLoopContinuation =
  z.infer<RemoteAgentWorkLoopContinuationSchema>;
