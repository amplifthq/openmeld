import {
  buildSpaceMessageReadRelationSummary,
  type SpaceMessageReadProjection,
  type SpaceMessageReadRelationSummary,
  type SpaceMessageReadTargetRef,
  type SpaceMessageReplyContext,
} from "@openmeld/space";

export type HumanMessageSemanticLines = {
  relationLines: readonly string[];
  replyLine: string | null;
};

export function buildHumanMessageRelationLines(
  projection:
    | Pick<SpaceMessageReadProjection, "wakeTargets" | "referenceTargets">
    | null
    | undefined
): readonly string[] {
  if (!projection) {
    return [];
  }
  return buildSpaceMessageReadRelationSummary({
    wakeTargets: projection.wakeTargets,
    referenceTargets: projection.referenceTargets,
  }).map(formatHumanRelationSummaryLine);
}

export function buildHumanReplyContextLine(
  replyContext: SpaceMessageReplyContext | null | undefined
): string | null {
  const summary = buildHumanReplyContextSummary(replyContext);
  return summary ? `reply to ${summary}` : null;
}

export function buildHumanReplyContextSummary(
  replyContext: SpaceMessageReplyContext | null | undefined
): string | null {
  if (!replyContext) {
    return null;
  }

  const actorLabel =
    normalizeDisplayText(replyContext.actorDisplayName) ??
    normalizeDisplayText(replyContext.actorProfileId);
  if (!actorLabel) {
    return null;
  }

  const semanticPreview = buildHumanReplySemanticPreview(replyContext);
  return semanticPreview ? `${actorLabel} · ${semanticPreview}` : actorLabel;
}

export function formatHumanReadTargetList(
  targets: readonly SpaceMessageReadTargetRef[]
): string {
  return targets
    .map(
      (target) => normalizeDisplayText(target.displayName) ?? target.profileId
    )
    .join(", ");
}

export function buildHumanMessageSemanticLines(input: {
  projection?: SpaceMessageReadProjection | null;
  replyContext?: SpaceMessageReplyContext | null;
}): HumanMessageSemanticLines {
  return {
    relationLines: buildHumanMessageRelationLines(input.projection),
    replyLine: buildHumanReplyContextLine(input.replyContext),
  };
}

function buildHumanReplySemanticPreview(
  replyContext: SpaceMessageReplyContext
): string | null {
  const relationSummary = replyContext.relationSummary ?? [];
  if (relationSummary.length > 0) {
    return relationSummary.map(formatHumanRelationSummaryLine).join(" · ");
  }

  if (replyContext.resolved !== true) {
    return null;
  }

  return normalizeDisplayText(replyContext.previewText);
}

function formatHumanRelationSummaryLine(
  summary: SpaceMessageReadRelationSummary
): string {
  return `${summary.relation}: ${formatHumanReadTargetList(summary.targets)}`;
}

function normalizeDisplayText(value: string | null | undefined): string | null {
  const normalized = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
}
