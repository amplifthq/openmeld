import { stripVTControlCharacters } from "node:util";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import pc from "picocolors";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import {
  OPENMELD_COMPOSER_SURFACE_BG_RGB,
  renderOpenMeldBrandAccent,
} from "../../ui/brand";
import { resolveControllerDisplayName } from "../../ui/controller-display";
import { renderPositiveAccentText } from "../../ui/positive-accent";
import {
  colorizeAgentLabel,
  colorizeDisplayProfileLabel,
  colorizePersonLabel,
  resolveAgentSurfaceRgb,
} from "../../ui/profile-label-color";
import { resolvePrimarySpaceMentionLabel } from "../mention-label-state";
import { buildHumanReplyWorkflowTranscriptCueLine } from "../read-projection/human-reply-workflow-transcript-display";
import type { SpaceTranscriptItem } from "../state/space-screen-state";
import {
  isConnectedAsLegacySystemLine,
  isImportantHumanSystemNotice,
} from "./system-notice-importance";

export type TranscriptBlockKind =
  | "plain_text_group"
  | "system_group"
  | "presence_first_join_group"
  | "presence_trace_group"
  | "membership_trace_group";
export type TranscriptBubbleSpeakerKind = "human" | "agent" | "unknown";
export type TranscriptBubbleHighlightKind =
  | "self_human"
  | "owned_agent"
  | "neutral";

export type TranscriptBubbleMessageViewState = {
  primaryLine: string;
  headerBaseLeading?: string;
  headerAuxLeading?: string | null;
  headerLeading: string;
  headerTypeBadge?: string | null;
  headerPresenceBadge?: "live now" | null;
  headerTrailing: string;
  replyLine?: string | null;
  relationLines: readonly string[];
  bodyLines: readonly string[];
  bodyDetailLines: readonly string[];
  metaLines: readonly string[];
  threadIndicatorLine?: string | null;
  detailLines: readonly string[];
  rawLines: readonly string[];
};

export type TranscriptPlainTextBlockViewState = {
  kind: "plain_text_group";
  groupKey: string;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
  speakerKind: TranscriptBubbleSpeakerKind;
  highlightKind: TranscriptBubbleHighlightKind;
  speakerProfileId: string | null;
  speakerProfileName: string;
  speakerOwnerUserId?: string | null;
  speakerOwnerName?: string | null;
  speakerAgentControllerRef?: string | null;
  speakerControllerDisplay?: string | null;
  speakerOwnerDisplay?: string | null;
  messages: readonly TranscriptBubbleMessageViewState[];
};

export type TranscriptSystemBlockViewState = {
  kind: "system_group";
  groupKey: string;
  lines: readonly string[];
  purposes: readonly (string | null)[];
  sourceNoticeCount: number;
};

export type TranscriptPresenceFirstJoinBlockViewState = {
  kind: "presence_first_join_group";
  groupKey: string;
  actorKey: string;
  actorProfileId: string | null;
  actorKind: TranscriptBubbleSpeakerKind;
  actorAvatar: string;
  actorLabel: string;
  actorOwnerUserId?: string | null;
  actorOwnerName?: string | null;
  ts: number;
};

export type TranscriptPresenceTraceBlockViewState = {
  kind: "presence_trace_group";
  groupKey: string;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
  actorKey: string;
  actorProfileId: string | null;
  actorKind: TranscriptBubbleSpeakerKind;
  actorAvatar: string;
  actorLabel: string;
  actorOwnerUserId?: string | null;
  actorOwnerName?: string | null;
  startTs: number;
  endTs: number;
  joinCount: number;
  leftCount: number;
  count: number;
};

export type TranscriptMembershipTraceTargetViewState = {
  profileId: string | null;
  kind: "human" | "agent";
  label: string;
  mentionLabel: string | null;
  ownerUserId?: string | null;
  ownerName?: string | null;
};

export type TranscriptMembershipTraceBlockViewState = {
  kind: "membership_trace_group";
  groupKey: string;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
  action: "member_added" | "member_removed";
  actorKey: string;
  actorProfileId: string | null;
  actorKind: TranscriptBubbleSpeakerKind;
  actorAvatar: string;
  actorLabel: string;
  actorOwnerUserId?: string | null;
  actorOwnerName?: string | null;
  startTs: number;
  endTs: number;
  targets: readonly TranscriptMembershipTraceTargetViewState[];
};

export type TranscriptBlockViewState =
  | TranscriptPlainTextBlockViewState
  | TranscriptSystemBlockViewState
  | TranscriptPresenceFirstJoinBlockViewState
  | TranscriptPresenceTraceBlockViewState
  | TranscriptMembershipTraceBlockViewState;

type TranscriptSystemClusterBlockViewState =
  | TranscriptSystemBlockViewState
  | TranscriptPresenceFirstJoinBlockViewState
  | TranscriptPresenceTraceBlockViewState
  | TranscriptMembershipTraceBlockViewState;

export type HumanLogsSectionKind = "presence" | "membership" | "system";

export type HumanLogsItemViewState = {
  id: string;
  lines: readonly string[];
};

export type HumanLogsSectionViewState = {
  kind: HumanLogsSectionKind;
  items: readonly HumanLogsItemViewState[];
  title: string;
  lines: readonly string[];
};

export type HumanTranscriptProjectionSummaryViewState = {
  hiddenPresenceCount: number;
  hiddenSystemNoticeCount: number;
};

export type HumanTranscriptProjectionViewState = {
  hiddenSummary: HumanTranscriptProjectionSummaryViewState;
  logsSections: readonly HumanLogsSectionViewState[];
  transcriptBlocks: readonly TranscriptBlockViewState[];
};
type TranscriptSessionProfile = {
  profileId: string;
  profileName: string;
  kind: "human" | "agent";
  ownerUserId?: string | null;
  ownerName?: string | null;
};
type TranscriptSpeakerIdentity = {
  profileId: string | null;
  profileName: string;
  kind: TranscriptBubbleSpeakerKind;
  agentControllerRef?: string | null;
  controllerDisplay?: string | null;
  ownerDisplay?: string | null;
  ownerUserId?: string | null;
  ownerName?: string | null;
};
type TranscriptRenderSection =
  | {
      kind: "plain_text_group";
      block: TranscriptPlainTextBlockViewState;
    }
  | {
      kind: "system_cluster";
      blocks: readonly TranscriptSystemClusterBlockViewState[];
    };

const SYSTEM_TRANSCRIPT_GROUP_KEY = "system";
const PRESENCE_TRACE_MAX_GAP_MS = 15 * 60 * 1000;
const PRESENCE_TRACE_MAX_SPAN_MS = 60 * 60 * 1000;
const MEMBERSHIP_TRACE_MAX_GAP_MS = 5 * 60 * 1000;
const TRANSCRIPT_GROUP_GAP_LINES = 2;
const TRANSCRIPT_BUBBLE_GAP_LINES = 1;
const TRANSCRIPT_BUBBLE_GROUP_INDENT = 0;
const TRANSCRIPT_BUBBLE_HORIZONTAL_PADDING = 1;
const TRANSCRIPT_BUBBLE_VERTICAL_PADDING = 1;
const TRANSCRIPT_BUBBLE_META_GAP_LINES = 1;
const TRANSCRIPT_BUBBLE_BODY_PREFIX = "› ";
const TRANSCRIPT_BUBBLE_BODY_CONTINUATION_PREFIX = "  ";
const TRANSCRIPT_BUBBLE_REPLY_CONNECTED_BODY_PREFIX = "╰─› ";
const TRANSCRIPT_BUBBLE_REPLY_CONNECTED_BODY_CONTINUATION_PREFIX = "    ";
const TRANSCRIPT_HUMAN_BUBBLE_BACKGROUND = buildAnsiBackgroundColor(
  OPENMELD_COMPOSER_SURFACE_BG_RGB
);
const TRANSCRIPT_NEUTRAL_BUBBLE_BACKGROUND = "\u001B[48;2;33;33;33m";
const ANSI_BACKGROUND_RESET = "\u001B[49m";
const ANSI_ESCAPE_PATTERN = "(?:\\u001B\\[[0-9;]*m)*";
const TRANSCRIPT_GROUP_KIND_PATTERN = /^profile:(human|agent|unknown):/u;
const PROFILE_GROUP_KEY_PATTERN = /^profile:(human|agent|unknown):(.+)$/u;
const PRESENCE_TRACE_JOINED_LABEL = "joined";
const PRESENCE_TRACE_LEFT_LABEL = "left";
const PRESENCE_TRACE_JOIN_LABEL = "join";
const PRESENCE_TRACE_JOIN_LEFT_LABEL = "join/left";
const PRESENCE_FIRST_JOIN_LABEL = "first joined";
const MEMBERSHIP_TRACE_ADDED_LABEL = "added";
const MEMBERSHIP_TRACE_REMOVED_LABEL = "removed";
const TRANSCRIPT_PRIMARY_METADATA_LINE_PATTERN =
  /^(human(?:\s·.*)?|agent(?:\s+via\s+.*|\s·.*)?)/u;
const TRANSCRIPT_SECONDARY_METADATA_LINE_PATTERN =
  /^(owns:|added:|owner:|origin:)/u;
const TRANSCRIPT_BODY_PREFIX_COLON_PATTERN = /^\s*:\s*/u;
const TRANSCRIPT_AGENT_VIA_META_PREFIX_PATTERN = /^agent via [^·]+ · /u;
const TRANSCRIPT_ANSI_HEADER_PATTERN = new RegExp(
  `^(?<leading>.+?)\\s${ANSI_ESCAPE_PATTERN}(?<timestamp>\\d{8}\\s\\d{2}:\\d{2}(?::\\d{2})?)${ANSI_ESCAPE_PATTERN}:\\s*(?<body>.*)$`,
  "u"
);
export function buildTranscriptBlocks(
  items: readonly SpaceTranscriptItem[],
  membersSnapshot?: SpaceMembersSnapshot | null,
  sessionProfile?: TranscriptSessionProfile | null
): TranscriptBlockViewState[] {
  const blocks: TranscriptBlockViewState[] = [];

  for (const item of items) {
    const nextBlock = appendOrCreateTranscriptBlock({
      currentBlock: blocks.at(-1) ?? null,
      item,
      membersSnapshot,
      sessionProfile,
    });
    if (nextBlock.replaceCurrent) {
      blocks[blocks.length - 1] = nextBlock.block;
      continue;
    }
    blocks.push(nextBlock.block);
  }

  return coalescePresenceTraceBlocksAcrossSingleForeignPresence(blocks);
}

export function buildHumanTranscriptProjection(input: {
  items: readonly SpaceTranscriptItem[];
  membersSnapshot?: SpaceMembersSnapshot | null;
  sessionProfile?: TranscriptSessionProfile | null;
}): HumanTranscriptProjectionViewState {
  const allBlocks = buildTranscriptBlocks(
    input.items,
    input.membersSnapshot,
    input.sessionProfile
  );
  const firstJoinBlocks = buildPresenceFirstJoinBlocks(
    input.items,
    input.membersSnapshot ?? null
  );
  const transcriptBlocks = attachCurrentPresenceStatusToLastMessageCards(
    coalesceAdjacentHumanPlainTextBlocks(
      buildHumanTranscriptBlocks({
        allBlocks,
        firstJoinBlocks,
      })
    ),
    input.membersSnapshot ?? null,
    input.items
  );
  const transcriptSystemNoticeCount = countSystemNotices(transcriptBlocks);
  const allSystemNoticeCount = countSystemNotices(allBlocks);

  return {
    hiddenSummary: {
      hiddenPresenceCount: allBlocks.filter(
        (block) => block.kind === "presence_trace_group"
      ).length,
      hiddenSystemNoticeCount: Math.max(
        0,
        allSystemNoticeCount - transcriptSystemNoticeCount
      ),
    },
    logsSections: buildHumanLogsSections({
      allBlocks,
      firstJoinBlocks,
    }),
    transcriptBlocks,
  };
}

function countSystemNotices(
  blocks: readonly TranscriptBlockViewState[]
): number {
  return blocks.reduce((count, block) => {
    if (block.kind === "system_group") {
      return count + block.sourceNoticeCount;
    }
    return count;
  }, 0);
}

function appendOrCreateTranscriptBlock(input: {
  currentBlock: TranscriptBlockViewState | null;
  item: SpaceTranscriptItem;
  membersSnapshot?: SpaceMembersSnapshot | null;
  sessionProfile?: TranscriptSessionProfile | null;
}): {
  block: TranscriptBlockViewState;
  replaceCurrent: boolean;
} {
  const appendedBlock = tryAppendTranscriptBlock(
    input.currentBlock,
    input.item
  );
  if (appendedBlock) {
    return {
      block: appendedBlock,
      replaceCurrent: true,
    };
  }
  return {
    block: createTranscriptBlock({
      groupKey: input.item.groupKey,
      item: input.item,
      membersSnapshot: input.membersSnapshot,
      sessionProfile: input.sessionProfile,
    }),
    replaceCurrent: false,
  };
}

function tryAppendTranscriptBlock(
  currentBlock: TranscriptBlockViewState | null,
  item: SpaceTranscriptItem
): TranscriptBlockViewState | null {
  if (!currentBlock) {
    return null;
  }
  if (isPresenceTranscriptItem(item)) {
    return appendTranscriptItemToPresenceBlock(currentBlock, item);
  }
  if (isMembershipNoticeTranscriptItem(item)) {
    return appendTranscriptItemToMembershipTraceBlock(currentBlock, item);
  }
  if (currentBlock.groupKey !== item.groupKey) {
    return null;
  }
  return appendTranscriptItemToBlock(currentBlock, item);
}

function coalescePresenceTraceBlocksAcrossSingleForeignPresence(
  blocks: readonly TranscriptBlockViewState[]
): TranscriptBlockViewState[] {
  const coalescedBlocks: TranscriptBlockViewState[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const currentBlock = blocks[index];
    const foreignPresenceBlock = blocks[index + 1];
    const nextSameActorBlock = blocks[index + 2];

    if (
      currentBlock &&
      foreignPresenceBlock &&
      nextSameActorBlock &&
      canCoalescePresenceTraceAcrossSingleForeignPresence({
        current: currentBlock,
        foreign: foreignPresenceBlock,
        next: nextSameActorBlock,
      })
    ) {
      const coalescedCurrentBlock =
        currentBlock as TranscriptPresenceTraceBlockViewState;
      const coalescedForeignBlock =
        foreignPresenceBlock as TranscriptPresenceTraceBlockViewState;
      const coalescedNextBlock =
        nextSameActorBlock as TranscriptPresenceTraceBlockViewState;
      coalescedBlocks.push(
        mergePresenceTraceBlocks(coalescedCurrentBlock, coalescedNextBlock)
      );
      coalescedBlocks.push(coalescedForeignBlock);
      index += 2;
      continue;
    }

    if (currentBlock) {
      coalescedBlocks.push(currentBlock);
    }
  }

  return coalescedBlocks;
}

function buildHumanTranscriptBlocks(input: {
  allBlocks: readonly TranscriptBlockViewState[];
  firstJoinBlocks: readonly TranscriptPresenceFirstJoinBlockViewState[];
}): TranscriptBlockViewState[] {
  const transcriptBlocks: TranscriptBlockViewState[] = [];
  const firstJoinBlockByActorKey = new Map(
    input.firstJoinBlocks.map((block) => [block.actorKey, block] as const)
  );
  const emittedFirstJoinActorKeys = new Set<string>();

  for (const block of input.allBlocks) {
    if (block.kind === "presence_trace_group") {
      const firstJoinBlock = firstJoinBlockByActorKey.get(block.actorKey);
      if (firstJoinBlock && !emittedFirstJoinActorKeys.has(block.actorKey)) {
        transcriptBlocks.push(firstJoinBlock);
        emittedFirstJoinActorKeys.add(block.actorKey);
      }
      continue;
    }

    if (block.kind === "membership_trace_group") {
      transcriptBlocks.push(block);
      continue;
    }

    if (block.kind === "system_group") {
      const importantEntries = block.lines.flatMap((line, index) => {
        const purpose = block.purposes[index] ?? null;
        if (!isImportantSystemNoticeEntry({ line, purpose })) {
          return [];
        }
        return [{ line, purpose }] as const;
      });
      const importantLines = importantEntries.map((entry) => entry.line);
      if (importantLines.length > 0) {
        transcriptBlocks.push({
          ...block,
          lines: importantLines,
          purposes: importantEntries.map((entry) => entry.purpose),
        });
      }
      continue;
    }

    transcriptBlocks.push(block);
  }

  return transcriptBlocks;
}

function coalesceAdjacentHumanPlainTextBlocks(
  blocks: readonly TranscriptBlockViewState[]
): TranscriptBlockViewState[] {
  const coalescedBlocks: TranscriptBlockViewState[] = [];

  for (const block of blocks) {
    const previousBlock = coalescedBlocks.at(-1);
    if (
      previousBlock?.kind === "plain_text_group" &&
      block.kind === "plain_text_group" &&
      canCoalesceAdjacentHumanPlainTextBlocks(previousBlock, block)
    ) {
      coalescedBlocks[coalescedBlocks.length - 1] = {
        ...previousBlock,
        messages: [...previousBlock.messages, ...block.messages],
      };
      continue;
    }
    coalescedBlocks.push(block);
  }

  return coalescedBlocks;
}

function canCoalesceAdjacentHumanPlainTextBlocks(
  previousBlock: TranscriptBlockViewState | undefined,
  nextBlock: TranscriptBlockViewState
): previousBlock is TranscriptPlainTextBlockViewState {
  if (
    !(
      previousBlock?.kind === "plain_text_group" &&
      nextBlock.kind === "plain_text_group"
    )
  ) {
    return false;
  }

  return (
    previousBlock.groupKey === nextBlock.groupKey &&
    previousBlock.speakerProfileId === nextBlock.speakerProfileId &&
    previousBlock.speakerKind === nextBlock.speakerKind &&
    previousBlock.highlightKind === nextBlock.highlightKind
  );
}

function buildHumanLogsSections(input: {
  allBlocks: readonly TranscriptBlockViewState[];
  firstJoinBlocks: readonly TranscriptPresenceFirstJoinBlockViewState[];
}): readonly HumanLogsSectionViewState[] {
  const presenceItems = [
    ...input.firstJoinBlocks.map((block, index) => ({
      id: `presence:first-join:${String(index)}`,
      lines: buildPresenceFirstJoinRows(block),
    })),
    ...input.allBlocks.flatMap((block, index) => {
      if (block.kind !== "presence_trace_group") {
        return [];
      }
      return [
        {
          id: `presence:trace:${String(index)}`,
          lines: [buildPresenceTraceRowText(block)],
        },
      ];
    }),
  ];
  const membershipItems = input.allBlocks.flatMap((block, index) => {
    if (block.kind !== "membership_trace_group") {
      return [];
    }
    return [
      {
        id: `membership:${String(index)}`,
        lines: buildMembershipTraceRows(block),
      },
    ];
  });
  const systemItems = input.allBlocks.flatMap((block, index) => {
    if (block.kind !== "system_group") {
      return [];
    }
    return [
      {
        id: `system:${String(index)}`,
        lines: buildSystemClusterRowsFromSystemLines(block.lines),
      },
    ];
  });

  return [
    buildHumanLogsSection("system", "System", systemItems),
    buildHumanLogsSection("membership", "Membership", membershipItems),
    buildHumanLogsSection("presence", "Presence", presenceItems),
  ];
}

function buildHumanLogsSection(
  kind: HumanLogsSectionKind,
  title: string,
  items: readonly HumanLogsItemViewState[]
): HumanLogsSectionViewState {
  return {
    kind,
    title,
    items,
    lines: items.flatMap((item) => item.lines),
  };
}

function buildPresenceFirstJoinBlocks(
  items: readonly SpaceTranscriptItem[],
  membersSnapshot: SpaceMembersSnapshot | null
): TranscriptPresenceFirstJoinBlockViewState[] {
  const blocks: TranscriptPresenceFirstJoinBlockViewState[] = [];
  const seenActorKeys = new Set<string>();
  const actorKeysWithPriorTranscriptActivity = new Set<string>();

  for (const item of items) {
    const nextBlock = buildPresenceFirstJoinBlock({
      item,
      membersSnapshot,
      seenActorKeys,
      actorKeysWithPriorTranscriptActivity,
    });
    if (nextBlock) {
      blocks.push(nextBlock);
    }

    registerTranscriptActorActivity(item, actorKeysWithPriorTranscriptActivity);
  }

  return blocks;
}

function buildPresenceFirstJoinBlock(input: {
  item: SpaceTranscriptItem;
  membersSnapshot: SpaceMembersSnapshot | null;
  seenActorKeys: Set<string>;
  actorKeysWithPriorTranscriptActivity: ReadonlySet<string>;
}): TranscriptPresenceFirstJoinBlockViewState | null {
  if (
    !(
      isPresenceTranscriptItem(input.item) &&
      input.item.presenceAction === "join"
    )
  ) {
    return null;
  }

  const actorKey = resolvePresenceActorKey(input.item);
  if (!actorKey || input.seenActorKeys.has(actorKey)) {
    return null;
  }

  input.seenActorKeys.add(actorKey);
  if (
    !shouldRenderPresenceFirstJoinBlock({
      item: input.item,
      actorKey,
      membersSnapshot: input.membersSnapshot,
      actorKeysWithPriorTranscriptActivity:
        input.actorKeysWithPriorTranscriptActivity,
    })
  ) {
    return null;
  }

  const actorIdentity = resolvePresenceActorIdentity(
    input.item,
    input.membersSnapshot
  );
  return {
    kind: "presence_first_join_group",
    groupKey: input.item.groupKey,
    actorKey,
    actorProfileId: input.item.actorProfileId?.trim() || null,
    actorKind: input.item.actorKind ?? "unknown",
    actorAvatar:
      input.item.actorAvatar?.trim() || resolvePresenceActorAvatar(input.item),
    actorLabel: input.item.actorLabel?.trim() || "unknown",
    actorOwnerUserId: actorIdentity.ownerUserId,
    actorOwnerName: actorIdentity.ownerName,
    ts: typeof input.item.ts === "number" ? input.item.ts : 0,
  };
}

function shouldRenderPresenceFirstJoinBlock(input: {
  item: SpaceTranscriptItem;
  actorKey: string;
  membersSnapshot: SpaceMembersSnapshot | null;
  actorKeysWithPriorTranscriptActivity: ReadonlySet<string>;
}): boolean {
  if (input.actorKeysWithPriorTranscriptActivity.has(input.actorKey)) {
    return false;
  }

  const knownFirstEnteredAtMs = resolvePresenceActorFirstEnteredAtMs(
    input.item,
    input.membersSnapshot
  );
  if (knownFirstEnteredAtMs === null) {
    return true;
  }

  const joinTs = typeof input.item.ts === "number" ? input.item.ts : null;
  return joinTs !== null && joinTs === knownFirstEnteredAtMs;
}

function registerTranscriptActorActivity(
  item: SpaceTranscriptItem,
  actorKeys: Set<string>
): void {
  for (const actorKey of resolveTranscriptActorActivityKeys(item)) {
    actorKeys.add(actorKey);
  }
}

function resolveTranscriptActorActivityKeys(
  item: SpaceTranscriptItem
): readonly string[] {
  if (isPresenceTranscriptItem(item)) {
    const actorKey = resolvePresenceActorKey(item);
    return actorKey ? [actorKey] : [];
  }

  if (isMembershipNoticeTranscriptItem(item)) {
    const notice = resolveMembershipNoticePayload(item);
    if (!notice) {
      return [];
    }
    const actorKey = resolveMembershipActorKey(notice);
    return actorKey ? [actorKey] : [];
  }

  const actorKey = resolveTranscriptContentActorKey(item);
  return actorKey ? [actorKey] : [];
}

function resolveTranscriptContentActorKey(item: SpaceTranscriptItem): string {
  const itemProfileId = item.profile?.profileId?.trim();
  if (itemProfileId) {
    return itemProfileId;
  }

  const groupProfileId = resolveProfileIdFromGroupKey(item.groupKey);
  if (groupProfileId) {
    return groupProfileId;
  }

  const itemProfileName = item.profile?.profileName?.trim();
  if (
    (item.profile?.kind === "human" ||
      item.profile?.kind === "agent" ||
      item.profile?.kind === "unknown") &&
    itemProfileName
  ) {
    return `${item.profile.kind}:${itemProfileName}`;
  }

  const fallbackMatch = PROFILE_GROUP_KEY_PATTERN.exec(item.groupKey);
  if (!fallbackMatch) {
    return "";
  }

  return `${fallbackMatch[1]}:${fallbackMatch[2]}`;
}

function attachCurrentPresenceStatusToLastMessageCards(
  blocks: readonly TranscriptBlockViewState[],
  membersSnapshot: SpaceMembersSnapshot | null,
  items: readonly SpaceTranscriptItem[]
): TranscriptBlockViewState[] {
  const lastMessageLocationByActorKey = new Map<
    string,
    { blockIndex: number; messageIndex: number }
  >();
  const currentStatusByActorKey = buildCurrentPresenceStatusByActorKey({
    items,
    membersSnapshot,
  });

  for (const [blockIndex, block] of blocks.entries()) {
    if (!(block.kind === "plain_text_group" && block.speakerProfileId)) {
      continue;
    }
    lastMessageLocationByActorKey.set(block.speakerProfileId, {
      blockIndex,
      messageIndex: block.messages.length - 1,
    });
  }

  return blocks.map((block, blockIndex) => {
    if (!(block.kind === "plain_text_group" && block.speakerProfileId)) {
      return block;
    }

    const lastMessageLocation = lastMessageLocationByActorKey.get(
      block.speakerProfileId
    );
    if (!lastMessageLocation || lastMessageLocation.blockIndex !== blockIndex) {
      return block;
    }

    const currentStatus =
      currentStatusByActorKey.get(block.speakerProfileId) ?? null;
    if (!currentStatus) {
      return block;
    }

    return {
      ...block,
      messages: block.messages.map((message, messageIndex) => ({
        ...message,
        headerPresenceBadge:
          messageIndex === lastMessageLocation.messageIndex &&
          !message.headerTypeBadge
            ? currentStatus
            : null,
      })),
    };
  });
}

function buildCurrentPresenceStatusByActorKey(input: {
  items: readonly SpaceTranscriptItem[];
  membersSnapshot: SpaceMembersSnapshot | null;
}): Map<string, "live now"> {
  const statusByActorKey = new Map<string, "live now">();

  for (const human of input.membersSnapshot?.humans ?? []) {
    if (human.liveNow) {
      statusByActorKey.set(human.profileId, "live now");
    }
  }

  for (const agent of input.membersSnapshot?.agents ?? []) {
    if (agent.liveNow) {
      statusByActorKey.set(agent.profileId, "live now");
    }
  }

  const snapshotActorKeys = new Set(statusByActorKey.keys());

  for (const item of input.items) {
    if (!isPresenceTranscriptItem(item)) {
      continue;
    }
    const actorKey = resolvePresenceActorKey(item);
    if (!(actorKey && !snapshotActorKeys.has(actorKey))) {
      continue;
    }
    if (item.presenceAction === "join") {
      statusByActorKey.set(actorKey, "live now");
    }
  }

  return statusByActorKey;
}

function isImportantSystemNoticeEntry(input: {
  line: string;
  purpose?: string | null;
}): boolean {
  return isImportantHumanSystemNotice(input);
}

function canCoalescePresenceTraceAcrossSingleForeignPresence(input: {
  current: TranscriptBlockViewState;
  foreign: TranscriptBlockViewState;
  next: TranscriptBlockViewState;
}): input is {
  current: TranscriptPresenceTraceBlockViewState;
  foreign: TranscriptPresenceTraceBlockViewState;
  next: TranscriptPresenceTraceBlockViewState;
} {
  if (
    !(
      input.current.kind === "presence_trace_group" &&
      input.foreign.kind === "presence_trace_group" &&
      input.next.kind === "presence_trace_group"
    )
  ) {
    return false;
  }

  if (input.current.actorKey !== input.next.actorKey) {
    return false;
  }

  if (input.current.actorKey === input.foreign.actorKey) {
    return false;
  }

  if (input.next.startTs < input.current.endTs) {
    return false;
  }

  if (input.next.startTs - input.current.endTs > PRESENCE_TRACE_MAX_GAP_MS) {
    return false;
  }

  if (input.next.endTs - input.current.startTs > PRESENCE_TRACE_MAX_SPAN_MS) {
    return false;
  }

  return true;
}

function mergePresenceTraceBlocks(
  current: TranscriptPresenceTraceBlockViewState,
  next: TranscriptPresenceTraceBlockViewState
): TranscriptPresenceTraceBlockViewState {
  return {
    ...current,
    endTs: next.endTs,
    joinCount: current.joinCount + next.joinCount,
    leftCount: current.leftCount + next.leftCount,
    count: current.count + next.count,
  };
}

export function renderTranscriptBlock(
  block: TranscriptBlockViewState,
  width: number
): string[] {
  switch (block.kind) {
    case "system_group":
      return renderSystemClusterRowsFromSystemLines(block.lines, width);
    case "presence_first_join_group":
      return wrapBubbleLine(buildPresenceFirstJoinRowText(block), width);
    case "presence_trace_group":
      return renderPresenceTraceBlock(block, width);
    case "membership_trace_group":
      return renderMembershipTraceBlock(block, width);
    case "plain_text_group":
      return renderPlainTextBubbleGroup(block, width);
    default:
      return [];
  }
}

export function renderTranscriptBlocks(
  blocks: readonly TranscriptBlockViewState[],
  width: number
): string[] {
  const lines: string[] = [];
  const sections = buildTranscriptRenderSections(blocks);

  for (const [index, section] of sections.entries()) {
    const renderedSectionLines = renderTranscriptRenderSection(section, width);
    if (renderedSectionLines.length === 0) {
      continue;
    }
    if (lines.length > 0) {
      lines.push(
        ...renderTranscriptSectionGapLines({
          previous: sections[index - 1] ?? null,
          next: section,
          width,
        })
      );
    }
    lines.push(...renderedSectionLines);
  }

  return lines;
}

function buildTranscriptRenderSections(
  blocks: readonly TranscriptBlockViewState[]
): TranscriptRenderSection[] {
  const sections: TranscriptRenderSection[] = [];

  for (const block of blocks) {
    if (block.kind === "plain_text_group") {
      sections.push({
        kind: "plain_text_group",
        block,
      });
      continue;
    }

    const currentSection = sections.at(-1);
    if (currentSection?.kind === "system_cluster") {
      sections[sections.length - 1] = {
        ...currentSection,
        blocks: [...currentSection.blocks, block],
      };
      continue;
    }

    sections.push({
      kind: "system_cluster",
      blocks: [block],
    });
  }

  return sections;
}

function renderTranscriptRenderSection(
  section: TranscriptRenderSection,
  width: number
): string[] {
  if (section.kind === "plain_text_group") {
    return renderTranscriptBlock(section.block, width);
  }
  return renderTranscriptSystemCluster(section.blocks, width);
}

function resolveTranscriptSectionGapLines(input: {
  previous: TranscriptRenderSection | null;
  next: TranscriptRenderSection;
}): number {
  if (
    input.previous?.kind === "system_cluster" ||
    input.next.kind === "system_cluster"
  ) {
    return 1;
  }
  return TRANSCRIPT_GROUP_GAP_LINES;
}

function renderTranscriptSectionGapLines(input: {
  previous: TranscriptRenderSection | null;
  next: TranscriptRenderSection;
  width: number;
}): string[] {
  if (shouldRenderTranscriptSectionSeparator(input.previous, input.next)) {
    return [renderTranscriptSectionSeparatorLine(input.width)];
  }

  const gapLines: string[] = [];
  appendEmptyLines(
    gapLines,
    resolveTranscriptSectionGapLines({
      previous: input.previous,
      next: input.next,
    })
  );
  return gapLines;
}

function shouldRenderTranscriptSectionSeparator(
  previous: TranscriptRenderSection | null,
  next: TranscriptRenderSection
): boolean {
  if (
    !(previous?.kind === "plain_text_group" && next.kind === "plain_text_group")
  ) {
    return false;
  }

  return previous.block.speakerProfileId !== next.block.speakerProfileId;
}

function renderTranscriptSectionSeparatorLine(width: number): string {
  const separator = pc.dim("-");
  const availableWidth = Math.max(width, 1);
  const separatorWidth = stringWidth("-");

  if (availableWidth <= separatorWidth) {
    return separator;
  }

  const leftPadding = Math.floor((availableWidth - separatorWidth) / 2);
  return `${" ".repeat(leftPadding)}${separator}`;
}

function createTranscriptBlock(input: {
  groupKey: string;
  item: SpaceTranscriptItem;
  membersSnapshot?: SpaceMembersSnapshot | null;
  sessionProfile?: TranscriptSessionProfile | null;
}): TranscriptBlockViewState {
  if (isPresenceTranscriptItem(input.item)) {
    return createTranscriptPresenceTraceBlock(
      input.item,
      input.membersSnapshot ?? null
    );
  }

  if (isMembershipNoticeTranscriptItem(input.item)) {
    return createTranscriptMembershipTraceBlock(
      input.item,
      input.membersSnapshot ?? null
    );
  }

  if (resolveTranscriptItemKind(input.item) === "system_notice") {
    const lines = splitTranscriptMultilineLines(input.item.line);
    return {
      kind: "system_group",
      groupKey: input.groupKey,
      lines,
      purposes: lines.map(() => input.item.systemPurpose ?? null),
      sourceNoticeCount: 1,
    };
  }

  const speakerKind = resolveTranscriptBubbleSpeakerKind({
    groupKey: input.groupKey,
    itemProfile: input.item.profile,
    membersSnapshot: input.membersSnapshot ?? null,
    sessionProfile: input.sessionProfile ?? null,
  });
  const speakerProfileIdentity = resolveTranscriptSpeakerIdentity({
    groupKey: input.groupKey,
    itemProfile: input.item.profile,
    membersSnapshot: input.membersSnapshot ?? null,
    speakerKind,
    sessionProfile: input.sessionProfile ?? null,
  });
  return {
    kind: "plain_text_group",
    groupKey: input.groupKey,
    spaceMembersSnapshot: input.membersSnapshot ?? null,
    speakerKind,
    highlightKind: resolveTranscriptBubbleHighlightKind({
      groupKey: input.groupKey,
      membersSnapshot: input.membersSnapshot ?? null,
      sessionProfile: input.sessionProfile ?? null,
    }),
    speakerProfileId: speakerProfileIdentity.profileId,
    speakerProfileName: speakerProfileIdentity.profileName,
    speakerOwnerUserId: speakerProfileIdentity.ownerUserId ?? null,
    speakerOwnerName: speakerProfileIdentity.ownerName ?? null,
    speakerAgentControllerRef:
      speakerProfileIdentity.agentControllerRef ?? null,
    speakerControllerDisplay: speakerProfileIdentity.controllerDisplay ?? null,
    speakerOwnerDisplay: speakerProfileIdentity.ownerDisplay ?? null,
    messages: [
      createTranscriptBubbleMessage({
        item: input.item,
        speakerIdentity: speakerProfileIdentity,
        spaceMembersSnapshot: input.membersSnapshot ?? null,
      }),
    ],
  };
}

function appendTranscriptItemToBlock(
  block: TranscriptBlockViewState,
  item: SpaceTranscriptItem
): TranscriptBlockViewState | null {
  if (block.kind === "system_group") {
    if (resolveTranscriptItemKind(item) !== "system_notice") {
      return null;
    }
    return {
      ...block,
      lines: [...block.lines, ...splitTranscriptMultilineLines(item.line)],
      purposes: [
        ...block.purposes,
        ...splitTranscriptMultilineLines(item.line).map(
          () => item.systemPurpose ?? null
        ),
      ],
      sourceNoticeCount: block.sourceNoticeCount + 1,
    };
  }

  if (block.kind === "plain_text_group") {
    if (resolveTranscriptItemKind(item) !== "message") {
      return null;
    }
    return {
      ...block,
      messages: [
        ...block.messages,
        createTranscriptBubbleMessage({
          item,
          speakerIdentity: {
            profileId: block.speakerProfileId,
            profileName: block.speakerProfileName,
            kind: block.speakerKind,
            agentControllerRef: block.speakerAgentControllerRef ?? null,
            ownerUserId: block.speakerOwnerUserId ?? null,
            ownerName: block.speakerOwnerName ?? null,
            controllerDisplay: block.speakerControllerDisplay ?? null,
            ownerDisplay: block.speakerOwnerDisplay ?? null,
          },
          spaceMembersSnapshot: block.spaceMembersSnapshot ?? null,
        }),
      ],
    };
  }

  if (block.kind === "membership_trace_group") {
    return appendTranscriptItemToMembershipTraceBlock(block, item);
  }

  return appendTranscriptItemToPresenceBlock(block, item);
}

function appendTranscriptItemToPresenceBlock(
  block: TranscriptBlockViewState,
  item: SpaceTranscriptItem
): TranscriptPresenceTraceBlockViewState | null {
  if (
    !(block.kind === "presence_trace_group" && isPresenceTranscriptItem(item))
  ) {
    return null;
  }
  const actorKey = resolvePresenceActorKey(item);
  if (!actorKey || actorKey !== block.actorKey) {
    return null;
  }
  if (typeof item.ts !== "number" || item.ts < block.endTs) {
    return null;
  }
  if (item.ts - block.endTs > PRESENCE_TRACE_MAX_GAP_MS) {
    return null;
  }
  if (item.ts - block.startTs > PRESENCE_TRACE_MAX_SPAN_MS) {
    return null;
  }
  return {
    ...block,
    endTs: item.ts,
    joinCount: block.joinCount + (item.presenceAction === "join" ? 1 : 0),
    leftCount: block.leftCount + (item.presenceAction === "left" ? 1 : 0),
    count: block.count + 1,
  };
}

function appendTranscriptItemToMembershipTraceBlock(
  block: TranscriptBlockViewState,
  item: SpaceTranscriptItem
): TranscriptMembershipTraceBlockViewState | null {
  const notice = resolveMembershipNoticePayload(item);
  if (!(block.kind === "membership_trace_group" && notice)) {
    return null;
  }

  const actorKey = resolveMembershipActorKey(notice);
  if (!actorKey || actorKey !== block.actorKey) {
    return null;
  }
  if (notice.action !== block.action) {
    return null;
  }
  if (notice.ts < block.endTs) {
    return null;
  }
  if (notice.ts - block.endTs > MEMBERSHIP_TRACE_MAX_GAP_MS) {
    return null;
  }

  return {
    ...block,
    endTs: notice.ts,
    targets: [
      ...block.targets,
      buildTranscriptMembershipTraceTarget(
        notice,
        block.spaceMembersSnapshot ?? null
      ),
    ],
  };
}

function createTranscriptPresenceTraceBlock(
  item: SpaceTranscriptItem,
  membersSnapshot: SpaceMembersSnapshot | null
): TranscriptPresenceTraceBlockViewState {
  const actorKey = resolvePresenceActorKey(item) || `presence:${item.line}`;
  const actorIdentity = resolvePresenceActorIdentity(item, membersSnapshot);
  const ts = typeof item.ts === "number" ? item.ts : 0;
  return {
    kind: "presence_trace_group",
    groupKey: item.groupKey,
    spaceMembersSnapshot: membersSnapshot,
    actorKey,
    actorProfileId: item.actorProfileId?.trim() || null,
    actorKind: item.actorKind ?? "unknown",
    actorAvatar: item.actorAvatar?.trim() || resolvePresenceActorAvatar(item),
    actorLabel: item.actorLabel?.trim() || "unknown",
    actorOwnerUserId: actorIdentity.ownerUserId,
    actorOwnerName: actorIdentity.ownerName,
    startTs: ts,
    endTs: ts,
    joinCount: item.presenceAction === "join" ? 1 : 0,
    leftCount: item.presenceAction === "left" ? 1 : 0,
    count: 1,
  };
}

function createTranscriptMembershipTraceBlock(
  item: SpaceTranscriptItem,
  membersSnapshot: SpaceMembersSnapshot | null
): TranscriptMembershipTraceBlockViewState {
  const notice = resolveMembershipNoticePayload(item);
  if (!notice) {
    return {
      kind: "membership_trace_group",
      groupKey: item.groupKey,
      spaceMembersSnapshot: membersSnapshot,
      action: "member_added",
      actorKey: `membership:${item.line}`,
      actorProfileId: null,
      actorKind: "unknown",
      actorAvatar: "👤",
      actorLabel: "unknown",
      startTs: typeof item.ts === "number" ? item.ts : 0,
      endTs: typeof item.ts === "number" ? item.ts : 0,
      targets: [],
    };
  }

  const actorKey = resolveMembershipActorKey(notice);
  const actorIdentity = resolveMembershipActorIdentity(notice, membersSnapshot);
  return {
    kind: "membership_trace_group",
    groupKey: item.groupKey,
    spaceMembersSnapshot: membersSnapshot,
    action: notice.action,
    actorKey,
    actorProfileId: notice.actorProfileId?.trim() || null,
    actorKind: actorIdentity.actorKind,
    actorAvatar: actorIdentity.actorAvatar,
    actorLabel: actorIdentity.actorLabel,
    actorOwnerUserId: actorIdentity.ownerUserId,
    actorOwnerName: actorIdentity.ownerName,
    startTs: notice.ts,
    endTs: notice.ts,
    targets: [buildTranscriptMembershipTraceTarget(notice, membersSnapshot)],
  };
}

function buildTranscriptMembershipTraceTarget(
  notice: NonNullable<SpaceTranscriptItem["membershipNotice"]>,
  membersSnapshot: SpaceMembersSnapshot | null
): TranscriptMembershipTraceTargetViewState {
  if (!(notice.targetProfileId && membersSnapshot)) {
    return {
      profileId: notice.targetProfileId,
      kind: notice.targetProfileKind,
      label: notice.targetProfileLabel,
      mentionLabel: notice.mentionLabel,
    };
  }

  if (notice.targetProfileKind === "agent") {
    const agentSnapshot =
      membersSnapshot.agents.find(
        (member) => member.profileId === notice.targetProfileId
      ) ?? null;
    return {
      profileId: notice.targetProfileId,
      kind: notice.targetProfileKind,
      label: agentSnapshot?.profileName ?? notice.targetProfileLabel,
      mentionLabel:
        resolvePrimaryTranscriptMentionLabel({
          profileId: notice.targetProfileId,
          snapshot: membersSnapshot,
        }) ?? notice.mentionLabel,
      ownerUserId: agentSnapshot?.ownerUserId ?? null,
      ownerName: agentSnapshot?.ownerName ?? null,
    };
  }

  const humanSnapshot =
    membersSnapshot.humans.find(
      (member) => member.profileId === notice.targetProfileId
    ) ?? null;
  return {
    profileId: notice.targetProfileId,
    kind: notice.targetProfileKind,
    label: humanSnapshot?.profileName ?? notice.targetProfileLabel,
    mentionLabel: notice.mentionLabel,
    ownerUserId: humanSnapshot?.ownerUserId ?? null,
    ownerName: humanSnapshot?.ownerName ?? null,
  };
}

function createTranscriptBubbleMessage(input: {
  item: SpaceTranscriptItem;
  speakerIdentity: TranscriptSpeakerIdentity;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): TranscriptBubbleMessageViewState {
  const line = input.item.line;
  const rawLines = line.split("\n");
  const header = parseTranscriptBubbleHeader(rawLines[0] ?? "", input.item.ts);
  const structuredBodyLines = input.item.formattedMessage?.bodyLines ?? null;
  const structuredRelationLines =
    input.item.formattedMessage?.relationLines ?? null;
  const structuredMetaLines = input.item.formattedMessage?.metaLines ?? null;
  const detailLines = structuredBodyLines
    ? [...structuredBodyLines.slice(1), ...(structuredMetaLines ?? [])]
    : rawLines.slice(1);
  const { bodyDetailLines, metaLines } = structuredBodyLines
    ? {
        bodyDetailLines: [...structuredBodyLines.slice(1)],
        metaLines: [...(structuredMetaLines ?? [])],
      }
    : splitTranscriptBodyAndMetadataLines(detailLines);
  const bodyLines = structuredBodyLines
    ? [...structuredBodyLines]
    : [
        ...resolveTranscriptBubbleBodyLines({
          parsedBodyLine: header.bodyLine,
          primaryLine: rawLines[0] ?? "",
          speakerIdentity: input.speakerIdentity,
        }),
        ...bodyDetailLines,
      ];
  const headerBaseLeading = resolveTranscriptBubbleHeaderBaseLeading({
    parsedLeading: header.leading,
    speakerIdentity: input.speakerIdentity,
    spaceMembersSnapshot: input.spaceMembersSnapshot,
  });
  const headerAuxLeading = buildTranscriptBubbleHeaderAuxLeading({
    speakerIdentity: input.speakerIdentity,
    spaceMembersSnapshot: input.spaceMembersSnapshot,
  });
  const replyLine = resolveTranscriptBubbleReplyLine({
    replyRef: input.item.replyRef,
    replyWorkflowProjection: input.item.replyWorkflowProjection ?? null,
    membersSnapshot: input.spaceMembersSnapshot ?? null,
  });
  return {
    primaryLine: rawLines[0] ?? "",
    headerBaseLeading,
    headerAuxLeading,
    headerLeading: joinTranscriptBubbleHeaderLeading({
      baseLeading: headerBaseLeading,
      auxLeading: headerAuxLeading,
      typeBadge: input.item.formattedMessage?.headerBadge ?? null,
      presenceBadge: null,
    }),
    headerTypeBadge: input.item.formattedMessage?.headerBadge ?? null,
    headerPresenceBadge: null,
    headerTrailing: header.trailing,
    ...(replyLine ? { replyLine } : {}),
    relationLines: structuredRelationLines ? [...structuredRelationLines] : [],
    bodyLines,
    bodyDetailLines,
    metaLines,
    ...(input.item.formattedMessage?.threadIndicatorLine
      ? {
          threadIndicatorLine: input.item.formattedMessage.threadIndicatorLine,
        }
      : {}),
    detailLines,
    rawLines,
  };
}

function resolveTranscriptBubbleSpeakerKind(input: {
  groupKey: string;
  itemProfile?: SpaceTranscriptItem["profile"];
  membersSnapshot: SpaceMembersSnapshot | null;
  sessionProfile: TranscriptSessionProfile | null;
}): TranscriptBubbleSpeakerKind {
  if (
    input.itemProfile?.kind === "human" ||
    input.itemProfile?.kind === "agent"
  ) {
    return input.itemProfile.kind;
  }
  if (input.groupKey === SYSTEM_TRANSCRIPT_GROUP_KEY) {
    return "unknown";
  }

  const prefixedKind = resolveSpeakerKindFromGroupKey(input.groupKey);
  if (prefixedKind !== "unknown") {
    return prefixedKind;
  }

  const profileId = resolveProfileIdFromGroupKey(input.groupKey);
  if (!(profileId && input.membersSnapshot)) {
    if (profileId && input.sessionProfile?.profileId === profileId) {
      return input.sessionProfile.kind;
    }
    return "unknown";
  }
  if (
    input.membersSnapshot.humans.some(
      (member) => member.profileId === profileId
    )
  ) {
    return "human";
  }
  if (
    input.membersSnapshot.agents.some(
      (member) => member.profileId === profileId
    )
  ) {
    return "agent";
  }
  if (input.sessionProfile?.profileId === profileId) {
    return input.sessionProfile.kind;
  }
  return "unknown";
}

function resolveSpeakerKindFromGroupKey(
  groupKey: string
): TranscriptBubbleSpeakerKind {
  const match = TRANSCRIPT_GROUP_KIND_PATTERN.exec(groupKey);
  return (match?.[1] as TranscriptBubbleSpeakerKind | undefined) ?? "unknown";
}

function resolveProfileIdFromGroupKey(groupKey: string): string {
  const prefix = "profile-id:";
  return groupKey.startsWith(prefix) ? groupKey.slice(prefix.length) : "";
}

function resolveTranscriptSpeakerIdentity(input: {
  groupKey: string;
  itemProfile?: SpaceTranscriptItem["profile"];
  membersSnapshot: SpaceMembersSnapshot | null;
  speakerKind: TranscriptBubbleSpeakerKind;
  sessionProfile: TranscriptSessionProfile | null;
}): TranscriptSpeakerIdentity {
  if (
    input.itemProfile &&
    input.itemProfile.kind !== "unknown" &&
    input.itemProfile.kind !== "system"
  ) {
    return {
      profileId: input.itemProfile.profileId,
      profileName: input.itemProfile.profileName,
      kind: input.itemProfile.kind,
      agentControllerRef: input.itemProfile.agentControllerRef,
      controllerDisplay: resolveControllerDisplayName(
        input.itemProfile.agentControllerRef
      ),
      ownerDisplay:
        input.itemProfile.kind === "agent"
          ? resolveAgentOwnerDisplay({
              ownerName: input.itemProfile.ownerName ?? null,
              ownerUserId: input.itemProfile.ownerUserId ?? null,
              profileName: input.itemProfile.profileName,
            })
          : null,
      ownerUserId: input.itemProfile.ownerUserId ?? null,
      ownerName: input.itemProfile.ownerName ?? null,
    };
  }
  const profileId = resolveProfileIdFromGroupKey(input.groupKey) || null;
  const humanSnapshot =
    input.membersSnapshot?.humans.find(
      (member) => member.profileId === profileId
    ) ?? null;
  const agentSnapshot =
    input.membersSnapshot?.agents.find(
      (member) => member.profileId === profileId
    ) ?? null;

  if (agentSnapshot) {
    return {
      profileId,
      profileName: agentSnapshot.profileName,
      kind: "agent",
      agentControllerRef: agentSnapshot.agentControllerRef,
      controllerDisplay: resolveControllerDisplayName(
        agentSnapshot.agentControllerRef
      ),
      ownerDisplay: resolveAgentOwnerDisplay(agentSnapshot),
      ownerUserId: agentSnapshot.ownerUserId,
      ownerName: agentSnapshot.ownerName,
    };
  }

  if (humanSnapshot) {
    return {
      profileId,
      profileName: humanSnapshot.profileName,
      kind: "human",
      ownerUserId: humanSnapshot.ownerUserId,
      ownerName: humanSnapshot.ownerName,
    };
  }

  if (profileId && input.sessionProfile?.profileId === profileId) {
    return {
      profileId,
      profileName: input.sessionProfile.profileName,
      kind: input.sessionProfile.kind,
      ownerUserId: input.sessionProfile.ownerUserId,
      ownerName: input.sessionProfile.ownerName,
    };
  }

  return {
    profileId,
    profileName: profileId || "unknown",
    kind: input.speakerKind,
  };
}

function renderPlainTextBubbleGroup(
  block: TranscriptPlainTextBlockViewState,
  width: number
): string[] {
  const contentWidth = resolveBubbleContentWidth(width);
  const lines: string[] = [];

  for (const message of block.messages) {
    if (lines.length > 0) {
      appendEmptyLines(lines, TRANSCRIPT_BUBBLE_GAP_LINES);
    }
    lines.push(...renderTranscriptBubbleMessage(message, block, contentWidth));
  }

  return lines;
}

function renderTranscriptBubbleMessage(
  message: TranscriptBubbleMessageViewState,
  block: TranscriptPlainTextBlockViewState,
  contentWidth: number
): string[] {
  const lines: string[] = [];
  appendBubblePaddingLines(
    lines,
    TRANSCRIPT_BUBBLE_VERTICAL_PADDING,
    block,
    contentWidth
  );

  const headerLines = renderTranscriptBubbleHeaderLines({
    leading: joinTranscriptBubbleHeaderLeading({
      baseLeading: message.headerBaseLeading ?? message.headerLeading,
      auxLeading: message.headerAuxLeading ?? null,
      typeBadge: message.headerTypeBadge ?? null,
      presenceBadge: message.headerPresenceBadge ?? null,
    }),
    trailing: message.headerTrailing,
    contentWidth,
  });
  appendRenderedBubbleLines(lines, headerLines, block, contentWidth);
  appendTranscriptBubbleReplyLines({
    block,
    contentWidth,
    headerLineCount: headerLines.length,
    lines,
    replyLine: message.replyLine,
  });
  appendTranscriptBubbleRelationLines({
    block,
    contentWidth,
    hasReplyLine: Boolean(message.replyLine),
    headerLineCount: headerLines.length,
    lines,
    relationLines: message.relationLines,
  });
  appendTranscriptBubbleBodyGap({
    block,
    bodyLineCount: message.bodyLines.length,
    contentWidth,
    hasReplyLine: Boolean(message.replyLine),
    hasRelationLines: message.relationLines.length > 0,
    headerLineCount: headerLines.length,
    lines,
  });
  appendTranscriptBubbleBodyLines({
    block,
    bodyLines: message.bodyLines,
    contentWidth,
    hasReplyLine: Boolean(message.replyLine),
    hasRelationLines: message.relationLines.length > 0,
    lines,
  });
  appendTranscriptBubbleMetaSection({
    block,
    contentWidth,
    lines,
    metaLines: buildTranscriptBubbleMetaLines(message.metaLines, block),
  });
  appendThreadIndicatorLine({
    block,
    contentWidth,
    lines,
    threadIndicatorLine: message.threadIndicatorLine,
  });

  appendBubblePaddingLines(
    lines,
    TRANSCRIPT_BUBBLE_VERTICAL_PADDING,
    block,
    contentWidth
  );
  return lines;
}

function appendRenderedBubbleLines(
  lines: string[],
  renderedLines: readonly string[],
  block: TranscriptPlainTextBlockViewState,
  contentWidth: number
): void {
  for (const renderedLine of renderedLines) {
    lines.push(renderBubbleLine(renderedLine, block, contentWidth));
  }
}

function appendTranscriptBubbleReplyLines(input: {
  block: TranscriptPlainTextBlockViewState;
  contentWidth: number;
  headerLineCount: number;
  lines: string[];
  replyLine: string | null | undefined;
}): void {
  if (!input.replyLine) {
    return;
  }

  if (input.headerLineCount > 0) {
    appendBubblePaddingLines(
      input.lines,
      TRANSCRIPT_BUBBLE_META_GAP_LINES,
      input.block,
      input.contentWidth
    );
  }

  appendWrappedBubbleLines(
    input.lines,
    [pc.dim(input.replyLine)],
    input.block,
    input.contentWidth
  );
}

function appendTranscriptBubbleBodyGap(input: {
  block: TranscriptPlainTextBlockViewState;
  bodyLineCount: number;
  contentWidth: number;
  hasReplyLine: boolean;
  hasRelationLines: boolean;
  headerLineCount: number;
  lines: string[];
}): void {
  if (
    input.bodyLineCount === 0 ||
    input.headerLineCount === 0 ||
    input.hasReplyLine ||
    input.hasRelationLines
  ) {
    return;
  }

  appendBubblePaddingLines(
    input.lines,
    TRANSCRIPT_BUBBLE_META_GAP_LINES,
    input.block,
    input.contentWidth
  );
}

function appendTranscriptBubbleBodyLines(input: {
  block: TranscriptPlainTextBlockViewState;
  bodyLines: readonly string[];
  contentWidth: number;
  hasReplyLine: boolean;
  hasRelationLines: boolean;
  lines: string[];
}): void {
  const bodyPrefixes = resolveTranscriptBubbleBodyPrefixes({
    hasReplyLine: input.hasReplyLine,
    hasRelationLines: input.hasRelationLines,
  });
  for (const [index, bodyLine] of input.bodyLines.entries()) {
    const wrappedBodyLines = wrapBubbleBodyLine({
      line: bodyLine,
      contentWidth: input.contentWidth,
      leadPrefix:
        index === 0
          ? bodyPrefixes.firstLinePrefix
          : bodyPrefixes.otherLinePrefix,
      continuationPrefix: bodyPrefixes.otherLinePrefix,
    });
    appendRenderedBubbleLines(
      input.lines,
      wrappedBodyLines,
      input.block,
      input.contentWidth
    );
  }
}

function appendTranscriptBubbleRelationLines(input: {
  block: TranscriptPlainTextBlockViewState;
  contentWidth: number;
  hasReplyLine: boolean;
  headerLineCount: number;
  lines: string[];
  relationLines: readonly string[];
}): void {
  if (input.relationLines.length === 0) {
    return;
  }

  if (!input.hasReplyLine && input.headerLineCount > 0) {
    appendBubblePaddingLines(
      input.lines,
      TRANSCRIPT_BUBBLE_META_GAP_LINES,
      input.block,
      input.contentWidth
    );
  }

  appendWrappedBubbleLines(
    input.lines,
    input.relationLines.map((line) => pc.dim(line)),
    input.block,
    input.contentWidth
  );
}

function appendThreadIndicatorLine(input: {
  block: TranscriptPlainTextBlockViewState;
  contentWidth: number;
  lines: string[];
  threadIndicatorLine: string | null | undefined;
}): void {
  if (!input.threadIndicatorLine) {
    return;
  }
  appendBubblePaddingLines(
    input.lines,
    TRANSCRIPT_BUBBLE_META_GAP_LINES,
    input.block,
    input.contentWidth
  );
  appendWrappedBubbleLines(
    input.lines,
    [pc.dim(input.threadIndicatorLine)],
    input.block,
    input.contentWidth
  );
}

function appendTranscriptBubbleMetaSection(input: {
  block: TranscriptPlainTextBlockViewState;
  contentWidth: number;
  lines: string[];
  metaLines: ReturnType<typeof buildTranscriptBubbleMetaLines>;
}): void {
  if (
    input.metaLines.wrappedLines.length === 0 &&
    input.metaLines.unwrappedLines.length === 0
  ) {
    return;
  }

  appendBubblePaddingLines(
    input.lines,
    TRANSCRIPT_BUBBLE_META_GAP_LINES,
    input.block,
    input.contentWidth
  );
  appendWrappedBubbleLines(
    input.lines,
    input.metaLines.wrappedLines.map((line) => pc.dim(line)),
    input.block,
    input.contentWidth
  );
  appendRenderedBubbleLines(
    input.lines,
    input.metaLines.unwrappedLines.map((line) => pc.dim(line)),
    input.block,
    input.contentWidth
  );
}

function appendWrappedBubbleLines(
  lines: string[],
  sourceLines: readonly string[],
  block: TranscriptPlainTextBlockViewState,
  contentWidth: number
): void {
  for (const sourceLine of sourceLines) {
    appendRenderedBubbleLines(
      lines,
      wrapBubbleLine(sourceLine, contentWidth),
      block,
      contentWidth
    );
  }
}

function renderTranscriptBubbleHeaderLines(input: {
  leading: string;
  trailing: string;
  contentWidth: number;
}): string[] {
  if (!(input.leading || input.trailing)) {
    return [];
  }
  if (!input.trailing) {
    return wrapBubbleLine(input.leading, input.contentWidth);
  }
  if (!input.leading) {
    return [
      alignTranscriptBubbleHeaderTrailing(input.trailing, input.contentWidth),
    ];
  }

  const combinedWidth =
    measureVisibleWidth(input.leading) + measureVisibleWidth(input.trailing);
  if (combinedWidth <= input.contentWidth) {
    const spacingWidth = input.contentWidth - combinedWidth;
    return [`${input.leading}${" ".repeat(spacingWidth)}${input.trailing}`];
  }

  return [
    ...wrapBubbleLine(input.leading, input.contentWidth),
    alignTranscriptBubbleHeaderTrailing(input.trailing, input.contentWidth),
  ];
}

function alignTranscriptBubbleHeaderTrailing(
  trailing: string,
  contentWidth: number
): string {
  return `${" ".repeat(Math.max(0, contentWidth - measureVisibleWidth(trailing)))}${trailing}`;
}

function buildTranscriptBubbleHeaderAuxLeading(input: {
  speakerIdentity: TranscriptSpeakerIdentity;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): string | null {
  if (input.speakerIdentity.kind !== "agent") {
    return null;
  }

  const headerSegments: string[] = [];
  const controllerDisplay =
    input.speakerIdentity.controllerDisplay?.trim() || "";
  const ownerDisplay = input.speakerIdentity.ownerDisplay?.trim() || "";

  if (controllerDisplay) {
    headerSegments.push(
      pc.dim(" · "),
      colorizeAgentLabel(
        controllerDisplay,
        {
          agentControllerRef: input.speakerIdentity.agentControllerRef,
          profileId: input.speakerIdentity.profileId,
          profileName: input.speakerIdentity.profileName,
        },
        {
          spaceMembersSnapshot: input.spaceMembersSnapshot,
        }
      )
    );
  }

  if (ownerDisplay) {
    headerSegments.push(
      pc.dim(" · "),
      pc.dim("by "),
      colorizePersonLabel(
        ownerDisplay,
        {
          ownerUserId: input.speakerIdentity.ownerUserId,
          ownerName: input.speakerIdentity.ownerName,
          profileName: ownerDisplay,
        },
        {
          spaceMembersSnapshot: input.spaceMembersSnapshot,
        }
      )
    );
  }

  return headerSegments.length > 0 ? headerSegments.join("") : null;
}

function resolveTranscriptBubbleReplyLine(input: {
  replyRef?: SpaceTranscriptItem["replyRef"];
  replyWorkflowProjection?:
    | SpaceTranscriptItem["replyWorkflowProjection"]
    | null;
  membersSnapshot: SpaceMembersSnapshot | null;
}): string | null {
  return buildHumanReplyWorkflowTranscriptCueLine({
    membersSnapshot: input.membersSnapshot,
    replyRef: input.replyRef,
    replyWorkflowProjection: input.replyWorkflowProjection ?? null,
  });
}

function joinTranscriptBubbleHeaderLeading(input: {
  baseLeading: string;
  auxLeading: string | null;
  typeBadge: TranscriptBubbleMessageViewState["headerTypeBadge"];
  presenceBadge: TranscriptBubbleMessageViewState["headerPresenceBadge"];
}): string {
  const segments = [input.baseLeading];
  if (input.auxLeading) {
    segments.push(input.auxLeading);
  }
  if (input.typeBadge) {
    segments.push(
      pc.dim(" · "),
      renderTranscriptBubbleHeaderTypeBadge(input.typeBadge)
    );
  }
  if (input.presenceBadge) {
    segments.push(
      pc.dim(" · "),
      renderTranscriptBubbleHeaderPresenceBadge(input.presenceBadge)
    );
  }
  return segments.join("");
}

function renderTranscriptBubbleHeaderTypeBadge(
  typeBadge: NonNullable<TranscriptBubbleMessageViewState["headerTypeBadge"]>
): string {
  return pc.cyan(typeBadge);
}

function renderTranscriptBubbleHeaderPresenceBadge(
  presenceBadge: NonNullable<
    TranscriptBubbleMessageViewState["headerPresenceBadge"]
  >
): string {
  return renderPositiveAccentText(presenceBadge);
}

function resolveTranscriptBubbleHeaderBaseLeading(input: {
  parsedLeading: string;
  speakerIdentity: TranscriptSpeakerIdentity;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): string {
  if (input.speakerIdentity.kind === "unknown") {
    return input.parsedLeading;
  }

  const avatar = resolveTranscriptSpeakerAvatar(input.speakerIdentity.kind);
  const profileLabel =
    input.speakerIdentity.kind === "agent"
      ? colorizeAgentLabel(
          input.speakerIdentity.profileName,
          {
            agentControllerRef: input.speakerIdentity.agentControllerRef,
            profileId: input.speakerIdentity.profileId,
            profileName: input.speakerIdentity.profileName,
          },
          {
            spaceMembersSnapshot: input.spaceMembersSnapshot,
          }
        )
      : colorizeDisplayProfileLabel({
          label: input.speakerIdentity.profileName,
          profileIdentity: {
            kind: "human",
            ownerName: input.speakerIdentity.ownerName,
            ownerUserId: input.speakerIdentity.ownerUserId,
            profileId: input.speakerIdentity.profileId,
            profileName: input.speakerIdentity.profileName,
          },
          spaceMembersSnapshot: input.spaceMembersSnapshot,
        });
  return avatar ? `${avatar} ${profileLabel}` : profileLabel;
}

function parseTranscriptBubbleHeader(
  line: string,
  ts?: number
): {
  leading: string;
  trailing: string;
  bodyLine: string;
} {
  const normalizedLine = normalizeTranscriptPrimaryLine(line);
  if (typeof ts === "number") {
    const timestamp = formatTranscriptBubbleTimestamp(ts);
    const timestampIndex = normalizedLine.lastIndexOf(timestamp);
    if (timestampIndex >= 0) {
      const leading = normalizedLine.slice(0, timestampIndex).trimEnd();
      const bodyLine = normalizedLine
        .slice(timestampIndex + timestamp.length)
        .replace(TRANSCRIPT_BODY_PREFIX_COLON_PATTERN, "");
      return {
        leading,
        trailing: pc.dim(timestamp),
        bodyLine,
      };
    }
  }
  const match = TRANSCRIPT_ANSI_HEADER_PATTERN.exec(normalizedLine);

  if (match?.groups) {
    return {
      leading: match.groups.leading ?? "",
      trailing: pc.dim(
        typeof ts === "number"
          ? formatTranscriptBubbleTimestamp(ts)
          : (match.groups.timestamp ?? "")
      ),
      bodyLine: match.groups.body ?? "",
    };
  }

  return {
    leading: "",
    trailing: ts ? pc.dim(formatTranscriptBubbleTimestamp(ts)) : "",
    bodyLine: normalizedLine,
  };
}

function resolveTranscriptBubbleBodyLines(input: {
  parsedBodyLine: string;
  primaryLine: string;
  speakerIdentity: TranscriptSpeakerIdentity;
}): string[] {
  const normalizedBodyLine = input.parsedBodyLine.replace(
    TRANSCRIPT_BODY_PREFIX_COLON_PATTERN,
    ""
  );
  const strippedParsedBodyLine =
    input.speakerIdentity.kind === "unknown"
      ? normalizedBodyLine
      : stripTranscriptSpeakerHeaderFromBodyLine({
          line: normalizedBodyLine,
          speakerIdentity: input.speakerIdentity,
        });
  if (strippedParsedBodyLine) {
    return [strippedParsedBodyLine];
  }

  const normalizedPrimaryLine = normalizeTranscriptPrimaryLine(
    input.primaryLine
  );
  if (input.speakerIdentity.kind === "unknown") {
    return normalizedPrimaryLine ? [normalizedPrimaryLine] : [];
  }

  const strippedBodyLine = stripTranscriptSpeakerHeaderFromBodyLine({
    line: normalizedPrimaryLine,
    speakerIdentity: input.speakerIdentity,
  });
  return strippedBodyLine ? [strippedBodyLine] : [];
}

function stripTranscriptSpeakerHeaderFromBodyLine(input: {
  line: string;
  speakerIdentity: TranscriptSpeakerIdentity;
}): string {
  const speakerHeaderPattern = buildTranscriptSpeakerHeaderPrefixPattern(
    input.speakerIdentity
  );
  const strippedLine = input.line.replace(speakerHeaderPattern, "");
  return strippedLine === input.line ? input.line : strippedLine;
}

function buildTranscriptSpeakerHeaderPrefixPattern(
  speakerIdentity: TranscriptSpeakerIdentity
): RegExp {
  const timestampPattern = "\\d{8}\\s\\d{2}:\\d{2}(?::\\d{2})?";
  const avatar = resolveTranscriptSpeakerAvatar(speakerIdentity.kind);
  const avatarPattern = avatar ? `${escapeRegExp(avatar)}\\s+` : "";
  const profileNamePattern = `${ANSI_ESCAPE_PATTERN}${escapeRegExp(
    speakerIdentity.profileName
  )}${ANSI_ESCAPE_PATTERN}`;
  return new RegExp(
    `^${avatarPattern}${profileNamePattern}\\s+${ANSI_ESCAPE_PATTERN}${timestampPattern}${ANSI_ESCAPE_PATTERN}:\\s*`,
    "u"
  );
}

function resolveTranscriptSpeakerAvatar(
  kind: TranscriptBubbleSpeakerKind
): string {
  if (kind === "agent") {
    return "🤖";
  }
  if (kind === "human") {
    return "👤";
  }
  return "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatTranscriptBubbleTimestamp(ts: number): string {
  const date = new Date(ts);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day} ${hour}:${minute}:${second}`;
}

function renderPresenceTraceBlock(
  block: TranscriptPresenceTraceBlockViewState,
  width: number
): string[] {
  return wrapBubbleLine(buildPresenceTraceRowText(block), width);
}

function buildPresenceFirstJoinRows(
  block: TranscriptPresenceFirstJoinBlockViewState
): string[] {
  return [buildPresenceFirstJoinRowText(block)];
}

function buildPresenceFirstJoinRowText(
  block: TranscriptPresenceFirstJoinBlockViewState
): string {
  return [
    formatPresenceTraceDateTime(block.ts),
    "·",
    buildSystemActorLabel({
      actorAvatar: block.actorAvatar,
      actorLabel: block.actorLabel,
      actorKind: block.actorKind,
      actorProfileId: block.actorProfileId,
      actorOwnerUserId: block.actorOwnerUserId,
      actorOwnerName: block.actorOwnerName,
      spaceMembersSnapshot: null,
    }),
    "·",
    PRESENCE_FIRST_JOIN_LABEL,
  ].join(" ");
}

function buildPresenceTraceRowText(
  block: TranscriptPresenceTraceBlockViewState
): string {
  const timeLabel = resolvePresenceTraceTimeLabel(block);
  const actionLabel =
    block.count <= 1
      ? resolveSinglePresenceActionLabel(block)
      : `${resolvePresenceTraceSummaryActionLabel(block)} ×${block.count}`;
  return [
    timeLabel,
    "·",
    buildSystemActorLabel({
      actorAvatar: block.actorAvatar,
      actorLabel: block.actorLabel,
      actorKind: block.actorKind,
      actorProfileId: block.actorProfileId,
      actorOwnerUserId: block.actorOwnerUserId,
      actorOwnerName: block.actorOwnerName,
      spaceMembersSnapshot: block.spaceMembersSnapshot ?? null,
    }),
    "·",
    actionLabel,
  ].join(" ");
}

function renderMembershipTraceBlock(
  block: TranscriptMembershipTraceBlockViewState,
  width: number
): string[] {
  const lines = wrapBubbleLine(
    buildMembershipTraceSummaryRowText(block),
    width
  );
  const detailLine = buildMembershipTraceDetailLine(block);
  if (!detailLine) {
    return lines;
  }
  return [...lines, ...wrapBubbleLine(detailLine, width)];
}

function buildMembershipTraceSummaryRowText(
  block: TranscriptMembershipTraceBlockViewState
): string {
  return [
    resolvePresenceTraceTimeLabel({
      startTs: block.startTs,
      endTs: block.endTs,
      count: block.targets.length,
    }),
    "·",
    buildSystemActorLabel({
      actorAvatar: block.actorAvatar,
      actorLabel: block.actorLabel,
      actorKind: block.actorKind,
      actorProfileId: block.actorProfileId,
      actorOwnerUserId: block.actorOwnerUserId,
      actorOwnerName: block.actorOwnerName,
      spaceMembersSnapshot: block.spaceMembersSnapshot ?? null,
    }),
    "·",
    buildMembershipTraceSummaryActionLabel(block.action, block.targets),
  ].join(" ");
}

function buildMembershipTraceRows(
  block: TranscriptMembershipTraceBlockViewState
): string[] {
  const lines = [buildMembershipTraceSummaryRowText(block)];
  const detailLine = buildMembershipTraceDetailLine(block);
  if (detailLine) {
    lines.push(detailLine);
  }
  return lines;
}

function buildMembershipTraceSummaryActionLabel(
  action: TranscriptMembershipTraceBlockViewState["action"],
  targets: readonly TranscriptMembershipTraceTargetViewState[]
): string {
  const actionLabel =
    action === "member_removed"
      ? MEMBERSHIP_TRACE_REMOVED_LABEL
      : MEMBERSHIP_TRACE_ADDED_LABEL;
  const count = targets.length;
  const humanCount = targets.filter((target) => target.kind === "human").length;
  const agentCount = targets.filter((target) => target.kind === "agent").length;

  if (count === 1) {
    if (agentCount === 1) {
      return `${actionLabel} 1 agent`;
    }
    if (humanCount === 1) {
      return `${actionLabel} 1 human`;
    }
    return `${actionLabel} 1 member`;
  }

  if (count > 1 && agentCount === count) {
    return `${actionLabel} ${String(count)} agents`;
  }
  if (count > 1 && humanCount === count) {
    return `${actionLabel} ${String(count)} humans`;
  }
  return `${actionLabel} ${String(count)} members`;
}

function buildMembershipTraceDetailLine(
  block: TranscriptMembershipTraceBlockViewState
): string {
  const segments = block.targets
    .map((target) =>
      renderMembershipTraceTargetLabel(
        target,
        block.spaceMembersSnapshot ?? null
      )
    )
    .filter((segment) => segment.length > 0);
  return segments.join(" · ");
}

function renderMembershipTraceTargetLabel(
  target: TranscriptMembershipTraceTargetViewState,
  _spaceMembersSnapshot: SpaceMembersSnapshot | null
): string {
  if (target.kind === "agent" && target.mentionLabel) {
    return `@${target.label}`;
  }

  return target.label;
}

function resolvePrimaryTranscriptMentionLabel(input: {
  profileId: string | null;
  snapshot: SpaceMembersSnapshot | null;
}): string | null {
  return resolvePrimarySpaceMentionLabel({
    profileId: input.profileId,
    snapshot: input.snapshot,
  });
}

function buildSystemActorLabel(input: {
  actorAvatar: string;
  actorLabel: string;
  actorKind: TranscriptBubbleSpeakerKind;
  actorProfileId: string | null;
  actorOwnerUserId?: string | null;
  actorOwnerName?: string | null;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): string {
  const actorPrefix = input.actorAvatar ? `${input.actorAvatar} ` : "";
  return `${actorPrefix}${input.actorLabel}`;
}

function resolvePresenceTraceTimeLabel(block: {
  startTs: number;
  endTs: number;
  count?: number;
}): string {
  const startDateLabel = formatPresenceTraceDate(block.startTs);
  const startClockLabel = formatPresenceTraceClock(block.startTs);
  const endDateLabel = formatPresenceTraceDate(block.endTs);
  const endClockLabel = formatPresenceTraceClock(block.endTs);

  if (
    (block.count ?? 1) <= 1 ||
    (startDateLabel === endDateLabel && startClockLabel === endClockLabel)
  ) {
    return `${startDateLabel} ${startClockLabel}`;
  }
  if (startDateLabel === endDateLabel) {
    return `${startDateLabel} ${startClockLabel}–${endClockLabel}`;
  }
  return `${startDateLabel} ${startClockLabel}–${endDateLabel} ${endClockLabel}`;
}

function formatPresenceTraceDateTime(ts: number): string {
  return `${formatPresenceTraceDate(ts)} ${formatPresenceTraceClock(ts)}`;
}

function formatPresenceTraceDate(ts: number): string {
  const date = new Date(ts);
  const year = `${date.getFullYear()}`;
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatPresenceTraceClock(ts: number): string {
  const date = new Date(ts);
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

function resolveSinglePresenceActionLabel(
  block: TranscriptPresenceTraceBlockViewState
): string {
  return block.leftCount > 0
    ? PRESENCE_TRACE_LEFT_LABEL
    : PRESENCE_TRACE_JOINED_LABEL;
}

function resolvePresenceTraceSummaryActionLabel(
  block: TranscriptPresenceTraceBlockViewState
): string {
  if (block.joinCount > 0 && block.leftCount > 0) {
    return PRESENCE_TRACE_JOIN_LEFT_LABEL;
  }
  if (block.joinCount > 0) {
    return PRESENCE_TRACE_JOIN_LABEL;
  }
  return PRESENCE_TRACE_LEFT_LABEL;
}

function wrapBubbleLine(line: string, contentWidth: number): string[] {
  const wrapped = wrapAnsi(line, contentWidth, {
    hard: true,
    trim: false,
    wordWrap: true,
  });
  return wrapped.split("\n");
}

function wrapBubbleBodyLine(input: {
  line: string;
  contentWidth: number;
  leadPrefix: string;
  continuationPrefix: string;
}): string[] {
  const leadPrefix =
    input.leadPrefix === TRANSCRIPT_BUBBLE_BODY_CONTINUATION_PREFIX ||
    input.leadPrefix ===
      TRANSCRIPT_BUBBLE_REPLY_CONNECTED_BODY_CONTINUATION_PREFIX
      ? input.leadPrefix
      : renderOpenMeldBrandAccent(input.leadPrefix);
  const prefixWidth = stringWidth(input.leadPrefix);
  const prefixedContentWidth = Math.max(1, input.contentWidth - prefixWidth);
  const wrapped = wrapAnsi(input.line, prefixedContentWidth, {
    hard: true,
    trim: false,
    wordWrap: true,
  }).split("\n");

  return wrapped.map((wrappedLine, index) =>
    index === 0
      ? `${leadPrefix}${wrappedLine}`
      : `${input.continuationPrefix}${wrappedLine}`
  );
}

function resolveTranscriptBubbleBodyPrefixes(input: {
  hasReplyLine: boolean;
  hasRelationLines: boolean;
}): {
  firstLinePrefix: string;
  otherLinePrefix: string;
} {
  return input.hasReplyLine && !input.hasRelationLines
    ? {
        firstLinePrefix: TRANSCRIPT_BUBBLE_REPLY_CONNECTED_BODY_PREFIX,
        otherLinePrefix:
          TRANSCRIPT_BUBBLE_REPLY_CONNECTED_BODY_CONTINUATION_PREFIX,
      }
    : {
        firstLinePrefix: TRANSCRIPT_BUBBLE_BODY_PREFIX,
        otherLinePrefix: TRANSCRIPT_BUBBLE_BODY_CONTINUATION_PREFIX,
      };
}

function renderBubbleLine(
  line: string,
  block: TranscriptPlainTextBlockViewState,
  contentWidth: number
): string {
  const visibleWidth = measureVisibleWidth(line);
  const trailingPaddingWidth = Math.max(0, contentWidth - visibleWidth);
  const bubbleContent = ` ${line}${" ".repeat(trailingPaddingWidth)} `;
  const bubbleBackground = resolveBubbleBackground(block);
  if (!bubbleBackground) {
    return `${resolveBubbleIndent()}${bubbleContent}`;
  }
  return `${resolveBubbleIndent()}${bubbleBackground}${bubbleContent}${ANSI_BACKGROUND_RESET}`;
}

function renderBubblePaddingLine(
  block: TranscriptPlainTextBlockViewState,
  contentWidth: number
): string {
  return renderBubbleLine("", block, contentWidth);
}

function appendBubblePaddingLines(
  lines: string[],
  count: number,
  block: TranscriptPlainTextBlockViewState,
  contentWidth: number
): void {
  for (let index = 0; index < count; index += 1) {
    lines.push(renderBubblePaddingLine(block, contentWidth));
  }
}

function normalizeTranscriptPrimaryLine(line: string): string {
  return line.startsWith("- ") ? line.slice(2) : line;
}

function buildTranscriptBubbleMetaLines(
  detailLines: readonly string[],
  block: TranscriptPlainTextBlockViewState
): {
  wrappedLines: readonly string[];
  unwrappedLines: readonly string[];
} {
  const wrappedSegments: string[] = [];
  const unwrappedLines: string[] = [];

  for (const detailLine of detailLines) {
    const normalizedLine = stripTranscriptBubbleMetaSegment(detailLine, block);
    if (!normalizedLine) {
      continue;
    }
    if (isTranscriptOriginMetaLine(normalizedLine)) {
      unwrappedLines.push(normalizedLine);
      continue;
    }
    wrappedSegments.push(normalizedLine);
  }

  return {
    wrappedLines:
      wrappedSegments.length > 0 ? [wrappedSegments.join(" · ")] : [],
    unwrappedLines,
  };
}

function stripTranscriptBubbleMetaSegment(
  line: string,
  block: TranscriptPlainTextBlockViewState
): string {
  const normalizedLine = stripVTControlCharacters(line).trim();
  if (!normalizedLine) {
    return "";
  }

  const withoutAgentVia = normalizedLine.replace(
    TRANSCRIPT_AGENT_VIA_META_PREFIX_PATTERN,
    ""
  );
  if (block.speakerKind === "human" && withoutAgentVia.startsWith("owns:")) {
    return "";
  }
  return withoutAgentVia;
}

function isTranscriptOriginMetaLine(line: string): boolean {
  return stripVTControlCharacters(line).trim().startsWith("origin:");
}

function splitTranscriptBodyAndMetadataLines(detailLines: readonly string[]): {
  bodyDetailLines: readonly string[];
  metaLines: readonly string[];
} {
  if (detailLines.length === 0) {
    return {
      bodyDetailLines: [],
      metaLines: [],
    };
  }

  const trailingMetaLines: string[] = [];
  let sawPrimaryMetadataLine = false;
  let boundaryIndex = detailLines.length;

  for (let index = detailLines.length - 1; index >= 0; index -= 1) {
    const line = detailLines[index] ?? "";
    if (isTranscriptSecondaryMetadataLine(line)) {
      trailingMetaLines.unshift(line);
      boundaryIndex = index;
      continue;
    }
    if (isTranscriptPrimaryMetadataLine(line)) {
      trailingMetaLines.unshift(line);
      boundaryIndex = index;
      sawPrimaryMetadataLine = true;
      continue;
    }
    break;
  }

  if (!sawPrimaryMetadataLine) {
    return {
      bodyDetailLines: [...detailLines],
      metaLines: [],
    };
  }

  return {
    bodyDetailLines: detailLines.slice(0, boundaryIndex),
    metaLines: trailingMetaLines,
  };
}

function isTranscriptPrimaryMetadataLine(line: string): boolean {
  const normalized = stripVTControlCharacters(line).trim();
  return TRANSCRIPT_PRIMARY_METADATA_LINE_PATTERN.test(normalized);
}

function isTranscriptSecondaryMetadataLine(line: string): boolean {
  const normalized = stripVTControlCharacters(line).trim();
  return TRANSCRIPT_SECONDARY_METADATA_LINE_PATTERN.test(normalized);
}

function resolveBubbleIndent(): string {
  return TRANSCRIPT_BUBBLE_GROUP_INDENT > 0
    ? " ".repeat(TRANSCRIPT_BUBBLE_GROUP_INDENT)
    : "";
}

function resolveBubbleBackground(
  block: TranscriptPlainTextBlockViewState
): string {
  if (block.speakerKind === "human") {
    return TRANSCRIPT_HUMAN_BUBBLE_BACKGROUND;
  }

  if (
    block.highlightKind === "neutral" ||
    block.highlightKind === "self_human"
  ) {
    return TRANSCRIPT_NEUTRAL_BUBBLE_BACKGROUND;
  }

  const surfaceColor = resolveAgentSurfaceRgb(
    block.speakerProfileName,
    {
      agentControllerRef: block.speakerAgentControllerRef,
      profileId: block.speakerProfileId,
      profileName: block.speakerProfileName,
    },
    {
      spaceMembersSnapshot: block.spaceMembersSnapshot ?? null,
    }
  );
  return buildAnsiBackgroundColor([
    surfaceColor.r,
    surfaceColor.g,
    surfaceColor.b,
  ]);
}

function resolveTranscriptBubbleHighlightKind(input: {
  groupKey: string;
  membersSnapshot: SpaceMembersSnapshot | null;
  sessionProfile: TranscriptSessionProfile | null;
}): TranscriptBubbleHighlightKind {
  const profileId = resolveProfileIdFromGroupKey(input.groupKey);
  if (!(profileId && input.sessionProfile)) {
    return "neutral";
  }

  if (input.sessionProfile.kind === "agent") {
    return profileId === input.sessionProfile.profileId
      ? "owned_agent"
      : "neutral";
  }

  if (profileId === input.sessionProfile.profileId) {
    return "self_human";
  }

  const ownedAgent = resolveOwnedAgentSnapshot({
    membersSnapshot: input.membersSnapshot,
    profileId,
    sessionProfile: input.sessionProfile,
  });
  return ownedAgent ? "owned_agent" : "neutral";
}

function resolveOwnedAgentSnapshot(input: {
  membersSnapshot: SpaceMembersSnapshot | null;
  profileId: string;
  sessionProfile: TranscriptSessionProfile;
}) {
  const agentSnapshot =
    input.membersSnapshot?.agents.find(
      (member) => member.profileId === input.profileId
    ) ?? null;
  if (!agentSnapshot) {
    return null;
  }

  const currentOwnerUserId = normalizeTranscriptOwnerValue(
    input.sessionProfile.ownerUserId
  );
  const agentOwnerUserId = normalizeTranscriptOwnerValue(
    agentSnapshot.ownerUserId
  );
  if (currentOwnerUserId && agentOwnerUserId) {
    return currentOwnerUserId === agentOwnerUserId ? agentSnapshot : null;
  }

  const currentOwnerName = normalizeTranscriptOwnerValue(
    input.sessionProfile.ownerName
  );
  const agentOwnerName = normalizeTranscriptOwnerValue(agentSnapshot.ownerName);
  if (currentOwnerName && agentOwnerName) {
    return currentOwnerName === agentOwnerName ? agentSnapshot : null;
  }

  return null;
}

function normalizeTranscriptOwnerValue(
  value: string | null | undefined
): string {
  return value?.trim() ?? "";
}

function resolveAgentOwnerDisplay(agentSnapshot: {
  ownerName?: string | null;
  ownerUserId?: string | null;
  profileName?: string;
}): string {
  return (
    agentSnapshot.ownerName?.trim() || agentSnapshot.ownerUserId?.trim() || ""
  );
}

function measureVisibleWidth(value: string): number {
  return stringWidth(stripVTControlCharacters(value));
}

function buildAnsiBackgroundColor(
  rgb: readonly [number, number, number]
): string {
  const [red, green, blue] = rgb;
  return `\u001B[48;2;${String(red)};${String(green)};${String(blue)}m`;
}

function resolveBubbleContentWidth(width: number): number {
  const normalizedWidth = Number.isFinite(width) && width > 0 ? width : 80;
  return Math.max(
    1,
    normalizedWidth -
      TRANSCRIPT_BUBBLE_GROUP_INDENT -
      TRANSCRIPT_BUBBLE_HORIZONTAL_PADDING * 2
  );
}

function appendEmptyLines(lines: string[], count: number): void {
  for (let index = 0; index < count; index += 1) {
    lines.push("");
  }
}

function resolveTranscriptItemKind(
  item: SpaceTranscriptItem
): NonNullable<SpaceTranscriptItem["kind"]> {
  if (item.kind) {
    return item.kind;
  }
  return item.groupKey === SYSTEM_TRANSCRIPT_GROUP_KEY
    ? "system_notice"
    : "message";
}

function isPresenceTranscriptItem(item: SpaceTranscriptItem): boolean {
  return resolveTranscriptItemKind(item) === "presence";
}

function isMembershipNoticeTranscriptItem(item: SpaceTranscriptItem): boolean {
  return (
    resolveTranscriptItemKind(item) === "membership_notice" &&
    resolveMembershipNoticePayload(item) !== null
  );
}

function resolveMembershipNoticePayload(
  item: SpaceTranscriptItem
): NonNullable<SpaceTranscriptItem["membershipNotice"]> | null {
  return item.membershipNotice ?? null;
}

function resolvePresenceActorAvatar(item: SpaceTranscriptItem): string {
  if (item.actorKind === "agent") {
    return "🤖";
  }
  if (item.actorKind === "human") {
    return "👤";
  }
  return item.actorAvatar?.trim() || "👤";
}

function resolvePresenceActorKey(item: SpaceTranscriptItem): string {
  if (item.actorProfileId?.trim()) {
    return item.actorProfileId.trim();
  }
  const label = item.actorLabel?.trim();
  if (label) {
    return `${item.actorKind ?? "unknown"}:${label}`;
  }
  return "";
}

function resolvePresenceActorIdentity(
  item: SpaceTranscriptItem,
  membersSnapshot: SpaceMembersSnapshot | null
): {
  ownerUserId?: string | null;
  ownerName?: string | null;
} {
  const matchedSnapshot = resolvePresenceActorMemberSnapshot(
    item,
    membersSnapshot
  );
  if (!matchedSnapshot) {
    return {};
  }

  return {
    ownerUserId: matchedSnapshot.ownerUserId,
    ownerName: matchedSnapshot.ownerName,
  };
}

function resolvePresenceActorFirstEnteredAtMs(
  item: SpaceTranscriptItem,
  membersSnapshot: SpaceMembersSnapshot | null
): number | null {
  const firstEnteredAt =
    resolvePresenceActorMemberSnapshot(item, membersSnapshot)?.firstEnteredAt ??
    null;
  if (!firstEnteredAt) {
    return null;
  }

  const parsed = Date.parse(firstEnteredAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolvePresenceActorMemberSnapshot(
  item: SpaceTranscriptItem,
  membersSnapshot: SpaceMembersSnapshot | null
):
  | SpaceMembersSnapshot["humans"][number]
  | SpaceMembersSnapshot["agents"][number]
  | null {
  if (!membersSnapshot) {
    return null;
  }

  const actorProfileId = item.actorProfileId?.trim() || "";
  const actorLabel = item.actorLabel?.trim().toLowerCase() || "";

  if (item.actorKind === "agent") {
    return (
      membersSnapshot.agents.find(
        (member) =>
          member.profileId === actorProfileId ||
          (!actorProfileId &&
            actorLabel.length > 0 &&
            member.profileName.trim().toLowerCase() === actorLabel)
      ) ?? null
    );
  }

  if (item.actorKind === "human") {
    return (
      membersSnapshot.humans.find(
        (member) =>
          member.profileId === actorProfileId ||
          (!actorProfileId &&
            actorLabel.length > 0 &&
            member.profileName.trim().toLowerCase() === actorLabel)
      ) ?? null
    );
  }

  return null;
}

function resolveMembershipActorKey(
  notice: NonNullable<SpaceTranscriptItem["membershipNotice"]>
): string {
  if (notice.actorProfileId?.trim()) {
    return notice.actorProfileId.trim();
  }
  const label = notice.actorLabel.trim();
  if (label) {
    return `${notice.actorKind}:${label}`;
  }
  return "";
}

function resolveMembershipActorIdentity(
  notice: NonNullable<SpaceTranscriptItem["membershipNotice"]>,
  membersSnapshot: SpaceMembersSnapshot | null
): {
  actorKind: TranscriptBubbleSpeakerKind;
  actorAvatar: string;
  actorLabel: string;
  ownerUserId?: string | null;
  ownerName?: string | null;
} {
  const actorProfileId = notice.actorProfileId?.trim();
  const actorLabel = notice.actorLabel.trim() || "unknown";

  if (actorProfileId && membersSnapshot) {
    if (notice.actorKind === "agent") {
      const agentSnapshot =
        membersSnapshot.agents.find(
          (member) => member.profileId === actorProfileId
        ) ?? null;
      if (agentSnapshot) {
        return {
          actorKind: "agent",
          actorAvatar: "🤖",
          actorLabel: agentSnapshot.profileName,
          ownerUserId: agentSnapshot.ownerUserId,
          ownerName: agentSnapshot.ownerName,
        };
      }
    }

    if (notice.actorKind === "human") {
      const humanSnapshot =
        membersSnapshot.humans.find(
          (member) => member.profileId === actorProfileId
        ) ?? null;
      if (humanSnapshot) {
        return {
          actorKind: "human",
          actorAvatar: "👤",
          actorLabel: humanSnapshot.profileName,
          ownerUserId: humanSnapshot.ownerUserId,
          ownerName: humanSnapshot.ownerName,
        };
      }
    }
  }

  return {
    actorKind: notice.actorKind,
    actorAvatar: notice.actorKind === "agent" ? "🤖" : "👤",
    actorLabel,
  };
}

function renderTranscriptSystemCluster(
  blocks: readonly TranscriptSystemClusterBlockViewState[],
  width: number
): string[] {
  const contentWidth = resolveSystemClusterContentWidth(width);
  const renderedLines: string[] = [];

  for (const block of blocks) {
    const clusterRows = renderSystemClusterBlockRows(block, contentWidth);
    renderedLines.push(
      ...clusterRows.map((line) => renderSystemClusterLine(line, contentWidth))
    );
  }

  return renderedLines;
}

function renderSystemClusterBlockRows(
  block: TranscriptSystemClusterBlockViewState,
  contentWidth: number
): string[] {
  if (block.kind === "presence_first_join_group") {
    return wrapBubbleLine(buildPresenceFirstJoinRowText(block), contentWidth);
  }
  if (block.kind === "presence_trace_group") {
    return wrapBubbleLine(buildPresenceTraceRowText(block), contentWidth);
  }
  if (block.kind === "membership_trace_group") {
    return renderMembershipTraceBlock(block, contentWidth);
  }
  return renderSystemClusterRowsFromSystemLines(block.lines, contentWidth);
}

function buildSystemClusterRowsFromSystemLines(
  lines: readonly string[]
): string[] {
  const renderedLines: string[] = [];

  for (const line of lines) {
    const normalizedLines = splitTranscriptMultilineLines(line);
    for (const normalizedLine of normalizedLines) {
      if (isConnectedAsSystemLine(normalizedLine)) {
        continue;
      }
      renderedLines.push(stripVTControlCharacters(normalizedLine).trim());
    }
  }

  return renderedLines;
}

function renderSystemClusterRowsFromSystemLines(
  lines: readonly string[],
  contentWidth: number
): string[] {
  return buildSystemClusterRowsFromSystemLines(lines).flatMap((line) =>
    wrapBubbleLine(line, contentWidth)
  );
}

function splitTranscriptMultilineLines(value: string): string[] {
  return stripVTControlCharacters(value)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

function isConnectedAsSystemLine(line: string): boolean {
  return isConnectedAsLegacySystemLine(stripVTControlCharacters(line));
}

function renderSystemClusterLine(line: string, contentWidth: number): string {
  const normalizedLine = stripVTControlCharacters(line).trim();
  if (normalizedLine.length === 0) {
    return "";
  }
  const visibleWidth = stringWidth(normalizedLine);
  const remainingWidth = Math.max(0, contentWidth - visibleWidth);
  const leadingPaddingWidth = Math.floor(remainingWidth / 2);
  const trailingPaddingWidth = remainingWidth - leadingPaddingWidth;
  return `${" ".repeat(leadingPaddingWidth)}${pc.dim(normalizedLine)}${" ".repeat(trailingPaddingWidth)}`;
}

function resolveSystemClusterContentWidth(width: number): number {
  const normalizedWidth = Number.isFinite(width) && width > 0 ? width : 80;
  return Math.max(1, normalizedWidth);
}
