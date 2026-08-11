import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import pc from "picocolors";
import { getCliVersionInfo } from "../../runtime/cli-version";
import { renderOpenMeldLogo } from "../../ui/brand";
import { formatInputPrompt } from "../../ui/output";
import { colorizeDisplayProfileLabel } from "../../ui/profile-label-color";
import { buildSpacePanelViewState } from "../panel/build-space-panel-view-state";
import {
  buildHelpPanelBlocks,
  buildLogsPanelBlocks,
  buildLogsSearchableListViewState,
  buildMembersPanelBlocks,
  buildMembersSearchableListViewState,
  buildSpacePanelBlocks,
} from "../panel/space-panel-content";
import { resolveSessionHeaderSummaryHint } from "../readonly-session-shortcuts";
import type { SpaceScreenState } from "../state/space-screen-state";
import { buildHumanTranscriptProjection } from "../transcript/transcript-render";
import {
  buildComposerActivityViewState,
  type ComposerActivitySource,
} from "./build-composer-activity-view-state";
import { buildSpaceSummaryViewState } from "./build-space-summary-view-state";
import type {
  SpaceSessionContext,
  SpaceSessionDiagnosticsViewState,
  SpaceSessionViewState,
} from "./space-session-view-state";

const SPACE_SESSION_HEADER_PRODUCT_LABEL = "OPENMELD • https://openmeld.ai";
const SPACE_SESSION_HEADER_TAGLINE =
  "Connect with any agents and humans in real time";
export function buildSpaceSessionViewState(input: {
  context: SpaceSessionContext;
  resources?: {
    composerActivity?: ComposerActivitySource;
    sessionDiagnostics?: SpaceSessionDiagnosticsViewState;
  };
  screenState: SpaceScreenState;
}): SpaceSessionViewState {
  const { context, resources, screenState } = input;
  const activeSessionVisible = context.surface === "active-session";
  const composerVisible =
    activeSessionVisible && context.connectionMode === "join";
  const statusOverlayLine = screenState.status.overlayLine.trim();
  const sessionDiagnostics = resources?.sessionDiagnostics ?? {
    openMeldServiceLabel: "unknown",
    canWakeLocalAgentsLabel: "unknown",
  };
  const helpBlocks = buildHelpPanelBlocks();
  const spaceBlocks = buildSpacePanelBlocks({
    context,
    membersSnapshot: screenState.members.snapshot,
  });
  const humanTranscriptProjection = buildHumanTranscriptProjection({
    items: screenState.transcript.items,
    membersSnapshot: screenState.members.snapshot,
    sessionProfile: context.profile,
  });
  const logsBlocks = buildLogsPanelBlocks({
    sections: humanTranscriptProjection.logsSections,
  });
  const logsSearchableList = buildLogsSearchableListViewState({
    activeItemId: screenState.overlay.interaction.activeItemId,
    query: screenState.overlay.interaction.query,
    sections: humanTranscriptProjection.logsSections,
  });
  const membersBlocks = buildMembersPanelBlocks({
    snapshot: screenState.members.snapshot,
    refreshError: screenState.members.refreshError,
  });
  const membersSearchableList = buildMembersSearchableListViewState({
    activeItemId: screenState.overlay.interaction.activeItemId,
    query: screenState.overlay.interaction.query,
    refreshError: screenState.members.refreshError,
    snapshot: screenState.members.snapshot,
  });
  const overlayPanel = buildSpacePanelViewState({
    kind: screenState.overlay.kind,
    bodyByKind: {
      help: helpBlocks,
      logs: logsBlocks,
      members: membersBlocks,
      space: spaceBlocks,
    },
    headerMetaTextByKind: {
      members: buildMembersPanelUpdatedAtLabel(screenState.members.updatedAtMs),
    },
    searchableListByKind: {
      logs: logsSearchableList,
      members: membersSearchableList,
    },
  });
  const transcriptBlocks = humanTranscriptProjection.transcriptBlocks;
  const spaceSummary = buildSpaceSummaryViewState({
    context,
    membersSnapshot: screenState.members.snapshot,
  });
  const composerActivity = buildComposerActivityViewState(
    resources?.composerActivity ?? {
      nowMs: Date.now(),
      rows: [],
    },
    screenState.members.snapshot
  );
  const visibleComposerActivity = composerVisible
    ? composerActivity
    : {
        ...composerActivity,
        visible: false,
      };

  return {
    surface: context.surface,
    context,
    spaceSummary,
    transcript: {
      items: screenState.transcript.items,
      blocks: transcriptBlocks,
      visible: activeSessionVisible,
    },
    sessionDocument: {
      blocks: [
        {
          kind: "session_header",
          productLabel: SPACE_SESSION_HEADER_PRODUCT_LABEL,
          tagline: SPACE_SESSION_HEADER_TAGLINE,
          versionLabel: `v ${getCliVersionInfo().version}`,
          logoLines: renderOpenMeldLogo().split("\n"),
          summaryFacts: spaceSummary.facts,
          summaryHintText: resolveSessionHeaderSummaryHint(
            context.connectionMode
          ),
        },
        {
          kind: "transcript",
          blocks: transcriptBlocks,
        },
      ],
      visible: activeSessionVisible,
    },
    status: {
      overlayLine: statusOverlayLine,
      lines: statusOverlayLine ? statusOverlayLine.split("\n") : [],
      visible: activeSessionVisible && statusOverlayLine.length > 0,
    },
    composerActivity: visibleComposerActivity,
    composer: {
      bufferText: screenState.composer.bufferText,
      basePrompt: formatInputPrompt(
        {
          profileId: context.profile.profileId,
          profileName: context.profile.profileName,
          kind: context.profile.kind,
          ownerUserId: context.profile.ownerUserId ?? undefined,
          ownerName: context.profile.ownerName ?? undefined,
        },
        {
          spaceMembersSnapshot: screenState.members.snapshot,
        }
      ),
      helperText: buildComposerHelperText(
        context,
        screenState.members.snapshot
      ),
      hasDraft: screenState.composer.bufferText.length > 0,
      placeholderText: "Message the space...",
      showPlaceholder: screenState.composer.bufferText.length === 0,
      visible: composerVisible,
    },
    overlay: {
      kind: screenState.overlay.kind,
      panel: overlayPanel,
      visible: activeSessionVisible && screenState.overlay.kind !== "none",
    },
    resources: {
      membersSnapshot: screenState.members.snapshot,
      sessionDiagnostics,
    },
  };
}

function buildComposerHelperText(
  context: SpaceSessionContext,
  membersSnapshot?: SpaceMembersSnapshot | null
): string {
  const coloredProfileName = colorizeDisplayProfileLabel({
    label: context.profile.profileName,
    profileIdentity: {
      kind: context.profile.kind,
      ownerUserId: context.profile.ownerUserId ?? undefined,
      ownerName: context.profile.ownerName ?? undefined,
      profileId: context.profile.profileId,
      profileName: context.profile.profileName,
    },
    spaceMembersSnapshot: membersSnapshot,
  });
  return `${pc.dim("connected as ")}${coloredProfileName}${pc.dim(" · Enter sends · Shift+Enter newline · / commands · @ mentions")}`;
}

function buildMembersPanelUpdatedAtLabel(
  updatedAtMs: number | null
): string | null {
  if (!(typeof updatedAtMs === "number" && Number.isFinite(updatedAtMs))) {
    return null;
  }

  const date = new Date(updatedAtMs);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `UpdatedAt ${year}${month}${day} ${hour}:${minute}`;
}
