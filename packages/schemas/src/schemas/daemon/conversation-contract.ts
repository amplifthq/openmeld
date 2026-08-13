import { z } from "zod/v4";
import { canonicalizeBuiltinAgentControllerRef } from "./agent-controller-ref";

export const agentControllerConversationKindSchema = z.enum([
  "session",
  "thread",
  "context",
]);

const trimmedNonEmptyStringSchema = z.string().trim().min(1);

export const agentControllerConversationRefSchema = z.strictObject({
  agentControllerRef: trimmedNonEmptyStringSchema,
  agentControllerConversationKind: agentControllerConversationKindSchema,
  agentControllerConversationId: trimmedNonEmptyStringSchema,
});

export const conversationPolicySchema = z.strictObject({
  collaborationMode: z.enum(["default", "plan"]).optional(),
  fallbackModel: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  reasoningLevel: z.string().min(1).optional(),
});

export const BUILTIN_AGENT_CONTROLLER_CONVERSATION_KIND_BY_CONTROLLER_ID: Readonly<
  Record<string, z.infer<typeof agentControllerConversationKindSchema>>
> = {
  codex: "thread",
  "claude-code": "session",
  cursor: "session",
  "grok-build": "session",
  openclaw: "session",
  opencode: "session",
} as const;

export const BUILTIN_AGENT_CONTROLLER_ALLOWS_DISTINCT_CONVERSATION_ID: Readonly<
  Record<string, boolean>
> = {
  openclaw: true,
} as const;

export const resolveBuiltinAgentControllerConversationKind = (
  agentControllerRef: string
): z.infer<typeof agentControllerConversationKindSchema> | null => {
  const canonical = canonicalizeBuiltinAgentControllerRef(agentControllerRef);
  if (!canonical) {
    return null;
  }
  const builtinControllerId = canonical.slice("builtin:".length);
  return (
    BUILTIN_AGENT_CONTROLLER_CONVERSATION_KIND_BY_CONTROLLER_ID[
      builtinControllerId
    ] ?? null
  );
};

export const builtinAgentControllerAllowsDistinctConversationId = (
  builtinControllerId: string
): boolean =>
  BUILTIN_AGENT_CONTROLLER_ALLOWS_DISTINCT_CONVERSATION_ID[
    builtinControllerId
  ] === true;

export const buildAgentControllerConversationRef = (input: {
  agentControllerRef: string;
  agentControllerConversationKind: z.infer<
    typeof agentControllerConversationKindSchema
  >;
  agentControllerConversationId: string;
}): z.infer<typeof agentControllerConversationRefSchema> => ({
  agentControllerRef: input.agentControllerRef,
  agentControllerConversationKind: input.agentControllerConversationKind,
  agentControllerConversationId: input.agentControllerConversationId,
});
