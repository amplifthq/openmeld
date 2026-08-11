import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import type {
  PanelInstruction,
  SpacePanelContentAlign,
  SpacePanelKind,
  SpacePanelLayout,
  SpacePanelMode,
  SpacePanelSurfaceVariant,
} from "../panel/space-panel-definition";
import type {
  SpaceOverlayKind,
  SpaceTranscriptItem,
} from "../state/space-screen-state";
import type { TranscriptBlockViewState } from "../transcript/transcript-render";

export type SpaceSessionSurface = "pre-session" | "active-session";

export type SpaceSessionContext = {
  surface: SpaceSessionSurface;
  connectionMode: "join" | "watch" | "history";
  gatewayUrl: string;
  session: {
    spaceCreatedAt?: string | null;
    spaceCreatorId?: string | null;
    spaceCreatorName?: string | null;
    spaceId: string;
    spaceName: string | null;
    passwordProtected: boolean | null;
    storageSoftLimitBytes?: number | null;
    storageUsagePercent?: number | null;
    storageUsedBytes?: number | null;
  };
  profile: {
    profileId: string;
    profileName: string;
    kind: "human" | "agent";
    ownerUserId?: string | null;
    ownerName?: string | null;
  };
};

export type TranscriptSlotViewState = {
  items: readonly SpaceTranscriptItem[];
  blocks: readonly TranscriptBlockViewState[];
  visible: boolean;
};

export type SpaceInfoCardDocumentBlockViewState = {
  kind: "space_info_card";
  lines: readonly string[];
};

export type SpaceSummarySegmentKey =
  | "spaceName"
  | "securityLabel"
  | "membersCount"
  | "liveHumanCount"
  | "liveAgentCount"
  | "storageUsage";

export type SpaceSummarySegmentViewState = {
  key: SpaceSummarySegmentKey;
  text: string;
};

export type SpaceSummaryFactsViewState = {
  spaceId: string;
  spaceName: string | null;
  securityLabel: "Secure" | "Public" | null;
  membersCount: number | null;
  liveHumanCount: number | null;
  liveAgentCount: number | null;
  storageUsedBytes: number | null;
  storageSoftLimitBytes: number | null;
  storageUsagePercent: number | null;
};

export type SpaceSummaryPreset = "composer-footer" | "session-summary";

export type SpaceSummaryViewState = {
  facts: SpaceSummaryFactsViewState;
  composerFooterSegments: readonly SpaceSummarySegmentViewState[];
  sessionSummarySegments: readonly SpaceSummarySegmentViewState[];
};

export type OpenMeldBrandDocumentBlockViewState = {
  kind: "openmeld_brand";
  lines: readonly string[];
};

export type SessionHeaderDocumentBlockViewState = {
  kind: "session_header";
  productLabel: string;
  tagline: string;
  versionLabel: string | null;
  logoLines: readonly string[];
  summaryFacts: SpaceSummaryFactsViewState;
  summaryHintText?: string | null;
};

export type SpaceSummaryDocumentBlockViewState = {
  kind: "space_summary";
  segments: readonly SpaceSummarySegmentViewState[];
};

export type SpaceMembersCardDocumentBlockViewState = {
  kind: "space_members_card";
  lines: readonly string[];
};

export type TranscriptDocumentBlockViewState = {
  kind: "transcript";
  blocks: readonly TranscriptBlockViewState[];
};

export type SessionDocumentBlockViewState =
  | SessionHeaderDocumentBlockViewState
  | OpenMeldBrandDocumentBlockViewState
  | SpaceSummaryDocumentBlockViewState
  | SpaceInfoCardDocumentBlockViewState
  | SpaceMembersCardDocumentBlockViewState
  | TranscriptDocumentBlockViewState;

export type SessionDocumentViewState = {
  blocks: readonly SessionDocumentBlockViewState[];
  visible: boolean;
};

export type StatusSlotViewState = {
  overlayLine: string;
  lines: readonly string[];
  visible: boolean;
};

export type ComposerSlotViewState = {
  bufferText: string;
  basePrompt: string;
  helperText: string;
  hasDraft: boolean;
  placeholderText: string;
  showPlaceholder: boolean;
  visible: boolean;
};

export type DispatchActivityActorViewState = {
  profileId: string;
  label: string;
  startedAtMs: number;
  updatedAtMs: number;
  latestPreviewText: string;
  latestPreviewUpdatedAtMs: number | null;
};

export type ComposerDispatchRowState = {
  rowId: string;
  dispatchId: string | null;
  sourceEventId: string | null;
  sourceClientMessageId: string | null;
  sourceTextSnapshot?: string | null;
  targetProfileId: string | null;
  targetMentionLabel: string | null;
  targetLabel: string;
  stage: "sending" | "dispatching" | "retrying" | "replying" | "warning";
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number | null;
  latestPreviewText: string;
  latestPreviewUpdatedAtMs: number | null;
  statusText: string;
  warningText: string;
};

export type ComposerActivityMode =
  | "idle"
  | "sending"
  | "dispatching"
  | "retrying"
  | "replying"
  | "streaming"
  | "warning";

export type ComposerActivityRowViewState = {
  key: string;
  mode: Exclude<ComposerActivityMode, "idle">;
  targetLabel: string | null;
  actors: readonly DispatchActivityActorViewState[];
  leadActor: DispatchActivityActorViewState | null;
  elapsedSeconds: number | null;
  previewText: string;
  hint: string | null;
};

export type ComposerActivityViewState = {
  visible: boolean;
  mode: ComposerActivityMode;
  rows: readonly ComposerActivityRowViewState[];
  overflowCount: number;
  actors: readonly DispatchActivityActorViewState[];
  leadActor: DispatchActivityActorViewState | null;
  elapsedSeconds: number | null;
  previewText: string;
  hint: string | null;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
};

export type PanelFactSpan = "full" | "column";

export type PanelFactItemViewState = {
  label: string;
  value: string;
  span: PanelFactSpan;
};

export type PanelFactsBlockViewState = {
  kind: "facts";
  items: readonly PanelFactItemViewState[];
};

export type PanelLinesBlockViewState = {
  kind: "lines";
  lines: readonly string[];
};

export type PanelBodyBlockViewState =
  | PanelFactsBlockViewState
  | PanelLinesBlockViewState;

export type PanelBodyViewState = {
  blocks: readonly PanelBodyBlockViewState[];
};

export type SearchablePanelControlViewState = {
  label: string;
  placeholder: string;
  query: string;
};

export type SearchablePanelItemViewState = {
  id: string;
  lines: readonly string[];
};

export type SearchablePanelSectionViewState = {
  id: string;
  title: string | null;
  items: readonly SearchablePanelItemViewState[];
};

export type SearchablePanelListViewState = {
  activeItemId: string | null;
  control: SearchablePanelControlViewState;
  emptyLines: readonly string[];
  sections: readonly SearchablePanelSectionViewState[];
};

export type PanelViewState = {
  body: PanelBodyViewState;
  contentAlign: SpacePanelContentAlign;
  headerMetaText?: string | null;
  kind: SpacePanelKind;
  instructions: readonly PanelInstruction[];
  layout: SpacePanelLayout;
  mode: SpacePanelMode;
  searchableList: SearchablePanelListViewState | null;
  surfaceVariant: SpacePanelSurfaceVariant;
  title: string;
  visible: boolean;
};

export type OverlaySlotViewState = {
  kind: SpaceOverlayKind;
  panel: PanelViewState | null;
  visible: boolean;
};

export type SpaceSessionDiagnosticsViewState = {
  openMeldServiceLabel: string;
  canWakeLocalAgentsLabel: string;
};

export type SpaceSessionResourcesViewState = {
  membersSnapshot: SpaceMembersSnapshot | null;
  sessionDiagnostics: SpaceSessionDiagnosticsViewState;
};

export type SpaceSessionViewState = {
  surface: SpaceSessionSurface;
  context: SpaceSessionContext;
  spaceSummary: SpaceSummaryViewState;
  transcript: TranscriptSlotViewState;
  sessionDocument: SessionDocumentViewState;
  status: StatusSlotViewState;
  composerActivity: ComposerActivityViewState;
  composer: ComposerSlotViewState;
  overlay: OverlaySlotViewState;
  resources: SpaceSessionResourcesViewState;
};
