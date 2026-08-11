import type {
  DispatchResult,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
  buildDispatchResultMessageReadProjection,
  buildDispatchResultReplyWorkflowProjection,
  type SpaceSignalIndex,
} from "@openmeld/space";
import pc from "picocolors";
import type { Presenter } from "../runtime/presenter";
import { type InfoCardRow, renderInfoCard } from "../ui/info-card";
import { sanitizeTerminalDisplayText } from "../ui/terminal-safe-text";
import {
  buildHumanReplyContextSummary,
  formatHumanReadTargetList,
} from "./read-projection/human-message-read-display";
import {
  buildHumanReplyWorkflowSignalSummary,
  buildHumanReplyWorkflowSummary,
  buildHumanReplyWorkflowSurfaceNote,
} from "./read-projection/human-reply-workflow-display";

export function emitSpaceDispatchResultHumanOutput(input: {
  presenter: Presenter;
  result: DispatchResult;
  membersSnapshot?: SpaceMembersSnapshot | null;
  signalIndex?: SpaceSignalIndex | null;
}): void {
  const { presenter, result } = input;
  const messageReadProjection = buildDispatchResultMessageReadProjection({
    result,
    membersSnapshot: input.membersSnapshot ?? null,
    signalIndex: input.signalIndex ?? null,
  });
  const actorName =
    resolveDispatchResultActorName({
      result,
      membersSnapshot: input.membersSnapshot ?? null,
    }) ?? null;

  renderInfoCard({
    presenter,
    title: "Space dispatch result:",
    codePrefix: "space.result.card",
    rows: buildSpaceDispatchResultCardRows({
      result,
      actorName,
      messageReadProjection,
    }),
    minContentWidth: 56,
  });

  if (result.previewText) {
    emitSpaceDispatchResultTextBlock({
      presenter,
      codePrefix: "space.result.preview",
      label: "Preview text",
      text: result.previewText,
    });
  }

  if (result.finalText) {
    emitSpaceDispatchResultTextBlock({
      presenter,
      codePrefix: "space.result.final",
      label: "Final text",
      text: result.finalText,
    });
  }
}

function buildSpaceDispatchResultCardRows(input: {
  result: DispatchResult;
  actorName: string | null;
  messageReadProjection: ReturnType<
    typeof buildDispatchResultMessageReadProjection
  >;
}): InfoCardRow[] {
  const { actorName, messageReadProjection, result } = input;
  const workflowProjection = buildDispatchResultReplyWorkflowProjection({
    result,
  });
  const replySummary = buildHumanReplyContextSummary(
    messageReadProjection.replyToContext
  );
  const workflowSummary = buildHumanReplyWorkflowSummary(workflowProjection);
  const publishedSignalSummary =
    buildHumanReplyWorkflowSignalSummary(workflowProjection);
  const publishedSignalValue =
    publishedSignalSummary ?? result.publishedSignalId;
  return [
    {
      label: pc.dim("Actor"),
      value: actorName
        ? pc.bold(pc.cyan(actorName))
        : pc.bold(result.actorProfileId),
    },
    ...(actorName
      ? [
          {
            label: pc.dim("Actor profile ID"),
            value: pc.dim(result.actorProfileId),
          } satisfies InfoCardRow,
        ]
      : []),
    {
      label: pc.dim("Public outcome"),
      value: formatDispatchResultPublicOutcome(result.publicOutcome),
    },
    ...(workflowSummary
      ? [
          {
            label: pc.dim("Workflow"),
            value: pc.bold(workflowSummary),
          } satisfies InfoCardRow,
        ]
      : []),
    ...(publishedSignalValue
      ? [
          {
            label: pc.dim("Published signal"),
            value: pc.dim(publishedSignalValue),
          } satisfies InfoCardRow,
        ]
      : []),
    {
      label: pc.dim("Result kind"),
      value: formatDispatchResultKind(result.resultKind),
    },
    ...(result.statusType
      ? [
          {
            label: pc.dim("Status type"),
            value: formatDispatchResultStatusType(result.statusType),
          } satisfies InfoCardRow,
        ]
      : []),
    { label: "", value: "" },
    {
      label: pc.dim("Created at"),
      value: pc.dim(result.createdAt),
    },
    {
      label: pc.dim("Dispatch ID"),
      value: pc.dim(result.dispatchId),
    },
    {
      label: pc.dim("Read scope"),
      value: pc.dim(
        buildHumanReplyWorkflowSurfaceNote({
          surface: "result",
        })
      ),
    },
    ...(result.agentControllerConversation
      ? [
          {
            label: pc.dim("Agent controller conversation"),
            value: pc.dim(
              formatAgentControllerConversation(
                result.agentControllerConversation
              )
            ),
          } satisfies InfoCardRow,
        ]
      : []),
    ...(result.dispatchExecution
      ? [
          {
            label: pc.dim("Agent controller conversation resume"),
            value: pc.bold(
              formatDispatchResultAgentControllerConversationResume(
                result.dispatchExecution
              )
            ),
          } satisfies InfoCardRow,
          {
            label: pc.dim("Local runtime context"),
            value: pc.dim(
              formatDispatchResultLocalRuntimeContext(result.dispatchExecution)
            ),
          } satisfies InfoCardRow,
          {
            label: pc.dim("Bootstrap"),
            value: pc.dim(
              formatDispatchResultBootstrap(result.dispatchExecution)
            ),
          } satisfies InfoCardRow,
        ]
      : []),
    ...(result.runtimeWorkspace
      ? [
          {
            label: pc.dim("Runtime workspace"),
            value: pc.dim(
              formatDispatchResultRuntimeWorkspace(result.runtimeWorkspace)
            ),
          } satisfies InfoCardRow,
        ]
      : []),
    {
      label: pc.dim("Result ref"),
      value: pc.dim(result.resultRef),
    },
    ...(replySummary
      ? [
          {
            label: pc.dim("Reply to"),
            value: pc.bold(replySummary),
          } satisfies InfoCardRow,
        ]
      : []),
    ...(messageReadProjection.replyToSignalId
      ? [
          {
            label: pc.dim("Reply-to signal"),
            value: pc.dim(messageReadProjection.replyToSignalId),
          } satisfies InfoCardRow,
        ]
      : []),
    ...buildDispatchResultRelationRows(messageReadProjection),
  ];
}

function buildDispatchResultRelationRows(
  messageReadProjection: ReturnType<
    typeof buildDispatchResultMessageReadProjection
  >
): InfoCardRow[] {
  return [
    ...(messageReadProjection.wakeTargets.length > 0
      ? [
          {
            label: pc.dim("Wake"),
            value: pc.bold(
              formatHumanReadTargetList(messageReadProjection.wakeTargets)
            ),
          } satisfies InfoCardRow,
        ]
      : []),
    ...(messageReadProjection.referenceTargets.length > 0
      ? [
          {
            label: pc.dim("Reference"),
            value: pc.bold(
              formatHumanReadTargetList(messageReadProjection.referenceTargets)
            ),
          } satisfies InfoCardRow,
        ]
      : []),
  ];
}

function emitSpaceDispatchResultTextBlock(input: {
  presenter: Presenter;
  codePrefix: string;
  label: string;
  text: string;
}): void {
  const normalizedText = sanitizeTerminalDisplayText(input.text, "multi-line");
  if (!normalizedText.trim()) {
    return;
  }

  input.presenter.line({
    code: `${input.codePrefix}.label`,
    text: `  ${pc.dim(`${input.label}:`)}`,
  });
  for (const line of normalizedText.split("\n")) {
    input.presenter.line({
      code: `${input.codePrefix}.value`,
      text: line.length > 0 ? `  ${pc.bold(line)}` : "",
    });
  }
}

function formatDispatchResultPublicOutcome(
  outcome: DispatchResult["publicOutcome"]
): string {
  switch (outcome) {
    case "post_message":
      return pc.bold(pc.green(outcome));
    case "post_status":
      return pc.bold(pc.cyan(outcome));
    case "stay_silent":
      return pc.bold(pc.yellow(outcome));
    case "system_notice":
      return pc.bold(pc.yellow(outcome));
    case "raw_context_sharing":
      return pc.bold(pc.magenta(outcome));
    case "internal_only":
      return pc.dim(outcome);
    default:
      return pc.bold(outcome);
  }
}

function formatDispatchResultKind(
  resultKind: DispatchResult["resultKind"]
): string {
  return resultKind === "status"
    ? pc.bold(pc.cyan(resultKind))
    : pc.bold(resultKind);
}

function formatDispatchResultStatusType(
  statusType: NonNullable<DispatchResult["statusType"]>
): string {
  switch (statusType) {
    case "done":
      return pc.bold(pc.green(statusType));
    case "working":
      return pc.bold(pc.cyan(statusType));
    case "needs_input":
      return pc.bold(pc.yellow(statusType));
    case "blocked":
      return pc.bold(pc.red(statusType));
    case "handoff":
      return pc.bold(pc.magenta(statusType));
    default:
      return pc.bold(statusType);
  }
}

function formatAgentControllerConversation(
  agentControllerConversation: NonNullable<
    DispatchResult["agentControllerConversation"]
  >
): string {
  return `${agentControllerConversation.agentControllerRef} ${agentControllerConversation.agentControllerConversationKind} ${agentControllerConversation.agentControllerConversationId}`;
}

function formatDispatchResultAgentControllerConversationResume(
  dispatchExecution: NonNullable<DispatchResult["dispatchExecution"]>
): string {
  return dispatchExecution.agentControllerConversationResume.status;
}

function formatDispatchResultLocalRuntimeContext(
  dispatchExecution: NonNullable<DispatchResult["dispatchExecution"]>
): string {
  return dispatchExecution.localRuntimeContext.reason
    ? `${dispatchExecution.localRuntimeContext.status} (${dispatchExecution.localRuntimeContext.reason})`
    : dispatchExecution.localRuntimeContext.status;
}

function formatDispatchResultRuntimeWorkspace(
  runtimeWorkspace: NonNullable<DispatchResult["runtimeWorkspace"]>
): string {
  return runtimeWorkspace.fingerprint
    ? `${runtimeWorkspace.path} (${runtimeWorkspace.fingerprint})`
    : runtimeWorkspace.path;
}

function formatDispatchResultBootstrap(
  dispatchExecution: NonNullable<DispatchResult["dispatchExecution"]>
): string {
  return dispatchExecution.bootstrap.reason
    ? `${dispatchExecution.bootstrap.status} (${dispatchExecution.bootstrap.reason})`
    : dispatchExecution.bootstrap.status;
}

function resolveDispatchResultActorName(input: {
  result: DispatchResult;
  membersSnapshot: SpaceMembersSnapshot | null;
}): string | null {
  const actorName = input.result.actorName?.trim();
  if (actorName) {
    return actorName;
  }

  const membersSnapshot = input.membersSnapshot;
  if (!membersSnapshot) {
    return null;
  }

  for (const member of [...membersSnapshot.humans, ...membersSnapshot.agents]) {
    if (member.profileId !== input.result.actorProfileId) {
      continue;
    }
    const memberName = member.profileName?.trim();
    return memberName || null;
  }

  return null;
}
