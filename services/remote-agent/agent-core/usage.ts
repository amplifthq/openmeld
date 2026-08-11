export type RemoteAgentTurnUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  source: "flue_prompt_usage";
};

export type RemoteAgentUsageRecord = {
  agentProfileId: string;
  bindingId: string;
  dispatchId: string;
  idempotencyKey: string;
  modelId: string | null;
  organizationId: string;
  recordedAt: string;
  requestId?: string;
  spaceId: string;
  submissionId: string;
  triggerMessageId: string;
  usage: RemoteAgentTurnUsage;
  v: 1;
};

export function normalizeFluePromptUsage(
  usage: unknown
): RemoteAgentTurnUsage | null {
  if (!usage || typeof usage !== "object") {
    return null;
  }
  const candidate = usage as {
    cacheRead?: unknown;
    cacheWrite?: unknown;
    cost?: {
      cacheRead?: unknown;
      cacheWrite?: unknown;
      input?: unknown;
      output?: unknown;
      total?: unknown;
    };
    input?: unknown;
    output?: unknown;
    totalTokens?: unknown;
  };
  const inputTokens = finiteNumber(candidate.input);
  const outputTokens = finiteNumber(candidate.output);
  const cacheReadTokens = finiteNumber(candidate.cacheRead);
  const cacheWriteTokens = finiteNumber(candidate.cacheWrite);
  const totalTokens = finiteNumber(candidate.totalTokens);
  if (
    inputTokens === null ||
    outputTokens === null ||
    cacheReadTokens === null ||
    cacheWriteTokens === null ||
    totalTokens === null
  ) {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    cost: {
      input: finiteNumber(candidate.cost?.input) ?? 0,
      output: finiteNumber(candidate.cost?.output) ?? 0,
      cacheRead: finiteNumber(candidate.cost?.cacheRead) ?? 0,
      cacheWrite: finiteNumber(candidate.cost?.cacheWrite) ?? 0,
      total: finiteNumber(candidate.cost?.total) ?? 0,
    },
    source: "flue_prompt_usage",
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
