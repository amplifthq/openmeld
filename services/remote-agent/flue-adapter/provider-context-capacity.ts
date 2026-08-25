// Match the pinned pi-ai text heuristic, but apply it to the final serialized
// provider payload so image data, tool schemas, routing, and other envelope
// fields cannot disappear from the preflight measurement.
const ESTIMATED_PROVIDER_BYTES_PER_TOKEN = 4;

export type RemoteAgentProviderContextCapacity = {
  inputTokenBudget: number;
};

export type RemoteAgentProviderContextMeasurement = {
  estimatedInputTokens: number;
  inputBytes: number;
};

export function measureRemoteAgentProviderContext(
  providerPayload: unknown
): RemoteAgentProviderContextMeasurement {
  const inputBytes = new TextEncoder().encode(
    JSON.stringify(providerPayload)
  ).byteLength;
  return {
    estimatedInputTokens: Math.ceil(
      inputBytes / ESTIMATED_PROVIDER_BYTES_PER_TOKEN
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
