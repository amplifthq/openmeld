import {
  clearLine,
  createInterface,
  cursorTo,
  moveCursor,
} from "node:readline";
import type {
  HelloAck,
  SignalEnvelope,
  SpaceCursor,
  SpaceMeta,
} from "@openmeld/protocol";
import {
  normalizeSpaceCursorPatch,
  SPACE_MEMBER_JOIN_NOTICE_PURPOSE,
  SPACE_MEMBER_REMOVE_NOTICE_PURPOSE,
  toLegacySpaceAddressingWireValue,
} from "@openmeld/schemas";
import type {
  AgentProfileBindingModelSelection,
  OpenMeldRequestContext,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { resolveNextRecentMentionProfileIdsForQueuedText } from "@openmeld/space";
import pc from "picocolors";
import stringWidth from "string-width";
import { resolveAuthenticationGuidance } from "../auth/auth-guidance";
import { resolveBaseUrl } from "../config/base-url";
import { acquireLock, runWithHeldLock } from "../config/lock";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfileIdentity } from "../config/openmeld-request-context";
import {
  resolveGatewayHost,
  updateProfileSpaceHistoryStatus,
  upsertProfileSpaceHistory,
} from "../config/profile-space-history-api";
import {
  buildOpenMeldProfileIdentityRequestHeadersWithAuth,
  buildOpenMeldRequestContextHeadersWithAuth,
} from "../config/request-headers";
import { requireOpenMeldProfile } from "../config/resolve-openmeld-profile";
import { toSpaceCursorUrl, toSpaceWsUrl } from "../protocol/urls";
import {
  makeHello,
  makeTextSignal,
  parseIncoming,
  parseServerErrorFrame,
  sanitizeText,
} from "../protocol/wire";
import { formatOpenMeldCliCommand } from "../runtime/cli-entry-command";
import { resolveRuntimeContext } from "../runtime/context";
import { formatMessage } from "../runtime/messages";
import { createPresenter } from "../runtime/presenter/index";
import type { ResolvedCliView } from "../runtime/types";
import { connectWebSocket } from "../transport/ws";
import { errLine, outJsonLine } from "../ui/io";
import {
  formatConnectIntro,
  formatInputPrompt,
  type OutputMode,
} from "../ui/output";
import { sanitizeTerminalDisplayText } from "../ui/terminal-safe-text";
import {
  buildAgentSessionMetaPayload,
  normalizeAgentOutputEvent,
  normalizeAgentOutputMembersSnapshot,
} from "./agent-output-contract";
import { rethrowCanonicalMentionSnapshotLoadFailure } from "./canonical-mention-preflight";
import {
  type ComposeDraftState,
  consumeComposeInputLine,
  emptyComposeDraft,
} from "./compose-input";
import { ComposerController } from "./composer/composer-controller";
import { prepareCliSpaceComposerSubmission } from "./composer-submission-adapter";
import {
  normalizeRecentHistoryLimit,
  processIgnoredOlderThanLiveFloorSignal,
  rememberSeenSignalId,
  resolveInitialLiveFloorTs,
  shouldIgnoreIncomingSignal,
} from "./connect-catchup";
import {
  applyDispatchActivityEventToStatusMap,
  clearDispatchActivitiesForSignal,
  clearUnconfirmedPendingOutboundRows,
  countRenderedTerminalRows,
  pruneExpiredDispatchRows,
  resolveDispatchRowStatusTexts,
  resolveNearestDispatchRowExpiryMs,
  resolveNonTransientSignalText,
  resolveReplyingStatusColumns,
  resolveSignalClientMessageId,
  resolveSignalTextMetaFromEnvelope,
  toComposerDispatchRows,
} from "./connect-dispatch-activity";
import {
  emitHumanConnectTranscriptEvent,
  replayConnectInitialHistoryBootstrap,
} from "./connect-history-transcript-bootstrap";
import {
  buildSpaceCursorPatch,
  normalizeCursorLastSeenTs,
  normalizeOptionalIsoDateTime,
  normalizeOptionalTrimmedText,
  normalizeRoleValue,
  normalizeStoredMentionAliasValue,
  resolveCreatorKind,
  resolveCreatorProfileId,
  resolveMaxLastSeenTs,
  resolveSessionMentionAlias,
  resolveSessionMeta,
  resolveSessionRoleContext,
} from "./connect-session-meta";
import { fetchSpaceRequestWithTimeout } from "./fetch-with-timeout";
import { parseHttpFailure } from "./http-failure";
import {
  clearPendingHumanSendRowsByClientMessageId,
  upsertPendingHumanSendRow,
} from "./human-send-state";
import {
  type InteractiveTextSubmitResult,
  performInteractiveTextSubmit,
} from "./interactive-text-submit";
import {
  resolveSpaceJoinReadModelSeed,
  type SpaceJoinReadModelSeed,
} from "./join-read-model-seed";
import {
  isLocalSpaceStateCorruptResult,
  readSpaceConfig,
  readSpaceLastSeenTs,
  readSpaceRecentMentionProfileIds,
  toLocalSpaceStateIntegrityError,
  updateSpaceLastSeenTs,
  upsertSpaceConfig,
  writeSpaceRecentMentionProfileIds,
} from "./local-state";
import { projectSpaceProfileCache } from "./local-state-projection";
import { fetchSpaceMeta } from "./meta-api";
import { resolveMembersSearchableActiveItemId } from "./panel/space-panel-content";
import type { SpacePanelKind } from "./panel/space-panel-definition";
import { buildPanelDisplayLines } from "./panel/space-panel-display";
import {
  confirmPendingOutboundRows,
  confirmPendingOutboundRowsForSignal,
} from "./pending-outbound-confirmation";
import { resolveSpaceSessionDiagnostics } from "./preflight";
import { buildFormalSignalReadPayload } from "./read-projection/formal-message-read-output";
import type { SpaceRuntimeEvent } from "./runtime/space-runtime-events";
import { SpaceSessionRuntime } from "./runtime/space-session-runtime";
import {
  buildActiveSpaceSessionContext,
  buildSpaceSessionProfileContextFromIdentity,
  buildSpaceSessionProfileIdentity,
  rememberSessionOwnerDisplayName,
  type SpaceSessionProfileIdentity,
  toProtocolProfile,
} from "./session-profile";
import {
  type InteractiveHumanShellKind,
  resolveInteractiveHumanShellKind,
} from "./shell/interactive-shell-kind";
import type { InteractiveSpaceShell } from "./shell/interactive-space-shell";
import { LegacyInteractiveSpaceShell } from "./shell/legacy-interactive-space-shell";
import { mountPiTuiSessionShell } from "./shell/pi-tui/mount-pi-tui-session-shell";
import { PiTuiInteractiveSpaceShell } from "./shell/pi-tui/pi-tui-interactive-space-shell";
import { toSpaceMetaUpsertInput } from "./space-meta-upsert-input";
import { createSpaceScreenStore } from "./state/space-screen-store";
import { buildSpaceSessionViewState } from "./view/build-space-session-view-state";
import type { ComposerDispatchRowState } from "./view/space-session-view-state";

const PENDING_OUTBOUND_CONFIRMATION_MAX = 200;
const CATCHUP_LIVE_BUFFER_MAX = 2000;
const WS_UNEXPECTED_SERVER_RESPONSE_REGEX =
  /unexpected server response:\s*(\d{3})/i;
const REPLYING_STATUS_SYSTEM_LABEL = "📣 system";
const REPLYING_STATUS_AGENT_LABEL = "🤖";
const REPLYING_STATUS_PROMPT_GAP_LINES = 1;
const CHAT_GROUP_DIVIDER_MARGIN = 2;
const CHAT_GROUP_DIVIDER_MIN_WIDTH = 24;
const CHAT_GROUP_DIVIDER_MAX_WIDTH = 120;
const CHAT_GROUP_DIVIDER_CHAR = "╌";
const CHAT_GROUP_DIVIDER_SIDE_GAP_LINES = 1;
const LEAVE_CARD_FALLBACK_CONTENT_WIDTH = 68;
const LEAVE_CARD_MAX_CONTENT_WIDTH = 72;
const LEAVE_CARD_MIN_CONTENT_WIDTH = 8;
const LEAVE_CARD_LEADING_BLANK_LINES = 2;
const MEMBERS_PANEL_REFRESH_DEBOUNCE_MS = 250;
const SPACE_META_REFRESH_DEBOUNCE_MS = 1000;

type DispatchActivityRowState = ComposerDispatchRowState;
type ConnectProfileIdentity = SpaceSessionProfileIdentity;
type ComposerIntentResolution =
  | ReturnType<ComposerController["consumeLegacyLine"]>
  | ReturnType<ComposerController["consumeEditorSubmit"]>;

function resolveOptionalReadableLocalSpaceConfig(
  result: Awaited<ReturnType<typeof readSpaceConfig>>,
  operation: string
) {
  if (result.kind === "missing") {
    return null;
  }
  if (isLocalSpaceStateCorruptResult(result)) {
    throw toLocalSpaceStateIntegrityError({
      operation,
      result,
    });
  }
  return result.value;
}

function handleInteractiveComposerIntent(input: {
  resolution: ComposerIntentResolution;
  submittedText: string;
  applyComposerBuffer: (bufferText: string) => void;
  closeOverlay: () => void;
  prepareExternalWrite: () => void;
  presenter: ReturnType<typeof createPresenter>;
  handleSendTextError: (error: unknown) => void;
  sendText: (input: {
    nextBufferText: string;
    submittedText: string;
    text: string;
  }) => Promise<void>;
  showOverlay: (kind: SpacePanelKind) => Promise<void>;
  cleanup: (reason: string) => void;
  clearSubmittedInputLine: (text: string) => void;
}): void {
  const { resolution, submittedText } = input;

  switch (resolution.kind) {
    case "quit":
      input.cleanup("quit");
      return;

    case "buffer.updated":
      input.applyComposerBuffer(resolution.nextBufferText);
      input.closeOverlay();
      return;

    case "submit.rejected":
      input.applyComposerBuffer(resolution.nextBufferText);
      input.closeOverlay();
      input.prepareExternalWrite();
      input.presenter.event("info", "connect.reject", {
        reason: resolution.reason,
      });
      return;

    case "submit":
      input.applyComposerBuffer(resolution.nextBufferText);
      input.closeOverlay();
      setImmediate(() => {
        input
          .sendText({
            nextBufferText: resolution.nextBufferText,
            submittedText,
            text: resolution.text,
          })
          .catch((error) => {
            input.handleSendTextError(error);
          });
      });
      return;

    case "command.panel.open":
      input.applyComposerBuffer(resolution.nextBufferText);
      input.closeOverlay();
      ignoreAsyncResult(input.showOverlay(resolution.panelKind));
      return;

    default:
      assertUnreachableComposerIntent(resolution);
      return;
  }
}

function handleInteractiveRuntimeEvent(input: {
  event: SpaceRuntimeEvent;
  store: ReturnType<typeof createSpaceScreenStore>;
  rowsById: Map<string, DispatchActivityRowState>;
  enableLocalEcho: boolean;
  selfProfileId: string;
  syncActivityPresentation: () => void;
  reportOutboundSendFailure: (failure: {
    error: string;
    hint?: string;
  }) => void;
  handleIncomingEvent: (
    event: SignalEnvelope | HelloAck,
    source: "history" | "live"
  ) => void;
  handleHistoryLoadedEvent: (
    event: Extract<SpaceRuntimeEvent, { type: "history.loaded" }>
  ) => void;
  handleMembersUpdatedEvent: (
    event: Extract<SpaceRuntimeEvent, { type: "members.updated" }>
  ) => void;
  handleConnectionClosedEvent: (
    event: Extract<SpaceRuntimeEvent, { type: "connection.closed" }>
  ) => void;
}): void {
  switch (input.event.type) {
    case "connected":
      input.store.dispatch({
        type: "connection.connected",
      });
      return;

    case "history.loaded":
      input.handleHistoryLoadedEvent(input.event);
      return;

    case "members.updated":
      input.handleMembersUpdatedEvent(input.event);
      return;

    case "send.queued":
      return;

    case "send.confirmed":
      confirmPendingOutboundRows({
        rowsById: input.rowsById,
        clientMessageId: input.event.clientMessageId,
      });
      input.syncActivityPresentation();
      return;

    case "send.failed":
      clearPendingHumanSendRowsByClientMessageId({
        rowsById: input.rowsById,
        clientMessageId: input.event.clientMessageId,
      });
      input.syncActivityPresentation();
      input.reportOutboundSendFailure({
        error: `couldn't send the message: ${input.event.error}`,
        hint: "rejoin the space and try sending it again",
      });
      return;

    case "signal.received":
      if (
        input.event.source === "live" &&
        isSignalEnvelope(input.event.event) &&
        confirmPendingOutboundRowsForSignal({
          rowsById: input.rowsById,
          event: input.event.event,
          selfProfileId: input.selfProfileId,
        })
      ) {
        input.syncActivityPresentation();
      }
      input.handleIncomingEvent(input.event.event, input.event.source);
      return;

    case "connection.closed":
      input.handleConnectionClosedEvent(input.event);
      return;

    default:
      assertUnreachableRuntimeEvent(input.event);
      return;
  }
}

function handleInteractiveIncomingEvent(input: {
  event: SignalEnvelope | HelloAck;
  source: "history" | "live";
  liveFloorTs: number;
  seenSignalIds: Set<string>;
  selfProfileId: string;
  appendTranscriptEvent: (
    event: SignalEnvelope | HelloAck,
    source: "history" | "live"
  ) => void;
  onIgnoredOlderThanLiveFloor: (event: SignalEnvelope | HelloAck) => void;
  scheduleMembersSnapshotRefresh: () => void;
  scheduleSpaceMetaRefresh: () => void;
}): void {
  if (input.source === "history") {
    input.appendTranscriptEvent(input.event, "history");
    return;
  }

  const ignoreResult = shouldIgnoreIncomingSignal({
    event: input.event,
    liveFloorTs: input.liveFloorTs,
    seenSignalIds: input.seenSignalIds,
    selfProfileId: input.selfProfileId,
  });
  if (ignoreResult.ignore) {
    if (ignoreResult.reason === "seen_replay_duplicate") {
      return;
    }
    if (ignoreResult.reason === "older_than_live_floor") {
      input.onIgnoredOlderThanLiveFloor(input.event);
    }
    return;
  }

  input.appendTranscriptEvent(input.event, "live");
  if (
    input.source === "live" &&
    shouldRefreshMembersSnapshotForEvent(input.event)
  ) {
    input.scheduleMembersSnapshotRefresh();
  }
  if (input.source === "live" && shouldRefreshSpaceMetaForEvent(input.event)) {
    input.scheduleSpaceMetaRefresh();
  }
}

// eslint-disable-next-line complexity -- keep this orchestration function intentionally sequential.
// CLI shell orchestration only: connect/join state, transport, and local UX
// coordination live here; shared space semantics must stay behind package APIs.
export async function runConnect(input: {
  profile?: string;
  openMeldProfile?: OpenMeldProfile;
  baseUrl?: string;
  space: string;
  password?: string;
  // Join-only bridge: the join handoff seam owns when this side effect is enabled.
  trackProfileSpaceHistory?: boolean;
  connectionMode: "join" | "watch";
  sendCommand?: string;
  stdio: boolean;
  output?: string;
  localEcho?: boolean;
  historyLimit?: number;
  rawStream?: boolean;
  role?: string;
  mentionAlias?: string;
  view?: string;
}) {
  const runtime = await resolveRuntimeContext({
    profile: input.profile,
    view: input.view,
  });
  const presenter = createPresenter(runtime);

  const openMeldProfile =
    input.openMeldProfile ??
    (await requireOpenMeldProfile({
      openMeldProfileId: input.profile,
      persistSelection: false,
      authAction:
        input.connectionMode === "watch"
          ? "watching a space"
          : "joining a space",
    }));
  const openMeldProfileId = openMeldProfile.openMeldProfileId;
  const baseUrl = await resolveBaseUrl(input.baseUrl);
  const space = input.space.trim();
  const shouldTrackProfileSpaceHistory =
    input.trackProfileSpaceHistory === true;
  const gatewayHost = shouldTrackProfileSpaceHistory
    ? resolveGatewayHost(baseUrl)
    : null;
  const requestedOutput: OutputMode =
    input.output === "text" ? "text" : "ndjson";
  const output: OutputMode =
    runtime.resolvedView === "agent" ? "ndjson" : requestedOutput;
  const agentRawStreamEnabled =
    runtime.resolvedView === "agent" && input.rawStream === true;
  const connectionMode = resolveConnectionModeOrThrow(input.connectionMode);
  const recentHistoryLimit = normalizeRecentHistoryLimit(input.historyLimit);
  const enableLocalEcho =
    runtime.resolvedView === "human" &&
    input.stdio &&
    output === "text" &&
    input.localEcho === true;

  const agentControllerConversationId =
    openMeldProfile.profileKind === "agent"
      ? String(
          (
            openMeldProfile as OpenMeldProfile & {
              agentControllerConversationId?: string;
            }
          ).agentControllerConversationId ?? ""
        ).trim()
      : "";
  const profileIdentity: ConnectProfileIdentity =
    buildSpaceSessionProfileIdentity({
      openMeldProfile,
      agentControllerConversationId,
    });
  const buildProfileRequestContext = () =>
    buildOpenMeldRequestContextFromProfileIdentity({
      profileIdentity,
    });
  const ownerDisplayNameByUserId = new Map<string, string>();
  rememberSessionOwnerDisplayName(ownerDisplayNameByUserId, openMeldProfile);

  const heldLock = await acquireConnectLock({
    openMeldProfileId,
    baseUrl,
    space,
    profileId: profileIdentity.openMeldProfileId,
    connectionMode,
  });

  const wsUrl = toSpaceWsUrl(baseUrl, space);

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Session flow is intentionally linear to preserve cleanup ordering and observability.
  const runSession = async (): Promise<void> => {
    const spaceMeta = await fetchSpaceMeta({
      requestContext: buildProfileRequestContext(),
      baseUrl,
      space,
      password: input.password,
    }).catch(async (err) => {
      if (gatewayHost) {
        await syncProfileSpaceHistoryStatusForJoinFailure({
          openMeldProfileId,
          requestContext: buildProfileRequestContext(),
          baseUrl,
          space,
          gatewayHost,
          error: err,
        }).catch((syncError) => {
          presenter.event(
            "info",
            "connect.warn.profile_space_history_sync_failed",
            {
              error: toErrorMessage(syncError),
            }
          );
        });
      }
      if (isSpaceNotFoundHttpError(err)) {
        throw new Error(
          formatMessage(runtime.resolvedView, "connect.error.space_not_found", {
            space,
          })
        );
      }
      throw err;
    });

    await applyFetchedSpaceMeta({
      openMeldProfileId,
      baseUrl,
      space,
      profileHandle: profileIdentity.profileHandle,
      profileName: profileIdentity.profileName,
      spaceMeta,
      output,
      rawStream: agentRawStreamEnabled,
      resolvedView: runtime.resolvedView,
    });

    let localSpaceConfig = resolveOptionalReadableLocalSpaceConfig(
      await readSpaceConfig({ openMeldProfileId, space }),
      "reading local space config before connect"
    );
    let localProfileCache = localSpaceConfig
      ? projectSpaceProfileCache(localSpaceConfig)
      : null;
    const localLastSeenTs = await readSpaceLastSeenTs({
      openMeldProfileId,
      space,
    });
    let cloudCursor = await fetchSpaceCursor({
      requestContext: buildProfileRequestContext(),
      baseUrl,
      space,
      password: input.password,
    }).catch((err) => {
      presenter.event("info", "connect.warn.cursor_fetch_failed", {
        error: toErrorMessage(err),
      });
      return null;
    });

    const localRole = normalizeRoleValue(localProfileCache?.role);
    const localMentionAlias = normalizeStoredMentionAliasValue({
      mentionAlias: localProfileCache?.mentionAlias,
      profileId: profileIdentity.openMeldProfileId,
      profileName: profileIdentity.profileName,
      profileKind: openMeldProfile.profileKind,
    });
    const roleContext = resolveSessionRoleContext({
      inputRole: input.role,
      localRole,
      cloudRole: normalizeRoleValue(cloudCursor?.role),
    });
    const mentionAlias = resolveSessionMentionAlias({
      inputMentionAlias: input.mentionAlias,
      localMentionAlias,
      cloudMentionAlias: normalizeStoredMentionAliasValue({
        mentionAlias: cloudCursor?.mentionAlias,
        profileId: profileIdentity.openMeldProfileId,
        profileName: profileIdentity.profileName,
        profileKind: openMeldProfile.profileKind,
      }),
      profileId: profileIdentity.openMeldProfileId,
      profileName: profileIdentity.profileName,
      profileKind: openMeldProfile.profileKind,
    });
    if (roleContext.role !== localRole || mentionAlias !== localMentionAlias) {
      await upsertSpaceConfig({
        openMeldProfileId,
        baseUrl,
        space,
        profileHandle: profileIdentity.profileHandle,
        profileName: profileIdentity.profileName,
        role: roleContext.role ?? null,
        mentionAlias: mentionAlias ?? null,
      });
      localSpaceConfig = resolveOptionalReadableLocalSpaceConfig(
        await readSpaceConfig({ openMeldProfileId, space }),
        "refreshing local space config after connect cache update"
      );
      localProfileCache = localSpaceConfig
        ? projectSpaceProfileCache(localSpaceConfig)
        : null;
    }

    const cloudLastSeenTs = normalizeCursorLastSeenTs(cloudCursor);
    const lastSeenTs = resolveMaxLastSeenTs(localLastSeenTs, cloudLastSeenTs);

    if (
      typeof lastSeenTs === "number" &&
      (localLastSeenTs === null || lastSeenTs > localLastSeenTs)
    ) {
      await updateSpaceLastSeenTs({
        openMeldProfileId,
        space,
        lastSeenTs,
      });
    }
    const cloudRole = normalizeRoleValue(cloudCursor?.role);
    const cloudMentionAlias = normalizeStoredMentionAliasValue({
      mentionAlias: cloudCursor?.mentionAlias,
      profileId: profileIdentity.openMeldProfileId,
      profileName: profileIdentity.profileName,
      profileKind: openMeldProfile.profileKind,
    });
    const shouldSyncLastSeen =
      typeof lastSeenTs === "number" &&
      (cloudLastSeenTs === null || lastSeenTs > cloudLastSeenTs);
    const shouldSyncRole = roleContext.role !== cloudRole;
    const shouldSyncMentionAlias = mentionAlias !== cloudMentionAlias;
    const cursorPatch = buildSpaceCursorPatch({
      lastSeenTs,
      shouldSyncRole,
      shouldSyncMentionAlias,
      role: roleContext.role,
      mentionAlias,
    });
    if (
      cursorPatch &&
      (shouldSyncLastSeen || shouldSyncRole || shouldSyncMentionAlias)
    ) {
      const updatedCursor = await updateSpaceCursor({
        requestContext: buildProfileRequestContext(),
        baseUrl,
        space,
        password: input.password,
        ...cursorPatch,
      }).catch((err) => {
        presenter.event("info", "connect.warn.cursor_patch_failed", {
          error: toErrorMessage(err),
        });
        return null;
      });
      if (updatedCursor) {
        cloudCursor = updatedCursor;
      }
    }

    const initialLiveFloorTs = resolveInitialLiveFloorTs({
      lastSeenTs,
      nowMs: Date.now(),
    });
    const sessionMeta = resolveSessionMeta(
      space,
      spaceMeta,
      localSpaceConfig?.name,
      localSpaceConfig?.spaceCreatedAt
    );
    const readModelSeed = resolveSpaceJoinReadModelSeed({
      baseUrl,
      ownerDisplayNameByUserId,
      password: input.password,
      profileIdentity,
      space,
    });

    if (runtime.resolvedView === "human" && input.stdio && output === "text") {
      if (gatewayHost) {
        await syncProfileSpaceHistoryActive({
          openMeldProfileId,
          requestContext: buildProfileRequestContext(),
          baseUrl,
          space,
          gatewayHost,
          spaceMeta,
          lastSeenTs,
        }).catch((error) => {
          presenter.event(
            "info",
            "connect.warn.profile_space_history_sync_failed",
            {
              error: toErrorMessage(error),
            }
          );
        });
      }

      const sessionDiagnosticsPromise = resolveSpaceSessionDiagnostics({
        baseUrl,
        profile: openMeldProfile,
      });

      await runInteractiveHumanTextSession({
        openMeldProfileId,
        baseUrl,
        space,
        password: input.password,
        presenter,
        profileIdentity,
        connectionMode,
        sessionMeta,
        wsUrl,
        recentHistoryLimit,
        initialLiveFloorTs,
        lastSeenTs,
        enableLocalEcho,
        ownerDisplayNameByUserId,
        readModelSeed,
        sessionDiagnosticsPromise,
      });
      return;
    }

    let liveFloorTs = initialLiveFloorTs;

    let pendingLastSeen: number | null = null;
    let pendingTimer: NodeJS.Timeout | null = null;
    const activityRowsById = new Map<string, DispatchActivityRowState>();
    let rl: ReturnType<typeof createInterface> | null = null;
    let hasPrintedTextLine = false;
    let lastPrintedTextLineGroupKey: string | null = null;
    let nextDividerGapPlacement: "top" | "bottom" = "top";
    let allowLiveCursorPersistence = true;
    let persistedLastSeenFloorTs = initialLiveFloorTs;
    const pauseLiveCursorPersistence = (): void => {
      if (!allowLiveCursorPersistence) {
        return;
      }
      allowLiveCursorPersistence = false;
      presenter.event("info", "connect.warn.cursor_sync_paused");
    };
    const shouldHideSubmittedInputLine =
      runtime.resolvedView === "human" && input.stdio && output === "text";
    const enableReplyingPromptStatus = shouldHideSubmittedInputLine;
    const includeReplyingStatusInPrompt = false;
    const composePromptPrefix = pc.dim("[draft] ");
    let composeDraftState: ComposeDraftState = emptyComposeDraft();
    let replyingStatusSweepTimer: NodeJS.Timeout | null = null;
    const pruneExpiredReplyingStatuses = (): void => {
      if (!enableReplyingPromptStatus || activityRowsById.size === 0) {
        return;
      }
      pruneExpiredDispatchRows(activityRowsById, Date.now());
    };
    const resolveReplyingStatusTexts = (): string[] => {
      pruneExpiredReplyingStatuses();
      return resolveDispatchRowStatusTexts({
        rowsById: activityRowsById,
        terminalColumns: resolveReplyingStatusColumns(),
      });
    };
    const resolveInputPrompt = (): string => {
      const baseInputPrompt = formatInputPrompt(profileIdentity, {
        spaceMembersSnapshot: readModelSeed.getMembersSnapshot(),
      });
      if (composeDraftState.lines.length > 0) {
        return `${composePromptPrefix}${baseInputPrompt}`;
      }
      if (!enableReplyingPromptStatus) {
        return baseInputPrompt;
      }
      if (!includeReplyingStatusInPrompt) {
        return baseInputPrompt;
      }
      const replyingStatuses = resolveReplyingStatusTexts();
      if (replyingStatuses.length === 0) {
        return baseInputPrompt;
      }
      return `${baseInputPrompt}[${replyingStatuses[0]}] `;
    };
    const refreshInputPrompt = (): void => {
      if (!(rl && runtime.resolvedView === "human")) {
        return;
      }
      rl.setPrompt(resolveInputPrompt());
      rl.prompt(true);
    };
    const resolvePromptCursorRows = (): number => {
      if (!(rl && runtime.resolvedView === "human" && process.stdout.isTTY)) {
        return 0;
      }
      try {
        const rows = rl.getCursorPos().rows;
        return Number.isInteger(rows) && rows > 0 ? rows : 0;
      } catch {
        return 0;
      }
    };
    const countPromptDisplayRows = (inputText: string): number => {
      const columns = resolveReplyingStatusColumns();
      if (columns === null) {
        return 1;
      }
      const promptWidth = stringWidth(resolveInputPrompt());
      const inputWidth = stringWidth(inputText);
      const totalWidth = Math.max(1, promptWidth + inputWidth);
      return Math.max(1, Math.ceil(totalWidth / columns));
    };
    let visibleReplyingStatusLine = "";
    let visibleReplyingStatusLineRows = 0;
    const canRenderReplyingStatusLine = (): boolean => {
      return (
        enableReplyingPromptStatus &&
        process.stdout.isTTY &&
        rl !== null &&
        runtime.resolvedView === "human"
      );
    };
    const clearInteractiveOverlay = (input?: {
      submittedInputText?: string;
      includeVisibleReplyingStatus?: boolean;
    }): void => {
      if (!(runtime.resolvedView === "human" && rl && process.stdout.isTTY)) {
        return;
      }
      const promptRowsAboveCurrent =
        typeof input?.submittedInputText === "string"
          ? countPromptDisplayRows(input.submittedInputText)
          : resolvePromptCursorRows();
      const visibleReplyingRowsAbovePrompt =
        input?.includeVisibleReplyingStatus === true &&
        visibleReplyingStatusLine.length > 0
          ? REPLYING_STATUS_PROMPT_GAP_LINES + visibleReplyingStatusLineRows
          : 0;
      const rowsAboveCurrent =
        promptRowsAboveCurrent + visibleReplyingRowsAbovePrompt;
      clearLine(process.stdout, 0);
      cursorTo(process.stdout, 0);
      for (let rowOffset = 0; rowOffset < rowsAboveCurrent; rowOffset += 1) {
        moveCursor(process.stdout, 0, -1);
        clearLine(process.stdout, 0);
        cursorTo(process.stdout, 0);
      }
      if (input?.includeVisibleReplyingStatus === true) {
        visibleReplyingStatusLine = "";
        visibleReplyingStatusLineRows = 0;
      }
    };
    const clearVisibleReplyingStatusLine = (): void => {
      if (
        !canRenderReplyingStatusLine() ||
        visibleReplyingStatusLine.length === 0
      ) {
        return;
      }
      clearInteractiveOverlay({
        includeVisibleReplyingStatus: true,
      });
    };
    const renderVisibleReplyingStatusLine = (text: string): void => {
      if (!canRenderReplyingStatusLine()) {
        return;
      }
      const normalizedText = text.trim();
      if (!normalizedText) {
        clearVisibleReplyingStatusLine();
        return;
      }
      if (visibleReplyingStatusLine === normalizedText) {
        return;
      }
      if (visibleReplyingStatusLine.length > 0) {
        clearVisibleReplyingStatusLine();
      } else {
        clearPromptLineBeforeExternalWrite();
      }
      process.stdout.write(
        `${normalizedText}${"\n".repeat(REPLYING_STATUS_PROMPT_GAP_LINES + 1)}`
      );
      visibleReplyingStatusLine = normalizedText;
      visibleReplyingStatusLineRows = countRenderedTerminalRows(normalizedText);
    };
    const syncReplyingStatusPresentation = (): void => {
      const promptStatuses = resolveReplyingStatusTexts();
      if (promptStatuses.length > 0) {
        const decoratedReplyingStatus = promptStatuses
          .map((statusText) => {
            return `* ${REPLYING_STATUS_SYSTEM_LABEL} · ${REPLYING_STATUS_AGENT_LABEL} ${statusText}`;
          })
          .join("\n");
        renderVisibleReplyingStatusLine(pc.dim(decoratedReplyingStatus));
      } else {
        clearVisibleReplyingStatusLine();
      }
      refreshInputPrompt();
    };
    const scheduleReplyingStatusSweep = (): void => {
      if (replyingStatusSweepTimer) {
        clearTimeout(replyingStatusSweepTimer);
        replyingStatusSweepTimer = null;
      }
      if (!enableReplyingPromptStatus || activityRowsById.size === 0) {
        return;
      }
      const nearestExpiryMs =
        resolveNearestDispatchRowExpiryMs(activityRowsById);
      if (nearestExpiryMs === null) {
        return;
      }
      const delayMs = Math.max(250, nearestExpiryMs - Date.now());
      replyingStatusSweepTimer = setTimeout(() => {
        pruneExpiredReplyingStatuses();
        syncReplyingStatusPresentation();
        scheduleReplyingStatusSweep();
      }, delayMs);
    };
    const handleReplyingHintStatusEvent = (event: SignalEnvelope): void => {
      if (!enableReplyingPromptStatus || event.type !== "signal.text") {
        return;
      }
      const statusChanged =
        applyDispatchActivityEventToStatusMap({
          rowsById: activityRowsById,
          event,
          nowMs: Date.now(),
        }) ||
        clearDispatchActivitiesForSignal({
          rowsById: activityRowsById,
          event,
        });
      if (!statusChanged) {
        return;
      }
      scheduleReplyingStatusSweep();
      syncReplyingStatusPresentation();
    };
    const flushLastSeen = async () => {
      if (!pendingLastSeen) {
        return;
      }
      if (!allowLiveCursorPersistence) {
        pendingLastSeen = null;
        return;
      }
      const ts = pendingLastSeen;
      pendingLastSeen = null;
      await updateSpaceLastSeenTs({
        openMeldProfileId,
        space,
        lastSeenTs: ts,
      });
      await updateSpaceCursor({
        requestContext: buildProfileRequestContext(),
        baseUrl,
        space,
        password: input.password,
        lastSeenTs: ts,
      }).catch((err) => {
        presenter.event("info", "connect.warn.persist_last_seen", {
          error: toErrorMessage(err),
        });
      });
    };
    const scheduleLastSeen = (ts: number) => {
      pendingLastSeen = Math.max(pendingLastSeen ?? 0, ts);
      if (pendingTimer) {
        return;
      }
      pendingTimer = setTimeout(async () => {
        pendingTimer = null;
        try {
          await flushLastSeen();
        } catch (err) {
          presenter.event("info", "connect.warn.persist_last_seen", {
            error: toErrorMessage(err),
          });
        }
      }, 1000);
    };
    const cancelLastSeenTimer = () => {
      if (!pendingTimer) {
        return;
      }
      clearTimeout(pendingTimer);
      pendingTimer = null;
    };
    const scheduleEventLastSeen = (event: SignalEnvelope | HelloAck): void => {
      if (!isSignalEnvelope(event)) {
        return;
      }
      if (!allowLiveCursorPersistence) {
        return;
      }
      if (event.ts <= persistedLastSeenFloorTs) {
        return;
      }
      persistedLastSeenFloorTs = event.ts;
      scheduleLastSeen(event.ts);
    };
    const consumePendingOutboundConfirmation = (
      event: SignalEnvelope | HelloAck
    ): void => {
      if (
        event.type !== "signal.text" ||
        event.profile?.profileId !== profileIdentity.openMeldProfileId
      ) {
        return;
      }
      if (
        !confirmPendingOutboundRows({
          rowsById: activityRowsById,
          clientMessageId: resolveSignalClientMessageId(event),
        })
      ) {
        return;
      }
      syncReplyingStatusPresentation();
    };
    const emitTextGroupDivider = (): void => {
      const dividerLine = buildChatGroupDividerLine();
      if (!dividerLine) {
        process.stdout.write("\n");
        return;
      }
      const useTopGap = nextDividerGapPlacement === "top";
      const topGapLines = useTopGap ? CHAT_GROUP_DIVIDER_SIDE_GAP_LINES : 0;
      const bottomGapLines = useTopGap ? 0 : CHAT_GROUP_DIVIDER_SIDE_GAP_LINES;
      process.stdout.write(
        `${"\n".repeat(topGapLines)}${dividerLine}\n${"\n".repeat(bottomGapLines)}`
      );
      nextDividerGapPlacement = useTopGap ? "bottom" : "top";
    };
    const emitTextLine = (inputLine: {
      line: string;
      groupKey: string;
      refreshPrompt?: boolean;
    }): void => {
      if (runtime.resolvedView !== "human") {
        process.stdout.write(`${inputLine.line}\n`);
        return;
      }
      clearPromptLineBeforeExternalWrite();
      const isGroupBoundary =
        hasPrintedTextLine &&
        lastPrintedTextLineGroupKey !== inputLine.groupKey;
      if (isGroupBoundary) {
        emitTextGroupDivider();
      }
      process.stdout.write(`${inputLine.line}\n`);
      hasPrintedTextLine = true;
      lastPrintedTextLineGroupKey = inputLine.groupKey;
      if (inputLine.refreshPrompt !== false && rl) {
        process.stdout.write("\n");
        refreshInputPrompt();
      }
    };
    const clearSubmittedInputLine = (line: string): void => {
      if (!(shouldHideSubmittedInputLine && process.stdout.isTTY)) {
        return;
      }
      // Keep chat output clean: remove the full submitted prompt/input block,
      // even when it wrapped across multiple terminal rows.
      clearInteractiveOverlay({
        submittedInputText: line,
      });
    };
    const clearPromptLineBeforeExternalWrite = (): void => {
      if (!(runtime.resolvedView === "human" && rl && process.stdout.isTTY)) {
        return;
      }
      clearInteractiveOverlay();
    };
    const catchupSeenSignalIds = new Set<string>();
    const recordConnectEvent = (
      event: SignalEnvelope | HelloAck,
      source: "history" | "live"
    ): void => {
      scheduleEventLastSeen(event);
      if (isSignalEnvelope(event)) {
        liveFloorTs = Math.max(liveFloorTs, event.ts);
        if (source === "live") {
          rememberSeenSignalId(catchupSeenSignalIds, event.id);
          readModelSeed.rememberSignal(event);
        }
        handleReplyingHintStatusEvent(event);
      }

      consumePendingOutboundConfirmation(event);
    };
    const emitNdjsonEvent = (event: SignalEnvelope | HelloAck): void => {
      if (isSignalEnvelope(event)) {
        const signal =
          runtime.resolvedView === "agent"
            ? (normalizeAgentOutputEvent(event) as SignalEnvelope)
            : event;
        outJsonLine(
          buildFormalSignalReadPayload({
            signal,
            membersSnapshot: readModelSeed.getMembersSnapshot(),
            signalIndex: readModelSeed.getSignalIndex(),
          })
        );
        return;
      }

      outJsonLine(
        runtime.resolvedView === "agent"
          ? normalizeAgentOutputEvent(event)
          : event
      );
    };
    const emitHumanTextEvent = (event: SignalEnvelope | HelloAck): void => {
      emitHumanConnectTranscriptEvent({
        event,
        ownerDisplayNameByUserId,
        readModelSeed,
        sessionProfileIdentity: profileIdentity,
        onTranscriptItem: (transcriptItem) => {
          emitTextLine({
            line: transcriptItem.line,
            groupKey: transcriptItem.groupKey,
          });
        },
      });
    };
    const emitReplayHistoryTranscript = (inputLines: {
      lines: readonly string[];
      lastTranscriptGroupKey: string | null;
    }): void => {
      for (const line of inputLines.lines) {
        process.stdout.write(`${line}\n`);
      }
      if (inputLines.lastTranscriptGroupKey) {
        hasPrintedTextLine = true;
        lastPrintedTextLineGroupKey = inputLines.lastTranscriptGroupKey;
      }
    };
    const emitEvent = (
      event: SignalEnvelope | HelloAck,
      source: "history" | "live"
    ): void => {
      recordConnectEvent(event, source);
      if (output === "ndjson") {
        emitNdjsonEvent(event);
        return;
      }
      emitHumanTextEvent(event);
    };
    const ws = await connectWebSocket(wsUrl, {
      headers: await buildOpenMeldProfileIdentityRequestHeadersWithAuth({
        requestUrl: wsUrl,
        profileIdentity,
        spacePassword: input.password,
      }),
    }).catch((err) => {
      throw new Error(toErrorMessage(err));
    });
    const initialMembersSnapshot = await readModelSeed
      .ensureMembersSnapshotLoaded()
      .catch((error: unknown) => {
        presenter.event("info", "connect.warn.members_fetch_failed", {
          error: toErrorMessage(error),
        });
        return readModelSeed.getMembersSnapshot();
      });

    if (gatewayHost) {
      await syncProfileSpaceHistoryActive({
        openMeldProfileId,
        requestContext: buildProfileRequestContext(),
        baseUrl,
        space,
        gatewayHost,
        spaceMeta,
        lastSeenTs,
      }).catch((error) => {
        presenter.event(
          "info",
          "connect.warn.profile_space_history_sync_failed",
          {
            error: toErrorMessage(error),
          }
        );
      });
    }

    emitSessionMeta({
      accessMode: sessionMeta.accessMode,
      output,
      spaceId: sessionMeta.spaceId,
      spaceName: sessionMeta.spaceName,
      spaceCreatedAt: sessionMeta.spaceCreatedAt,
      spaceCreatorName: sessionMeta.spaceCreatorName,
      spaceCreatorId: sessionMeta.spaceCreatorId,
      passwordProtected: sessionMeta.passwordProtected,
      profileId: profileIdentity.openMeldProfileId,
      profileName: profileIdentity.profileName,
      profileKind: profileIdentity.kind,
      ownerUserId: profileIdentity.ownerUserId,
      ownerName: profileIdentity.ownerName,
      agentControllerRef: profileIdentity.agentControllerRef,
      agentControllerConversationId:
        profileIdentity.agentControllerConversationId,
      modelSelection: resolveSessionProfileModelSelection({
        profileId: profileIdentity.openMeldProfileId,
        spaceMembersSnapshot: readModelSeed.getMembersSnapshot() ?? undefined,
      }),
      spaceMembersSnapshot: readModelSeed.getMembersSnapshot() ?? undefined,
      gatewayUrl: baseUrl,
      stdio: input.stdio,
      visibility: sessionMeta.visibility,
    });
    if (output === "ndjson" && initialMembersSnapshot) {
      emitSpaceMembers(
        runtime.resolvedView === "agent"
          ? normalizeAgentOutputMembersSnapshot(initialMembersSnapshot)
          : initialMembersSnapshot
      );
    }

    let isReplayingHistory = true;
    const bufferedLiveEvents: Array<SignalEnvelope | HelloAck> = [];
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Event handling keeps the replay/live merge rules in one place.
    const handleIncomingEvent = (event: SignalEnvelope | HelloAck): void => {
      const ignoreResult = shouldIgnoreIncomingSignal({
        event,
        liveFloorTs,
        seenSignalIds: catchupSeenSignalIds,
        selfProfileId: profileIdentity.openMeldProfileId,
      });
      if (ignoreResult.ignore) {
        if (ignoreResult.reason === "seen_replay_duplicate") {
          return;
        }
        if (ignoreResult.reason === "older_than_live_floor") {
          processIgnoredOlderThanLiveFloorSignal({
            event,
            seenSignalIds: catchupSeenSignalIds,
            onDispatchActivityEvent: handleReplyingHintStatusEvent,
          });
          return;
        }
        return;
      }
      if (isReplayingHistory) {
        if (bufferedLiveEvents.length < CATCHUP_LIVE_BUFFER_MAX) {
          bufferedLiveEvents.push(event);
          return;
        }
        isReplayingHistory = false;
        presenter.event("info", "connect.warn.catchup_live_buffer_overflow", {
          limit: CATCHUP_LIVE_BUFFER_MAX,
        });
        pauseLiveCursorPersistence();
        for (const bufferedEvent of bufferedLiveEvents) {
          handleIncomingEvent(bufferedEvent);
        }
        bufferedLiveEvents.length = 0;
      }
      emitEvent(event, "live");
    };

    ws.onMessage((raw) => {
      const parsed = safeJsonParse(raw);
      const serverError = parseServerErrorFrame(parsed);
      if (serverError) {
        if (output === "ndjson") {
          outJsonLine(serverError);
          return;
        }
        errLine(
          `space stream error: ${formatServerErrorFrameMessage(serverError)}`
        );
        return;
      }
      const event = parseIncoming(parsed);
      if (!event) {
        if (output === "ndjson") {
          outJsonLine({ type: "raw", data: raw });
        }
        return;
      }
      handleIncomingEvent(event);
    });

    let isClosing = false;
    let localCloseReason: string | null = null;
    let wsEnded = false;
    ws.onClose((code, reason) => {
      wsEnded = true;
      const closeDetails = resolveWebSocketCloseDetails({ code, reason });
      reportPendingOutboundUnconfirmed({
        context: "closed",
        reason: closeDetails.reason,
      });
      if (
        shouldRenderHumanNormalLeaveCard({
          resolvedView: runtime.resolvedView,
          closeCode: closeDetails.code,
          localCloseReason,
          exitCode: process.exitCode,
        })
      ) {
        clearPromptLineBeforeExternalWrite();
        emitHumanNormalLeaveCard({
          spaceId: sessionMeta.spaceId,
          writeLine: (codeLabel, text) => {
            presenter.line({
              code: codeLabel,
              text,
            });
          },
        });
        process.exitCode = process.exitCode ?? 0;
        return;
      }
      if (isClosing && closeDetails.code === 1006) {
        presenter.event("info", "connect.closed");
        process.exitCode = process.exitCode ?? 0;
        return;
      }
      presenter.event("info", "connect.closed_with_code_reason", closeDetails);
      process.exitCode = process.exitCode ?? 0;
    });

    ws.onError((err) => {
      wsEnded = true;
      reportPendingOutboundUnconfirmed({
        context: "error",
        reason: toErrorMessage(err),
      });
      presenter.event(
        "error",
        "connect.error",
        resolveWebSocketError(err, runtime.resolvedView)
      );
      process.exitCode = 1;
    });

    ws.send(JSON.stringify(makeHello(toProtocolProfile(profileIdentity))));

    const replayState = await replayConnectInitialHistoryBootstrap({
      profileIdentity,
      baseUrl,
      space,
      password: input.password,
      recentHistoryLimit,
      readModelSeed,
      ownerDisplayNameByUserId,
      seenSignalIds: catchupSeenSignalIds,
      onReplayEvent: (event) => {
        if (output === "ndjson") {
          emitEvent(event, "history");
          return;
        }
        recordConnectEvent(event, "history");
      },
      onReplayTranscriptRendered:
        output === "text" && runtime.resolvedView === "human"
          ? emitReplayHistoryTranscript
          : undefined,
      onError: (err) => {
        presenter.event("info", "connect.warn.catchup_failed", {
          error: toErrorMessage(err),
        });
      },
    });
    liveFloorTs = Math.max(
      liveFloorTs,
      replayState.latestReplayedSignalTs ?? liveFloorTs
    );
    if (!replayState.synced) {
      pauseLiveCursorPersistence();
    }
    isReplayingHistory = false;
    for (const event of bufferedLiveEvents) {
      handleIncomingEvent(event);
    }
    bufferedLiveEvents.length = 0;
    let forceTerminateTimer: NodeJS.Timeout | null = null;
    const clearForceTerminate = () => {
      if (!forceTerminateTimer) {
        return;
      }
      clearTimeout(forceTerminateTimer);
      forceTerminateTimer = null;
    };
    const cleanup = (why: string) => {
      if (isClosing) {
        return;
      }
      isClosing = true;
      localCloseReason = why;

      // Remove signal handlers immediately to avoid duplicate cleanup logs.
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);

      if (runtime.resolvedView !== "human") {
        presenter.event("info", "connect.closing", { why });
      }
      try {
        rl?.close();
      } catch {
        // ignore
      }

      try {
        ws.close(1000, why);
      } catch {
        // ignore
      }

      // Give the close handshake a brief window before forcing termination.
      forceTerminateTimer = setTimeout(() => {
        try {
          ws.terminate();
        } catch {
          // ignore
        }
      }, 800);
      ws.waitUntilClosed().then(clearForceTerminate).catch(clearForceTerminate);
    };
    const onSigint = () => cleanup("SIGINT");
    const onSigterm = () => cleanup("SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    if (wsEnded) {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      if (replyingStatusSweepTimer) {
        clearTimeout(replyingStatusSweepTimer);
        replyingStatusSweepTimer = null;
      }
      cancelLastSeenTimer();
      await flushLastSeen();
      return;
    }

    if (!input.stdio) {
      const noStdioEventData = buildNoStdioEventData({
        connectionMode,
        profileId: profileIdentity.openMeldProfileId,
        spaceId: space,
        sendCommand: input.sendCommand,
      });
      if (output === "text") {
        if (connectionMode === "watch") {
          presenter.event("info", "connect.watch_ready");
        } else {
          presenter.event(
            "info",
            "connect.connected_no_stdio",
            noStdioEventData
          );
        }
      } else if (!agentRawStreamEnabled) {
        presenter.event("info", "connect.connected_no_stdio", noStdioEventData);
      }
      await ws.waitUntilClosed();
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      if (replyingStatusSweepTimer) {
        clearTimeout(replyingStatusSweepTimer);
        replyingStatusSweepTimer = null;
      }
      cancelLastSeenTimer();
      await flushLastSeen();
      return;
    }

    if (output === "text") {
      if (runtime.resolvedView === "human") {
        process.stdout.write("\n");
      }
      const chatWakeupHintText = formatMessage(
        runtime.resolvedView,
        "connect.chat_mention_hint"
      );
      const chatReadyText = formatMessage(
        runtime.resolvedView,
        "connect.chat_ready"
      );
      const chatExitHintText = formatMessage(
        runtime.resolvedView,
        "connect.chat_exit_hint"
      );
      const chatPromptQuestionText = formatMessage(
        runtime.resolvedView,
        "connect.chat_prompt_question"
      );
      if (runtime.resolvedView === "human") {
        process.stdout.write(`${pc.dim(chatWakeupHintText)}\n`);
      }
      process.stdout.write(`${pc.dim(chatReadyText)}\n`);
      process.stdout.write(`${pc.dim(chatExitHintText)}\n`);
      if (runtime.resolvedView === "human") {
        process.stdout.write(`\n${pc.dim(chatPromptQuestionText)}\n`);
      }
    } else {
      presenter.event("info", "connect.connected_stdio");
    }
    rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal:
        runtime.resolvedView === "human" && process.stdout.isTTY === true,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    if (runtime.resolvedView === "human") {
      rl.setPrompt(resolveInputPrompt());
      rl.prompt();
    }
    const resolveOutboundTextFromLine = (
      line: string
    ): { kind: "quit" } | { kind: "none" } | { kind: "send"; text: string } => {
      const action = consumeComposeInputLine({
        line,
        draft: composeDraftState,
      });
      if (action.kind === "quit") {
        return { kind: "quit" };
      }
      if (action.kind === "continue") {
        composeDraftState = action.nextDraft;
        if (runtime.resolvedView === "human") {
          refreshInputPrompt();
        }
        return { kind: "none" };
      }

      composeDraftState = action.nextDraft;
      const sanitized = sanitizeText(action.text);
      if (!sanitized.ok) {
        presenter.event("info", "connect.reject", { reason: sanitized.reason });
        if (runtime.resolvedView === "human") {
          refreshInputPrompt();
        }
        return { kind: "none" };
      }

      return {
        kind: "send",
        text: sanitized.value,
      };
    };
    function reportOutboundSendFailure(inputFailure: {
      error: string;
      hint?: string;
    }): void {
      syncReplyingStatusPresentation();
      presenter.event("error", "connect.error", inputFailure);
      process.exitCode = 1;
      if (runtime.resolvedView === "human") {
        refreshInputPrompt();
      }
    }
    function reportPendingOutboundUnconfirmed(inputPending: {
      context: "closed" | "error";
      reason?: string;
    }): void {
      if (!clearUnconfirmedPendingOutboundRows(activityRowsById)) {
        return;
      }
      syncReplyingStatusPresentation();
      const reasonSuffix = inputPending.reason
        ? ` (${inputPending.reason})`
        : "";
      presenter.event("error", "connect.error", {
        error: `last message may not have been confirmed before the connection ${inputPending.context === "closed" ? "closed" : "failed"}${reasonSuffix}`,
        hint: "rejoin the space and send it again if you still do not see it",
      });
      process.exitCode = 1;
    }
    const prepareRawStdioOutboundText = async (text: string) => {
      const preparedSubmission = await prepareCliSpaceComposerSubmission({
        missingSnapshotMessage:
          "Cannot validate mention labels right now because current space members could not be loaded.",
        onMembersSnapshotLoaded: (membersSnapshot) => {
          readModelSeed.applyMembersSnapshot(membersSnapshot);
        },
        onSnapshotLoadFailure: (error) => {
          presenter.event("info", "connect.warn.members_fetch_failed", {
            error: toErrorMessage(error),
          });
          rethrowCanonicalMentionSnapshotLoadFailure(error);
        },
        loadMembersSnapshot: async () => {
          const currentMembersSnapshot = readModelSeed.getMembersSnapshot();
          if (currentMembersSnapshot) {
            return currentMembersSnapshot;
          }
          return await readModelSeed.ensureMembersSnapshotLoaded();
        },
        text,
      });

      return {
        messageEnvelope: preparedSubmission.outboundMessageEnvelope ?? null,
        text: preparedSubmission.outboundText,
      };
    };
    const sendOutboundText = async (inputText: string): Promise<void> => {
      if (isClosing || wsEnded) {
        reportOutboundSendFailure({
          error:
            "couldn't send the message because the space connection is already closed",
          hint: "rejoin the space and try sending it again",
        });
        return;
      }
      const preparedOutboundText = await prepareRawStdioOutboundText(
        inputText
      ).catch((error) => {
        presenter.event("info", "connect.reject", {
          reason: toErrorMessage(error),
        });
        if (runtime.resolvedView === "human") {
          refreshInputPrompt();
        }
        return null;
      });
      if (!preparedOutboundText) {
        return;
      }
      const outboundText = preparedOutboundText.text;
      const clientMessageId = crypto.randomUUID();
      try {
        ws.send(
          JSON.stringify(
            toLegacySpaceAddressingWireValue(
              makeTextSignal(outboundText, {
                ...(preparedOutboundText.messageEnvelope
                  ? { messageEnvelope: preparedOutboundText.messageEnvelope }
                  : {}),
                meta: {
                  clientMessageId,
                },
              })
            )
          )
        );
      } catch (error) {
        reportOutboundSendFailure({
          error: `couldn't send the message: ${toErrorMessage(error)}`,
          hint: "rejoin the space and try sending it again",
        });
        return;
      }
      upsertPendingHumanSendRow({
        enableLocalEcho,
        rowsById: activityRowsById,
        text: outboundText,
        clientMessageId,
        terminalColumns: resolveReplyingStatusColumns(),
        nowMs: Date.now(),
        maxPendingRows: PENDING_OUTBOUND_CONFIRMATION_MAX,
      });
      syncReplyingStatusPresentation();
      if (runtime.resolvedView === "human") {
        refreshInputPrompt();
      }
    };
    rl.on("line", (line) => {
      const resolution = resolveOutboundTextFromLine(line);
      if (resolution.kind === "quit") {
        cleanup("quit");
        return;
      }
      if (resolution.kind === "none") {
        return;
      }
      setImmediate(() => {
        clearSubmittedInputLine(line);
        sendOutboundText(resolution.text).catch((error) => {
          reportOutboundSendFailure({
            error: `couldn't send the message: ${toErrorMessage(error)}`,
            hint: "rejoin the space and try sending it again",
          });
        });
      });
    });
    rl.on("close", () => {
      cleanup("stdin closed");
    });

    await ws.waitUntilClosed();
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    clearForceTerminate();
    if (replyingStatusSweepTimer) {
      clearTimeout(replyingStatusSweepTimer);
      replyingStatusSweepTimer = null;
    }
    cancelLastSeenTimer();
    await flushLastSeen();
  };

  if (!heldLock) {
    return await runSession();
  }

  return await runWithHeldLock({
    lock: heldLock.lock,
    run: runSession,
    releaseContext: {
      component: "space.connect",
      lockKey: heldLock.lockKey,
      mode: connectionMode,
      profileId: profileIdentity.openMeldProfileId,
      space,
    },
  });
}

// eslint-disable-next-line complexity -- keep the interactive shell/runtime orchestration linear to preserve event ordering and cleanup safety.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This function coordinates shell, runtime, store, and shutdown sequencing in one place.
async function runInteractiveHumanTextSession(input: {
  openMeldProfileId: string;
  baseUrl: string;
  space: string;
  password?: string;
  presenter: ReturnType<typeof createPresenter>;
  profileIdentity: ConnectProfileIdentity;
  connectionMode: "join" | "watch";
  sessionMeta: ReturnType<typeof resolveSessionMeta>;
  wsUrl: string;
  recentHistoryLimit: number;
  initialLiveFloorTs: number;
  lastSeenTs: number | null;
  enableLocalEcho: boolean;
  ownerDisplayNameByUserId: Map<string, string>;
  readModelSeed: SpaceJoinReadModelSeed;
  sessionDiagnosticsPromise: ReturnType<typeof resolveSpaceSessionDiagnostics>;
}): Promise<void> {
  const store = createSpaceScreenStore();
  const composerController = new ComposerController();
  let openOverlayFromShell: ((kind: SpacePanelKind) => void) | null = null;
  const sessionContext = buildActiveSpaceSessionContext({
    profile: buildSpaceSessionProfileContextFromIdentity({
      kind: input.profileIdentity.kind,
      ownerName: input.profileIdentity.ownerName,
      ownerUserId: input.profileIdentity.ownerUserId,
      openMeldProfileId: input.profileIdentity.openMeldProfileId,
      profileName: input.profileIdentity.profileName,
    }),
    baseUrl: input.baseUrl,
    connectionMode: input.connectionMode,
    session: {
      accessMode: input.sessionMeta.accessMode ?? null,
      spaceCreatedAt: input.sessionMeta.spaceCreatedAt ?? null,
      spaceCreatorId: input.sessionMeta.spaceCreatorId ?? null,
      spaceCreatorName: input.sessionMeta.spaceCreatorName ?? null,
      spaceId: input.sessionMeta.spaceId,
      spaceName: input.sessionMeta.spaceName ?? null,
      passwordProtected: input.sessionMeta.passwordProtected ?? null,
      storageSoftLimitBytes: input.sessionMeta.storageSoftLimitBytes ?? null,
      storageUsagePercent: input.sessionMeta.storageUsagePercent ?? null,
      storageUsedBytes: input.sessionMeta.storageUsedBytes ?? null,
      visibility: input.sessionMeta.visibility ?? null,
    },
  });
  const preferredShellKind = resolveInteractiveHumanShellKind();
  let activeShellKind = preferredShellKind;
  let shell!: InteractiveSpaceShell;
  let removeStoreListener: () => void = () => undefined;
  let piTuiSessionMount: ReturnType<typeof mountPiTuiSessionShell> | null =
    null;
  let localCloseReason: string | null = null;
  let sessionDiagnostics: Awaited<
    ReturnType<typeof resolveSpaceSessionDiagnostics>
  > = {
    openMeldServiceLabel: "unknown",
    canWakeLocalAgentsLabel: "unknown",
  };
  let recentMentionProfileIds = await readSpaceRecentMentionProfileIds({
    openMeldProfileId: input.openMeldProfileId,
    space: input.space,
  });
  const buildCurrentViewState = () =>
    buildSpaceSessionViewState({
      context: sessionContext,
      resources: {
        composerActivity: {
          nowMs: Date.now(),
          rows: toComposerDispatchRows(activityRowsById),
        },
        sessionDiagnostics,
      },
      screenState: store.getState(),
    });
  const refreshCurrentViewState = (): void => {
    if (piTuiSessionMount) {
      piTuiSessionMount.refreshViewState();
      return;
    }
    shell.render(buildCurrentViewState());
  };
  const syncShellRenderSubscription = (): void => {
    removeStoreListener();
    if (shell instanceof PiTuiInteractiveSpaceShell) {
      piTuiSessionMount = mountPiTuiSessionShell({
        context: sessionContext,
        getResources: () => ({
          composerActivity: {
            nowMs: Date.now(),
            rows: toComposerDispatchRows(activityRowsById),
          },
          sessionDiagnostics,
        }),
        shell,
        store,
      });
      removeStoreListener = piTuiSessionMount.removeStoreListener;
      return;
    }
    piTuiSessionMount = null;
    removeStoreListener = store.subscribe(() => {
      shell.render(buildCurrentViewState());
    });
  };

  const activityRowsById = new Map<string, DispatchActivityRowState>();
  const catchupSeenSignalIds = new Set<string>();
  let liveFloorTs = input.initialLiveFloorTs;
  let allowLiveCursorPersistence = true;
  let persistedLastSeenFloorTs = input.initialLiveFloorTs;
  let pendingLastSeen: number | null = null;
  let pendingTimer: NodeJS.Timeout | null = null;
  let replyingStatusSweepTimer: NodeJS.Timeout | null = null;
  let membersSnapshotRefreshTimer: NodeJS.Timeout | null = null;
  let spaceMetaRefreshTimer: NodeJS.Timeout | null = null;
  let isClosing = false;
  let wsEnded = false;
  let interactiveIntroEmitted = false;

  ignoreAsyncResult(
    input.sessionDiagnosticsPromise
      .then((resolvedDiagnostics) => {
        sessionDiagnostics = resolvedDiagnostics;
        if (!(isClosing || wsEnded)) {
          refreshCurrentViewState();
        }
      })
      .catch(() => undefined)
  );

  const applyMembersSnapshot = (
    membersSnapshot: SpaceMembersSnapshot | null
  ): void => {
    input.readModelSeed.applyMembersSnapshot(membersSnapshot);
    store.dispatch({
      type: "members.updated",
      snapshot: input.readModelSeed.getMembersSnapshot(),
      updatedAtMs: Date.now(),
    });
    syncMembersOverlayInteraction();
  };
  const applySessionStorageUsage = (spaceMeta: SpaceMeta): void => {
    const storageUsage = spaceMeta.storageUsage;
    sessionContext.session.storageUsedBytes =
      typeof storageUsage?.usedBytes === "number"
        ? storageUsage.usedBytes
        : null;
    sessionContext.session.storageSoftLimitBytes =
      typeof storageUsage?.softLimitBytes === "number"
        ? storageUsage.softLimitBytes
        : null;
    sessionContext.session.storageUsagePercent =
      typeof storageUsage?.usagePercent === "number"
        ? storageUsage.usagePercent
        : null;
  };
  const refreshSpaceMeta = async (): Promise<void> => {
    try {
      const spaceMeta = await fetchSpaceMeta({
        requestContext: buildOpenMeldRequestContextFromProfileIdentity({
          profileIdentity: input.profileIdentity,
        }),
        baseUrl: input.baseUrl,
        space: input.space,
        password: input.password,
      });
      applySessionStorageUsage(spaceMeta);
      if (!(isClosing || wsEnded)) {
        refreshCurrentViewState();
      }
    } catch (error) {
      input.presenter.event("info", "connect.warn.meta_fetch_failed", {
        error: toErrorMessage(error),
      });
    }
  };
  const reportMembersRefreshFailure = (error: unknown): void => {
    const errorMessage = toErrorMessage(error);
    input.presenter.event("info", "connect.warn.members_fetch_failed", {
      error: errorMessage,
    });
    store.dispatch({
      type: "members.refresh.failed",
      error: errorMessage,
    });
  };
  const refreshMembersSnapshot = async (): Promise<void> => {
    try {
      await input.readModelSeed.refreshMembersSnapshot();
      applyMembersSnapshot(input.readModelSeed.getMembersSnapshot());
    } catch (error) {
      reportMembersRefreshFailure(error);
    }
  };
  const syncMembersOverlayInteraction = (): void => {
    const screenState = store.getState();
    if (screenState.overlay.kind !== "members") {
      return;
    }
    const nextActiveItemId = resolveMembersSearchableActiveItemId({
      preferredActiveItemId: screenState.overlay.interaction.activeItemId,
      query: screenState.overlay.interaction.query,
      snapshot: screenState.members.snapshot,
    });
    store.dispatch({
      type: "overlay.active-item.updated",
      activeItemId: nextActiveItemId,
    });
  };
  const updateOverlayQuery = (query: string): void => {
    store.dispatch({
      type: "overlay.query.updated",
      query,
    });
    syncMembersOverlayInteraction();
  };
  const updateOverlayActiveItem = (activeItemId: string | null): void => {
    store.dispatch({
      type: "overlay.active-item.updated",
      activeItemId,
    });
  };
  const clearMembersSnapshotRefreshTimer = (): void => {
    if (!membersSnapshotRefreshTimer) {
      return;
    }
    clearTimeout(membersSnapshotRefreshTimer);
    membersSnapshotRefreshTimer = null;
  };
  const clearSpaceMetaRefreshTimer = (): void => {
    if (!spaceMetaRefreshTimer) {
      return;
    }
    clearTimeout(spaceMetaRefreshTimer);
    spaceMetaRefreshTimer = null;
  };
  const scheduleMembersSnapshotRefresh = (): void => {
    if (activeShellKind === "legacy") {
      return;
    }
    clearMembersSnapshotRefreshTimer();
    membersSnapshotRefreshTimer = setTimeout(() => {
      membersSnapshotRefreshTimer = null;
      ignoreAsyncResult(refreshMembersSnapshot());
    }, MEMBERS_PANEL_REFRESH_DEBOUNCE_MS);
  };
  const scheduleSpaceMetaRefresh = (): void => {
    if (activeShellKind === "legacy") {
      return;
    }
    clearSpaceMetaRefreshTimer();
    spaceMetaRefreshTimer = setTimeout(() => {
      spaceMetaRefreshTimer = null;
      ignoreAsyncResult(refreshSpaceMeta());
    }, SPACE_META_REFRESH_DEBOUNCE_MS);
  };

  let resolveHistoryReady: (() => void) | null = null;
  const historyReadyPromise = new Promise<void>((resolve) => {
    resolveHistoryReady = resolve;
  });
  const finishHistoryReady = (): void => {
    if (!resolveHistoryReady) {
      return;
    }
    resolveHistoryReady();
    resolveHistoryReady = null;
  };

  const runtime = new SpaceSessionRuntime({
    wsUrl: input.wsUrl,
    wsHeaders: await buildOpenMeldProfileIdentityRequestHeadersWithAuth({
      requestUrl: input.wsUrl,
      profileIdentity: input.profileIdentity,
      spacePassword: input.password,
    }),
    helloProfile: toProtocolProfile(input.profileIdentity),
    selfProfileId: input.profileIdentity.openMeldProfileId,
    loadMembers: async () => {
      return await input.readModelSeed
        .ensureMembersSnapshotLoaded()
        .catch((error) => {
          input.presenter.event("info", "connect.warn.members_fetch_failed", {
            error: toErrorMessage(error),
          });
          return input.readModelSeed.getMembersSnapshot();
        });
    },
    replayHistory: async (onEvent) => {
      const replayState = await replayConnectInitialHistoryBootstrap({
        profileIdentity: input.profileIdentity,
        baseUrl: input.baseUrl,
        space: input.space,
        password: input.password,
        recentHistoryLimit: input.recentHistoryLimit,
        readModelSeed: input.readModelSeed,
        ownerDisplayNameByUserId: input.ownerDisplayNameByUserId,
        seenSignalIds: catchupSeenSignalIds,
        onReplayEvent: onEvent,
        onError: (error) => {
          input.presenter.event("info", "connect.warn.catchup_failed", {
            error: toErrorMessage(error),
          });
        },
      });
      return { synced: replayState.synced };
    },
    formatError: toErrorMessage,
  });

  function createInteractiveHumanShell(
    kind: InteractiveHumanShellKind
  ): InteractiveSpaceShell {
    if (kind === "legacy") {
      return new LegacyInteractiveSpaceShell({
        onLine: handleLegacyLine,
        onClose: () => {
          cleanup("stdin closed");
        },
      });
    }
    return new PiTuiInteractiveSpaceShell({
      getRecentMentionProfileIds: () => recentMentionProfileIds,
      onBufferChange: (bufferText) => {
        applyComposerBuffer(bufferText);
      },
      onClose: () => {
        cleanup("stdin closed");
      },
      onOpenOverlay: (kind) => {
        openOverlayFromShell?.(kind);
      },
      onOverlayActiveItemChange: (activeItemId) => {
        updateOverlayActiveItem(activeItemId);
      },
      onOverlayClose: () => {
        closeOverlay();
      },
      onOverlayQueryChange: (query) => {
        updateOverlayQuery(query);
      },
      onSubmit: (text) => {
        handleEditorSubmit(text);
      },
    });
  }
  shell = createInteractiveHumanShell(preferredShellKind);
  syncShellRenderSubscription();

  const pauseLiveCursorPersistence = (): void => {
    if (!allowLiveCursorPersistence) {
      return;
    }
    allowLiveCursorPersistence = false;
    input.presenter.event("info", "connect.warn.cursor_sync_paused");
  };
  const pruneExpiredReplyingStatuses = (): void => {
    if (activityRowsById.size === 0) {
      return;
    }
    pruneExpiredDispatchRows(activityRowsById, Date.now());
  };
  const resolveReplyingStatusTexts = (): string[] => {
    pruneExpiredReplyingStatuses();
    return resolveDispatchRowStatusTexts({
      rowsById: activityRowsById,
      terminalColumns: resolveReplyingStatusColumns(),
    });
  };
  const syncOverlayLine = (): void => {
    const replyingStatuses = resolveReplyingStatusTexts();
    if (replyingStatuses.length === 0) {
      store.dispatch({
        type: "status.overlay.updated",
        line: "",
      });
      return;
    }
    const decoratedReplyingStatus = replyingStatuses
      .map((statusText) => {
        return `* ${REPLYING_STATUS_SYSTEM_LABEL} · ${REPLYING_STATUS_AGENT_LABEL} ${statusText}`;
      })
      .join("\n");
    store.dispatch({
      type: "status.overlay.updated",
      line: decoratedReplyingStatus,
    });
  };
  const syncComposerActivityPresentation = (): void => {
    syncOverlayLine();
    if (piTuiSessionMount) {
      piTuiSessionMount.refreshViewState();
    }
  };
  const scheduleReplyingStatusSweep = (): void => {
    if (replyingStatusSweepTimer) {
      clearTimeout(replyingStatusSweepTimer);
      replyingStatusSweepTimer = null;
    }
    if (activityRowsById.size === 0) {
      return;
    }
    const nearestExpiryMs = resolveNearestDispatchRowExpiryMs(activityRowsById);
    if (nearestExpiryMs === null) {
      return;
    }
    const delayMs = Math.max(250, nearestExpiryMs - Date.now());
    replyingStatusSweepTimer = setTimeout(() => {
      pruneExpiredReplyingStatuses();
      syncComposerActivityPresentation();
      scheduleReplyingStatusSweep();
    }, delayMs);
  };
  const handleReplyingHintStatusEvent = (event: SignalEnvelope): void => {
    const statusChanged =
      applyDispatchActivityEventToStatusMap({
        rowsById: activityRowsById,
        event,
        nowMs: Date.now(),
      }) ||
      clearDispatchActivitiesForSignal({
        rowsById: activityRowsById,
        event,
      });
    if (!statusChanged) {
      return;
    }
    scheduleReplyingStatusSweep();
    syncComposerActivityPresentation();
  };
  const flushLastSeen = async (): Promise<void> => {
    if (!pendingLastSeen) {
      return;
    }
    if (!allowLiveCursorPersistence) {
      pendingLastSeen = null;
      return;
    }
    const ts = pendingLastSeen;
    pendingLastSeen = null;
    await updateSpaceLastSeenTs({
      openMeldProfileId: input.openMeldProfileId,
      space: input.space,
      lastSeenTs: ts,
    });
    await updateSpaceCursor({
      requestContext: buildOpenMeldRequestContextFromProfileIdentity({
        profileIdentity: input.profileIdentity,
      }),
      baseUrl: input.baseUrl,
      space: input.space,
      password: input.password,
      lastSeenTs: ts,
    }).catch((error) => {
      shell.prepareExternalWrite();
      input.presenter.event("info", "connect.warn.persist_last_seen", {
        error: toErrorMessage(error),
      });
    });
  };
  const scheduleLastSeen = (ts: number): void => {
    pendingLastSeen = Math.max(pendingLastSeen ?? 0, ts);
    if (pendingTimer) {
      return;
    }
    pendingTimer = setTimeout(async () => {
      pendingTimer = null;
      try {
        await flushLastSeen();
      } catch (error) {
        shell.prepareExternalWrite();
        input.presenter.event("info", "connect.warn.persist_last_seen", {
          error: toErrorMessage(error),
        });
      }
    }, 1000);
  };
  const cancelLastSeenTimer = (): void => {
    if (!pendingTimer) {
      return;
    }
    clearTimeout(pendingTimer);
    pendingTimer = null;
  };
  const scheduleEventLastSeen = (event: SignalEnvelope | HelloAck): void => {
    if (!isSignalEnvelope(event)) {
      return;
    }
    if (!allowLiveCursorPersistence) {
      return;
    }
    if (event.ts <= persistedLastSeenFloorTs) {
      return;
    }
    persistedLastSeenFloorTs = event.ts;
    scheduleLastSeen(event.ts);
  };
  const reportOutboundSendFailure = (failure: {
    error: string;
    hint?: string;
  }): void => {
    syncComposerActivityPresentation();
    shell.prepareExternalWrite();
    input.presenter.event("error", "connect.error", failure);
    process.exitCode = 1;
  };
  const prepareInteractiveOutboundText = async (text: string) => {
    const preparedSubmission = await prepareCliSpaceComposerSubmission({
      missingSnapshotMessage:
        "Cannot validate mention labels right now because current space members could not be loaded.",
      onMembersSnapshotLoaded: (membersSnapshot) => {
        applyMembersSnapshot(membersSnapshot);
      },
      onSnapshotLoadFailure: (error) => {
        reportMembersRefreshFailure(error);
        rethrowCanonicalMentionSnapshotLoadFailure(error);
      },
      loadMembersSnapshot: async () => {
        const currentMembersSnapshot = store.getState().members.snapshot;
        if (currentMembersSnapshot) {
          return currentMembersSnapshot;
        }
        return await input.readModelSeed.ensureMembersSnapshotLoaded();
      },
      text,
    });

    return {
      canonicalMentionsInTextOrder:
        preparedSubmission.preparedSubmission.canonicalMentionsInTextOrder,
      messageEnvelope: preparedSubmission.outboundMessageEnvelope ?? null,
      resolvedStructuredTargets:
        preparedSubmission.preparedSubmission.resolvedStructuredTargets,
      text: preparedSubmission.outboundText,
    };
  };
  const reportPendingOutboundUnconfirmed = (pending: {
    context: "closed" | "error";
    reason?: string;
  }): void => {
    if (!clearUnconfirmedPendingOutboundRows(activityRowsById)) {
      return;
    }
    syncComposerActivityPresentation();
    const reasonSuffix = pending.reason ? ` (${pending.reason})` : "";
    shell.prepareExternalWrite();
    input.presenter.event("error", "connect.error", {
      error: `last message may not have been confirmed before the connection ${pending.context === "closed" ? "closed" : "failed"}${reasonSuffix}`,
      hint: "rejoin the space and send it again if you still do not see it",
    });
    process.exitCode = 1;
  };
  const appendTranscriptEvent = (
    event: SignalEnvelope | HelloAck,
    source: "history" | "live"
  ): void => {
    scheduleEventLastSeen(event);
    if (isSignalEnvelope(event)) {
      liveFloorTs = Math.max(liveFloorTs, event.ts);
      if (source === "live") {
        rememberSeenSignalId(catchupSeenSignalIds, event.id);
        input.readModelSeed.rememberSignal(event);
      }
      handleReplyingHintStatusEvent(event);
    }

    emitHumanConnectTranscriptEvent({
      event,
      ownerDisplayNameByUserId: input.ownerDisplayNameByUserId,
      readModelSeed: input.readModelSeed,
      sessionProfileIdentity: input.profileIdentity,
      onTranscriptItem: (transcriptItem) => {
        store.dispatch({
          type: "transcript.item.appended",
          item: transcriptItem,
        });
      },
    });
  };
  const handleIncomingEvent = (
    event: SignalEnvelope | HelloAck,
    source: "history" | "live"
  ): void => {
    handleInteractiveIncomingEvent({
      appendTranscriptEvent,
      event,
      liveFloorTs,
      onIgnoredOlderThanLiveFloor: (ignoredEvent) => {
        processIgnoredOlderThanLiveFloorSignal({
          event: ignoredEvent,
          seenSignalIds: catchupSeenSignalIds,
          onDispatchActivityEvent: handleReplyingHintStatusEvent,
        });
      },
      scheduleMembersSnapshotRefresh,
      scheduleSpaceMetaRefresh,
      seenSignalIds: catchupSeenSignalIds,
      selfProfileId: input.profileIdentity.openMeldProfileId,
      source,
    });
  };
  const applyComposerBuffer = (bufferText: string): void => {
    store.dispatch({
      type: "composer.buffer.updated",
      bufferText,
    });
  };
  const closeOverlay = (): void => {
    clearMembersSnapshotRefreshTimer();
    store.dispatch({
      type: "overlay.closed",
    });
  };
  const showOverlay = async (kind: SpacePanelKind): Promise<void> => {
    const openedAtMs = Date.now();
    store.dispatch({
      type: "overlay.interaction.reset",
    });
    if (activeShellKind === "legacy") {
      await showLegacyOverlayFallback(kind, openedAtMs);
      return;
    }
    store.dispatch({
      type: "overlay.opened",
      kind,
      openedAtMs,
    });
    if (kind === "members") {
      syncMembersOverlayInteraction();
    }
    if (kind === "members") {
      ignoreAsyncResult(refreshMembersSnapshot());
    }
  };
  openOverlayFromShell = (kind) => {
    ignoreAsyncResult(showOverlay(kind));
  };
  const showLegacyOverlayFallback = async (
    kind: SpacePanelKind,
    openedAtMs: number
  ): Promise<void> => {
    if (kind === "members") {
      await refreshMembersSnapshot();
    }
    store.dispatch({
      type: "overlay.opened",
      kind,
      openedAtMs,
    });
    shell.prepareExternalWrite();
    const panel = buildCurrentViewState().overlay.panel;
    if (!(panel && panel.kind === kind)) {
      store.dispatch({
        type: "overlay.closed",
      });
      refreshCurrentViewState();
      return;
    }
    for (const line of buildPanelDisplayLines({
      contentWidth: resolveLegacyPanelContentWidth(process.stdout.columns),
      includeControls: panel.mode !== "searchable_list",
      panel,
    })) {
      process.stdout.write(`${line}\n`);
    }
    process.stdout.write("\n");
    store.dispatch({
      type: "overlay.closed",
    });
    refreshCurrentViewState();
  };
  const handleHistoryLoadedEvent = (
    event: Extract<SpaceRuntimeEvent, { type: "history.loaded" }>
  ): void => {
    if (!event.synced) {
      if (event.reason === "live_buffer_overflow") {
        input.presenter.event(
          "info",
          "connect.warn.catchup_live_buffer_overflow",
          {
            limit: CATCHUP_LIVE_BUFFER_MAX,
          }
        );
      }
      pauseLiveCursorPersistence();
    }
    finishHistoryReady();
  };
  const handleMembersUpdatedEvent = (
    event: Extract<SpaceRuntimeEvent, { type: "members.updated" }>
  ): void => {
    const membersSnapshot = event.snapshot ?? null;
    applyMembersSnapshot(membersSnapshot);
  };
  const handleConnectionClosedEvent = (
    event: Extract<SpaceRuntimeEvent, { type: "connection.closed" }>
  ): void => {
    wsEnded = true;
    finishHistoryReady();
    store.dispatch({
      type: "connection.closed",
      reason: event.reason,
      ...(typeof event.code === "number" ? { code: event.code } : {}),
      source: event.source,
    });
    if (event.source === "error") {
      reportPendingOutboundUnconfirmed({
        context: "error",
        reason: event.reason,
      });
      if (activityRowsById.size > 0) {
        activityRowsById.clear();
        syncComposerActivityPresentation();
      }
      shell.prepareExternalWrite();
      input.presenter.event(
        "error",
        "connect.error",
        resolveWebSocketError(event.error ?? event.reason, "human")
      );
      process.exitCode = 1;
      return;
    }

    const closeDetails = resolveWebSocketCloseDetails({
      code: event.code ?? 1006,
      reason: event.reason,
    });
    reportPendingOutboundUnconfirmed({
      context: "closed",
      reason: closeDetails.reason,
    });
    if (activityRowsById.size > 0) {
      activityRowsById.clear();
      syncComposerActivityPresentation();
    }
    if (
      shouldRenderHumanNormalLeaveCard({
        resolvedView: "human",
        closeCode: closeDetails.code,
        localCloseReason,
        exitCode: process.exitCode,
      })
    ) {
      shell.prepareExternalWrite();
      emitHumanNormalLeaveCard({
        spaceId: input.sessionMeta.spaceId,
        writeLine: (codeLabel, text) => {
          input.presenter.line({
            code: codeLabel,
            text,
          });
        },
      });
      process.exitCode = process.exitCode ?? 0;
      return;
    }
    if (isClosing && closeDetails.code === 1006) {
      shell.prepareExternalWrite();
      input.presenter.event("info", "connect.closed");
      process.exitCode = process.exitCode ?? 0;
      return;
    }
    shell.prepareExternalWrite();
    input.presenter.event(
      "info",
      "connect.closed_with_code_reason",
      closeDetails
    );
    process.exitCode = process.exitCode ?? 0;
  };
  const removeRuntimeListener = runtime.subscribe((event) => {
    handleInteractiveRuntimeEvent({
      event,
      handleConnectionClosedEvent,
      handleHistoryLoadedEvent,
      handleIncomingEvent,
      handleMembersUpdatedEvent,
      rowsById: activityRowsById,
      enableLocalEcho: input.enableLocalEcho,
      selfProfileId: input.profileIdentity.openMeldProfileId,
      reportOutboundSendFailure,
      store,
      syncActivityPresentation: syncComposerActivityPresentation,
    });
  });
  function cleanup(why: string): void {
    if (isClosing) {
      return;
    }
    isClosing = true;
    localCloseReason = why;
    store.dispatch({
      type: "connection.closing",
      reason: why,
    });
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    shell.stop();
    runtime.stop(why);
  }
  function onSigint(): void {
    cleanup("SIGINT");
  }
  function onSigterm(): void {
    cleanup("SIGTERM");
  }
  function handleComposerIntent(payload: {
    resolution: ComposerIntentResolution;
    submittedText: string;
  }): void {
    handleInteractiveComposerIntent({
      resolution: payload.resolution,
      submittedText: payload.submittedText,
      applyComposerBuffer,
      cleanup,
      clearSubmittedInputLine: (submittedText) => {
        shell.clearSubmittedInputLine(submittedText);
      },
      closeOverlay,
      prepareExternalWrite: () => {
        shell.prepareExternalWrite();
      },
      handleSendTextError: (error) => {
        reportOutboundSendFailure({
          error: toErrorMessage(error),
        });
      },
      presenter: input.presenter,
      sendText: async (sendInput) => {
        let submitResult: InteractiveTextSubmitResult;
        try {
          submitResult = await performInteractiveTextSubmit({
            nextBufferText: sendInput.nextBufferText,
            submittedText: sendInput.submittedText,
            text: sendInput.text,
            prepareOutboundText: prepareInteractiveOutboundText,
            queueText: (outboundText) => runtime.sendText(outboundText),
            applyComposerBuffer,
            clearSubmittedInputLine: (submittedText) => {
              shell.clearSubmittedInputLine(submittedText);
            },
          });
        } catch (error) {
          shell.prepareExternalWrite();
          input.presenter.event("info", "connect.reject", {
            reason: toErrorMessage(error),
          });
          applyComposerBuffer(sendInput.submittedText);
          return;
        }
        if (submitResult.status !== "queued") {
          return;
        }

        if (
          upsertPendingHumanSendRow({
            enableLocalEcho: input.enableLocalEcho,
            rowsById: activityRowsById,
            text: submitResult.text,
            clientMessageId: submitResult.clientMessageId,
            terminalColumns: resolveReplyingStatusColumns(),
            nowMs: Date.now(),
            maxPendingRows: PENDING_OUTBOUND_CONFIRMATION_MAX,
          })
        ) {
          syncComposerActivityPresentation();
        }

        const membersSnapshot = store.getState().members.snapshot;
        const nextRecentMentionProfileIds =
          resolveNextRecentMentionProfileIdsForQueuedText({
            currentRecentProfileIds: recentMentionProfileIds,
            submittedText: submitResult.text,
            structuredMentionProfileIdsInTextOrder:
              submitResult.resolvedStructuredTargets.profileIdsInTextOrder,
            canonicalMentionsInTextOrder:
              submitResult.canonicalMentionsInTextOrder,
            mentionProfileIndex: input.readModelSeed.getMentionHighlightIndex(),
            allowedProfileIds: membersSnapshot
              ? listSpaceMemberProfileIds(membersSnapshot)
              : null,
          });
        if (!nextRecentMentionProfileIds) {
          return;
        }

        recentMentionProfileIds = nextRecentMentionProfileIds;
        ignoreAsyncResult(
          writeSpaceRecentMentionProfileIds({
            openMeldProfileId: input.openMeldProfileId,
            space: input.space,
            recentMentionProfileIds: nextRecentMentionProfileIds,
            allowedProfileIds: membersSnapshot
              ? listSpaceMemberProfileIds(membersSnapshot)
              : null,
          }).catch((error) => {
            input.presenter.event(
              "info",
              "connect.warn.persist_recent_mentions",
              {
                error: toErrorMessage(error),
              }
            );
          })
        );
      },
      showOverlay,
    });
  }
  function handleLegacyLine(line: string): void {
    const resolution = composerController.consumeLegacyLine({
      line,
      bufferText: store.getState().composer.bufferText,
    });
    handleComposerIntent({
      resolution,
      submittedText: line,
    });
  }
  function handleEditorSubmit(text: string): void {
    const resolution = composerController.consumeEditorSubmit({
      text,
      nextBufferText: "",
    });
    handleComposerIntent({
      resolution,
      submittedText: text,
    });
  }
  const emitInteractiveSessionMeta = (): void => {
    emitSessionMeta({
      accessMode: input.sessionMeta.accessMode,
      output: "text",
      spaceId: input.sessionMeta.spaceId,
      spaceName: input.sessionMeta.spaceName,
      spaceCreatedAt: input.sessionMeta.spaceCreatedAt,
      spaceCreatorName: input.sessionMeta.spaceCreatorName,
      spaceCreatorId: input.sessionMeta.spaceCreatorId,
      passwordProtected: input.sessionMeta.passwordProtected,
      profileId: input.profileIdentity.openMeldProfileId,
      profileName: input.profileIdentity.profileName,
      profileKind: input.profileIdentity.kind,
      ownerUserId: input.profileIdentity.ownerUserId,
      ownerName: input.profileIdentity.ownerName,
      agentControllerRef: input.profileIdentity.agentControllerRef,
      agentControllerConversationId:
        input.profileIdentity.agentControllerConversationId,
      modelSelection: resolveSessionProfileModelSelection({
        profileId: input.profileIdentity.openMeldProfileId,
        spaceMembersSnapshot: store.getState().members.snapshot ?? undefined,
      }),
      spaceMembersSnapshot: store.getState().members.snapshot ?? undefined,
      gatewayUrl: input.baseUrl,
      stdio: true,
      visibility: input.sessionMeta.visibility,
    });
    interactiveIntroEmitted = true;
  };
  const shouldEmitInteractiveSessionMeta = (
    shellKind: InteractiveHumanShellKind
  ): boolean => {
    return shellKind === "legacy";
  };
  let watchReadyEmitted = false;
  const emitInteractiveWatchReady = (): void => {
    if (watchReadyEmitted) {
      return;
    }
    process.stdout.write(
      `${pc.dim(formatMessage("human", "connect.watch_ready"))}\n`
    );
    watchReadyEmitted = true;
  };

  try {
    const runtimeProcess = await runtime.start();

    if (shouldEmitInteractiveSessionMeta(preferredShellKind)) {
      emitInteractiveSessionMeta();
    }

    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    await historyReadyPromise;
    if (wsEnded) {
      await runtimeProcess.closed;
      return;
    }

    if (input.connectionMode === "join") {
      process.stdout.write("\n");
      process.stdout.write(
        `${pc.dim(formatMessage("human", "connect.chat_mention_hint"))}\n`
      );
      process.stdout.write(
        `${pc.dim(formatMessage("human", "connect.chat_ready"))}\n`
      );
      process.stdout.write(
        `${pc.dim(formatMessage("human", "connect.chat_exit_hint"))}\n`
      );
      process.stdout.write(
        `\n${pc.dim(formatMessage("human", "connect.chat_prompt_question"))}\n`
      );
    } else if (preferredShellKind === "legacy") {
      process.stdout.write("\n");
      emitInteractiveWatchReady();
    }

    try {
      shell.start();
      if (!(shell instanceof PiTuiInteractiveSpaceShell)) {
        refreshCurrentViewState();
      }
    } catch (error) {
      if (activeShellKind !== "pi-tui") {
        throw error;
      }
      shell.stop();
      removeStoreListener();
      piTuiSessionMount = null;
      activeShellKind = "legacy";
      shell = createInteractiveHumanShell("legacy");
      syncShellRenderSubscription();
      if (
        shouldEmitInteractiveSessionMeta(activeShellKind) &&
        !interactiveIntroEmitted
      ) {
        emitInteractiveSessionMeta();
      }
      if (input.connectionMode === "watch") {
        emitInteractiveWatchReady();
      }
      shell.prepareExternalWrite();
      input.presenter.line({
        code: "connect.warn.interactive_shell_fallback",
        text: pc.dim(
          `pi-tui composer fallback to legacy shell: ${toErrorMessage(error)}`
        ),
      });
      shell.start();
      refreshCurrentViewState();
    }

    await runtimeProcess.closed;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    if (replyingStatusSweepTimer) {
      clearTimeout(replyingStatusSweepTimer);
      replyingStatusSweepTimer = null;
    }
    clearMembersSnapshotRefreshTimer();
    clearSpaceMetaRefreshTimer();
    cancelLastSeenTimer();
    await flushLastSeen();
    shell.stop();
    removeRuntimeListener();
    removeStoreListener();
  }
}

function assertUnreachableComposerIntent(value: never): never {
  throw new Error(`Unhandled composer intent: ${JSON.stringify(value)}`);
}

function assertUnreachableRuntimeEvent(value: never): never {
  throw new Error(`Unhandled runtime event: ${JSON.stringify(value)}`);
}

function resolveLegacyPanelContentWidth(
  terminalWidth: number | undefined
): number {
  const safeTerminalWidth = Math.max(40, terminalWidth ?? 100);
  const modalWidth = Math.max(1, Math.floor(safeTerminalWidth * 0.78));
  return Math.max(1, modalWidth - 4);
}

const UNKNOWN_ERROR_MESSAGE = "unknown error";

type WebSocketCloseDetails = {
  code: number;
  codeLabel: string;
  reason: string;
  hint?: string;
};

const WEBSOCKET_CLOSE_CODE_LABELS: Record<number, string> = {
  1000: "normal_closure",
  1001: "going_away",
  1002: "protocol_error",
  1003: "unsupported_data",
  1005: "no_status_received",
  1006: "abnormal_closure",
  1007: "invalid_frame_payload_data",
  1008: "policy_violation",
  1009: "message_too_big",
  1010: "mandatory_extension",
  1011: "internal_error",
  1012: "service_restart",
  1013: "try_again_later",
  1014: "bad_gateway",
  1015: "tls_handshake",
};

type WebSocketErrorDetails = {
  error: string;
  category?: string;
  hint?: string;
};

function toErrorMessage(err: unknown): string {
  if (typeof err === "string") {
    return normalizeErrorText(err) ?? UNKNOWN_ERROR_MESSAGE;
  }

  if (err instanceof AggregateError) {
    const aggregateMessage = toAggregateErrorMessage(err);
    if (aggregateMessage) {
      return aggregateMessage;
    }
  }

  if (err instanceof Error) {
    return toRegularErrorMessage(err) ?? UNKNOWN_ERROR_MESSAGE;
  }

  const codeMessage = toErrorCodeMessage(err);
  if (codeMessage) {
    return codeMessage;
  }

  return normalizeErrorText(String(err ?? "")) ?? UNKNOWN_ERROR_MESSAGE;
}

function resolveWebSocketCloseDetails(input: {
  code: number;
  reason: string;
}): WebSocketCloseDetails {
  const codeLabel = WEBSOCKET_CLOSE_CODE_LABELS[input.code] ?? "unknown_code";
  const reason =
    normalizeErrorText(input.reason) ?? resolveDefaultCloseReason(input.code);
  const hint = resolveCloseHint(input.code);

  return {
    code: input.code,
    codeLabel,
    reason,
    ...(hint ? { hint } : {}),
  };
}

function resolveDefaultCloseReason(code: number): string {
  switch (code) {
    case 1000:
      return "normal closure";
    case 1001:
      return "endpoint is going away";
    case 1002:
      return "protocol error";
    case 1003:
      return "unsupported data";
    case 1005:
      return "closed without a full close handshake";
    case 1006:
      return "connection dropped unexpectedly";
    case 1007:
      return "received invalid data";
    case 1008:
      return "policy violation";
    case 1009:
      return "message too big";
    case 1010:
      return "required connection feature missing";
    case 1011:
      return "server had an internal error";
    case 1012:
      return "service restart";
    case 1013:
      return "service is busy, try again in a moment";
    case 1014:
      return "bad gateway";
    case 1015:
      return "TLS handshake failure";
    default:
      return "no close reason provided";
  }
}

function resolveCloseHint(code: number): string | undefined {
  switch (code) {
    case 1006:
      return "this is usually a network issue or a temporary server restart";
    case 1008:
      return "the server rejected the request; check your login, profile, and space access";
    case 1011:
      return "the server hit an internal error; try again";
    case 1012:
      return "the service is restarting; wait a moment and try again";
    case 1013:
      return "the service is busy right now; wait a moment and try again";
    default:
      return undefined;
  }
}

function buildHumanNormalLeaveCardLines(input: { spaceId: string }): string[] {
  const horizontalPadding = 0;
  const contentWidth = resolveLeaveCardContentWidth(horizontalPadding);
  const normalizedSpaceId = input.spaceId.trim();
  const rejoinCommand =
    normalizedSpaceId.length > 0
      ? formatOpenMeldCliCommand(`openmeld space join ${normalizedSpaceId}`)
      : formatOpenMeldCliCommand("openmeld space join <space-id>");

  const rows = [
    {
      plainText: "👋 Space Left",
      displayText: "👋 Space Left",
    },
    ...createLeaveCardWrappedRows({
      text: "You have left the space. (closed code=1000)",
      contentWidth,
    }),
    ...createLeaveCardWrappedRows({
      text: "If you are an agent, you might still be mentioned and spawned even if you have left the space.",
      contentWidth,
    }),
    {
      plainText: "",
      displayText: "",
    },
    ...createLeaveCardWrappedRows({
      text: "To re-join this space, run:",
      contentWidth,
    }),
    {
      plainText: rejoinCommand,
      displayText: pc.cyan(rejoinCommand),
    },
  ];
  const renderedRows = rows.map((row) => row.displayText);
  return Array.from(
    { length: LEAVE_CARD_LEADING_BLANK_LINES },
    () => ""
  ).concat(renderedRows);
}

function emitHumanNormalLeaveCard(input: {
  spaceId: string;
  writeLine: (code: string, text: string) => void;
}): void {
  const leaveCardLines = buildHumanNormalLeaveCardLines({
    spaceId: input.spaceId,
  });
  for (const [lineIndex, lineText] of leaveCardLines.entries()) {
    input.writeLine(`connect.closed_normal_leave.${lineIndex}`, lineText);
  }
}

function shouldRenderHumanNormalLeaveCard(input: {
  resolvedView: ResolvedCliView;
  closeCode: number;
  localCloseReason: string | null;
  exitCode: string | number | null | undefined;
}): boolean {
  if (input.resolvedView !== "human") {
    return false;
  }
  if (input.exitCode === 1) {
    return false;
  }
  if (input.localCloseReason !== null) {
    return true;
  }
  return input.closeCode === 1000;
}

function resolveLeaveCardContentWidth(horizontalPadding: number): number {
  const terminalColumns =
    process.stdout.isTTY === true && typeof process.stdout.columns === "number"
      ? process.stdout.columns
      : null;
  if (terminalColumns === null || terminalColumns <= 0) {
    return LEAVE_CARD_FALLBACK_CONTENT_WIDTH;
  }
  const availableWidth = Math.max(
    LEAVE_CARD_MIN_CONTENT_WIDTH,
    terminalColumns - (horizontalPadding * 2 + 2)
  );
  return Math.min(LEAVE_CARD_MAX_CONTENT_WIDTH, availableWidth);
}

function createLeaveCardWrappedRows(input: {
  text: string;
  contentWidth: number;
  colorize?: (text: string) => string;
}): Array<{ plainText: string; displayText: string }> {
  const wrappedLines = wrapTextForCard({
    text: input.text,
    width: input.contentWidth,
  });
  return wrappedLines.map((line) => ({
    plainText: line,
    displayText: input.colorize ? input.colorize(line) : line,
  }));
}

function wrapTextForCard(input: { text: string; width: number }): string[] {
  const normalized = input.text.replaceAll(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return [""];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (word.length > input.width) {
      if (currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = "";
      }
      for (let cursor = 0; cursor < word.length; cursor += input.width) {
        lines.push(word.slice(cursor, cursor + input.width));
      }
      continue;
    }

    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length <= input.width) {
      currentLine = nextLine;
      continue;
    }
    if (currentLine.length > 0) {
      lines.push(currentLine);
    }
    currentLine = word;
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [""];
}

function resolveWebSocketError(
  error: unknown,
  resolvedView: "human" | "agent"
): WebSocketErrorDetails {
  const message = toErrorMessage(error);
  const hint = resolveWebSocketErrorHint(message, resolvedView);

  return {
    error: message,
    ...(hint ? { category: hint.category, hint: hint.message } : {}),
  };
}

function resolveWebSocketErrorHint(
  message: string,
  resolvedView: "human" | "agent"
): { category: string; message: string } | null {
  const normalized = message.toLowerCase();
  const handshakeStatus = parseUnexpectedWebSocketResponseStatus(normalized);
  if (handshakeStatus !== null) {
    return resolveWebSocketHandshakeErrorHint(handshakeStatus, resolvedView);
  }

  if (normalized.includes("econnrefused")) {
    return {
      category: "connection_refused",
      message:
        "can't reach the gateway; make sure OpenMeld is running and the gateway URL is correct",
    };
  }

  if (normalized.includes("enotfound") || normalized.includes("eai_again")) {
    return {
      category: "dns_resolution_failed",
      message:
        "can't find the gateway host; check the URL and your DNS or network",
    };
  }

  if (normalized.includes("etimedout") || normalized.includes("timeout")) {
    return {
      category: "network_timeout",
      message:
        "opening the connection timed out; check your network or proxy and try again",
    };
  }

  if (
    normalized.includes("econnreset") ||
    normalized.includes("socket hang up")
  ) {
    return {
      category: "connection_reset",
      message:
        "the connection was reset while opening; this is usually a network issue or a server restart",
    };
  }

  if (
    normalized.includes("self signed certificate") ||
    normalized.includes("unable to verify the first certificate")
  ) {
    return {
      category: "tls_verification_failed",
      message:
        "couldn't verify the server certificate; use a trusted certificate or trusted endpoint",
    };
  }

  return null;
}

function resolveWebSocketHandshakeErrorHint(
  handshakeStatus: number,
  resolvedView: "human" | "agent"
): { category: string; message: string } | null {
  if (handshakeStatus === 401) {
    const guidance = resolveAuthenticationGuidance({
      reason: "required",
      action: "joining a space",
    });
    return {
      category: "auth_required",
      message:
        resolvedView === "agent"
          ? guidance.agentErrorMessage
          : guidance.errorNextStep,
    };
  }
  if (handshakeStatus === 403) {
    return {
      category: "access_denied",
      message: "this profile may not have access to this space",
    };
  }
  if (handshakeStatus === 404) {
    return {
      category: "ws_route_not_found",
      message:
        "couldn't find the space stream endpoint; check the gateway URL and space ID",
    };
  }
  if (handshakeStatus >= 500) {
    return {
      category: "gateway_upstream_failure",
      message:
        "the server returned an error while opening the connection; try again",
    };
  }
  return null;
}

function parseUnexpectedWebSocketResponseStatus(
  message: string
): number | null {
  const match = WS_UNEXPECTED_SERVER_RESPONSE_REGEX.exec(message);
  if (!match) {
    return null;
  }
  const status = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(status) ? status : null;
}

function toAggregateErrorMessage(error: AggregateError): string | null {
  const nestedMessages = error.errors
    .map((item) => toErrorMessage(item))
    .filter((message) => message !== UNKNOWN_ERROR_MESSAGE);
  if (nestedMessages.length === 0) {
    return null;
  }
  return [...new Set(nestedMessages)].join("; ");
}

function toRegularErrorMessage(error: Error): string | null {
  const message = normalizeErrorText(error.message);
  if (message) {
    return message;
  }

  const causeMessage = toErrorMessage(error.cause);
  if (causeMessage !== UNKNOWN_ERROR_MESSAGE) {
    return causeMessage;
  }

  const name = normalizeErrorText(error.name);
  if (name && name !== "Error") {
    return name;
  }

  return null;
}

function toErrorCodeMessage(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }
  return normalizeErrorText(String((error as { code?: unknown }).code ?? ""));
}

function normalizeErrorText(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseJsonResponse<T>(raw: string, endpointName: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Invalid JSON response from ${endpointName} endpoint`);
  }
}

function isSpaceNotFoundHttpError(err: unknown): boolean {
  const parsed = parseHttpErrorMessage(err);
  if (!(parsed && parsed.status === 404)) {
    return false;
  }

  const bodyText = parsed.body.toLowerCase();
  if (bodyText.includes("space not found")) {
    return true;
  }

  const body = safeJsonParse(parsed.body);
  if (!body || typeof body !== "object") {
    return false;
  }

  const payload = body as {
    code?: unknown;
    message?: unknown;
    error?: { code?: unknown; message?: unknown } | null;
  };
  const code = readHttpErrorField(payload, "code");
  const message = readHttpErrorField(payload, "message");

  return (
    code === "space.not_found" ||
    (code === "upstream_error" && message.toLowerCase() === "space not found")
  );
}

function parseHttpErrorMessage(
  error: unknown
): { status: number; body: string } | null {
  const parsed = parseHttpFailure(error);
  if (!parsed) {
    return null;
  }
  return {
    status: parsed.status,
    body: parsed.body,
  };
}

function readHttpErrorField(
  payload: { code?: unknown; message?: unknown; error?: unknown },
  field: "code" | "message"
): string {
  if (typeof payload[field] === "string") {
    return payload[field];
  }
  if (
    payload.error &&
    typeof payload.error === "object" &&
    typeof (payload.error as Record<string, unknown>)[field] === "string"
  ) {
    return String((payload.error as Record<string, unknown>)[field]);
  }
  return "";
}

type ProfileSpaceHistorySyncInput = {
  openMeldProfileId: string;
  requestContext: OpenMeldRequestContext;
  baseUrl: string;
  space: string;
  gatewayHost: string;
};

async function syncProfileSpaceHistoryActive(
  input: ProfileSpaceHistorySyncInput & {
    spaceMeta: SpaceMeta;
    lastSeenTs: number | null;
  }
): Promise<void> {
  const creatorProfileId = resolveCreatorProfileId(input.spaceMeta.creator);
  const creatorKind = resolveCreatorKind(input.spaceMeta.creator?.kind);
  const spaceName = normalizeOptionalTrimmedText(input.spaceMeta.name);
  const spaceCreatedAt = normalizeOptionalIsoDateTime(
    input.spaceMeta.createdAt
  );
  const spaceUpdatedAt = normalizeOptionalIsoDateTime(
    input.spaceMeta.updatedAt
  );

  await upsertProfileSpaceHistory({
    baseUrl: input.baseUrl,
    requestContext: input.requestContext,
    openMeldProfileId: input.openMeldProfileId,
    spaceId: input.space,
    body: {
      gatewayHost: input.gatewayHost,
      ...(spaceName === undefined ? {} : { spaceName }),
      ...(creatorProfileId === undefined ? {} : { creatorProfileId }),
      ...(creatorKind === undefined ? {} : { creatorKind }),
      ...(spaceCreatedAt === undefined ? {} : { spaceCreatedAt }),
      ...(spaceUpdatedAt === undefined ? {} : { spaceUpdatedAt }),
      ...(typeof input.lastSeenTs === "number"
        ? { lastSeenTs: input.lastSeenTs }
        : {}),
      lastJoinedAt: new Date().toISOString(),
      status: "active",
    },
  });
}

async function syncProfileSpaceHistoryStatusForJoinFailure(
  input: ProfileSpaceHistorySyncInput & {
    error: unknown;
  }
): Promise<void> {
  const statusUpdate = resolveSpaceHistoryStatusFromJoinError(input.error);
  if (!statusUpdate) {
    return;
  }

  await updateProfileSpaceHistoryStatus({
    baseUrl: input.baseUrl,
    requestContext: input.requestContext,
    openMeldProfileId: input.openMeldProfileId,
    spaceId: input.space,
    body: {
      gatewayHost: input.gatewayHost,
      status: statusUpdate.status,
      ...(statusUpdate.reason ? { reason: statusUpdate.reason } : {}),
    },
  });
}

function resolveSpaceHistoryStatusFromJoinError(error: unknown): {
  status: "removed" | "inaccessible";
  reason?: string;
} | null {
  const details = parseHttpErrorDetails(error);
  if (!details) {
    return null;
  }

  if (details.status === 404 && isSpaceNotFoundHttpError(error)) {
    return {
      status: "removed",
      ...(details.reason ? { reason: details.reason } : {}),
    };
  }

  const statusCode = details.status;
  if (statusCode === 401 || statusCode === 403) {
    return {
      status: "inaccessible",
      ...(details.reason ? { reason: details.reason } : {}),
    };
  }

  const errorCode = details.code.toLowerCase();
  if (errorCode === "auth.unauthenticated" || errorCode.includes("forbidden")) {
    return {
      status: "inaccessible",
      ...(details.reason ? { reason: details.reason } : {}),
    };
  }

  return null;
}

function parseHttpErrorDetails(error: unknown): {
  status: number;
  code: string;
  reason: string | null;
} | null {
  const parsed = parseHttpFailure(error);
  if (!parsed) {
    return null;
  }

  const code = parsed.code.trim();
  const message =
    normalizeErrorText(parsed.message) ?? normalizeErrorText(parsed.body);
  const reason = buildStatusReason(parsed.status, code, message);

  return {
    status: parsed.status,
    code,
    reason,
  };
}

function buildStatusReason(
  status: number,
  code: string,
  message: string | null
): string | null {
  const summaryParts = [`http ${status}`];
  if (code) {
    summaryParts.push(code);
  }
  if (message) {
    summaryParts.push(message);
  }
  const summary = normalizeErrorText(summaryParts.join(": "));
  if (!summary) {
    return null;
  }
  if (summary.length <= 500) {
    return summary;
  }
  return summary.slice(0, 500);
}

function formatServerErrorFrameMessage(input: {
  error: string;
  requestId?: string;
}): string {
  const error = String(input.error ?? "").trim() || "unknown_error";
  const requestId =
    typeof input.requestId === "string" ? input.requestId.trim() : "";
  if (!requestId) {
    return error;
  }
  return `${error} (requestId: ${requestId})`;
}

function acquireConnectLock(input: {
  openMeldProfileId: string;
  baseUrl: string;
  space: string;
  profileId: string;
  connectionMode: "join" | "watch";
}) {
  const lockKey = resolveConnectLockKey(input);
  if (!lockKey) {
    return null;
  }
  return acquireLock({
    openMeldProfileId: input.openMeldProfileId,
    key: lockKey,
    meta: {
      mode: input.connectionMode,
      space: input.space,
      profileId: input.profileId,
    },
  }).then((lock) => ({
    lock,
    lockKey,
  }));
}

function resolveConnectLockKey(input: {
  baseUrl: string;
  space: string;
  profileId: string;
  connectionMode: "join" | "watch";
}): string | null {
  if (input.connectionMode !== "join") {
    return null;
  }
  const gatewayHost = new URL(input.baseUrl).host;
  return `${gatewayHost}__${input.space}__${input.profileId}__join`;
}

function resolveConnectionModeOrThrow(
  connectionMode: "join" | "watch" | undefined
): "join" | "watch" {
  if (connectionMode === "join" || connectionMode === "watch") {
    return connectionMode;
  }
  throw new Error("runConnect requires explicit connectionMode");
}

function buildNoStdioEventData(input: {
  connectionMode: "join" | "watch";
  profileId: string;
  spaceId: string;
  sendCommand?: string;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    connectionMode: input.connectionMode,
    profileId: input.profileId,
    spaceId: input.spaceId,
  };
  const sendCommand = String(input.sendCommand ?? "").trim();
  if (input.connectionMode === "join" && sendCommand.length > 0) {
    payload.sendCommand = sendCommand;
  }
  return payload;
}

function isSignalEnvelope(
  event: SignalEnvelope | HelloAck
): event is SignalEnvelope {
  return "id" in event && typeof event.id === "string";
}

async function applyFetchedSpaceMeta(input: {
  openMeldProfileId: string;
  baseUrl: string;
  space: string;
  profileHandle?: string;
  profileName: string;
  spaceMeta: SpaceMeta;
  output: OutputMode;
  rawStream: boolean;
  resolvedView: "human" | "agent";
}): Promise<void> {
  await upsertSpaceConfig({
    openMeldProfileId: input.openMeldProfileId,
    baseUrl: input.baseUrl,
    space: input.space,
    profileHandle: input.profileHandle,
    profileName: input.profileName,
    ...toSpaceMetaUpsertInput(input.spaceMeta),
  });

  if (!(input.rawStream && input.output === "ndjson")) {
    emitSpaceGuide(input.spaceMeta, input.output, input.resolvedView);
  }
}

type SessionMetaOutputInput = {
  accessMode?: SpaceMeta["accessMode"];
  output: OutputMode;
  spaceId: string;
  spaceName?: string;
  spaceCreatedAt?: string;
  spaceCreatorName?: string;
  spaceCreatorId?: string;
  passwordProtected?: boolean;
  profileId: string;
  profileName: string;
  profileKind?: "human" | "agent" | "system";
  ownerUserId?: string;
  ownerName?: string;
  agentControllerRef?: string;
  agentControllerConversationId?: string;
  modelSelection?: AgentProfileBindingModelSelection | null;
  spaceMembersSnapshot?: SpaceMembersSnapshot;
  gatewayUrl: string;
  stdio: boolean;
  visibility?: SpaceMeta["visibility"];
};

function emitSessionMeta(input: SessionMetaOutputInput): void {
  if (input.output === "ndjson") {
    outJsonLine(buildSessionMetaEventPayload(input));
    return;
  }

  if (input.output !== "text") {
    return;
  }

  emitSessionMetaText(input);
}

function emitSessionMetaText(input: SessionMetaOutputInput): void {
  for (const line of formatConnectIntro({
    accessMode: input.accessMode,
    spaceId: input.spaceId,
    spaceName: input.spaceName,
    spaceCreatedAt: input.spaceCreatedAt,
    spaceCreatorName: input.spaceCreatorName,
    spaceCreatorId: input.spaceCreatorId,
    passwordProtected: input.passwordProtected,
    profileId: input.profileId,
    profileName: input.profileName,
    profileKind: input.profileKind,
    ownerUserId: input.ownerUserId,
    ownerName: input.ownerName,
    agentControllerRef: input.agentControllerRef,
    agentControllerConversationId: input.agentControllerConversationId,
    modelSelection: input.modelSelection,
    spaceMembersSnapshot: input.spaceMembersSnapshot,
    gatewayUrl: input.gatewayUrl,
    stdio: input.stdio,
    visibility: input.visibility,
  })) {
    errLine(line);
  }
}

function buildSessionMetaEventPayload(
  input: SessionMetaOutputInput
): Record<string, unknown> {
  return buildAgentSessionMetaPayload({
    accessMode: input.accessMode,
    gatewayUrl: input.gatewayUrl,
    mode: input.stdio ? "interactive chat" : "watch-only stream",
    passwordProtected: input.passwordProtected,
    agentControllerConversationId: input.agentControllerConversationId,
    agentControllerRef: input.agentControllerRef,
    modelSelection: input.modelSelection,
    profileId: input.profileId,
    profileKind: input.profileKind,
    profileName: input.profileName,
    ownerName: input.ownerName,
    ownerUserId: input.ownerUserId,
    spaceCreatedAt: input.spaceCreatedAt,
    spaceCreatorId: input.spaceCreatorId,
    spaceCreatorName: input.spaceCreatorName,
    spaceId: input.spaceId,
    spaceName: input.spaceName,
    visibility: input.visibility,
  });
}

function resolveSessionProfileModelSelection(input: {
  profileId: string;
  spaceMembersSnapshot?: SpaceMembersSnapshot;
}): AgentProfileBindingModelSelection | null {
  return (
    input.spaceMembersSnapshot?.agents.find(
      (agent) => agent.profileId === input.profileId
    )?.modelSelection ?? null
  );
}

function emitSpaceMembers(snapshot: SpaceMembersSnapshot): void {
  outJsonLine({
    type: "system.space.members",
    payload: snapshot,
  });
}
function errBlock(text: string): void {
  process.stderr.write(`${text}\n`);
}

function emitSpaceGuide(
  meta: SpaceMeta,
  output: OutputMode,
  resolvedView: "human" | "agent"
): void {
  const rawGuide = String(meta.guide ?? "").trim();
  if (!rawGuide) {
    return;
  }

  if (output === "ndjson") {
    outJsonLine({
      type: "system.space.guide",
      spaceId: meta.spaceId,
      guide: rawGuide,
      ...(meta.creator ? { creator: meta.creator } : {}),
    });
    return;
  }

  const guide = sanitizeTerminalDisplayText(rawGuide, "multi-line");

  errLine(
    formatMessage(resolvedView, "connect.space_guide", {
      spaceId: meta.spaceId,
    })
  );
  errBlock(guide);
}

async function fetchSpaceCursor(input: {
  requestContext: OpenMeldRequestContext;
  baseUrl: string;
  space: string;
  password?: string;
}): Promise<SpaceCursor> {
  const endpoint = toSpaceCursorUrl(
    input.baseUrl,
    input.space,
    input.requestContext.actorContext.openMeldProfileId
  );
  const response = await fetchSpaceRequestWithTimeout({
    url: endpoint,
    operation: "space.connect_fetch_cursor",
    init: {
      method: "GET",
      headers: await buildOpenMeldRequestContextHeadersWithAuth({
        requestUrl: endpoint,
        requestContext: input.requestContext,
        spacePassword: input.password,
      }),
    },
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${raw}`);
  }

  return parseJsonResponse<SpaceCursor>(raw, "space cursor");
}

async function updateSpaceCursor(input: {
  requestContext: OpenMeldRequestContext;
  baseUrl: string;
  space: string;
  password?: string;
  lastSeenTs?: number;
  role?: string;
  mentionAlias?: string;
}): Promise<SpaceCursor> {
  const endpoint = toSpaceCursorUrl(
    input.baseUrl,
    input.space,
    input.requestContext.actorContext.openMeldProfileId
  );
  const headers = await buildOpenMeldRequestContextHeadersWithAuth({
    requestUrl: endpoint,
    requestContext: input.requestContext,
    spacePassword: input.password,
  });
  headers["content-type"] = "application/json";
  const cursorPatch = normalizeSpaceCursorPatch({
    ...(typeof input.lastSeenTs === "number"
      ? { lastSeenTs: input.lastSeenTs }
      : {}),
    ...(typeof input.role === "string" ? { role: input.role } : {}),
    ...(typeof input.mentionAlias === "string"
      ? { mentionAlias: input.mentionAlias }
      : {}),
  });
  if (!cursorPatch.ok) {
    throw new Error(cursorPatch.message);
  }

  const response = await fetchSpaceRequestWithTimeout({
    url: endpoint,
    operation: "space.connect_update_cursor",
    init: {
      method: "PATCH",
      headers,
      body: JSON.stringify(cursorPatch.value),
    },
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${raw}`);
  }

  return parseJsonResponse<SpaceCursor>(raw, "space cursor");
}

function buildChatGroupDividerLine(): string {
  if (process.stdout.isTTY !== true) {
    return "";
  }
  const columns = resolveTerminalColumns();
  const width = clampNumber(
    columns - CHAT_GROUP_DIVIDER_MARGIN * 2,
    CHAT_GROUP_DIVIDER_MIN_WIDTH,
    CHAT_GROUP_DIVIDER_MAX_WIDTH
  );
  const margin = " ".repeat(CHAT_GROUP_DIVIDER_MARGIN);
  return pc.dim(pc.gray(`${margin}${CHAT_GROUP_DIVIDER_CHAR.repeat(width)}`));
}

function resolveTerminalColumns(): number {
  const rawColumns = process.stdout.columns;
  if (!Number.isInteger(rawColumns) || rawColumns < 1) {
    return 80;
  }
  return rawColumns;
}

function clampNumber(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function shouldRefreshMembersSnapshotForEvent(
  event: SignalEnvelope | HelloAck
): boolean {
  if (!isSignalEnvelope(event)) {
    return false;
  }

  if (event.type === "presence.join" || event.type === "presence.quit") {
    return true;
  }

  if (event.type !== "signal.text") {
    return false;
  }

  const meta = resolveSignalTextMetaFromEnvelope(event);
  const purpose = String(meta?.purpose ?? "").trim();
  if (
    purpose === SPACE_MEMBER_JOIN_NOTICE_PURPOSE ||
    purpose === SPACE_MEMBER_REMOVE_NOTICE_PURPOSE
  ) {
    return true;
  }

  return false;
}

function shouldRefreshSpaceMetaForEvent(
  event: SignalEnvelope | HelloAck
): boolean {
  if (!isSignalEnvelope(event)) {
    return false;
  }

  if (event.type === "presence.join" || event.type === "presence.quit") {
    return true;
  }

  return resolveNonTransientSignalText(event) !== null;
}

function ignoreAsyncResult(promise: Promise<void>): void {
  promise.catch(() => undefined);
}

function listSpaceMemberProfileIds(snapshot: SpaceMembersSnapshot): string[] {
  return [...snapshot.agents, ...snapshot.humans].map(
    (member) => member.profileId
  );
}
