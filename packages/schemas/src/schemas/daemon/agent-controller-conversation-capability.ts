import { z } from "zod/v4";

export const agentControllerConversationExternalImportCapabilitySchema = z.enum(
  ["unsupported", "by_ref_id"]
);

export const agentControllerConversationResumeCapabilitySchema = z.enum([
  "unsupported",
  "by_ref_id",
]);

export const agentControllerConversationDiscoverCapabilitySchema =
  z.literal("unsupported");

export const agentControllerConversationTurnOverrideCapabilitySchema = z.enum([
  "unsupported",
  "stateless",
  "persistent",
]);

export const agentControllerConversationCapabilitySchema = z.strictObject({
  discover: agentControllerConversationDiscoverCapabilitySchema,
  externalImport: agentControllerConversationExternalImportCapabilitySchema,
  resume: agentControllerConversationResumeCapabilitySchema,
  turnOverride: agentControllerConversationTurnOverrideCapabilitySchema,
});

type AgentControllerConversationCapability = z.infer<
  typeof agentControllerConversationCapabilitySchema
>;

export const BUILTIN_AGENT_CONTROLLER_CONVERSATION_CAPABILITY_BY_CONTROLLER_ID: Readonly<
  Record<string, AgentControllerConversationCapability>
> = {
  codex: {
    discover: "unsupported",
    externalImport: "by_ref_id",
    resume: "by_ref_id",
    turnOverride: "unsupported",
  },
  "claude-code": {
    discover: "unsupported",
    externalImport: "by_ref_id",
    resume: "by_ref_id",
    turnOverride: "unsupported",
  },
  cursor: {
    discover: "unsupported",
    externalImport: "by_ref_id",
    resume: "by_ref_id",
    turnOverride: "unsupported",
  },
  "grok-build": {
    discover: "unsupported",
    externalImport: "by_ref_id",
    resume: "by_ref_id",
    turnOverride: "unsupported",
  },
  opencode: {
    discover: "unsupported",
    externalImport: "unsupported",
    resume: "by_ref_id",
    turnOverride: "unsupported",
  },
  openclaw: {
    discover: "unsupported",
    externalImport: "unsupported",
    resume: "by_ref_id",
    turnOverride: "unsupported",
  },
} as const;

export const resolveBuiltinAgentControllerConversationCapability = (
  builtinControllerId: string
): AgentControllerConversationCapability | null => {
  const capability =
    BUILTIN_AGENT_CONTROLLER_CONVERSATION_CAPABILITY_BY_CONTROLLER_ID[
      builtinControllerId
    ];
  return capability ? { ...capability } : null;
};
