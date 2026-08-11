import { sanitizeSignalTextPreview } from "@openmeld/schemas";

export type DispatchHumanLogContext = {
  spaceName: string | null;
  targetProfileName: string | null;
  targetLabel: string | null;
  sourceProfileName: string | null;
  sourceTextPreview: string | null;
  handoffAgeMs: number | null;
  lastAttemptAgeMs: number | null;
};

export const buildDispatchHumanLogContext = (input: {
  nowMs: number;
  spaceName?: string | null;
  targetProfileName?: string | null;
  targetLabel?: string | null;
  sourceProfileName?: string | null;
  sourceText?: string | null;
  handedOffAtMs?: number | null;
  createdAtMs?: number | null;
  lastAttemptAtMs?: number | null;
}): DispatchHumanLogContext => {
  const handoffBaseMs = resolveHandoffBaseMs(input);

  return {
    spaceName: normalizeOptionalText(input.spaceName),
    targetProfileName: normalizeOptionalText(input.targetProfileName),
    targetLabel: normalizeOptionalText(input.targetLabel),
    sourceProfileName: normalizeOptionalText(input.sourceProfileName),
    sourceTextPreview: sanitizeSourceTextPreview(input.sourceText),
    handoffAgeMs:
      typeof handoffBaseMs === "number"
        ? Math.max(0, input.nowMs - handoffBaseMs)
        : null,
    lastAttemptAgeMs:
      typeof input.lastAttemptAtMs === "number"
        ? Math.max(0, input.nowMs - input.lastAttemptAtMs)
        : null,
  };
};

export const buildDispatchTargetSummaryLabel = (input: {
  targetLabel?: string | null;
  targetProfileName?: string | null;
  targetProfileId?: string | null;
}): string | null => {
  const targetLabel = normalizeOptionalText(input.targetLabel);
  if (targetLabel) {
    return targetLabel;
  }
  return (
    normalizeOptionalText(input.targetProfileName) ??
    normalizeOptionalText(input.targetProfileId)
  );
};

export const sanitizeSourceTextPreview = (
  text: string | null | undefined
): string | null => {
  return sanitizeSignalTextPreview(text);
};

const normalizeOptionalText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const resolveHandoffBaseMs = (input: {
  handedOffAtMs?: number | null;
  createdAtMs?: number | null;
}): number | null => {
  if (typeof input.handedOffAtMs === "number") {
    return input.handedOffAtMs;
  }
  if (typeof input.createdAtMs === "number") {
    return input.createdAtMs;
  }
  return null;
};
