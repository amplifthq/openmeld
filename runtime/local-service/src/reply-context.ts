import type { OpenMeldDaemonDispatchReplyToSnapshot } from "@openmeld/schemas/types";

export type DispatchReplyContextSummary = {
  previewText: string | null;
  replyToSignalId: string | null;
  resolved: boolean;
  summary: string;
};

export function buildDispatchReplyContextSummary(
  replyToSnapshot: OpenMeldDaemonDispatchReplyToSnapshot | null | undefined
): DispatchReplyContextSummary {
  const previewText = normalizeOptionalText(replyToSnapshot?.previewText);
  const replyToSignalId = normalizeOptionalText(replyToSnapshot?.signalId);

  if (previewText) {
    return {
      previewText,
      replyToSignalId,
      resolved: true,
      summary: previewText,
    };
  }

  if (replyToSignalId) {
    return {
      previewText: null,
      replyToSignalId,
      resolved: true,
      summary: `signal ${replyToSignalId}`,
    };
  }

  return {
    previewText: null,
    replyToSignalId: null,
    resolved: false,
    summary: "the current source message",
  };
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
