import {
  cancel,
  confirm,
  isCancel,
  multiselect,
  password as passwordPrompt,
  select,
  text,
} from "@clack/prompts";
import {
  createOrganizationApi,
  type SpaceSignalsReadQuery,
} from "@openmeld/api-client";
import type { SpaceCreator, SpaceMeta } from "@openmeld/protocol";
import {
  normalizeBuiltinAgentControllerId,
  normalizeSpacePasswordText,
  resolveInitialSpaceAccessMode,
  resolveSingleSpaceMentionLabels,
  SPACE_MEMBER_JOIN_NOTICE_PURPOSE,
  SPACE_MEMBER_REMOVE_NOTICE_PURPOSE,
  SPACE_PASSWORD_MIN_LENGTH,
} from "@openmeld/schemas";
import type {
  AccountSpaceIndexQuery,
  LeaveSpaceResponse,
  OpenMeldRequestContext,
  OrganizationDirectoryResponse,
  PostSpaceMembersResponse,
  RemoveSpaceMembersResponse,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
  buildSpaceProfileAddPlan,
  type SpaceProfileAddInvalidSelection,
  type SpaceProfileAddMode,
  type SpaceProfileAddProfile,
} from "@openmeld/space";
import pc from "picocolors";
import {
  type AgentTargetState,
  listAgentTargetStates,
} from "../agents/registry";
import {
  type AuthenticationGuidance,
  type AuthenticationGuidanceReason,
  buildHumanAuthenticationCard,
  resolveAuthenticationGuidance,
} from "../auth/auth-guidance";
import { buildCommandAuthenticationPromptMessage } from "../auth/command-auth";
import { getCurrentCommandCheckState } from "../command-entry-checks/current-command-check-state";
import { resolveCurrentOpenMeldAccountContext } from "../config/account-context";
import { listAccountSpaceIndex } from "../config/account-space-index-api";
import {
  deriveAuthBaseUrlFromGatewayUrl,
  resolveAuthRequestCompatibility,
} from "../config/auth-request-compatibility";
import {
  getAuthSessionState,
  type StoredActiveOrganization,
  type StoredAuthSession,
} from "../config/auth-session";
import { isLoopbackHostname } from "../config/loopback-hostname";
import {
  listOpenMeldProfiles,
  type OpenMeldProfile,
} from "../config/openmeld-profiles-api";
import {
  buildOpenMeldRequestContextFromProfile,
  buildOpenMeldRequestContextFromProfileIdentity,
} from "../config/openmeld-request-context";
import {
  updateProfileSpaceHistoryStatus,
  upsertProfileSpaceHistory,
} from "../config/profile-space-history-api";
import {
  buildOpenMeldProfileRequestHeadersWithAuth,
  buildOpenMeldRequestContextHeadersWithAuth,
} from "../config/request-headers";
import { resolveLocalServiceDemand } from "../local-service/lifecycle/local-service-demand";
import {
  persistAgentTransportSelection,
  resolveAgentProfileSetup,
} from "../profile/agent-setup-flow";
import {
  createProfileByKind,
  resolveCreateProfileKind,
  resolveCreateProfileName,
} from "../profile/create-flow";
import {
  toSpaceCreateUrl,
  toSpaceCursorUrl,
  toSpaceDeleteUrl,
  toSpacePasswordUrl,
} from "../protocol/urls";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommand,
  formatOpenMeldCliTextBlock,
  formatProfileAwareOpenMeldCliCommand,
} from "../runtime/cli-entry-command";
import { resolveRuntimeContext } from "../runtime/context";
import { assertDispatchOwnedRuntimePublicWriteAllowed } from "../runtime/dispatch-owned-runtime";
import {
  createSpaceAddMembersCurrentProfileGuideError,
  createSpaceAddMembersGuideError,
  createSpaceCreateGuideError,
  createSpaceDeleteHumanApprovalGuideError,
  createSpaceLeaveCreatorGuideError,
  createSpaceLeaveGuideError,
  createSpaceRemoveMembersCreatorGuideError,
  createSpaceRemoveMembersCurrentProfileGuideError,
  createSpaceRemoveMembersGuideError,
  createSpaceSubcommandTargetGuideError,
  createSpaceTargetGuideError,
} from "../runtime/dual-view-guide-catalog";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { formatMessage } from "../runtime/messages";
import { createPresenter } from "../runtime/presenter/index";
import {
  type ActionParticipationCandidate,
  type ActionParticipationPlan,
  planActionParticipation,
} from "../system/action-participation-planner";
import { resolveAgentProfilePrimaryAgentControllerReport } from "../system/agent-profile-primary-binding";
import { resolveCurrentReplyReadinessSnapshot } from "../system/current-reply-readiness-snapshot";
import { ensureFormalAgentBindingForReadyLocalProfile } from "../system/formal-agent-binding-backstop";
import { runLocalParticipationOrchestrator } from "../system/local-participation-orchestrator";
import { resolveServiceParticipationReadiness } from "../system/service-participation-readiness";
import { createDelayedSpinner } from "../ui/delayed-spinner";
import { renderHumanErrorCard } from "../ui/human-error-card";
import { renderInfoCard } from "../ui/info-card";
import { promptSearchMultiselect } from "../ui/search-select";
import {
  buildSpaceCreatePasswordPromptConfig,
  resolveSpaceCreatePasswordlessAccessText,
  type SpaceCreatePasswordPromptConfig,
} from "../ui/space-create-password-prompt";
import { promptTextEntry } from "../ui/text-entry";
import {
  resolveSpaceAddMembersProgressPhase,
  SPACE_ADD_MEMBERS_PROGRESS_HEARTBEAT_MS,
  type SpaceAddMembersProgressStage,
} from "./add-members-progress-contract";
import { emitSpaceAgentOverview } from "./agent-overview";
import { createCliApiClientFoundation } from "./api-client-foundation";
import { createCliSpaceApi } from "./cli-space-api";
import {
  assertValidSpaceIdTarget,
  ensureSpaceCommandGatewayAuthenticationOrCancel,
  prepareAuthenticatedSpaceCommandContext,
  resolveOpenMeldProfileForSpaceCommand,
} from "./command-context";
import {
  normalizeOptionalString,
  parseHttpErrorMessage,
  readHttpErrorField,
  readHttpRequestId,
  resolveUpstreamStatus,
  safeJsonParse,
  toErrorMessage,
} from "./command-http-errors";
import {
  normalizeDisplayValue,
  normalizeGuideInput,
  resolveGatewayHost,
  sanitizeSingleLinePromptText,
  TRAILING_SLASHES_RE,
} from "./command-input-normalizers";
import {
  buildKnownSpaceData,
  formatKnownSpaceDetailLines,
  formatKnownSpaceListLine,
  formatKnownSpaceName,
  type KnownSpaceOption,
  type KnownSpaceVisibilityScope,
  toKnownSpaceOptionFromAccountIndex,
} from "./command-known-space-projection";
import {
  buildSpaceMemberRepairCommand,
  formatSpaceMemberRecoveryNextAction,
  isSpaceMemberCandidateBackgroundReplyReady,
  isSpaceMemberCandidateRepairableLocalParticipationCandidate,
  resolveSpaceMemberCandidateStatusBadges,
  resolveSpaceMemberCandidateStatusLabel,
  resolveSpaceMemberJoinOnlyNextAction,
  resolveSpaceMemberJoinOnlyReason,
  resolveSpaceMemberTerminalLocalTargetLabel,
  resolveSpaceMemberTerminalProfileLabel,
  type SpaceMemberCandidate,
  type SpaceMembershipProfileKind,
} from "./command-member-recovery";
import {
  maybeEmitKnownSpaceDeletedNotices,
  promptHumanJoinSelectionWithoutKnownSpaces,
  promptSpaceJoinSelection,
  promptSpacePasswordTargetSelection,
  promptSpaceSelectionTarget,
  resolveSpaceVisibilitySummary,
  type SpaceDeleteTarget,
  type SpaceJoinTargetResolution,
  type SpaceSelectionTarget,
  type SpaceSelectionTargetResult,
} from "./command-selection-prompts";
import {
  filterKnownSpacesCreatedByProfile,
  normalizeMetaForHistory,
  requireReadableSpaceConfigList,
  resolveKnownSpacesForSelectionWithLoading,
  resolveSpaceDeleteTargets,
  resolveSpaceTarget,
  SPACE_LOADING_SPINNER_MESSAGE,
} from "./command-target-resolution";

// biome-ignore lint/performance/noBarrelFile: command.ts preserves the public import path during the move-only split.
export {
  formatSpaceMemberRecoveryNextAction,
  resolveSpaceMemberJoinOnlyNextAction,
} from "./command-member-recovery";

import {
  isSpaceCommandOutputHandledError,
  SpaceCommandOutputHandledError,
} from "./command-output-handled";
import {
  fetchSpaceCursor,
  parseCreateSpaceResponse,
  parseSpaceCursorResponse,
  resolveWorkflowAckHint,
} from "./command-send-history-leaves";
import { runConnect } from "./connect";
import { fetchSpaceRequestWithTimeout } from "./fetch-with-timeout";
import {
  type StructuredGatewayFailure,
  toStructuredGatewayFailure,
} from "./gateway-response";
import { runTail } from "./history";
import { resolveSpaceJoinAccessBootstrap } from "./join-access-bootstrap";
import { runSpaceJoinConnectHandoff } from "./join-connect-handoff";
import {
  assertSpaceJoinTargetPreflightReady,
  buildJoinTargetMissingMessage,
  type PreparedSpaceJoinEntryContext,
  prepareSpaceJoinEntryContext,
  resolveSpaceJoinEntryTargetOutcome,
} from "./join-entry";
import { resolveSpaceJoinMembershipBootstrap } from "./join-membership-bootstrap";
import { shouldShowSpaceJoinProgress } from "./join-progress";
import { resolveSpaceJoinRoleAliasBootstrap } from "./join-role-alias-bootstrap";
import {
  isLocalSpaceStateCorruptResult,
  listSpaceConfigs,
  readSpaceConfig,
  removeSpaceConfig,
  type SpaceConfig,
  toLocalSpaceStateIntegrityError,
  upsertSpaceConfig,
} from "./local-state";
import { validateSpaceMemberSelectionInput } from "./member-selection-contract";
import {
  leaveSpace,
  postSpaceMembers,
  removeSpaceMembers,
} from "./members-mutations";
import { buildSpacePrimaryMentionLabelByProfileId } from "./mention-label-state";
import { fetchSpaceMeta } from "./meta-api";
import type { SpaceCommandNavigationStatus } from "./navigation-status";
import {
  buildSpacePasswordRequirementsText,
  emitSpacePasswordPromptNotice,
  promptSpacePassword,
  resolveSpacePasswordPromptReason,
  validateSpacePasswordInput,
} from "./password-flow";
import {
  emitSpaceCommandPreflight,
  emitSpaceFailureNextStep,
  resolveSpaceFailureGuidance,
} from "./preflight";
import { runSend } from "./send";
import { resolveSpaceSendText } from "./send-input";
import {
  buildSpaceAddMembersHumanResultCard,
  buildSpaceRemoveMembersHumanResultCard,
  getChooseMembersToRemoveMessage,
  getChooseProfilesToBringMessage,
} from "./space-add-members-ui";
import { buildSpaceWebUrl } from "./web-url";

const MAX_DELETE_PASSWORD_PROMPT_ATTEMPTS = 5;
const SPACE_CREATE_AUTH_CHECK_TIMEOUT_MS = 8000;
const SPACE_CREATE_AUTH_CHECK_LOOPBACK_TIMEOUT_MS = 1500;
const SPACE_ADD_MEMBERS_PROJECTION_WAIT_MAX_ATTEMPTS = 3;
const SPACE_ADD_MEMBERS_PROJECTION_WAIT_DELAY_MS = 500;

type SpaceCreateVisibility = "public" | "private";

type SpaceCreatePreflightBlockReason =
  | "auth_required"
  | "auth_mismatch"
  | "organization_required"
  | "service_unavailable";

function resolveOptionalReadableSpaceConfig(
  result: Awaited<ReturnType<typeof readSpaceConfig>>,
  operation: string
): SpaceConfig | null {
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

class SpaceCreatePreflightBlockedError extends Error {
  readonly code = "openmeld.space.create.preflight_blocked";
  readonly blockReason: SpaceCreatePreflightBlockReason;
  readonly reasonText: string;
  readonly nextStep: string;
  readonly gatewayUrl: string;
  readonly authBaseUrl: string | null;
  readonly httpStatus: number | null;
  readonly errorCode: string | null;
  readonly requestId: string | null;
  readonly detailMessage: string | null;
  readonly authGuidance: AuthenticationGuidance | null;

  constructor(input: {
    message: string;
    blockReason: SpaceCreatePreflightBlockReason;
    reasonText: string;
    nextStep: string;
    gatewayUrl: string;
    authBaseUrl?: string | null;
    httpStatus?: number | null;
    errorCode?: string | null;
    requestId?: string | null;
    detailMessage?: string | null;
    authGuidance?: AuthenticationGuidance | null;
  }) {
    super(input.message);
    this.name = "SpaceCreatePreflightBlockedError";
    this.blockReason = input.blockReason;
    this.reasonText = input.reasonText;
    this.nextStep = input.nextStep;
    this.gatewayUrl = input.gatewayUrl;
    this.authBaseUrl = input.authBaseUrl ?? null;
    this.httpStatus = input.httpStatus ?? null;
    this.errorCode = input.errorCode ?? null;
    this.requestId = input.requestId ?? null;
    this.detailMessage = input.detailMessage ?? null;
    this.authGuidance = input.authGuidance ?? null;
  }
}

function isSpaceCreatePreflightBlockedError(
  error: unknown
): error is SpaceCreatePreflightBlockedError {
  return (
    error instanceof SpaceCreatePreflightBlockedError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code ===
        "openmeld.space.create.preflight_blocked")
  );
}

function createSpaceCreateAuthenticationPreflightError(input: {
  reason: AuthenticationGuidanceReason;
  gatewayUrl: string;
  authBaseUrl?: string | null;
  httpStatus?: number | null;
  errorCode?: string | null;
  requestId?: string | null;
  detailMessage?: string | null;
}): SpaceCreatePreflightBlockedError {
  const guidance = resolveAuthenticationGuidance({
    reason: input.reason,
    action: "creating a space",
    authBaseUrl: input.authBaseUrl,
    gatewayUrl: input.gatewayUrl,
  });

  return new SpaceCreatePreflightBlockedError({
    message: guidance.commandErrorMessage,
    blockReason:
      guidance.reason === "mismatch" ? "auth_mismatch" : "auth_required",
    reasonText: guidance.summary,
    nextStep: guidance.errorNextStep,
    gatewayUrl: input.gatewayUrl,
    authBaseUrl: input.authBaseUrl,
    httpStatus: input.httpStatus,
    errorCode: input.errorCode,
    requestId: input.requestId,
    detailMessage: input.detailMessage,
    authGuidance: guidance,
  });
}

function createSpaceCreateOrganizationPreflightError(input: {
  gatewayUrl: string;
  authBaseUrl?: string | null;
}): SpaceCreatePreflightBlockedError {
  return new SpaceCreatePreflightBlockedError({
    message:
      "openmeld space create requires an active OpenMeld organization. Run `openmeld org switch <slug>` and retry.",
    blockReason: "organization_required",
    reasonText: "No active OpenMeld organization is selected.",
    nextStep: "Run `openmeld org list`, then `openmeld org switch <slug>`.",
    gatewayUrl: input.gatewayUrl,
    authBaseUrl: input.authBaseUrl,
  });
}
type SpaceCreateFlowStep =
  | "name"
  | "visibility"
  | "guide"
  | "password"
  | "join";

type SpaceCreateFlowValues = {
  name: string;
  visibility: SpaceCreateVisibility;
  guide?: string;
  password?: string;
  join: boolean;
};

type SpaceCreateFlowResult =
  | { status: "submitted"; value: SpaceCreateFlowValues }
  | { status: "back" }
  | { status: "cancelled" };

type SpaceCreateResolvedInput = {
  name: string;
  visibility: SpaceCreateVisibility;
  guide?: string;
  password?: string;
  joinInput?: boolean;
};

type SpaceCreateInputResolution =
  | { status: "submitted"; value: SpaceCreateResolvedInput }
  | { status: "cancelled" | "back" };

type SpaceDeleteConfirmationResult = "confirmed" | "back" | "cancelled";

type SpaceAddMembersResult = {
  added: SpaceMemberCandidate[];
  alreadyJoined: SpaceMemberCandidate[];
  failed: Array<{
    candidate: SpaceMemberCandidate;
    error: unknown;
  }>;
  warnings: Array<{
    candidate: SpaceMemberCandidate;
    error: unknown;
  }>;
};

type SpaceRemoveMemberCandidate = {
  profileId: string;
  profileHandle?: string;
  profileName: string;
  profileKind: SpaceMembershipProfileKind;
  targetMentionLabel?: string | null;
  ownerUserId?: string | null;
  ownerName?: string | null;
  creatorProfileId?: string | null;
};

type SpaceRemoveMembersResult = {
  removed: SpaceRemoveMemberCandidate[];
  alreadyAbsent: SpaceRemoveMemberCandidate[];
  failed: Array<{
    candidate: SpaceRemoveMemberCandidate;
    error: unknown;
  }>;
  warnings: Array<{
    candidate: SpaceRemoveMemberCandidate;
    error: unknown;
  }>;
};

type SpaceLeaveHistoryReason = "left_space" | "leave_space_already_absent";

type SpaceLeaveResult = LeaveSpaceResponse & {
  profileSpaceHistory: {
    updated: boolean;
    reason: SpaceLeaveHistoryReason;
    warning?: StructuredGatewayFailure;
  };
};

type ResolvedSpaceRemoveMemberCandidates = {
  activeMembers: SpaceRemoveMemberCandidate[];
  explicitFallbackById: Map<string, SpaceRemoveMemberCandidate>;
  creatorProfileIds: Set<string>;
};

function isSpaceMembershipProfileKind(
  profileKind: unknown
): profileKind is SpaceMembershipProfileKind {
  return profileKind === "human" || profileKind === "agent";
}

type SpaceCreatePostJoinContext = {
  localEcho?: boolean;
  historyLimit?: number;
  role?: string;
  mentionAlias?: string;
  rawStream?: boolean;
  skipBringProfilesPrompt?: boolean;
  output?: string;
  view?: string;
  serviceIntent?: "space_join" | "space_create_join";
};

function buildPostCreateJoinRequest(input: {
  openMeldProfileId: string;
  baseUrl: string;
  space: string;
  password?: string;
  outputMode: "ndjson" | "text";
  view?: string;
  postCreateJoin?: SpaceCreatePostJoinContext;
}): Parameters<typeof runSpaceJoin>[0] {
  const joinOutput =
    input.postCreateJoin?.output === "text" ||
    input.postCreateJoin?.output === "ndjson"
      ? input.postCreateJoin.output
      : input.outputMode;
  const joinView = input.postCreateJoin?.view ?? input.view;

  return {
    profile: input.openMeldProfileId,
    baseUrl: input.baseUrl,
    space: input.space,
    password: input.password,
    output: joinOutput,
    view: joinView,
    ...(typeof input.postCreateJoin?.localEcho === "boolean"
      ? { localEcho: input.postCreateJoin.localEcho }
      : {}),
    ...(typeof input.postCreateJoin?.historyLimit === "number"
      ? { historyLimit: input.postCreateJoin.historyLimit }
      : {}),
    ...(typeof input.postCreateJoin?.role === "string"
      ? { role: input.postCreateJoin.role }
      : {}),
    ...(typeof input.postCreateJoin?.mentionAlias === "string"
      ? { mentionAlias: input.postCreateJoin.mentionAlias }
      : {}),
    ...(typeof input.postCreateJoin?.rawStream === "boolean"
      ? { rawStream: input.postCreateJoin.rawStream }
      : {}),
    ...(typeof input.postCreateJoin?.skipBringProfilesPrompt === "boolean"
      ? {
          skipBringProfilesPrompt: input.postCreateJoin.skipBringProfilesPrompt,
        }
      : {}),
    serviceIntent: input.postCreateJoin?.serviceIntent ?? "space_create_join",
    entryChecksHandled: true,
  };
}

export async function runSpaceCreate(input: {
  profile?: string;
  baseUrl?: string;
  name?: string;
  visibility?: string;
  guide?: string;
  guidePromptHandled?: boolean;
  password?: string;
  join?: boolean;
  output?: string;
  view?: string;
  entryChecksHandled?: boolean;
  postCreateJoin?: SpaceCreatePostJoinContext;
}): Promise<SpaceCommandNavigationStatus> {
  // OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT space-create
  // Setup Agent may create or select a Space, but entering the Space UI is not
  // required. Space creation is one operation surface on the shared path.
  const { runtime, presenter, interactive } =
    await prepareSpaceCreateRuntimeState(input);

  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage("creating a space"),
    entryChecksHandled: input.entryChecksHandled,
    runtime,
    presenter,
    interactive,
  });
  if (context.status === "cancelled") {
    return "cancelled";
  }
  const {
    runtime: contextRuntime,
    interactive: contextInteractive,
    presenter: contextPresenter,
    baseUrl,
  } = context;
  const outputMode = input.output === "ndjson" ? "ndjson" : "text";
  let failureOpenMeldProfileId = input.profile;

  try {
    const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
      openMeldProfileId: input.profile,
      resolvedView: contextRuntime.resolvedView,
      interactive: contextInteractive,
    });
    failureOpenMeldProfileId = openMeldProfile.openMeldProfileId;

    await emitSpaceCommandPreflight({
      presenter: contextPresenter,
      command: "create",
      profile: openMeldProfile,
      baseUrl,
      resolvedView: contextRuntime.resolvedView,
      humanServiceGuidanceMode: isHumanInteractiveSpaceRuntime(contextRuntime)
        ? "suppress"
        : "show",
    });
    assertNonInteractiveSpaceCreateRequiredInput({
      providedName: input.name,
      providedVisibility: input.visibility,
      interactive: contextInteractive,
      resolvedView: contextRuntime.resolvedView,
    });
    const activeOrganization = await ensureSpaceCreateAuthReady({
      baseUrl,
    });

    const createInput = await resolveSpaceCreateInput({
      runtime: contextRuntime,
      interactive: contextInteractive,
      presenter: contextPresenter,
      openMeldProfile,
      providedName: input.name,
      providedVisibility: input.visibility,
      providedGuide: input.guide,
      guidePromptHandled: input.guidePromptHandled,
      providedPassword: input.password,
      joinInput: input.join,
    });
    if (createInput.status !== "submitted") {
      return createInput.status;
    }

    const creator: SpaceCreator = {
      profileId: openMeldProfile.openMeldProfileId,
      profileName: openMeldProfile.profileName,
      kind: openMeldProfile.profileKind,
      profile: openMeldProfile.openMeldProfileId,
    };

    const createSpaceUrl = toSpaceCreateUrl(baseUrl);
    const headers = await buildOpenMeldProfileRequestHeadersWithAuth({
      requestUrl: createSpaceUrl,
      openMeldProfile,
    });
    headers["content-type"] = "application/json";

    const response = await fetchSpaceRequestWithTimeout({
      url: createSpaceUrl,
      operation: "space.create",
      init: {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: createInput.value.name,
          visibility: createInput.value.visibility,
          ...(typeof createInput.value.password === "string"
            ? { password: createInput.value.password }
            : {}),
          ...(createInput.value.guide === undefined
            ? {}
            : { guide: createInput.value.guide }),
        }),
      },
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${raw}`);
    }

    const parsed = parseCreateSpaceResponse(raw);
    await upsertSpaceConfig({
      openMeldProfileId: openMeldProfile.openMeldProfileId,
      baseUrl,
      space: parsed.spaceId,
      profileHandle: openMeldProfile.profileHandle,
      profileName: openMeldProfile.profileName,
      creator: parsed.meta?.creator ?? creator,
      name:
        typeof parsed.meta?.name === "string"
          ? parsed.meta.name
          : createInput.value.name || null,
      spaceCreatedAt: parsed.meta?.createdAt ?? null,
      spaceUpdatedAt: parsed.meta?.updatedAt ?? null,
      passwordProtected:
        typeof parsed.meta?.passwordProtected === "boolean"
          ? parsed.meta.passwordProtected
          : typeof createInput.value.password === "string",
      guide:
        typeof parsed.meta?.guide === "string"
          ? parsed.meta.guide
          : createInput.value.guide,
    });

    emitSpaceCreateSuccessOutput({
      baseUrl,
      presenter: contextPresenter,
      parsed,
      outputMode,
      resolvedView: contextRuntime.resolvedView,
      passwordProtected: typeof createInput.value.password === "string",
      visibility: createInput.value.visibility,
      organization: {
        active: activeOrganization,
      },
    });

    await syncProfileSpaceHistoryForCreate({
      openMeldProfile,
      baseUrl,
      spaceId: parsed.spaceId,
      meta: parsed.meta,
      fallbackSpaceName: createInput.value.name,
    }).catch((error) => {
      contextPresenter.event(
        "info",
        "connect.warn.profile_space_history_sync_failed",
        {
          error: toErrorMessage(error),
        }
      );
    });

    const joinNow = isHumanInteractiveSpaceRuntime(contextRuntime)
      ? Boolean(createInput.value.joinInput)
      : await resolveJoinAfterCreate(
          createInput.value.joinInput,
          contextInteractive
        );
    if (contextRuntime.resolvedView === "agent") {
      emitSpaceCreateAgentFollowUp({
        baseUrl,
        presenter: contextPresenter,
        profileId: openMeldProfile.openMeldProfileId,
        spaceId: parsed.spaceId,
        joinRequested: joinNow,
        organization: {
          active: activeOrganization,
        },
      });
      return "completed";
    }
    if (!joinNow) {
      return "completed";
    }

    return await runSpaceJoin(
      buildPostCreateJoinRequest({
        openMeldProfileId: openMeldProfile.openMeldProfileId,
        baseUrl,
        space: parsed.spaceId,
        password: createInput.value.password,
        outputMode,
        view: input.view,
        postCreateJoin: input.postCreateJoin,
      })
    );
  } catch (error) {
    if (
      maybeRenderHumanSpaceCreateFailureCard({
        presenter: contextPresenter,
        error,
        outputMode,
        baseUrl,
        resolvedView: contextRuntime.resolvedView,
      })
    ) {
      throw new SpaceCommandOutputHandledError(toErrorMessage(error));
    }
    emitSpaceFailureNextStep({
      presenter: contextPresenter,
      command: "create",
      error,
      profileId: failureOpenMeldProfileId,
      resolvedView: contextRuntime.resolvedView,
    });
    throw error;
  }
}

function emitSpaceCreateAgentFollowUp(input: {
  baseUrl: string;
  presenter: ReturnType<typeof createPresenter>;
  profileId: string;
  spaceId: string;
  joinRequested: boolean;
  organization: {
    active: StoredActiveOrganization | null;
  };
}): void {
  const spaceUrl = buildSpaceWebUrl(
    input.baseUrl,
    requireActiveOrganizationSlug(input.organization.active),
    input.spaceId
  );
  const historyCommand = formatOpenMeldCliCommand(
    `openmeld space history ${input.spaceId} --profile ${input.profileId} --kind text --brief --limit 20 --view agent`
  );
  const sendCommand = formatOpenMeldCliCommand(
    `openmeld space send ${input.spaceId} --profile ${input.profileId} "hello" --view agent`
  );
  input.presenter.data({
    code: "space.create.next_commands",
    payload: {
      spaceId: input.spaceId,
      spaceUrl,
      joinRequested: input.joinRequested,
      joinedByCreate: true,
      organization: input.organization,
      note: "Agent View create returns after creating the Space. Use explicit follow-up commands instead of opening a long-running join session.",
      nextCommands: [historyCommand, sendCommand],
    },
  });
}

async function syncProfileSpaceHistoryForCreate(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  spaceId: string;
  meta?: SpaceMeta;
  fallbackSpaceName?: string;
}): Promise<void> {
  const gatewayHost = resolveGatewayHost(input.baseUrl);
  if (!gatewayHost) {
    return;
  }

  const normalizedMeta = input.meta
    ? normalizeMetaForHistory(input.meta)
    : null;
  const fallbackSpaceName = normalizeOptionalString(input.fallbackSpaceName);
  const historySpaceName =
    normalizedMeta?.spaceName === undefined
      ? fallbackSpaceName
      : normalizedMeta.spaceName;
  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile: input.openMeldProfile,
  });

  await upsertProfileSpaceHistory({
    baseUrl: input.baseUrl,
    requestContext,
    openMeldProfileId: input.openMeldProfile.openMeldProfileId,
    profileName: input.openMeldProfile.profileName,
    spaceId: input.spaceId,
    body: {
      gatewayHost,
      ...(historySpaceName ? { spaceName: historySpaceName } : {}),
      ...(normalizedMeta?.creatorProfileId === undefined
        ? { creatorProfileId: input.openMeldProfile.openMeldProfileId }
        : { creatorProfileId: normalizedMeta.creatorProfileId }),
      ...(normalizedMeta?.creatorKind === undefined
        ? { creatorKind: input.openMeldProfile.profileKind }
        : { creatorKind: normalizedMeta.creatorKind }),
      ...(normalizedMeta?.spaceCreatedAt === undefined
        ? {}
        : { spaceCreatedAt: normalizedMeta.spaceCreatedAt }),
      ...(normalizedMeta?.spaceUpdatedAt === undefined
        ? {}
        : { spaceUpdatedAt: normalizedMeta.spaceUpdatedAt }),
      lastJoinedAt: normalizedMeta?.spaceCreatedAt ?? new Date().toISOString(),
      status: "active",
    },
  });
}

async function resolveSpaceCreateInput(input: {
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  interactive: boolean;
  presenter: ReturnType<typeof createPresenter>;
  openMeldProfile: OpenMeldProfile;
  providedName?: string;
  providedVisibility?: string;
  providedGuide?: string;
  guidePromptHandled?: boolean;
  providedPassword?: string;
  joinInput?: boolean;
}): Promise<SpaceCreateInputResolution> {
  if (isHumanInteractiveSpaceRuntime(input.runtime)) {
    const prompted = await promptInteractiveSpaceCreateFlow({
      providedName: input.providedName,
      providedVisibility: input.providedVisibility,
      providedGuide: input.providedGuide,
      guidePromptHandled: input.guidePromptHandled,
      providedPassword: input.providedPassword,
      joinInput: input.joinInput,
    });
    if (prompted.status === "submitted") {
      return {
        status: "submitted",
        value: {
          name: prompted.value.name,
          visibility: prompted.value.visibility,
          ...(prompted.value.guide === undefined
            ? {}
            : { guide: prompted.value.guide }),
          ...(prompted.value.password === undefined
            ? {}
            : { password: prompted.value.password }),
          joinInput: prompted.value.join,
        },
      };
    }
    if (prompted.status === "back") {
      return { status: "back" };
    }
    return { status: "cancelled" };
  }

  const name = await resolveCreateSpaceNameInput({
    providedName: input.providedName,
    interactive: input.interactive,
    resolvedView: input.runtime.resolvedView,
  });
  if (name === null) {
    return { status: "cancelled" };
  }

  const visibility = resolveCreateSpaceVisibilityInput({
    providedVisibility: input.providedVisibility,
    interactive: input.interactive,
    resolvedView: input.runtime.resolvedView,
  });

  emitSpaceCreatePasswordOptionalHint({
    presenter: input.presenter,
    openMeldProfileId: input.openMeldProfile.openMeldProfileId,
    resolvedView: input.runtime.resolvedView,
    providedPassword: input.providedPassword,
    interactive: input.interactive,
    visibility,
  });
  const password = await resolveCreateSpacePasswordInput({
    providedPassword: input.providedPassword,
    interactive: input.interactive,
    visibility,
  });
  if (password === null) {
    return { status: "cancelled" };
  }
  const normalizedGuide = normalizeGuideInput(input.providedGuide);

  return {
    status: "submitted",
    value: {
      name,
      visibility,
      ...(normalizedGuide === undefined ? {} : { guide: normalizedGuide }),
      ...(password === undefined ? {} : { password }),
      joinInput: input.joinInput,
    },
  };
}

function renderHumanSpaceCreateCard(input: {
  presenter: ReturnType<typeof createPresenter>;
  spaceId: string;
  spaceUrl: string;
  visibility: SpaceCreateVisibility | null;
  organization: {
    active: StoredActiveOrganization | null;
  };
  passwordProtected: boolean;
}): void {
  const rows: Array<{ label: string; value: string }> = [
    {
      label: "🆔 Space ID",
      value: input.spaceId,
    },
    {
      label: "🔗 Space URL",
      value: input.spaceUrl,
    },
    {
      label: "Organization",
      value: input.organization.active
        ? `${input.organization.active.name} (${input.organization.active.slug})`
        : "not selected",
    },
    {
      label: "Visibility",
      value: input.visibility ?? "unknown",
    },
  ];

  if (input.passwordProtected) {
    rows.push({
      label: "🔐 Password",
      value: "Protection enabled.",
    });
    rows.push({
      label: "⚠️ Important",
      value:
        "Save this password securely. If lost, it cannot be recovered. Reset is the only option.",
    });
  }

  renderInfoCard({
    presenter: input.presenter,
    title: "✨ Space Created",
    codePrefix: "space.create.card",
    rows,
    sanitize: true,
    minContentWidth: 72,
  });
}

function renderHumanSpacePasswordResultCard(input: {
  presenter: ReturnType<typeof createPresenter>;
  spaceName?: string;
  spaceId: string;
  passwordProtected: boolean;
}): void {
  const rows: Array<{ label: string; value: string }> = [
    {
      label: "Space",
      value: resolveSpaceCardDisplayName(input.spaceName),
    },
    {
      label: "Space ID",
      value: input.spaceId,
    },
    {
      label: "Join access",
      value: input.passwordProtected
        ? "Password required"
        : "No password required",
    },
  ];

  if (input.passwordProtected) {
    rows.push({
      label: "Security note",
      value:
        "Save this password securely. If you lose it, you'll need to set a new one.",
    });
  }

  renderInfoCard({
    presenter: input.presenter,
    title: input.passwordProtected
      ? "✅ Password Updated"
      : "✅ Password Cleared",
    codePrefix: "space.password.card",
    rows,
    sanitize: true,
    minContentWidth: 72,
  });
}

function resolveSpaceCardDisplayName(spaceName?: string): string {
  const normalized = sanitizeSingleLinePromptText(spaceName) || "";
  return normalized.length > 0 ? normalized : "Untitled space";
}

async function ensureSpaceCreateAuthReady(input: {
  baseUrl: string;
}): Promise<StoredActiveOrganization> {
  const authState = await getAuthSessionState({
    validateRemote: false,
  });

  switch (authState.state) {
    case "missing":
      throw createSpaceCreateAuthenticationPreflightError({
        reason: "required",
        gatewayUrl: input.baseUrl,
      });
    case "expired":
      throw createSpaceCreateAuthenticationPreflightError({
        reason: "expired",
        gatewayUrl: input.baseUrl,
      });
    case "invalid":
      throw createSpaceCreateAuthenticationPreflightError({
        reason: "invalid",
        gatewayUrl: input.baseUrl,
      });
    case "revoked":
      throw createSpaceCreateAuthenticationPreflightError({
        reason: "revoked",
        gatewayUrl: input.baseUrl,
      });
    case "valid":
      break;
    default:
      throw createSpaceCreateAuthenticationPreflightError({
        reason: "required",
        gatewayUrl: input.baseUrl,
      });
  }

  if (!authState.session) {
    throw createSpaceCreateAuthenticationPreflightError({
      reason: "required",
      gatewayUrl: input.baseUrl,
    });
  }

  const compatibility = resolveAuthRequestCompatibility({
    session: authState.session,
    requestUrl: input.baseUrl,
  });
  if (!compatibility.compatible) {
    throw createSpaceCreateAuthenticationPreflightError({
      reason: "mismatch",
      gatewayUrl: input.baseUrl,
      authBaseUrl: authState.session.authBaseUrl,
    });
  }

  await verifySpaceCreateTargetAuthSession({
    gatewayUrl: input.baseUrl,
    session: authState.session,
  });
  const activeOrganization = authState.session.activeOrganization ?? null;
  if (!activeOrganization) {
    throw createSpaceCreateOrganizationPreflightError({
      gatewayUrl: input.baseUrl,
      authBaseUrl: authState.session.authBaseUrl,
    });
  }

  return activeOrganization;
}

async function verifySpaceCreateTargetAuthSession(input: {
  gatewayUrl: string;
  session: StoredAuthSession;
}): Promise<void> {
  const authBaseUrl =
    deriveAuthBaseUrlFromGatewayUrl(input.gatewayUrl) ??
    input.session.authBaseUrl;
  const endpoint = toAuthEndpoint(authBaseUrl, "/api/auth/get-session");
  const timeoutMs = resolveSpaceCreateAuthCheckTimeoutMs(endpoint);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `${normalizeAuthTokenType(input.session.tokenType)} ${input.session.accessToken}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new SpaceCreatePreflightBlockedError({
      message: "upstream_unreachable: auth session check failed before create",
      blockReason: "service_unavailable",
      reasonText: "OpenMeld auth service is temporarily unavailable.",
      nextStep: resolveSpaceServiceUnavailableSummary(),
      gatewayUrl: input.gatewayUrl,
      authBaseUrl,
      detailMessage: toErrorMessage(error),
    });
  }

  const raw = await response.text();
  const payload = safeJsonParse(raw);

  if (response.status === 401 || response.status === 403) {
    throw createSpaceCreateAuthenticationPreflightError({
      reason: "required",
      gatewayUrl: input.gatewayUrl,
      authBaseUrl,
      httpStatus: response.status,
      errorCode: readHttpErrorField(payload, "code") || null,
      requestId: readHttpRequestId(payload) || null,
      detailMessage: readHttpErrorField(payload, "message") || null,
    });
  }

  if (!response.ok) {
    const parsedError = parseHttpErrorMessage(
      `HTTP ${response.status}: ${raw}`
    );
    throw new SpaceCreatePreflightBlockedError({
      message: `HTTP ${response.status}: ${raw}`,
      blockReason: "service_unavailable",
      reasonText: parsedError
        ? resolveHumanSpaceCreateFailureReason(parsedError)
        : "OpenMeld auth service is temporarily unavailable.",
      nextStep:
        resolveSpaceFailureGuidance(`HTTP ${response.status}: ${raw}`)
          ?.summary ?? resolveSpaceServiceUnavailableSummary(),
      gatewayUrl: input.gatewayUrl,
      authBaseUrl,
      httpStatus: response.status,
      errorCode: readHttpErrorField(payload, "code") || null,
      requestId: readHttpRequestId(payload) || null,
      detailMessage: readHttpErrorField(payload, "message") || null,
    });
  }

  if (!hasActiveAuthSessionPayload(payload)) {
    throw createSpaceCreateAuthenticationPreflightError({
      reason: "required",
      gatewayUrl: input.gatewayUrl,
      authBaseUrl,
    });
  }
}

function maybeRenderHumanSpaceCreateFailureCard(input: {
  presenter: ReturnType<typeof createPresenter>;
  error: unknown;
  outputMode: "text" | "ndjson";
  baseUrl: string;
  resolvedView: "human" | "agent";
}): boolean {
  if (input.resolvedView !== "human" || input.outputMode !== "text") {
    return false;
  }

  if (isSpaceCreatePreflightBlockedError(input.error)) {
    return renderHumanSpaceCreatePreflightBlockedCard({
      presenter: input.presenter,
      error: input.error,
    });
  }

  const parsed = parseHttpErrorMessage(input.error);
  if (!parsed) {
    return false;
  }

  const payload = safeJsonParse(parsed.body);
  const authenticationFailure =
    resolveSpaceCreateAuthenticationFailureFromHttpError({
      parsed,
      payload,
      gatewayUrl: input.baseUrl,
    });
  if (authenticationFailure) {
    return renderHumanSpaceCreatePreflightBlockedCard({
      presenter: input.presenter,
      error: authenticationFailure,
    });
  }

  const guidance = resolveSpaceFailureGuidance(input.error);
  let nextStep = "Check the Space details, then try again.";
  if (parsed.status >= 500) {
    nextStep = "Try again in a moment.";
  }
  if (guidance?.steps[0]) {
    nextStep = `Run ${guidance.steps[0]}.`;
  }
  renderHumanErrorCard({
    message: resolveHumanSpaceCreateFailureReason(parsed),
    nextStep,
    presenter: input.presenter,
    title: "Space couldn't be created",
    codePrefix: "space.create.error.card",
  });
  return true;
}

function resolveSpaceCreateAuthenticationFailureFromHttpError(input: {
  parsed: {
    status: number;
    body: string;
    code: string;
    message: string;
  };
  payload: unknown;
  gatewayUrl: string;
}): SpaceCreatePreflightBlockedError | null {
  const reason = resolveSpaceCreateAuthenticationReason(input.parsed);
  if (!reason) {
    return null;
  }

  return createSpaceCreateAuthenticationPreflightError({
    reason,
    gatewayUrl: input.gatewayUrl,
    httpStatus: input.parsed.status,
    errorCode: readHttpErrorField(input.payload, "code") || input.parsed.code,
    requestId: readHttpRequestId(input.payload) || null,
    detailMessage:
      readHttpErrorField(input.payload, "message") || input.parsed.message,
  });
}

function resolveSpaceCreateAuthenticationReason(input: {
  status: number;
  code: string;
  message: string;
}): Exclude<AuthenticationGuidanceReason, "mismatch"> | null {
  const text = `${input.code} ${input.message}`.toLowerCase();
  if (text.includes("revoked")) {
    return "revoked";
  }
  if (text.includes("expired")) {
    return "expired";
  }
  if (text.includes("invalid")) {
    return "invalid";
  }
  if (input.status === 401) {
    return "required";
  }
  if (
    input.status === 403 &&
    (text.includes("auth.") ||
      text.includes("authentication") ||
      text.includes("session") ||
      text.includes("sign-in") ||
      text.includes("sign in") ||
      text.includes("unauthenticated"))
  ) {
    return "required";
  }
  return null;
}

function renderHumanSpaceCreatePreflightBlockedCard(input: {
  presenter: ReturnType<typeof createPresenter>;
  error: SpaceCreatePreflightBlockedError;
}): boolean {
  if (input.error.authGuidance) {
    const card = buildHumanAuthenticationCard({
      guidance: input.error.authGuidance,
      mode: "error",
    });
    renderInfoCard({
      presenter: input.presenter,
      title: card.title,
      codePrefix: "space.create.auth.card",
      rows: card.rows,
      sanitize: true,
      minContentWidth: 76,
    });
    return true;
  }

  renderHumanErrorCard({
    message: input.error.reasonText,
    nextStep: input.error.nextStep,
    presenter: input.presenter,
    title: "Space couldn't be created",
    codePrefix: "space.create.preflight.card",
  });
  return true;
}

function resolveSpaceServiceUnavailableSummary(): string {
  return (
    resolveSpaceFailureGuidance("upstream_unreachable")?.summary ??
    "OpenMeld Cloud service is temporarily unavailable. Try again after OpenMeld is reachable."
  );
}

function resolveHumanSpaceCreateFailureReason(input: {
  status: number;
  body: string;
  code: string;
  message: string;
}): string {
  if (isAuthUpstreamUnavailableError(input)) {
    return "OpenMeld auth service is temporarily unavailable.";
  }

  const status = resolveUpstreamStatus(input);
  if (status >= 500) {
    return "OpenMeld service is temporarily unavailable.";
  }
  if (status === 401) {
    return "Authentication expired.";
  }
  if (status === 403) {
    return "This profile cannot create spaces on the current gateway.";
  }
  if (input.message.trim().length > 0) {
    return input.message.trim();
  }
  if (input.code.trim().length > 0) {
    return `Space create request failed (${input.code.trim()}).`;
  }
  return "Space create request failed.";
}

function hasActiveAuthSessionPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    Boolean(record.session) &&
    typeof record.session === "object" &&
    Boolean(record.user) &&
    typeof record.user === "object"
  );
}

function normalizeAuthTokenType(tokenType: string | undefined): string {
  const normalized = String(tokenType ?? "").trim();
  return normalized.length > 0 ? normalized : "Bearer";
}

function toAuthEndpoint(baseUrl: string, pathname: string): string {
  const url = new URL(baseUrl);
  const normalizedBasePath = url.pathname.replace(TRAILING_SLASHES_RE, "");
  const normalizedPathname = pathname.startsWith("/")
    ? pathname
    : `/${pathname}`;
  url.pathname = `${normalizedBasePath}${normalizedPathname}` || "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function resolveSpaceCreateAuthCheckTimeoutMs(endpoint: string): number {
  const url = parseUrlOrNull(endpoint);
  if (url && isLoopbackHostname(url.hostname)) {
    return SPACE_CREATE_AUTH_CHECK_LOOPBACK_TIMEOUT_MS;
  }
  return SPACE_CREATE_AUTH_CHECK_TIMEOUT_MS;
}

function parseUrlOrNull(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function requireActiveOrganizationSlug(
  organization: StoredActiveOrganization | null
): string {
  const slug = normalizeOptionalString(organization?.slug);
  if (!slug) {
    throw new Error(
      "Active organization slug is required to build a Space URL."
    );
  }
  return slug;
}

function emitSpaceCreateSuccessOutput(input: {
  baseUrl: string;
  presenter: ReturnType<typeof createPresenter>;
  parsed: ReturnType<typeof parseCreateSpaceResponse>;
  outputMode: "text" | "ndjson";
  resolvedView: "human" | "agent";
  passwordProtected: boolean;
  visibility: SpaceCreateVisibility;
  organization: {
    active: StoredActiveOrganization | null;
  };
}): void {
  const spaceUrl = buildSpaceWebUrl(
    input.baseUrl,
    requireActiveOrganizationSlug(input.organization.active),
    input.parsed.spaceId
  );
  if (input.outputMode === "ndjson") {
    input.presenter.data({
      code: "space.create.response",
      payload: {
        ...input.parsed,
        spaceUrl,
        visibility: input.parsed.meta?.visibility ?? input.visibility,
        organization: input.organization,
      },
    });
    return;
  }

  if (input.resolvedView === "human") {
    renderHumanSpaceCreateCard({
      presenter: input.presenter,
      spaceId: input.parsed.spaceId,
      spaceUrl,
      visibility: input.parsed.meta?.visibility ?? input.visibility,
      organization: input.organization,
      passwordProtected: input.passwordProtected,
    });
    return;
  }

  input.presenter.line({
    code: "space.create.created",
    text: formatMessage(input.resolvedView, "space.create.created", {
      spaceId: input.parsed.spaceId,
    }),
    data: {
      spaceId: input.parsed.spaceId,
      visibility: input.parsed.meta?.visibility ?? input.visibility,
      organization: input.organization,
    },
  });

  input.presenter.line({
    code: "space.create.url",
    text: `Space URL: ${spaceUrl}`,
    data: {
      spaceId: input.parsed.spaceId,
      spaceUrl,
      organization: input.organization,
    },
  });

  if (!input.passwordProtected) {
    return;
  }

  input.presenter.line({
    code: "space.password.warning",
    text: formatMessage(input.resolvedView, "space.password.warning"),
  });
}

async function resolveCreateSpaceNameInput(input: {
  providedName?: string;
  interactive: boolean;
  resolvedView: "human" | "agent";
}): Promise<string | null> {
  const explicitName = String(input.providedName ?? "").trim();
  if (explicitName.length > 0) {
    return explicitName;
  }
  if (!input.interactive) {
    if (input.resolvedView === "agent") {
      throw createSpaceCreateGuideError();
    }
    throw new Error(
      formatOpenMeldCliTextBlock(
        "missing required 'name' argument for `openmeld space create`"
      )
    );
  }

  for (;;) {
    const nameInput = await text({
      message: "Space name",
      placeholder: "e.g. design-review",
    });
    if (isCancel(nameInput)) {
      cancel("Cancelled.");
      return null;
    }
    const name = String(nameInput ?? "").trim();
    if (name.length > 0) {
      return name;
    }
    process.stderr.write("Space name cannot be empty.\n");
  }
}

function assertNonInteractiveSpaceCreateRequiredInput(input: {
  providedName?: string;
  providedVisibility?: string;
  interactive: boolean;
  resolvedView: "human" | "agent";
}): void {
  if (input.interactive && input.resolvedView === "human") {
    return;
  }
  if (!normalizeOptionalString(input.providedName)) {
    if (input.resolvedView === "agent") {
      throw createSpaceCreateGuideError();
    }
    throw new Error(
      formatOpenMeldCliTextBlock(
        "missing required 'name' argument for `openmeld space create`"
      )
    );
  }
  resolveCreateSpaceVisibilityInput(input);
}

function resolveCreateSpaceVisibilityInput(input: {
  providedVisibility?: string;
  interactive: boolean;
  resolvedView: "human" | "agent";
}): SpaceCreateVisibility {
  const explicitVisibility = normalizeSpaceCreateVisibility(
    input.providedVisibility
  );
  if (explicitVisibility) {
    return explicitVisibility;
  }

  const rawVisibility = String(input.providedVisibility ?? "").trim();
  if (rawVisibility.length > 0) {
    throw new Error(
      formatOpenMeldCliTextBlock(
        `invalid --visibility value: ${rawVisibility} (use public|private)`
      )
    );
  }

  if (input.resolvedView === "agent" || !input.interactive) {
    throw createSpaceCreateGuideError(
      "openmeld space create requires explicit --visibility public|private in agent/non-interactive mode."
    );
  }

  throw new Error(
    formatOpenMeldCliTextBlock(
      "missing required --visibility public|private for `openmeld space create`"
    )
  );
}

async function resolveCreateSpacePasswordInput(input: {
  providedPassword?: string;
  interactive: boolean;
  visibility: SpaceCreateVisibility;
}): Promise<string | undefined | null> {
  if (typeof input.providedPassword === "string") {
    return normalizeSpacePasswordText(input.providedPassword);
  }
  if (!input.interactive) {
    return undefined;
  }

  const shouldSetPassword = await confirm({
    message: buildCreateSpacePasswordPromptMessage(input.visibility),
    initialValue: false,
  });
  if (isCancel(shouldSetPassword)) {
    cancel("Cancelled.");
    return null;
  }
  if (!shouldSetPassword) {
    return undefined;
  }

  const password = await promptAndConfirmSpacePassword();
  return password.status === "submitted" ? password.value : null;
}

async function promptInteractiveSpaceCreateFlow(input: {
  providedName?: string;
  providedVisibility?: string;
  providedGuide?: string;
  guidePromptHandled?: boolean;
  providedPassword?: string;
  joinInput?: boolean;
}): Promise<SpaceCreateFlowResult> {
  const normalizedProvidedGuide = normalizeGuideInput(input.providedGuide);
  assertProvidedSpaceCreateVisibilityValid(input.providedVisibility);
  const steps = resolveInteractiveSpaceCreateFlowSteps({
    ...input,
    providedGuide: normalizedProvidedGuide,
  });
  const providedName = resolveProvidedSpaceCreateName(input.providedName);
  const state: Partial<SpaceCreateFlowValues> = {
    ...(providedName ? { name: providedName } : {}),
    ...buildProvidedSpaceCreateVisibility(input.providedVisibility),
    ...(normalizedProvidedGuide === undefined
      ? {}
      : { guide: normalizedProvidedGuide }),
    ...(typeof input.providedPassword === "string"
      ? { password: normalizeSpacePasswordText(input.providedPassword) }
      : {}),
    ...(input.joinInput === undefined ? {} : { join: input.joinInput }),
  };

  let stepIndex = 0;
  while (stepIndex < steps.length) {
    const step = steps[stepIndex];
    if (!step) {
      break;
    }

    const result = await promptInteractiveSpaceCreateFlowStep({
      state,
      step,
    });
    const navigation = resolveSpaceCreateFlowStepNavigation({
      stepIndex,
      result,
    });
    if (navigation === "cancelled") {
      return emitCancelledSpaceCreateFlowResult();
    }
    if (navigation === "back") {
      return { status: "back" };
    }
    if (typeof navigation === "number") {
      stepIndex = navigation;
      continue;
    }

    applySpaceCreateFlowSubmission(state, result);
    stepIndex += 1;
  }

  if (typeof state.name !== "string" || state.name.trim().length === 0) {
    throw new Error("Space create flow completed without a name.");
  }
  if (!state.visibility) {
    throw new Error("Space create flow completed without visibility.");
  }

  return {
    status: "submitted",
    value: {
      name: state.name,
      visibility: state.visibility,
      ...(state.guide === undefined ? {} : { guide: state.guide }),
      ...(state.password === undefined ? {} : { password: state.password }),
      join: state.join === true,
    },
  };
}

function resolveInteractiveSpaceCreateFlowSteps(input: {
  providedName?: string;
  providedVisibility?: string;
  providedGuide?: string;
  guidePromptHandled?: boolean;
  providedPassword?: string;
  joinInput?: boolean;
}): SpaceCreateFlowStep[] {
  const steps: SpaceCreateFlowStep[] = [];
  const normalizedGuide = normalizeGuideInput(input.providedGuide);
  if (!resolveProvidedSpaceCreateName(input.providedName)) {
    steps.push("name");
  }
  if (!normalizeSpaceCreateVisibility(input.providedVisibility)) {
    steps.push("visibility");
  }
  if (normalizedGuide === undefined && input.guidePromptHandled !== true) {
    steps.push("guide");
  }
  if (typeof input.providedPassword !== "string") {
    steps.push("password");
  }
  if (input.joinInput === undefined) {
    steps.push("join");
  }
  return steps;
}

function resolveProvidedSpaceCreateName(
  value: string | undefined
): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizePromptedSpaceGuide(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

type SpaceCreateFlowStepSubmission =
  | { status: "submitted"; step: "name"; value: string }
  | {
      status: "submitted";
      step: "visibility";
      value: SpaceCreateVisibility;
    }
  | { status: "submitted"; step: "guide"; value: string }
  | { status: "submitted"; step: "password"; value: string | undefined }
  | { status: "submitted"; step: "join"; value: boolean };

type SpaceCreateFlowStepPromptResult =
  | SpaceCreateFlowStepSubmission
  | { status: "back" }
  | { status: "cancelled" };

async function promptInteractiveSpaceCreateFlowStep(input: {
  state: Partial<SpaceCreateFlowValues>;
  step: SpaceCreateFlowStep;
}): Promise<SpaceCreateFlowStepPromptResult> {
  const { step } = input;
  if (step === "name") {
    const result = await promptRequiredInteractiveSpaceName();
    return result.status === "submitted"
      ? { status: "submitted", step, value: result.value }
      : result;
  }
  if (step === "guide") {
    const result = await promptInteractiveSpaceGuide();
    return result.status === "submitted"
      ? { status: "submitted", step, value: result.value }
      : result;
  }
  if (step === "visibility") {
    const result = await promptInteractiveSpaceVisibility();
    return result.status === "submitted"
      ? { status: "submitted", step, value: result.value }
      : result;
  }
  if (step === "password") {
    if (!input.state.visibility) {
      throw new Error(
        "Space create password prompt requires a selected visibility."
      );
    }
    const result = await promptInteractiveSpaceCreatePassword(
      input.state.visibility
    );
    return result.status === "submitted"
      ? { status: "submitted", step, value: result.value }
      : result;
  }

  const result = await promptInteractiveSpaceJoinAfterCreate();
  return result.status === "submitted"
    ? { status: "submitted", step, value: result.value }
    : result;
}

function resolveSpaceCreateFlowStepNavigation(input: {
  stepIndex: number;
  result: SpaceCreateFlowStepPromptResult;
}): "submit" | "cancelled" | "back" | number {
  if (input.result.status === "submitted") {
    return "submit";
  }
  if (input.result.status === "cancelled") {
    return "cancelled";
  }
  if (input.stepIndex === 0) {
    return "back";
  }
  return input.stepIndex - 1;
}

function emitCancelledSpaceCreateFlowResult(): SpaceCreateFlowResult {
  cancel("Cancelled.");
  return { status: "cancelled" };
}

function applySpaceCreateFlowSubmission(
  state: Partial<SpaceCreateFlowValues>,
  result: SpaceCreateFlowStepPromptResult
): void {
  if (result.status !== "submitted") {
    return;
  }

  if (result.step === "name") {
    state.name = result.value;
    return;
  }
  if (result.step === "visibility") {
    state.visibility = result.value;
    return;
  }
  if (result.step === "guide") {
    state.guide = normalizePromptedSpaceGuide(result.value);
    return;
  }
  if (result.step === "password") {
    state.password = result.value;
    return;
  }
  state.join = result.value;
}

function buildProvidedSpaceCreateVisibility(value: string | undefined): {
  visibility?: SpaceCreateVisibility;
} {
  const visibility = normalizeSpaceCreateVisibility(value);
  return visibility ? { visibility } : {};
}

function assertProvidedSpaceCreateVisibilityValid(
  value: string | undefined
): void {
  const rawVisibility = String(value ?? "").trim();
  if (rawVisibility.length === 0) {
    return;
  }
  if (normalizeSpaceCreateVisibility(value)) {
    return;
  }
  throw new Error(
    formatOpenMeldCliTextBlock(
      `invalid --visibility value: ${rawVisibility} (use public|private)`
    )
  );
}

function normalizeSpaceCreateVisibility(
  value: string | undefined
): SpaceCreateVisibility | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "public" || normalized === "private") {
    return normalized;
  }
  return null;
}

async function promptRequiredInteractiveSpaceName(): Promise<
  | { status: "submitted"; value: string }
  | { status: "back" }
  | { status: "cancelled" }
> {
  const nameInput = await promptTextEntry({
    message: "Space name",
    placeholder: "e.g. design-review",
    allowBack: true,
    backLabel: "Back",
    validate: (value) =>
      value.trim().length > 0 ? null : "Space name cannot be empty.",
  });
  if (nameInput.status !== "submitted") {
    return nameInput;
  }
  return {
    status: "submitted",
    value: nameInput.value.trim(),
  };
}

async function promptInteractiveSpaceVisibility(): Promise<
  | { status: "submitted"; value: SpaceCreateVisibility }
  | { status: "back" }
  | { status: "cancelled" }
> {
  const action = await select({
    message: "Organization visibility",
    options: [
      {
        value: "private",
        label: "Private to this organization",
      },
      {
        value: "public",
        label: "Visible to the organization directory",
      },
      {
        value: "back",
        label: "Back",
      },
    ],
    initialValue: "private",
  });
  if (isCancel(action)) {
    return { status: "cancelled" };
  }
  if (action === "back") {
    return { status: "back" };
  }
  if (action !== "private" && action !== "public") {
    return { status: "cancelled" };
  }
  return {
    status: "submitted",
    value: action,
  };
}

function promptInteractiveSpaceGuide(): Promise<
  | { status: "submitted"; value: string }
  | { status: "back" }
  | { status: "cancelled" }
> {
  return promptTextEntry({
    message: "Space guide (optional)",
    placeholder: "e.g. Keep it concise, respectful, and actionable.",
    allowBack: true,
    allowEmpty: true,
    backLabel: "Back",
  });
}

async function promptInteractiveSpaceCreatePassword(
  visibility: SpaceCreateVisibility
): Promise<
  | { status: "submitted"; value: string | undefined }
  | { status: "back" }
  | { status: "cancelled" }
> {
  for (;;) {
    const promptConfig = buildCreateSpacePasswordPromptConfig(visibility);
    const action = await select({
      message: promptConfig.message,
      options: [
        {
          value: "set",
          label: promptConfig.setPasswordLabel,
        },
        {
          value: "skip",
          label: promptConfig.skipPasswordLabel,
        },
        {
          value: "back",
          label: "Back",
        },
      ],
    });
    if (isCancel(action)) {
      return { status: "cancelled" };
    }
    if (action === "back") {
      return { status: "back" };
    }
    if (action === "skip") {
      return {
        status: "submitted",
        value: undefined,
      };
    }

    const password = await promptAndConfirmSpacePassword({
      allowBack: true,
      emitCancelMessage: false,
    });
    if (password.status === "cancelled") {
      return password;
    }
    if (password.status === "back") {
      continue;
    }
    return {
      status: "submitted",
      value: password.value,
    };
  }
}

async function promptInteractiveSpaceJoinAfterCreate(): Promise<
  | { status: "submitted"; value: boolean }
  | { status: "back" }
  | { status: "cancelled" }
> {
  const action = await select({
    message: "Join this space now?",
    options: [
      {
        value: "join",
        label: "Yes",
      },
      {
        value: "skip",
        label: "No",
      },
      {
        value: "back",
        label: "Back",
      },
    ],
    initialValue: "join",
  });
  if (isCancel(action)) {
    return { status: "cancelled" };
  }
  if (action === "back") {
    return { status: "back" };
  }
  return {
    status: "submitted",
    value: action === "join",
  };
}

function emitSpaceCreatePasswordOptionalHint(input: {
  presenter: ReturnType<typeof createPresenter>;
  openMeldProfileId: string;
  resolvedView: "human" | "agent";
  providedPassword?: string;
  interactive: boolean;
  visibility: SpaceCreateVisibility;
}): void {
  if (typeof input.providedPassword === "string") {
    return;
  }
  if (input.interactive) {
    return;
  }
  input.presenter.line({
    code: "space.create.password.optional_hint",
    text: buildSpaceCreatePasswordOptionalHintText(input.visibility),
    data: {
      optional: true,
      requirements: {
        minLength: SPACE_PASSWORD_MIN_LENGTH,
        charset: "any",
      },
      command: formatProfileAwareOpenMeldCliCommand(
        "openmeld space create --name <name> --visibility <public|private> --password <value>",
        {
          profileId: input.openMeldProfileId,
          resolvedView: input.resolvedView,
        }
      ),
    },
  });
}

function buildSpaceCreatePasswordOptionalHintText(
  visibility: SpaceCreateVisibility
): string {
  const initialAccessMode = resolveInitialSpaceAccessMode(visibility);
  return (
    `Password is optional. ${resolveSpaceCreatePasswordlessAccessText(initialAccessMode)} To require a password to open and join, use --password <value>. Password rule: ` +
    buildSpacePasswordRequirementsText()
  );
}

export function buildCreateSpacePasswordPromptMessage(
  visibility: SpaceCreateVisibility
): string {
  return buildCreateSpacePasswordPromptConfig(visibility).message;
}

export function buildCreateSpacePasswordPromptConfig(
  visibility: SpaceCreateVisibility
): SpaceCreatePasswordPromptConfig {
  return buildSpaceCreatePasswordPromptConfig({
    accessMode: resolveInitialSpaceAccessMode(visibility),
    minimumLength: SPACE_PASSWORD_MIN_LENGTH,
  });
}

type SpacePasswordPromptResult =
  | { status: "submitted"; value: string }
  | { status: "back" }
  | { status: "cancelled" };

function resolveCancelledSpacePasswordPromptResult(input: {
  allowBack: boolean;
  emitCancelMessage: boolean;
}): SpacePasswordPromptResult {
  if (input.allowBack) {
    return { status: "back" };
  }
  if (input.emitCancelMessage) {
    cancel("Cancelled.");
  }
  return { status: "cancelled" };
}

async function promptConfirmedSpacePassword(input: {
  firstPassword: string;
  allowBack: boolean;
  emitCancelMessage: boolean;
}): Promise<SpacePasswordPromptResult | { status: "retry" }> {
  const confirmPassword = await passwordPrompt({
    message: "Confirm password",
    mask: "•",
    clearOnError: true,
    validate: validateSpacePasswordInput,
  });
  if (isCancel(confirmPassword) || typeof confirmPassword !== "string") {
    return input.allowBack
      ? { status: "retry" }
      : resolveCancelledSpacePasswordPromptResult(input);
  }
  const firstPassword = normalizeSpacePasswordText(input.firstPassword);
  const confirmedPassword = normalizeSpacePasswordText(confirmPassword);
  if (firstPassword !== confirmedPassword) {
    process.stderr.write("Passwords do not match. Try again.\n");
    return { status: "retry" };
  }
  return {
    status: "submitted",
    value: firstPassword,
  };
}

export async function promptAndConfirmSpacePassword(input?: {
  allowBack?: boolean;
  emitCancelMessage?: boolean;
}): Promise<SpacePasswordPromptResult> {
  const allowBack = input?.allowBack === true;
  const emitCancelMessage = input?.emitCancelMessage !== false;

  for (;;) {
    const firstPassword = await passwordPrompt({
      message: "Create password",
      mask: "•",
      clearOnError: true,
      validate: validateSpacePasswordInput,
    });
    if (isCancel(firstPassword) || typeof firstPassword !== "string") {
      return resolveCancelledSpacePasswordPromptResult({
        allowBack,
        emitCancelMessage,
      });
    }

    const confirmedPassword = await promptConfirmedSpacePassword({
      firstPassword,
      allowBack,
      emitCancelMessage,
    });
    if (confirmedPassword.status === "retry") {
      continue;
    }
    return confirmedPassword;
  }
}

export async function runSpaceList(input: {
  profile?: string;
  baseUrl?: string;
  limit: number;
  json?: boolean;
  view?: string;
  entryChecksHandled?: boolean;
}) {
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage(
      "viewing your spaces"
    ),
    entryChecksHandled: input.entryChecksHandled,
  });
  if (context.status === "cancelled") {
    return;
  }
  const { runtime, presenter, interactive, baseUrl } = context;
  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive,
  });
  const limit = Number.isFinite(input.limit) ? Math.max(1, input.limit) : 20;
  const scope = resolveSpaceListAccountIndexScope({
    explicitProfile: input.profile,
    openMeldProfile,
  });
  const visibilityScope: KnownSpaceVisibilityScope =
    scope === "account" ? "owner" : "profile";
  const index = await listAccountSpacesForCliList({
    openMeldProfile,
    baseUrl,
    limit,
    scope,
    showLoading:
      interactive && runtime.resolvedView === "human" && input.json !== true,
  });
  const items = toKnownSpaceOptionsFromAccountIndex(index, baseUrl);

  if (input.json === true) {
    presenter.data({
      code: "space.list",
      payload: {
        visibilityScope,
        proof: buildSpaceListProofPayload(),
        total: items.length,
        limit,
        deletedNotices: [],
        spaces: items.map((item, index) =>
          buildKnownSpaceData(item, index + 1)
        ),
      },
    });
    return;
  }

  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "space.list.proof",
      payload: buildSpaceListProofPayload(),
    });
  }

  if (items.length === 0) {
    presenter.line({
      code: "space.list.empty",
      text: formatInlineOpenMeldCliCommands(
        resolveSpaceListEmptyMessage(visibilityScope)
      ),
    });
    return;
  }

  presenter.line({
    code: "space.list.scope",
    text: resolveSpaceVisibilitySummary({
      visibilityScope,
      resolvedView: runtime.resolvedView,
    }),
  });

  for (const [index, item] of items.entries()) {
    presenter.line({
      code: "space.list.item",
      text: formatKnownSpaceListLine({
        index: index + 1,
        space: item,
        resolvedView: runtime.resolvedView,
        currentProfileId: openMeldProfile.openMeldProfileId,
        currentProfileName: openMeldProfile.profileName,
        currentOwnerUserId: openMeldProfile.ownerUserId,
        command: "join",
      }),
      data: buildKnownSpaceData(item, index + 1),
    });
  }
}

function resolveSpaceListAccountIndexScope(input: {
  explicitProfile?: string;
  openMeldProfile: OpenMeldProfile;
}): AccountSpaceIndexQuery["scope"] {
  if (normalizeOptionalString(input.explicitProfile)) {
    return "profile";
  }
  if (
    input.openMeldProfile.profileKind === "human" &&
    input.openMeldProfile.isDefault === true
  ) {
    return "account";
  }
  return "profile";
}

async function listAccountSpacesForCliList(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  limit: number;
  scope: AccountSpaceIndexQuery["scope"];
  showLoading: boolean;
}) {
  const loadingSpinner = createDelayedSpinner({
    enabled: input.showLoading,
    message: SPACE_LOADING_SPINNER_MESSAGE,
  });
  loadingSpinner.start();

  try {
    const result = await listAccountSpaceIndex({
      baseUrl: input.baseUrl,
      requestContext: buildOpenMeldRequestContextFromProfile({
        openMeldProfile: input.openMeldProfile,
      }),
      limit: input.limit,
      scope: input.scope,
      selectedProfileId: input.openMeldProfile.openMeldProfileId,
    });
    loadingSpinner.complete();
    return result;
  } catch (error) {
    loadingSpinner.fail();
    throw error;
  }
}

function toKnownSpaceOptionsFromAccountIndex(
  index: Awaited<ReturnType<typeof listAccountSpaceIndex>>,
  baseUrl: string
): KnownSpaceOption[] {
  return [...index.pinnedItems, ...index.spaceItems].map((item) =>
    toKnownSpaceOptionFromAccountIndex(item, baseUrl)
  );
}

function buildSpaceListProofPayload() {
  return {
    spaceVisible: true,
    conversationReadable: "not_checked",
    wakeExecutionSucceeded: "not_checked",
    proves:
      "This command proves known Space records are visible to the acting profile.",
    doesNotProve:
      "It does not prove conversation history is readable, members are available for Wake, or a Wake produced a visible reply.",
    nextChecks: [
      "<OPENMELD_CLI> space history <space-id> --kind text --brief --limit 20 --view agent",
      "<OPENMELD_CLI> space status <space-id> --json --view agent",
    ],
  };
}

export async function runSpaceAddMembers(input: {
  mode?: SpaceProfileAddMode;
  profile?: string;
  baseUrl?: string;
  space?: string;
  password?: string;
  members?: string[];
  all?: boolean;
  details?: boolean;
  view?: string;
  entryChecksHandled?: boolean;
  allowBackToCaller?: boolean;
  allowCurrentProfileMember?: boolean;
  suppressResultOutput?: boolean;
  membershipSource?: "account" | "organization_directory";
}): Promise<SpaceCommandNavigationStatus> {
  const hasExplicitBaseUrlInput = String(input.baseUrl ?? "").trim().length > 0;
  const explicitMemberIds = (input.members ?? [])
    .map((memberId) => normalizeOptionalString(memberId))
    .filter((memberId): memberId is string => Boolean(memberId));
  if (input.all === true || explicitMemberIds.length > 0) {
    validateSpaceMemberSelectionInput({
      all: input.all === true,
      command: resolveSpaceAddMembersSelectionCommand(input.mode ?? "profiles"),
      explicitMemberIds,
    });
  }
  const currentProfileId =
    normalizeOptionalString(input.profile) ??
    getCurrentCommandCheckState().selectedProfile?.profile?.openMeldProfileId ??
    null;
  assertSpaceAddMembersCurrentProfileNotSelected({
    allowCurrentProfileMember: input.allowCurrentProfileMember === true,
    currentProfileId,
    explicitMemberIds,
  });
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage(
      "adding members to a space"
    ),
    checkGatewayMismatch: hasExplicitBaseUrlInput,
    entryChecksHandled: input.entryChecksHandled,
  });
  if (context.status === "cancelled") {
    return "cancelled";
  }
  const { runtime, interactive, presenter, baseUrl } = context;
  let authenticatedGatewayUrl = context.authenticatedGatewayUrl;
  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive,
  });

  if (shouldRunSpaceAddMembersDiagnosticPreflight(input, explicitMemberIds)) {
    await emitSpaceCommandPreflight({
      presenter,
      command: "add_members",
      profile: openMeldProfile,
      baseUrl,
      resolvedView: runtime.resolvedView,
    });
  }

  try {
    for (;;) {
      const target = await resolveSpaceAddMembersTarget({
        openMeldProfile,
        baseUrl,
        mode: input.mode ?? "profiles",
        space: input.space,
        allowPrompt: interactive,
        presenter,
        resolvedView: runtime.resolvedView,
        allowBack: input.allowBackToCaller === true,
      });
      if (target.status === "cancelled") {
        return "cancelled";
      }
      if (target.status === "back") {
        return "back";
      }
      const outcome = await runSpaceAddMembersForTarget({
        runtime,
        presenter,
        openMeldProfile,
        target: target.target,
        baseUrl,
        hasExplicitBaseUrlInput,
        authenticatedGatewayUrl,
        password: input.password,
        mode: input.mode ?? "profiles",
        explicitMembers: input.members,
        selectAll: input.all === true,
        details: input.details === true,
        allowPrompt: interactive,
        allowBackToCaller: input.allowBackToCaller === true,
        allowCurrentProfileMember: input.allowCurrentProfileMember === true,
        suppressResultOutput: input.suppressResultOutput === true,
        membershipSource: input.membershipSource ?? "account",
        view: input.view,
      });
      if (outcome.status === "repeat_target") {
        authenticatedGatewayUrl = outcome.authenticatedGatewayUrl;
        continue;
      }
      return outcome.status;
    }
  } catch (error) {
    emitSpaceFailureNextStep({
      presenter,
      command: "add_members",
      error,
      profileId: openMeldProfile.openMeldProfileId,
      resolvedView: runtime.resolvedView,
    });
    throw error;
  }
}

function assertSpaceAddMembersCurrentProfileNotSelected(input: {
  allowCurrentProfileMember: boolean;
  currentProfileId: string | null;
  explicitMemberIds: readonly string[];
}): void {
  if (
    input.currentProfileId &&
    input.explicitMemberIds.includes(input.currentProfileId) &&
    !input.allowCurrentProfileMember
  ) {
    throw createSpaceAddMembersCurrentProfileGuideError({
      profileId: input.currentProfileId,
    });
  }
}

export async function runSpaceRemoveMembers(input: {
  profile?: string;
  baseUrl?: string;
  space?: string;
  password?: string;
  members?: string[];
  all?: boolean;
  view?: string;
  entryChecksHandled?: boolean;
  allowBackToCaller?: boolean;
}): Promise<SpaceCommandNavigationStatus> {
  const hasExplicitBaseUrlInput = String(input.baseUrl ?? "").trim().length > 0;
  const explicitMemberIds = (input.members ?? [])
    .map((memberId) => normalizeOptionalString(memberId))
    .filter((memberId): memberId is string => Boolean(memberId));
  const currentProfileId =
    normalizeOptionalString(input.profile) ??
    getCurrentCommandCheckState().selectedProfile?.profile?.openMeldProfileId ??
    null;
  if (currentProfileId && explicitMemberIds.includes(currentProfileId)) {
    throw createSpaceRemoveMembersCurrentProfileGuideError({
      profileId: currentProfileId,
    });
  }
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage(
      "removing members from a space"
    ),
    checkGatewayMismatch: hasExplicitBaseUrlInput,
    entryChecksHandled: input.entryChecksHandled,
  });
  if (context.status === "cancelled") {
    return "cancelled";
  }
  const { runtime, interactive, presenter, baseUrl } = context;
  let authenticatedGatewayUrl = context.authenticatedGatewayUrl;
  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive,
  });

  await emitSpaceCommandPreflight({
    presenter,
    command: "remove_members",
    profile: openMeldProfile,
    baseUrl,
    resolvedView: runtime.resolvedView,
  });

  try {
    for (;;) {
      const target = await resolveSpaceRemoveMembersTarget({
        openMeldProfile,
        baseUrl,
        space: input.space,
        allowPrompt: interactive,
        presenter,
        resolvedView: runtime.resolvedView,
        allowBack: input.allowBackToCaller === true,
      });
      if (target.status === "cancelled") {
        return "cancelled";
      }
      if (target.status === "back") {
        return "back";
      }
      const outcome = await runSpaceRemoveMembersForTarget({
        runtime,
        presenter,
        openMeldProfile,
        target: target.target,
        baseUrl,
        hasExplicitBaseUrlInput,
        authenticatedGatewayUrl,
        password: input.password,
        explicitMembers: input.members,
        selectAll: input.all === true,
        allowPrompt: interactive,
        allowBackToCaller: input.allowBackToCaller === true,
      });
      if (outcome.status === "repeat_target") {
        authenticatedGatewayUrl = outcome.authenticatedGatewayUrl;
        continue;
      }
      return outcome.status;
    }
  } catch (error) {
    emitSpaceFailureNextStep({
      presenter,
      command: "remove_members",
      error,
      profileId: openMeldProfile.openMeldProfileId,
      resolvedView: runtime.resolvedView,
    });
    throw error;
  }
}

export async function runSpaceLeave(input: {
  profile?: string;
  baseUrl?: string;
  space?: string;
  password?: string;
  view?: string;
  entryChecksHandled?: boolean;
  allowBackToCaller?: boolean;
}): Promise<SpaceCommandNavigationStatus> {
  const hasExplicitBaseUrlInput = String(input.baseUrl ?? "").trim().length > 0;
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage("leaving a space"),
    checkGatewayMismatch: hasExplicitBaseUrlInput,
    entryChecksHandled: input.entryChecksHandled,
  });
  if (context.status === "cancelled") {
    return "cancelled";
  }
  const { runtime, interactive, presenter, baseUrl } = context;
  let authenticatedGatewayUrl = context.authenticatedGatewayUrl;
  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive,
  });

  await emitSpaceCommandPreflight({
    presenter,
    command: "leave",
    profile: openMeldProfile,
    baseUrl,
    resolvedView: runtime.resolvedView,
  });

  try {
    for (;;) {
      const target = await resolveSpaceLeaveTarget({
        openMeldProfile,
        baseUrl,
        space: input.space,
        allowPrompt: interactive,
        presenter,
        resolvedView: runtime.resolvedView,
        allowBack: input.allowBackToCaller === true,
      });
      if (target.status === "cancelled") {
        return "cancelled";
      }
      if (target.status === "back") {
        return "back";
      }
      const outcome = await runSpaceLeaveForTarget({
        runtime,
        presenter,
        openMeldProfile,
        target: target.target,
        baseUrl,
        hasExplicitBaseUrlInput,
        authenticatedGatewayUrl,
        password: input.password,
        allowPrompt: interactive,
        allowBackToCaller: input.allowBackToCaller === true,
      });
      if (outcome.status === "repeat_target") {
        authenticatedGatewayUrl = outcome.authenticatedGatewayUrl;
        continue;
      }
      return outcome.status;
    }
  } catch (error) {
    emitSpaceFailureNextStep({
      presenter,
      command: "leave",
      error,
      profileId: openMeldProfile.openMeldProfileId,
      resolvedView: runtime.resolvedView,
    });
    throw error;
  }
}

function shouldRunSpaceAddMembersDiagnosticPreflight(
  input: {
    all?: boolean;
    details?: boolean;
  },
  explicitMemberIds: readonly string[]
): boolean {
  return (
    input.details === true ||
    input.all === true ||
    explicitMemberIds.length === 0
  );
}

async function runSpaceAddMembersForTarget(input: {
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  presenter: ReturnType<typeof createPresenter>;
  openMeldProfile: OpenMeldProfile;
  target: SpaceSelectionTarget;
  baseUrl: string;
  hasExplicitBaseUrlInput: boolean;
  authenticatedGatewayUrl: string | null;
  password?: string;
  mode: SpaceProfileAddMode;
  explicitMembers?: string[];
  selectAll: boolean;
  details: boolean;
  allowPrompt: boolean;
  allowBackToCaller: boolean;
  allowCurrentProfileMember: boolean;
  suppressResultOutput: boolean;
  membershipSource: "account" | "organization_directory";
  view?: string;
}): Promise<
  | {
      status: SpaceCommandNavigationStatus;
    }
  | {
      status: "repeat_target";
      authenticatedGatewayUrl: string | null;
    }
> {
  // OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT space-membership
  // Membership connects the default human profile and user-confirmed Agent
  // Profiles to a Space. Membership is separate from Wake availability.
  const targetBaseUrl = input.hasExplicitBaseUrlInput
    ? input.baseUrl
    : (input.target.baseUrl ?? input.baseUrl);
  const authenticatedGatewayUrl =
    await ensureSpaceCommandGatewayAuthenticationOrCancel({
      runtime: input.runtime,
      gatewayUrl: targetBaseUrl,
      promptMessage: buildCommandAuthenticationPromptMessage(
        "adding members to a space"
      ),
      allowPrompt: input.allowPrompt,
      authenticatedGatewayUrl: input.authenticatedGatewayUrl,
    });
  if (!authenticatedGatewayUrl) {
    return { status: "cancelled" };
  }

  const addMembersProgress = {
    presenter: input.presenter,
    resolvedView: input.runtime.resolvedView,
    spaceId: input.target.space,
    command: resolveSpaceAddMembersSelectionCommand(input.mode),
    profileAddMode: input.mode,
  };
  const explicitMemberIds = normalizeRequestedMemberIds(input.explicitMembers);
  const progress =
    input.details || explicitMemberIds.length === 0
      ? addMembersProgress
      : undefined;
  const includeSelectedLocalParticipation =
    progress !== undefined || explicitMemberIds.length === 0;
  const candidates = await resolveSpaceMemberCandidatesForAdd({
    currentProfile: input.openMeldProfile,
    currentOwnerUserId: input.openMeldProfile.ownerUserId,
    space: input.target.space,
    baseUrl: targetBaseUrl,
    password: input.password,
    explicitMemberIds,
    progress,
    mode: input.mode,
    includeLocalParticipation: includeSelectedLocalParticipation,
    allowCurrentProfileMember: input.allowCurrentProfileMember,
    membershipSource: input.membershipSource,
  });
  if (candidates.length === 0 && explicitMemberIds.length === 0) {
    input.presenter.line({
      code: "space.add_members.no_candidates",
      text: "No additional profiles are available to add.",
      data: { spaceId: input.target.space },
    });
    return { status: "completed" };
  }

  const selectedProfileIds = await resolveSpaceAddMemberSelection({
    space: input.target.space,
    candidates,
    currentProfileId: input.openMeldProfile.openMeldProfileId,
    explicitMembers: input.explicitMembers,
    selectAll: input.selectAll,
    mode: input.mode,
    allowPrompt: input.allowPrompt,
    resolvedView: input.runtime.resolvedView,
    presenter: input.presenter,
    allowBack: input.allowBackToCaller,
    allowCurrentProfileMember: input.allowCurrentProfileMember,
    emitCancelMessage: !input.allowBackToCaller,
  });
  if (selectedProfileIds === null) {
    return input.allowBackToCaller
      ? {
          status: "repeat_target",
          authenticatedGatewayUrl,
        }
      : { status: "cancelled" };
  }
  if (selectedProfileIds.length === 0) {
    return { status: "completed" };
  }

  const selectedCandidates = resolveSelectedSpaceMemberCandidates({
    candidates,
    selectedProfileIds,
  });
  if (selectedCandidates.length === 0) {
    return { status: "completed" };
  }

  const servicePreparationResult =
    await prepareSpaceAddMembersLocalParticipationIfRequested({
      openMeldProfile: input.openMeldProfile,
      candidates: selectedCandidates,
      enabled: includeSelectedLocalParticipation,
      progress,
      presenter: input.presenter,
      resolvedView: input.runtime.resolvedView,
      allowPrompt: input.allowPrompt,
      spaceId: input.target.space,
      view: input.view,
    });
  if (servicePreparationResult.status === "cancelled") {
    return input.allowBackToCaller
      ? {
          status: "repeat_target",
          authenticatedGatewayUrl,
        }
      : { status: "cancelled" };
  }
  const preparedCandidates = servicePreparationResult.candidates;

  emitSpaceAddMembersProgressIfRequested(progress, {
    stage: "add_members",
    phase: "write_membership",
    summary: "Adding selected profiles to the Space.",
    profileIds: preparedCandidates.map((candidate) => candidate.profileId),
  });
  const result = await applySpaceAddMembers({
    actorProfile: input.openMeldProfile,
    candidates: preparedCandidates,
    space: input.target.space,
    spaceName: input.target.name,
    baseUrl: targetBaseUrl,
    password: input.password,
    membershipSource: input.membershipSource,
  });

  await waitForAddedMembersWakeProjection({
    actorProfile: input.openMeldProfile,
    baseUrl: targetBaseUrl,
    password: input.password,
    progress,
    result,
    space: input.target.space,
  });

  emitSpaceAddMembersProgressIfRequested(progress, {
    stage: "record_join_notices",
    phase: "write_join_notices",
    summary: "Recording visible join notices for newly added members.",
    profileIds: result.added.map((candidate) => candidate.profileId),
  });
  const joinNoticeSummary = await persistSpaceAddMembersJoinNotices({
    actorProfile: input.openMeldProfile,
    baseUrl: targetBaseUrl,
    space: input.target.space,
    password: input.password,
    addedMembers: result.added,
  });
  emitSpaceAddMembersResultIfRequested({
    suppressResultOutput: input.suppressResultOutput,
    mode: input.mode,
    presenter: input.presenter,
    resolvedView: input.runtime.resolvedView,
    space: input.target.space,
    selectedCount: preparedCandidates.length,
    result,
    joinNoticeSummary,
  });

  if (result.failed.length > 0 && result.added.length === 0) {
    throw new Error(
      `failed to add members for space ${input.target.space}: ${toErrorMessage(result.failed[0]?.error)}`
    );
  }

  const joinNow = await resolveJoinAfterCreate(
    undefined,
    input.allowPrompt && input.runtime.resolvedView === "human"
  );
  if (!joinNow) {
    return { status: "completed" };
  }

  await runSpaceJoin({
    profile: input.openMeldProfile.openMeldProfileId,
    baseUrl: targetBaseUrl,
    space: input.target.space,
    password: input.password,
    output: "text",
    view: input.view,
    skipBringProfilesPrompt: true,
    entryChecksHandled: true,
  });
  return { status: "completed" };
}

async function prepareSpaceAddMembersLocalParticipationIfRequested(input: {
  openMeldProfile: OpenMeldProfile;
  candidates: SpaceMemberCandidate[];
  enabled: boolean;
  progress?: SpaceAddMembersProgressContext;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  allowPrompt: boolean;
  spaceId: string;
  view?: string;
}): Promise<
  | {
      status: "continue";
      candidates: SpaceMemberCandidate[];
    }
  | {
      status: "cancelled";
    }
> {
  if (!input.enabled) {
    return {
      status: "continue",
      candidates: input.candidates,
    };
  }

  const localCandidates = input.candidates.filter(
    (candidate) => candidate.openMeldProfile !== undefined
  );
  if (localCandidates.length === 0) {
    return {
      status: "continue",
      candidates: input.candidates,
    };
  }

  emitSpaceAddMembersProgressIfRequested(input.progress, {
    stage: "check_local_wake_readiness",
    phase: "start",
    summary:
      "Checking whether selected agent profiles can handle work from this computer. Members can still be added if local setup needs attention.",
    profileIds: localCandidates.map((candidate) => candidate.profileId),
  });
  const localResult = await ensureSpaceMemberCandidatesLocalParticipationReady({
    openMeldProfile: input.openMeldProfile,
    candidates: localCandidates,
    progress: input.progress,
    presenter: input.presenter,
    resolvedView: input.resolvedView,
    allowPrompt: input.allowPrompt,
    spaceId: input.spaceId,
    view: input.view,
  });
  if (localResult.status === "cancelled") {
    return localResult;
  }
  const preparedLocalCandidateById = new Map(
    localResult.candidates.map((candidate) => [candidate.profileId, candidate])
  );
  return {
    status: "continue",
    candidates: input.candidates.map(
      (candidate) =>
        preparedLocalCandidateById.get(candidate.profileId) ?? candidate
    ),
  };
}

type SpaceAddMembersProgressContext = {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  spaceId: string;
  command: "add-agents" | "add-human-profiles" | "add-members";
  profileAddMode: SpaceProfileAddMode;
};

function emitSpaceAddMembersProgressIfRequested(
  progress: SpaceAddMembersProgressContext | undefined,
  input: {
    stage: SpaceAddMembersProgressStage;
    phase: string;
    summary: string;
    profileId?: string;
    profileIds?: readonly string[];
  }
): void {
  if (!progress) {
    return;
  }
  emitAgentSpaceAddMembersProgress({
    ...progress,
    ...input,
  });
}

function emitAgentSpaceAddMembersProgress(
  input: SpaceAddMembersProgressContext & {
    stage: SpaceAddMembersProgressStage;
    phase: string;
    summary: string;
    profileId?: string;
    profileIds?: readonly string[];
  }
): void {
  if (input.resolvedView !== "agent") {
    return;
  }
  const phaseContract = resolveSpaceAddMembersProgressPhase({
    stage: input.stage,
    phase: input.phase,
  });
  input.presenter.line({
    code: "space.add_members.progress",
    text: `${input.stage}/${input.phase}: ${input.summary}`,
    data: {
      stage: input.stage,
      phase: input.phase,
      spaceId: input.spaceId,
      command: input.command,
      profileAddMode: input.profileAddMode,
      owner: phaseContract.owner,
      waitingFor: phaseContract.waitingFor,
      factSource: phaseContract.factSource,
      doesNotMeanReady: true,
      ...(input.profileId ? { profileId: input.profileId } : {}),
      ...(input.profileIds ? { profileIds: input.profileIds } : {}),
    },
  });
}

async function runSpaceAddMembersProgressHeartbeat<T>(
  input: SpaceAddMembersProgressContext & {
    stage: SpaceAddMembersProgressStage;
    phase: string;
    summary: string;
    profileId?: string;
    profileIds?: readonly string[];
    operation: () => Promise<T>;
  }
): Promise<T> {
  if (input.resolvedView !== "agent") {
    return await input.operation();
  }

  const timer = setInterval(() => {
    emitAgentSpaceAddMembersProgress(input);
  }, SPACE_ADD_MEMBERS_PROGRESS_HEARTBEAT_MS);
  (timer as { unref?: () => void }).unref?.();
  try {
    return await input.operation();
  } finally {
    clearInterval(timer);
  }
}

function buildSpaceAddMembersLocalWakePlanSummary(
  plan: ActionParticipationPlan
): string {
  const selectedAgentCount = plan.assessments.filter(
    (assessment) => assessment.profileKind === "agent"
  ).length;
  if (selectedAgentCount === 0) {
    return "No selected members need local Wake setup on this computer.";
  }

  const counts = new Map<string, number>();
  for (const assessment of plan.assessments) {
    if (assessment.profileKind !== "agent") {
      continue;
    }
    counts.set(
      assessment.localParticipationState,
      (counts.get(assessment.localParticipationState) ?? 0) + 1
    );
  }
  const parts = [
    formatLocalWakePlanCount(
      counts.get("ready") ?? 0,
      "can handle work from this device"
    ),
    formatLocalWakePlanCount(
      counts.get("needs_agent_prepare") ?? 0,
      "need agent preparation"
    ),
    formatLocalWakePlanCount(
      counts.get("needs_openmeld_service") ?? 0,
      "need OpenMeld Service"
    ),
    formatLocalWakePlanCount(
      counts.get("membership_only") ?? 0,
      "will be added as members only"
    ),
    formatLocalWakePlanCount(
      counts.get("not_needed") ?? 0,
      "do not need local agent setup"
    ),
  ].filter((part): part is string => Boolean(part));

  return `Local agent plan: ${parts.join(", ")}. Adding members is separate from local agent participation on this computer.`;
}

function formatLocalWakePlanCount(count: number, label: string): string | null {
  return count > 0 ? `${String(count)} ${label}` : null;
}

async function runSpaceRemoveMembersForTarget(input: {
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  presenter: ReturnType<typeof createPresenter>;
  openMeldProfile: OpenMeldProfile;
  target: SpaceSelectionTarget;
  baseUrl: string;
  hasExplicitBaseUrlInput: boolean;
  authenticatedGatewayUrl: string | null;
  password?: string;
  explicitMembers?: string[];
  selectAll: boolean;
  allowPrompt: boolean;
  allowBackToCaller: boolean;
}): Promise<
  | {
      status: SpaceCommandNavigationStatus;
    }
  | {
      status: "repeat_target";
      authenticatedGatewayUrl: string | null;
    }
> {
  const targetBaseUrl = input.hasExplicitBaseUrlInput
    ? input.baseUrl
    : (input.target.baseUrl ?? input.baseUrl);
  const authenticatedGatewayUrl =
    await ensureSpaceCommandGatewayAuthenticationOrCancel({
      runtime: input.runtime,
      gatewayUrl: targetBaseUrl,
      promptMessage: buildCommandAuthenticationPromptMessage(
        "removing members from a space"
      ),
      allowPrompt: input.allowPrompt,
      authenticatedGatewayUrl: input.authenticatedGatewayUrl,
    });
  if (!authenticatedGatewayUrl) {
    return { status: "cancelled" };
  }

  const candidates = await resolveSpaceMemberCandidatesForRemove({
    currentProfile: input.openMeldProfile,
    currentOwnerUserId: input.openMeldProfile.ownerUserId,
    space: input.target.space,
    baseUrl: targetBaseUrl,
    password: input.password,
  });
  if (candidates.activeMembers.length === 0 && !input.explicitMembers?.length) {
    input.presenter.line({
      code: "space.remove_members.no_candidates",
      text: "No removable members are available in this space.",
      data: { spaceId: input.target.space },
    });
    return { status: "completed" };
  }

  const selectedCandidates = await resolveSpaceRemoveMemberSelection({
    space: input.target.space,
    candidates,
    currentProfileId: input.openMeldProfile.openMeldProfileId,
    explicitMembers: input.explicitMembers,
    selectAll: input.selectAll,
    allowPrompt: input.allowPrompt,
    resolvedView: input.runtime.resolvedView,
    presenter: input.presenter,
    allowBack: input.allowBackToCaller,
    emitCancelMessage: !input.allowBackToCaller,
  });
  if (selectedCandidates === null) {
    return input.allowBackToCaller
      ? {
          status: "repeat_target",
          authenticatedGatewayUrl,
        }
      : { status: "cancelled" };
  }
  if (selectedCandidates.length === 0) {
    return { status: "completed" };
  }

  const result = await applySpaceRemoveMembers({
    actorProfile: input.openMeldProfile,
    candidates: selectedCandidates,
    space: input.target.space,
    baseUrl: targetBaseUrl,
    password: input.password,
  });
  const removeNoticeSummary = await persistSpaceRemoveMemberNotices({
    actorProfile: input.openMeldProfile,
    baseUrl: targetBaseUrl,
    space: input.target.space,
    password: input.password,
    removedMembers: result.removed,
  });
  emitSpaceRemoveMembersResult({
    presenter: input.presenter,
    resolvedView: input.runtime.resolvedView,
    space: input.target.space,
    selectedCount: selectedCandidates.length,
    result,
    removeNoticeSummary,
  });

  if (result.failed.length > 0 && result.removed.length === 0) {
    throw new Error(
      `failed to remove members for space ${input.target.space}: ${toErrorMessage(result.failed[0]?.error)}`
    );
  }

  return { status: "completed" };
}

async function runSpaceLeaveForTarget(input: {
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  presenter: ReturnType<typeof createPresenter>;
  openMeldProfile: OpenMeldProfile;
  target: SpaceSelectionTarget;
  baseUrl: string;
  hasExplicitBaseUrlInput: boolean;
  authenticatedGatewayUrl: string | null;
  password?: string;
  allowPrompt: boolean;
  allowBackToCaller: boolean;
}): Promise<
  | {
      status: SpaceCommandNavigationStatus;
    }
  | {
      status: "repeat_target";
      authenticatedGatewayUrl: string | null;
    }
> {
  const targetBaseUrl = input.hasExplicitBaseUrlInput
    ? input.baseUrl
    : (input.target.baseUrl ?? input.baseUrl);
  const authenticatedGatewayUrl =
    await ensureSpaceCommandGatewayAuthenticationOrCancel({
      runtime: input.runtime,
      gatewayUrl: targetBaseUrl,
      promptMessage: buildCommandAuthenticationPromptMessage("leaving a space"),
      allowPrompt: input.allowPrompt,
      authenticatedGatewayUrl: input.authenticatedGatewayUrl,
    });
  if (!authenticatedGatewayUrl) {
    return { status: "cancelled" };
  }

  const confirmed = await confirmSpaceLeave({
    target: input.target,
    allowPrompt: input.allowPrompt,
    resolvedView: input.runtime.resolvedView,
  });
  if (confirmed === "cancelled") {
    return { status: "cancelled" };
  }
  if (confirmed === "back") {
    return input.allowBackToCaller
      ? {
          status: "repeat_target",
          authenticatedGatewayUrl,
        }
      : { status: "cancelled" };
  }

  const result = await applySpaceLeave({
    actorProfile: input.openMeldProfile,
    space: input.target.space,
    baseUrl: targetBaseUrl,
    password: input.password,
  }).catch((error) => {
    throw mapSpaceLeaveFailureToGuideError({
      error,
      spaceId: input.target.space,
    });
  });
  emitSpaceLeaveResult({
    presenter: input.presenter,
    resolvedView: input.runtime.resolvedView,
    space: input.target.space,
    result,
  });
  return { status: "completed" };
}

function resolveSelectedSpaceMemberCandidates(input: {
  candidates: SpaceMemberCandidate[];
  selectedProfileIds: string[];
}): SpaceMemberCandidate[] {
  return input.selectedProfileIds
    .map((profileId) =>
      input.candidates.find((candidate) => candidate.profileId === profileId)
    )
    .filter((candidate): candidate is SpaceMemberCandidate =>
      Boolean(candidate)
    );
}

async function ensureSpaceMemberCandidatesLocalParticipationReady(input: {
  openMeldProfile: OpenMeldProfile;
  candidates: SpaceMemberCandidate[];
  gatewayUrl?: string;
  progress?: SpaceAddMembersProgressContext;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  allowPrompt: boolean;
  spaceId: string;
  view?: string;
}): Promise<
  | {
      status: "continue";
      candidates: SpaceMemberCandidate[];
    }
  | {
      status: "cancelled";
    }
> {
  let preparedCandidates = await refreshSpaceMemberCandidatesLocalReadiness(
    input.candidates,
    input.progress
  );
  const localDemand =
    input.resolvedView === "human"
      ? await resolveLocalServiceDemand({
          ownerUserId: input.openMeldProfile.ownerUserId,
        }).catch(() => null)
      : null;
  while (true) {
    const participationPlan = planActionParticipation({
      intent: "space_add_members",
      candidates: preparedCandidates.map(
        toActionParticipationCandidateFromSpaceMemberCandidate
      ),
    });
    if (input.progress) {
      emitAgentSpaceAddMembersProgress({
        ...input.progress,
        stage: "plan_local_wake_participation",
        phase: "plan",
        summary: buildSpaceAddMembersLocalWakePlanSummary(participationPlan),
        profileIds: preparedCandidates.map((candidate) => candidate.profileId),
      });
    }
    const orchestratorResult = await runLocalParticipationOrchestrator({
      intent: "space_add_members",
      plan: participationPlan,
      presenter: input.presenter,
      resolvedView: input.resolvedView,
      allowPrompt: input.allowPrompt,
      gatewayUrl: input.gatewayUrl,
      localDemand,
      forceServicePrompt: participationPlan.explicitLocalAgentCount > 0,
      profilesToPrepare: preparedCandidates
        .filter((candidate) =>
          participationPlan.assessments.some(
            (assessment) =>
              assessment.profileId === candidate.profileId &&
              assessment.localParticipationState === "needs_agent_prepare"
          )
        )
        .map((candidate) => candidate.openMeldProfile)
        .filter((profile): profile is OpenMeldProfile => Boolean(profile)),
      view: input.view,
    });
    if (orchestratorResult.status === "cancelled") {
      return { status: "cancelled" };
    }
    if (orchestratorResult.status !== "recheck_required") {
      break;
    }
    preparedCandidates = await refreshSpaceMemberCandidatesLocalReadiness(
      preparedCandidates,
      input.progress
    );
  }

  if (input.progress) {
    emitAgentSpaceAddMembersProgress({
      ...input.progress,
      stage: "confirm_local_wake_bindings",
      phase: "start",
      summary:
        "Confirming available local agent profiles have Wake bindings before adding them.",
      profileIds: preparedCandidates.map((candidate) => candidate.profileId),
    });
  }
  preparedCandidates = await ensureFormalBindingsForReadySpaceMemberCandidates(
    preparedCandidates,
    input.progress
  );

  emitSpaceMemberJoinOnlyWarnings({
    candidates: preparedCandidates,
    presenter: input.presenter,
    resolvedView: input.resolvedView,
  });

  const finalPlan = planActionParticipation({
    intent: "space_add_members",
    candidates: preparedCandidates.map(
      toActionParticipationCandidateFromSpaceMemberCandidate
    ),
  });
  if (finalPlan.shouldOfferServiceGate) {
    input.presenter.line({
      code:
        input.resolvedView === "human" && input.allowPrompt
          ? "space.add_members.service.declined"
          : "space.add_members.service.deferred",
      text: formatInlineOpenMeldCliCommands(
        "OpenMeld will add these profiles to the Space. Local agent participation can be checked separately with `openmeld service status`."
      ),
    });
  }
  return {
    status: "continue",
    candidates: preparedCandidates,
  };
}

async function ensureFormalBindingsForReadySpaceMemberCandidates(
  candidates: SpaceMemberCandidate[],
  progress?: SpaceAddMembersProgressContext
): Promise<SpaceMemberCandidate[]> {
  const nextCandidates: SpaceMemberCandidate[] = [];
  for (const candidate of candidates) {
    if (
      !isSpaceMemberCandidateBackgroundReplyReady(candidate) ||
      candidate.openMeldProfile?.profileKind !== "agent"
    ) {
      nextCandidates.push(candidate);
      continue;
    }

    // This same add-members operation already read Core's current primary
    // Binding verdict. Do not submit the same runtime evidence and Binding again.
    if (candidate.localParticipationBindingConfirmed === true) {
      nextCandidates.push(candidate);
      continue;
    }

    const candidateOpenMeldProfile = candidate.openMeldProfile;
    if (progress) {
      emitAgentSpaceAddMembersProgress({
        ...progress,
        stage: "confirm_local_wake_bindings",
        phase: "profile_binding_sync",
        summary: `Checking ${resolveSpaceMemberTerminalProfileLabel(
          candidate.profileName
        )}: validating gateway-chain diagnostics, submitting local runtime evidence, writing the Agent Profile binding, and waiting for Core execution readiness projection.`,
        profileId: candidate.profileId,
        profileIds: [candidate.profileId],
      });
    }
    const result = progress
      ? await runSpaceAddMembersProgressHeartbeat({
          ...progress,
          stage: "confirm_local_wake_bindings",
          phase: "profile_binding_sync_wait",
          summary: `Still checking ${resolveSpaceMemberTerminalProfileLabel(
            candidate.profileName
          )}: local runtime evidence, Binding write, and Core projection confirmation are still in progress.`,
          profileId: candidate.profileId,
          profileIds: [candidate.profileId],
          operation: async () =>
            await ensureFormalAgentBindingForReadyLocalProfile({
              profile: candidateOpenMeldProfile,
            }),
        })
      : await ensureFormalAgentBindingForReadyLocalProfile({
          profile: candidateOpenMeldProfile,
        });
    if (result.status === "ready") {
      if (progress) {
        emitAgentSpaceAddMembersProgress({
          ...progress,
          stage: "confirm_local_wake_bindings",
          phase: "profile_binding_confirmed",
          summary: `${resolveSpaceMemberTerminalProfileLabel(
            candidate.profileName
          )}: local participation binding is confirmed. This is not a final Wake outcome.`,
          profileId: candidate.profileId,
          profileIds: [candidate.profileId],
        });
      }
      nextCandidates.push({
        ...candidate,
        localParticipationBindingConfirmed: true,
      });
      continue;
    }

    if (progress) {
      emitAgentSpaceAddMembersProgress({
        ...progress,
        stage: "confirm_local_wake_bindings",
        phase: "profile_binding_not_confirmed",
        summary: `${resolveSpaceMemberTerminalProfileLabel(
          candidate.profileName
        )}: local participation binding was not confirmed; membership will continue with follow-up diagnostics.`,
        profileId: candidate.profileId,
        profileIds: [candidate.profileId],
      });
    }
    nextCandidates.push({
      ...candidate,
      localParticipationBindingConfirmed: false,
      localParticipationReadiness: null,
      localParticipationReasonCodes: result.reasonCodes,
      localParticipationReasonText: result.reasonText,
    });
  }
  return nextCandidates;
}

function emitSpaceMemberJoinOnlyWarnings(input: {
  candidates: readonly SpaceMemberCandidate[];
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
}): void {
  if (input.resolvedView !== "human") {
    return;
  }

  for (const candidate of input.candidates) {
    const warning = buildSpaceMemberJoinOnlyWarning(candidate);
    if (!warning) {
      continue;
    }
    input.presenter.line({
      code: "space.add_members.local_participation.join_only_warning",
      text: warning,
    });
  }
}

function buildSpaceMemberJoinOnlyWarning(
  candidate: SpaceMemberCandidate
): string | null {
  if (candidate.profileKind !== "agent") {
    return null;
  }
  if (candidate.localParticipationChecked !== true) {
    return null;
  }

  if (isSpaceMemberCandidateBackgroundReplyReady(candidate)) {
    return null;
  }

  const profileLabel = resolveSpaceMemberTerminalProfileLabel(
    candidate.profileName
  );
  if (isSpaceMemberCandidateRepairableLocalParticipationCandidate(candidate)) {
    const agentLabel = resolveSpaceMemberTerminalLocalTargetLabel({
      displayName: candidate.localTargetDisplayName,
      agentId: candidate.localTargetAgentId,
    });
    const nextStep = buildSpaceMemberRepairCommand({
      agentId: candidate.localTargetAgentId,
      profileId: candidate.profileId,
    });
    return `${profileLabel} can join this space now. ${agentLabel} still needs local setup on this device before it can handle work from the Space. Use \`${nextStep}\` to repair the local agent.`;
  }

  const nextAction = resolveSpaceMemberJoinOnlyNextAction(candidate);
  const reason = resolveSpaceMemberJoinOnlyReason(candidate);
  return `${profileLabel} can join this space now. OpenMeld has not confirmed its local reply path on this device yet. ${reason} ${formatSpaceMemberRecoveryNextAction(nextAction)}`;
}

async function refreshSpaceMemberCandidatesLocalReadiness(
  candidates: SpaceMemberCandidate[],
  progress?: SpaceAddMembersProgressContext,
  options: {
    stage?: Extract<
      SpaceAddMembersProgressStage,
      "resolve_candidates" | "check_local_wake_readiness"
    >;
  } = {}
): Promise<SpaceMemberCandidate[]> {
  const stage = options.stage ?? "check_local_wake_readiness";
  if (progress) {
    emitAgentSpaceAddMembersProgress({
      ...progress,
      stage,
      phase: "read_local_targets",
      summary:
        stage === "resolve_candidates"
          ? "Reading local agent controller state on this computer before showing candidate profiles."
          : "Reading local agent controller state on this computer before checking selected profiles.",
      profileIds: candidates.map((candidate) => candidate.profileId),
    });
  }
  const localTargetStates = progress
    ? await runSpaceAddMembersProgressHeartbeat({
        ...progress,
        stage,
        phase: "read_local_targets_wait",
        summary:
          stage === "resolve_candidates"
            ? "Still reading local agent controller state on this computer before showing candidate profiles."
            : "Still reading local agent controller state on this computer before checking selected profiles.",
        profileIds: candidates.map((candidate) => candidate.profileId),
        operation: async () => await listAgentTargetStates().catch(() => []),
      })
    : await listAgentTargetStates().catch(() => []);
  if (localTargetStates.length === 0) {
    return await Promise.all(
      candidates.map(async (candidate) => {
        const normalizedCandidate = {
          ...candidate,
          localTargetDisplayName: candidate.localTargetDisplayName ?? null,
          localTargetLaunchStatus: candidate.localTargetLaunchStatus ?? null,
          localTargetSelectable: candidate.localTargetSelectable ?? false,
        };
        return await enrichSpaceMemberCandidateLocalParticipationReadiness(
          normalizedCandidate,
          progress,
          { stage }
        );
      })
    );
  }
  const localTargetStateById = new Map(
    localTargetStates.map((state) => [state.agentId, state] as const)
  );

  return await Promise.all(
    candidates.map(async (candidate) => {
      const localTargetAgentId = resolveSpaceMemberCandidateLocalTargetAgentId({
        profileKind: candidate.profileKind,
        agentControllerRef: candidate.agentControllerRef,
        controllerEnabled: candidate.controllerEnabled,
      });
      const localTargetState = localTargetAgentId
        ? (localTargetStateById.get(localTargetAgentId) ?? null)
        : null;
      return await enrichSpaceMemberCandidateLocalParticipationReadiness(
        {
          ...candidate,
          localTargetAgentId,
          localTargetDisplayName: localTargetState?.displayName ?? null,
          localTargetLaunchStatus: localTargetState?.launchStatus ?? null,
          localTargetSelectable: localTargetState?.selectable ?? false,
        },
        progress,
        { stage }
      );
    })
  );
}

async function enrichSpaceMemberCandidateLocalParticipationReadiness(
  candidate: SpaceMemberCandidate,
  progress?: SpaceAddMembersProgressContext,
  options: {
    stage?: Extract<
      SpaceAddMembersProgressStage,
      "resolve_candidates" | "check_local_wake_readiness"
    >;
  } = {}
): Promise<SpaceMemberCandidate> {
  if (
    candidate.profileKind !== "agent" ||
    !candidate.openMeldProfile ||
    candidate.controllerEnabled !== true ||
    typeof candidate.agentControllerRef !== "string" ||
    candidate.agentControllerRef.trim().length === 0
  ) {
    return {
      ...candidate,
      localParticipationBindingConfirmed: false,
      localParticipationChecked: true,
      localParticipationReadiness: null,
      localParticipationReasonCodes: [],
      localParticipationReasonText: null,
    };
  }
  const candidateOpenMeldProfile = candidate.openMeldProfile;

  let snapshot: Awaited<
    ReturnType<typeof resolveCurrentReplyReadinessSnapshot>
  > | null = null;
  const stage = options.stage ?? "check_local_wake_readiness";
  try {
    if (progress) {
      emitAgentSpaceAddMembersProgress({
        ...progress,
        stage,
        phase: "read_profile_readiness",
        summary: `Checking local Wake evidence for ${resolveSpaceMemberTerminalProfileLabel(
          candidate.profileName
        )}. This checks local participation evidence only, not final Wake readiness.`,
        profileId: candidate.profileId,
        profileIds: [candidate.profileId],
      });
    }
    snapshot = progress
      ? await runSpaceAddMembersProgressHeartbeat({
          ...progress,
          stage,
          phase: "read_profile_readiness_wait",
          summary: `Still checking local Wake evidence for ${resolveSpaceMemberTerminalProfileLabel(
            candidate.profileName
          )}. This is local participation evidence only, not final Wake readiness.`,
          profileId: candidate.profileId,
          profileIds: [candidate.profileId],
          operation: async () =>
            await resolveCurrentReplyReadinessSnapshot({
              checkGatewayChain: false,
              ownerUserId: candidateOpenMeldProfile.ownerUserId,
              profile: candidateOpenMeldProfile,
            }),
        })
      : await resolveCurrentReplyReadinessSnapshot({
          checkGatewayChain: false,
          ownerUserId: candidateOpenMeldProfile.ownerUserId,
          profile: candidateOpenMeldProfile,
        });
  } catch {
    snapshot = null;
  }
  if (!snapshot) {
    return {
      ...candidate,
      localParticipationBindingConfirmed: false,
      localParticipationChecked: true,
      localParticipationReadiness: null,
      localParticipationReasonCodes: [],
      localParticipationReasonText: null,
    };
  }

  const readinessSummary = resolveServiceParticipationReadiness({
    deviceReplyReadiness: snapshot.deviceReplyReadiness,
    inventory: snapshot.inventory,
    runtimeStatus: snapshot.displayRuntimeStatus ?? snapshot.runtimeStatus,
  });

  return {
    ...candidate,
    localParticipationBindingConfirmed:
      snapshot.agentReplyReadiness?.replyReadiness === "ready",
    localParticipationChecked: true,
    localParticipationReadiness: readinessSummary.serviceReadiness,
    localParticipationReasonCodes: [
      ...snapshot.deviceReplyReadiness.reasonCodes,
    ],
    localParticipationReasonText: snapshot.deviceReplyReadiness.reasonText,
  };
}

function isSpaceMemberCandidateRunnableLocalParticipationCandidate(
  candidate: Pick<
    SpaceMemberCandidate,
    | "profileKind"
    | "agentControllerRef"
    | "controllerEnabled"
    | "localTargetSelectable"
    | "localParticipationReadiness"
  >
): boolean {
  return (
    candidate.profileKind === "agent" &&
    candidate.controllerEnabled === true &&
    typeof candidate.agentControllerRef === "string" &&
    candidate.agentControllerRef.trim().length > 0 &&
    candidate.localTargetSelectable === true &&
    (candidate.localParticipationReadiness === "ready" ||
      candidate.localParticipationReadiness === "not_running" ||
      candidate.localParticipationReadiness === "not_installed")
  );
}

function toActionParticipationCandidateFromSpaceMemberCandidate(
  candidate: SpaceMemberCandidate
): ActionParticipationCandidate {
  return {
    profileId: candidate.profileId,
    profileName: candidate.profileName,
    profileKind: candidate.profileKind,
    localTargetSelectable: candidate.localTargetSelectable,
    localTargetLaunchStatus: candidate.localTargetLaunchStatus,
    localParticipationReadiness: candidate.localParticipationReadiness,
    localParticipationReasonCodes: candidate.localParticipationReasonCodes,
  };
}

export async function runSpaceJoin(input: {
  profile?: string;
  baseUrl?: string;
  space?: string;
  password?: string;
  output?: string;
  rawStream?: boolean;
  view?: string;
  allowPrompt?: boolean;
  localEcho?: boolean;
  historyLimit?: number;
  role?: string;
  mentionAlias?: string;
  skipBringProfilesPrompt?: boolean;
  serviceIntent?: "space_join" | "space_create_join";
  entryChecksHandled?: boolean;
}): Promise<"completed" | "cancelled" | "back"> {
  let failureRuntime: Awaited<ReturnType<typeof resolveRuntimeContext>> | null =
    null;
  let failurePresenter: ReturnType<typeof createPresenter> | null = null;

  try {
    const entryContext = await prepareSpaceJoinEntryContext({
      profile: input.profile,
      baseUrl: input.baseUrl,
      view: input.view,
      space: input.space,
      allowPrompt: input.allowPrompt,
      output: input.output,
      rawStream: input.rawStream,
      entryChecksHandled: input.entryChecksHandled,
    });
    if (entryContext.status === "cancelled") {
      return "cancelled";
    }
    failureRuntime = entryContext.runtime;
    failurePresenter = entryContext.presenter;

    return await runSpaceJoinTargetLoop({
      openMeldProfileId: entryContext.openMeldProfile.openMeldProfileId,
      openMeldProfile: entryContext.openMeldProfile,
      runtime: entryContext.runtime,
      presenter: entryContext.presenter,
      baseUrl: entryContext.baseUrl,
      localDemand: entryContext.localDemand,
      authenticatedGatewayUrl: entryContext.authenticatedGatewayUrl,
      space: input.space,
      password: input.password,
      output: input.output,
      view: input.view,
      allowPrompt: input.allowPrompt,
      allowPromptForSpaceTarget: entryContext.allowPromptForSpaceTarget,
      allowPromptForRoleContext: entryContext.allowPromptForRoleContext,
      canPromptPreJoinActions: entryContext.canPromptPreJoinActions,
      allowBackToTargetSelection: entryContext.allowBackToTargetSelection,
      skipBringProfilesPrompt: input.skipBringProfilesPrompt === true,
      hasExplicitBaseUrlInput: entryContext.hasExplicitBaseUrlInput,
      showProgress: shouldShowSpaceJoinProgress({
        resolvedView: entryContext.runtime.resolvedView,
        interactive:
          entryContext.allowPromptForSpaceTarget &&
          canUseInteractivePrompts(entryContext.runtime),
        output: input.output,
        rawStream: input.rawStream,
      }),
      localEcho: input.localEcho ?? false,
      historyLimit: input.historyLimit,
      role: input.role,
      mentionAlias: input.mentionAlias,
      rawStream: input.rawStream === true,
      serviceIntent: input.serviceIntent ?? "space_join",
    });
  } catch (error) {
    const runtime =
      failureRuntime ??
      (await resolveRuntimeContext({
        profile: input.profile,
        view: input.view,
      }));
    const presenter = failurePresenter ?? createPresenter(runtime);
    if (isSpaceCommandOutputHandledError(error)) {
      throw error;
    }
    emitSpaceFailureNextStep({
      presenter,
      command: "join",
      error,
      profileId: runtime.openMeldProfileId ?? input.profile,
      resolvedView: runtime.resolvedView,
    });
    throw error;
  }
}

async function runSpaceJoinTargetLoop(input: {
  openMeldProfileId: string;
  openMeldProfile: OpenMeldProfile;
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  presenter: ReturnType<typeof createPresenter>;
  baseUrl: string;
  localDemand: PreparedSpaceJoinEntryContext["localDemand"];
  authenticatedGatewayUrl: string | null;
  space?: string;
  password?: string;
  output?: string;
  view?: string;
  allowPrompt?: boolean;
  allowPromptForSpaceTarget: boolean;
  allowPromptForRoleContext: boolean;
  canPromptPreJoinActions: boolean;
  allowBackToTargetSelection: boolean;
  skipBringProfilesPrompt: boolean;
  hasExplicitBaseUrlInput: boolean;
  showProgress: boolean;
  localEcho: boolean;
  historyLimit?: number;
  role?: string;
  mentionAlias?: string;
  rawStream: boolean;
  serviceIntent: "space_join" | "space_create_join";
}): Promise<"completed" | "cancelled" | "back"> {
  let authenticatedGatewayUrl = input.authenticatedGatewayUrl;
  const openMeldProfileId = input.openMeldProfileId;

  for (;;) {
    const targetResult = await resolveSpaceJoinEntryTargetOutcome({
      resolveTarget: async () =>
        await resolveSpaceJoinTarget({
          openMeldProfile: input.openMeldProfile,
          baseUrl: input.baseUrl,
          space: input.space,
          allowPrompt: input.allowPromptForSpaceTarget,
          presenter: input.presenter,
          resolvedView: input.runtime.resolvedView,
        }),
      runCreate: async () => {
        return await runSpaceCreate({
          profile: input.openMeldProfile.openMeldProfileId,
          baseUrl: input.baseUrl,
          join: true,
          output: input.output,
          view: input.view,
          entryChecksHandled: true,
          postCreateJoin: {
            localEcho: input.localEcho,
            historyLimit: input.historyLimit,
            role: input.role,
            mentionAlias: input.mentionAlias,
            rawStream: input.rawStream,
            skipBringProfilesPrompt: input.skipBringProfilesPrompt,
            output: input.output,
            view: input.view,
            serviceIntent: "space_create_join",
          },
        });
      },
    });
    if (targetResult.status !== "submitted") {
      return targetResult.status;
    }

    const target = targetResult.target;
    const existingSpaceConfig = resolveOptionalReadableSpaceConfig(
      await readSpaceConfig({
        openMeldProfileId,
        space: target.space,
      }),
      "reading an existing local space config before join"
    );
    const targetBaseUrl = input.hasExplicitBaseUrlInput
      ? input.baseUrl
      : (target.baseUrl ?? input.baseUrl);
    const preflightResult = await assertSpaceJoinTargetPreflightReady({
      openMeldProfile: input.openMeldProfile,
      baseUrl: targetBaseUrl,
      allowPrompt: input.canPromptPreJoinActions,
      localDemand: input.localDemand,
      presenter: input.presenter,
      resolvedView: input.runtime.resolvedView,
      serviceIntent: input.serviceIntent,
      showProgress: input.showProgress,
      view: input.view,
    });
    if (preflightResult === "cancelled") {
      return "cancelled";
    }
    authenticatedGatewayUrl =
      await ensureSpaceCommandGatewayAuthenticationOrCancel({
        runtime: input.runtime,
        gatewayUrl: targetBaseUrl,
        promptMessage:
          buildCommandAuthenticationPromptMessage("joining a space"),
        allowPrompt: input.allowPromptForSpaceTarget,
        authenticatedGatewayUrl,
      });
    if (!authenticatedGatewayUrl) {
      return "cancelled";
    }

    const accessBootstrap = await resolveSpaceJoinAccessBootstrap({
      openMeldProfile: input.openMeldProfile,
      baseUrl: targetBaseUrl,
      space: target.space,
      initialPassword: input.password,
      resolvedView: input.runtime.resolvedView,
      presenter: input.presenter,
      canPromptJoinPassword: input.canPromptPreJoinActions,
      canConfirmPublicSpaceJoin: input.canPromptPreJoinActions,
    });
    if (accessBootstrap.status === "cancelled") {
      return "cancelled";
    }
    const membershipBootstrap = await resolveSpaceJoinMembershipBootstrap(
      {
        openMeldProfile: input.openMeldProfile,
        baseUrl: targetBaseUrl,
        space: target.space,
        password: accessBootstrap.password,
        publicExposure: accessBootstrap.publicExposure,
        canPromptPreJoinActions: input.canPromptPreJoinActions,
        skipBringProfilesPrompt: input.skipBringProfilesPrompt,
        allowBackToTargetSelection: input.allowBackToTargetSelection,
        resolvedView: input.runtime.resolvedView,
        presenter: input.presenter,
      },
      {
        resolveSpaceMemberCandidatesForAdd,
        resolveSelectedSpaceMemberCandidates,
        normalizeRequestedMemberIds,
        sortSpaceMemberCandidatesForPrompt,
        buildHumanSpaceMemberCandidateSearchItem,
        createProfileByKind,
        resolveCreateProfileKind,
        resolveCreateProfileName,
        resolveAgentProfileSetup,
        persistAgentTransportSelection,
        prepareSpaceMemberCandidatesLocalParticipation: async ({
          actorProfile,
          candidates,
          presenter,
          resolvedView,
        }) =>
          await ensureSpaceMemberCandidatesLocalParticipationReady({
            openMeldProfile: actorProfile,
            candidates,
            gatewayUrl: targetBaseUrl,
            presenter,
            resolvedView,
            allowPrompt: input.canPromptPreJoinActions,
            spaceId: target.space,
            view: input.view,
          }),
        applySpaceAddMembers,
        persistSpaceAddMembersJoinNotices,
        emitSpaceAddMembersResult,
      }
    );
    if (membershipBootstrap.status === "back") {
      continue;
    }
    if (membershipBootstrap.status === "cancelled") {
      return "cancelled";
    }
    const roleAliasBootstrap = await resolveSpaceJoinRoleAliasBootstrap(
      {
        openMeldProfile: input.openMeldProfile,
        openMeldProfileId,
        baseUrl: targetBaseUrl,
        space: target.space,
        password: accessBootstrap.password,
        existingSpaceConfig,
        roleInput: input.role,
        mentionAliasInput: input.mentionAlias,
        resolvedView: input.runtime.resolvedView,
        allowPromptRoleContext: input.allowPromptForRoleContext,
        presenter: input.presenter,
      },
      {
        fetchSpaceCursorForBootstrap: async ({
          openMeldProfile,
          baseUrl,
          space,
          password,
        }) =>
          await fetchSpaceCursor({
            requestContext: buildOpenMeldRequestContextFromProfile({
              openMeldProfile,
            }),
            baseUrl,
            space,
            password,
          }),
      }
    );
    if (roleAliasBootstrap.status === "cancelled") {
      return "cancelled";
    }

    const joinConnectionState = await runSpaceJoinConnectHandoff({
      openMeldProfileId,
      openMeldProfile: input.openMeldProfile,
      baseUrl: targetBaseUrl,
      space: target.space,
      initialPassword: accessBootstrap.password,
      output: input.output,
      localEcho: input.localEcho,
      historyLimit: input.historyLimit,
      role: roleAliasBootstrap.role,
      mentionAlias: roleAliasBootstrap.mentionAlias,
      presenter: input.presenter,
      resolvedView: input.runtime.resolvedView,
      canPromptJoinPassword: input.canPromptPreJoinActions,
      rawStream: input.rawStream,
    });
    if (joinConnectionState === "cancelled") {
      return "cancelled";
    }

    return "completed";
  }
}

async function prepareSpaceCreateRuntimeState(input: {
  profile?: string;
  view?: string;
  name?: string;
  visibility?: string;
}): Promise<{
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  presenter: ReturnType<typeof createPresenter>;
  interactive: boolean;
}> {
  const runtime = await resolveRuntimeContext({
    profile: input.profile,
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  const interactive = canUseInteractivePrompts(runtime);
  const missingName = String(input.name ?? "").trim().length === 0;
  const missingVisibility = String(input.visibility ?? "").trim().length === 0;
  if (runtime.resolvedView === "agent" && (missingName || missingVisibility)) {
    emitSpaceAgentOverview({
      presenter,
      resolvedView: runtime.resolvedView,
      command: "create",
    });
    throw createSpaceCreateGuideError(
      missingName
        ? undefined
        : "openmeld space create requires explicit --visibility public|private in agent/non-interactive mode."
    );
  }

  return {
    runtime,
    presenter,
    interactive,
  };
}

async function resolveSpaceJoinTarget(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  space?: string;
  allowPrompt: boolean;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
}): Promise<SpaceJoinTargetResolution> {
  const explicitSpace = String(input.space ?? "").trim();
  if (explicitSpace) {
    assertValidSpaceIdTarget({
      space: explicitSpace,
      resolvedView: input.resolvedView,
    });
    const known = requireReadableSpaceConfigList(
      await listSpaceConfigs({
        openMeldProfileId: input.openMeldProfile.openMeldProfileId,
      }),
      "listing known local spaces for join target resolution"
    );
    const matched = known.find((item) => item.space === explicitSpace);
    return {
      status: "submitted",
      value: {
        space: explicitSpace,
        ...(matched?.baseUrl ? { baseUrl: matched.baseUrl } : {}),
      },
    };
  }

  if (!input.allowPrompt) {
    if (input.resolvedView === "agent") {
      throw createSpaceTargetGuideError("join");
    }
    throw new Error(
      buildJoinTargetMissingMessage({
        resolvedView: input.resolvedView,
      })
    );
  }

  const knownResult = await resolveKnownSpacesForSelectionWithLoading({
    openMeldProfile: input.openMeldProfile,
    baseUrl: input.baseUrl,
    command: "join",
    showLoading: input.allowPrompt && input.resolvedView === "human",
  });
  const known = knownResult.items;
  const inlineDeletedNotices =
    input.resolvedView === "human" && known.length > 0
      ? knownResult.deletedNotices
      : [];
  if (inlineDeletedNotices.length === 0) {
    await maybeEmitKnownSpaceDeletedNotices({
      presenter: input.presenter,
      resolvedView: input.resolvedView,
      openMeldProfileId: input.openMeldProfile.openMeldProfileId,
      deletedNotices: knownResult.deletedNotices,
    });
  }
  if (known.length === 0 && input.resolvedView === "human") {
    return promptHumanJoinSelectionWithoutKnownSpaces(
      knownResult.visibilityScope
    );
  }

  const target = await promptSpaceJoinSelection({
    known,
    command: "join",
    resolvedView: input.resolvedView,
    currentProfileId: input.openMeldProfile.openMeldProfileId,
    currentProfileName: input.openMeldProfile.profileName,
    currentOwnerUserId: input.openMeldProfile.ownerUserId,
    visibilityScope: knownResult.visibilityScope,
    deletedNotices: inlineDeletedNotices,
  });
  return target;
}

export async function runSpaceWatch(input: {
  profile?: string;
  baseUrl?: string;
  space?: string;
  password?: string;
  output?: string;
  view?: string;
  historyLimit?: number;
  rawStream?: boolean;
  entryChecksHandled?: boolean;
}) {
  const hasExplicitBaseUrlInput = String(input.baseUrl ?? "").trim().length > 0;
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage("watching a space"),
    checkGatewayMismatch: hasExplicitBaseUrlInput,
    entryChecksHandled: input.entryChecksHandled,
  });
  if (context.status === "cancelled") {
    return;
  }
  const { runtime, interactive, baseUrl } = context;
  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive,
  });
  const openMeldProfileId = openMeldProfile.openMeldProfileId;
  const target = await resolveSpaceTarget({
    openMeldProfile,
    baseUrl,
    space: input.space,
    command: "watch",
    allowPrompt: interactive,
    presenter: context.presenter,
    resolvedView: runtime.resolvedView,
  });
  if (!target) {
    return;
  }
  const targetBaseUrl = hasExplicitBaseUrlInput
    ? baseUrl
    : (target.baseUrl ?? baseUrl);
  const authenticatedGatewayUrl =
    await ensureSpaceCommandGatewayAuthenticationOrCancel({
      runtime,
      gatewayUrl: targetBaseUrl,
      promptMessage:
        buildCommandAuthenticationPromptMessage("watching a space"),
      allowPrompt: interactive,
      authenticatedGatewayUrl: context.authenticatedGatewayUrl,
    });
  if (!authenticatedGatewayUrl) {
    return;
  }

  await runConnect({
    profile: openMeldProfileId,
    openMeldProfile,
    baseUrl: targetBaseUrl,
    space: target.space,
    password: input.password,
    connectionMode: "watch",
    stdio:
      runtime.resolvedView === "human" &&
      interactive &&
      input.output !== "ndjson",
    output: input.output,
    historyLimit: input.historyLimit,
    rawStream: input.rawStream === true,
    view: input.view,
  });
}

export async function runSpaceDelete(input: {
  profile?: string;
  baseUrl?: string;
  space?: string;
  password?: string;
  view?: string;
  entryChecksHandled?: boolean;
  allowBackToCaller?: boolean;
}): Promise<SpaceCommandNavigationStatus> {
  // TODO(approval-flow): when web/email approval is available, replace this
  // local confirmation gate with an out-of-band approval token flow.
  const runtime = await resolveRuntimeContext({
    profile: input.profile,
    view: input.view,
  });

  if (runtime.resolvedView === "agent") {
    throw createSpaceDeleteHumanApprovalGuideError(
      "agent sessions cannot delete spaces directly."
    );
  }
  if (!canUseInteractivePrompts(runtime)) {
    throw new Error(
      "space delete requires an interactive human TTY session for confirmation"
    );
  }
  const hasExplicitBaseUrlInput = String(input.baseUrl ?? "").trim().length > 0;
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage("deleting spaces"),
    checkGatewayMismatch: hasExplicitBaseUrlInput,
    entryChecksHandled: input.entryChecksHandled,
  });
  if (context.status === "cancelled") {
    return "cancelled";
  }
  const { presenter, baseUrl, authenticatedGatewayUrl } = context;

  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive: true,
  });
  if (openMeldProfile.profileKind !== "human") {
    throw createSpaceDeleteHumanApprovalGuideError(
      "space delete requires a huma OpenMeld profile."
    );
  }

  const openMeldProfileId = openMeldProfile.openMeldProfileId;
  const accountContext = await resolveCurrentOpenMeldAccountContext().catch(
    () => null
  );
  const ownerUserIdForDelete =
    normalizeOptionalString(openMeldProfile.ownerUserId) ??
    normalizeOptionalString(accountContext?.user?.id) ??
    undefined;
  for (;;) {
    const targets = await resolveSpaceDeleteTargets({
      openMeldProfile: {
        ...openMeldProfile,
        ownerUserId: ownerUserIdForDelete ?? openMeldProfile.ownerUserId,
      },
      baseUrl,
      space: input.space,
      allowPrompt: true,
      presenter,
      resolvedView: runtime.resolvedView,
      allowBack: true,
    });
    if (targets.status === "cancelled") {
      return "cancelled";
    }
    if (targets.status === "back") {
      if (input.allowBackToCaller === true) {
        return "back";
      }
      cancel("Cancelled.");
      return "cancelled";
    }
    const outcome = await runSpaceDeleteAttempt({
      targets: targets.targets,
      currentProfileId: openMeldProfileId,
      currentProfileName: openMeldProfile.profileName,
      allowBackToSelection: targets.allowBackToSelection,
      runtime,
      presenter,
      openMeldProfileId,
      openMeldProfile,
      baseUrl,
      hasExplicitBaseUrlInput,
      authenticatedGatewayUrl,
      password: input.password,
    });
    if (outcome === "back") {
      continue;
    }
    return outcome;
  }
}

async function runSpaceDeleteAttempt(input: {
  targets: SpaceDeleteTarget[];
  currentProfileId: string;
  currentProfileName: string;
  allowBackToSelection: boolean;
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  presenter: ReturnType<typeof createPresenter>;
  openMeldProfileId: string;
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  hasExplicitBaseUrlInput: boolean;
  authenticatedGatewayUrl?: string | null;
  password?: string;
}): Promise<SpaceCommandNavigationStatus> {
  const confirmation = await confirmDeleteTargets({
    targets: input.targets,
    currentProfileId: input.currentProfileId,
    currentProfileName: input.currentProfileName,
    allowBack: input.allowBackToSelection,
  });
  if (confirmation === "cancelled") {
    return "cancelled";
  }
  if (confirmation === "back") {
    return "back";
  }

  const deleteResult = await deleteConfirmedSpaceTargets({
    targets: input.targets,
    runtime: input.runtime,
    presenter: input.presenter,
    openMeldProfileId: input.openMeldProfileId,
    openMeldProfile: input.openMeldProfile,
    baseUrl: input.baseUrl,
    hasExplicitBaseUrlInput: input.hasExplicitBaseUrlInput,
    authenticatedGatewayUrl: input.authenticatedGatewayUrl,
    password: input.password,
  });
  if (deleteResult.status === "cancelled") {
    return "cancelled";
  }
  if (deleteResult.failures.length === 0) {
    return "completed";
  }

  renderSpaceDeleteBatchFailureSummary({
    presenter: input.presenter,
    totalCount: input.targets.length,
    deletedCount: deleteResult.deletedCount,
    failures: deleteResult.failures,
    resolvedView: input.runtime.resolvedView,
  });
  if (deleteResult.deletedCount > 0) {
    return "completed";
  }

  const firstFailure = deleteResult.failures[0];
  if (!firstFailure) {
    throw new Error("Delete failed.");
  }
  throw new Error(buildDeleteBatchFailureMessage(firstFailure));
}

async function deleteConfirmedSpaceTargets(input: {
  targets: SpaceDeleteTarget[];
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  presenter: ReturnType<typeof createPresenter>;
  openMeldProfileId: string;
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  hasExplicitBaseUrlInput: boolean;
  authenticatedGatewayUrl?: string | null;
  password?: string;
}): Promise<
  | { status: "cancelled" }
  | {
      status: "completed";
      deletedCount: number;
      failures: SpaceDeleteFailure[];
    }
> {
  const failures: SpaceDeleteFailure[] = [];
  let deletedCount = 0;
  let authenticatedGatewayUrl =
    input.authenticatedGatewayUrl ??
    (input.hasExplicitBaseUrlInput ? input.baseUrl : null);

  for (const target of input.targets) {
    try {
      const targetBaseUrl = input.hasExplicitBaseUrlInput
        ? input.baseUrl
        : (target.baseUrl ?? input.baseUrl);
      authenticatedGatewayUrl =
        await ensureSpaceCommandGatewayAuthenticationOrCancel({
          runtime: input.runtime,
          gatewayUrl: targetBaseUrl,
          promptMessage:
            buildCommandAuthenticationPromptMessage("deleting spaces"),
          allowPrompt: true,
          authenticatedGatewayUrl,
        });
      if (!authenticatedGatewayUrl) {
        return {
          status: "cancelled",
        };
      }
      const deleted = await deleteSpaceTargetWithCleanup({
        target,
        openMeldProfileId: input.openMeldProfileId,
        openMeldProfile: input.openMeldProfile,
        baseUrl: input.baseUrl,
        hasExplicitBaseUrlInput: input.hasExplicitBaseUrlInput,
        password: input.password,
        presenter: input.presenter,
        resolvedView: input.runtime.resolvedView,
      });
      if (!deleted) {
        return {
          status: "cancelled",
        };
      }
      deletedCount += 1;
    } catch (error) {
      failures.push({ target, error });
    }
  }

  return {
    status: "completed",
    deletedCount,
    failures,
  };
}

async function confirmDeleteTargets(input: {
  targets: SpaceDeleteTarget[];
  currentProfileId: string;
  currentProfileName: string;
  allowBack?: boolean;
}): Promise<SpaceDeleteConfirmationResult> {
  if (input.allowBack !== true) {
    const confirmed = await confirm({
      message: buildDeleteConfirmationMessage({
        targets: input.targets,
        currentProfileId: input.currentProfileId,
        currentProfileName: input.currentProfileName,
      }),
      initialValue: false,
    });
    if (isCancel(confirmed) || !confirmed) {
      cancel("Cancelled.");
      return "cancelled";
    }

    const typedConfirmation = await text({
      message: "Type DELETE to confirm permanent deletion",
      placeholder: "DELETE",
    });
    if (isCancel(typedConfirmation)) {
      cancel("Cancelled.");
      return "cancelled";
    }
    if (!isDeleteConfirmationValue(typedConfirmation)) {
      cancel("Cancelled: confirmation keyword mismatch.");
      return "cancelled";
    }
    return "confirmed";
  }

  for (;;) {
    const decision = await select({
      message: buildDeleteConfirmationMessage({
        targets: input.targets,
        currentProfileId: input.currentProfileId,
        currentProfileName: input.currentProfileName,
      }),
      options: [
        {
          value: "confirm",
          label: "Delete permanently",
          hint: "Continue to final confirmation",
        },
        ...(input.allowBack === true
          ? [{ value: "back", label: "Back" as const }]
          : []),
        {
          value: "cancel",
          label: "Cancel",
        },
      ],
    });
    if (isCancel(decision) || decision === "cancel") {
      cancel("Cancelled.");
      return "cancelled";
    }
    if (decision === "back") {
      return "back";
    }

    const typedConfirmation = await promptTextEntry({
      message: "Type DELETE to confirm permanent deletion",
      placeholder: "DELETE",
      allowBack: input.allowBack === true,
      backLabel: "Back",
      validate: (value) =>
        isDeleteConfirmationValue(value)
          ? null
          : "Type DELETE exactly to continue.",
    });
    if (typedConfirmation.status === "cancelled") {
      cancel("Cancelled.");
      return "cancelled";
    }
    if (typedConfirmation.status === "back") {
      continue;
    }
    return "confirmed";
  }
}

async function deleteSpaceTargetWithCleanup(input: {
  target: SpaceDeleteTarget;
  openMeldProfileId: string;
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  hasExplicitBaseUrlInput: boolean;
  password?: string;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
}): Promise<boolean> {
  const targetBaseUrl = input.hasExplicitBaseUrlInput
    ? input.baseUrl
    : (input.target.baseUrl ?? input.baseUrl);
  const deleted = await deleteSpaceWithHumanFallback({
    target: input.target,
    openMeldProfileId: input.openMeldProfileId,
    openMeldProfile: input.openMeldProfile,
    baseUrl: targetBaseUrl,
    password: input.password,
    presenter: input.presenter,
    resolvedView: input.resolvedView,
  });
  if (!deleted) {
    return false;
  }
  await removeSpaceConfig({
    openMeldProfileId: input.openMeldProfileId,
    space: input.target.space,
  }).catch(() => undefined);
  await markDeletedSpaceInHistory({
    target: input.target,
    openMeldProfile: input.openMeldProfile,
    baseUrl: targetBaseUrl,
    presenter: input.presenter,
    resolvedView: input.resolvedView,
  });
  input.presenter.line({
    code: "space.delete.deleted",
    text: `space deleted: ${input.target.space}`,
    data: { spaceId: input.target.space },
  });
  return true;
}

async function deleteSpaceWithHumanFallback(input: {
  target: SpaceDeleteTarget;
  openMeldProfileId: string;
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  password?: string;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
}): Promise<boolean> {
  const approvedAgentCreatorProfileId =
    input.target.creatorKind === "agent"
      ? (normalizeOptionalString(input.target.creatorProfileId) ?? undefined)
      : undefined;
  let nextDeletePassword = input.password;
  let lastPasswordError: unknown = null;

  for (
    let attempt = 0;
    attempt < MAX_DELETE_PASSWORD_PROMPT_ATTEMPTS;
    attempt += 1
  ) {
    try {
      await deleteSpace({
        openMeldProfile: input.openMeldProfile,
        baseUrl: input.baseUrl,
        space: input.target.space,
        password: nextDeletePassword,
        approvedAgentCreatorProfileId,
      });
      return true;
    } catch (error) {
      const friendlyDeleteBlockedError = buildHumanSpaceDeleteBlockedError({
        error,
        target: input.target,
        resolvedView: input.resolvedView,
      });
      if (friendlyDeleteBlockedError) {
        renderHumanSpaceDeleteBlockedCard({
          presenter: input.presenter,
          target: input.target,
        });
        throw friendlyDeleteBlockedError;
      }

      const passwordPromptReason = resolveSpacePasswordPromptReason(error);
      if (!passwordPromptReason) {
        throw error;
      }

      emitSpacePasswordPromptNotice({
        presenter: input.presenter,
        reason: passwordPromptReason,
        codePrefix: "space.delete.password",
        requiredText: "This space is protected. Enter password to delete it.",
      });
      lastPasswordError = error;
      const promptedPassword = await promptSpacePassword();
      if (promptedPassword === null) {
        return false;
      }
      nextDeletePassword = promptedPassword;
    }
  }

  throw lastPasswordError ?? new Error("Delete failed.");
}

type SpaceDeleteFailure = {
  target: SpaceDeleteTarget;
  error: unknown;
};

function renderSpaceDeleteBatchFailureSummary(input: {
  presenter: ReturnType<typeof createPresenter>;
  totalCount: number;
  deletedCount: number;
  failures: SpaceDeleteFailure[];
  resolvedView: "human" | "agent";
}): void {
  const failedCount = input.failures.length;
  const reason = resolveDeleteBatchFailureReason(input.failures);
  const failedTargets = summarizeFailedDeleteTargets(input.failures);

  if (input.resolvedView === "human") {
    renderHumanErrorCard({
      message: `OpenMeld deleted ${String(input.deletedCount)} of ${String(input.totalCount)} Spaces, but couldn't delete ${failedTargets}: ${reason}`,
      nextStep:
        input.deletedCount > 0
          ? "Try deleting those Spaces again."
          : "Try again in a moment.",
      presenter: input.presenter,
      title:
        input.deletedCount > 0
          ? "Some Spaces weren't deleted"
          : "Spaces couldn't be deleted",
      codePrefix: "space.delete.batch_result",
    });
    return;
  }

  input.presenter.line({
    code: "space.delete.batch_result",
    text: `delete result: deleted ${String(input.deletedCount)}/${String(input.totalCount)}; failed ${String(failedCount)} (${reason})`,
    data: {
      deletedCount: input.deletedCount,
      totalCount: input.totalCount,
      failedCount,
      reason,
      failedTargets,
    },
  });
}

function buildDeleteBatchFailureMessage(failure: SpaceDeleteFailure): string {
  const parsed = parseHttpErrorMessage(failure.error);
  if (!parsed) {
    return toErrorMessage(failure.error);
  }

  if (isAuthUpstreamUnavailableError(parsed)) {
    return "Delete failed: OpenMeld auth service is temporarily unavailable. Retry in a moment.";
  }
  const status = resolveUpstreamStatus(parsed);
  if (status >= 500) {
    return "Delete failed: OpenMeld service is temporarily unavailable. Retry in a moment.";
  }
  if (status === 404) {
    return "Delete failed: space not found (it may have already been deleted).";
  }
  const passwordPromptReason = resolveSpacePasswordPromptReason(failure.error);
  if (passwordPromptReason === "required") {
    return "Delete failed: this space requires a password. Retry with `--password`.";
  }
  if (passwordPromptReason === "invalid") {
    return "Delete failed: space password is incorrect. Retry with the correct password.";
  }
  if (status === 401) {
    const guidance = resolveAuthenticationGuidance({
      reason: "expired",
      action: "deleting a space",
    });
    return formatInlineOpenMeldCliCommands(
      `Delete failed: ${guidance.summary} ${guidance.errorNextStep}`
    );
  }
  return toErrorMessage(failure.error);
}

function resolveDeleteBatchFailureReason(
  failures: SpaceDeleteFailure[]
): string {
  const reasons = failures
    .map((item) => resolveDeleteFailureReason(item.error))
    .filter((value) => value.length > 0);
  if (reasons.length === 0) {
    return "Some delete requests failed.";
  }
  const unique = Array.from(new Set(reasons));
  if (unique.length === 1) {
    return unique[0] ?? "Some delete requests failed.";
  }
  return "Some delete requests failed for different reasons.";
}

function resolveDeleteFailureReason(error: unknown): string {
  const parsed = parseHttpErrorMessage(error);
  if (!parsed) {
    return "Unknown error.";
  }
  if (isAuthUpstreamUnavailableError(parsed)) {
    return "OpenMeld auth service is temporarily unavailable.";
  }

  const status = resolveUpstreamStatus(parsed);
  if (status >= 500) {
    return "OpenMeld service is temporarily unavailable.";
  }
  if (status === 404) {
    return "Space not found or already deleted.";
  }
  const passwordPromptReason = resolveSpacePasswordPromptReason(error);
  if (passwordPromptReason === "required") {
    return "Space password is required.";
  }
  if (passwordPromptReason === "invalid") {
    return "Space password is invalid.";
  }
  if (status === 401) {
    return "Authentication expired.";
  }
  if (status === 403 && isSpaceDeleteOwnerRestrictionError(parsed)) {
    return "Only spaces created by your user can be deleted.";
  }
  return "Delete request failed.";
}

function isAuthUpstreamUnavailableError(input: {
  status: number;
  code: string;
  message: string;
  body: string;
}): boolean {
  if (resolveUpstreamStatus(input) !== 502) {
    return false;
  }
  const combined =
    `${input.code}\n${input.message}\n${input.body}`.toLowerCase();
  return combined.includes("auth upstream unavailable");
}

function summarizeFailedDeleteTargets(failures: SpaceDeleteFailure[]): string {
  const MAX_VISIBLE = 3;
  const names = failures.slice(0, MAX_VISIBLE).map((item) => {
    const label = normalizeOptionalString(item.target.name);
    if (label) {
      return label;
    }
    return item.target.space;
  });
  if (failures.length <= MAX_VISIBLE) {
    return names.join(", ");
  }
  return `${names.join(", ")} (+${String(failures.length - MAX_VISIBLE)} more)`;
}

async function markDeletedSpaceInHistory(input: {
  target: SpaceDeleteTarget;
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
}): Promise<void> {
  const gatewayHost = resolveGatewayHost(input.baseUrl);
  if (!gatewayHost) {
    input.presenter.line({
      code: "connect.warn.profile_space_history_sync_failed",
      text: formatMessage(
        input.resolvedView,
        "connect.warn.profile_space_history_sync_failed",
        {
          error: "failed to resolve gateway host from base url",
        }
      ),
    });
    return;
  }
  await updateProfileSpaceHistoryStatus({
    baseUrl: input.baseUrl,
    requestContext: buildOpenMeldRequestContextFromProfile({
      openMeldProfile: input.openMeldProfile,
    }),
    openMeldProfileId: input.openMeldProfile.openMeldProfileId,
    profileName: input.openMeldProfile.profileName,
    spaceId: input.target.space,
    body: {
      gatewayHost,
      status: "removed",
      reason: "space_deleted_by_user",
    },
  }).catch((error) => {
    input.presenter.line({
      code: "connect.warn.profile_space_history_sync_failed",
      text: formatMessage(
        input.resolvedView,
        "connect.warn.profile_space_history_sync_failed",
        {
          error: toErrorMessage(error),
        }
      ),
    });
  });
}

export async function runSpacePassword(input: {
  profile?: string;
  baseUrl?: string;
  space?: string;
  password?: string;
  clear?: boolean;
  view?: string;
  entryChecksHandled?: boolean;
  allowBackToCaller?: boolean;
}): Promise<SpaceCommandNavigationStatus> {
  const hasExplicitBaseUrlInput = String(input.baseUrl ?? "").trim().length > 0;
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage(
      "changing a space password"
    ),
    checkGatewayMismatch: hasExplicitBaseUrlInput,
    entryChecksHandled: input.entryChecksHandled,
  });
  if (context.status === "cancelled") {
    return "cancelled";
  }
  const { runtime, interactive: allowPrompt, presenter, baseUrl } = context;
  const hasExplicitMutationInput =
    input.clear === true || typeof input.password === "string";
  const initialMutationInput =
    hasExplicitMutationInput || !allowPrompt
      ? await resolveSpacePasswordMutationInput({
          clear: input.clear,
          password: input.password,
          allowPrompt,
          resolvedView: runtime.resolvedView,
          allowBackToCaller: input.allowBackToCaller === true,
        })
      : null;
  if (
    (hasExplicitMutationInput || !allowPrompt) &&
    initialMutationInput?.status !== "submitted"
  ) {
    return initialMutationInput?.status ?? "cancelled";
  }
  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive: allowPrompt,
  });
  let nextInitialMutationInput =
    initialMutationInput?.status === "submitted"
      ? initialMutationInput.value
      : undefined;

  for (;;) {
    const outcome = await runSpacePasswordAttempt({
      input,
      runtime,
      allowPrompt,
      openMeldProfile,
      baseUrl,
      hasExplicitBaseUrlInput,
      presenter,
      authenticatedGatewayUrl: context.authenticatedGatewayUrl,
      nextInitialMutationInput,
    });
    if (outcome.status === "repeat") {
      nextInitialMutationInput = outcome.nextInitialMutationInput;
      continue;
    }
    return outcome.status;
  }
}

async function runSpacePasswordAttempt(input: {
  input: {
    clear?: boolean;
    password?: string;
    space?: string;
    allowBackToCaller?: boolean;
  };
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  allowPrompt: boolean;
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  hasExplicitBaseUrlInput: boolean;
  presenter: ReturnType<typeof createPresenter>;
  authenticatedGatewayUrl: string | null;
  nextInitialMutationInput?: { clear: boolean; password?: string };
}): Promise<
  | { status: SpaceCommandNavigationStatus }
  | {
      status: "repeat";
      nextInitialMutationInput?: { clear: boolean; password?: string };
    }
> {
  const resolvedInput = await resolveSpacePasswordExecutionInput({
    clear: input.input.clear,
    password: input.input.password,
    allowPrompt: input.allowPrompt,
    resolvedView: input.runtime.resolvedView,
    openMeldProfile: input.openMeldProfile,
    baseUrl: input.baseUrl,
    explicitSpace: input.input.space,
    hasExplicitBaseUrlInput: input.hasExplicitBaseUrlInput,
    presenter: input.presenter,
    initialMutationInput: input.nextInitialMutationInput,
    allowBackToCaller: input.input.allowBackToCaller === true,
  });
  if (resolvedInput.status !== "submitted") {
    if (resolvedInput.status === "cancelled") {
      return { status: "cancelled" };
    }
    return input.nextInitialMutationInput
      ? { status: "repeat" }
      : {
          status: input.input.allowBackToCaller === true ? "back" : "cancelled",
        };
  }

  const resolvedPasswordInput = resolvedInput.value;
  const authenticatedGatewayUrl =
    await ensureSpaceCommandGatewayAuthenticationOrCancel({
      runtime: input.runtime,
      gatewayUrl: resolvedPasswordInput.target.baseUrl,
      promptMessage: buildCommandAuthenticationPromptMessage(
        "changing a space password"
      ),
      allowPrompt: input.allowPrompt,
      authenticatedGatewayUrl: input.authenticatedGatewayUrl,
    });
  if (!authenticatedGatewayUrl) {
    return { status: "cancelled" };
  }

  const nextPassword = await resolveSpacePasswordValueForExecution({
    resolvedPasswordInput,
    allowBackToCaller: input.input.allowBackToCaller === true,
  });
  if (nextPassword.status === "cancelled") {
    return { status: "cancelled" };
  }
  if (nextPassword.status === "back") {
    return input.input.allowBackToCaller === true
      ? {
          status: "repeat",
          nextInitialMutationInput: {
            clear: resolvedPasswordInput.clear,
          },
        }
      : { status: "cancelled" };
  }

  const endpoint = toSpacePasswordUrl(
    resolvedPasswordInput.target.baseUrl,
    resolvedPasswordInput.target.space
  );
  const headers = await buildOpenMeldProfileRequestHeadersWithAuth({
    requestUrl: endpoint,
    openMeldProfile: input.openMeldProfile,
  });
  await executeSpacePasswordMutation({
    clear: resolvedPasswordInput.clear,
    endpoint,
    headers,
    password: nextPassword.value,
    target: resolvedPasswordInput.target,
    openMeldProfile: input.openMeldProfile,
    presenter: input.presenter,
    resolvedView: input.runtime.resolvedView,
  });
  return { status: "completed" };
}

function resolveSpacePasswordValueForExecution(input: {
  resolvedPasswordInput: {
    clear: boolean;
    password?: string;
    target: { space: string; baseUrl: string; name?: string };
  };
  allowBackToCaller: boolean;
}): Promise<SpacePasswordPromptResult> {
  if (
    input.resolvedPasswordInput.clear ||
    typeof input.resolvedPasswordInput.password === "string"
  ) {
    return Promise.resolve({
      status: "submitted",
      value:
        typeof input.resolvedPasswordInput.password === "string"
          ? normalizeSpacePasswordText(input.resolvedPasswordInput.password)
          : "",
    });
  }
  return promptAndConfirmSpacePassword({
    allowBack: input.allowBackToCaller,
    emitCancelMessage: !input.allowBackToCaller,
  });
}

async function executeSpacePasswordMutation(input: {
  clear: boolean;
  endpoint: string;
  headers: Record<string, string>;
  password?: string;
  target: { space: string; baseUrl: string; name?: string };
  openMeldProfile: OpenMeldProfile;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
}): Promise<void> {
  const passwordProtected = !input.clear;
  const requestHeaders = { ...input.headers };
  const response = await fetchSpaceRequestWithTimeout({
    url: input.endpoint,
    operation: input.clear ? "space.password.clear" : "space.password.upsert",
    init: input.clear
      ? {
          method: "DELETE",
          headers: requestHeaders,
        }
      : {
          method: "PUT",
          headers: {
            ...requestHeaders,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            password:
              typeof input.password === "string"
                ? normalizeSpacePasswordText(input.password)
                : "",
          }),
        },
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${raw}`);
  }

  await upsertSpaceConfig({
    openMeldProfileId: input.openMeldProfile.openMeldProfileId,
    baseUrl: input.target.baseUrl,
    space: input.target.space,
    profileName: input.openMeldProfile.profileName,
    passwordProtected,
  });
  emitSpacePasswordMutationSuccess({
    presenter: input.presenter,
    resolvedView: input.resolvedView,
    spaceName: input.target.name,
    spaceId: input.target.space,
    passwordProtected,
  });
}

function emitSpacePasswordMutationSuccess(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  spaceName?: string;
  spaceId: string;
  passwordProtected: boolean;
}): void {
  if (input.resolvedView === "human") {
    renderHumanSpacePasswordResultCard({
      presenter: input.presenter,
      spaceName: input.spaceName,
      spaceId: input.spaceId,
      passwordProtected: input.passwordProtected,
    });
    return;
  }

  input.presenter.line({
    code: input.passwordProtected
      ? "space.password.updated"
      : "space.password.cleared",
    text: formatMessage(
      input.resolvedView,
      input.passwordProtected
        ? "space.password.updated"
        : "space.password.cleared",
      {
        spaceId: input.spaceId,
      }
    ),
    data: {
      spaceId: input.spaceId,
      passwordProtected: input.passwordProtected,
    },
  });
  if (!input.passwordProtected) {
    return;
  }
  input.presenter.line({
    code: "space.password.warning",
    text: formatMessage(input.resolvedView, "space.password.warning"),
  });
}

async function resolveSpacePasswordMutationInput(input: {
  clear?: boolean;
  password?: string;
  allowPrompt: boolean;
  resolvedView: "human" | "agent";
  allowBackToCaller?: boolean;
}): Promise<
  | { status: "submitted"; value: { clear: boolean; password?: string } }
  | { status: "back" }
  | { status: "cancelled" }
> {
  const hasPasswordInput = typeof input.password === "string";
  if (input.clear === true && hasPasswordInput) {
    throw new Error(
      formatOpenMeldCliTextBlock(
        "`openmeld space password`: use either --password <value> or --clear, not both"
      )
    );
  }
  if (input.clear === true) {
    return { status: "submitted", value: { clear: true } };
  }
  if (hasPasswordInput) {
    return {
      status: "submitted",
      value: {
        clear: false,
        password: normalizeSpacePasswordText(input.password ?? ""),
      },
    };
  }
  if (!input.allowPrompt) {
    if (input.resolvedView === "agent") {
      throw createSpaceSubcommandTargetGuideError("password");
    }
    throw new Error(
      formatOpenMeldCliTextBlock(
        "`openmeld space password` requires --password <value> or --clear"
      )
    );
  }

  const action = await select({
    message: "Password action",
    options: [
      { value: "set", label: "Set password" },
      { value: "clear", label: "Clear password" },
      { value: "back", label: "Back" },
    ],
  });
  if (isCancel(action)) {
    cancel("Cancelled.");
    return { status: "cancelled" };
  }
  if (action === "back") {
    if (input.allowBackToCaller !== true) {
      cancel("Cancelled.");
    }
    return {
      status: input.allowBackToCaller === true ? "back" : "cancelled",
    };
  }

  if (action === "clear") {
    return { status: "submitted", value: { clear: true } };
  }
  return { status: "submitted", value: { clear: false } };
}

async function resolveSpacePasswordExecutionInput(input: {
  clear?: boolean;
  password?: string;
  allowPrompt: boolean;
  resolvedView: "human" | "agent";
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  explicitSpace?: string;
  hasExplicitBaseUrlInput: boolean;
  presenter: ReturnType<typeof createPresenter>;
  initialMutationInput?: { clear: boolean; password?: string };
  allowBackToCaller?: boolean;
}): Promise<
  | {
      status: "submitted";
      value: {
        clear: boolean;
        password?: string;
        target: { space: string; baseUrl: string; name?: string };
      };
    }
  | {
      status: "back" | "cancelled";
    }
> {
  if (input.initialMutationInput) {
    const target = await resolveSpacePasswordTarget({
      openMeldProfile: input.openMeldProfile,
      baseUrl: input.baseUrl,
      explicitSpace: input.explicitSpace,
      clear: input.initialMutationInput.clear,
      hasExplicitBaseUrlInput: input.hasExplicitBaseUrlInput,
      presenter: input.presenter,
      resolvedView: input.resolvedView,
      allowPrompt: input.allowPrompt,
    });
    if (target.status !== "submitted") {
      return target;
    }
    return {
      status: "submitted",
      value: {
        clear: input.initialMutationInput.clear,
        ...(typeof input.initialMutationInput.password === "string"
          ? { password: input.initialMutationInput.password }
          : {}),
        target: target.target,
      },
    };
  }

  for (;;) {
    const mutationInput = await resolveSpacePasswordMutationInput({
      clear: input.clear,
      password: input.password,
      allowPrompt: input.allowPrompt,
      resolvedView: input.resolvedView,
      allowBackToCaller: input.allowBackToCaller === true,
    });
    if (mutationInput.status === "cancelled") {
      return { status: "cancelled" };
    }
    if (mutationInput.status === "back") {
      return { status: "back" };
    }
    const target = await resolveSpacePasswordTarget({
      openMeldProfile: input.openMeldProfile,
      baseUrl: input.baseUrl,
      explicitSpace: input.explicitSpace,
      clear: mutationInput.value.clear,
      hasExplicitBaseUrlInput: input.hasExplicitBaseUrlInput,
      presenter: input.presenter,
      resolvedView: input.resolvedView,
      allowPrompt: input.allowPrompt,
    });
    if (target.status === "cancelled") {
      return { status: "cancelled" };
    }
    if (target.status === "back") {
      continue;
    }
    return {
      status: "submitted",
      value: {
        clear: mutationInput.value.clear,
        ...(typeof mutationInput.value.password === "string"
          ? { password: mutationInput.value.password }
          : {}),
        target: target.target,
      },
    };
  }
}

async function resolveSpacePasswordTarget(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  explicitSpace?: string;
  clear: boolean;
  hasExplicitBaseUrlInput: boolean;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  allowPrompt: boolean;
}): Promise<
  | {
      status: "submitted";
      target: { space: string; baseUrl: string; name?: string };
    }
  | {
      status: "back";
    }
  | {
      status: "cancelled";
    }
> {
  const explicitSpace = String(input.explicitSpace ?? "").trim();
  if (explicitSpace.length > 0) {
    assertValidSpaceIdTarget({
      space: explicitSpace,
      resolvedView: input.resolvedView,
    });
    const known = requireReadableSpaceConfigList(
      await listSpaceConfigs({
        openMeldProfileId: input.openMeldProfile.openMeldProfileId,
      }),
      "listing known local spaces for password target resolution"
    );
    const matched = known.find((item) => item.space === explicitSpace);
    return {
      status: "submitted",
      target: {
        space: explicitSpace,
        baseUrl: input.baseUrl,
        ...(matched?.name ? { name: matched.name } : {}),
      },
    };
  }

  if (!input.allowPrompt) {
    if (input.resolvedView === "agent") {
      throw createSpaceSubcommandTargetGuideError("password");
    }
    throw new Error(
      formatMessage(input.resolvedView, "space.target.missing", {
        command: "password",
      })
    );
  }

  const known = await resolveKnownSpacesForSelectionWithLoading({
    openMeldProfile: input.openMeldProfile,
    baseUrl: input.baseUrl,
    command: "password",
    showLoading: input.allowPrompt && input.resolvedView === "human",
  });
  const ownCreatedSpaces = filterKnownSpacesCreatedByProfile({
    known: known.items,
    profileId: input.openMeldProfile.openMeldProfileId,
  });
  const knownSpacesForAction = await resolveKnownSpacesForPasswordSelection({
    known: ownCreatedSpaces,
    clear: input.clear,
    openMeldProfile: input.openMeldProfile,
    baseUrl: input.baseUrl,
  });
  const inlineDeletedNotices =
    input.resolvedView === "human" &&
    known.items.length > 0 &&
    knownSpacesForAction.length > 0
      ? known.deletedNotices
      : [];
  if (inlineDeletedNotices.length === 0) {
    await maybeEmitKnownSpaceDeletedNotices({
      presenter: input.presenter,
      resolvedView: input.resolvedView,
      openMeldProfileId: input.openMeldProfile.openMeldProfileId,
      deletedNotices: known.deletedNotices,
    });
  }
  const target = await promptSpacePasswordTargetSelection({
    known: knownSpacesForAction,
    deletedNotices: inlineDeletedNotices,
    command: "password",
    passwordAction: input.clear ? "clear" : "set",
    resolvedView: input.resolvedView,
    currentProfileId: input.openMeldProfile.openMeldProfileId,
    currentProfileName: input.openMeldProfile.profileName,
    currentOwnerUserId: input.openMeldProfile.ownerUserId,
    visibilityScope: known.visibilityScope,
  });
  if (target.status !== "submitted") {
    return target;
  }
  return {
    status: "submitted",
    target: {
      space: target.target.space,
      baseUrl: input.hasExplicitBaseUrlInput
        ? input.baseUrl
        : (target.target.baseUrl ?? input.baseUrl),
      ...(target.target.name ? { name: target.target.name } : {}),
    },
  };
}

async function resolveSpaceAddMembersTarget(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  mode: SpaceProfileAddMode;
  space?: string;
  allowPrompt: boolean;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  allowBack?: boolean;
}): Promise<SpaceSelectionTargetResult> {
  const explicitSpace = String(input.space ?? "").trim();
  if (explicitSpace.length > 0) {
    assertValidSpaceIdTarget({
      space: explicitSpace,
      resolvedView: input.resolvedView,
    });
    return {
      status: "submitted",
      target: {
        space: explicitSpace,
        baseUrl: input.baseUrl,
      },
    };
  }

  if (!input.allowPrompt) {
    if (input.resolvedView === "agent") {
      throw createSpaceAddMembersGuideError(
        resolveSpaceAddMembersMissingArgumentsSummary(input.mode),
        resolveSpaceAddMembersCommandEntryName(input.mode)
      );
    }
    throw new Error(
      formatOpenMeldCliTextBlock(
        `\`openmeld space ${resolveSpaceAddMembersSelectionCommand(input.mode)}\` requires explicit <space-id> in non-interactive mode`
      )
    );
  }

  const known = await resolveKnownSpacesForSelectionWithLoading({
    openMeldProfile: input.openMeldProfile,
    baseUrl: input.baseUrl,
    command: "add_members",
    showLoading: input.allowPrompt && input.resolvedView === "human",
  });
  if (!(input.resolvedView === "human" && known.items.length > 0)) {
    await maybeEmitKnownSpaceDeletedNotices({
      presenter: input.presenter,
      resolvedView: input.resolvedView,
      openMeldProfileId: input.openMeldProfile.openMeldProfileId,
      deletedNotices: known.deletedNotices,
    });
  }
  return promptSpaceSelectionTarget({
    known: known.items,
    deletedNotices: known.deletedNotices,
    command: "add_members",
    resolvedView: input.resolvedView,
    currentProfileId: input.openMeldProfile.openMeldProfileId,
    currentProfileName: input.openMeldProfile.profileName,
    currentOwnerUserId: input.openMeldProfile.ownerUserId,
    visibilityScope: known.visibilityScope,
    allowBack: input.allowBack === true,
  });
}

async function resolveSpaceRemoveMembersTarget(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  space?: string;
  allowPrompt: boolean;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  allowBack?: boolean;
}): Promise<SpaceSelectionTargetResult> {
  const explicitSpace = String(input.space ?? "").trim();
  if (explicitSpace.length > 0) {
    assertValidSpaceIdTarget({
      space: explicitSpace,
      resolvedView: input.resolvedView,
    });
    return {
      status: "submitted",
      target: {
        space: explicitSpace,
        baseUrl: input.baseUrl,
      },
    };
  }

  if (!input.allowPrompt) {
    if (input.resolvedView === "agent") {
      throw createSpaceRemoveMembersGuideError();
    }
    throw new Error(
      formatOpenMeldCliTextBlock(
        "`openmeld space remove-members` requires explicit <space-id> in non-interactive mode"
      )
    );
  }

  const known = await resolveKnownSpacesForSelectionWithLoading({
    openMeldProfile: input.openMeldProfile,
    baseUrl: input.baseUrl,
    command: "remove_members",
    showLoading: input.allowPrompt && input.resolvedView === "human",
  });
  if (!(input.resolvedView === "human" && known.items.length > 0)) {
    await maybeEmitKnownSpaceDeletedNotices({
      presenter: input.presenter,
      resolvedView: input.resolvedView,
      openMeldProfileId: input.openMeldProfile.openMeldProfileId,
      deletedNotices: known.deletedNotices,
    });
  }
  return promptSpaceSelectionTarget({
    known: known.items,
    deletedNotices: known.deletedNotices,
    command: "remove_members",
    resolvedView: input.resolvedView,
    currentProfileId: input.openMeldProfile.openMeldProfileId,
    currentProfileName: input.openMeldProfile.profileName,
    currentOwnerUserId: input.openMeldProfile.ownerUserId,
    visibilityScope: known.visibilityScope,
    allowBack: input.allowBack === true,
  });
}

async function resolveSpaceLeaveTarget(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  space?: string;
  allowPrompt: boolean;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  allowBack?: boolean;
}): Promise<SpaceSelectionTargetResult> {
  const explicitSpace = String(input.space ?? "").trim();
  if (explicitSpace.length > 0) {
    assertValidSpaceIdTarget({
      space: explicitSpace,
      resolvedView: input.resolvedView,
    });
    return {
      status: "submitted",
      target: {
        space: explicitSpace,
        baseUrl: input.baseUrl,
      },
    };
  }

  if (!input.allowPrompt) {
    if (input.resolvedView === "agent") {
      throw createSpaceLeaveGuideError();
    }
    throw new Error(
      formatOpenMeldCliTextBlock(
        "`openmeld space leave` requires explicit <space-id> in non-interactive mode"
      )
    );
  }

  const known = await resolveKnownSpacesForSelectionWithLoading({
    openMeldProfile: input.openMeldProfile,
    baseUrl: input.baseUrl,
    command: "leave",
    showLoading: input.allowPrompt && input.resolvedView === "human",
  });
  if (!(input.resolvedView === "human" && known.items.length > 0)) {
    await maybeEmitKnownSpaceDeletedNotices({
      presenter: input.presenter,
      resolvedView: input.resolvedView,
      openMeldProfileId: input.openMeldProfile.openMeldProfileId,
      deletedNotices: known.deletedNotices,
    });
  }
  return promptSpaceSelectionTarget({
    known: known.items,
    deletedNotices: known.deletedNotices,
    command: "leave",
    resolvedView: input.resolvedView,
    currentProfileId: input.openMeldProfile.openMeldProfileId,
    currentProfileName: input.openMeldProfile.profileName,
    currentOwnerUserId: input.openMeldProfile.ownerUserId,
    visibilityScope: known.visibilityScope,
    allowBack: input.allowBack === true,
  });
}

async function confirmSpaceLeave(input: {
  target: SpaceSelectionTarget;
  allowPrompt: boolean;
  resolvedView: "human" | "agent";
}): Promise<"confirmed" | "back" | "cancelled"> {
  if (!(input.allowPrompt && input.resolvedView === "human")) {
    return "confirmed";
  }

  const label =
    normalizeOptionalString(input.target.name) ?? input.target.space;
  const confirmed = await confirm({
    message: `Leave space ${label}? You will stop seeing this space in your active list.`,
    initialValue: false,
  });
  if (isCancel(confirmed)) {
    cancel("Cancelled.");
    return "cancelled";
  }
  if (confirmed !== true) {
    cancel("Cancelled.");
    return "cancelled";
  }
  return "confirmed";
}

function mapSpaceLeaveFailureToGuideError(input: {
  error: unknown;
  spaceId: string;
}): Error {
  const failure = toStructuredGatewayFailure(input.error);
  if (failure.code === "space.leave_space.creator_forbidden") {
    return createSpaceLeaveCreatorGuideError({
      spaceId: input.spaceId,
      message: failure.message,
    });
  }
  return input.error instanceof Error
    ? input.error
    : new Error(String(input.error));
}

async function resolveSpaceMemberCandidatesForAdd(input: {
  currentProfile: OpenMeldProfile;
  currentOwnerUserId?: string;
  explicitMemberIds?: readonly string[];
  includeLocalParticipation?: boolean;
  allowCurrentProfileMember?: boolean;
  mode: SpaceProfileAddMode;
  space: string;
  baseUrl: string;
  password?: string;
  progress?: SpaceAddMembersProgressContext;
  membershipSource?: "account" | "organization_directory";
}): Promise<SpaceMemberCandidate[]> {
  const explicitMemberIds = normalizeRequestedMemberIds(
    input.explicitMemberIds
  );
  const includeLocalParticipation = input.includeLocalParticipation !== false;
  const membershipSource = input.membershipSource ?? "account";

  if (input.progress) {
    emitAgentSpaceAddMembersProgress({
      ...input.progress,
      stage: "resolve_candidates",
      phase: "read_profiles",
      summary: "Reading active local profile identities for this Space.",
    });
  }
  const profiles = await listOpenMeldProfiles();
  if (input.progress && includeLocalParticipation) {
    emitAgentSpaceAddMembersProgress({
      ...input.progress,
      stage: "resolve_candidates",
      phase: "read_local_targets",
      summary:
        "Reading local agent controller state for candidate profiles before selection.",
    });
  }
  const localTargetStates =
    await listSpaceAddMembersLocalTargetStatesIfRequested({
      includeLocalParticipation,
      progress: input.progress,
    });
  const localTargetStateById = new Map(
    localTargetStates.map((state) => [state.agentId, state] as const)
  );
  const ownerProfileNameByOwnerUserId =
    buildOwnerProfileNameByOwnerUserId(profiles);
  if (input.progress) {
    emitAgentSpaceAddMembersProgress({
      ...input.progress,
      stage: "resolve_candidates",
      phase: "read_space_members",
      summary: "Reading current Space membership before selecting profiles.",
    });
  }
  const membersSnapshot = await createCliSpaceApi(
    input.baseUrl
  ).getMembersSnapshot({
    spaceId: input.space,
    requestContext: buildOpenMeldRequestContextFromProfile({
      openMeldProfile: input.currentProfile,
    }),
    ...(input.password === undefined ? {} : { spacePassword: input.password }),
  });
  const memberProfileIds = new Set(
    [...membersSnapshot.humans, ...membersSnapshot.agents].map(
      (member) => member.profileId
    )
  );
  const organizationDirectory =
    membershipSource === "organization_directory" &&
    explicitMemberIds.length > 0
      ? await createOrganizationApi(
          createCliApiClientFoundation(input.baseUrl)
        ).getCurrentDirectory()
      : null;
  const plan = buildSpaceProfileAddPlan({
    actingProfileId: input.currentProfile.openMeldProfileId,
    allowCurrentProfile: input.allowCurrentProfileMember === true,
    currentMembers: [...membersSnapshot.humans, ...membersSnapshot.agents],
    currentOwnerUserId: input.currentOwnerUserId,
    mode: input.mode,
    profiles: profiles.map(toSpaceProfileAddProfile),
    selector:
      explicitMemberIds.length > 0
        ? { kind: "profile_ids", profileIds: explicitMemberIds }
        : { kind: "none" },
  });
  if (
    membershipSource === "account" &&
    explicitMemberIds.length > 0 &&
    plan.invalidSelections.length > 0
  ) {
    throw new Error(
      `invalid ${resolveSpaceAddMembersProfileLabel(input.mode)} profile ID(s): ${formatSpaceProfileAddInvalidSelections(
        plan.invalidSelections
      )} (must be your selectable ${resolveSpaceAddMembersProfileLabel(input.mode)} profiles and cannot be the current profile)`
    );
  }
  const profileById = new Map(
    profiles.map((profile) => [profile.openMeldProfileId, profile] as const)
  );
  const candidatePlanEntries =
    explicitMemberIds.length > 0 ? plan.selectedCandidates : plan.candidates;
  const candidateProfiles = candidatePlanEntries
    .filter(
      (candidate) =>
        candidate.excludedReason === null &&
        isSpaceMembershipProfileKind(candidate.profileKind)
    )
    .map((candidate) => profileById.get(candidate.profileId))
    .filter(
      (
        profile
      ): profile is OpenMeldProfile & {
        profileKind: SpaceMembershipProfileKind;
      } =>
        profile !== undefined &&
        isSpaceMembershipProfileKind(profile.profileKind)
    );

  const candidates = await Promise.all(
    candidateProfiles.map((profile) =>
      buildSpaceMemberCandidateFromProfile({
        baseUrl: input.baseUrl,
        profile,
        localTargetStateById,
        ownerProfileName:
          ownerProfileNameByOwnerUserId.get(profile.ownerUserId) ?? undefined,
        alreadyJoined: memberProfileIds.has(profile.openMeldProfileId),
        progress: input.progress,
        includeLocalParticipation,
      })
    )
  );
  const directoryProfileById = organizationDirectory
    ? buildOrganizationDirectoryProfileById(organizationDirectory)
    : new Map<string, OrganizationDirectoryCandidateProfile>();
  const annotatedLocalCandidates = candidates.map((candidate) => {
    const directoryProfile = directoryProfileById.get(candidate.profileId);
    return membershipSource === "organization_directory"
      ? {
          ...candidate,
          organizationDirectoryProfile: directoryProfile !== undefined,
          isOrganizationCenterAgent:
            directoryProfile?.isOrganizationCenterAgent === true,
        }
      : candidate;
  });
  const resolvedCandidates =
    membershipSource === "organization_directory" &&
    explicitMemberIds.length > 0 &&
    organizationDirectory
      ? resolveExplicitOrganizationDirectoryCandidates({
          actingProfileId: input.currentProfile.openMeldProfileId,
          allowCurrentProfileMember: input.allowCurrentProfileMember === true,
          directory: organizationDirectory,
          explicitMemberIds,
          localCandidates: annotatedLocalCandidates,
          memberProfileIds,
          mode: input.mode,
        })
      : annotatedLocalCandidates;
  if (!includeLocalParticipation) {
    return resolvedCandidates;
  }

  return await refreshSpaceMemberCandidatesLocalReadiness(
    resolvedCandidates.filter(
      (candidate) => candidate.openMeldProfile !== undefined
    ),
    input.progress,
    { stage: "resolve_candidates" }
  ).then((localCandidates) => {
    const localCandidateById = new Map(
      localCandidates.map((candidate) => [candidate.profileId, candidate])
    );
    return resolvedCandidates.map(
      (candidate) => localCandidateById.get(candidate.profileId) ?? candidate
    );
  });
}

type OrganizationDirectoryCandidateProfile = {
  profileId: string;
  profileHandle: string;
  profileKind: SpaceMembershipProfileKind;
  profileName: string;
  status: "active" | "disabled";
  ownerUserId: string | null;
  ownerName?: string;
  isOrganizationCenterAgent: boolean;
};

function buildOrganizationDirectoryProfileById(
  directory: OrganizationDirectoryResponse
): Map<string, OrganizationDirectoryCandidateProfile> {
  const profiles: OrganizationDirectoryCandidateProfile[] = [
    ...directory.agentProfiles.map((profile) => ({
      profileId: profile.profileId,
      profileHandle: profile.profileHandle,
      profileKind: profile.profileKind,
      profileName: profile.profileName,
      status: profile.status,
      ownerUserId: profile.ownerUserId,
      ...(profile.ownerName ? { ownerName: profile.ownerName } : {}),
      isOrganizationCenterAgent: profile.isCenterAgent === true,
    })),
    ...directory.members.flatMap((member) =>
      member.humanProfile
        ? [
            {
              profileId: member.humanProfile.profileId,
              profileHandle: member.humanProfile.profileHandle,
              profileKind: "human" as const,
              profileName: member.humanProfile.profileName,
              status: member.humanProfile.status,
              ownerUserId: member.userId,
              ownerName: member.user.name,
              isOrganizationCenterAgent: false,
            },
          ]
        : []
    ),
  ];
  return new Map(profiles.map((profile) => [profile.profileId, profile]));
}

function resolveExplicitOrganizationDirectoryCandidates(input: {
  actingProfileId: string;
  allowCurrentProfileMember: boolean;
  directory: OrganizationDirectoryResponse;
  explicitMemberIds: readonly string[];
  localCandidates: SpaceMemberCandidate[];
  memberProfileIds: ReadonlySet<string>;
  mode: SpaceProfileAddMode;
}): SpaceMemberCandidate[] {
  const directoryProfileById = buildOrganizationDirectoryProfileById(
    input.directory
  );
  const localCandidateById = new Map(
    input.localCandidates.map((candidate) => [candidate.profileId, candidate])
  );
  const selectableProfileById = new Map<string, SpaceProfileAddProfile>(
    [...directoryProfileById.values()].map((profile) => [
      profile.profileId,
      {
        ownerName: profile.ownerName,
        ownerUserId: profile.ownerUserId,
        profileId: profile.profileId,
        profileKind: profile.profileKind,
        profileName: profile.profileName,
        status: profile.status,
      },
    ])
  );
  for (const candidate of input.localCandidates) {
    if (!selectableProfileById.has(candidate.profileId)) {
      selectableProfileById.set(candidate.profileId, {
        ownerName: candidate.ownerName,
        ownerUserId: candidate.ownerUserId,
        profileId: candidate.profileId,
        profileKind: candidate.profileKind,
        profileName: candidate.profileName,
        status: "active",
      });
    }
  }
  const selectionPlan = buildSpaceProfileAddPlan({
    actingProfileId: input.actingProfileId,
    allowCurrentProfile: input.allowCurrentProfileMember,
    currentMembers: [],
    mode: input.mode,
    profiles: [...selectableProfileById.values()],
    selector: { kind: "profile_ids", profileIds: input.explicitMemberIds },
  });
  if (selectionPlan.invalidSelections.length > 0) {
    throw new Error(
      `invalid ${resolveSpaceAddMembersProfileLabel(input.mode)} profile ID(s): ${formatSpaceProfileAddInvalidSelections(
        selectionPlan.invalidSelections
      )} (must be your active selectable profiles or active profiles in the current Organization Directory, and cannot be the current profile)`
    );
  }
  return selectionPlan.selectedProfileIds.map((profileId) => {
    const directoryProfile = directoryProfileById.get(profileId);
    const localCandidate = localCandidateById.get(profileId);
    if (localCandidate) {
      return {
        ...localCandidate,
        organizationDirectoryProfile: directoryProfile !== undefined,
        isOrganizationCenterAgent:
          directoryProfile?.isOrganizationCenterAgent === true,
      };
    }
    if (!directoryProfile) {
      throw new Error(
        `Selected profile disappeared while resolving ${profileId}`
      );
    }
    return {
      profileId: directoryProfile.profileId,
      profileHandle: directoryProfile.profileHandle,
      profileName: directoryProfile.profileName,
      profileKind: directoryProfile.profileKind,
      ownerUserId: directoryProfile.ownerUserId ?? undefined,
      ownerName: directoryProfile.ownerName,
      alreadyJoined: input.memberProfileIds.has(directoryProfile.profileId),
      needsActivation: false,
      organizationDirectoryProfile: true,
      isOrganizationCenterAgent: directoryProfile.isOrganizationCenterAgent,
      localParticipationChecked: false,
      localParticipationReasonCodes: [],
      localParticipationReadiness: null,
      localParticipationReasonText: null,
    };
  });
}

function formatSpaceProfileAddInvalidSelections(
  invalidSelections: readonly SpaceProfileAddInvalidSelection[]
): string {
  return invalidSelections
    .map(
      (selection) =>
        `${selection.profileId} (${formatSpaceProfileAddInvalidSelectionReason(
          selection.reason
        )})`
    )
    .join(", ");
}

function formatSpaceProfileAddInvalidSelectionReason(
  reason: SpaceProfileAddInvalidSelection["reason"]
): string {
  switch (reason) {
    case "current_acting_profile":
      return "this is the current acting profile";
    case "different_owner":
      return "this profile belongs to a different account";
    case "inactive_profile":
      return "this profile is not active";
    case "kind_mismatch":
      return "this profile kind does not match this command";
    case "not_found":
      return "this profile was not found in this account";
    case "unsupported_profile_kind":
      return "this profile kind cannot be a Space member";
    default:
      assertNeverSpaceProfileAddInvalidSelectionReason(reason);
  }
}

function assertNeverSpaceProfileAddInvalidSelectionReason(value: never): never {
  throw new Error(
    `unexpected space profile add invalid reason: ${String(value)}`
  );
}

async function listSpaceAddMembersLocalTargetStatesIfRequested(input: {
  includeLocalParticipation: boolean;
  progress?: SpaceAddMembersProgressContext;
}): Promise<AgentTargetState[]> {
  if (!input.includeLocalParticipation) {
    return [];
  }
  if (!input.progress) {
    return await listAgentTargetStates().catch(() => []);
  }
  return await runSpaceAddMembersProgressHeartbeat({
    ...input.progress,
    stage: "resolve_candidates",
    phase: "read_local_targets_wait",
    summary:
      "Still reading local agent controller state for candidate profiles before selection.",
    operation: async () => await listAgentTargetStates().catch(() => []),
  });
}

async function resolveSpaceMemberCandidateAgentControllerReportIfRequested(input: {
  baseUrl: string;
  includeLocalParticipation: boolean;
  profile: OpenMeldProfile;
  progress?: SpaceAddMembersProgressContext;
}): Promise<Awaited<
  ReturnType<typeof resolveAgentProfilePrimaryAgentControllerReport>
> | null> {
  if (!input.includeLocalParticipation) {
    return null;
  }
  if (!input.progress) {
    return await resolveAgentProfilePrimaryAgentControllerReport({
      baseUrl: input.baseUrl,
      profile: input.profile,
    }).catch(() => null);
  }
  return await runSpaceAddMembersProgressHeartbeat({
    ...input.progress,
    stage: "resolve_candidates",
    phase: "read_agent_controller_report_wait",
    summary: `Still reading execution target projection for ${resolveSpaceMemberTerminalProfileLabel(
      input.profile.profileName
    )}.`,
    profileId: input.profile.openMeldProfileId,
    profileIds: [input.profile.openMeldProfileId],
    operation: async () =>
      await resolveAgentProfilePrimaryAgentControllerReport({
        baseUrl: input.baseUrl,
        profile: input.profile,
      }).catch(() => null),
  });
}

async function buildSpaceMemberCandidateFromProfile(input: {
  baseUrl: string;
  profile: OpenMeldProfile & { profileKind: SpaceMembershipProfileKind };
  localTargetStateById: ReadonlyMap<string, AgentTargetState>;
  ownerProfileName?: string;
  alreadyJoined: boolean;
  progress?: SpaceAddMembersProgressContext;
  includeLocalParticipation?: boolean;
}): Promise<SpaceMemberCandidate> {
  const includeLocalParticipation = input.includeLocalParticipation !== false;
  if (input.progress && includeLocalParticipation) {
    emitAgentSpaceAddMembersProgress({
      ...input.progress,
      stage: "resolve_candidates",
      phase: "read_agent_controller_report",
      summary: `Reading execution target projection for ${resolveSpaceMemberTerminalProfileLabel(
        input.profile.profileName
      )}.`,
      profileId: input.profile.openMeldProfileId,
      profileIds: [input.profile.openMeldProfileId],
    });
  }
  const executionTarget =
    await resolveSpaceMemberCandidateAgentControllerReportIfRequested({
      baseUrl: input.baseUrl,
      includeLocalParticipation,
      profile: input.profile,
      progress: input.progress,
    });
  const agentControllerRef = executionTarget?.agentControllerRef ?? undefined;
  const controllerEnabled =
    executionTarget?.bindingState === "enabled_primary" &&
    executionTarget.routable;
  const localTargetAgentId = resolveSpaceMemberCandidateLocalTargetAgentId({
    profileKind: input.profile.profileKind,
    agentControllerRef,
    controllerEnabled,
  });
  const localTargetState = localTargetAgentId
    ? (input.localTargetStateById.get(localTargetAgentId) ?? null)
    : null;

  return {
    openMeldProfile: input.profile,
    profileId: input.profile.openMeldProfileId,
    profileHandle: input.profile.profileHandle,
    profileName: input.profile.profileName,
    profileKind: input.profile.profileKind,
    ownerProfileName: input.ownerProfileName,
    ownerUserId: input.profile.ownerUserId,
    ownerName: input.profile.ownerName,
    agentControllerRef,
    controllerEnabled,
    localTargetAgentId,
    localTargetDisplayName: localTargetState?.displayName ?? null,
    localTargetLaunchStatus: localTargetState?.launchStatus ?? null,
    localTargetSelectable: localTargetState?.selectable ?? false,
    localParticipationReadiness: null,
    localParticipationChecked: false,
    localParticipationReasonCodes: [],
    localParticipationReasonText: null,
    alreadyJoined: input.alreadyJoined,
    needsActivation: false,
  };
}

function resolveSpaceMemberCandidateLocalTargetAgentId(input: {
  profileKind: SpaceMembershipProfileKind;
  agentControllerRef?: string | null;
  controllerEnabled?: boolean | null;
}): string | null {
  if (
    input.profileKind !== "agent" ||
    input.controllerEnabled !== true ||
    typeof input.agentControllerRef !== "string"
  ) {
    return null;
  }
  const agentControllerRef = input.agentControllerRef.trim();
  if (!agentControllerRef) {
    return null;
  }
  if (agentControllerRef.startsWith("builtin:")) {
    const builtinAgentId =
      normalizeBuiltinAgentControllerId(agentControllerRef);
    return builtinAgentId || null;
  }
  return agentControllerRef;
}

function toSpaceProfileAddProfile(
  profile: OpenMeldProfile
): SpaceProfileAddProfile {
  return {
    createdAt: profile.createdAt,
    isDefault: profile.isDefault,
    lastUsedAt: profile.lastUsedAt,
    ownerName: profile.ownerName,
    ownerUserId: profile.ownerUserId,
    profileId: profile.openMeldProfileId,
    profileKind: profile.profileKind,
    profileName: profile.profileName,
    status: profile.status,
  };
}

async function resolveSpaceMemberCandidatesForRemove(input: {
  currentProfile: OpenMeldProfile;
  currentOwnerUserId?: string;
  space: string;
  baseUrl: string;
  password?: string;
}): Promise<ResolvedSpaceRemoveMemberCandidates> {
  const membersSnapshot = await createCliSpaceApi(
    input.baseUrl
  ).getMembersSnapshot({
    spaceId: input.space,
    requestContext: buildOpenMeldRequestContextFromProfile({
      openMeldProfile: input.currentProfile,
    }),
    ...(input.password === undefined ? {} : { spacePassword: input.password }),
  });

  const currentOwnerUserId = normalizeOptionalString(input.currentOwnerUserId);
  const creatorProfileIds = new Set<string>();
  const allProfiles = await listOpenMeldProfiles();
  const localProfileById = new Map(
    allProfiles.map((profile) => [profile.openMeldProfileId, profile] as const)
  );
  const snapshotMembers = [
    ...membersSnapshot.humans,
    ...membersSnapshot.agents,
  ].filter((member) => member.status === "active");
  const targetMentionLabelByProfileId =
    buildSpacePrimaryMentionLabelByProfileId(membersSnapshot);
  for (const member of snapshotMembers) {
    if (member.memberSource === "space_creator") {
      creatorProfileIds.add(member.profileId);
    }
  }

  const activeMembers = snapshotMembers
    .filter((member) => {
      if (!currentOwnerUserId) {
        return true;
      }
      return normalizeOptionalString(member.ownerUserId) === currentOwnerUserId;
    })
    .filter(
      (member) => member.profileId !== input.currentProfile.openMeldProfileId
    )
    .filter((member) => member.memberSource !== "space_creator")
    .map((member) =>
      hydrateSpaceRemoveMemberCandidate({
        candidate: toSpaceRemoveMemberCandidateFromSnapshot({
          member,
          targetMentionLabel:
            targetMentionLabelByProfileId.get(member.profileId) ?? null,
        }),
        profile: localProfileById.get(member.profileId),
      })
    )
    .sort((left, right) => {
      const byName = left.profileName.localeCompare(right.profileName);
      if (byName !== 0) {
        return byName;
      }
      return left.profileId.localeCompare(right.profileId);
    });

  const explicitFallbackById = new Map<string, SpaceRemoveMemberCandidate>();
  for (const profile of allProfiles) {
    const { profileKind } = profile;
    if (
      profile.status !== "active" ||
      !isSpaceMembershipProfileKind(profileKind)
    ) {
      continue;
    }
    if (profile.openMeldProfileId === input.currentProfile.openMeldProfileId) {
      continue;
    }
    if (
      currentOwnerUserId &&
      normalizeOptionalString(profile.ownerUserId) !== currentOwnerUserId
    ) {
      continue;
    }
    explicitFallbackById.set(
      profile.openMeldProfileId,
      toSpaceRemoveMemberCandidateFromProfile({
        ...profile,
        profileKind,
      })
    );
  }

  return {
    activeMembers,
    explicitFallbackById,
    creatorProfileIds,
  };
}

function buildOwnerProfileNameByOwnerUserId(
  profiles: readonly OpenMeldProfile[]
): Map<string, string> {
  const ownerProfileMap = new Map<string, string>();
  const activeProfiles = profiles.filter(
    (profile) => profile.status === "active"
  );
  const activeHumanProfiles = activeProfiles.filter(
    (profile): profile is OpenMeldProfile & { profileKind: "human" } =>
      profile.profileKind === "human"
  );

  for (const profile of activeHumanProfiles) {
    const ownerUserId = normalizeOptionalString(profile.ownerUserId);
    const profileName = normalizeOptionalString(profile.profileName);
    if (!(ownerUserId && profileName)) {
      continue;
    }
    if (!ownerProfileMap.has(ownerUserId)) {
      ownerProfileMap.set(ownerUserId, profileName);
      continue;
    }
    if (profile.isDefault === true) {
      ownerProfileMap.set(ownerUserId, profileName);
    }
  }

  return ownerProfileMap;
}

function resolveSpaceAddMemberSelection(input: {
  space: string;
  candidates: SpaceMemberCandidate[];
  currentProfileId: string;
  explicitMembers?: string[];
  selectAll: boolean;
  mode: SpaceProfileAddMode;
  allowPrompt: boolean;
  resolvedView: "human" | "agent";
  presenter: ReturnType<typeof createPresenter>;
  initialSelectedProfileIds?: string[];
  requiredSelection?: boolean;
  allowCurrentProfileMember?: boolean;
  allowBack?: boolean;
  emitCancelMessage?: boolean;
}): Promise<string[] | null> {
  const explicitMemberIds = normalizeRequestedMemberIds(input.explicitMembers);
  const candidateById = new Map(
    input.candidates.map(
      (candidate) => [candidate.profileId, candidate] as const
    )
  );
  const initialSelectedProfileIds = normalizeRequestedMemberIds(
    input.initialSelectedProfileIds
  ).filter((profileId) => {
    const candidate = candidateById.get(profileId);
    return candidate?.alreadyJoined === false;
  });
  const explicitSelection = resolveExplicitSpaceAddMemberSelection({
    space: input.space,
    candidates: input.candidates,
    currentProfileId: input.currentProfileId,
    explicitMemberIds,
    selectAll: input.selectAll,
    mode: input.mode,
    presenter: input.presenter,
    candidateById,
    allowCurrentProfileMember: input.allowCurrentProfileMember === true,
  });
  if (explicitSelection !== undefined) {
    return Promise.resolve(explicitSelection);
  }

  ensureSpaceAddMemberPromptAllowed({
    allowPrompt: input.allowPrompt,
    mode: input.mode,
    resolvedView: input.resolvedView,
  });

  const selectableCount = input.candidates.filter(
    (candidate) => !candidate.alreadyJoined
  ).length;
  if (selectableCount === 0) {
    input.presenter.line({
      code: "space.add_members.none_selectable",
      text: "All eligible profiles are already in this space.",
      data: { spaceId: input.space },
    });
    return Promise.resolve([]);
  }

  return promptInteractiveSpaceAddMemberSelection({
    candidates: input.candidates,
    resolvedView: input.resolvedView,
    requiredSelection: input.requiredSelection,
    allowBack: input.allowBack,
    emitCancelMessage: input.emitCancelMessage,
    initialSelectedProfileIds,
  });
}

function resolveExplicitSpaceAddMemberSelection(input: {
  space: string;
  candidates: SpaceMemberCandidate[];
  currentProfileId: string;
  explicitMemberIds: string[];
  selectAll: boolean;
  mode: SpaceProfileAddMode;
  presenter: ReturnType<typeof createPresenter>;
  candidateById: ReadonlyMap<string, SpaceMemberCandidate>;
  allowCurrentProfileMember: boolean;
}): string[] | undefined {
  if (input.selectAll || input.explicitMemberIds.length > 0) {
    validateSpaceMemberSelectionInput({
      all: input.selectAll,
      command: resolveSpaceAddMembersSelectionCommand(input.mode),
      explicitMemberIds: input.explicitMemberIds,
    });
  }

  if (input.explicitMemberIds.length > 0) {
    if (
      input.explicitMemberIds.includes(input.currentProfileId) &&
      !input.allowCurrentProfileMember
    ) {
      throw createSpaceAddMembersCurrentProfileGuideError({
        profileId: input.currentProfileId,
      });
    }
    const invalid = input.explicitMemberIds.filter(
      (profileId) => !input.candidateById.has(profileId)
    );
    if (invalid.length > 0) {
      throw new Error(
        `invalid ${resolveSpaceAddMembersProfileLabel(input.mode)} profile ID(s): ${invalid.join(", ")} (must be your selectable ${resolveSpaceAddMembersProfileLabel(input.mode)} profiles and cannot be the current profile)`
      );
    }
    return input.explicitMemberIds;
  }

  if (!input.selectAll) {
    return undefined;
  }

  const selectable = input.candidates
    .filter((candidate) => !candidate.alreadyJoined)
    .map((candidate) => candidate.profileId);
  if (selectable.length === 0) {
    input.presenter.line({
      code: "space.add_members.all_already_joined",
      text: "All eligible profiles are already in this space.",
      data: { spaceId: input.space },
    });
    return [];
  }
  return selectable;
}

function resolveSpaceAddMembersSelectionCommand(
  mode: SpaceProfileAddMode
): "add-agents" | "add-human-profiles" | "add-members" {
  switch (mode) {
    case "agents":
      return "add-agents";
    case "human_profiles":
      return "add-human-profiles";
    case "profiles":
      return "add-members";
    default:
      assertNeverSpaceAddMembersMode(mode);
  }
}

function resolveSpaceAddMembersCommandEntryName(
  mode: SpaceProfileAddMode
): "space.add-agents" | "space.add-human-profiles" | "space.add-members" {
  switch (mode) {
    case "agents":
      return "space.add-agents";
    case "human_profiles":
      return "space.add-human-profiles";
    case "profiles":
      return "space.add-members";
    default:
      assertNeverSpaceAddMembersMode(mode);
  }
}

function resolveSpaceAddMembersMissingArgumentsSummary(
  mode: SpaceProfileAddMode
): string {
  switch (mode) {
    case "agents":
      return "openmeld space add-agents in agent/non-interactive mode requires explicit space and Agent Profile arguments.";
    case "human_profiles":
      return "openmeld space add-human-profiles in agent/non-interactive mode requires explicit space and Human Profile arguments.";
    case "profiles":
      return "openmeld space add-members in agent/non-interactive mode requires explicit space and member arguments.";
    default:
      assertNeverSpaceAddMembersMode(mode);
  }
}

function resolveSpaceAddMembersSelectorRequiredText(
  mode: SpaceProfileAddMode
): string {
  switch (mode) {
    case "agents":
      return "`openmeld space add-agents` requires --agent-profile <agent-profile-id...> or --all in non-interactive mode";
    case "human_profiles":
      return "`openmeld space add-human-profiles` requires --human-profile <human-profile-id...> or --all in non-interactive mode";
    case "profiles":
      return "`openmeld space add-members` requires --member <profile-id...> or --all in non-interactive mode";
    default:
      assertNeverSpaceAddMembersMode(mode);
  }
}

function resolveSpaceAddMembersProfileLabel(mode: SpaceProfileAddMode): string {
  switch (mode) {
    case "agents":
      return "agent";
    case "human_profiles":
      return "human";
    case "profiles":
      return "member";
    default:
      assertNeverSpaceAddMembersMode(mode);
  }
}

function ensureSpaceAddMemberPromptAllowed(input: {
  allowPrompt: boolean;
  mode: SpaceProfileAddMode;
  resolvedView: "human" | "agent";
}): void {
  if (input.allowPrompt) {
    return;
  }

  if (input.resolvedView === "agent") {
    throw createSpaceAddMembersGuideError(
      resolveSpaceAddMembersMissingArgumentsSummary(input.mode),
      resolveSpaceAddMembersCommandEntryName(input.mode)
    );
  }
  throw new Error(
    formatOpenMeldCliTextBlock(
      resolveSpaceAddMembersSelectorRequiredText(input.mode)
    )
  );
}

function assertNeverSpaceAddMembersMode(value: never): never {
  throw new Error(`unexpected space add-members mode: ${String(value)}`);
}

async function promptInteractiveSpaceAddMemberSelection(input: {
  candidates: SpaceMemberCandidate[];
  resolvedView: "human" | "agent";
  requiredSelection?: boolean;
  allowBack?: boolean;
  emitCancelMessage?: boolean;
  initialSelectedProfileIds: string[];
}): Promise<string[] | null> {
  const orderedCandidates = sortSpaceMemberCandidatesForPrompt({
    candidates: input.candidates,
    initialSelectedProfileIds: input.initialSelectedProfileIds,
  });
  if (input.resolvedView === "human") {
    return promptHumanSpaceAddMemberSelection({
      candidates: orderedCandidates,
      requiredSelection: input.requiredSelection,
      allowBack: input.allowBack,
      emitCancelMessage: input.emitCancelMessage,
      initialSelectedProfileIds: input.initialSelectedProfileIds,
    });
  }

  const selected = await multiselect({
    message: getChooseProfilesToBringMessage(),
    options: orderedCandidates.map((candidate) => ({
      value: candidate.profileId,
      label: formatSpaceMemberCandidateLabel(candidate),
      hint: formatSpaceMemberCandidateHint(candidate),
      disabled: candidate.alreadyJoined,
    })),
    required: input.requiredSelection ?? true,
    ...(input.initialSelectedProfileIds.length > 0
      ? { initialValues: input.initialSelectedProfileIds }
      : {}),
  });
  if (isCancel(selected)) {
    if (input.emitCancelMessage !== false) {
      cancel("Cancelled.");
    }
    return null;
  }

  const normalized = normalizeRequestedMemberIds(selected);
  return normalized.length > 0 ? normalized : [];
}

async function promptHumanSpaceAddMemberSelection(input: {
  candidates: SpaceMemberCandidate[];
  requiredSelection?: boolean;
  allowBack?: boolean;
  emitCancelMessage?: boolean;
  initialSelectedProfileIds: string[];
}): Promise<string[] | null> {
  const selected = await promptSearchMultiselect({
    message: getChooseProfilesToBringMessage(),
    items: input.candidates.map((candidate) =>
      buildHumanSpaceMemberCandidateSearchItem(candidate)
    ),
    maxVisible: 8,
    required: input.requiredSelection ?? true,
    allowBack: input.allowBack === true,
    backLabel: "Back",
    ...(input.initialSelectedProfileIds.length > 0
      ? { initialSelectedValues: input.initialSelectedProfileIds }
      : {}),
  });
  if (selected.status !== "submitted") {
    if (input.emitCancelMessage !== false) {
      cancel("Cancelled.");
    }
    return null;
  }

  const normalized = normalizeRequestedMemberIds(selected.value);
  return normalized.length > 0 ? normalized : [];
}

function sortSpaceMemberCandidatesForPrompt(input: {
  candidates: SpaceMemberCandidate[];
  initialSelectedProfileIds: string[];
}): SpaceMemberCandidate[] {
  if (input.initialSelectedProfileIds.length === 0) {
    return input.candidates;
  }

  const selectedProfileIds = new Set(input.initialSelectedProfileIds);
  return [...input.candidates].sort((left, right) => {
    const leftSelected = selectedProfileIds.has(left.profileId);
    const rightSelected = selectedProfileIds.has(right.profileId);
    if (leftSelected === rightSelected) {
      return 0;
    }
    return leftSelected ? -1 : 1;
  });
}

async function resolveSpaceRemoveMemberSelection(input: {
  space: string;
  candidates: ResolvedSpaceRemoveMemberCandidates;
  currentProfileId: string;
  explicitMembers?: string[];
  selectAll: boolean;
  allowPrompt: boolean;
  resolvedView: "human" | "agent";
  presenter: ReturnType<typeof createPresenter>;
  allowBack?: boolean;
  emitCancelMessage?: boolean;
}): Promise<SpaceRemoveMemberCandidate[] | null> {
  const explicitMemberIds = normalizeRequestedMemberIds(input.explicitMembers);
  const activeCandidateById = new Map(
    input.candidates.activeMembers.map(
      (candidate) => [candidate.profileId, candidate] as const
    )
  );
  const explicitSelection = resolveExplicitSpaceRemoveMemberSelection({
    space: input.space,
    activeCandidates: input.candidates.activeMembers,
    explicitFallbackById: input.candidates.explicitFallbackById,
    creatorProfileIds: input.candidates.creatorProfileIds,
    currentProfileId: input.currentProfileId,
    explicitMemberIds,
    selectAll: input.selectAll,
    presenter: input.presenter,
  });
  if (explicitSelection !== undefined) {
    return explicitSelection;
  }

  ensureSpaceRemoveMemberPromptAllowed({
    allowPrompt: input.allowPrompt,
    resolvedView: input.resolvedView,
  });

  if (input.candidates.activeMembers.length === 0) {
    input.presenter.line({
      code: "space.remove_members.none_selectable",
      text: "No removable members are available in this space.",
      data: { spaceId: input.space },
    });
    return [];
  }

  const selectedProfileIds = await promptInteractiveSpaceRemoveMemberSelection({
    candidates: input.candidates.activeMembers,
    resolvedView: input.resolvedView,
    allowBack: input.allowBack,
    emitCancelMessage: input.emitCancelMessage,
  });
  if (selectedProfileIds === null) {
    return null;
  }

  return selectedProfileIds
    .map((profileId) => activeCandidateById.get(profileId))
    .filter((candidate): candidate is SpaceRemoveMemberCandidate =>
      Boolean(candidate)
    );
}

function resolveExplicitSpaceRemoveMemberSelection(input: {
  space: string;
  activeCandidates: SpaceRemoveMemberCandidate[];
  explicitFallbackById: ReadonlyMap<string, SpaceRemoveMemberCandidate>;
  creatorProfileIds: ReadonlySet<string>;
  currentProfileId: string;
  explicitMemberIds: string[];
  selectAll: boolean;
  presenter: ReturnType<typeof createPresenter>;
}): SpaceRemoveMemberCandidate[] | undefined {
  if (input.selectAll || input.explicitMemberIds.length > 0) {
    validateSpaceMemberSelectionInput({
      all: input.selectAll,
      command: "remove-members",
      explicitMemberIds: input.explicitMemberIds,
    });
  }

  const combinedCandidateById = new Map<string, SpaceRemoveMemberCandidate>();
  for (const [profileId, candidate] of input.explicitFallbackById) {
    combinedCandidateById.set(profileId, candidate);
  }
  for (const candidate of input.activeCandidates) {
    combinedCandidateById.set(candidate.profileId, candidate);
  }

  if (input.explicitMemberIds.length > 0) {
    if (input.explicitMemberIds.includes(input.currentProfileId)) {
      throw createSpaceRemoveMembersCurrentProfileGuideError({
        profileId: input.currentProfileId,
      });
    }
    const creatorProfileId = input.explicitMemberIds.find((profileId) =>
      input.creatorProfileIds.has(profileId)
    );
    if (creatorProfileId) {
      throw createSpaceRemoveMembersCreatorGuideError({
        profileId: creatorProfileId,
      });
    }
    const invalid = input.explicitMemberIds.filter(
      (profileId) => !combinedCandidateById.has(profileId)
    );
    if (invalid.length > 0) {
      throw new Error(
        `invalid member profile ID(s): ${invalid.join(", ")} (must be removable members you manage for this space)`
      );
    }
    return input.explicitMemberIds
      .map((profileId) => combinedCandidateById.get(profileId))
      .filter((candidate): candidate is SpaceRemoveMemberCandidate =>
        Boolean(candidate)
      );
  }

  if (!input.selectAll) {
    return undefined;
  }

  if (input.activeCandidates.length === 0) {
    input.presenter.line({
      code: "space.remove_members.all_absent",
      text: "No removable members are currently active in this space.",
      data: { spaceId: input.space },
    });
    return [];
  }
  return input.activeCandidates;
}

function ensureSpaceRemoveMemberPromptAllowed(input: {
  allowPrompt: boolean;
  resolvedView: "human" | "agent";
}): void {
  if (input.allowPrompt) {
    return;
  }

  if (input.resolvedView === "agent") {
    throw createSpaceRemoveMembersGuideError();
  }
  throw new Error(
    formatOpenMeldCliTextBlock(
      "`openmeld space remove-members` requires --member <profile-id...> or --all in non-interactive mode"
    )
  );
}

async function promptInteractiveSpaceRemoveMemberSelection(input: {
  candidates: SpaceRemoveMemberCandidate[];
  resolvedView: "human" | "agent";
  allowBack?: boolean;
  emitCancelMessage?: boolean;
}): Promise<string[] | null> {
  if (input.resolvedView === "human") {
    return promptHumanSpaceRemoveMemberSelection(input);
  }

  const selected = await multiselect({
    message: getChooseMembersToRemoveMessage(),
    options: input.candidates.map((candidate) => ({
      value: candidate.profileId,
      label: formatSpaceRemoveMemberCandidateLabel(candidate),
      hint: formatSpaceRemoveMemberCandidateHint(candidate),
    })),
    required: true,
  });
  if (isCancel(selected)) {
    if (input.emitCancelMessage !== false) {
      cancel("Cancelled.");
    }
    return null;
  }
  const normalized = normalizeRequestedMemberIds(selected);
  return normalized.length > 0 ? normalized : [];
}

async function promptHumanSpaceRemoveMemberSelection(input: {
  candidates: SpaceRemoveMemberCandidate[];
  allowBack?: boolean;
  emitCancelMessage?: boolean;
}): Promise<string[] | null> {
  const selected = await promptSearchMultiselect({
    message: getChooseMembersToRemoveMessage(),
    items: input.candidates.map((candidate) =>
      buildHumanSpaceRemoveMemberCandidateSearchItem(candidate)
    ),
    maxVisible: 8,
    required: true,
    allowBack: input.allowBack === true,
    backLabel: "Back",
  });
  if (selected.status !== "submitted") {
    if (input.emitCancelMessage !== false) {
      cancel("Cancelled.");
    }
    return null;
  }
  const normalized = normalizeRequestedMemberIds(selected.value);
  return normalized.length > 0 ? normalized : [];
}

async function applySpaceAddMembers(input: {
  actorProfile: OpenMeldProfile;
  candidates: SpaceMemberCandidate[];
  space: string;
  spaceName?: string | null;
  baseUrl: string;
  password?: string;
  membershipSource?: "account" | "organization_directory";
}): Promise<SpaceAddMembersResult> {
  const result: SpaceAddMembersResult = {
    added: [],
    alreadyJoined: [],
    failed: [],
    warnings: [],
  };
  const gatewayHost = resolveGatewayHost(input.baseUrl);
  if (!gatewayHost) {
    throw new Error(`invalid gateway baseUrl: ${input.baseUrl}`);
  }

  const selectedCandidates = input.candidates.filter(
    (candidate) => !candidate.alreadyJoined
  );
  for (const candidate of input.candidates) {
    if (candidate.alreadyJoined) {
      result.alreadyJoined.push(candidate);
    }
  }
  if (selectedCandidates.length === 0) {
    return result;
  }

  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile: input.actorProfile,
  });
  const requestId = requestContext.actorContext.requestId;
  let response: PostSpaceMembersResponse;
  try {
    response = await postSelectedSpaceMembers({
      baseUrl: input.baseUrl,
      candidates: selectedCandidates,
      membershipSource: input.membershipSource ?? "account",
      password: input.password,
      requestContext,
      space: input.space,
    });
  } catch (error) {
    for (const candidate of selectedCandidates) {
      result.failed.push({
        candidate,
        error,
      });
    }
    return result;
  }

  const addedProfileIds = new Set(response.addedMemberIds);
  const alreadyMemberProfileIds = new Set(response.alreadyMemberIds);
  const responseItemByProfileId = new Map(
    response.items.map((item) => [item.profileId, item] as const)
  );
  const lastJoinedAt = new Date().toISOString();
  const spaceName = normalizeOptionalString(input.spaceName);

  for (const candidate of selectedCandidates) {
    const nextCandidate = hydrateSpaceMemberCandidateFromResponseItem({
      candidate,
      item: responseItemByProfileId.get(candidate.profileId),
    });
    if (addedProfileIds.has(candidate.profileId)) {
      result.added.push(nextCandidate);
      continue;
    }
    if (alreadyMemberProfileIds.has(candidate.profileId)) {
      result.alreadyJoined.push(nextCandidate);
    }
  }

  for (const candidate of result.added.filter(
    (addedCandidate) => addedCandidate.openMeldProfile !== undefined
  )) {
    try {
      await upsertProfileSpaceHistory({
        baseUrl: input.baseUrl,
        requestContext: buildSpaceMemberHistoryRequestContext({
          candidate,
          requestId,
        }),
        openMeldProfileId: candidate.profileId,
        profileName: candidate.profileName,
        spaceId: input.space,
        body: {
          gatewayHost,
          ...(spaceName ? { spaceName } : {}),
          status: "active",
          lastJoinedAt,
        },
      });
    } catch (error) {
      result.warnings.push({
        candidate,
        error,
      });
    }
  }

  return result;
}

async function postSelectedSpaceMembers(input: {
  baseUrl: string;
  candidates: SpaceMemberCandidate[];
  membershipSource: "account" | "organization_directory";
  password?: string;
  requestContext: OpenMeldRequestContext;
  space: string;
}): Promise<PostSpaceMembersResponse> {
  const memberProfileIds = input.candidates.map(
    (candidate) => candidate.profileId
  );
  if (input.membershipSource === "account") {
    return await postSpaceMembers({
      requestContext: input.requestContext,
      baseUrl: input.baseUrl,
      space: input.space,
      password: input.password,
      memberProfileIds,
    });
  }

  const accountOnlyCandidates = input.candidates.filter(
    (candidate) => candidate.organizationDirectoryProfile !== true
  );
  if (
    accountOnlyCandidates.length > 0 &&
    accountOnlyCandidates.length === input.candidates.length
  ) {
    return await postSpaceMembers({
      requestContext: input.requestContext,
      baseUrl: input.baseUrl,
      space: input.space,
      password: input.password,
      memberProfileIds,
    });
  }
  if (accountOnlyCandidates.length > 0) {
    throw new Error(
      "Cannot combine Organization Directory profiles with account-only profiles in one membership request. Add them with separate commands."
    );
  }

  const centerAgentProfileIds = input.candidates
    .filter((candidate) => candidate.isOrganizationCenterAgent === true)
    .map((candidate) => candidate.profileId);
  if (centerAgentProfileIds.length > 1) {
    throw new Error(
      "Organization Directory returned more than one Center Agent candidate."
    );
  }
  return await createCliSpaceApi(
    input.baseUrl
  ).addOrganizationDirectoryProfilesToSpace({
    requestContext: input.requestContext,
    spaceId: input.space,
    directoryProfileIds: memberProfileIds,
    ...(centerAgentProfileIds[0]
      ? { expectedCenterAgentProfileId: centerAgentProfileIds[0] }
      : {}),
    ...(input.password === undefined ? {} : { spacePassword: input.password }),
  });
}

function hydrateSpaceMemberCandidateFromResponseItem(input: {
  candidate: SpaceMemberCandidate;
  item?: PostSpaceMembersResponse["items"][number] | undefined;
}): SpaceMemberCandidate {
  if (!input.item) {
    return input.candidate;
  }

  return {
    ...input.candidate,
    profileName: input.item.profileName,
    profileKind: input.item.profileKind,
    ownerUserId: normalizeOptionalString(input.item.ownerUserId) ?? undefined,
    ownerName: normalizeOptionalString(input.item.ownerName) ?? undefined,
    targetMentionLabel: resolvePrimaryMentionLabelFromSpaceMemberItem(
      input.item
    ),
    ...(input.item.profileKind === "agent"
      ? {
          agentControllerRef:
            normalizeOptionalString(input.item.agentControllerRef) ??
            input.candidate.agentControllerRef,
        }
      : {}),
  };
}

function resolvePrimaryMentionLabelFromSpaceMemberItem(
  item: PostSpaceMembersResponse["items"][number]
): string {
  const mentionAlias = normalizeOptionalString(item.mentionAlias);
  if (mentionAlias) {
    return mentionAlias;
  }
  return resolveSingleSpaceMentionLabels({
    mentionAlias,
    profileId: item.profileId,
    profileName: item.profileName,
  }).primaryMentionLabel;
}

async function waitForAddedMembersWakeProjection(input: {
  actorProfile: OpenMeldProfile;
  baseUrl: string;
  space: string;
  password?: string;
  progress?: SpaceAddMembersProgressContext;
  result: SpaceAddMembersResult;
}): Promise<void> {
  const expectedWakeableProfileIds = resolveExpectedWakeProjectionProfileIds(
    input.result
  );
  if (expectedWakeableProfileIds.length === 0) {
    return;
  }

  emitSpaceAddMembersProgressIfRequested(input.progress, {
    stage: "add_members",
    phase: "confirm_membership_projection",
    summary:
      "Confirming the Space can see newly added wakeable members before returning.",
    profileIds: expectedWakeableProfileIds,
  });

  const expected = new Set(expectedWakeableProfileIds);
  for (
    let attempt = 0;
    attempt < SPACE_ADD_MEMBERS_PROJECTION_WAIT_MAX_ATTEMPTS;
    attempt += 1
  ) {
    if (attempt > 0) {
      await delay(SPACE_ADD_MEMBERS_PROJECTION_WAIT_DELAY_MS);
    }

    let membersSnapshot: SpaceMembersSnapshot;
    try {
      membersSnapshot = await createCliSpaceApi(
        input.baseUrl
      ).getMembersSnapshot({
        spaceId: input.space,
        requestContext: buildOpenMeldRequestContextFromProfile({
          openMeldProfile: input.actorProfile,
        }),
        ...(input.password === undefined
          ? {}
          : { spacePassword: input.password }),
      });
    } catch {
      return;
    }

    if (hasExpectedWakeProjection(membersSnapshot, expected)) {
      return;
    }
  }
}

function resolveExpectedWakeProjectionProfileIds(
  result: SpaceAddMembersResult
): string[] {
  return result.added
    .filter(
      (candidate) =>
        candidate.profileKind === "agent" &&
        candidate.localParticipationReadiness === "ready"
    )
    .map((candidate) => candidate.profileId);
}

function hasExpectedWakeProjection(
  membersSnapshot: SpaceMembersSnapshot,
  expectedProfileIds: ReadonlySet<string>
): boolean {
  const wakeableProfileIds = new Set(
    membersSnapshot.agents
      .filter(
        (member) =>
          member.status === "active" &&
          member.agentWakeAvailability?.status === "available_for_wake"
      )
      .map((member) => member.profileId)
  );

  for (const profileId of expectedProfileIds) {
    if (!wakeableProfileIds.has(profileId)) {
      return false;
    }
  }
  return true;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function emitSpaceAddMembersResultIfRequested(
  input: Parameters<typeof emitSpaceAddMembersResult>[0] & {
    suppressResultOutput: boolean;
  }
): void {
  if (input.suppressResultOutput) {
    return;
  }
  const { suppressResultOutput: _suppressResultOutput, ...resultInput } = input;
  emitSpaceAddMembersResult(resultInput);
}

function emitSpaceAddMembersResult(input: {
  mode: SpaceProfileAddMode;
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  space: string;
  selectedCount: number;
  result: SpaceAddMembersResult;
  joinNoticeSummary: SpaceAddMembersJoinNoticeSummary;
}): void {
  const localParticipationFollowUps = input.result.added
    .map((candidate) => buildSpaceMemberJoinedFollowUp(candidate))
    .filter(
      (
        followUp
      ): followUp is {
        profileId: string;
        reasonCodes: string[];
        text: string;
      } => followUp !== null
    );
  if (input.resolvedView === "agent") {
    input.presenter.data({
      code: "space.add_members",
      payload: {
        command: resolveSpaceAddMembersSelectionCommand(input.mode),
        profileAddMode: input.mode,
        spaceId: input.space,
        selectedCount: input.selectedCount,
        addedMemberIds: input.result.added.map((item) => item.profileId),
        alreadyJoinedMemberIds: input.result.alreadyJoined.map(
          (item) => item.profileId
        ),
        failedMembers: input.result.failed.map((item) => ({
          profileId: item.candidate.profileId,
          message: toErrorMessage(item.error),
        })),
        warningMembers: input.result.warnings.map((item) => ({
          profileId: item.candidate.profileId,
          message: toErrorMessage(item.error),
        })),
        joinNotice: {
          recordedCount: input.joinNoticeSummary.recordedCount,
          failedCount: input.joinNoticeSummary.failedCount,
          ...(input.joinNoticeSummary.firstFailure
            ? {
                firstFailure: input.joinNoticeSummary.firstFailure,
              }
            : {}),
        },
        localParticipationFollowUps: localParticipationFollowUps.map(
          (followUp) => ({
            profileId: followUp.profileId,
            reasonCodes: followUp.reasonCodes,
            message: followUp.text,
          })
        ),
      },
    });
    return;
  }

  const card = buildSpaceAddMembersHumanResultCard({
    added: input.result.added,
    alreadyJoined: input.result.alreadyJoined,
    broadcastJoinNoticeCount: input.joinNoticeSummary.recordedCount,
  });
  renderInfoCard({
    presenter: input.presenter,
    title: card.title,
    codePrefix: "space.add_members.card",
    rows: card.rows,
    sanitize: true,
    minContentWidth: 56,
  });

  for (const followUp of localParticipationFollowUps) {
    input.presenter.line({
      code: "space.add_members.local_participation_follow_up",
      text: followUp.text,
    });
  }

  if (input.result.failed.length > 0) {
    for (const failure of input.result.failed) {
      input.presenter.line({
        code: "space.add_members.failed",
        text: `${failure.candidate.profileId}: ${toErrorMessage(failure.error)}`,
      });
    }
  }
  if (input.result.warnings.length > 0) {
    for (const warning of input.result.warnings) {
      input.presenter.line({
        code: "space.add_members.warning",
        text: `warn: ${warning.candidate.profileId}: ${toErrorMessage(warning.error)}`,
      });
    }
  }
  if (input.joinNoticeSummary.failedCount > 0) {
    emitSpaceNoticeFailure({
      presenter: input.presenter,
      summaryCode: "space.add_members.notice_failed",
      requestIdCode: "space.add_members.notice_failed.request_id",
      countDataKey: "failedJoinNoticeCount",
      spaceId: input.space,
      failureCount: input.joinNoticeSummary.failedCount,
      noticeKind: "join",
      firstFailure: input.joinNoticeSummary.firstFailure,
    });
  }
}

function buildSpaceMemberJoinedFollowUp(candidate: SpaceMemberCandidate): {
  profileId: string;
  reasonCodes: string[];
  text: string;
} | null {
  if (candidate.profileKind !== "agent") {
    return null;
  }
  if (candidate.localParticipationChecked !== true) {
    return null;
  }

  if (isSpaceMemberCandidateRepairableLocalParticipationCandidate(candidate)) {
    const repairCommand = buildSpaceMemberRepairCommand({
      agentId: candidate.localTargetAgentId,
      profileId: candidate.profileId,
    });
    const profileLabel = resolveSpaceMemberTerminalProfileLabel(
      candidate.profileName
    );
    const agentLabel = resolveSpaceMemberTerminalLocalTargetLabel({
      displayName: candidate.localTargetDisplayName,
      agentId: candidate.localTargetAgentId,
    });
    return {
      profileId: candidate.profileId,
      reasonCodes: candidate.localParticipationReasonCodes ?? [],
      text: `${profileLabel} joined this space. ${agentLabel} still needs repair on this device before it can handle work from the Space. Use \`${repairCommand}\` to repair the local agent.`,
    };
  }

  if (!isSpaceMemberCandidateRunnableLocalParticipationCandidate(candidate)) {
    const profileLabel = resolveSpaceMemberTerminalProfileLabel(
      candidate.profileName
    );
    const nextAction = resolveSpaceMemberJoinOnlyNextAction(candidate);
    return {
      profileId: candidate.profileId,
      reasonCodes: candidate.localParticipationReasonCodes ?? [],
      text: `${profileLabel} joined this space. OpenMeld has not confirmed its local reply path on this device yet. ${formatSpaceMemberRecoveryNextAction(nextAction)}`,
    };
  }

  return null;
}

async function applySpaceRemoveMembers(input: {
  actorProfile: OpenMeldProfile;
  candidates: SpaceRemoveMemberCandidate[];
  space: string;
  baseUrl: string;
  password?: string;
}): Promise<SpaceRemoveMembersResult> {
  const result: SpaceRemoveMembersResult = {
    removed: [],
    alreadyAbsent: [],
    failed: [],
    warnings: [],
  };
  const gatewayHost = resolveGatewayHost(input.baseUrl);
  if (!gatewayHost) {
    throw new Error(`invalid gateway baseUrl: ${input.baseUrl}`);
  }
  if (input.candidates.length === 0) {
    return result;
  }

  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile: input.actorProfile,
  });
  const requestId = requestContext.actorContext.requestId;
  let response: RemoveSpaceMembersResponse;
  try {
    response = await removeSpaceMembers({
      requestContext,
      baseUrl: input.baseUrl,
      space: input.space,
      password: input.password,
      memberProfileIds: input.candidates.map(
        (candidate) => candidate.profileId
      ),
    });
  } catch (error) {
    for (const candidate of input.candidates) {
      result.failed.push({
        candidate,
        error,
      });
    }
    return result;
  }

  const removedProfileIds = new Set(response.removedMemberIds);
  const alreadyAbsentProfileIds = new Set(response.alreadyAbsentMemberIds);
  for (const candidate of input.candidates) {
    if (removedProfileIds.has(candidate.profileId)) {
      result.removed.push(candidate);
      continue;
    }
    if (alreadyAbsentProfileIds.has(candidate.profileId)) {
      result.alreadyAbsent.push(candidate);
    }
  }

  for (const candidate of result.removed) {
    try {
      await updateProfileSpaceHistoryStatus({
        baseUrl: input.baseUrl,
        requestContext: buildSpaceMemberHistoryRequestContext({
          candidate,
          requestId,
        }),
        openMeldProfileId: candidate.profileId,
        profileName: candidate.profileName,
        spaceId: input.space,
        body: {
          gatewayHost,
          status: "removed",
          reason: "removed_by_member",
        },
      });
    } catch (error) {
      result.warnings.push({
        candidate,
        error,
      });
    }
  }

  return result;
}

async function applySpaceLeave(input: {
  actorProfile: OpenMeldProfile;
  space: string;
  baseUrl: string;
  password?: string;
}): Promise<SpaceLeaveResult> {
  const gatewayHost = resolveGatewayHost(input.baseUrl);
  if (!gatewayHost) {
    throw new Error(`invalid gateway baseUrl: ${input.baseUrl}`);
  }

  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile: input.actorProfile,
  });
  const response = await leaveSpace({
    requestContext,
    baseUrl: input.baseUrl,
    space: input.space,
    password: input.password,
  });
  const reason = resolveSpaceLeaveHistoryReason(response.status);
  const historyResult: SpaceLeaveResult["profileSpaceHistory"] = {
    updated: true,
    reason,
  };

  try {
    await updateProfileSpaceHistoryStatus({
      baseUrl: input.baseUrl,
      requestContext,
      openMeldProfileId: input.actorProfile.openMeldProfileId,
      profileName: input.actorProfile.profileName,
      spaceId: input.space,
      body: {
        gatewayHost,
        status: "removed",
        reason,
      },
    });
  } catch (error) {
    historyResult.updated = false;
    historyResult.warning = toStructuredGatewayFailure(error);
  }

  return {
    ...response,
    profileSpaceHistory: historyResult,
  };
}

function resolveSpaceLeaveHistoryReason(
  status: LeaveSpaceResponse["status"]
): SpaceLeaveHistoryReason {
  return status === "already_absent"
    ? "leave_space_already_absent"
    : "left_space";
}

function emitSpaceRemoveMembersResult(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  space: string;
  selectedCount: number;
  result: SpaceRemoveMembersResult;
  removeNoticeSummary: SpaceRemoveMembersNoticeSummary;
}): void {
  if (input.resolvedView === "agent") {
    input.presenter.data({
      code: "space.remove_members",
      payload: {
        spaceId: input.space,
        selectedCount: input.selectedCount,
        removedMemberIds: input.result.removed.map((item) => item.profileId),
        alreadyAbsentMemberIds: input.result.alreadyAbsent.map(
          (item) => item.profileId
        ),
        failedMembers: input.result.failed.map((item) => ({
          profileId: item.candidate.profileId,
          message: toErrorMessage(item.error),
        })),
        warningMembers: input.result.warnings.map((item) => ({
          profileId: item.candidate.profileId,
          message: toErrorMessage(item.error),
        })),
        removeNotice: {
          recordedCount: input.removeNoticeSummary.recordedCount,
          failedCount: input.removeNoticeSummary.failedCount,
          ...(input.removeNoticeSummary.firstFailure
            ? {
                firstFailure: input.removeNoticeSummary.firstFailure,
              }
            : {}),
        },
      },
    });
    return;
  }

  const card = buildSpaceRemoveMembersHumanResultCard({
    removed: input.result.removed,
    alreadyAbsent: input.result.alreadyAbsent,
    broadcastRemoveNoticeCount: input.removeNoticeSummary.recordedCount,
  });
  renderInfoCard({
    presenter: input.presenter,
    title: card.title,
    codePrefix: "space.remove_members.card",
    rows: card.rows,
    sanitize: true,
    minContentWidth: 56,
  });

  if (input.result.failed.length > 0) {
    for (const failure of input.result.failed) {
      input.presenter.line({
        code: "space.remove_members.failed",
        text: `${failure.candidate.profileId}: ${toErrorMessage(failure.error)}`,
      });
    }
  }
  if (input.result.warnings.length > 0) {
    for (const warning of input.result.warnings) {
      input.presenter.line({
        code: "space.remove_members.warning",
        text: `warn: ${warning.candidate.profileId}: ${toErrorMessage(warning.error)}`,
      });
    }
  }
  if (input.removeNoticeSummary.failedCount > 0) {
    emitSpaceNoticeFailure({
      presenter: input.presenter,
      summaryCode: "space.remove_members.notice_failed",
      requestIdCode: "space.remove_members.notice_failed.request_id",
      countDataKey: "failedRemoveNoticeCount",
      spaceId: input.space,
      failureCount: input.removeNoticeSummary.failedCount,
      noticeKind: "removal",
      firstFailure: input.removeNoticeSummary.firstFailure,
    });
  }
}

function emitSpaceLeaveResult(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  space: string;
  result: SpaceLeaveResult;
}): void {
  if (input.resolvedView === "agent") {
    input.presenter.data({
      code: "space.leave",
      payload: {
        spaceId: input.space,
        leftProfileId: input.result.leftProfileId,
        status: input.result.status,
        profileSpaceHistory: input.result.profileSpaceHistory,
      },
    });
    return;
  }

  const statusText =
    input.result.status === "already_absent"
      ? "You were already absent from this space."
      : "You left this space.";
  renderInfoCard({
    presenter: input.presenter,
    title: "Left Space",
    codePrefix: "space.leave.card",
    rows: [
      {
        label: "Space",
        value: input.space,
      },
      {
        label: "Profile",
        value: input.result.leftProfileId,
      },
      {
        label: "Status",
        value: statusText,
      },
    ],
    sanitize: true,
    minContentWidth: 56,
  });

  if (!input.result.profileSpaceHistory.updated) {
    input.presenter.line({
      code: "space.leave.warning",
      text: `warn: profile-space-history was not updated: ${input.result.profileSpaceHistory.warning?.message ?? "Unknown error."}`,
      data: {
        warning: input.result.profileSpaceHistory.warning ?? null,
      },
    });
  }
}

type SpaceAddMembersJoinNoticeSummary = {
  recordedCount: number;
  failedCount: number;
  firstFailure?: StructuredGatewayFailure;
};

type SpaceRemoveMembersNoticeSummary = {
  recordedCount: number;
  failedCount: number;
  firstFailure?: StructuredGatewayFailure;
};

function emitSpaceNoticeFailure(input: {
  presenter: ReturnType<typeof createPresenter>;
  summaryCode: string;
  requestIdCode: string;
  countDataKey: "failedJoinNoticeCount" | "failedRemoveNoticeCount";
  spaceId: string;
  failureCount: number;
  noticeKind: "join" | "removal";
  firstFailure?: StructuredGatewayFailure;
}): void {
  let noticeLabel = "removal notices";
  if (input.noticeKind === "join") {
    noticeLabel = input.failureCount === 1 ? "join notice" : "join notices";
  } else if (input.failureCount === 1) {
    noticeLabel = "removal notice";
  }
  const message = input.firstFailure?.message ?? "unknown";

  if (input.presenter.view === "human") {
    input.presenter.line({
      code: input.summaryCode,
      text: `OpenMeld updated the Space members, but couldn't post ${String(input.failureCount)} ${noticeLabel}. The membership change is already saved.`,
    });
    return;
  }

  input.presenter.line({
    code: input.summaryCode,
    text: `warn: failed to broadcast ${String(input.failureCount)} ${noticeLabel}: ${message}`,
    data: {
      spaceId: input.spaceId,
      [input.countDataKey]: input.failureCount,
      ...(input.firstFailure?.code ? { code: input.firstFailure.code } : {}),
      ...(input.firstFailure?.status !== null &&
      input.firstFailure?.status !== undefined
        ? { status: input.firstFailure.status }
        : {}),
    },
  });

  if (input.firstFailure?.requestId) {
    input.presenter.line({
      code: input.requestIdCode,
      text: `Request ID: ${input.firstFailure.requestId}`,
      data: {
        spaceId: input.spaceId,
        requestId: input.firstFailure.requestId,
      },
    });
  }
}

async function persistSpaceAddMembersJoinNotices(input: {
  actorProfile: OpenMeldProfile;
  baseUrl: string;
  space: string;
  password?: string;
  addedMembers: SpaceMemberCandidate[];
}): Promise<SpaceAddMembersJoinNoticeSummary> {
  if (input.addedMembers.length === 0) {
    return {
      recordedCount: 0,
      failedCount: 0,
    };
  }

  const failures: Array<{
    member: SpaceMemberCandidate;
    error: unknown;
  }> = [];
  let targetMentionLabelByProfileId = buildKnownMentionLabelByProfileId(
    input.addedMembers
  );
  if (
    !hasMentionLabelsForAllMembers(
      input.addedMembers,
      targetMentionLabelByProfileId
    )
  ) {
    try {
      const membersSnapshot = await createCliSpaceApi(
        input.baseUrl
      ).getMembersSnapshot({
        spaceId: input.space,
        requestContext: buildOpenMeldRequestContextFromProfile({
          openMeldProfile: input.actorProfile,
        }),
        ...(input.password === undefined
          ? {}
          : { spacePassword: input.password }),
      });
      targetMentionLabelByProfileId =
        buildSpacePrimaryMentionLabelByProfileId(membersSnapshot);
    } catch (error) {
      return {
        recordedCount: 0,
        failedCount: input.addedMembers.length,
        firstFailure: toStructuredGatewayFailure(error),
      };
    }
  }

  for (const member of input.addedMembers) {
    const targetMentionLabel = targetMentionLabelByProfileId.get(
      member.profileId
    );
    if (!targetMentionLabel) {
      failures.push({
        member,
        error: new Error(
          `Missing canonical mention label for added member ${member.profileId} in post-mutation snapshot.`
        ),
      });
      continue;
    }
    try {
      await postSpaceAddMemberJoinNotice({
        actorProfile: input.actorProfile,
        baseUrl: input.baseUrl,
        space: input.space,
        password: input.password,
        member: {
          ...member,
          targetMentionLabel,
        },
      });
    } catch (error) {
      failures.push({ member, error });
    }
  }

  return {
    recordedCount: input.addedMembers.length - failures.length,
    failedCount: failures.length,
    ...(failures[0]
      ? { firstFailure: toStructuredGatewayFailure(failures[0].error) }
      : {}),
  };
}

function buildKnownMentionLabelByProfileId(
  members: SpaceMemberCandidate[]
): ReadonlyMap<string, string> {
  const labelsByProfileId = new Map<string, string>();
  for (const member of members) {
    const targetMentionLabel = normalizeOptionalString(
      member.targetMentionLabel
    );
    if (targetMentionLabel) {
      labelsByProfileId.set(member.profileId, targetMentionLabel);
    }
  }
  return labelsByProfileId;
}

function hasMentionLabelsForAllMembers(
  members: SpaceMemberCandidate[],
  labelsByProfileId: ReadonlyMap<string, string>
): boolean {
  return members.every((member) => labelsByProfileId.has(member.profileId));
}

async function postSpaceAddMemberJoinNotice(input: {
  actorProfile: OpenMeldProfile;
  baseUrl: string;
  space: string;
  password?: string;
  member: SpaceMemberCandidate & { targetMentionLabel: string };
}): Promise<void> {
  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile: input.actorProfile,
  });
  await createCliSpaceApi(input.baseUrl).postNormalMessage({
    spaceId: input.space,
    requestContext,
    ...(input.password === undefined ? {} : { spacePassword: input.password }),
    text: buildSpaceAddMemberJoinNoticeText({
      actorProfile: input.actorProfile,
      member: input.member,
    }),
    meta: {
      purpose: SPACE_MEMBER_JOIN_NOTICE_PURPOSE,
      targetProfileId: input.member.profileId,
      targetProfileKind: input.member.profileKind,
      targetProfileName: input.member.profileName,
      targetMentionLabel: input.member.targetMentionLabel,
      addedByProfileId: input.actorProfile.openMeldProfileId,
      addedByDisplayName: input.actorProfile.profileName,
    },
  });
}

async function persistSpaceRemoveMemberNotices(input: {
  actorProfile: OpenMeldProfile;
  baseUrl: string;
  space: string;
  password?: string;
  removedMembers: SpaceRemoveMemberCandidate[];
}): Promise<SpaceRemoveMembersNoticeSummary> {
  if (input.removedMembers.length === 0) {
    return {
      recordedCount: 0,
      failedCount: 0,
    };
  }

  const failures: Array<{
    member: SpaceRemoveMemberCandidate;
    error: unknown;
  }> = [];
  for (const member of input.removedMembers) {
    if (!member.targetMentionLabel) {
      failures.push({
        member,
        error: new Error(
          `Missing canonical mention label for removed member ${member.profileId} in pre-mutation snapshot.`
        ),
      });
      continue;
    }
    try {
      await postSpaceRemoveMemberNotice({
        actorProfile: input.actorProfile,
        baseUrl: input.baseUrl,
        space: input.space,
        password: input.password,
        member: {
          ...member,
          targetMentionLabel: member.targetMentionLabel,
        },
      });
    } catch (error) {
      failures.push({ member, error });
    }
  }

  return {
    recordedCount: input.removedMembers.length - failures.length,
    failedCount: failures.length,
    ...(failures[0]
      ? { firstFailure: toStructuredGatewayFailure(failures[0].error) }
      : {}),
  };
}

async function postSpaceRemoveMemberNotice(input: {
  actorProfile: OpenMeldProfile;
  baseUrl: string;
  space: string;
  password?: string;
  member: SpaceRemoveMemberCandidate & { targetMentionLabel: string };
}): Promise<void> {
  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile: input.actorProfile,
  });
  await createCliSpaceApi(input.baseUrl).postNormalMessage({
    spaceId: input.space,
    requestContext,
    ...(input.password === undefined ? {} : { spacePassword: input.password }),
    text: buildSpaceRemoveMemberNoticeText({
      actorProfile: input.actorProfile,
      member: input.member,
    }),
    meta: {
      purpose: SPACE_MEMBER_REMOVE_NOTICE_PURPOSE,
      targetProfileId: input.member.profileId,
      targetProfileKind: input.member.profileKind,
      targetProfileName: input.member.profileName,
      targetMentionLabel: input.member.targetMentionLabel,
      removedByProfileId: input.actorProfile.openMeldProfileId,
      removedByDisplayName: input.actorProfile.profileName,
    },
  });
}

function buildSpaceAddMemberJoinNoticeText(input: {
  actorProfile: OpenMeldProfile;
  member: SpaceMemberCandidate;
}): string {
  return `${input.actorProfile.profileName} added ${resolveSpaceAddMemberNoticeProfileNameLabel(input.member)} to this space.`;
}

function buildSpaceRemoveMemberNoticeText(input: {
  actorProfile: OpenMeldProfile;
  member: SpaceRemoveMemberCandidate;
}): string {
  return `${input.actorProfile.profileName} removed ${resolveSpaceRemoveMemberNoticeProfileNameLabel(input.member)} from this space.`;
}

function resolveSpaceAddMemberNoticeProfileNameLabel(
  member: SpaceMemberCandidate
): string {
  if (member.profileKind !== "agent") {
    return member.profileName;
  }
  return `🤖 ${member.profileName}`;
}

function resolveSpaceRemoveMemberNoticeProfileNameLabel(
  member: SpaceRemoveMemberCandidate
): string {
  if (member.profileKind !== "agent") {
    return member.profileName;
  }
  return `🤖 ${member.profileName}`;
}

function buildSpaceMemberHistoryRequestContext(input: {
  candidate:
    | Pick<
        SpaceMemberCandidate,
        | "profileId"
        | "profileHandle"
        | "profileName"
        | "profileKind"
        | "ownerUserId"
        | "ownerName"
        | "agentControllerRef"
      >
    | Pick<
        SpaceRemoveMemberCandidate,
        | "profileId"
        | "profileHandle"
        | "profileName"
        | "profileKind"
        | "ownerUserId"
        | "ownerName"
      >;
  requestId: string;
}): OpenMeldRequestContext {
  return buildOpenMeldRequestContextFromProfileIdentity({
    requestId: input.requestId,
    profileIdentity: {
      openMeldProfileId: input.candidate.profileId,
      profileKind: input.candidate.profileKind,
      ...(input.candidate.profileHandle
        ? { profileHandle: input.candidate.profileHandle }
        : {}),
      profileName: input.candidate.profileName,
      ...(input.candidate.ownerUserId
        ? { ownerUserId: input.candidate.ownerUserId }
        : {}),
      ...(input.candidate.ownerName
        ? { ownerName: input.candidate.ownerName }
        : {}),
      ...("agentControllerRef" in input.candidate &&
      input.candidate.agentControllerRef
        ? { agentControllerRef: input.candidate.agentControllerRef }
        : {}),
    },
  });
}

function formatSpaceRemoveMemberCandidateLabel(
  candidate: SpaceRemoveMemberCandidate
): string {
  return `${sanitizeSingleLinePromptText(candidate.profileName)} (${sanitizeSingleLinePromptText(candidate.profileKind)}) · ${sanitizeSingleLinePromptText(candidate.profileId)}`;
}

function formatSpaceRemoveMemberCandidateHint(
  candidate: SpaceRemoveMemberCandidate
): string {
  if (candidate.profileKind === "agent") {
    return "Selectable agent member";
  }
  return "Selectable human member";
}

function buildHumanSpaceRemoveMemberCandidateSearchItem(
  candidate: SpaceRemoveMemberCandidate
): {
  value: string;
  label: string;
  detail: string;
  searchText: string;
  disabled: boolean;
} {
  return {
    value: candidate.profileId,
    label: `${sanitizeSingleLinePromptText(candidate.profileName)} (${sanitizeSingleLinePromptText(candidate.profileKind)})`,
    detail: buildHumanSpaceRemoveMemberCandidateDetail(candidate),
    searchText: buildHumanSpaceRemoveMemberCandidateSearchText(candidate),
    disabled: false,
  };
}

function buildHumanSpaceRemoveMemberCandidateDetail(
  candidate: SpaceRemoveMemberCandidate
): string {
  return `ID ${sanitizeSingleLinePromptText(candidate.profileId)}`;
}

function buildHumanSpaceRemoveMemberCandidateSearchText(
  candidate: SpaceRemoveMemberCandidate
): string {
  return [
    sanitizeSingleLinePromptText(candidate.profileId),
    sanitizeSingleLinePromptText(candidate.profileName),
    sanitizeSingleLinePromptText(candidate.profileKind),
    sanitizeSingleLinePromptText(
      normalizeOptionalString(candidate.profileHandle)
    ),
    sanitizeSingleLinePromptText(normalizeOptionalString(candidate.ownerName)),
    sanitizeSingleLinePromptText(
      normalizeOptionalString(candidate.ownerUserId)
    ),
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function formatSpaceMemberCandidateLabel(
  candidate: SpaceMemberCandidate
): string {
  const label = `${sanitizeSingleLinePromptText(candidate.profileName)} (${sanitizeSingleLinePromptText(candidate.profileKind)}) · ${sanitizeSingleLinePromptText(candidate.profileId)}`;
  return candidate.alreadyJoined ? pc.strikethrough(label) : label;
}

function formatSpaceMemberCandidateHint(
  candidate: SpaceMemberCandidate
): string {
  if (candidate.alreadyJoined) {
    return "Already in this space";
  }
  if (candidate.needsActivation) {
    return "Needs mention setup";
  }
  return resolveSpaceMemberCandidateStatusLabel(candidate) ?? "Selectable";
}

function buildHumanSpaceMemberCandidateSearchItem(
  candidate: SpaceMemberCandidate
): {
  value: string;
  label: string;
  detail: string;
  searchText: string;
  disabled: boolean;
} {
  return {
    value: candidate.profileId,
    label: `${sanitizeSingleLinePromptText(candidate.profileName)} (${sanitizeSingleLinePromptText(candidate.profileKind)})`,
    detail: buildHumanSpaceMemberCandidateDetail(candidate),
    searchText: buildHumanSpaceMemberCandidateSearchText(candidate),
    disabled: candidate.alreadyJoined,
  };
}

function buildHumanSpaceMemberCandidateDetail(
  candidate: SpaceMemberCandidate
): string {
  const statuses: string[] = [];
  if (candidate.alreadyJoined === true) {
    statuses.push("already in this space");
  } else if (candidate.needsActivation) {
    statuses.push("needs mention setup");
  }
  const agentStatuses = resolveSpaceMemberCandidateStatusBadges(candidate);
  statuses.push(...agentStatuses.map((status) => status.toLowerCase()));

  return statuses.length > 0
    ? `ID ${sanitizeSingleLinePromptText(candidate.profileId)} · ${statuses.map((status) => sanitizeSingleLinePromptText(status)).join(" · ")}`
    : `ID ${sanitizeSingleLinePromptText(candidate.profileId)}`;
}

function buildHumanSpaceMemberCandidateSearchText(
  candidate: SpaceMemberCandidate
): string {
  return [
    sanitizeSingleLinePromptText(candidate.profileId),
    sanitizeSingleLinePromptText(candidate.profileName),
    sanitizeSingleLinePromptText(candidate.profileKind),
    sanitizeSingleLinePromptText(
      normalizeOptionalString(candidate.ownerProfileName)
    ),
    sanitizeSingleLinePromptText(normalizeOptionalString(candidate.ownerName)),
    sanitizeSingleLinePromptText(
      normalizeOptionalString(candidate.ownerUserId)
    ),
    sanitizeSingleLinePromptText(
      normalizeOptionalString(candidate.agentControllerRef)
    ),
    ...resolveSpaceMemberCandidateStatusBadges(candidate),
    candidate.alreadyJoined ? "already in this space" : null,
    candidate.needsActivation ? "needs mention setup" : null,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function normalizeRequestedMemberIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: string[] = [];
  for (const item of value) {
    const profileId = String(item ?? "").trim();
    if (!profileId || ids.includes(profileId)) {
      continue;
    }
    ids.push(profileId);
  }
  return ids;
}

function toSpaceRemoveMemberCandidateFromSnapshot(input: {
  member:
    | SpaceMembersSnapshot["humans"][number]
    | SpaceMembersSnapshot["agents"][number];
  targetMentionLabel?: string | null;
}): SpaceRemoveMemberCandidate {
  return {
    profileId: input.member.profileId,
    profileName: input.member.profileName,
    profileKind: input.member.profileKind,
    targetMentionLabel: normalizeOptionalString(input.targetMentionLabel),
    ownerUserId: normalizeOptionalString(input.member.ownerUserId),
    ownerName: normalizeOptionalString(input.member.ownerName),
    creatorProfileId:
      input.member.memberSource === "space_creator"
        ? normalizeOptionalString(input.member.profileId)
        : null,
  };
}

function hydrateSpaceRemoveMemberCandidate(input: {
  candidate: SpaceRemoveMemberCandidate;
  profile?: OpenMeldProfile | undefined;
}): SpaceRemoveMemberCandidate {
  if (input.candidate.profileHandle) {
    return input.candidate;
  }

  const profileHandle = normalizeOptionalString(input.profile?.profileHandle);
  if (!profileHandle) {
    return input.candidate;
  }

  return {
    ...input.candidate,
    profileHandle,
  };
}

function toSpaceRemoveMemberCandidateFromProfile(
  profile: OpenMeldProfile & { profileKind: SpaceMembershipProfileKind }
): SpaceRemoveMemberCandidate {
  return {
    profileId: profile.openMeldProfileId,
    profileHandle: profile.profileHandle,
    profileName: profile.profileName,
    profileKind: profile.profileKind,
    targetMentionLabel: null,
    ownerUserId: normalizeOptionalString(profile.ownerUserId),
    ownerName: normalizeOptionalString(profile.ownerName),
    creatorProfileId: null,
  };
}

async function resolveKnownSpacesForPasswordSelection(input: {
  known: KnownSpaceOption[];
  clear: boolean;
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
}): Promise<KnownSpaceOption[]> {
  const knownWithPasswordState = await Promise.all(
    input.known.map((item) =>
      hydrateKnownSpacePasswordProtection({
        item,
        openMeldProfile: input.openMeldProfile,
        baseUrl: input.baseUrl,
      })
    )
  );
  return knownWithPasswordState.filter(
    (item) => item.passwordProtected === input.clear
  );
}

async function hydrateKnownSpacePasswordProtection(input: {
  item: KnownSpaceOption;
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
}): Promise<KnownSpaceOption> {
  if (typeof input.item.passwordProtected === "boolean") {
    return input.item;
  }

  const targetBaseUrl = input.item.baseUrl ?? input.baseUrl;
  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile: input.openMeldProfile,
  });
  try {
    const meta = await fetchSpaceMeta({
      requestContext,
      baseUrl: targetBaseUrl,
      space: input.item.space,
    });
    const passwordProtected =
      typeof meta.passwordProtected === "boolean"
        ? meta.passwordProtected
        : false;
    await syncKnownSpacePasswordProtectionCache({
      openMeldProfileId: input.openMeldProfile.openMeldProfileId,
      profileName: input.openMeldProfile.profileName,
      baseUrl: targetBaseUrl,
      space: input.item.space,
      passwordProtected,
    }).catch(() => undefined);
    return {
      ...input.item,
      passwordProtected,
    };
  } catch (error) {
    const passwordProtected =
      resolveKnownSpacePasswordProtectionFromMetaError(error);
    if (passwordProtected === null) {
      return input.item;
    }
    await syncKnownSpacePasswordProtectionCache({
      openMeldProfileId: input.openMeldProfile.openMeldProfileId,
      profileName: input.openMeldProfile.profileName,
      baseUrl: targetBaseUrl,
      space: input.item.space,
      passwordProtected,
    }).catch(() => undefined);
    return {
      ...input.item,
      passwordProtected,
    };
  }
}

function resolveKnownSpacePasswordProtectionFromMetaError(
  error: unknown
): boolean | null {
  const reason = resolveSpacePasswordPromptReason(error);
  if (reason === "required" || reason === "invalid") {
    return true;
  }
  return null;
}

async function syncKnownSpacePasswordProtectionCache(input: {
  openMeldProfileId: string;
  profileName: string;
  baseUrl: string;
  space: string;
  passwordProtected: boolean;
}): Promise<void> {
  await upsertSpaceConfig({
    openMeldProfileId: input.openMeldProfileId,
    baseUrl: input.baseUrl,
    space: input.space,
    profileName: input.profileName,
    passwordProtected: input.passwordProtected,
  });
}

export async function runSpaceSend(input: {
  contextSelection?: import("@openmeld/schemas/types").ExecutionContextSelection;
  wakeTargets?: readonly string[];
  referenceTargets?: readonly string[];
  mentionTargets?: readonly string[];
  profile?: string;
  baseUrl?: string;
  space: string;
  filePaths?: readonly string[];
  password?: string;
  text?: string;
  stdin?: boolean;
  textFile?: string;
  plainText?: boolean;
  replyToSignalId?: string;
  view?: string;
  entryChecksHandled?: boolean;
}) {
  assertDispatchOwnedRuntimePublicWriteAllowed({
    commandLabel: "openmeld space send",
  });

  const normalizedSpace = input.space.trim();
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage("sending a message"),
    entryChecksHandled: input.entryChecksHandled,
  });
  if (context.status === "cancelled") {
    return;
  }
  const { runtime, presenter, interactive, baseUrl } = context;
  assertValidSpaceIdTarget({
    space: normalizedSpace,
    resolvedView: runtime.resolvedView,
  });

  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive,
  });
  await emitSpaceCommandPreflight({
    presenter,
    command: "send",
    profile: openMeldProfile,
    baseUrl,
    resolvedView: runtime.resolvedView,
  });
  if (runtime.resolvedView === "agent") {
    presenter.line({
      code: "space.send.profile_consistency_hint",
      text: "Profile guard: keep profile consistent unless intentional switch.",
    });
  }
  const text = await resolveSpaceSendText({
    allowEmpty: (input.filePaths?.length ?? 0) > 0,
    text: input.text,
    stdin: input.stdin,
    file: input.textFile,
  });
  if (runtime.resolvedView === "agent") {
    const workflowAckHint = resolveWorkflowAckHint(text);
    if (workflowAckHint) {
      presenter.line({
        code: "space.send.owner_directive_ack_hint",
        text: workflowAckHint,
      });
    }
  }
  try {
    await runSend({
      contextSelection: input.contextSelection,
      wakeTargets: input.wakeTargets,
      referenceTargets: input.referenceTargets,
      mentionTargets: input.mentionTargets,
      profile: openMeldProfile.openMeldProfileId,
      baseUrl,
      space: normalizedSpace,
      filePaths: input.filePaths,
      password: input.password,
      plainText: input.plainText === true,
      replyToSignalId: input.replyToSignalId,
      text,
      openMeldProfile,
      view: input.view,
    });
  } catch (error) {
    emitSpaceFailureNextStep({
      presenter,
      command: "send",
      error,
      profileId: openMeldProfile.openMeldProfileId,
      resolvedView: runtime.resolvedView,
    });
    throw error;
  }
}

export async function runSpaceHistory(input: {
  profile?: string;
  baseUrl?: string;
  space: string;
  password?: string;
  limit: number;
  brief?: boolean;
  json: boolean;
  rawStream?: boolean;
  view?: string;
  afterSignalId?: string;
  aroundSignalId?: string;
  beforeCount?: number;
  afterCount?: number;
  fromProfileIds?: readonly string[];
  kinds?: readonly NonNullable<SpaceSignalsReadQuery["kinds"]>[number][];
  entryChecksHandled?: boolean;
}) {
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage(
      "reading space history"
    ),
    entryChecksHandled: input.entryChecksHandled,
  });
  if (context.status === "cancelled") {
    return;
  }
  const { runtime, interactive, baseUrl } = context;
  assertValidSpaceIdTarget({
    space: input.space,
    resolvedView: runtime.resolvedView,
  });

  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive,
  });
  await runTail({
    profile: openMeldProfile.openMeldProfileId,
    baseUrl,
    space: input.space,
    password: input.password,
    limit: input.limit,
    brief: input.brief === true,
    json: input.json,
    rawStream: input.rawStream === true,
    openMeldProfile,
    view: input.view,
    afterSignalId: input.afterSignalId,
    aroundSignalId: input.aroundSignalId,
    beforeCount: input.beforeCount,
    afterCount: input.afterCount,
    fromProfileIds: input.fromProfileIds,
    kinds: input.kinds,
  });
}

async function resolveJoinAfterCreate(
  joinInput: boolean | undefined,
  allowPrompt: boolean
): Promise<boolean> {
  if (joinInput !== undefined) {
    return joinInput;
  }
  if (!allowPrompt) {
    return false;
  }
  const confirmed = await confirm({
    message: "Join this space now?",
    initialValue: true,
  });
  if (isCancel(confirmed)) {
    cancel("Cancelled.");
    return false;
  }
  return confirmed;
}

function toKnownSpaceOptionFromDeleteTarget(
  target: SpaceDeleteTarget
): KnownSpaceOption {
  return {
    source: "local",
    space: target.space,
    ...(target.baseUrl ? { baseUrl: target.baseUrl } : {}),
    ...(target.name === undefined ? {} : { name: target.name }),
    ...(target.creatorProfileName === undefined
      ? {}
      : { creatorProfileName: target.creatorProfileName }),
    ...(target.creatorProfileId === undefined
      ? {}
      : { creatorProfileId: target.creatorProfileId }),
    ...(target.creatorOwnerUserId === undefined
      ? {}
      : { creatorOwnerUserId: target.creatorOwnerUserId }),
    ...(target.creatorKind === undefined
      ? {}
      : { creatorKind: target.creatorKind }),
  };
}

function resolveSpaceListEmptyMessage(
  visibilityScope: KnownSpaceVisibilityScope
): string {
  if (visibilityScope === "owner") {
    return formatInlineOpenMeldCliCommands(
      "No spaces found across the profiles you own yet. Create one with: `openmeld space create --name <name> --visibility private`"
    );
  }
  return formatInlineOpenMeldCliCommands(
    "No spaces found for this profile yet. Create one with: `openmeld space create --name <name> --visibility private`"
  );
}

function buildDeleteConfirmationMessage(input: {
  targets: SpaceDeleteTarget[];
  currentProfileId: string;
  currentProfileName: string;
}): string {
  const count = input.targets.length;
  const title =
    count === 1
      ? "Delete this space permanently?"
      : `Delete ${String(count)} spaces permanently?`;
  const lines = [
    title,
    "This action permanently deletes space data for everyone.",
  ];

  for (const [index, target] of input.targets.entries()) {
    const knownSpace = toKnownSpaceOptionFromDeleteTarget(target);
    lines.push(
      `${String(index + 1)}. ${formatKnownSpaceName({
        space: knownSpace,
        resolvedView: "human",
        currentProfileId: input.currentProfileId,
        command: "delete",
      })}`
    );
    lines.push(
      ...formatKnownSpaceDetailLines({
        space: knownSpace,
        resolvedView: "human",
        currentProfileId: input.currentProfileId,
        currentProfileName: input.currentProfileName,
        detailVariant: "delete_confirmation",
        command: "delete",
      }).map((line) => `   ${line}`)
    );
  }

  return lines.join("\n");
}

function buildHumanSpaceDeleteBlockedError(input: {
  error: unknown;
  target: SpaceDeleteTarget;
  resolvedView: "human" | "agent";
}): Error | null {
  if (input.resolvedView !== "human") {
    return null;
  }
  const parsed = parseHttpErrorMessage(input.error);
  if (!parsed) {
    return null;
  }

  const status = resolveUpstreamStatus(parsed);
  if (status !== 403) {
    return null;
  }
  if (!isSpaceDeleteOwnerRestrictionError(parsed)) {
    return null;
  }

  const spaceName = normalizeDisplayValue(input.target.name, "this space");
  return new Error(
    `Delete blocked: this human profile can only delete its own spaces or your owned agent-created spaces (${spaceName}).`
  );
}

function isSpaceDeleteOwnerRestrictionError(input: {
  code: string;
  message: string;
}): boolean {
  const code = input.code.toLowerCase();
  const message = input.message.toLowerCase();
  return (
    code === "space.human_confirmation_required" ||
    message.includes("owner human confirmation") ||
    message.includes("only owner human can delete") ||
    message.includes("only space creator can delete")
  );
}

function renderHumanSpaceDeleteBlockedCard(input: {
  presenter: ReturnType<typeof createPresenter>;
  target: SpaceDeleteTarget;
}): void {
  renderHumanErrorCard({
    message:
      "You can only delete a Space created by this profile or by one of your own agents.",
    nextStep: "Switch to the profile that created the Space, then try again.",
    presenter: input.presenter,
    title: "Space couldn't be deleted",
    codePrefix: "space.delete.blocked",
  });
}

function normalizeDeleteConfirmationValue(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isDeleteConfirmationValue(value: unknown): boolean {
  return normalizeDeleteConfirmationValue(value) === "delete";
}

async function deleteSpace(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  space: string;
  password?: string;
  approvedAgentCreatorProfileId?: string;
}): Promise<{ spaceId: string; deleted: true }> {
  const endpoint = toSpaceDeleteUrl(input.baseUrl, input.space);
  const headers = await buildOpenMeldProfileRequestHeadersWithAuth({
    requestUrl: endpoint,
    openMeldProfile: input.openMeldProfile,
    spacePassword: input.password,
  });
  const approvedAgentCreatorProfileId = normalizeOptionalString(
    input.approvedAgentCreatorProfileId
  );
  if (approvedAgentCreatorProfileId) {
    headers["content-type"] = "application/json";
  }

  const response = await fetchSpaceRequestWithTimeout({
    url: endpoint,
    operation: "space.delete",
    init: {
      method: "DELETE",
      headers,
      ...(approvedAgentCreatorProfileId
        ? {
            body: JSON.stringify({
              approvedAgentCreatorProfileId,
            }),
          }
        : {}),
    },
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${raw}`);
  }

  let parsed: { spaceId?: unknown; deleted?: unknown };
  try {
    parsed = JSON.parse(raw) as { spaceId?: unknown; deleted?: unknown };
  } catch {
    throw new Error("deleteSpace received invalid response payload");
  }
  if (
    typeof parsed.spaceId !== "string" ||
    parsed.spaceId.trim().length === 0 ||
    parsed.deleted !== true
  ) {
    throw new Error("deleteSpace received invalid response payload");
  }
  return {
    spaceId: parsed.spaceId.trim(),
    deleted: true as const,
  };
}

async function _updateSpaceCursorMentionAlias(input: {
  requestContext: import("@openmeld/schemas/types").OpenMeldRequestContext;
  baseUrl: string;
  space: string;
  password?: string;
  mentionAlias: string;
}): Promise<{
  role?: string;
  mentionAlias?: string;
}> {
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

  const response = await fetchSpaceRequestWithTimeout({
    url: endpoint,
    operation: "space.update_cursor_alias",
    init: {
      method: "PATCH",
      headers,
      body: JSON.stringify({ mentionAlias: input.mentionAlias }),
    },
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${raw}`);
  }

  return parseSpaceCursorResponse({
    raw,
    endpoint,
    operation: "updateSpaceCursor",
  });
}

function isHumanInteractiveSpaceRuntime(
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>
): boolean {
  return runtime.resolvedView === "human" && canUseInteractivePrompts(runtime);
}
