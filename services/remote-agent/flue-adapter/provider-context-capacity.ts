// Match the pinned pi-ai text heuristic, but apply it to the final serialized
// provider payload so image data, tool schemas, routing, and other envelope
// fields cannot disappear from the preflight measurement.
export const REMOTE_AGENT_ESTIMATED_PROVIDER_BYTES_PER_TOKEN = 4;

const MIN_COMPACTION_RESERVE_TOKENS = 8000;
const MAX_COMPACTION_RESERVE_TOKENS = 64_000;
const COMPACTION_RESERVE_CONTEXT_RATIO = 0.1;

export type RemoteAgentProviderContextCapacity = {
  inputTokenBudget: number;
};

export type RemoteAgentProviderContextMeasurement = {
  estimatedInputTokens: number;
  inputBytes: number;
};

export function resolveRemoteAgentCompactionReserveTokens(
  contextWindow: number
): number {
  const proportionalReserve = Math.ceil(
    contextWindow * COMPACTION_RESERVE_CONTEXT_RATIO
  );
  const maximumSafeReserve = Math.max(1, Math.floor(contextWindow / 4));
  return Math.min(
    Math.max(proportionalReserve, MIN_COMPACTION_RESERVE_TOKENS),
    MAX_COMPACTION_RESERVE_TOKENS,
    maximumSafeReserve
  );
}

export function resolveRemoteAgentProviderContextCapacity(input: {
  contextWindow: number;
  reserveTokens: number;
}): RemoteAgentProviderContextCapacity {
  return {
    inputTokenBudget: input.contextWindow - input.reserveTokens,
  };
}

export function measureRemoteAgentProviderContext(
  providerPayload: unknown
): RemoteAgentProviderContextMeasurement {
  const inputBytes = new TextEncoder().encode(
    JSON.stringify(providerPayload)
  ).byteLength;
  return {
    estimatedInputTokens: Math.ceil(
      inputBytes / REMOTE_AGENT_ESTIMATED_PROVIDER_BYTES_PER_TOKEN
    ),
    inputBytes,
  };
}

export function assertRemoteAgentProviderContextFits(input: {
  capacity: RemoteAgentProviderContextCapacity;
  measurement: RemoteAgentProviderContextMeasurement;
}): void {
  if (
    input.measurement.estimatedInputTokens <= input.capacity.inputTokenBudget
  ) {
    return;
  }
  throw new Error(
    `context_length_exceeded: estimated provider input is ${input.measurement.estimatedInputTokens} tokens, above this model route's ${input.capacity.inputTokenBudget}-token input budget.`
  );
}
