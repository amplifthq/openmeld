import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import type {
  SpaceSessionContext,
  SpaceSummaryFactsViewState,
  SpaceSummaryPreset,
  SpaceSummarySegmentKey,
  SpaceSummarySegmentViewState,
  SpaceSummaryViewState,
} from "./space-session-view-state";
import { formatStorageUsageSummaryText } from "./space-storage-usage-text";

export function buildSpaceSummaryViewState(input: {
  context: SpaceSessionContext;
  membersSnapshot: SpaceMembersSnapshot | null;
}): SpaceSummaryViewState {
  const facts = buildSpaceSummaryFactsViewState(input);
  return {
    facts,
    composerFooterSegments: selectSpaceSummarySegments({
      facts,
      preset: "composer-footer",
    }),
    sessionSummarySegments: selectSpaceSummarySegments({
      facts,
      preset: "session-summary",
    }),
  };
}

export function buildSpaceSummaryFactsViewState(input: {
  context: SpaceSessionContext;
  membersSnapshot: SpaceMembersSnapshot | null;
}): SpaceSummaryFactsViewState {
  const { context, membersSnapshot } = input;
  return {
    spaceId: context.session.spaceId.trim(),
    spaceName: normalizeNullableText(context.session.spaceName),
    securityLabel: resolveSpaceSummarySecurityLabel(
      context.session.passwordProtected
    ),
    membersCount: membersSnapshot
      ? membersSnapshot.humans.length + membersSnapshot.agents.length
      : null,
    liveHumanCount: membersSnapshot
      ? membersSnapshot.humans.filter((member) => member.liveNow).length
      : null,
    liveAgentCount: membersSnapshot
      ? membersSnapshot.agents.filter((member) => member.liveNow).length
      : null,
    storageUsedBytes: normalizeNullableNumber(context.session.storageUsedBytes),
    storageSoftLimitBytes: normalizeNullableNumber(
      context.session.storageSoftLimitBytes
    ),
    storageUsagePercent: normalizeNullableNumber(
      context.session.storageUsagePercent
    ),
  };
}

export function selectSpaceSummarySegments(input: {
  facts: SpaceSummaryFactsViewState;
  preset: SpaceSummaryPreset;
}): SpaceSummarySegmentViewState[] {
  const segmentOrder = resolveSpaceSummarySegmentOrder(input.preset);
  const segments: SpaceSummarySegmentViewState[] = [];
  for (const key of segmentOrder) {
    const text = resolveSegmentText(input.facts, key);
    if (!text) {
      continue;
    }
    segments.push({ key, text });
  }
  return segments;
}

function resolveSpaceSummarySecurityLabel(
  passwordProtected: boolean | null
): "Secure" | "Public" | null {
  if (passwordProtected === true) {
    return "Secure";
  }
  if (passwordProtected === false) {
    return "Public";
  }
  return null;
}

function normalizeNullableText(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeNullableNumber(
  value: number | null | undefined
): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveSpaceSummarySegmentOrder(
  preset: SpaceSummaryPreset
): readonly SpaceSummarySegmentKey[] {
  switch (preset) {
    case "composer-footer":
      return [
        "spaceName",
        "securityLabel",
        "membersCount",
        "liveHumanCount",
        "liveAgentCount",
        "storageUsage",
      ];
    case "session-summary":
      return [
        "spaceName",
        "securityLabel",
        "membersCount",
        "liveHumanCount",
        "liveAgentCount",
      ];
    default:
      return [];
  }
}

function resolveSegmentText(
  facts: SpaceSummaryFactsViewState,
  key: SpaceSummarySegmentKey
): string {
  switch (key) {
    case "spaceName":
      return facts.spaceName ?? "";
    case "securityLabel":
      return facts.securityLabel ?? "";
    case "membersCount":
      return renderCountText(facts.membersCount, (count) =>
        formatCountLabel(count, "member", "members")
      );
    case "liveHumanCount":
      return renderCountText(
        facts.liveHumanCount,
        (count) =>
          `${count} live ${pluralizeCountLabel(count, "human", "humans")}`
      );
    case "liveAgentCount":
      return renderCountText(
        facts.liveAgentCount,
        (count) =>
          `${count} live ${pluralizeCountLabel(count, "agent", "agents")}`
      );
    case "storageUsage":
      return (
        formatStorageUsageSummaryText({
          usedBytes: facts.storageUsedBytes,
          usagePercent: facts.storageUsagePercent,
        }) ?? ""
      );
    default:
      return "";
  }
}

function renderCountText(
  value: number | null,
  render: (value: number) => string
): string {
  if (typeof value !== "number" || value <= 0) {
    return "";
  }
  return render(value);
}

function formatCountLabel(
  count: number,
  singular: string,
  plural: string
): string {
  return `${count} ${pluralizeCountLabel(count, singular, plural)}`;
}

function pluralizeCountLabel(
  count: number,
  singular: string,
  plural: string
): string {
  return count === 1 ? singular : plural;
}
