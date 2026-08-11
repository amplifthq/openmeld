export type DispatchIdempotencyInput = {
  sourceEventId: string;
  targetProfileId: string;
};

export const buildIdempotencyKey = (
  input: DispatchIdempotencyInput
): string => {
  return `${input.sourceEventId.length}:${input.sourceEventId}|${input.targetProfileId.length}:${input.targetProfileId}`;
};
