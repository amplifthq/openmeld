import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { remoteAgentResultSourcesSchema } from "./remote-agent-retained-result";
import type { remoteAgentTurnEnvelopeSchema } from "./remote-agent-turn-envelope";

const identity = z.string().trim().min(1).max(512);
export const remoteAgentExecutionAccessRequestSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  submissionId: identity,
  sources: remoteAgentResultSourcesSchema.optional(),
  effect: z.enum(["read", "write"]).optional(),
});

export const remoteAgentExecutionScopeSchema = z.strictObject({
  organizationId: identity,
  agentProfileId: identity,
  bindingId: identity,
  conversationId: identity,
  spaceId: identity,
  principal: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("member"), userId: identity }),
    z.strictObject({ kind: z.literal("agent"), profileId: identity }),
    z.strictObject({
      kind: z.literal("routine"),
      routineId: identity,
      userId: identity,
    }),
  ]),
  v: z.literal(1),
});

export const remoteAgentExecutionAccessResponseSchema = z.strictObject({
  scope: remoteAgentExecutionScopeSchema,
  submissionId: identity,
});

export type RemoteAgentExecutionScope = zod.infer<
  typeof remoteAgentExecutionScopeSchema
>;
export type RemoteAgentExecutionAccessRequest = zod.infer<
  typeof remoteAgentExecutionAccessRequestSchema
>;
export type RemoteAgentExecutionAccessResponse = zod.infer<
  typeof remoteAgentExecutionAccessResponseSchema
>;

/** Both Core and the runtime derive the audience from admitted facts, never tool input. */
export function resolveRemoteAgentExecutionScope(input: {
  agentProfileId: string;
  bindingId: string;
  conversationId?: string;
  organizationId: string;
  spaceId: string;
  turnEnvelope?: zod.infer<typeof remoteAgentTurnEnvelopeSchema>;
}): RemoteAgentExecutionScope {
  const envelope = input.turnEnvelope;
  if (
    !envelope ||
    envelope.organization.id !== input.organizationId ||
    envelope.space.id !== input.spaceId
  ) {
    throw new Error("remote_agent.execution_audience_unavailable");
  }
  const sender = envelope.sender;
  let principal: RemoteAgentExecutionScope["principal"];
  if (sender.kind === "routine") {
    principal = {
      kind: "routine",
      routineId: sender.routineId,
      userId: sender.delegatedBy.ownerUserId,
    };
  } else if (
    sender.kind === "member" &&
    sender.verified &&
    sender.ownerUserId
  ) {
    principal = { kind: "member", userId: sender.ownerUserId };
  } else if (
    sender.kind === "agent_profile" &&
    sender.verified &&
    sender.profileId
  ) {
    principal = { kind: "agent", profileId: sender.profileId };
  } else {
    throw new Error("remote_agent.verified_execution_principal_required");
  }
  return remoteAgentExecutionScopeSchema.parse({
    organizationId: input.organizationId,
    agentProfileId: input.agentProfileId,
    bindingId: input.bindingId,
    conversationId: input.conversationId ?? input.spaceId,
    spaceId: input.spaceId,
    principal,
    v: 1,
  });
}

export function remoteAgentExecutionScopeKey(
  scope: RemoteAgentExecutionScope
): string {
  const value = remoteAgentExecutionScopeSchema.parse(scope);
  const principal = value.principal;
  return JSON.stringify([
    value.v,
    value.organizationId,
    value.agentProfileId,
    value.bindingId,
    value.conversationId,
    value.spaceId,
    principal.kind,
    principal.kind === "agent" ? principal.profileId : principal.userId,
    principal.kind === "routine" ? principal.routineId : null,
  ]);
}
