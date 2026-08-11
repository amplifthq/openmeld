import type { SignalEnvelope } from "@openmeld/protocol";
import {
  AGENT_REPLY_FINAL_PURPOSE,
  parseOptionalClientMessageId,
} from "@openmeld/schemas";
import type {
  SpaceDiagnosticReportReasonCode,
  SpaceDiagnosticReportWakePointer,
  SpaceDiagnosticReportWakePointerDerivation,
} from "@openmeld/schemas/types";

export type SpaceDiagnosticReportPointerProjection = {
  replyToSignalId: string | null;
  threadId: string | null;
  wakePointers: SpaceDiagnosticReportWakePointer[];
  wakePointerDerivation: SpaceDiagnosticReportWakePointerDerivation;
};

export type ProjectSpaceDiagnosticReportPointersInput = {
  readSignalById: (signalId: string) => SignalEnvelope | null;
  readThreadIdBySignalId: (signalId: string) => string | null;
  reportedSignal: SignalEnvelope;
  spaceId: string;
};

type SourceWakeProjection =
  | {
      kind: "complete";
      pointers: SpaceDiagnosticReportWakePointer[];
    }
  | {
      kind: "not_wake";
    };

export function projectSpaceDiagnosticReportPointers(
  input: ProjectSpaceDiagnosticReportPointersInput
): SpaceDiagnosticReportPointerProjection {
  const replyToSignalId = readReplyToSignalId(input.reportedSignal);
  const threadId = input.readThreadIdBySignalId(input.reportedSignal.id);

  if (isFinalAgentReply(input.reportedSignal)) {
    return {
      replyToSignalId,
      threadId,
      ...projectFinalReplyWakePointers({
        readSignalById: input.readSignalById,
        replySignal: input.reportedSignal,
        replyToSignalId,
        spaceId: input.spaceId,
      }),
    };
  }

  if (isTerminalFailureNotice(input.reportedSignal)) {
    const terminalFailureReplyToSignalId = readTerminalFailureReplyToSignalId(
      input.reportedSignal
    );
    return {
      replyToSignalId: terminalFailureReplyToSignalId,
      threadId,
      ...projectTerminalFailureWakePointers({
        readSignalById: input.readSignalById,
        replyToSignalId: terminalFailureReplyToSignalId,
        spaceId: input.spaceId,
        terminalFailureSignal: input.reportedSignal,
      }),
    };
  }

  const sourceWake = projectSourceWakePointers({
    sourceSignal: input.reportedSignal,
    spaceId: input.spaceId,
  });
  if (sourceWake.kind === "complete") {
    return buildPointerProjection({
      replyToSignalId,
      threadId,
      wakePointers: sourceWake.pointers,
      status: "source_multi_target",
      reasonCodes: ["diagnostic_report.source_wake_targets"],
    });
  }
  if (replyToSignalId) {
    const sourceSignal = input.readSignalById(replyToSignalId);
    if (!sourceSignal) {
      return buildPointerProjection({
        replyToSignalId,
        threadId,
        wakePointers: [],
        status: "unavailable",
        reasonCodes: ["diagnostic_report.reply_source_signal_not_found"],
      });
    }

    const fallbackWake = projectSourceWakePointers({
      sourceSignal,
      spaceId: input.spaceId,
    });
    if (fallbackWake.kind === "complete") {
      return buildPointerProjection({
        replyToSignalId,
        threadId,
        wakePointers: fallbackWake.pointers,
        status: "fallback_multi_target",
        reasonCodes: ["diagnostic_report.reply_target_missing_fallback"],
      });
    }
  }

  return buildPointerProjection({
    replyToSignalId,
    threadId,
    wakePointers: [],
    status: "not_wake",
    reasonCodes: ["diagnostic_report.not_wake_related"],
  });
}

function projectFinalReplyWakePointers(input: {
  readSignalById: (signalId: string) => SignalEnvelope | null;
  replySignal: SignalEnvelope;
  replyToSignalId: string | null;
  spaceId: string;
}): Omit<
  SpaceDiagnosticReportPointerProjection,
  "replyToSignalId" | "threadId"
> {
  const sourceSignal = input.replyToSignalId
    ? input.readSignalById(input.replyToSignalId)
    : null;

  if (!sourceSignal) {
    return {
      wakePointers: [],
      wakePointerDerivation: {
        status: "unavailable",
        reasonCodes: input.replyToSignalId
          ? ["diagnostic_report.reply_source_signal_not_found"]
          : ["diagnostic_report.wake_pointer_unavailable"],
      },
    };
  }

  const targetProfileId = readFinalReplyTargetProfileId(input.replySignal);
  const clientMessageId =
    sourceSignal.type === "signal.text"
      ? parseOptionalClientMessageId(sourceSignal.data.meta?.clientMessageId)
      : null;

  if (targetProfileId && sourceSignal.type === "signal.text") {
    return {
      wakePointers: [
        {
          spaceId: input.spaceId,
          clientMessageId,
          sourceSignalId: sourceSignal.id,
          targetProfileId,
        },
      ],
      wakePointerDerivation: {
        status: "exact",
        reasonCodes: ["diagnostic_report.reply_target_exact"],
      },
    };
  }

  const fallbackWake = projectSourceWakePointers({
    sourceSignal,
    spaceId: input.spaceId,
  });
  if (fallbackWake.kind === "complete") {
    return {
      wakePointers: fallbackWake.pointers,
      wakePointerDerivation: {
        status: "fallback_multi_target",
        reasonCodes: ["diagnostic_report.reply_target_missing_fallback"],
      },
    };
  }

  return {
    wakePointers: [],
    wakePointerDerivation: {
      status: "unavailable",
      reasonCodes: ["diagnostic_report.wake_pointer_unavailable"],
    },
  };
}

function projectTerminalFailureWakePointers(input: {
  readSignalById: (signalId: string) => SignalEnvelope | null;
  replyToSignalId: string | null;
  spaceId: string;
  terminalFailureSignal: Extract<
    SignalEnvelope,
    { type: "signal.system_notice" }
  >;
}): Omit<
  SpaceDiagnosticReportPointerProjection,
  "replyToSignalId" | "threadId"
> {
  const dispatchId = normalizeOptionalString(
    input.terminalFailureSignal.data.dispatchId
  );
  const targetProfileId = normalizeOptionalString(
    input.terminalFailureSignal.data.actorProfileId
  );

  if (!(dispatchId && targetProfileId && input.replyToSignalId)) {
    return {
      wakePointers: [],
      wakePointerDerivation: {
        status: "unavailable",
        reasonCodes: ["diagnostic_report.wake_pointer_unavailable"],
      },
    };
  }

  const sourceSignal = input.readSignalById(input.replyToSignalId);
  if (!sourceSignal) {
    return {
      wakePointers: [],
      wakePointerDerivation: {
        status: "unavailable",
        reasonCodes: [
          "diagnostic_report.terminal_failure_source_signal_not_found",
        ],
      },
    };
  }

  const sourceWake = projectSourceWakePointers({
    sourceSignal,
    spaceId: input.spaceId,
  });
  const sourceWakePointer =
    sourceWake.kind === "complete"
      ? sourceWake.pointers.find(
          (pointer) => pointer.targetProfileId === targetProfileId
        )
      : null;

  if (!sourceWakePointer) {
    return {
      wakePointers: [],
      wakePointerDerivation: {
        status: "unavailable",
        reasonCodes: ["diagnostic_report.wake_pointer_unavailable"],
      },
    };
  }

  return {
    wakePointers: [sourceWakePointer],
    wakePointerDerivation: {
      status: "exact",
      reasonCodes: ["diagnostic_report.terminal_failure_target_exact"],
    },
  };
}

function projectSourceWakePointers(input: {
  sourceSignal: SignalEnvelope;
  spaceId: string;
}): SourceWakeProjection {
  if (input.sourceSignal.type !== "signal.text") {
    return { kind: "not_wake" };
  }

  const activationTargets = input.sourceSignal.data.messageEnvelope
    ? normalizeUniqueNonEmptyStrings(
        input.sourceSignal.data.messageEnvelope.activationTargets
      )
    : [];
  if (activationTargets.length === 0) {
    return { kind: "not_wake" };
  }

  const clientMessageId = parseOptionalClientMessageId(
    input.sourceSignal.data.meta?.clientMessageId
  );

  return {
    kind: "complete",
    pointers: activationTargets.map((targetProfileId) => ({
      spaceId: input.spaceId,
      clientMessageId,
      sourceSignalId: input.sourceSignal.id,
      targetProfileId,
    })),
  };
}

function buildPointerProjection(input: {
  reasonCodes: readonly SpaceDiagnosticReportReasonCode[];
  replyToSignalId: string | null;
  status: SpaceDiagnosticReportWakePointerDerivation["status"];
  threadId: string | null;
  wakePointers: SpaceDiagnosticReportWakePointer[];
}): SpaceDiagnosticReportPointerProjection {
  return {
    replyToSignalId: input.replyToSignalId,
    threadId: input.threadId,
    wakePointers: input.wakePointers,
    wakePointerDerivation: {
      status: input.status,
      reasonCodes: [...input.reasonCodes],
    },
  };
}

function isFinalAgentReply(signal: SignalEnvelope): boolean {
  return (
    signal.type === "signal.text" &&
    normalizeOptionalString(signal.data.meta?.purpose) ===
      AGENT_REPLY_FINAL_PURPOSE
  );
}

function readFinalReplyTargetProfileId(signal: SignalEnvelope): string | null {
  if (signal.type !== "signal.text") {
    return null;
  }
  const dispatchId = normalizeOptionalString(signal.data.meta?.dispatchId);
  const targetProfileId = normalizeOptionalString(
    signal.data.meta?.targetProfileId
  );
  return dispatchId && targetProfileId ? targetProfileId : null;
}

function isTerminalFailureNotice(
  signal: SignalEnvelope
): signal is Extract<SignalEnvelope, { type: "signal.system_notice" }> {
  return (
    signal.type === "signal.system_notice" &&
    normalizeOptionalString(signal.data.noticeType) === "terminal_failure"
  );
}

function readTerminalFailureReplyToSignalId(
  signal: Extract<SignalEnvelope, { type: "signal.system_notice" }>
): string | null {
  return normalizeOptionalString(signal.data.replyTo?.signalId);
}

function readReplyToSignalId(signal: SignalEnvelope): string | null {
  if (signal.type !== "signal.text") {
    return null;
  }
  return (
    normalizeOptionalString(signal.data.messageEnvelope?.replyToSignalId) ??
    normalizeOptionalString(signal.data.replyTo?.signalId)
  );
}

function normalizeUniqueNonEmptyStrings(values: readonly unknown[]): string[] {
  const normalized = new Set<string>();
  for (const value of values) {
    const item = normalizeOptionalString(value);
    if (item) {
      normalized.add(item);
    }
  }
  return [...normalized];
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
