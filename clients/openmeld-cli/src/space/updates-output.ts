import type { SignalEnvelope } from "@openmeld/protocol";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import {
  buildSpaceRoundReadProjection,
  buildUpdatesReplyWorkflowProjection,
  type SpaceRoundReadProjection,
  type SpaceSignalIndex,
} from "@openmeld/space";
import pc from "picocolors";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import type { Presenter } from "../runtime/presenter";
import { type InfoCardRow, renderInfoCard } from "../ui/info-card";
import { buildDispatchExecutionCardRows } from "./dispatch-execution-output";
import type { StructuredGatewayFailure } from "./gateway-response";
import type { DispatchExecutionEvidence } from "./read-projection/dispatch-execution-evidence";
import {
  buildHumanReplyWorkflowSignalSummary,
  buildHumanReplyWorkflowSummary,
  buildHumanReplyWorkflowSurfaceNote,
} from "./read-projection/human-reply-workflow-display";
import {
  buildHumanReadSignalsTranscriptItems,
  emitHumanReadSignalsTextProjection,
} from "./read-signals-output";

export function emitSpaceUpdatesHumanOutput(input: {
  openMeldProfile: OpenMeldProfile;
  dispatchExecution?: DispatchExecutionEvidence | null;
  dispatchExecutionUnavailable?: StructuredGatewayFailure | null;
  presenter: Presenter;
  membersSnapshot: SpaceMembersSnapshot | null;
  signals: readonly SignalEnvelope[];
  signalIndex?: SpaceSignalIndex | null;
  afterSignalId: string;
  limit: number;
}): void {
  renderInfoCard({
    presenter: input.presenter,
    title: "Space updates:",
    codePrefix: "space.updates.card",
    rows: buildSpaceUpdatesCardRows({
      dispatchExecution: input.dispatchExecution ?? null,
      dispatchExecutionUnavailable: input.dispatchExecutionUnavailable ?? null,
      afterSignalId: input.afterSignalId,
      limit: input.limit,
      membersSnapshot: input.membersSnapshot,
      signalIndex: input.signalIndex ?? null,
      signals: input.signals,
      signalCount: input.signals.length,
    }),
    minContentWidth: 56,
  });

  const transcriptItems = buildHumanReadSignalsTranscriptItems({
    openMeldProfile: input.openMeldProfile,
    events: input.signals,
    membersSnapshot: input.membersSnapshot,
    signalIndex: input.signalIndex ?? null,
  });
  emitHumanReadSignalsTextProjection({
    openMeldProfile: input.openMeldProfile,
    presenter: input.presenter,
    transcriptItems,
    membersSnapshot: input.membersSnapshot,
    emptyCode: "space.updates.empty",
  });
}

function buildSpaceUpdatesCardRows(input: {
  dispatchExecution: DispatchExecutionEvidence | null;
  dispatchExecutionUnavailable: StructuredGatewayFailure | null;
  afterSignalId: string;
  limit: number;
  membersSnapshot: SpaceMembersSnapshot | null;
  signalIndex: SpaceSignalIndex | null;
  signals: readonly SignalEnvelope[];
  signalCount: number;
}): InfoCardRow[] {
  const workflowProjection = buildUpdatesReplyWorkflowProjection({
    afterSignalId: input.afterSignalId,
    dispatchExecution: input.dispatchExecution,
    membersSnapshot: input.membersSnapshot,
    signalIndex: input.signalIndex,
    signals: input.signals,
  });
  const workflowSummary = buildHumanReplyWorkflowSummary(workflowProjection);
  const publishedSignalSummary =
    buildHumanReplyWorkflowSignalSummary(workflowProjection);
  const roundReadProjection = buildSpaceRoundReadProjection({
    sourceSignalId: input.afterSignalId,
    sourceSignal: input.signalIndex?.get(input.afterSignalId) ?? null,
    dispatchExecution: input.dispatchExecution,
    membersSnapshot: input.membersSnapshot,
    signalIndex: input.signalIndex,
    signals: input.signals,
  });
  const roundSummary = buildRoundReadSummary(roundReadProjection);

  return [
    {
      label: pc.dim("After signal"),
      value: pc.dim(input.afterSignalId),
    },
    {
      label: pc.dim("Updates shown"),
      value: pc.bold(pc.cyan(String(input.signalCount))),
    },
    ...(workflowSummary
      ? [
          {
            label: pc.dim("Workflow"),
            value: pc.bold(workflowSummary),
          } satisfies InfoCardRow,
        ]
      : []),
    ...(publishedSignalSummary
      ? [
          {
            label: pc.dim("Published signal"),
            value: pc.dim(publishedSignalSummary),
          } satisfies InfoCardRow,
        ]
      : []),
    ...(roundSummary
      ? [
          {
            label: pc.dim("Round"),
            value: pc.bold(roundSummary),
          } satisfies InfoCardRow,
        ]
      : []),
    ...buildRoundReadTargetRows(roundReadProjection),
    ...(input.dispatchExecution
      ? buildDispatchExecutionCardRows(input.dispatchExecution)
      : []),
    ...(input.dispatchExecutionUnavailable
      ? [
          {
            label: pc.dim("Dispatch history"),
            value: pc.bold(
              pc.yellow(
                buildDispatchExecutionUnavailableSummary(
                  input.dispatchExecutionUnavailable
                )
              )
            ),
          } satisfies InfoCardRow,
        ]
      : []),
    {
      label: pc.dim("Read scope"),
      value: pc.dim(
        buildHumanReplyWorkflowSurfaceNote({
          surface: "updates",
        })
      ),
    },
    {
      label: pc.dim("Included"),
      value: [
        pc.bold("text"),
        pc.bold(pc.cyan("status")),
        pc.bold(pc.yellow("system_notice")),
      ].join(pc.dim(" | ")),
    },
    {
      label: pc.dim("Limit"),
      value: pc.dim(String(input.limit)),
    },
  ];
}

function buildDispatchExecutionUnavailableSummary(
  failure: StructuredGatewayFailure
): string {
  const segments = ["unavailable", failure.message];
  if (failure.requestId) {
    segments.push(`request ${failure.requestId}`);
  }
  return segments.join(" · ");
}

function buildRoundReadSummary(
  projection: SpaceRoundReadProjection
): string | null {
  if (projection.targets.length === 0) {
    return null;
  }

  const relationCounts = countValues(
    projection.targets.map((target) => target.relation)
  );
  const dispatchStateCounts = countValues(
    projection.targets.flatMap((target) =>
      target.dispatchState ? [target.dispatchState] : []
    )
  );
  const publicOutcomeCounts = countValues(
    projection.targets.flatMap((target) =>
      target.publicOutcome ? [target.publicOutcome] : []
    )
  );
  return [
    formatOrderedCounts(relationCounts, [
      ["wake", "wake target", "wake targets"],
      ["reference", "reference target", "reference targets"],
    ]),
    formatOrderedCounts(dispatchStateCounts, [
      ["dispatch_recorded", "dispatch recorded", "dispatches recorded"],
      ["blocked", "blocked"],
      ["retrying", "retrying"],
      ["failed", "failed"],
      ["stopped", "stopped"],
      ["unknown", "unknown"],
      ["no_dispatch", "not dispatched"],
    ]),
    formatOrderedCounts(publicOutcomeCounts, [
      ["post_message", "message posted", "messages posted"],
      ["post_status", "status posted", "statuses posted"],
      ["stay_silent", "stayed silent"],
      ["system_notice", "system notice posted", "system notices posted"],
      ["raw_context_sharing", "context shared"],
      ["internal_only", "internal-only result", "internal-only results"],
    ]),
  ]
    .filter((value): value is string => value !== null)
    .join(pc.dim(" · "));
}

function buildRoundReadTargetRows(
  projection: SpaceRoundReadProjection
): InfoCardRow[] {
  return projection.targets.map((target, index) => {
    const stateText = formatRoundReadDispatchState(target.dispatchState);
    const publicOutcomeText = target.publicOutcome
      ? ` · ${formatRoundReadPublicOutcome(target.publicOutcome)}`
      : "";
    const publishedSignalText = target.publishedSignalId
      ? ` · ${target.publishedSignalId}`
      : "";
    const reasonText = target.reasonCode ? ` · ${target.reasonCode}` : "";
    return {
      label: pc.dim(index === 0 ? "Round targets" : ""),
      value: pc.bold(
        `${target.displayName} · ${target.relation} · ${stateText}${publicOutcomeText}${publishedSignalText}${reasonText}`
      ),
    };
  });
}

function formatRoundReadDispatchState(
  state: SpaceRoundReadProjection["targets"][number]["dispatchState"]
): string {
  switch (state) {
    case "dispatch_recorded":
      return "dispatch recorded";
    case "blocked":
      return "blocked";
    case "retrying":
      return "retrying";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
    case "unknown":
      return "dispatch status unknown";
    case "no_dispatch":
      return "not dispatched";
    default:
      return "dispatch status unknown";
  }
}

function formatRoundReadPublicOutcome(
  outcome: NonNullable<
    SpaceRoundReadProjection["targets"][number]["publicOutcome"]
  >
): string {
  switch (outcome) {
    case "post_message":
      return "posted message";
    case "post_status":
      return "posted status";
    case "stay_silent":
      return "stayed silent";
    case "system_notice":
      return "posted system notice";
    case "raw_context_sharing":
      return "shared context";
    case "internal_only":
      return "internal only";
    default:
      return outcome;
  }
}

function countValues<TValue extends string>(
  values: readonly TValue[]
): Map<TValue, number> {
  const counts = new Map<TValue, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function formatOrderedCounts<TValue extends string>(
  counts: ReadonlyMap<TValue, number>,
  order: readonly (readonly [TValue, string, string?])[]
): string | null {
  const segments = order.flatMap(([value, singularLabel, pluralLabel]) => {
    const count = counts.get(value) ?? 0;
    const label = count === 1 ? singularLabel : (pluralLabel ?? singularLabel);
    return count > 0 ? [`${String(count)} ${label}`] : [];
  });
  return segments.length > 0 ? segments.join(", ") : null;
}
