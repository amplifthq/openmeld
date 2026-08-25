import * as z from "zod/v4";
import { agentControllerConversationRefSchema } from "./conversation-contract";

export const LEGACY_RUNTIME_DISPATCH_POLICY = "mention_only" as const;

export const runtimeDispatchPolicySchema = z.enum([
  LEGACY_RUNTIME_DISPATCH_POLICY,
  "listen_all",
]);

export const runtimeTransportModeSchema = z.enum([
  "local-cli",
  "codex-app-server",
  "acp",
]);
export const runtimeStreamingModeSchema = z.enum(["final", "stream"]);

export const runtimeAgentControllerConversationIdMappingSpecSchema =
  z.strictObject({
    sourceField: z.string().min(1),
    mappingVersion: z.number().int().min(1),
  });

export const runtimeAgentExecutableLaunchContractSchema = z.strictObject({
  kind: z.literal("executable"),
  commandPath: z.string().min(1),
  argsPrefix: z.array(z.string().min(1)).optional(),
});

export const runtimeAgentNodeScriptLaunchContractSchema = z.strictObject({
  kind: z.literal("node_script"),
  nodePath: z.string().min(1),
  scriptPath: z.string().min(1),
  argsPrefix: z.array(z.string().min(1)).optional(),
});

export const runtimeAgentControllerLaunchContractSchema = z.discriminatedUnion(
  "kind",
  [
    runtimeAgentExecutableLaunchContractSchema,
    runtimeAgentNodeScriptLaunchContractSchema,
  ]
);

export const runtimeAgentControllerLaunchCandidateSchema = z.strictObject({
  installId: z.string().min(1),
  label: z.string().min(1),
  detail: z.string().min(1),
  commandPath: z.string().min(1),
  launchContract: runtimeAgentControllerLaunchContractSchema,
});

export const runtimeAgentControllerSettingsSchema = z.strictObject({
  dispatch_policy: runtimeDispatchPolicySchema.default(
    LEGACY_RUNTIME_DISPATCH_POLICY
  ),
  transport_mode: runtimeTransportModeSchema,
  streaming_mode: runtimeStreamingModeSchema.default("final"),
  // Null is the product default: local Agent execution must not fail because a
  // fixed wall-clock timer elapsed. Positive values are explicit diagnostics or
  // test watchdogs, not normal Wake execution policy.
  timeout_ms: z.number().int().positive().nullable().default(null),
  retry: z.number().int().min(0).default(0),
  context_id_mapping_spec:
    runtimeAgentControllerConversationIdMappingSpecSchema,
});

export const agentContextResolutionSchema = z.strictObject({
  agentControllerConversationId: z.string().min(1).nullable(),
  agentControllerConversation: agentControllerConversationRefSchema
    .nullable()
    .optional(),
  sourceField: z.string().min(1),
  mappingVersion: z.number().int().min(1),
});
