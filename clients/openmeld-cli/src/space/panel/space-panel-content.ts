import { stripVTControlCharacters } from "node:util";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import pc from "picocolors";
import {
  buildSpaceInfoData,
  buildSpaceMembersLoadingPanelLines,
  buildSpaceMembersPanelLines,
  buildSpaceMembersPanelSource,
  type SpaceMembersPanelSectionSource,
} from "../../ui/output";
import { listSpaceSlashCommands } from "../composer/slash-command-registry";
import type { HumanLogsSectionViewState } from "../transcript/transcript-render";
import type {
  PanelBodyBlockViewState,
  PanelFactItemViewState,
  SearchablePanelListViewState,
  SpaceSessionContext,
} from "../view/space-session-view-state";
import { formatStorageUsageDetailText } from "../view/space-storage-usage-text";

const SPACE_INFO_WARNING_LINE =
  "⚠ Public space: anyone with this Space ID can join. Only bring trusted agents.";
const SPACE_INFO_FULL_WIDTH_LABELS = new Set(["Space Name", "Space ID"]);
const MEMBERS_SEARCH_LABEL = "Type to search";
const MEMBERS_SEARCH_PLACEHOLDER =
  "Filter members by name, @wake, ID, or owner";
const MEMBERS_NO_MATCHES_LINE = pc.dim("No matching members found.");
const LOGS_SEARCH_LABEL = "Type to search";
const LOGS_SEARCH_PLACEHOLDER = "Filter logs by actor, action, or text";
const LOGS_NO_MATCHES_LINE = pc.dim("No matching logs found.");

export function buildHelpPanelBlocks(): readonly PanelBodyBlockViewState[] {
  return buildPanelBodyBlocks([
    buildPanelLinesSection(
      listSpaceSlashCommands().map((command) => {
        return `${pc.cyan(command.trigger)}  ${pc.dim(command.description)}`;
      })
    ),
  ]);
}

export function buildSpacePanelBlocks(input: {
  context: SpaceSessionContext;
  membersSnapshot?: SpaceMembersSnapshot | null;
}): readonly PanelBodyBlockViewState[] {
  const spaceInfo = buildSpaceInfoData({
    gatewayUrl: input.context.gatewayUrl,
    modeLabel: resolveConnectionModeLabel(input.context.connectionMode),
    passwordProtected: input.context.session.passwordProtected ?? undefined,
    spaceCreatedAt: input.context.session.spaceCreatedAt ?? undefined,
    spaceCreatorId: input.context.session.spaceCreatorId ?? undefined,
    spaceCreatorName: input.context.session.spaceCreatorName ?? undefined,
    spaceId: input.context.session.spaceId,
    spaceName: input.context.session.spaceName ?? undefined,
    spaceMembersSnapshot: input.membersSnapshot,
  });
  const factsWithStorage = buildSpaceInfoFactsFromData(
    spaceInfo,
    input.context
  );

  return buildPanelBodyBlocks([
    spaceInfo.publicWarningLines.length > 0
      ? buildPanelLinesSection([pc.yellow(SPACE_INFO_WARNING_LINE)])
      : null,
    buildPanelFactsSection(factsWithStorage),
    buildPanelLinesSection([
      pc.dim("Join command"),
      pc.cyan(spaceInfo.joinCommand),
    ]),
  ]);
}

export function buildMembersPanelBlocks(input: {
  refreshError?: string | null;
  snapshot: SpaceMembersSnapshot | null;
}): readonly PanelBodyBlockViewState[] {
  return buildPanelBodyBlocks([
    buildPanelLinesSection(buildMembersPanelLines(input)),
  ]);
}

export function buildLogsPanelBlocks(input: {
  sections: readonly HumanLogsSectionViewState[];
}): readonly PanelBodyBlockViewState[] {
  const sections = input.sections
    .map((section) => buildLogsPanelSection(section))
    .filter((section): section is PanelBodyBlockViewState => section !== null);

  if (sections.length > 0) {
    return sections;
  }

  return buildPanelBodyBlocks([
    buildPanelLinesSection([pc.dim("No logs yet.")]),
  ]);
}

export function buildLogsSearchableListViewState(input: {
  activeItemId: string | null;
  query: string;
  sections: readonly HumanLogsSectionViewState[];
}): SearchablePanelListViewState {
  const normalizedQuery = normalizeSearchQuery(input.query);
  const filteredSections = filterLogsSections(input.sections, normalizedQuery);
  const activeItemId = resolveLogsSearchableActiveItemId({
    preferredActiveItemId: input.activeItemId,
    query: input.query,
    sections: input.sections,
  });

  return {
    activeItemId,
    control: {
      label: LOGS_SEARCH_LABEL,
      placeholder: LOGS_SEARCH_PLACEHOLDER,
      query: input.query,
    },
    emptyLines: resolveLogsEmptyLines(filteredSections.length, normalizedQuery),
    sections: filteredSections.map((section) => ({
      id: section.id,
      title: section.title,
      items: section.items.map((item) => ({
        id: item.id,
        lines: item.lines,
      })),
    })),
  };
}

export function buildMembersSearchableListViewState(input: {
  activeItemId: string | null;
  query: string;
  refreshError?: string | null;
  snapshot: SpaceMembersSnapshot | null;
}): SearchablePanelListViewState {
  const normalizedQuery = normalizeSearchQuery(input.query);
  if (!input.snapshot) {
    return {
      activeItemId: null,
      control: {
        label: MEMBERS_SEARCH_LABEL,
        placeholder: MEMBERS_SEARCH_PLACEHOLDER,
        query: input.query,
      },
      emptyLines: input.refreshError
        ? [
            "Couldn't load the current Space members.",
            pc.dim("Try /members again in a few seconds."),
          ]
        : buildSpaceMembersLoadingPanelLines(),
      sections: [],
    };
  }

  const source = buildSpaceMembersPanelSource(input.snapshot);
  const filteredSections = filterMembersPanelSections(
    source.sections,
    normalizedQuery
  );
  const activeItemId = resolveMembersSearchableActiveItemId({
    preferredActiveItemId: input.activeItemId,
    query: input.query,
    snapshot: input.snapshot,
  });

  let emptyLines: readonly string[] = [];
  if (filteredSections.length === 0) {
    emptyLines = normalizedQuery
      ? [MEMBERS_NO_MATCHES_LINE]
      : [pc.dim("No members yet.")];
  }

  return {
    activeItemId,
    control: {
      label: MEMBERS_SEARCH_LABEL,
      placeholder: MEMBERS_SEARCH_PLACEHOLDER,
      query: input.query,
    },
    emptyLines,
    sections: filteredSections.map((section) => ({
      id: section.id,
      title: section.title,
      items: section.items.map((item) => ({
        id: item.id,
        lines: item.renderedLines,
      })),
    })),
  };
}

export function resolveMembersSearchableActiveItemId(input: {
  preferredActiveItemId: string | null;
  query: string;
  snapshot: SpaceMembersSnapshot | null;
}): string | null {
  if (!input.snapshot) {
    return null;
  }

  const normalizedQuery = normalizeSearchQuery(input.query);
  const filteredSections = filterMembersPanelSections(
    buildSpaceMembersPanelSource(input.snapshot).sections,
    normalizedQuery
  );
  const itemIds = filteredSections.flatMap((section) =>
    section.items.map((item) => item.id)
  );
  if (itemIds.length === 0) {
    return null;
  }
  return itemIds.includes(input.preferredActiveItemId ?? "")
    ? input.preferredActiveItemId
    : (itemIds[0] ?? null);
}

export function resolveLogsSearchableActiveItemId(input: {
  preferredActiveItemId: string | null;
  query: string;
  sections: readonly HumanLogsSectionViewState[];
}): string | null {
  const filteredSections = filterLogsSections(
    input.sections,
    normalizeSearchQuery(input.query)
  );
  const itemIds = filteredSections.flatMap((section) =>
    section.items.map((item) => item.id)
  );
  if (itemIds.length === 0) {
    return null;
  }
  return itemIds.includes(input.preferredActiveItemId ?? "")
    ? input.preferredActiveItemId
    : (itemIds[0] ?? null);
}

export function buildSpaceInfoPanelFacts(input: {
  context: SpaceSessionContext;
  membersSnapshot?: SpaceMembersSnapshot | null;
}): readonly PanelFactItemViewState[] {
  return buildSpaceInfoFactsFromData(
    buildSpaceInfoData({
      gatewayUrl: input.context.gatewayUrl,
      modeLabel: resolveConnectionModeLabel(input.context.connectionMode),
      passwordProtected: input.context.session.passwordProtected ?? undefined,
      spaceCreatedAt: input.context.session.spaceCreatedAt ?? undefined,
      spaceCreatorId: input.context.session.spaceCreatorId ?? undefined,
      spaceCreatorName: input.context.session.spaceCreatorName ?? undefined,
      spaceId: input.context.session.spaceId,
      spaceName: input.context.session.spaceName ?? undefined,
      spaceMembersSnapshot: input.membersSnapshot,
    }),
    input.context
  );
}

function buildMembersPanelLines(input: {
  refreshError?: string | null;
  snapshot: SpaceMembersSnapshot | null;
}): string[] {
  if (!input.snapshot) {
    if (input.refreshError) {
      return [
        "Couldn't load the current Space members.",
        pc.dim("Try /members again in a few seconds."),
      ];
    }
    return buildSpaceMembersLoadingPanelLines();
  }

  return buildSpaceMembersPanelLines(input.snapshot);
}

function buildLogsPanelSection(
  section: HumanLogsSectionViewState
): PanelBodyBlockViewState | null {
  if (section.items.length === 0) {
    return null;
  }

  return buildPanelLinesSection([
    pc.bold(section.title),
    ...section.items.flatMap((item) => item.lines),
  ]);
}

function filterLogsSections(
  sections: readonly HumanLogsSectionViewState[],
  normalizedQuery: string
): Array<{
  id: string;
  title: string | null;
  items: Array<{
    id: string;
    lines: readonly string[];
    searchKey: string;
  }>;
}> {
  const sourceSections = sections.map((section) => ({
    id: section.kind,
    title: section.title,
    items: section.items.map((item) => ({
      id: item.id,
      lines: item.lines,
      searchKey: buildLogsSearchKey(section.title, item.lines),
    })),
  }));
  if (!normalizedQuery) {
    return sourceSections;
  }
  return sourceSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        item.searchKey.includes(normalizedQuery)
      ),
    }))
    .filter((section) => section.items.length > 0);
}

function filterMembersPanelSections(
  sections: readonly SpaceMembersPanelSectionSource[],
  normalizedQuery: string
): SpaceMembersPanelSectionSource[] {
  if (!normalizedQuery) {
    return [...sections];
  }

  return sections
    .map((section) => ({
      id: section.id,
      title: section.title,
      items: section.items
        .filter((item) => item.searchKey.includes(normalizedQuery))
        .map((item) => ({ ...item })),
    }))
    .filter((section) => section.items.length > 0);
}

function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

function resolveLogsEmptyLines(
  sectionCount: number,
  normalizedQuery: string
): readonly string[] {
  if (sectionCount > 0) {
    return [];
  }
  return normalizedQuery ? [LOGS_NO_MATCHES_LINE] : [pc.dim("No logs yet.")];
}

function buildLogsSearchKey(title: string, lines: readonly string[]): string {
  return normalizeSearchQuery(
    [title, ...lines].map((line) => stripVTControlCharacters(line)).join(" ")
  );
}

function resolveConnectionModeLabel(
  connectionMode: SpaceSessionContext["connectionMode"]
): string {
  if (connectionMode === "watch") {
    return "watch-only stream";
  }
  if (connectionMode === "history") {
    return "history viewer";
  }
  return "interactive chat";
}

function buildPanelBodyBlocks(
  sections: readonly (PanelBodyBlockViewState | null)[]
): readonly PanelBodyBlockViewState[] {
  return sections.filter((section): section is PanelBodyBlockViewState => {
    if (!section) {
      return false;
    }

    return section.kind === "facts"
      ? section.items.length > 0
      : section.lines.length > 0;
  });
}

function buildSpaceInfoFactsFromData(
  spaceInfo: ReturnType<typeof buildSpaceInfoData>,
  context?: SpaceSessionContext
): readonly PanelFactItemViewState[] {
  const facts = spaceInfo.facts.map<PanelFactItemViewState>((fact) => ({
    label: fact.label,
    value: fact.value,
    span: SPACE_INFO_FULL_WIDTH_LABELS.has(fact.label) ? "full" : "column",
  }));

  const storageValue =
    context === undefined
      ? null
      : formatStorageUsageDetailText({
          usedBytes: context.session.storageUsedBytes ?? null,
          softLimitBytes: context.session.storageSoftLimitBytes ?? null,
          usagePercent: context.session.storageUsagePercent ?? null,
        });

  return storageValue
    ? [
        ...facts,
        {
          label: "Storage",
          value: storageValue,
          span: "column",
        },
      ]
    : facts;
}

function buildPanelFactsSection(
  items: readonly PanelFactItemViewState[]
): PanelBodyBlockViewState {
  return {
    kind: "facts",
    items: [...items],
  };
}

function buildPanelLinesSection(
  lines: readonly string[]
): PanelBodyBlockViewState {
  return {
    kind: "lines",
    lines: [...lines],
  };
}
