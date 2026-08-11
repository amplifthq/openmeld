import type { SignalEnvelope } from "@openmeld/protocol";
import type {
  DispatchResult,
  SpaceIdentityDirectory,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
  buildDispatchResultMessageReadProjection,
  buildSignalMessageReadProjection,
  type SpaceMessageReadProjection,
  type SpaceSignalIndex,
} from "@openmeld/space";
import { formatOpenMeldCliCommand } from "../../runtime/cli-entry-command";
import type { DispatchExecutionEvidence } from "./dispatch-execution-evidence";

// CLI adapter layer: decorate shared read truth onto command payloads without
// owning read-projection or workflow semantics.
export type SpaceSignalThreadReplyPreview = {
  actorProfileId: string | null;
  actorProfileName: string | null;
  text: string | null;
};

export type SpaceSignalThreadSummary = {
  threadId: string;
  replyCount: number;
  replyPreviews: SpaceSignalThreadReplyPreview[];
};

export type FormalSignalReadPayload = SignalEnvelope & {
  diagnostics?: FormalSignalDiagnostics;
  dispatchExecution?: DispatchExecutionEvidence | null;
  messageReadProjection?: SpaceMessageReadProjection;
  thread?: SpaceSignalThreadSummary | null;
};

export type FormalSignalDiagnostics = {
  summary: string;
  traceCommands: string[];
};

export type FormalDispatchResultReadPayload = DispatchResult & {
  messageReadProjection: SpaceMessageReadProjection;
};

export function buildFormalSignalReadPayload(input: {
  dispatchExecution?: DispatchExecutionEvidence | null;
  signal: SignalEnvelope;
  identityDirectory?: SpaceIdentityDirectory | null;
  membersSnapshot?: SpaceMembersSnapshot | null;
  signalIndex?: SpaceSignalIndex | null;
  thread?: SpaceSignalThreadSummary | null;
}): FormalSignalReadPayload {
  if (!isMessageSemanticSignal(input.signal)) {
    return input.signal;
  }

  const messageReadProjection = buildSignalMessageReadProjection({
    signal: input.signal,
    identityDirectory: input.identityDirectory ?? null,
    membersSnapshot: input.membersSnapshot ?? null,
    signalIndex: input.signalIndex ?? null,
  });

  return {
    ...buildOptionalDispatchExecutionDecoration(input.dispatchExecution),
    ...buildOptionalSignalDiagnostics({
      messageReadProjection,
      signal: input.signal,
    }),
    ...input.signal,
    ...(input.thread ? { thread: input.thread } : {}),
    messageReadProjection,
  };
}

export function buildFormalDispatchResultReadPayload(input: {
  result: DispatchResult;
  identityDirectory?: SpaceIdentityDirectory | null;
  membersSnapshot?: SpaceMembersSnapshot | null;
  signalIndex?: SpaceSignalIndex | null;
}): FormalDispatchResultReadPayload {
  return {
    ...input.result,
    messageReadProjection: buildDispatchResultMessageReadProjection({
      result: input.result,
      identityDirectory: input.identityDirectory ?? null,
      membersSnapshot: input.membersSnapshot ?? null,
      signalIndex: input.signalIndex ?? null,
    }),
  };
}

function buildOptionalDispatchExecutionDecoration(
  dispatchExecution: DispatchExecutionEvidence | null | undefined
): { dispatchExecution?: DispatchExecutionEvidence | null } {
  return dispatchExecution === undefined ? {} : { dispatchExecution };
}

function buildOptionalSignalDiagnostics(input: {
  messageReadProjection: SpaceMessageReadProjection;
  signal: SignalEnvelope;
}): { diagnostics?: FormalSignalDiagnostics } {
  const traceCommands = buildSignalTraceCommands(input);
  if (traceCommands.length === 0) {
    return {};
  }
  return {
    diagnostics: {
      summary:
        "Use a trace command to inspect dispatch, Wake execution authority, runtime execution, and result evidence for this message.",
      traceCommands,
    },
  };
}

function buildSignalTraceCommands(input: {
  messageReadProjection: SpaceMessageReadProjection;
  signal: SignalEnvelope;
}): string[] {
  const signalMeta = readObjectField(input.signal.data, "meta");
  const dispatchId =
    readStringField(input.signal.data, "dispatchId") ??
    readStringField(signalMeta, "dispatchId");
  if (dispatchId) {
    return [
      formatOpenMeldCliCommand(
        `openmeld service trace --space ${input.signal.spaceId} --dispatch ${dispatchId} --view agent`
      ),
    ];
  }

  const clientMessageId = readStringField(signalMeta, "clientMessageId");
  if (!clientMessageId) {
    return [];
  }

  return input.messageReadProjection.wakeTargets.map((target) =>
    formatOpenMeldCliCommand(
      `openmeld service trace --space ${input.signal.spaceId} --client-message ${clientMessageId} --target-profile ${target.profileId} --view agent`
    )
  );
}

function readObjectField(
  value: unknown,
  field: string
): Record<string, unknown> | null {
  if (!(value && typeof value === "object")) {
    return null;
  }
  const nested = (value as Record<string, unknown>)[field];
  return nested && typeof nested === "object"
    ? (nested as Record<string, unknown>)
    : null;
}

function readStringField(value: unknown, field: string): string | null {
  if (!(value && typeof value === "object")) {
    return null;
  }
  const raw = (value as Record<string, unknown>)[field];
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
}

function isMessageSemanticSignal(
  signal: SignalEnvelope
): signal is
  | Extract<SignalEnvelope, { type: "signal.text" }>
  | Extract<SignalEnvelope, { type: "signal.status" }>
  | Extract<SignalEnvelope, { type: "signal.system_notice" }> {
  return (
    signal.type === "signal.text" ||
    signal.type === "signal.status" ||
    signal.type === "signal.system_notice"
  );
}
