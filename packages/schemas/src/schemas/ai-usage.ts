import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "./daemon/profile-identity";
import { centerAgentToolSpeakerSchema } from "./http/center-agent-speaker";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identifier = z.string().trim().min(1).max(256);

// Input includes cached input; output includes reasoning. Detail counters are
// subsets, never extra tokens to add to the total.
export const aiUsageTokensSchema = z.strictObject({
  input: count,
  output: count,
  cacheRead: count.nullable(),
  cacheWrite: count.nullable(),
  reasoning: count.nullable(),
  total: count,
});

// One completed provider request, not a cumulative conversation snapshot.
// Adapters must deduplicate native message IDs and subtract session baselines.
export const aiUsageObservationSchema = z.strictObject({
  eventId: identifier,
  provider: identifier,
  model: identifier.nullable(),
  source: z.enum([
    "openrouter_response",
    "codex_event",
    "claude_message",
    "opencode_message",
  ]),
  occurredAtMs: count,
  tokens: aiUsageTokensSchema.nullable(),
  cost: z
    .strictObject({
      nanoUsd: count,
      kind: z.enum(["provider_reported", "provider_estimate"]),
    })
    .nullable(),
});

export const aiUsageRecordSchema = aiUsageObservationSchema.extend({
  status: z.enum(["pending", "reported", "unavailable"]),
  providerRequestId: identifier.nullable(),
  organizationId: identifier,
  runtime: z.enum(["local", "remote"]),
  purpose: z.enum([
    "agent",
    "web_research",
    "image_understanding",
    "session_title",
    "activity_digest",
  ]),
  agentProfileId: identifier.nullable(),
  spaceId: identifier.nullable(),
  taskId: identifier.nullable(),
  dispatchId: identifier.nullable().optional(),
  attemptId: identifier.nullable(),
  computerId: identifier.nullable(),
  controller: identifier.nullable(),
});

export const remoteAiUsageWriteSchema = z.strictObject({
  phase: z.enum(["begin", "settle"]),
  record: aiUsageRecordSchema,
});

export const remoteAiUsageWriteResponseSchema = z.strictObject({
  status: z.enum(["accepted", "limit_reached"]),
});

export const aiUsageQuerySchema = z
  .strictObject({
    fromMs: count,
    toMs: count,
    runtime: z.enum(["local", "remote"]).optional(),
    model: identifier.optional(),
    agentProfileId: identifier.optional(),
    spaceId: identifier.optional(),
    taskId: identifier.optional(),
    dispatchId: identifier.optional(),
    computerId: identifier.optional(),
  })
  .refine(
    (value) =>
      value.toMs > value.fromMs && value.toMs - value.fromMs <= 31 * 86_400_000,
    {
      message: "Choose a period of up to 31 days.",
    }
  );

export const aiUsageSummarySchema = z.strictObject({
  runtime: z.enum(["local", "remote"]),
  provider: identifier,
  model: identifier.nullable(),
  requests: count,
  inputTokens: count,
  outputTokens: count,
  totalTokens: count,
  reportedCostNanoUsd: count,
  estimatedCostNanoUsd: count,
  missingTokenRequests: count,
  missingCostRequests: count,
});

export const aiUsageQueryResponseSchema = z.strictObject({
  fromMs: count,
  toMs: count,
  models: z.array(aiUsageSummarySchema),
});

export const organizationAiUsageRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  query: aiUsageQuerySchema.optional(),
});

export const centerAgentAiUsageRpcInputSchema =
  organizationAiUsageRpcInputSchema.extend({
    speakerMember: centerAgentToolSpeakerSchema,
  });
