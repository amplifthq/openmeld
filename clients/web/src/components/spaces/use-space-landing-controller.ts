import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import { normalizeSpacePasswordText } from "@openmeld/schemas";
import type {
	DaemonServiceLane,
	ExecutionRecoveryProjection,
	GetSpaceStatusResponse,
	ListSpaceThreadsResponse,
	PostSpaceWakeStopResponse,
	RespondToSpaceAgentInteractionBody,
	SignalEnvelope,
	SpaceAccessMode,
	SpaceInboxUnreadTarget,
	SpaceInboxUnreadTargetsResponse,
	SpaceInputQueueResponse,
	SpaceLinkJoinPolicy,
	SpaceMembersSnapshot,
	SpaceMessageFileReference,
	SpaceThread,
	SpaceThreadContext,
	SpaceThreadPreview,
	SpaceThreadSignalPlacement,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import {
	applyWakeProgressSignals,
	buildWakeProgressItemFromTransientSignal,
	filterVisibleWakeProgressItems,
	readWakeProgressTerminalSignalEvidence,
	resolveSpaceDeleteActionVisibility,
} from "@openmeld/space";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { SetStateAction } from "react";
import {
	useCallback,
	useEffect,
	useEffectEvent,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import {
	useHeldAgentAccessWakeKeys,
	withoutHeldAgentAccessWakeProgress,
} from "#/components/agent-access/held-agent-access-wake-progress";
import {
	type SpaceAgentRequestMentions,
	useSpaceAgentRequestMentions,
} from "#/components/agent-access/space-agent-request-mentions";
import type {
	ComposerDraftRecord,
	ComposerDraftScope,
} from "#/lib/composer-draft-storage";
import { reportUnconfirmedWakeProgressPresentation } from "#/lib/observability/application-error-client";
import { updateProfileSpaceHistoryStatus } from "#/lib/onboarding/update-profile-space-history-status";
import { upsertProfileSpaceHistory } from "#/lib/onboarding/upsert-profile-space-history";
import { centerAgentPendingAttachmentScope } from "#/lib/organizations/center-agent-pending-message";
import {
	buildOrganizationSpacePath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";
import {
	ensureWebAgentProfileRuntimeBinding,
	formatWebAgentProfileRuntimeBindingFailure,
} from "#/lib/profiles/agent-profile-runtime-binding";
import { projectAgentStreamReplyPlacements } from "#/lib/spaces/active-wake-conversation";
import { sendWebSpaceAgentInteractionResponse } from "#/lib/spaces/agent-interaction-response";
import {
	presentAnsweredAgentInteractions,
	resolveAgentInteractionAnswerKey,
} from "#/lib/spaces/answered-agent-interactions";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import type { SpaceComposerFile } from "#/lib/spaces/composer-attachment";
import type { ComposerFileDraftCleanup } from "#/lib/spaces/composer-file-drafts";
import type { SpaceConversationVisibleStreamProjection } from "#/lib/spaces/conversation-stream";
import type { SpaceEphemeralActivityItem } from "#/lib/spaces/dispatch-activity";
import {
	isCurrentSpaceAccessRejection,
	isProtectedSpaceFailure,
	isSpaceComposerSendOutcomeUnknown,
	resolveSpaceComposerSendErrorMessage,
	runSpaceComposerIdempotentRequestWithRetry,
} from "#/lib/spaces/errors";
import {
	applyConfirmedSpaceDeletionToCache,
	applySpaceBootstrapSnapshotToCache,
	enrichSpaceHistoryAgentControllerPresentation,
	resolveSpaceMembersPresentationSnapshot,
} from "#/lib/spaces/member-cache";
import type { PendingSpaceMessage } from "#/lib/spaces/pending-message";
import { rememberProtectedSpaceAccess } from "#/lib/spaces/protected-space-access";
import {
	SPACE_MESSAGE_SEND_TIMEOUT_MS,
	SPACE_WAKE_PROGRESS_TIMEOUT_MS,
} from "#/lib/spaces/request-timeouts";
import {
	buildSpaceTimelineItems,
	getEarliestVisibleTimelineSignalId,
	mergeSpaceTimelineEnvelopes,
	type SpaceLiveState,
	type SpaceTimelineItem,
} from "#/lib/spaces/timeline";
import { useWakeStopRequests } from "#/lib/spaces/use-wake-stop-requests";
import type {
	SpaceWakeStopRequestStatus,
	SpaceWakeStopTargetResolution,
} from "#/lib/spaces/wake-stop-target";
import {
	invalidateAgentAccessQueries,
	useRequestAgentForSpace,
} from "#/query/agent-access";
import { inboxQueryKeys } from "#/query/organizations/inbox";
import { optimisticallyRespondToSpaceInteraction } from "#/query/organizations/inbox-interaction-response";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { resolveAppQueryPersistenceController } from "#/query/persistence/app-query-persistence";
import {
	accountSpaceQueryKeys,
	updateAccountSpaceAcceptedMessage,
} from "#/query/spaces/account-spaces";
import {
	filterSpaceWakeProgressItems,
	hasSpaceWakeProgressOutcome,
	readSpaceWakeProgressSummaryItems,
	recordSpaceWakeProgressEvidence,
	setSpaceWakeProgressPresentationItems,
	spaceActiveWakeProgressSummaryQueryOptions,
	spaceWakeProgressPresentationQueryOptions,
} from "#/query/spaces/active-wake-progress";
import {
	type SpaceBootstrapSnapshot,
	spaceBootstrapQueryOptions,
} from "#/query/spaces/bootstrap";
import {
	createSpaceConversationDisplaySnapshot,
	readOnlySpaceStatusFromDisplaySnapshot,
	spaceConversationDisplaySnapshotQueryOptions,
} from "#/query/spaces/display-snapshot";
import {
	mergeSpaceHistorySnapshots,
	readEarlierSpaceHistory,
	type SpaceHistorySnapshot,
	spaceHistoryDateWindowQueryOptions,
	spaceHistoryQueryOptions,
} from "#/query/spaces/history";
import {
	readSpaceMembers,
	spaceMembersQueryOptions,
} from "#/query/spaces/members";
import { clearSpaceFileMediaResources } from "#/query/spaces/space-file-media-resource";
import { spaceQueryKeys, spaceStatusQueryOptions } from "#/query/spaces/status";
import {
	spaceThreadSignalsQueryOptions,
	spaceThreadsQueryOptions,
} from "#/query/spaces/threads";
import {
	invalidateSpaceWakeStopQueries,
	postWebSpaceWakeStop,
} from "#/query/spaces/wake-stop";
import {
	applyDeviceWaitToSubmission,
	type SpaceComposerSendOptions,
} from "./space-composer-device-wait";
import type {
	SpaceComposerEditorChange,
	SpaceComposerInputRef,
} from "./space-composer-editor";
import { requireCurrentSpaceComposerWakeAdmission } from "./space-composer-wake-admission";
import { useSpaceEntryConfirmation } from "./space-entry-confirmation";
import { projectSpaceExecutionRecoveryResolution } from "./space-execution-recovery";
import type {
	SpaceExecutionRecoveryAttempt,
	SpaceExecutionRecoveryResolution,
} from "./space-execution-recovery-actions";
import {
	optimisticallyDeleteSpaceInListCaches,
	optimisticallyRemoveSpaceFromListCaches,
	restoreSpaceListCaches,
} from "./space-list-cache";
import { resolveMissingSpaceMembersMessage } from "./space-members-error-copy";
import { persistSpaceNameUpdate } from "./space-name-update";
import {
	type PendingOutgoingSignal,
	pendingOutgoingSignalsQueryKey,
	resolvePendingOutgoingProfile,
} from "./space-pending-outgoing-signals";
import {
	completeSpaceSend,
	markSpaceSendPending,
	setSpaceSendFailure,
} from "./space-pending-send";
import { usePublishSpaceWakeProgressVisibleProjection } from "./space-wake-progress-visible-projection";
import { useSpaceComposerSession } from "./use-space-composer-session";
import {
	type SpaceHistoryNavigationController,
	useSpaceHistoryNavigation,
} from "./use-space-history-navigation";
import { useSpaceInputQueue } from "./use-space-input-queue";
import {
	addSetValue,
	areWakeProgressItemsEqual,
	buildLocalWakeProgressItems,
	createClientMessageId,
	createStatusAndMembersRefreshDedupe,
	filterUnconfirmedRestoredWakeProgress,
	findSessionExpiredError,
	findUnconfirmedBootstrapWakeStream,
	findUnconfirmedPresentedWakeProgress,
	hasActiveSpaceMember,
	listPendingWakeProgressClientMessageIds,
	listRecoverableWakeProgressClientMessageIds,
	mergeActiveWakeProgressPresentation,
	mergeLiveThreadSignalIntoCache,
	mergeWakeProgressItemState,
	normalizeOptionalText,
	pollWakeProgress,
	readPublishedWakeTargetProfileIds,
	readSpaceStatusName,
	reconcileActiveWakeProgressSnapshot,
	reconcilePolledWakeProgressItems,
	recordDiagnosticReportPointer,
	recordWakeDiagnosticIfNeeded,
	refreshLanding,
	removeSetValue,
	removeWakeProgressItemsForClientMessageId,
	resolveBlockedWakeProfileIdFromSubmissionError,
	resolveComposerAddressingTargets,
	resolveComposerWakeProgressTargetProfileIds,
	resolveDeleteSpaceErrorMessage,
	resolveDiagnosticReportProblemType,
	resolveLeaveSpaceErrorMessage,
	resolveQueryError,
	resolveQueuedExecutionInput,
	resolveSpaceMembersLoadErrorMessage,
	resolveWakeProgressPollDelayMs,
} from "./use-space-landing-controller-helpers";
import { useSpaceLandingFeed } from "./use-space-landing-feed";
import type {
	SpaceComposerAddressingTarget,
	SpaceMentionPickerItem,
	useSpaceMentionAuthoring,
} from "./use-space-mention-authoring";
import { useSpaceThreadPanelSelection } from "./use-space-thread-panel-selection";
import { useSpaceUnread } from "./use-space-unread";

type TextSignalEnvelope = Extract<SignalEnvelope, { type: "signal.text" }>;

type SpaceMentionAuthoringController = ReturnType<
	typeof useSpaceMentionAuthoring
>;

type PendingComposerSubmission = ReturnType<
	SpaceMentionAuthoringController["prepareSubmission"]
> &
	SpaceComposerSendOptions;

type PreparedSpaceMessageSubmission = Pick<
	PendingComposerSubmission,
	| "agentRequestProfileIds"
	| "messageEnvelope"
	| "text"
	| "restoredFromSignalId"
	| "threadWakeContinuation"
> &
	SpaceComposerSendOptions;

type SpaceComposerSendBoundary =
	| { state: "access_rejected" }
	| { error: unknown; state: "failed" }
	| { state: "posting_not_allowed" }
	| { state: "ready"; status: GetSpaceStatusResponse };

class SpaceComposerSendBoundaryError extends Error {
	readonly boundary: Exclude<SpaceComposerSendBoundary, { state: "ready" }>;
	constructor(
		boundary: Exclude<SpaceComposerSendBoundary, { state: "ready" }>
	) {
		super(
			boundary.state === "posting_not_allowed" ||
				boundary.state === "access_rejected"
				? "Message not sent. You can no longer send messages in this Space."
				: "Message not sent. Check your connection and try again."
		);
		this.boundary = boundary;
	}
}

class PreparedSpaceMessageSendError extends Error {
	readonly clientMessageId: string;
	readonly originalError: unknown;
	readonly outcomeUnknown: boolean;
	readonly postedMessage: boolean;

	constructor(input: {
		clientMessageId: string;
		originalError: unknown;
		outcomeUnknown: boolean;
		postedMessage: boolean;
	}) {
		super("The prepared Space message send failed.");
		this.name = "PreparedSpaceMessageSendError";
		this.clientMessageId = input.clientMessageId;
		this.originalError = input.originalError;
		this.outcomeUnknown = input.outcomeUnknown;
		this.postedMessage = input.postedMessage;
	}
}

function unwrapPreparedSpaceMessageSendError(error: unknown): {
	originalError: unknown;
	outcomeUnknown: boolean;
	postedMessage: boolean;
} {
	if (error instanceof PreparedSpaceMessageSendError) {
		return error;
	}
	return {
		originalError: error,
		outcomeUnknown: false,
		postedMessage: false,
	};
}

function throwSpaceSendFailureWhenRequested(input: {
	error: unknown;
	postedMessage: boolean;
	throwOnFailure: boolean;
}): void {
	if (input.throwOnFailure && !input.postedMessage) {
		throw input.error;
	}
}

async function resolveSpaceComposerSendBoundary(input: {
	ensureEntryConfirmed: () => Promise<boolean>;
	readCurrentStatus: () => Promise<GetSpaceStatusResponse>;
}): Promise<SpaceComposerSendBoundary> {
	try {
		if (!(await input.ensureEntryConfirmed())) {
			return { state: "access_rejected" };
		}
		const status = await input.readCurrentStatus();
		if (!status.allowedActions.includes("post_message")) {
			return { state: "posting_not_allowed" };
		}
		return { state: "ready", status };
	} catch (error) {
		return { error, state: "failed" };
	}
}

function settleSpaceComposerSendBoundaryFailure(input: {
	boundary: Exclude<SpaceComposerSendBoundary, { state: "ready" }>;
	setComposerErrorMessage: (message: string | null) => void;
	throwOnFailure: boolean;
}): void {
	if (input.boundary.state === "access_rejected") {
		return;
	}
	if (input.boundary.state === "posting_not_allowed") {
		input.setComposerErrorMessage(
			"Message not sent. You can no longer send messages in this Space."
		);
		return;
	}
	input.setComposerErrorMessage(
		"Message not sent. Check your connection and try again."
	);
	throwSpaceSendFailureWhenRequested({
		error: input.boundary.error,
		postedMessage: false,
		throwOnFailure: input.throwOnFailure,
	});
}

function createPendingOutgoingSignal(input: {
	composerFiles?: readonly SpaceComposerFile[];
	files?: readonly SpaceMessageFileReference[];
	filePreviewUrlsById?: ReadonlyMap<string, string>;
	clientMessageId: string;
	createdAtMs: number;
	membersSnapshot: SpaceMembersSnapshot | null;
	messageEnvelope: TextSignalEnvelope["data"]["messageEnvelope"] | null;
	profileId: string;
	spaceId: string;
	text: string;
}): PendingOutgoingSignal {
	// Browser-only attachment placeholders are replaced with server references
	// before publication. Their local ids must never enter an API request.
	// A failed upload is still the same selected image during a message retry.
	// Admission and publication validate readiness; presentation must not erase it.
	const localFiles = input.composerFiles ?? [];
	const files =
		input.files ??
		localFiles.map((file) => ({
			fileId: file.localId,
			revision: 1,
			name: file.fileName,
			mimeType: file.mimeType,
			sizeBytes: file.upload?.sizeBytes ?? 0,
			...(file.imageDimensions
				? { imageDimensions: file.imageDimensions }
				: {}),
		}));
	const previewUrls = new Map(input.filePreviewUrlsById);
	for (const file of localFiles) {
		if (file.previewUrl) {
			previewUrls.set(file.localId, file.previewUrl);
		}
	}
	return {
		filePreviewUrlsById: previewUrls,
		clientMessageId: input.clientMessageId,
		signal: {
			v: 1,
			id: `pending:${input.clientMessageId}`,
			spaceId: input.spaceId,
			ts: input.createdAtMs,
			profile: resolvePendingOutgoingProfile({
				membersSnapshot: input.membersSnapshot,
				profileId: input.profileId,
			}),
			type: "signal.text",
			data: {
				text: input.text,
				...(files.length > 0 ? { files: [...files] } : {}),
				...(input.messageEnvelope
					? { messageEnvelope: input.messageEnvelope }
					: {}),
				meta: {
					clientMessageId: input.clientMessageId,
				},
			},
		},
	};
}

function buildComposerFileSubmission(input: {
	files: readonly SpaceComposerFile[];
	isPendingMessage: boolean;
}) {
	const composerFiles = input.isPendingMessage ? [] : input.files;

	return {
		hasSendableFiles: composerFiles.some((file) => file.status !== "failed"),
	};
}

function buildNormalMessagePostInput(input: {
	contextSelection?: SpaceComposerSendOptions["contextSelection"];
	contextSelections?: SpaceComposerSendOptions["contextSelections"];
	taskDraft?: SpaceComposerSendOptions["taskDraft"];
	deviceWait?: SpaceComposerSendOptions["deviceWait"];
	restoredFromSignalId?: string;
	files: readonly SpaceMessageFileReference[];
	clientMessageId: string;
	messageEnvelope: TextSignalEnvelope["data"]["messageEnvelope"] | null;
	spaceId: string;
	text: string;
}) {
	return {
		...(input.files.length > 0 ? { files: [...input.files] } : {}),
		...(input.messageEnvelope
			? { messageEnvelope: input.messageEnvelope }
			: {}),
		meta: {
			...(input.restoredFromSignalId
				? { restoredFromSignalId: input.restoredFromSignalId }
				: {}),
			clientMessageId: input.clientMessageId,
			authorHasRead: true as const,
		},
		spaceId: input.spaceId,
		text: input.text,
		...(input.deviceWait ? { deviceWait: input.deviceWait } : {}),
		timeoutMs: SPACE_MESSAGE_SEND_TIMEOUT_MS,
		...(input.contextSelection
			? { contextSelection: input.contextSelection }
			: {}),
		...(input.contextSelections
			? { contextSelections: input.contextSelections }
			: {}),
		...(input.taskDraft ? { taskDraft: input.taskDraft } : {}),
	};
}

function mergePersistedAndPendingOutgoingSignals(input: {
	persisted: readonly SignalEnvelope[];
	pending: readonly PendingOutgoingSignal[];
}): readonly SignalEnvelope[] {
	const confirmedClientMessageIds = new Set<string>();
	for (const signal of input.persisted) {
		if (signal.type !== "signal.text") {
			continue;
		}
		const clientMessageId = normalizeOptionalText(
			signal.data.meta?.clientMessageId
		);
		if (clientMessageId) {
			confirmedClientMessageIds.add(clientMessageId);
		}
	}

	const unconfirmedPendingSignals = input.pending
		.filter((item) => !confirmedClientMessageIds.has(item.clientMessageId))
		.map((item) => item.signal);

	return mergeSpaceTimelineEnvelopes({
		current: input.persisted,
		incoming: unconfirmedPendingSignals,
	});
}

function appendPendingOutgoingSignal(
	setPendingSignals: (value: SetStateAction<PendingOutgoingSignal[]>) => void,
	pendingSignal: PendingOutgoingSignal
) {
	if (
		hasNoPublishedComposerContent({
			files: pendingSignal.signal.data.files ?? [],
			text: pendingSignal.signal.data.text,
		})
	) {
		return;
	}
	setPendingSignals((current) => [
		...current.filter(
			(item) => item.clientMessageId !== pendingSignal.clientMessageId
		),
		pendingSignal,
	]);
}

function removePendingOutgoingSignal(
	setPendingSignals: (value: SetStateAction<PendingOutgoingSignal[]>) => void,
	clientMessageId: string
) {
	setPendingSignals((current) =>
		current.filter((item) => item.clientMessageId !== clientMessageId)
	);
}

function markPendingOutgoingSignalFailed(
	setPendingSignals: (value: SetStateAction<PendingOutgoingSignal[]>) => void,
	clientMessageId: string
) {
	setPendingSignals((current) =>
		current.map((item) =>
			item.clientMessageId === clientMessageId
				? {
						...item,
						signal: {
							...item.signal,
							id: `failed:${clientMessageId}`,
						},
					}
				: item
		)
	);
}

function clearPendingOutgoingSignalFilePreviews(
	setPendingSignals: (value: SetStateAction<PendingOutgoingSignal[]>) => void,
	clientMessageId: string
) {
	setPendingSignals((current) =>
		current.map((item) =>
			item.clientMessageId === clientMessageId
				? { ...item, filePreviewUrlsById: new Map() }
				: item
		)
	);
}

function consumePublishedComposerFilesAfterAcceptedOrUnknownSend(input: {
	clientMessageId: string | null;
	consumePublishedFiles: (publishedLocalIds: readonly string[]) => void;
	outcomeUnknown: boolean;
	postedMessage: boolean;
	publishedLocalIds: readonly string[];
	setPendingSignals: (value: SetStateAction<PendingOutgoingSignal[]>) => void;
}) {
	if (
		!(input.postedMessage || input.outcomeUnknown) ||
		input.publishedLocalIds.length === 0
	) {
		return;
	}
	if (input.clientMessageId) {
		clearPendingOutgoingSignalFilePreviews(
			input.setPendingSignals,
			input.clientMessageId
		);
	}
	input.consumePublishedFiles(input.publishedLocalIds);
}

function restoreFailedPendingSubmission(input: {
	mentionAuthoring: SpaceMentionAuthoringController;
	pendingSubmission: PendingComposerSubmission | null;
}): boolean {
	if (!input.pendingSubmission) {
		return false;
	}
	return input.mentionAuthoring.restoreFailedSubmission(
		input.pendingSubmission
	);
}

function resolvePendingSubmissionFiles(
	files: ReturnType<typeof useSpaceComposerSession>["files"],
	pending?: PendingSpaceMessage | null
) {
	return pending
		? files.getSubmissionFiles({
				ids: pending.fileDrafts?.map((draft) => draft.id),
				sources: pending.files,
			})
		: undefined;
}

function createSpaceMessageSendSeed(input: {
	composerText: string;
	pendingMessage: PendingSpaceMessage | undefined;
}): PendingSpaceMessage {
	return {
		clientMessageId:
			input.pendingMessage?.clientMessageId ?? createClientMessageId(),
		createdAtMs: input.pendingMessage?.createdAtMs ?? Date.now(),
		text: (input.pendingMessage?.text ?? input.composerText).trim(),
	};
}

function prepareSpaceMessageSendAttempt(input: {
	composerFiles: readonly SpaceComposerFile[];
	composerText: string;
	pendingMessage: PendingSpaceMessage | undefined;
}) {
	const fileSubmission = buildComposerFileSubmission({
		files: input.composerFiles,
		isPendingMessage:
			input.pendingMessage !== undefined && !input.pendingMessage.files?.length,
	});
	const messageSeed = createSpaceMessageSendSeed({
		composerText: input.composerText,
		pendingMessage: input.pendingMessage,
	});
	if (
		messageSeed.text.length === 0 &&
		!fileSubmission.hasSendableFiles &&
		!(input.pendingMessage?.files?.length && input.composerFiles.length)
	) {
		return {
			errorMessage: "Enter a message or add a file before sending.",
			status: "blocked" as const,
		};
	}
	return {
		fileSubmission,
		errorMessage: null,
		messageSeed,
		status: "ready" as const,
	};
}

function prepareMainComposerSubmission(input: {
	mentionAuthoring: SpaceMentionAuthoringController;
	messageSeed: PendingSpaceMessage;
	missingMembersMessage: string;
	pendingMessage: PendingSpaceMessage | undefined;
}): PendingComposerSubmission {
	if (
		input.messageSeed.text.length === 0 ||
		!(input.pendingMessage || input.mentionAuthoring.composerText.trim())
	) {
		return input.mentionAuthoring.prepareFileOnlySubmission(
			input.pendingMessage !== undefined
		);
	}
	if (input.pendingMessage) {
		return input.mentionAuthoring.preparePlainTextSubmission(
			input.messageSeed.text,
			input.missingMembersMessage
		);
	}
	return input.mentionAuthoring.prepareSubmission(input.missingMembersMessage);
}

function resolveThreadComposerBlockedReason(input: {
	hasActiveThread: boolean;
	hasSendableFiles: boolean;
	text: string;
}): string | null {
	if (!input.hasActiveThread) {
		return "Open a thread before sending.";
	}
	if (input.text.length === 0 && !input.hasSendableFiles) {
		return "Enter a reply or add a file before sending.";
	}
	return null;
}

function hasNoPublishedComposerContent(input: {
	files: readonly SpaceMessageFileReference[];
	text: string;
}): boolean {
	return input.text.length === 0 && input.files.length === 0;
}

async function refreshStatusAfterProtectedComposerFailure(input: {
	failure: StructuredApiClientFailure;
	refetchStatus: () => Promise<unknown>;
}): Promise<void> {
	if (isProtectedSpaceFailure(input.failure)) {
		await input.refetchStatus();
	}
}

// A message/reply that already posted successfully must never show a
// send-failure banner for a later step that breaks afterward (for example
// mention-recency bookkeeping hitting a full/blocked localStorage in
// recordSuccessfulSubmission) -- that would contradict the message the user
// can already see. Such a failure stays diagnostic-only. An unsent failure
// keeps showing the composer error exactly as before.
function reportComposerSendFailure(input: {
	failure: StructuredApiClientFailure;
	logMessage: string;
	postedMessage: boolean;
	setComposerErrorMessage: (message: string | null) => void;
}) {
	if (input.postedMessage) {
		console.error(input.logMessage, input.failure);
		return;
	}
	input.setComposerErrorMessage(
		resolveSpaceComposerSendErrorMessage(input.failure)
	);
}

function useSpaceBootstrapQueryCache(input: {
	bootstrap: SpaceBootstrapSnapshot | null;
	bootstrapUpdatedAt: number;
	profileId: string;
	queryClient: ReturnType<typeof useQueryClient>;
	spaceId: string;
}) {
	useLayoutEffect(() => {
		if (!input.bootstrap) {
			return;
		}

		applySpaceBootstrapSnapshotToCache({
			bootstrap: input.bootstrap,
			bootstrapUpdatedAt: input.bootstrapUpdatedAt,
			queryClient: input.queryClient,
			spaceId: input.spaceId,
			viewerProfileId: input.profileId,
		});
	}, [
		input.bootstrap,
		input.bootstrapUpdatedAt,
		input.profileId,
		input.queryClient,
		input.spaceId,
	]);
}

export async function hardRefreshSpaceStatusAndMembers(input: {
	profileId: string;
	queryClient: ReturnType<typeof useQueryClient>;
	spaceId: string;
}) {
	const statusQueryKey = spaceQueryKeys.status(input.spaceId, input.profileId);
	const membersQueryKey = spaceQueryKeys.members(
		input.spaceId,
		input.profileId
	);
	const resetIfEmpty = async (queryKey: readonly unknown[]) => {
		if (input.queryClient.getQueryData(queryKey) !== undefined) {
			return;
		}
		await input.queryClient.resetQueries(
			{ exact: true, queryKey },
			{ cancelRefetch: true }
		);
	};

	await Promise.all([
		input.queryClient.cancelQueries({ exact: true, queryKey: statusQueryKey }),
		input.queryClient.cancelQueries({ exact: true, queryKey: membersQueryKey }),
	]);
	await Promise.all([
		resetIfEmpty(statusQueryKey),
		resetIfEmpty(membersQueryKey),
	]);
	await Promise.all([
		input.queryClient.fetchQuery({
			...spaceStatusQueryOptions({
				enabled: true,
				spaceId: input.spaceId,
				openMeldProfileId: input.profileId,
			}),
			staleTime: 0,
		}),
		input.queryClient.fetchQuery({
			...spaceMembersQueryOptions({
				enabled: true,
				spaceId: input.spaceId,
				openMeldProfileId: input.profileId,
			}),
			staleTime: 0,
		}),
	]);
}

function resolveSpaceLandingHistorySnapshot(input: {
	bootstrap: SpaceBootstrapSnapshot;
	history: SpaceHistorySnapshot | undefined;
	members: SpaceMembersSnapshot;
}): SpaceHistorySnapshot | null {
	return mergeSpaceHistorySnapshots({
		current: input.history,
		incoming: enrichSpaceHistoryAgentControllerPresentation({
			history: input.bootstrap.history,
			members: input.members,
		}),
	});
}

function hasInitialMessageTarget(input: {
	initialFocusSignalId?: string;
	initialFocusThreadRootSignalId?: string;
}): boolean {
	return Boolean(
		input.initialFocusSignalId || input.initialFocusThreadRootSignalId
	);
}

function useSpaceTargetStatus(
	input: { spaceId: string; profileId: string; hasMessageTarget: boolean },
	entryConfirmed: boolean
) {
	return useQuery(
		spaceStatusQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
			// Only explicit destinations need status independently of the full bootstrap.
			enabled: entryConfirmed && input.hasMessageTarget,
		})
	);
}

function useSpaceLandingBootstrapState(input: {
	hasMessageTarget: boolean;
	profileId: string;
	queryClient: ReturnType<typeof useQueryClient>;
	spaceId: string;
}) {
	const entryConfirmation = useSpaceEntryConfirmation();
	const entryConfirmed = entryConfirmation.confirmed;
	const bootstrapQuery = useQuery(
		spaceBootstrapQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
			enabled: true,
		})
	);
	useSpaceBootstrapQueryCache({
		bootstrap: bootstrapQuery.data ?? null,
		bootstrapUpdatedAt: bootstrapQuery.dataUpdatedAt,
		profileId: input.profileId,
		queryClient: input.queryClient,
		spaceId: input.spaceId,
	});
	const statusQuery = useSpaceTargetStatus(input, entryConfirmed);
	const displaySnapshotQuery = useQuery(
		spaceConversationDisplaySnapshotQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
		})
	);
	const bootstrapError = resolveQueryError({
		error: bootstrapQuery.error,
		isError: bootstrapQuery.isError,
	});
	const statusError = resolveQueryError({
		error: statusQuery.error,
		isError: statusQuery.isError,
	});
	const currentAccessRejection =
		[statusError, bootstrapError].find(isCurrentSpaceAccessRejection) ?? null;
	const landingError = currentAccessRejection ?? bootstrapError ?? statusError;
	const contentReadAllowed = entryConfirmed && currentAccessRejection === null;
	const currentStatusSnapshot = contentReadAllowed
		? (statusQuery.data ?? null)
		: null;
	useEffect(() => {
		if (currentStatusSnapshot === null) {
			return;
		}
		input.queryClient.setQueryData(
			spaceQueryKeys.displaySnapshot(input.spaceId, input.profileId),
			createSpaceConversationDisplaySnapshot(currentStatusSnapshot)
		);
	}, [
		currentStatusSnapshot,
		input.profileId,
		input.queryClient,
		input.spaceId,
	]);
	const membersQuery = useQuery(
		spaceMembersQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
			enabled: true,
		})
	);
	const membersSnapshot = membersQuery.data ?? null;
	const presentationMembersSnapshot = bootstrapQuery.data
		? resolveSpaceMembersPresentationSnapshot({
				bootstrap: bootstrapQuery.data.members,
				includesAgentReadiness: bootstrapQuery.data.includesAgentReadiness,
				current: membersSnapshot,
			})
		: membersSnapshot;
	const historyQuery = useQuery(
		spaceHistoryQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
			enabled: false,
		})
	);
	const historySnapshot = useMemo(() => {
		if (!bootstrapQuery.data) {
			return historyQuery.data ?? null;
		}
		if (!presentationMembersSnapshot) {
			return null;
		}
		return resolveSpaceLandingHistorySnapshot({
			bootstrap: bootstrapQuery.data,
			history: historyQuery.data,
			members: presentationMembersSnapshot,
		});
	}, [bootstrapQuery.data, historyQuery.data, presentationMembersSnapshot]);
	const restoredDisplayStatus =
		currentAccessRejection === null &&
		currentStatusSnapshot === null &&
		displaySnapshotQuery.data
			? readOnlySpaceStatusFromDisplaySnapshot(displaySnapshotQuery.data)
			: null;
	const statusSnapshot = currentStatusSnapshot ?? restoredDisplayStatus;
	const currentStatusConfirmationPending =
		currentStatusSnapshot === null && landingError === null;
	const membersError = resolveQueryError({
		error: membersQuery.error,
		isError: membersQuery.isError,
	});
	const membersLoadError =
		membersError ?? (membersSnapshot === null ? bootstrapError : null);
	const historyError = resolveQueryError({
		error: historyQuery.error,
		isError: historyQuery.isError,
	});

	return {
		bootstrapError,
		bootstrapQuery,
		currentAccessRejection,
		currentStatusConfirmationPending,
		historyError,
		historyPending:
			historySnapshot === null &&
			(bootstrapQuery.isPending || historyQuery.isPending),
		historyQuery,
		historyReady: historySnapshot !== null || historyQuery.isSuccess,
		historySnapshot,
		ensureEntryConfirmed: entryConfirmation.ensureConfirmed,
		entryConfirmed: contentReadAllowed,
		landingError,
		membersError: membersLoadError,
		membersErrorMessage: resolveSpaceMembersLoadErrorMessage(membersLoadError),
		membersLoading:
			membersSnapshot === null &&
			membersLoadError === null &&
			(bootstrapQuery.isPending || membersQuery.isFetching),
		membersQuery,
		membersReady: membersSnapshot !== null || membersQuery.isSuccess,
		membersSnapshot,
		presentationMembersSnapshot,
		statusQuery,
		statusReady: currentStatusSnapshot !== null,
		statusSnapshot,
	};
}

function useClearRejectedSpaceConversationCache(input: {
	currentAccessRejection: StructuredApiClientFailure | null;
	organizationId?: string | null;
	organizationSlug?: string;
	ownerAccountId: string;
	profileId: string;
	queryClient: ReturnType<typeof useQueryClient>;
	spaceId: string;
}): void {
	const queryPersistence = useMemo(
		() => resolveAppQueryPersistenceController(),
		[]
	);
	useEffect(() => {
		if (!input.currentAccessRejection) {
			return;
		}
		clearSpaceFileMediaResources(input.queryClient, input.spaceId);
		if (!(input.organizationId && input.organizationSlug)) {
			return;
		}
		queryPersistence
			.clearSpaceConversation({
				organizationId: input.organizationId,
				organizationSlug: input.organizationSlug,
				ownerAccountId: input.ownerAccountId,
				queryClient: input.queryClient,
				spaceId: input.spaceId,
				openMeldProfileId: input.profileId,
			})
			.catch((error: unknown) => {
				console.error("Failed to clear an inaccessible saved Space view.", {
					error,
					spaceId: input.spaceId,
				});
			});
	}, [
		input.currentAccessRejection,
		input.organizationId,
		input.organizationSlug,
		input.ownerAccountId,
		input.profileId,
		input.queryClient,
		input.spaceId,
		queryPersistence,
	]);
}

function resolveConfirmedViewedUpdatesHandler(input: {
	isCurrentAccessConfirmed: boolean;
	onViewedUpdates?: (
		targets: readonly SpaceInboxUnreadTarget[]
	) => Promise<void> | void;
}):
	| ((targets: readonly SpaceInboxUnreadTarget[]) => Promise<void> | void)
	| undefined {
	return input.isCurrentAccessConfirmed ? input.onViewedUpdates : undefined;
}

function resolveSpaceQueuedInputItems(input: {
	queue: ReturnType<typeof useSpaceInputQueue>;
	accessConfirmed: boolean;
	isActiveMember: boolean;
}): SpaceInputQueueResponse["items"] {
	return input.accessConfirmed &&
		input.isActiveMember &&
		input.queue.supportsConversationContext
		? input.queue.items
		: [];
}

function shouldShowSpaceLandingLoading(input: {
	bootstrapPending: boolean;
	currentStatusConfirmationPending: boolean;
	hasDisplayStatus: boolean;
	hasPendingMessage: boolean;
	membershipState: CurrentProfileSpaceMembershipState;
	membersError: unknown;
}): boolean {
	return (
		(input.hasPendingMessage &&
			input.membershipState === "unknown" &&
			!input.membersError) ||
		(!input.hasDisplayStatus &&
			(input.currentStatusConfirmationPending || input.bootstrapPending))
	);
}

export type SpaceLandingController =
	| {
			inlineErrorMessage: string | null;
			isSubmitting: boolean;
			mode: "password";
			onPasswordChange: (value: string) => void;
			onRefresh: () => Promise<void>;
			onSubmit: () => Promise<void>;
			password: string;
			spaceId: string;
	  }
	| {
			error: StructuredApiClientFailure | null;
			mode: "failure";
			onRetry: () => Promise<void>;
			spaceId: string;
	  }
	| (SpaceLandingConversationController &
			(
				| { mode: "loading"; status: GetSpaceStatusResponse | null }
				| { mode: "ready"; status: GetSpaceStatusResponse }
			));

function resolveSpaceConversationPhase(
	isLoading: boolean,
	status: GetSpaceStatusResponse | null
) {
	if (!(status || isLoading)) {
		return { mode: "failure" as const, status };
	}
	return status && !isLoading
		? { mode: "ready" as const, status }
		: { mode: "loading" as const, status };
}

export type SpaceLandingConversationController = {
	activeThread: SpaceThread | null;
	composerFileSession: ReturnType<typeof useSpaceComposerSession>["files"];
	threadPanelOpen: boolean;
	agentStreams: readonly SpaceConversationVisibleStreamProjection[];
	composerAddressingTargets: readonly SpaceComposerAddressingTarget[];
	composerAuthoredMentions: ComposerDraftRecord["authoredMentions"];
	composerMentionPickerItems: readonly SpaceMentionPickerItem[];
	composerAgentRequestMentions?: SpaceAgentRequestMentions;
	composerMentionEmptyMessage?: string;
	composerFiles: readonly SpaceComposerFile[];
	composerFileLimitReached: boolean;
	composerFileCleanup: readonly ComposerFileDraftCleanup[];
	composerFileRestorationError: unknown | null;
	composerBlockedWakeProfileId: string | null;
	composerErrorMessage: string | null;
	composerHasAuthoredMentions: boolean;
	composerReplyToSignalId: string | null;
	composerText: string;
	presentedWakeProgressItems: readonly SpaceEphemeralActivityItem[];
	queuedInputItems: readonly SpaceInputQueueResponse["items"][number][];
	ownActiveWakesHaveMore: boolean;
	historyNavigation: SpaceHistoryNavigationController;
	hasEarlierHistory: boolean;
	historyActionErrorMessage: string | null;
	historyError: StructuredApiClientFailure | null;
	historyIsPending: boolean;
	deleteSpaceErrorMessage: string | null;
	showDeleteSpaceAction: boolean;
	isLeaveSpacePending: boolean;
	isDeleteSpacePending: boolean;
	isAccessModePending: boolean;
	isSpaceNamePending: boolean;
	isLoadingEarlierHistory: boolean;
	isAgentRecoveryPending: (profileId: string) => boolean;
	isMembersLoading: boolean;
	isMembersRefreshing: boolean;
	isCurrentAccessConfirmed: boolean;
	currentProfileMembershipState: CurrentProfileSpaceMembershipState;
	isSendingMessage: boolean;
	isDiagnosticReportPending: (signalId: string) => boolean;
	isDiagnosticReportSent: (signalId: string) => boolean;
	leaveSpaceErrorMessage: string | null;
	accessModeErrorMessage: string | null;
	spaceNameErrorMessage: string | null;
	liveState: SpaceLiveState;
	onRetryLiveUpdates: () => void;
	membersError: StructuredApiClientFailure | null;
	membersSnapshot: SpaceMembersSnapshot | null;
	presentationMembersSnapshot: SpaceMembersSnapshot | null;
	onComposerEditorChange: (change: SpaceComposerEditorChange) => void;
	onClearComposerReplyTo: () => void;
	onAddComposerFiles: (files: readonly File[]) => Promise<void>;
	onRemoveComposerFile: (localId: string) => void;
	onRetryComposerFile: (localId: string) => Promise<void>;
	onRetryComposerFileCleanup: (localId: string) => Promise<void>;
	onRetryComposerFileRestoration: () => void;
	onConversationViewedUpdates?: (
		targets: readonly SpaceInboxUnreadTarget[]
	) => Promise<void> | void;
	onJumpToDate: (date: Date) => Promise<string | null>;
	onLoadEarlierHistory: () => Promise<void>;
	onDeleteSpace: () => Promise<void>;
	onLeaveSpace: () => Promise<void>;
	onCloseThread: () => void;
	onCreateThread: (input: { rootSignalId: string }) => Promise<void>;
	onMentionButtonClick: () => void;
	onOpenThread: (threadId: string) => void;
	onOpenUnreadThread: (input: {
		rootSignalId: string;
		signalId: string;
		threadId?: string;
	}) => Promise<boolean>;
	onRefresh: () => Promise<void>;
	onRefreshMembers: () => Promise<void>;
	onHardRefreshStatusAndMembers: () => Promise<void>;
	onRefreshStatusAndMembers: () => Promise<void>;
	onSetAccessMode: (input: {
		accessMode: SpaceAccessMode;
		allowGuests?: boolean;
		linkJoinPolicy?: SpaceLinkJoinPolicy;
		password?: string;
		visibility?: "public" | "private";
	}) => Promise<void>;
	onUpdateSpaceName: (name: string) => Promise<void>;
	onThreadComposerEditorChange: (change: SpaceComposerEditorChange) => void;
	onThreadMentionButtonClick: () => void;
	onThreadSend: (options?: SpaceComposerSendOptions) => Promise<void>;
	onThreadSendText: (text: string) => Promise<void>;
	onComposeExpiredDeviceWait: (request: {
		sourceSignalId: string;
		targetProfileId: string;
	}) => void;
	onThreadComposeExpiredDeviceWait: (request: {
		sourceSignalId: string;
		targetProfileId: string;
	}) => void;
	onAddThreadComposerFiles: (files: readonly File[]) => Promise<void>;
	onRemoveThreadComposerFile: (localId: string) => void;
	onRetryThreadComposerFile: (localId: string) => Promise<void>;
	onRetryThreadComposerFileCleanup: (localId: string) => Promise<void>;
	onRetryThreadComposerFileRestoration: () => void;
	onReplyToMessage: (item: SpaceTimelineItem) => void;
	onReportMessage: (item: SpaceTimelineItem) => Promise<void>;
	onRecoverExecution: (
		input: SpaceExecutionRecoveryAttempt
	) => Promise<SpaceExecutionRecoveryResolution>;
	onAgentInteractionResponse: (
		input: RespondToSpaceAgentInteractionBody
	) => Promise<void>;
	onWakeStopRequest: (
		target: SpaceWakeStopTargetResolution
	) => Promise<PostSpaceWakeStopResponse>;
	onUpdateAgentProfileBinding: (input: {
		controllerEnabled: boolean;
		agentControllerRef: string;
		deviceId: string | null;
		profileId: string;
		profileName: string;
		runtimeLane: DaemonServiceLane | null;
	}) => Promise<void>;
	onSend: (options?: SpaceComposerSendOptions) => Promise<void>;
	onSendText: (text: string) => Promise<void>;
	profileId: string;
	spaceId: string;
	threadComposerBlockedWakeProfileId: string | null;
	threadComposerAddressingTargets: readonly SpaceComposerAddressingTarget[];
	threadComposerAuthoredMentions: ComposerDraftRecord["authoredMentions"];
	threadComposerMentionPickerItems: readonly SpaceMentionPickerItem[];
	threadComposerErrorMessage: string | null;
	threadComposerHasAuthoredMentions: boolean;
	threadComposerText: string;
	threadComposerReplyToSignalId: string | null;
	onClearThreadComposerReplyTo: () => void;
	onThreadReplyToMessage: (item: SpaceTimelineItem) => void;
	threadComposerFiles: readonly SpaceComposerFile[];
	threadComposerFileLimitReached: boolean;
	threadComposerFileCleanup: readonly ComposerFileDraftCleanup[];
	threadComposerFileRestorationError: unknown | null;
	threadFilePreviewUrlsById: ReadonlyMap<string, string>;
	threadEphemeralActivityItems: readonly SpaceEphemeralActivityItem[];
	threads: readonly SpaceThread[];
	threadPreviews: readonly SpaceThreadPreview[];
	threadSignals: readonly SignalEnvelope[];
	threadWakeRecommendationsEnabled: boolean;
	threadsErrorMessage: string | null;
	threadSignalsErrorMessage: string | null;
	threadsIsLoading: boolean;
	threadSignalsIsLoading: boolean;
	threadUnreadFocus: {
		requestId: number;
		rootSignalId: string;
		signalId: string;
	} | null;
	isCreatingThread: boolean;
	isSendingThreadMessage: boolean;
	threadTextareaRef: SpaceComposerInputRef;
	textareaRef: SpaceComposerInputRef;
	timelineItems: readonly SpaceTimelineItem[];
	firstUnreadSignalId: string | null;
	unreadCount: number;
	unreadStateReady: boolean;
	wakeStopRequestStatusBySelectorKey: ReadonlyMap<
		string,
		SpaceWakeStopRequestStatus
	>;
};

type CurrentProfileSpaceMembershipState = "member" | "nonmember" | "unknown";

function useCurrentProfileSpaceMembershipState(input: {
	membersSnapshot: SpaceMembersSnapshot | null;
	profileId: string;
	spaceId: string;
}): CurrentProfileSpaceMembershipState {
	const identity = `${input.spaceId}:${input.profileId}`;
	let confirmedState: Exclude<
		CurrentProfileSpaceMembershipState,
		"unknown"
	> | null = null;
	if (input.membersSnapshot) {
		confirmedState = hasActiveSpaceMember({
			membersSnapshot: input.membersSnapshot,
			profileId: input.profileId,
		})
			? "member"
			: "nonmember";
	}
	const lastConfirmedRef = useRef<{
		identity: string;
		state: Exclude<CurrentProfileSpaceMembershipState, "unknown">;
	} | null>(null);

	useEffect(() => {
		if (confirmedState === null) {
			return;
		}
		lastConfirmedRef.current = { identity, state: confirmedState };
	}, [confirmedState, identity]);

	if (confirmedState !== null) {
		return confirmedState;
	}
	return lastConfirmedRef.current?.identity === identity
		? lastConfirmedRef.current.state
		: "unknown";
}

function assertMatchingSpaceExecutionRecovery(input: {
	recovery: ExecutionRecoveryProjection;
	recoveryInput: SpaceExecutionRecoveryAttempt;
	spaceId: string;
}): void {
	const { recovery, recoveryInput, spaceId } = input;
	if (
		recovery.identity.dispatchId !== recoveryInput.dispatchId ||
		(recoveryInput.resultRef !== null &&
			recovery.identity.resultRef !== recoveryInput.resultRef) ||
		recovery.identity.targetProfileId !== recoveryInput.targetProfileId ||
		recovery.destination.surface !== "space" ||
		recovery.destination.spaceId !== spaceId
	) {
		throw new Error(
			"The recovery capability no longer matches this execution."
		);
	}
}

function resolveRequestedExecutionRecoveryCapability(
	recovery: ExecutionRecoveryProjection,
	action: Exclude<SpaceExecutionRecoveryAttempt["action"], null>
) {
	switch (action) {
		case "recover_result":
			return recovery.actions.recoverResult;
		case "resume_controller_conversation":
			return recovery.actions.resumeControllerConversation;
		case "retry_as_new_execution":
			throw new Error(
				"Starting a new Wake is not an execution recovery action."
			);
		default: {
			const unsupportedAction: never = action;
			throw new Error(
				`Unsupported execution recovery action: ${String(unsupportedAction)}`
			);
		}
	}
}

function resolveSpaceExecutionRecoverySuccessMessage(input: {
	action: Exclude<SpaceExecutionRecoveryAttempt["action"], null>;
	status: "already_completed" | "completed" | "new_execution_requested";
}): string {
	if (input.status === "already_completed") {
		return "Recovery already completed";
	}
	if (input.action === "resume_controller_conversation") {
		return "Conversation continued";
	}
	return "Result recovered";
}

function showSpaceExecutionRecoveryFailureToast(input: {
	action: SpaceExecutionRecoveryAttempt["action"];
	message: string;
}): void {
	if (input.action === null) {
		return;
	}
	toast.error(`Couldn't recover this result. ${input.message}`);
}

function useRestoredWakeProgressItems(
	key: string,
	items: readonly WakeProgressItem[]
): readonly WakeProgressItem[] {
	const restoredRef = useRef({ key, items });
	if (restoredRef.current.key !== key) {
		restoredRef.current = { key, items };
	}
	return restoredRef.current.items;
}

function useWakeProgressPresentationInvariant(input: {
	spaceId: string;
	confirmedItems: readonly WakeProgressItem[];
	presentedItems: readonly WakeProgressItem[];
	restoredItems: readonly WakeProgressItem[];
	historicalSignals: readonly SignalEnvelope[];
	presentationCreatedAtMs: number;
	cachedSpaceSummaryItems?: readonly WakeProgressItem[];
	cachedOwnSummaryItems?: readonly WakeProgressItem[];
	streamProjections: readonly SpaceConversationVisibleStreamProjection[];
	spaceSummaryFetchedAfterMount: boolean;
	ownSummaryFetchedAfterMount: boolean;
	bootstrapFetchedAfterMount: boolean;
}): void {
	useEffect(() => {
		const anomaly = findUnconfirmedPresentedWakeProgress(input);
		if (anomaly) {
			reportUnconfirmedWakeProgressPresentation({
				spaceId: input.spaceId,
				clientMessageId: anomaly.item.clientMessageId,
				dispatchId: anomaly.item.dispatchId,
				sourceSignalId: anomaly.item.sourceSignalId,
				streamId: null,
				sourceThreadId: anomaly.item.sourceContext?.threadId ?? null,
				replyThreadRootSignalId: null,
				targetProfileId: anomaly.item.targetProfileId,
				phase: anomaly.item.phase,
				updatedAtMs: anomaly.item.updatedAtMs,
				fromRestoredPresentation: anomaly.fromRestoredPresentation,
				fromCachedSpaceSummary: anomaly.fromCachedSpaceSummary,
				fromCachedOwnSummary: anomaly.fromCachedOwnSummary,
				fromBootstrapStream: false,
				fromHistoricalSignal: anomaly.fromHistoricalSignal,
				spaceSummaryFetchedAfterMount: input.spaceSummaryFetchedAfterMount,
				ownSummaryFetchedAfterMount: input.ownSummaryFetchedAfterMount,
				bootstrapFetchedAfterMount: input.bootstrapFetchedAfterMount,
			});
		}
		const stream = findUnconfirmedBootstrapWakeStream({
			bootstrapFetchedAfterMount: input.bootstrapFetchedAfterMount,
			confirmedItems: input.confirmedItems,
			streams: input.streamProjections,
		});
		if (!stream) {
			return;
		}
		reportUnconfirmedWakeProgressPresentation({
			spaceId: input.spaceId,
			clientMessageId: null,
			dispatchId: stream.dispatchId,
			sourceSignalId: stream.triggerMessageId,
			streamId: stream.streamId,
			sourceThreadId: null,
			replyThreadRootSignalId: stream.replyThreadRootSignalId ?? null,
			targetProfileId: stream.profileId,
			phase: "running",
			updatedAtMs: stream.updatedAtMs,
			fromRestoredPresentation: false,
			fromCachedSpaceSummary: false,
			fromCachedOwnSummary: false,
			fromBootstrapStream: true,
			fromHistoricalSignal: false,
			spaceSummaryFetchedAfterMount: input.spaceSummaryFetchedAfterMount,
			ownSummaryFetchedAfterMount: input.ownSummaryFetchedAfterMount,
			bootstrapFetchedAfterMount: input.bootstrapFetchedAfterMount,
		});
	}, [input]);
}

type WakePresentation = Parameters<
	typeof readSpaceWakeProgressSummaryItems
>[0]["presentation"];
type WakeSummary = Parameters<
	typeof readSpaceWakeProgressSummaryItems
>[0]["summary"];

function readConfirmedWakeProgressItems(input: {
	presentation: WakePresentation;
	spaceSummary: WakeSummary;
	ownSummary: WakeSummary;
	spaceSummaryFetchedAfterMount: boolean;
	ownSummaryFetchedAfterMount: boolean;
	signals: readonly SignalEnvelope[];
}): WakeProgressItem[] {
	return mergeWakeProgressItemState({
		currentItems: readSpaceWakeProgressSummaryItems({
			presentation: input.presentation,
			summary: input.spaceSummary,
			isFetchedAfterMount: input.spaceSummaryFetchedAfterMount,
		}),
		incomingItems: readSpaceWakeProgressSummaryItems({
			presentation: input.presentation,
			summary: input.ownSummary,
			isFetchedAfterMount: input.ownSummaryFetchedAfterMount,
		}),
		signals: input.signals,
	});
}

function readPresentedWakeProgressItems(input: {
	presentation: WakePresentation;
	confirmedItems: readonly WakeProgressItem[];
	currentItems: readonly WakeProgressItem[];
	restoredItems: readonly WakeProgressItem[];
	signals: readonly SignalEnvelope[];
}): WakeProgressItem[] {
	return filterSpaceWakeProgressItems({
		presentation: input.presentation,
		items: mergeActiveWakeProgressPresentation({
			detailedItems: filterUnconfirmedRestoredWakeProgress({
				confirmedItems: input.confirmedItems,
				currentItems: input.currentItems,
				restoredItems: input.restoredItems,
			}),
			signals: input.signals,
			summaryItems: input.confirmedItems,
		}),
	});
}

async function clearDepartedSpaceCaches(input: {
	queryClient: ReturnType<typeof useQueryClient>;
	organizationId?: string | null;
	orgSlug?: string;
	ownerAccountId: string;
	profileId: string;
	spaceId: string;
}): Promise<void> {
	input.queryClient.removeQueries({
		predicate: (query) =>
			query.queryKey[0] === "spaces" &&
			query.queryKey[2] === input.spaceId &&
			query.queryKey[3] === input.profileId,
	});
	if (input.organizationId && input.orgSlug) {
		await resolveAppQueryPersistenceController().clearSpaceConversation({
			organizationId: input.organizationId,
			organizationSlug: input.orgSlug,
			ownerAccountId: input.ownerAccountId,
			queryClient: input.queryClient,
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
		});
	}
}

export function useSpaceLandingController(input: {
	initialFocusRequestId?: string;
	initialFocusSignalId?: string;
	initialFocusThreadRootSignalId?: string;
	centerAgentProfileId?: string | null;
	initialComposerDraft?: ComposerDraftRecord | null;
	composerDraftMigrationScopes?: readonly ComposerDraftScope[];
	initialPendingMessage?: PendingSpaceMessage | null;
	onWakeFinalOutcomeFactsRefresh?: (input: {
		agentProfileIds: readonly string[];
		signalIds: readonly string[];
	}) => Promise<void> | void;
	onInitialPendingMessageConsumed?: () => void;
	onViewedUpdates?: (
		targets: readonly SpaceInboxUnreadTarget[]
	) => Promise<void> | void;
	unreadStateReady?: boolean;
	unreadTotalCount: number;
	unreadTargets?: readonly SpaceInboxUnreadTarget[];
	unreadScopes?: SpaceInboxUnreadTargetsResponse["scopes"];
	unreadBoundaryVersion?: number;
	organizationId?: string | null;
	orgSlug?: string;
	ownerAccountId: string;
	profileId: string;
	spaceId: string;
}): SpaceLandingController {
	const [password, setPassword] = useState("");
	const [passwordErrorMessage, setPasswordErrorMessage] = useState<
		string | null
	>(null);
	const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
	const [pendingOutgoingSignals, setPendingOutgoingSignals] =
		usePendingOutgoingSignals(input.spaceId, input.profileId, null);
	const [
		pendingDiagnosticReportSignalIds,
		setPendingDiagnosticReportSignalIds,
	] = useState<ReadonlySet<string>>(() => new Set());
	const [sentDiagnosticReportSignalIds, setSentDiagnosticReportSignalIds] =
		useState<ReadonlySet<string>>(() => new Set());
	const [hasEarlierHistory, setHasEarlierHistory] = useState(true);
	const [historyActionErrorMessage, setHistoryActionErrorMessage] = useState<
		string | null
	>(null);
	const [isLoadingEarlierHistory, setIsLoadingEarlierHistory] = useState(false);
	const [isAccessModePending, setIsAccessModePending] = useState(false);
	const [isSpaceNamePending, setIsSpaceNamePending] = useState(false);
	const [isLeavingSpace, setIsLeavingSpace] = useState(false);
	const [isDeletingSpace, setIsDeletingSpace] = useState(false);
	const [
		wakeStopRequestStatusBySelectorKey,
		setWakeStopRequestStatusBySelectorKey,
	] = useWakeStopRequests(input.profileId, input.spaceId);
	const recoveredWakeProgressClientMessageIdsRef = useRef(new Set<string>());
	const [pendingAgentRecoveryProfileId, setPendingAgentRecoveryProfileId] =
		useState<string | null>(null);
	const [leaveSpaceErrorMessage, setLeaveSpaceErrorMessage] = useState<
		string | null
	>(null);
	const [deleteSpaceErrorMessage, setDeleteSpaceErrorMessage] = useState<
		string | null
	>(null);
	const [accessModeErrorMessage, setAccessModeErrorMessage] = useState<
		string | null
	>(null);
	const [spaceNameErrorMessage, setSpaceNameErrorMessage] = useState<
		string | null
	>(null);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const inputQueue = useSpaceInputQueue({
		spaceId: input.spaceId,
		profileId: input.profileId,
		enabled: input.spaceId.length > 0,
	});
	const wakeProgressPresentationQuery = useQuery(
		spaceWakeProgressPresentationQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
		})
	);
	const wakeProgressItems = wakeProgressPresentationQuery.data.items;
	const wakeProgressEntryKey = `${input.spaceId}:${input.profileId}`;
	const restoredWakeProgressItems = useRestoredWakeProgressItems(
		wakeProgressEntryKey,
		wakeProgressItems
	);
	const setWakeProgressItems = useCallback(
		(items: SetStateAction<WakeProgressItem[]>) => {
			setSpaceWakeProgressPresentationItems({
				items,
				queryClient,
				spaceId: input.spaceId,
				openMeldProfileId: input.profileId,
			});
		},
		[input.profileId, input.spaceId, queryClient]
	);
	// Requests the owner has answered in this Space; see
	// presentAnsweredAgentInteractions for why they are applied locally.
	const [answeredAgentInteractionKeys, setAnsweredAgentInteractionKeys] =
		useState<ReadonlySet<string>>(() => new Set());
	const activeWakeProgressSummaryQuery = useQuery(
		spaceActiveWakeProgressSummaryQueryOptions({
			enabled:
				input.profileId.trim().length > 0 && input.spaceId.trim().length > 0,
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
		})
	);
	const ownActiveWakeProgressQuery = useQuery(
		spaceActiveWakeProgressSummaryQueryOptions({
			enabled: [input.profileId, input.spaceId].every(
				(value) => value.trim().length > 0
			),
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
			sourceProfileId: input.profileId,
		})
	);
	useEffect(() => {
		if (!activeWakeProgressSummaryQuery.isError) {
			return;
		}
		console.warn("[openmeld.web.space.active_wake_progress_summary_failed]", {
			error: activeWakeProgressSummaryQuery.error.message,
			spaceId: input.spaceId,
		});
	}, [
		activeWakeProgressSummaryQuery.error,
		activeWakeProgressSummaryQuery.isError,
		input.spaceId,
	]);
	const refreshStatusAndMembersDedupeRef = useRef(
		createStatusAndMembersRefreshDedupe()
	);
	const handleLiveThreadSignal = useCallback(
		(signalInput: {
			placement: SpaceThreadSignalPlacement;
			signal: SignalEnvelope;
			threadContext: SpaceThreadContext;
		}) => {
			recordSpaceWakeProgressEvidence({
				queryClient,
				spaceId: input.spaceId,
				openMeldProfileId: input.profileId,
				signals: [signalInput.signal],
			});
			setWakeProgressItems((currentItems) => {
				const nextItems = applyWakeProgressSignals({
					currentItems,
					signals: [signalInput.signal],
				});
				return areWakeProgressItemsEqual(currentItems, nextItems)
					? currentItems
					: nextItems;
			});
			mergeLiveThreadSignalIntoCache({
				openMeldProfileId: input.profileId,
				placement: signalInput.placement,
				queryClient,
				signal: signalInput.signal,
				spaceId: input.spaceId,
				threadContext: signalInput.threadContext,
			});
		},
		[input.profileId, input.spaceId, queryClient, setWakeProgressItems]
	);

	const {
		bootstrapError,
		bootstrapQuery,
		currentAccessRejection,
		currentStatusConfirmationPending,
		ensureEntryConfirmed,
		entryConfirmed,
		historyError,
		historyPending,
		historyQuery,
		historyReady,
		historySnapshot,
		landingError,
		membersError,
		membersErrorMessage,
		membersLoading,
		membersQuery,
		membersReady,
		membersSnapshot,
		presentationMembersSnapshot,
		statusQuery,
		statusReady,
		statusSnapshot,
	} = useSpaceLandingBootstrapState({
		hasMessageTarget: hasInitialMessageTarget(input),
		profileId: input.profileId,
		queryClient,
		spaceId: input.spaceId,
	});
	useClearRejectedSpaceConversationCache({
		currentAccessRejection,
		organizationId: input.organizationId,
		organizationSlug: input.orgSlug,
		ownerAccountId: input.ownerAccountId,
		profileId: input.profileId,
		queryClient,
		spaceId: input.spaceId,
	});

	const currentProfileMembershipState = useCurrentProfileSpaceMembershipState({
		membersSnapshot,
		profileId: input.profileId,
		spaceId: input.spaceId,
	});
	const currentProfileIsActiveSpaceMember =
		currentProfileMembershipState === "member";
	useActiveSpaceHistorySync({
		currentProfileIsActiveSpaceMember,
		membersReady,
		profileId: input.profileId,
		queryClient,
		spaceId: input.spaceId,
		spaceName: readSpaceStatusName(statusSnapshot ?? undefined),
		statusReady,
	});
	// An older bootstrap cannot seed active streams after the progress cache
	// (and its completion evidence) has been collected. Live frames and the
	// ordinary authorized bootstrap refresh still restore current streams.
	const bootstrapBelongsToProgressLifetime =
		bootstrapQuery.dataUpdatedAt >=
		wakeProgressPresentationQuery.data.createdAtMs;
	const {
		agentStreamProjections: liveAgentStreamProjections,
		liveState,
		mergePersistedIncoming,
		retryLiveUpdates,
		timelineEnvelopes,
	} = useSpaceLandingFeed({
		openMeldProfileId: input.profileId,
		participationEnabled: currentProfileIsActiveSpaceMember,
		accessRejected: Boolean(currentAccessRejection),
		readinessScope: {
			organizationId: input.organizationId,
			storageScope: input.ownerAccountId,
		},
		onWakeFinalOutcomeFactsRefresh: input.onWakeFinalOutcomeFactsRefresh,
		onThreadSignal: handleLiveThreadSignal,
		spaceId: input.spaceId,
		statusReady,
		statusRefetch: statusQuery.refetch,
		membersRefetch: membersQuery.refetch,
		initialAgentStreamPresences: bootstrapBelongsToProgressLifetime
			? (bootstrapQuery.data?.activeAgentStreamPresences ?? [])
			: [],
		initialAgentStreams: bootstrapBelongsToProgressLifetime
			? (bootstrapQuery.data?.activeAgentStreams ?? [])
			: [],
		unreadTargets: input.unreadTargets,
		history: {
			isPending: historyPending,
			isSuccess: historyReady,
			isError: historyQuery.isError,
			...(historySnapshot ? { data: historySnapshot } : {}),
		},
	});
	const currentWakeProgressItems = useMemo(
		() =>
			mergeActiveWakeProgressPresentation({
				detailedItems: wakeProgressItems,
				summaryItems: readConfirmedWakeProgressItems({
					presentation: wakeProgressPresentationQuery.data,
					spaceSummary: activeWakeProgressSummaryQuery.data,
					ownSummary: ownActiveWakeProgressQuery.data,
					spaceSummaryFetchedAfterMount:
						activeWakeProgressSummaryQuery.isFetchedAfterMount,
					ownSummaryFetchedAfterMount:
						ownActiveWakeProgressQuery.isFetchedAfterMount,
					signals: [],
				}),
				signals: [],
			}),
		[
			wakeProgressItems,
			wakeProgressPresentationQuery.data,
			activeWakeProgressSummaryQuery.data,
			activeWakeProgressSummaryQuery.isFetchedAfterMount,
			ownActiveWakeProgressQuery.data,
			ownActiveWakeProgressQuery.isFetchedAfterMount,
		]
	);
	const agentStreamProjections = useMemo(
		() =>
			projectAgentStreamReplyPlacements(
				liveAgentStreamProjections,
				currentWakeProgressItems
			).filter(
				(stream) =>
					!hasSpaceWakeProgressOutcome({
						presentation: wakeProgressPresentationQuery.data,
						item: {
							dispatchId: stream.dispatchId,
							targetProfileId: stream.profileId,
							sourceSignalId: stream.triggerMessageId,
							clientMessageId: null,
							terminal: stream.status !== "streaming",
						},
					})
			),
		[
			liveAgentStreamProjections,
			currentWakeProgressItems,
			wakeProgressPresentationQuery.data,
		]
	);
	const historyNavigation = useSpaceHistoryNavigation({
		liveEnvelopes: timelineEnvelopes,
		spaceId: input.spaceId,
		profileId: input.profileId,
		enabled: statusReady,
		accessRejected: Boolean(currentAccessRejection),
	});
	const unreadState = useSpaceUnread({
		identity: [
			input.unreadBoundaryVersion,
			input.ownerAccountId,
			input.organizationId,
			input.spaceId,
			input.profileId,
		].join(":"),
		isReady: input.unreadStateReady === true,
		targets: input.unreadTargets ?? [],
		scopes: input.unreadScopes,
	});
	const composerSession = useSpaceComposerSession({
		authoring: {
			composerDraftMigrationScopes: input.composerDraftMigrationScopes,
			composerDraftScope: input.ownerAccountId.trim()
				? {
						kind: "space",
						ownerAccountId: input.ownerAccountId,
						profileId: input.profileId,
						spaceId: input.spaceId,
					}
				: null,
			openMeldProfileId: input.profileId,
			initialComposerDraft: input.initialComposerDraft,
			isMembersLoading: membersLoading,
			membersErrorMessage,
			spaceId: input.spaceId,
			snapshot: membersSnapshot,
		},
		files: {
			organizationSlug: input.orgSlug,
			profileId: input.profileId,
			spaceId: input.spaceId,
			restoreFromScopes: input.composerDraftMigrationScopes?.flatMap(
				(scope) => {
					if (scope.kind === "center_agent_pending") {
						return [centerAgentPendingAttachmentScope(scope)];
					}
					if (scope.kind === "space") {
						return [`${input.orgSlug}:${scope.profileId}:${scope.spaceId}`];
					}
					return [];
				}
			),
		},
	});
	const mentionAuthoring = composerSession.authoring;
	const composerFilesController = composerSession.files;
	const {
		blockedWakeProfileId: composerBlockedWakeProfileId,
		errorMessage: composerErrorMessage,
		setBlockedWakeProfileId: setComposerBlockedWakeProfileId,
		setErrorMessage: setComposerErrorMessage,
	} = composerSession.feedback;
	const { isSending: isSendingMessage } = composerSession.send;
	const consumedInitialPendingMessageIdRef = useRef<string | null>(null);
	const stagedInitialFileMessageIdRef = useRef<string | null>(null);
	const [preparedInitialFileMessageId, setPreparedInitialFileMessageId] =
		useState<string | null>(null);
	useEffect(() => {
		const pending = input.initialPendingMessage;
		if (
			!(
				pending?.files?.length &&
				statusReady &&
				currentProfileIsActiveSpaceMember
			) ||
			stagedInitialFileMessageIdRef.current === pending.clientMessageId
		) {
			return;
		}
		stagedInitialFileMessageIdRef.current = pending.clientMessageId;
		composerFilesController
			.addFiles(pending.files, pending.fileDrafts)
			.catch((error: unknown) => {
				console.error("Could not prepare the first chat attachments.", error);
				setComposerErrorMessage("Could not attach the files. Try again.");
			});
		// Staging the local selection is synchronous. The existing publication
		// pipeline owns upload waiting and retry; do not strand a queued bubble here.
		setPreparedInitialFileMessageId(pending.clientMessageId);
	}, [
		input.initialPendingMessage,
		statusReady,
		currentProfileIsActiveSpaceMember,
		composerFilesController.addFiles,
		setComposerErrorMessage,
	]);
	const sendInitialPendingMessage = useEffectEvent(
		async (pendingMessage: PendingSpaceMessage) => {
			input.onInitialPendingMessageConsumed?.();
			await sendMessage({
				pendingMessage,
				taskDraft: pendingMessage.taskDraft,
			});
		}
	);
	useEffect(() => {
		const pendingMessage = input.initialPendingMessage;
		const pendingFiles =
			resolvePendingSubmissionFiles(composerFilesController, pendingMessage) ??
			[];
		const canAttemptPendingMessage =
			statusReady &&
			(!pendingMessage?.files?.length ||
				(preparedInitialFileMessageId === pendingMessage.clientMessageId &&
					pendingFiles.length === pendingMessage.files.length)) &&
			currentProfileIsActiveSpaceMember &&
			(membersReady || membersError) &&
			!isSendingMessage;
		if (
			!(pendingMessage && canAttemptPendingMessage) ||
			consumedInitialPendingMessageIdRef.current ===
				pendingMessage.clientMessageId
		) {
			return;
		}

		consumedInitialPendingMessageIdRef.current = pendingMessage.clientMessageId;
		sendInitialPendingMessage(pendingMessage).catch((error: unknown) => {
			console.error(
				"Failed to hand the queued Center Agent message to the Space composer.",
				error
			);
		});
	}, [
		input.initialPendingMessage,
		preparedInitialFileMessageId,
		composerFilesController,
		currentProfileIsActiveSpaceMember,
		isSendingMessage,
		membersError,
		membersReady,
		statusReady,
	]);
	const mergeConversationWakeProgressItems = useCallback(
		(incomingItems: readonly WakeProgressItem[]) => {
			recordSpaceWakeProgressEvidence({
				queryClient,
				spaceId: input.spaceId,
				openMeldProfileId: input.profileId,
				items: incomingItems,
			});
			if (incomingItems.length === 0) {
				return;
			}
			setWakeProgressItems((currentItems) =>
				mergeWakeProgressItemState({
					currentItems,
					incomingItems,
					signals: timelineEnvelopes,
				})
			);
		},
		[
			setWakeProgressItems,
			timelineEnvelopes,
			queryClient,
			input.spaceId,
			input.profileId,
		]
	);
	const mergeRecoveredWakeProgressItems = useEffectEvent(
		(incomingItems: readonly WakeProgressItem[]) => {
			recordSpaceWakeProgressEvidence({
				queryClient,
				spaceId: input.spaceId,
				openMeldProfileId: input.profileId,
				items: incomingItems,
			});
			const visibleItems = filterVisibleWakeProgressItems({
				items: incomingItems,
			});
			if (visibleItems.length === 0) {
				return;
			}
			for (const item of visibleItems) {
				if (item.clientMessageId) {
					recoveredWakeProgressClientMessageIdsRef.current.add(
						item.clientMessageId
					);
				}
			}
			mergeConversationWakeProgressItems(visibleItems);
		}
	);
	const reconcileRecoveredActiveWakeProgressSnapshot = useEffectEvent(
		(
			incomingItems: readonly WakeProgressItem[],
			snapshotItemsAtRequestStart: readonly WakeProgressItem[]
		) => {
			recordSpaceWakeProgressEvidence({
				queryClient,
				spaceId: input.spaceId,
				openMeldProfileId: input.profileId,
				items: incomingItems,
			});
			setWakeProgressItems((currentItems) =>
				reconcileActiveWakeProgressSnapshot({
					currentItems,
					incomingItems: filterVisibleWakeProgressItems({
						items: incomingItems,
					}),
					signals: timelineEnvelopes,
					snapshotItemsAtRequestStart,
				})
			);
		}
	);
	const readCurrentWakeProgressItems = useEffectEvent(() => wakeProgressItems);
	const removeConversationWakeProgressItemsForClientMessageId = useCallback(
		(clientMessageId: string) => {
			setWakeProgressItems((currentItems) =>
				removeWakeProgressItemsForClientMessageId({
					clientMessageId,
					items: currentItems,
				})
			);
		},
		[setWakeProgressItems]
	);
	const threadController = useSpaceThreadController({
		inputQueue,
		centerAgentProfileId: input.centerAgentProfileId,
		queueProgressItems: currentWakeProgressItems,
		entryConfirmed,
		initialFocusRequestId: input.initialFocusRequestId,
		isMembersLoading: membersLoading,
		membersErrorMessage,
		membersRefetch: membersQuery.refetch,
		membersSnapshot,
		initialThreads: bootstrapQuery.data?.threads ?? null,
		displayHistory: historySnapshot,
		onWakeProgressItems: mergeConversationWakeProgressItems,
		onWakeProgressRemoveClientMessageId:
			removeConversationWakeProgressItemsForClientMessageId,
		readCurrentMembers: readCurrentMembersForWakeAdmission,
		organizationSlug: input.orgSlug,
		ownerAccountId: input.ownerAccountId,
		profileId: input.profileId,
		queryClient,
		spaceId: input.spaceId,
		status: statusSnapshot,
		threadsEnabled: false,
		initialFocusSignalId: input.initialFocusSignalId,
		initialFocusThreadRootSignalId: input.initialFocusThreadRootSignalId,
		threadsLoading:
			bootstrapQuery.isFetching ||
			(bootstrapQuery.isPending && bootstrapQuery.data === undefined),
		statusReady,
		statusRefetch: statusQuery.refetch,
	});
	const [threadUnreadFocus, setThreadUnreadFocus] = useState<{
		requestId: number;
		rootSignalId: string;
		signalId: string;
		spaceId: string;
	} | null>(null);
	useEffect(() => {
		const knownRoots = new Set(
			threadController.threads.map((thread) => thread.rootSignalId)
		);
		if (
			!(
				statusReady &&
				agentStreamProjections.some(
					(stream) =>
						stream.status === "streaming" &&
						stream.replyThreadRootSignalId &&
						!knownRoots.has(stream.replyThreadRootSignalId)
				)
			)
		) {
			return;
		}
		queryClient
			.fetchQuery({
				...spaceThreadsQueryOptions({
					spaceId: input.spaceId,
					openMeldProfileId: input.profileId,
					enabled: true,
				}),
				staleTime: 0,
			})
			.catch((error) =>
				console.error("Could not load the reply Thread.", error)
			);
	}, [
		statusReady,
		threadController.threads,
		agentStreamProjections,
		queryClient,
		input.spaceId,
		input.profileId,
	]);
	const closeThread = useCallback(() => {
		setThreadUnreadFocus(null);
		threadController.onCloseThread();
	}, [threadController.onCloseThread]);
	const openThread = useCallback(
		(threadId: string) => {
			setThreadUnreadFocus(null);
			threadController.onOpenThread(threadId);
		},
		[threadController.onOpenThread]
	);
	const openUnreadThread = useCallback(
		async (target: {
			rootSignalId: string;
			signalId: string;
			threadId?: string;
		}) => {
			setThreadUnreadFocus((current) => ({
				requestId: (current?.requestId ?? 0) + 1,
				rootSignalId: target.rootSignalId,
				signalId: target.signalId,
				spaceId: input.spaceId,
			}));
			const opened = await threadController.onOpenUnreadThread({
				rootSignalId: target.rootSignalId,
				...(target.threadId ? { threadId: target.threadId } : {}),
			});
			if (!opened) {
				return false;
			}
			return true;
		},
		[input.spaceId, threadController.onOpenUnreadThread]
	);
	useEffect(() => {
		if (input.spaceId.trim().length === 0) {
			return;
		}

		setPassword("");
		setPasswordErrorMessage(null);
		setIsSubmittingPassword(false);
		composerSession.feedback.clear();
		composerSession.send.finish();
		setHasEarlierHistory(true);
		setHistoryActionErrorMessage(null);
		setIsLoadingEarlierHistory(false);
		setIsLeavingSpace(false);
		setLeaveSpaceErrorMessage(null);
		setPendingDiagnosticReportSignalIds(new Set());
		setSentDiagnosticReportSignalIds(new Set());
		recoveredWakeProgressClientMessageIdsRef.current.clear();
	}, [
		composerSession.feedback.clear,
		composerSession.send.finish,
		input.spaceId,
	]);

	useEffect(() => {
		if (!statusReady) {
			return;
		}

		let cancelled = false;
		const snapshotItemsAtRequestStart = readCurrentWakeProgressItems();
		createUnscopedWebSpaceApi({ openMeldProfileId: input.profileId })
			.getActiveWakeProgress({
				includePreviewText: true,
				includeSourceContext: true,
				includeTiming: true,
				includeWaitReason: true,
				includeDeviceWait: true,
				includeWakeStopEligibility: true,
				spaceId: input.spaceId,
				timeoutMs: SPACE_WAKE_PROGRESS_TIMEOUT_MS,
			})
			.then((response) => {
				if (cancelled) {
					return;
				}
				reconcileRecoveredActiveWakeProgressSnapshot(
					response.items,
					snapshotItemsAtRequestStart
				);
			})
			.catch((error) => {
				console.warn("[openmeld.web.space.active_wake_progress_unhandled]", {
					error: error instanceof Error ? error.message : String(error),
					spaceId: input.spaceId,
				});
			});

		return () => {
			cancelled = true;
		};
	}, [input.profileId, input.spaceId, statusReady]);

	useEffect(() => {
		if (!statusReady) {
			return;
		}

		const clientMessageIds = listRecoverableWakeProgressClientMessageIds({
			alreadyRequestedClientMessageIds:
				recoveredWakeProgressClientMessageIdsRef.current,
			signals: timelineEnvelopes,
		});
		if (clientMessageIds.length === 0) {
			return;
		}

		for (const clientMessageId of clientMessageIds) {
			recoveredWakeProgressClientMessageIdsRef.current.add(clientMessageId);
		}

		let cancelled = false;
		const abort = new AbortController();
		const completed = new Set<string>();
		pollWakeProgress({
			signal: abort.signal,
			openMeldProfileId: input.profileId,
			clientMessageIds,
			onItems: (items, fulfilledClientMessageIds) => {
				for (const id of fulfilledClientMessageIds) {
					completed.add(id);
				}
				if (cancelled || items.length === 0) {
					return;
				}
				mergeRecoveredWakeProgressItems(items);
			},
			onSettled: () => {
				if (cancelled) {
					return;
				}
				for (const id of clientMessageIds) {
					if (!completed.has(id)) {
						recoveredWakeProgressClientMessageIdsRef.current.delete(id);
					}
				}
			},
			spaceId: input.spaceId,
		}).catch((error) => {
			console.warn("[openmeld.web.space.wake_progress_recovery_unhandled]", {
				error: error instanceof Error ? error.message : String(error),
				spaceId: input.spaceId,
			});
		});

		return () => {
			cancelled = true;
			abort.abort();
			for (const id of clientMessageIds) {
				if (!completed.has(id)) {
					recoveredWakeProgressClientMessageIdsRef.current.delete(id);
				}
			}
		};
	}, [input.profileId, input.spaceId, statusReady, timelineEnvelopes]);

	// A durable reply resolves its Wake regardless of which conversation owns it.
	const wakeOutcomeSignals = useMemo(
		() => [
			...timelineEnvelopes,
			...threadController.threadSignals,
			...threadController.threadPreviews.flatMap((preview) => preview.signals),
		],
		[
			timelineEnvelopes,
			threadController.threadSignals,
			threadController.threadPreviews,
		]
	);
	const confirmedWakeProgressItems = useMemo(
		() =>
			readConfirmedWakeProgressItems({
				presentation: wakeProgressPresentationQuery.data,
				spaceSummary: activeWakeProgressSummaryQuery.data,
				ownSummary: ownActiveWakeProgressQuery.data,
				spaceSummaryFetchedAfterMount:
					activeWakeProgressSummaryQuery.isFetchedAfterMount,
				ownSummaryFetchedAfterMount:
					ownActiveWakeProgressQuery.isFetchedAfterMount,
				signals: wakeOutcomeSignals,
			}),
		[
			activeWakeProgressSummaryQuery.data,
			activeWakeProgressSummaryQuery.isFetchedAfterMount,
			ownActiveWakeProgressQuery.data,
			ownActiveWakeProgressQuery.isFetchedAfterMount,
			wakeProgressPresentationQuery.data,
			wakeOutcomeSignals,
		]
	);
	const heldAgentAccessWakeKeys = useHeldAgentAccessWakeKeys(input.spaceId);
	const composerAgentRequestMentions = useSpaceAgentRequestMentions({
		onSelect: mentionAuthoring.onAgentRequestMention,
		snapshot: membersSnapshot,
		status: statusSnapshot,
	});
	const requestAgentForSpace = useRequestAgentForSpace();
	const presentedWakeProgressItems = useMemo(
		() =>
			withoutHeldAgentAccessWakeProgress(
				presentAnsweredAgentInteractions(
					readPresentedWakeProgressItems({
						presentation: wakeProgressPresentationQuery.data,
						confirmedItems: confirmedWakeProgressItems,
						currentItems: wakeProgressItems,
						restoredItems: restoredWakeProgressItems,
						signals: wakeOutcomeSignals,
					}),
					answeredAgentInteractionKeys
				),
				heldAgentAccessWakeKeys
			),
		[
			answeredAgentInteractionKeys,
			heldAgentAccessWakeKeys,
			confirmedWakeProgressItems,
			wakeProgressPresentationQuery.data,
			wakeOutcomeSignals,
			wakeProgressItems,
			restoredWakeProgressItems,
		]
	);
	useWakeProgressPresentationInvariant({
		spaceId: input.spaceId,
		confirmedItems: confirmedWakeProgressItems,
		presentedItems: presentedWakeProgressItems,
		restoredItems: restoredWakeProgressItems,
		historicalSignals: wakeOutcomeSignals,
		presentationCreatedAtMs: wakeProgressPresentationQuery.data.createdAtMs,
		cachedSpaceSummaryItems: activeWakeProgressSummaryQuery.data?.items,
		cachedOwnSummaryItems: ownActiveWakeProgressQuery.data?.items,
		streamProjections: agentStreamProjections,
		spaceSummaryFetchedAfterMount:
			activeWakeProgressSummaryQuery.isFetchedAfterMount,
		ownSummaryFetchedAfterMount: ownActiveWakeProgressQuery.isFetchedAfterMount,
		bootstrapFetchedAfterMount: bootstrapQuery.isFetchedAfterMount,
	});
	usePublishSpaceWakeProgressVisibleProjection(presentedWakeProgressItems, {
		profileId: input.profileId,
		spaceId: input.spaceId,
	});

	useWakeProgressPolling({
		enabled: statusReady,
		items: presentedWakeProgressItems,
		logEventName: "[openmeld.web.space.wake_progress_poll_unhandled]",
		profileId: input.profileId,
		setItems: setWakeProgressItems,
		signals: wakeOutcomeSignals,
		spaceId: input.spaceId,
	});

	const handleReportMessage = useCallback(
		async (item: SpaceTimelineItem) => {
			if (
				pendingDiagnosticReportSignalIds.has(item.id) ||
				sentDiagnosticReportSignalIds.has(item.id)
			) {
				return;
			}

			setPendingDiagnosticReportSignalIds((current) =>
				addSetValue(current, item.id)
			);

			try {
				const report = await createUnscopedWebSpaceApi({
					openMeldProfileId: input.profileId,
				}).createDiagnosticReport({
					spaceId: input.spaceId,
					body: {
						reportedSignalId: item.id,
						problemType: resolveDiagnosticReportProblemType(item),
					},
				});
				recordDiagnosticReportPointer(report);
				setSentDiagnosticReportSignalIds((current) =>
					addSetValue(current, item.id)
				);
				toast.success("Report sent.");
			} catch (error) {
				const failure = toStructuredApiClientFailure(error);
				toast.error(`OpenMeld couldn't send this report. ${failure.message}`);
			} finally {
				setPendingDiagnosticReportSignalIds((current) =>
					removeSetValue(current, item.id)
				);
			}
		},
		[
			input.profileId,
			input.spaceId,
			pendingDiagnosticReportSignalIds,
			sentDiagnosticReportSignalIds,
		]
	);
	const handleWakeStopRequest = useCallback(
		async (
			target: SpaceWakeStopTargetResolution
		): Promise<PostSpaceWakeStopResponse> => {
			if (!(target.selector && target.selectorKey)) {
				throw new Error("This Wake is not stoppable from Web.");
			}

			const selector = target.selector;
			const selectorKey = target.selectorKey;
			setWakeStopRequestStatusBySelectorKey((current) => {
				const next = new Map(current);
				next.set(selectorKey, "cancellation_requested");
				return next;
			});

			let response: PostSpaceWakeStopResponse;
			try {
				response = await postWebSpaceWakeStop({
					openMeldProfileId: input.profileId,
					body: {
						reason: "Stopped from OpenMeld Web.",
						target: selector,
					},
					spaceId: input.spaceId,
				});
			} catch (error) {
				setWakeStopRequestStatusBySelectorKey((current) => {
					const next = new Map(current);
					next.set(selectorKey, "delivery_unknown");
					return next;
				});
				const failure = toStructuredApiClientFailure(error);
				toast.error(
					`Stop is not confirmed. Check your connection and try again. ${failure.message}`
				);
				throw failure;
			}

			setWakeStopRequestStatusBySelectorKey((current) => {
				const next = new Map(current);
				next.set(selectorKey, response.status);
				return next;
			});
			refreshWakeStopAfterResponse({
				openMeldProfileId: input.profileId,
				clientMessageId: target.clientMessageId,
				queryClient,
				sourceSignalId: target.sourceSignalId,
				spaceId: input.spaceId,
				targetProfileId: target.targetProfileId,
				threadId: threadController.activeThread?.threadId ?? null,
				onProgressItems: mergeRecoveredWakeProgressItems,
			}).catch((error) => {
				console.warn("[openmeld.web.space.wake_stop_refresh_failed]", {
					error: error instanceof Error ? error.message : String(error),
					spaceId: input.spaceId,
					targetProfileId: target.targetProfileId,
				});
			});

			return response;
		},
		[
			input.profileId,
			input.spaceId,
			queryClient,
			threadController.activeThread?.threadId,
			setWakeStopRequestStatusBySelectorKey,
		]
	);
	const handleAgentInteractionResponse = useCallback(
		async (body: RespondToSpaceAgentInteractionBody): Promise<void> => {
			if (input.organizationId) {
				await queryClient.cancelQueries({
					queryKey: inboxQueryKeys.spaceSummary(input.organizationId),
				});
			}
			const rollback = input.organizationId
				? optimisticallyRespondToSpaceInteraction({
						organizationId: input.organizationId,
						spaceId: input.spaceId,
						queryClient,
					})
				: () => undefined;
			const answerKey = resolveAgentInteractionAnswerKey(body);
			setAnsweredAgentInteractionKeys((current) =>
				new Set(current).add(answerKey)
			);
			try {
				await sendWebSpaceAgentInteractionResponse({
					body,
					openMeldProfileId: input.profileId,
					spaceId: input.spaceId,
				});
			} catch (error) {
				rollback();
				setAnsweredAgentInteractionKeys((current) => {
					const next = new Set(current);
					next.delete(answerKey);
					return next;
				});
				throw error;
			} finally {
				if (input.organizationId) {
					queryClient.invalidateQueries({
						queryKey: inboxQueryKeys.organization(input.organizationId),
					});
				}
				activeWakeProgressSummaryQuery.refetch().catch((error) => {
					console.warn(
						"[openmeld.web.space.agent_interaction_refresh_failed]",
						{
							error: error instanceof Error ? error.message : String(error),
							interactionId: body.interactionId,
							spaceId: input.spaceId,
						}
					);
				});
			}
		},
		[
			activeWakeProgressSummaryQuery.refetch,
			input.profileId,
			input.spaceId,
			input.organizationId,
			queryClient,
		]
	);
	useReconcilePendingOutgoingSignals(
		pendingOutgoingSignals,
		historyNavigation.visibleLiveEnvelopes,
		setPendingOutgoingSignals
	);
	const timelinePresentationEnvelopes = useMemo(
		() =>
			mergePersistedAndPendingOutgoingSignals({
				persisted:
					historyNavigation.activeWindow?.envelopes ??
					historyNavigation.visibleLiveEnvelopes,
				pending: historyNavigation.activeWindow ? [] : pendingOutgoingSignals,
			}),
		[
			historyNavigation.visibleLiveEnvelopes,
			pendingOutgoingSignals,
			historyNavigation.activeWindow,
		]
	);
	const pendingFilePreviewUrlsById = useMemo(() => {
		const previewUrlsById = new Map<string, string>();
		for (const pendingSignal of pendingOutgoingSignals) {
			for (const [fileId, previewUrl] of pendingSignal.filePreviewUrlsById) {
				previewUrlsById.set(fileId, previewUrl);
			}
		}
		return previewUrlsById;
	}, [pendingOutgoingSignals]);
	const timelineItems = useMemo(
		() =>
			buildSpaceTimelineItems({
				agentStreams: historyNavigation.activeWindow
					? []
					: agentStreamProjections,
				agentStreamScope: { kind: "main" },
				envelopes: timelinePresentationEnvelopes,
				membersSnapshot: presentationMembersSnapshot,
				pendingFilePreviewUrlsById,
			}),
		[
			agentStreamProjections,
			presentationMembersSnapshot,
			pendingFilePreviewUrlsById,
			timelinePresentationEnvelopes,
			historyNavigation.activeWindow,
		]
	);
	const isAgentRecoveryPending = useCallback(
		(profileId: string) => pendingAgentRecoveryProfileId === profileId,
		[pendingAgentRecoveryProfileId]
	);
	const isDiagnosticReportPending = useCallback(
		(signalId: string) => pendingDiagnosticReportSignalIds.has(signalId),
		[pendingDiagnosticReportSignalIds]
	);
	const isDiagnosticReportSent = useCallback(
		(signalId: string) => sentDiagnosticReportSignalIds.has(signalId),
		[sentDiagnosticReportSignalIds]
	);

	const isPasswordRecovery = isProtectedSpaceFailure(currentAccessRejection);
	const sessionExpiredError = findSessionExpiredError([
		bootstrapError,
		statusQuery.error,
		membersError,
		historyError,
		threadController.threadsError,
		threadController.threadSignalsError,
	]);
	const isLoading = shouldShowSpaceLandingLoading({
		bootstrapPending: bootstrapQuery.isPending,
		currentStatusConfirmationPending,
		hasDisplayStatus: statusSnapshot !== null,
		hasPendingMessage: input.initialPendingMessage != null,
		membershipState: currentProfileMembershipState,
		membersError,
	});

	if (isPasswordRecovery) {
		return {
			inlineErrorMessage: passwordErrorMessage,
			isSubmitting: isSubmittingPassword,
			mode: "password",
			onPasswordChange: (value) => {
				setPasswordErrorMessage(null);
				setPassword(value);
			},
			onRefresh: async () => {
				await Promise.all([bootstrapQuery.refetch(), statusQuery.refetch()]);
			},
			onSubmit: async () => {
				setIsSubmittingPassword(true);
				setPasswordErrorMessage(null);

				try {
					const normalizedPassword = normalizeSpacePasswordText(password);
					await rememberProtectedSpaceAccess({
						data: {
							spaceId: input.spaceId,
							password: normalizedPassword,
						},
					});
					await Promise.all([bootstrapQuery.refetch(), statusQuery.refetch()]);
				} catch (error) {
					setPasswordErrorMessage(
						error instanceof Error
							? error.message
							: "OpenMeld couldn't store this space password right now. Try again."
					);
				} finally {
					setIsSubmittingPassword(false);
				}
			},
			password,
			spaceId: input.spaceId,
		};
	}

	if (sessionExpiredError) {
		return {
			error: toStructuredApiClientFailure(sessionExpiredError),
			mode: "failure",
			onRetry: async () => {
				await Promise.all([bootstrapQuery.refetch(), statusQuery.refetch()]);
			},
			spaceId: input.spaceId,
		};
	}

	const conversationPhase = resolveSpaceConversationPhase(
		isLoading,
		statusSnapshot
	);
	if (conversationPhase.mode === "failure") {
		return {
			error: landingError,
			mode: "failure",
			onRetry: async () => {
				await Promise.all([bootstrapQuery.refetch(), statusQuery.refetch()]);
			},
			spaceId: input.spaceId,
		};
	}

	const deleteActionVisibility = resolveSpaceDeleteActionVisibility({
		currentProfileId: input.profileId,
		deletedAt: statusSnapshot?.deletedAt,
		membersSnapshot,
		ownerUserIds: statusSnapshot?.ownerUserIds ?? [],
	});

	return {
		...conversationPhase,
		composerFileSession: composerFilesController,
		activeThread: threadController.activeThread,
		threadPanelOpen: threadController.threadPanelOpen,
		agentStreams: agentStreamProjections,
		composerAddressingTargets: resolveComposerAddressingTargets({
			addressingTargets: mentionAuthoring.addressingTargets,
			membersSnapshot,
			senderProfileId: input.profileId,
			status: statusSnapshot,
		}),
		composerAuthoredMentions: mentionAuthoring.authoredMentions,
		composerMentionPickerItems: mentionAuthoring.mentionPickerItems,
		composerAgentRequestMentions,
		composerMentionEmptyMessage: mentionAuthoring.mentionEmptyMessage,
		composerFiles: composerFilesController.files,
		composerFileLimitReached: composerFilesController.isAtLimit,
		composerFileCleanup: composerFilesController.cleanup,
		composerFileRestorationError: composerFilesController.restorationError,
		composerErrorMessage,
		composerBlockedWakeProfileId,
		composerHasAuthoredMentions: mentionAuthoring.hasAuthoredMentions,
		composerReplyToSignalId: mentionAuthoring.replyTo?.signalId ?? null,
		composerText: mentionAuthoring.composerText,
		...resolveNavigationPresentation(historyNavigation, {
			hasEarlierHistory,
			historyActionErrorMessage,
			isLoadingEarlierHistory,
		}),
		presentedWakeProgressItems,
		queuedInputItems: resolveSpaceQueuedInputItems({
			queue: inputQueue,
			accessConfirmed: statusReady,
			isActiveMember: currentProfileIsActiveSpaceMember,
		}),
		ownActiveWakesHaveMore:
			ownActiveWakeProgressQuery.data?.pageInfo?.hasMore === true,
		historyNavigation,
		historyError,
		historyIsPending: historyPending,
		accessModeErrorMessage,
		spaceNameErrorMessage,
		deleteSpaceErrorMessage,
		showDeleteSpaceAction: deleteActionVisibility.visible,
		isAccessModePending,
		isSpaceNamePending,
		isLeaveSpacePending: isLeavingSpace,
		isDeleteSpacePending: isDeletingSpace,
		isAgentRecoveryPending,
		isMembersLoading: membersLoading,
		isMembersRefreshing: membersQuery.isFetching && !membersQuery.isPending,
		isCurrentAccessConfirmed: statusReady,
		currentProfileMembershipState,
		isSendingMessage,
		isDiagnosticReportPending,
		isDiagnosticReportSent,
		leaveSpaceErrorMessage,
		liveState,
		onRetryLiveUpdates: retryLiveUpdates,
		membersError,
		membersSnapshot,
		presentationMembersSnapshot,
		onComposerEditorChange: composerSession.onEditorChange,
		onClearComposerReplyTo: mentionAuthoring.onClearReplyTo,
		onAddComposerFiles: composerFilesController.addFiles,
		onRemoveComposerFile: composerFilesController.removeFile,
		onRetryComposerFile: composerFilesController.retryFile,
		onRetryComposerFileCleanup: composerFilesController.retryCleanup,
		onRetryComposerFileRestoration: composerFilesController.retryRestoration,
		onConversationViewedUpdates: resolveConfirmedViewedUpdatesHandler({
			isCurrentAccessConfirmed: statusReady && unreadState.isReady,
			onViewedUpdates: input.onViewedUpdates,
		}),
		onCloseThread: closeThread,
		onCreateThread: threadController.onCreateThread,
		onDeleteSpace: handleDeleteSpace,
		onJumpToDate: handleJumpToDate,
		onLoadEarlierHistory: handleLoadEarlierHistory,
		onLeaveSpace: handleLeaveSpace,
		onMentionButtonClick: mentionAuthoring.onMentionButtonClick,
		onOpenThread: openThread,
		onOpenUnreadThread: openUnreadThread,
		onRefresh: async () => {
			await refreshLanding({
				historyRefetch: historyQuery.refetch,
				membersRefetch: membersQuery.refetch,
				statusRefetch: statusQuery.refetch,
			});
		},
		onRefreshMembers: async () => {
			await membersQuery.refetch();
		},
		onHardRefreshStatusAndMembers: async () => {
			await hardRefreshSpaceStatusAndMembers({
				profileId: input.profileId,
				queryClient,
				spaceId: input.spaceId,
			});
		},
		onRefreshStatusAndMembers: async () => {
			await refreshStatusAndMembersDedupeRef.current({
				membersRefetch: membersQuery.refetch,
				statusRefetch: statusQuery.refetch,
			});
		},
		onSetAccessMode: handleSetAccessMode,
		onUpdateSpaceName: handleUpdateSpaceName,
		onThreadComposerEditorChange: threadController.onThreadComposerEditorChange,
		onThreadMentionButtonClick: threadController.onThreadMentionButtonClick,
		onThreadSend: threadController.onThreadSend,
		onThreadSendText: threadController.onThreadSendText,
		onThreadComposeExpiredDeviceWait:
			threadController.onComposeExpiredDeviceWait,
		onComposeExpiredDeviceWait: (request) => {
			try {
				if (composerFilesController.files.length > 0 || isSendingMessage) {
					throw new Error(
						"Send or clear your current draft before starting this task again."
					);
				}
				mentionAuthoring.composeExpiredDeviceWait(request);
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: "Could not prepare a new task."
				);
			}
		},
		onAddThreadComposerFiles: threadController.onAddThreadComposerFiles,
		onRemoveThreadComposerFile: threadController.onRemoveThreadComposerFile,
		onRetryThreadComposerFile: threadController.onRetryThreadComposerFile,
		onRetryThreadComposerFileCleanup:
			threadController.onRetryThreadComposerFileCleanup,
		onRetryThreadComposerFileRestoration:
			threadController.onRetryThreadComposerFileRestoration,
		onReplyToMessage: (item: SpaceTimelineItem) => {
			mentionAuthoring.onReplyToSignal({
				signalId: item.id,
				wakeTargetProfileId:
					item.actorProfileKind === "agent" ? item.actorProfileId : null,
			});
		},
		onReportMessage: handleReportMessage,
		onRecoverExecution: handleRecoverExecution,
		onAgentInteractionResponse: handleAgentInteractionResponse,
		onWakeStopRequest: handleWakeStopRequest,
		onUpdateAgentProfileBinding: handleUpdateAgentProfileBinding,
		onSend: sendMessage,
		onSendText: sendTextMessage,
		profileId: input.profileId,
		spaceId: input.spaceId,
		threadComposerBlockedWakeProfileId:
			threadController.threadComposerBlockedWakeProfileId,
		threadComposerAddressingTargets:
			threadController.threadComposerAddressingTargets,
		threadComposerAuthoredMentions:
			threadController.threadComposerAuthoredMentions,
		threadComposerMentionPickerItems:
			threadController.threadComposerMentionPickerItems,
		threadComposerErrorMessage: threadController.threadComposerErrorMessage,
		threadComposerHasAuthoredMentions:
			threadController.threadComposerHasAuthoredMentions,
		threadComposerText: threadController.threadComposerText,
		threadComposerReplyToSignalId:
			threadController.threadComposerReplyToSignalId,
		onClearThreadComposerReplyTo: threadController.onClearThreadComposerReplyTo,
		onThreadReplyToMessage: threadController.onThreadReplyToMessage,
		threadComposerFiles: threadController.threadComposerFiles,
		threadComposerFileLimitReached:
			threadController.threadComposerFileLimitReached,
		threadComposerFileCleanup: threadController.threadComposerFileCleanup,
		threadComposerFileRestorationError:
			threadController.threadComposerFileRestorationError,
		threadFilePreviewUrlsById: threadController.threadFilePreviewUrlsById,
		threadEphemeralActivityItems: presentAnsweredAgentInteractions(
			filterSpaceWakeProgressItems({
				presentation: wakeProgressPresentationQuery.data,
				items: threadController.threadEphemeralActivityItems,
			}),
			answeredAgentInteractionKeys
		),
		threads: threadController.threads,
		threadPreviews: threadController.threadPreviews,
		threadSignals: threadController.threadSignals,
		threadWakeRecommendationsEnabled:
			threadController.threadWakeRecommendationsEnabled,
		threadsErrorMessage: threadController.threadsErrorMessage,
		threadSignalsErrorMessage: threadController.threadSignalsErrorMessage,
		threadsIsLoading: threadController.threadsIsLoading,
		threadSignalsIsLoading: threadController.threadSignalsIsLoading,
		threadUnreadFocus:
			threadUnreadFocus?.spaceId === input.spaceId
				? {
						requestId: threadUnreadFocus.requestId,
						rootSignalId: threadUnreadFocus.rootSignalId,
						signalId: threadUnreadFocus.signalId,
					}
				: null,
		isCreatingThread: threadController.isCreatingThread,
		isSendingThreadMessage: threadController.isSendingThreadMessage,
		threadTextareaRef: threadController.threadTextareaRef,
		textareaRef: mentionAuthoring.textareaRef,
		timelineItems,
		firstUnreadSignalId: unreadState.firstSignalId,
		unreadCount: input.unreadTotalCount,
		unreadStateReady: unreadState.isReady,
		wakeStopRequestStatusBySelectorKey,
	};

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: send orchestration preserves ordered local staging, admission, publication, and recovery.
	async function sendMessage(options?: {
		contextSelection?: SpaceComposerSendOptions["contextSelection"];
		contextSelections?: SpaceComposerSendOptions["contextSelections"];
		taskDraft?: SpaceComposerSendOptions["taskDraft"];
		deviceWait?: SpaceComposerSendOptions["deviceWait"];
		onMessageStaged?: SpaceComposerSendOptions["onMessageStaged"];
		pendingMessage?: PendingSpaceMessage;
		retrySubmission?: PendingComposerSubmission;
		retryFiles?: readonly SpaceComposerFile[];
		throwOnFailure?: boolean;
	}) {
		if (!composerSession.send.begin()) {
			return;
		}
		let localAdmissionReleased = false;
		const releaseLocalAdmission = () => {
			if (localAdmissionReleased) {
				return;
			}
			localAdmissionReleased = true;
			composerSession.send.finish();
		};
		let pendingFiles = resolvePendingSubmissionFiles(
			composerFilesController,
			options?.pendingMessage
		);
		const sendAttempt = prepareSpaceMessageSendAttempt({
			composerFiles:
				options?.retryFiles ?? pendingFiles ?? composerFilesController.files,
			composerText:
				mentionAuthoring.composerText || options?.taskDraft?.title || "",
			pendingMessage: options?.pendingMessage,
		});
		if (sendAttempt.status !== "ready" && !options?.retrySubmission) {
			setComposerErrorMessage(sendAttempt.errorMessage);
			releaseLocalAdmission();
			throwSpaceSendFailureWhenRequested({
				error: new Error(
					sendAttempt.errorMessage ??
						"Wait for files to finish uploading before continuing."
				),
				postedMessage: false,
				throwOnFailure: options?.throwOnFailure === true,
			});
			return;
		}
		const messageSeed = createSpaceMessageSendSeed({
			composerText:
				mentionAuthoring.composerText || options?.taskDraft?.title || "",
			pendingMessage: options?.pendingMessage,
		});

		historyNavigation.latest();
		const request = composerSession.send.reserveRequest();

		let postedMessage = false;
		let publishedLocalIds: readonly string[] = [];
		let pendingSubmission: PendingComposerSubmission | null = null;
		let submissionClaimed = options?.retrySubmission !== undefined;
		let submittedFiles: readonly SpaceComposerFile[] =
			options?.retryFiles ?? pendingFiles ?? composerFilesController.files;
		try {
			const missingMembersMessage =
				resolveMissingSpaceMembersMessage(membersErrorMessage);
			const preparedSubmission: PendingComposerSubmission =
				options?.retrySubmission ?? {
					contextSelection: options?.contextSelection,
					contextSelections: options?.contextSelections,
					taskDraft: options?.taskDraft,
					...applyDeviceWaitToSubmission(
						prepareMainComposerSubmission({
							mentionAuthoring,
							messageSeed,
							missingMembersMessage,
							pendingMessage: options?.pendingMessage,
						}),
						options?.deviceWait
					),
				};
			if (options?.taskDraft && !preparedSubmission.text.trim()) {
				preparedSubmission.text = options.taskDraft.title;
			}
			pendingSubmission = preparedSubmission;
			const queueTarget = resolveQueuedExecutionInput({
				profileId: input.profileId,
				timelineItems,
				centerAgentProfileId: input.centerAgentProfileId,
				replyToSignalId: preparedSubmission.messageEnvelope?.replyToSignalId,
				members: membersSnapshot,
				activationTargets:
					preparedSubmission.messageEnvelope?.activationTargets ?? [],
				hasFiles:
					(options?.retryFiles ?? pendingFiles ?? composerFilesController.files)
						.length > 0,
				items: presentedWakeProgressItems,
			});
			if (
				queueTarget &&
				!preparedSubmission.agentRequestProfileIds?.length &&
				!preparedSubmission.contextSelection &&
				!preparedSubmission.contextSelections &&
				!preparedSubmission.taskDraft &&
				!preparedSubmission.deviceWait
			) {
				try {
					if (queueTarget === "ambiguous") {
						throw new Error(
							"More than one task is active. Reply to your original request to choose which task to update."
						);
					}
					// The previous send owns source publication. Resolve its dispatch
					// only after that request settles, not from a delayed progress frame.
					await request.ready;
					await ensureEntryConfirmed();
					await inputQueue.enqueue({
						action: "enqueue",
						inputId: messageSeed.clientMessageId,
						target: queueTarget,
						text: preparedSubmission.text,
					});
					postedMessage = true;
					mentionAuthoring.recordPendingSubmission(messageSeed.createdAtMs);
					mentionAuthoring.recordSuccessfulSubmission(preparedSubmission);
					options?.onMessageStaged?.(messageSeed.clientMessageId);
					setComposerErrorMessage(null);
				} catch (error) {
					const failure = toStructuredApiClientFailure(error);
					let message =
						error instanceof Error
							? error.message
							: "Couldn't queue this message. Your draft is still here.";
					if (
						failure.code === "network.request_failed" ||
						failure.code === "network.timeout"
					) {
						message =
							"Couldn't queue this message. Check your connection and try again.";
					}
					setComposerErrorMessage(message);
				}
				return;
			}
			// Publish the cancellable request before attachment recovery can yield.
			stagePreparedSpaceMessage({
				composerFiles:
					options?.retryFiles ?? pendingFiles ?? composerFilesController.files,
				clientMessageId: messageSeed.clientMessageId,
				createdAtMs: messageSeed.createdAtMs,
				preparedSubmission,
				status: statusSnapshot,
			});
			options?.onMessageStaged?.(messageSeed.clientMessageId);
			if (!options?.retrySubmission) {
				await composerFilesController.waitForDiscovery();
				pendingFiles = resolvePendingSubmissionFiles(
					composerFilesController,
					options?.pendingMessage
				);
			}
			submittedFiles =
				options?.retryFiles ??
				composerSession.recordPendingSubmission({
					fileIds: pendingFiles?.map((file) => file.localId),
					submittedAtMs: messageSeed.createdAtMs,
				});
			submissionClaimed = true;
			markSpaceSendPending(messageSeed.clientMessageId, () => {
				composerFilesController.consumePublishedFiles(
					submittedFiles.map((file) => file.localId)
				);
				composerFilesController.finishSubmission(submittedFiles);
			});
			// Local feedback precedes every network admission or publication step.
			stagePreparedSpaceMessage({
				composerFiles: submittedFiles,
				clientMessageId: messageSeed.clientMessageId,
				createdAtMs: messageSeed.createdAtMs,
				preparedSubmission,
				status: statusSnapshot,
			});
			releaseLocalAdmission();
			await request.ready;
			const sendBoundary = await resolveSpaceComposerSendBoundary({
				ensureEntryConfirmed,
				readCurrentStatus: readCurrentSpaceComposerSendStatus,
			});
			if (sendBoundary.state !== "ready") {
				throw new SpaceComposerSendBoundaryError(sendBoundary);
			}
			const currentStatus = sendBoundary.status;
			await requireCurrentSpaceComposerWakeAdmission({
				deviceWait: preparedSubmission.deviceWait,
				agentProfileIds: resolveComposerWakeProgressTargetProfileIds({
					automaticWakeEnabled: statusSnapshot?.automaticWakeEnabled,
					explicitActivationTargets:
						preparedSubmission.messageEnvelope?.activationTargets ?? [],
					explicitReferenceTargets:
						preparedSubmission.messageEnvelope?.referenceTargets,
					membersSnapshot,
					senderProfileId: input.profileId,
					status: currentStatus,
				}),
				readCurrentMembers: readCurrentMembersForWakeAdmission,
			});
			const publishedFiles =
				await composerFilesController.publishReadyFiles(submittedFiles);
			publishedLocalIds = publishedFiles.publishedLocalIds;
			if (
				hasNoPublishedComposerContent({
					files: publishedFiles.messageFiles,
					text: messageSeed.text,
				})
			) {
				throw new Error(
					"None of the files could be sent. Add them again or enter a message."
				);
			}
			await sendPreparedSpaceMessage({
				files: publishedFiles.messageFiles,
				filePreviewUrlsById: publishedFiles.previewUrlsByFileId,
				clientMessageId: messageSeed.clientMessageId,
				createdAtMs: messageSeed.createdAtMs,
				preparedSubmission,
				status: currentStatus,
			});
			postedMessage = true;
			completeSpaceSend(messageSeed.clientMessageId);
			mentionAuthoring.recordSuccessfulSubmission(preparedSubmission);
			composerFilesController.consumePublishedFiles(publishedLocalIds);
			setComposerBlockedWakeProfileId(null);
			Promise.all([membersQuery.refetch(), statusQuery.refetch()]).catch(
				(error) => {
					console.error(
						"A sent message's projections could not be refreshed.",
						error
					);
				}
			);
		} catch (error) {
			if (!submissionClaimed) {
				removeRejectedWakeProgress(messageSeed.clientMessageId);
				removePendingOutgoingSignal(
					setPendingOutgoingSignals,
					messageSeed.clientMessageId
				);
				pendingSubmission = null;
			}
			await handleSubmissionFailure(error);
		} finally {
			request.complete();
			if (postedMessage) {
				composerFilesController.finishSubmission(submittedFiles);
			}
			releaseLocalAdmission();
		}
		async function handleSubmissionFailure(error: unknown) {
			const sendError = unwrapPreparedSpaceMessageSendError(error);
			postedMessage ||= sendError.postedMessage;
			const { originalError } = sendError;
			if (pendingSubmission && !postedMessage) {
				const retrySubmission = pendingSubmission;
				removeRejectedWakeProgress(messageSeed.clientMessageId);
				markPendingOutgoingSignalFailed(
					setPendingOutgoingSignals,
					messageSeed.clientMessageId
				);
				setSpaceSendFailure(messageSeed.clientMessageId, {
					message: sendError.outcomeUnknown
						? "Delivery not confirmed."
						: toStructuredApiClientFailure(originalError).message,
					retry: () =>
						sendMessage({
							pendingMessage: messageSeed,
							retrySubmission,
							retryFiles: submittedFiles,
						}),
				});
			}
			if (pendingSubmission) {
				if (postedMessage) {
					console.error(
						"A space message was posted, but a follow-up step failed.",
						originalError
					);
				}
				await refreshStatusAfterProtectedComposerFailure({
					failure: toStructuredApiClientFailure(originalError),
					refetchStatus: statusQuery.refetch,
				});
				throwSpaceSendFailureWhenRequested({
					error: originalError,
					postedMessage,
					throwOnFailure: options?.throwOnFailure === true,
				});
				return;
			}
			if (originalError instanceof SpaceComposerSendBoundaryError) {
				settleSpaceComposerSendBoundaryFailure({
					boundary: originalError.boundary,
					setComposerErrorMessage,
					throwOnFailure: options?.throwOnFailure === true,
				});
				return;
			}
			const failure = toStructuredApiClientFailure(originalError);
			reportComposerSendFailure({
				failure,
				logMessage: "A space message was posted, but a follow-up step failed.",
				postedMessage,
				setComposerErrorMessage,
			});
			setComposerBlockedWakeProfileId(
				resolveBlockedWakeProfileIdFromSubmissionError(originalError)
			);

			await refreshStatusAfterProtectedComposerFailure({
				failure,
				refetchStatus: statusQuery.refetch,
			});
			throwSpaceSendFailureWhenRequested({
				error: originalError,
				postedMessage,
				throwOnFailure: options?.throwOnFailure === true,
			});
		}
	}

	function removeRejectedWakeProgress(clientMessageId: string) {
		setWakeProgressItems((items) =>
			removeWakeProgressItemsForClientMessageId({ clientMessageId, items })
		);
	}

	async function readCurrentSpaceComposerSendStatus(): Promise<GetSpaceStatusResponse> {
		const refreshedStatus = await statusQuery.refetch();
		if (refreshedStatus.error) {
			throw refreshedStatus.error;
		}
		if (!refreshedStatus.data) {
			throw new Error("The current Space status is unavailable.");
		}
		return refreshedStatus.data;
	}

	async function readCurrentMembersForWakeAdmission(): Promise<SpaceMembersSnapshot> {
		const currentMembersSnapshot = await readSpaceMembers({
			openMeldProfileId: input.profileId,
			spaceId: input.spaceId,
		});
		return currentMembersSnapshot;
	}

	async function sendTextMessage(text: string) {
		await sendMessage({
			pendingMessage: {
				clientMessageId: createClientMessageId(),
				createdAtMs: Date.now(),
				text,
			},
			throwOnFailure: true,
		});
	}

	function stagePreparedSpaceMessage(sendInput: {
		composerFiles?: readonly SpaceComposerFile[];
		files?: readonly SpaceMessageFileReference[];
		filePreviewUrlsById?: ReadonlyMap<string, string>;
		clientMessageId: string;
		createdAtMs: number;
		preparedSubmission: PreparedSpaceMessageSubmission;
		status: GetSpaceStatusResponse | null;
	}) {
		const explicitActivationTargets =
			sendInput.preparedSubmission.messageEnvelope?.activationTargets ?? [];
		const wakeProgressTargetProfileIds =
			resolveComposerWakeProgressTargetProfileIds({
				automaticWakeEnabled: sendInput.status?.automaticWakeEnabled,
				explicitActivationTargets,
				explicitReferenceTargets:
					sendInput.preparedSubmission.messageEnvelope?.referenceTargets,
				membersSnapshot,
				senderProfileId: input.profileId,
				status: sendInput.status,
			});
		// An automatic one-human/Agent Wake drives progress, but is not an authored
		// @Agent target and must not appear in the optimistic message body.
		const pendingMessageEnvelope =
			sendInput.preparedSubmission.messageEnvelope ?? null;
		const pendingOutgoingSignal = createPendingOutgoingSignal({
			composerFiles: sendInput.composerFiles,
			files: sendInput.files,
			filePreviewUrlsById: sendInput.filePreviewUrlsById,
			clientMessageId: sendInput.clientMessageId,
			createdAtMs: sendInput.createdAtMs,
			membersSnapshot,
			messageEnvelope: pendingMessageEnvelope,
			profileId: input.profileId,
			spaceId: input.spaceId,
			text: sendInput.preparedSubmission.text,
		});
		appendPendingOutgoingSignal(
			setPendingOutgoingSignals,
			pendingOutgoingSignal
		);
		const sendingWakeProgressItems = buildLocalWakeProgressItems({
			activationTargets: wakeProgressTargetProfileIds,
			clientMessageId: sendInput.clientMessageId,
			membersSnapshot,
			phase: "sending",
			sourceSignal: pendingOutgoingSignal.signal,
			updatedAtMs: sendInput.createdAtMs,
		});
		setWakeProgressItems((currentItems) =>
			mergeWakeProgressItemState({
				currentItems,
				incomingItems: sendingWakeProgressItems,
				signals: timelineEnvelopes,
			})
		);

		return {
			pendingMessageEnvelope,
			wakeProgressTargetProfileIds,
		};
	}

	function askOwnerForMentionedAgent(request: {
		agentProfileId: string;
		signalId: string;
	}): void {
		requestAgentForSpace
			.mutateAsync({ ...request, spaceId: input.spaceId })
			.catch((error: unknown) => {
				// Core keeps one request per message and Agent, so a retry is safe.
				toast.error(
					error instanceof Error
						? error.message
						: "Couldn't ask the Agent's owner.",
					{
						action: {
							label: "Try again",
							onClick: () => askOwnerForMentionedAgent(request),
						},
					}
				);
			});
	}

	async function sendPreparedSpaceMessage(sendInput: {
		files: readonly SpaceMessageFileReference[];
		filePreviewUrlsById: ReadonlyMap<string, string>;
		clientMessageId: string;
		createdAtMs: number;
		preparedSubmission: PreparedSpaceMessageSubmission;
		status: GetSpaceStatusResponse;
	}): Promise<void> {
		let postedMessage = false;
		try {
			const { wakeProgressTargetProfileIds } =
				stagePreparedSpaceMessage(sendInput);
			const spaceApi = createUnscopedWebSpaceApi({
				openMeldProfileId: input.profileId,
			});
			const postInput = buildNormalMessagePostInput({
				contextSelection: sendInput.preparedSubmission.contextSelection,
				contextSelections: sendInput.preparedSubmission.contextSelections,
				taskDraft: sendInput.preparedSubmission.taskDraft,
				deviceWait: sendInput.preparedSubmission.deviceWait,
				restoredFromSignalId: sendInput.preparedSubmission.restoredFromSignalId,
				files: sendInput.files,
				clientMessageId: sendInput.clientMessageId,
				messageEnvelope: sendInput.preparedSubmission.messageEnvelope,
				spaceId: input.spaceId,
				text: sendInput.preparedSubmission.text,
			});
			const signal = await runSpaceComposerIdempotentRequestWithRetry(
				async () => await spaceApi.postNormalMessage(postInput)
			);
			postedMessage = true;
			recordWakeDiagnosticIfNeeded({
				clientMessageId: sendInput.clientMessageId,
				sourceSignalId: signal.id,
				spaceId: input.spaceId,
				targetProfileIds: wakeProgressTargetProfileIds,
			});
			mergePersistedIncoming([signal]);
			updateAccountSpaceAcceptedMessage(queryClient, input.profileId, signal);
			removePendingOutgoingSignal(
				setPendingOutgoingSignals,
				sendInput.clientMessageId
			);
			const requestSentWakeProgressItems = buildLocalWakeProgressItems({
				activationTargets: wakeProgressTargetProfileIds,
				clientMessageId: sendInput.clientMessageId,
				membersSnapshot,
				phase: "request_sent",
				sourceSignal: signal,
				updatedAtMs: Math.max(signal.ts, Date.now()),
			});
			setWakeProgressItems((currentItems) =>
				mergeWakeProgressItemState({
					currentItems,
					incomingItems: requestSentWakeProgressItems,
					signals: timelineEnvelopes,
				})
			);
			if (wakeProgressTargetProfileIds.length > 0) {
				// A colleague's Agent may wait for its owner instead of working.
				invalidateAgentAccessQueries(queryClient);
			}
			for (const agentProfileId of sendInput.preparedSubmission
				.agentRequestProfileIds ?? []) {
				// The message is posted; asking the owner binds to it (§7).
				askOwnerForMentionedAgent({ agentProfileId, signalId: signal.id });
			}
		} catch (error) {
			const outcomeUnknown = isSpaceComposerSendOutcomeUnknown(
				toStructuredApiClientFailure(error)
			);
			if (!(postedMessage || outcomeUnknown)) {
				setWakeProgressItems((currentItems) =>
					removeWakeProgressItemsForClientMessageId({
						clientMessageId: sendInput.clientMessageId,
						items: currentItems,
					})
				);
			}
			throw new PreparedSpaceMessageSendError({
				clientMessageId: sendInput.clientMessageId,
				originalError: error,
				outcomeUnknown,
				postedMessage,
			});
		}
	}

	async function handleRecoverExecution(
		recoveryInput: SpaceExecutionRecoveryAttempt
	): Promise<SpaceExecutionRecoveryResolution> {
		const spaceApi = createUnscopedWebSpaceApi({
			openMeldProfileId: input.profileId,
		});
		try {
			const inspected = await spaceApi.inspectExecutionRecovery({
				dispatchId: recoveryInput.dispatchId,
				spaceId: input.spaceId,
			});
			const recovery = inspected.recovery;
			assertMatchingSpaceExecutionRecovery({
				recovery,
				recoveryInput,
				spaceId: input.spaceId,
			});
			const resolution = projectSpaceExecutionRecoveryResolution(recovery);
			const action = recoveryInput.action;
			const operationId = recoveryInput.operationId;
			if (operationId === null || action === null) {
				return resolution;
			}
			if (recovery.status !== "available") {
				return resolution;
			}
			const capability = resolveRequestedExecutionRecoveryCapability(
				recovery,
				action
			);
			if (recovery.recommendedAction !== action || !capability.enabled) {
				throw new Error(
					"The requested recovery action is no longer available."
				);
			}
			const result = await spaceApi.executeExecutionRecovery({
				body: {
					action,
					destination: recovery.destination,
					expectedIdentity: recovery.identity,
					operationId,
				},
				dispatchId: recoveryInput.dispatchId,
				spaceId: input.spaceId,
			});
			if (result.status === "outcome_unknown") {
				toast.warning(
					"OpenMeld could not confirm whether the recovery completed. It will not run the task again."
				);
				return projectSpaceExecutionRecoveryResolution(result.recovery);
			}
			if (
				result.status !== "completed" &&
				result.status !== "already_completed" &&
				result.status !== "new_execution_requested"
			) {
				throw new Error(`Recovery did not complete (${result.reasonCode}).`);
			}
			await Promise.all([
				historyQuery.refetch(),
				...(result.status === "new_execution_requested"
					? [membersQuery.refetch(), statusQuery.refetch()]
					: []),
			]);
			toast.success(
				resolveSpaceExecutionRecoverySuccessMessage({
					action,
					status: result.status,
				})
			);
			return projectSpaceExecutionRecoveryResolution(result.recovery);
		} catch (error) {
			const failure = toStructuredApiClientFailure(error);
			showSpaceExecutionRecoveryFailureToast({
				action: recoveryInput.action,
				message: failure.message,
			});
			if (isProtectedSpaceFailure(failure)) {
				await statusQuery.refetch();
			}
			throw error;
		}
	}

	async function handleUpdateAgentProfileBinding(bindingInput: {
		controllerEnabled: boolean;
		agentControllerRef: string;
		deviceId: string | null;
		profileId: string;
		profileName: string;
		runtimeLane: DaemonServiceLane | null;
	}) {
		setPendingAgentRecoveryProfileId(bindingInput.profileId);

		try {
			if (!input.organizationId) {
				throw new Error(
					"Workspace is unavailable. Refresh the page and try again."
				);
			}
			const bindingResult = await ensureWebAgentProfileRuntimeBinding({
				actorProfileId: input.profileId,
				agentProfileId: bindingInput.profileId,
				agentControllerRef: bindingInput.agentControllerRef,
				deviceId: bindingInput.deviceId,
				organizationId: input.organizationId,
				runtimeLane: bindingInput.runtimeLane,
				writeMode: "reconnect",
			});
			if (bindingResult.status !== "accepted") {
				throw new Error(
					formatWebAgentProfileRuntimeBindingFailure(bindingResult)
				);
			}
			await Promise.all([membersQuery.refetch(), statusQuery.refetch()]);
			toast.success(
				`Local agent connection saved for ${bindingInput.profileName}. OpenMeld is checking whether it can reply from this computer.`
			);
		} catch (error) {
			const failure = toStructuredApiClientFailure(error);
			toast.error(
				`OpenMeld could not update ${bindingInput.profileName}. ${failure.message}`
			);
		} finally {
			setPendingAgentRecoveryProfileId(null);
		}
	}

	async function handleLeaveSpace() {
		setIsLeavingSpace(true);
		setLeaveSpaceErrorMessage(null);
		let left = false;
		let cacheSnapshot:
			| Awaited<ReturnType<typeof optimisticallyRemoveSpaceFromListCaches>>
			| undefined;

		try {
			cacheSnapshot = await optimisticallyRemoveSpaceFromListCaches({
				organizationId: input.organizationId ?? null,
				queryClient,
				spaceId: input.spaceId,
			});
			await navigate({
				to: input.orgSlug
					? buildOrganizationSpacesPath(input.orgSlug)
					: "/invitations",
				replace: true,
			});
			const response = await createUnscopedWebSpaceApi({
				openMeldProfileId: input.profileId,
			}).leaveSpace({
				spaceId: input.spaceId,
			});
			left = true;
			clearSpaceFileMediaResources(queryClient, input.spaceId);
			const historyReason =
				response.status === "already_absent"
					? "leave_space_already_absent"
					: "left_space";

			try {
				await updateProfileSpaceHistoryStatus({
					data: {
						profileId: input.profileId,
						spaceId: input.spaceId,
						status: "removed",
						reason: historyReason,
					},
				});
			} catch (error) {
				toast.warning(
					error instanceof Error
						? `You left this space, but OpenMeld could not update your sidebar history. ${error.message}`
						: "You left this space, but OpenMeld could not update your sidebar history."
				);
			}

			await clearDepartedSpaceCaches({ ...input, queryClient });
			await queryClient.invalidateQueries({
				queryKey: accountSpaceQueryKeys.all,
			});
			toast.success(
				statusSnapshot?.deletedAt
					? "Space removed from your list."
					: "You left this Space."
			);
		} catch (error) {
			if (left) {
				toast.warning(
					"You left this Space, but its list could not be refreshed."
				);
				return;
			}
			const failure = toStructuredApiClientFailure(error);
			const message = resolveLeaveSpaceErrorMessage(failure);
			restoreSpaceListCaches(
				queryClient,
				input.organizationId ?? null,
				cacheSnapshot
			);
			setLeaveSpaceErrorMessage(message);
			toast.error(`Leave failed: ${message}`);
		} finally {
			cacheSnapshot?.stopKeepingRemoved();
			setIsLeavingSpace(false);
		}
	}

	async function handleSetAccessMode(nextAccess: {
		accessMode: SpaceAccessMode;
		allowGuests?: boolean;
		linkJoinPolicy?: SpaceLinkJoinPolicy;
		password?: string;
		visibility?: "public" | "private";
	}) {
		setIsAccessModePending(true);
		setAccessModeErrorMessage(null);

		try {
			await createUnscopedWebSpaceApi({
				openMeldProfileId: input.profileId,
			}).setAccessMode({
				spaceId: input.spaceId,
				accessMode: nextAccess.accessMode,
				...(nextAccess.allowGuests === undefined
					? {}
					: { allowGuests: nextAccess.allowGuests }),
				...(nextAccess.linkJoinPolicy === undefined
					? {}
					: { linkJoinPolicy: nextAccess.linkJoinPolicy }),
				...(nextAccess.password === undefined
					? {}
					: { password: nextAccess.password }),
				...(nextAccess.visibility === undefined
					? {}
					: { visibility: nextAccess.visibility }),
			});

			await Promise.all([
				statusQuery.refetch(),
				queryClient.invalidateQueries({
					queryKey: accountSpaceQueryKeys.all,
				}),
				nextAccess.visibility !== undefined && input.organizationId
					? queryClient.invalidateQueries({
							queryKey: organizationQueryKeys.spaces(input.organizationId),
						})
					: Promise.resolve(),
			]);
			toast.success("Space sharing updated.");
		} catch (error) {
			const failure = toStructuredApiClientFailure(error);
			setAccessModeErrorMessage(failure.message);
			throw error;
		} finally {
			setIsAccessModePending(false);
		}
	}

	async function handleUpdateSpaceName(name: string) {
		setIsSpaceNamePending(true);
		setSpaceNameErrorMessage(null);

		try {
			await persistSpaceNameUpdate({
				applyCanonicalName: (canonicalName) => {
					queryClient.setQueryData<GetSpaceStatusResponse>(
						spaceQueryKeys.status(input.spaceId, input.profileId),
						(current) =>
							current ? { ...current, name: canonicalName } : current
					);
				},
				onRefreshFailure: (error) => {
					console.warn("[openmeld.web.space.name_refresh_failed]", {
						error: toStructuredApiClientFailure(error).message,
						spaceId: input.spaceId,
					});
				},
				refreshProjections: async () => {
					await Promise.all([
						statusQuery.refetch(),
						queryClient.invalidateQueries({
							queryKey: accountSpaceQueryKeys.all,
						}),
					]);
				},
				updateMeta: async () =>
					await createUnscopedWebSpaceApi({
						openMeldProfileId: input.profileId,
					}).updateMeta({
						spaceId: input.spaceId,
						name,
					}),
			});
			toast.success("Space name updated.");
		} catch (error) {
			const failure = toStructuredApiClientFailure(error);
			setSpaceNameErrorMessage(failure.message);
		} finally {
			setIsSpaceNamePending(false);
		}
	}

	async function handleDeleteSpace() {
		setIsDeletingSpace(true);
		setDeleteSpaceErrorMessage(null);
		let deleted = false;
		let cacheSnapshot:
			| Awaited<ReturnType<typeof optimisticallyDeleteSpaceInListCaches>>
			| undefined;

		try {
			cacheSnapshot = await optimisticallyDeleteSpaceInListCaches({
				organizationId: input.organizationId ?? null,
				queryClient,
				spaceId: input.spaceId,
			});
			navigate({
				to: input.orgSlug
					? buildOrganizationSpacesPath(input.orgSlug)
					: "/invitations",
				replace: true,
			}).catch((error: unknown) =>
				console.error("Could not open Browse Spaces.", error)
			);
			await createUnscopedWebSpaceApi({
				openMeldProfileId: input.profileId,
			}).deleteSpace({
				spaceId: input.spaceId,
			});
			deleted = true;
			clearSpaceFileMediaResources(queryClient, input.spaceId);
			await applyConfirmedSpaceDeletionToCache({
				queryClient,
				spaceId: input.spaceId,
			});

			await Promise.all([
				input.organizationId
					? queryClient.invalidateQueries({
							queryKey: organizationQueryKeys.spaces(input.organizationId),
						})
					: Promise.resolve(),
				queryClient.invalidateQueries({
					queryKey: spaceQueryKeys.status(input.spaceId, input.profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: spaceQueryKeys.members(input.spaceId, input.profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: spaceQueryKeys.history(input.spaceId, input.profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: accountSpaceQueryKeys.all,
				}),
			]);
			toast.success("Space deleted.");
		} catch (error) {
			if (deleted) {
				toast.warning("Space deleted, but its lists could not be refreshed.");
				console.error("Could not refresh lists after Space deletion.", error);
				return;
			}
			const failure = toStructuredApiClientFailure(error);
			const message = resolveDeleteSpaceErrorMessage(failure);
			restoreSpaceListCaches(
				queryClient,
				input.organizationId ?? null,
				cacheSnapshot
			);
			setDeleteSpaceErrorMessage(message);
			toast.error(`Delete failed: ${message}`, {
				duration: Number.POSITIVE_INFINITY,
				closeButton: true,
				action: {
					label: "Open Space",
					onClick: () => {
						navigate({
							to: input.orgSlug
								? buildOrganizationSpacePath({
										orgSlug: input.orgSlug,
										spaceId: input.spaceId,
										search: { profileId: input.profileId },
									})
								: `/spaces/${input.spaceId}`,
						}).catch(console.error);
					},
				},
			});
		} finally {
			cacheSnapshot?.stopKeepingRemoved();
			setIsDeletingSpace(false);
		}
	}

	async function handleLoadEarlierHistory() {
		if (historyNavigation.activeWindow) {
			await historyNavigation.loadBefore();
			return;
		}
		if (historyNavigation.hasHiddenLiveHistory) {
			historyNavigation.revealCachedBefore();
			return;
		}
		const earliestVisibleSignalId =
			getEarliestVisibleTimelineSignalId(timelineEnvelopes);
		if (!earliestVisibleSignalId) {
			setHasEarlierHistory(false);
			return;
		}

		setHistoryActionErrorMessage(null);
		setIsLoadingEarlierHistory(true);

		try {
			const history = await readEarlierSpaceHistory({
				spaceId: input.spaceId,
				aroundSignalId: earliestVisibleSignalId,
				openMeldProfileId: input.profileId,
			});
			const merged = mergePersistedIncoming(history.envelopes);
			historyNavigation.revealCachedBefore(merged);
			const nextEarliestVisibleSignalId =
				getEarliestVisibleTimelineSignalId(merged);
			if (nextEarliestVisibleSignalId === earliestVisibleSignalId) {
				setHasEarlierHistory(false);
			}
		} catch (error) {
			const failure = toStructuredApiClientFailure(error);
			setHistoryActionErrorMessage(failure.message);
		} finally {
			setIsLoadingEarlierHistory(false);
		}
	}

	async function handleJumpToDate(date: Date): Promise<string | null> {
		const startAtMs = new Date(
			date.getFullYear(),
			date.getMonth(),
			date.getDate()
		).getTime();
		setHistoryActionErrorMessage(null);

		try {
			const history = await queryClient.fetchQuery(
				spaceHistoryDateWindowQueryOptions({
					spaceId: input.spaceId,
					startAtMs,
					openMeldProfileId: input.profileId,
				})
			);
			const anchor = getEarliestVisibleTimelineSignalId(history.envelopes);
			if (anchor) {
				await historyNavigation.open(anchor);
			}
			return anchor;
		} catch (error) {
			const failure = toStructuredApiClientFailure(error);
			setHistoryActionErrorMessage(failure.message);
			throw failure;
		}
	}
}

function useSpaceThreadController(input: {
	inputQueue: ReturnType<typeof useSpaceInputQueue>;
	centerAgentProfileId?: string | null;
	queueProgressItems: readonly WakeProgressItem[];
	entryConfirmed: boolean;
	initialFocusRequestId?: string;
	initialFocusSignalId?: string;
	initialFocusThreadRootSignalId?: string;
	displayHistory: SpaceHistorySnapshot | null;
	isMembersLoading: boolean;
	initialThreads: ListSpaceThreadsResponse | null;
	membersErrorMessage: string | null;
	membersRefetch: () => Promise<unknown>;
	membersSnapshot: SpaceMembersSnapshot | null;
	onWakeProgressItems: (items: readonly WakeProgressItem[]) => void;
	onWakeProgressRemoveClientMessageId: (clientMessageId: string) => void;
	readCurrentMembers: () => Promise<SpaceMembersSnapshot | null>;
	organizationSlug?: string;
	ownerAccountId: string;
	profileId: string;
	queryClient: ReturnType<typeof useQueryClient>;
	spaceId: string;
	status: GetSpaceStatusResponse | null;
	threadsEnabled: boolean;
	threadsLoading: boolean;
	statusReady: boolean;
	statusRefetch: () => Promise<unknown>;
}) {
	const [isCreatingThread, setIsCreatingThread] = useState(false);
	const threadCreationRequestRef = useRef(0);
	const [wakeProgressItems, setWakeProgressItems] = useState<
		WakeProgressItem[]
	>([]);
	const heldAgentAccessWakeKeys = useHeldAgentAccessWakeKeys(input.spaceId);
	const threadsQuery = useQuery(
		spaceThreadsQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
			enabled:
				input.entryConfirmed &&
				(input.threadsEnabled || hasInitialMessageTarget(input)),
		})
	);
	const currentThreads = threadsQuery.data ?? input.initialThreads;
	const threadsSnapshot =
		currentThreads ?? input.displayHistory?.threadDisplay ?? null;
	useLayoutEffect(() => {
		if (!(currentThreads && input.displayHistory)) {
			return;
		}
		input.queryClient.setQueryData<SpaceHistorySnapshot>(
			spaceQueryKeys.history(input.spaceId, input.profileId),
			(current) =>
				current
					? mergeSpaceHistorySnapshots({
							current,
							incoming: {
								...current,
								threadDisplay: currentThreads,
							},
						})
					: current
		);
	}, [
		currentThreads,
		input.displayHistory,
		input.queryClient,
		input.spaceId,
		input.profileId,
	]);
	const threads = useMemo(
		() => threadsSnapshot?.threads ?? [],
		[threadsSnapshot]
	);
	const threadPreviews = useMemo(
		() => threadsSnapshot?.previews ?? [],
		[threadsSnapshot]
	);
	const availableThreadIds = useMemo(
		() => new Set(threads.map((thread) => thread.threadId)),
		[threads]
	);
	const threadPanelSelection = useSpaceThreadPanelSelection({
		initialFocusRequestId: input.initialFocusRequestId,
		initialFocusSignalId: input.initialFocusSignalId,
		initialFocusThreadRootSignalId: input.initialFocusThreadRootSignalId,
		threadIdsByRootSignalId: new Map(
			threads.map((thread) => [thread.rootSignalId, thread.threadId])
		),
		availableThreadIds,
		availableThreadsReady: threadsQuery.isSuccess,
		profileId: input.profileId,
		spaceId: input.spaceId,
	});
	const activeThreadId = threadPanelSelection.activeThreadId;
	const [pendingOutgoingSignals, setPendingOutgoingSignals] =
		usePendingOutgoingSignals(
			input.spaceId,
			input.profileId,
			activeThreadId ?? "closed"
		);
	const threadSignalsQuery = useQuery(
		spaceThreadSignalsQueryOptions({
			spaceId: input.spaceId,
			threadId: activeThreadId,
			openMeldProfileId: input.profileId,
			enabled: input.entryConfirmed && activeThreadId !== null,
		})
	);
	const composerSession = useSpaceComposerSession({
		authoring: {
			composerDraftScope:
				input.ownerAccountId.trim() && activeThreadId
					? {
							kind: "space_thread",
							ownerAccountId: input.ownerAccountId,
							profileId: input.profileId,
							spaceId: input.spaceId,
							threadId: activeThreadId,
						}
					: null,
			openMeldProfileId: input.profileId,
			isMembersLoading: input.isMembersLoading,
			membersErrorMessage: input.membersErrorMessage,
			spaceId: input.spaceId,
			snapshot: input.membersSnapshot,
		},
		files: {
			organizationSlug: input.organizationSlug,
			profileId: input.profileId,
			spaceId: input.spaceId,
			draftScope: `thread:${activeThreadId ?? "closed"}`,
		},
	});
	const mentionAuthoring = composerSession.authoring;
	const composerFilesController = composerSession.files;
	const {
		blockedWakeProfileId: composerBlockedWakeProfileId,
		errorMessage: composerErrorMessage,
		setBlockedWakeProfileId: setComposerBlockedWakeProfileId,
		setErrorMessage: setComposerErrorMessage,
	} = composerSession.feedback;
	const { isSending: isSendingMessage, setIsSending: setIsSendingMessage } =
		composerSession.send;
	const activeThread =
		threads.find((thread) => thread.threadId === activeThreadId) ?? null;
	const persistedThreadSignals = useMemo(
		() => threadSignalsQuery.data?.signals ?? [],
		[threadSignalsQuery.data]
	);
	useReconcilePendingOutgoingSignals(
		pendingOutgoingSignals,
		persistedThreadSignals,
		setPendingOutgoingSignals
	);
	const threadSignals = useMemo(
		() =>
			mergePersistedAndPendingOutgoingSignals({
				persisted: persistedThreadSignals,
				pending: pendingOutgoingSignals,
			}),
		[persistedThreadSignals, pendingOutgoingSignals]
	);
	const threadFilePreviewUrlsById = useMemo(() => {
		const previewUrlsById = new Map<string, string>();
		for (const pendingSignal of pendingOutgoingSignals) {
			for (const [fileId, previewUrl] of pendingSignal.filePreviewUrlsById) {
				previewUrlsById.set(fileId, previewUrl);
			}
		}
		return previewUrlsById;
	}, [pendingOutgoingSignals]);
	const currentProfileId = input.profileId;
	const currentSpaceId = input.spaceId;

	useEffect(() => {
		if (
			currentProfileId.trim().length === 0 ||
			currentSpaceId.trim().length === 0
		) {
			return;
		}
		composerSession.feedback.clear();
		setIsCreatingThread(false);
		threadCreationRequestRef.current += 1;
		composerSession.send.finish();
		setWakeProgressItems([]);
	}, [
		composerSession.feedback.clear,
		composerSession.send.finish,
		currentProfileId,
		currentSpaceId,
	]);

	useWakeProgressPolling({
		enabled: input.statusReady,
		items: wakeProgressItems,
		logEventName: "openmeld.web.space.thread_wake_progress_poll_failed",
		profileId: input.profileId,
		setItems: setWakeProgressItems,
		signals: threadSignals,
		spaceId: input.spaceId,
	});

	return {
		activeThread,
		threadPanelOpen: threadPanelSelection.isOpen,
		isCreatingThread,
		isSendingThreadMessage: isSendingMessage,
		onCloseThread: closeThread,
		onCreateThread: createThread,
		onOpenUnreadThread: openUnreadThread,
		onOpenThread: openThread,
		onThreadComposerEditorChange: composerSession.onEditorChange,
		onThreadMentionButtonClick: mentionAuthoring.onMentionButtonClick,
		onThreadSend: sendMessage,
		onThreadSendText: sendTextMessage,
		onComposeExpiredDeviceWait: (request: {
			sourceSignalId: string;
			targetProfileId: string;
		}) => {
			try {
				if (composerFilesController.files.length > 0 || isSendingMessage) {
					throw new Error(
						"Send or clear your current draft before starting this task again."
					);
				}
				mentionAuthoring.composeExpiredDeviceWait(request);
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: "Could not prepare a new task."
				);
			}
		},
		onAddThreadComposerFiles: composerFilesController.addFiles,
		onRemoveThreadComposerFile: composerFilesController.removeFile,
		onRetryThreadComposerFile: composerFilesController.retryFile,
		onRetryThreadComposerFileCleanup: composerFilesController.retryCleanup,
		onRetryThreadComposerFileRestoration:
			composerFilesController.retryRestoration,
		threadComposerBlockedWakeProfileId: composerBlockedWakeProfileId,
		threadComposerAddressingTargets: resolveComposerAddressingTargets({
			isThreadMessage: true,
			addressingTargets: mentionAuthoring.addressingTargets,
			membersSnapshot: input.membersSnapshot,
			senderProfileId: input.profileId,
			status: input.status,
		}),
		threadComposerAuthoredMentions: mentionAuthoring.authoredMentions,
		threadComposerMentionPickerItems: mentionAuthoring.mentionPickerItems,
		threadComposerErrorMessage: composerErrorMessage,
		threadComposerHasAuthoredMentions: mentionAuthoring.hasAuthoredMentions,
		threadComposerText: mentionAuthoring.composerText,
		threadComposerReplyToSignalId: mentionAuthoring.replyTo?.signalId ?? null,
		onClearThreadComposerReplyTo: mentionAuthoring.onClearReplyTo,
		onThreadReplyToMessage: (item: SpaceTimelineItem) =>
			mentionAuthoring.onReplyToSignal({
				signalId: item.id,
				wakeTargetProfileId:
					item.actorProfileKind === "agent" ? item.actorProfileId : null,
			}),
		threadComposerFiles: composerFilesController.files,
		threadComposerFileLimitReached: composerFilesController.isAtLimit,
		threadComposerFileCleanup: composerFilesController.cleanup,
		threadComposerFileRestorationError:
			composerFilesController.restorationError,
		threadFilePreviewUrlsById,
		threadEphemeralActivityItems: withoutHeldAgentAccessWakeProgress(
			wakeProgressItems,
			heldAgentAccessWakeKeys
		),
		threadPreviews,
		threadSignals,
		threadSignalsError: threadSignalsQuery.error,
		threadWakeRecommendationsEnabled:
			threadSignalsQuery.data?.wakeContinuation?.automaticTargetProfileId ===
			null,
		threadSignalsErrorMessage: resolveThreadLoadError(),
		threadSignalsIsLoading: activeThread
			? threadSignalsQuery.isPending ||
				threadSignalsQuery.fetchStatus !== "idle"
			: isCreatingThread || input.threadsLoading || threadsQuery.isFetching,
		threadTextareaRef: mentionAuthoring.textareaRef,
		threads,
		threadsError: threadsQuery.error,
		threadsErrorMessage: threadsQuery.isError
			? threadsQuery.error.message
			: null,
		threadsIsLoading:
			threadsSnapshot === null &&
			(input.threadsLoading || threadsQuery.isPending),
	};

	function closeThread() {
		threadCreationRequestRef.current += 1;
		setIsCreatingThread(false);
		threadPanelSelection.close();
		composerSession.feedback.clear();
	}

	function resolveThreadLoadError(): string | null {
		if (activeThread) {
			return threadSignalsQuery.isError
				? threadSignalsQuery.error.message
				: null;
		}
		if (threadsQuery.isError) {
			return threadsQuery.error.message;
		}
		if (isCreatingThread) {
			return null;
		}
		if (threadPanelSelection.requestedRootSignalId && composerErrorMessage) {
			return composerErrorMessage;
		}
		if (
			threadPanelSelection.requestedRootSignalId &&
			!input.threadsLoading &&
			!threadsQuery.isFetching &&
			threadsSnapshot
		) {
			return "This linked thread isn’t available. It may have been removed or you may no longer have access.";
		}
		return null;
	}

	function openThread(threadId: string) {
		threadCreationRequestRef.current += 1;
		setIsCreatingThread(false);
		threadPanelSelection.open(threadId);
		composerSession.feedback.clear();
	}

	async function openUnreadThread(threadInput: {
		rootSignalId: string;
		threadId?: string;
	}): Promise<boolean> {
		threadCreationRequestRef.current += 1;
		setIsCreatingThread(false);
		composerSession.feedback.clear();
		threadPanelSelection.openRoot(threadInput.rootSignalId);
		let threadId = threadInput.threadId;
		if (!threadId) {
			threadId = threads.find(
				(thread) => thread.rootSignalId === threadInput.rootSignalId
			)?.threadId;
		}
		if (!threadId) {
			const refreshed = await threadsQuery.refetch();
			threadId = refreshed.data?.threads.find(
				(thread) => thread.rootSignalId === threadInput.rootSignalId
			)?.threadId;
		}
		if (!threadId) {
			return false;
		}

		return true;
	}

	async function createThread(threadInput: { rootSignalId: string }) {
		const requestId = ++threadCreationRequestRef.current;
		setIsCreatingThread(true);
		setComposerErrorMessage(null);
		threadPanelSelection.openRoot(threadInput.rootSignalId);

		try {
			const response = await createUnscopedWebSpaceApi({
				openMeldProfileId: input.profileId,
			}).createThread({
				spaceId: input.spaceId,
				rootSignalId: threadInput.rootSignalId,
				clientMutationId: createClientMessageId(),
			});
			input.queryClient.setQueryData<ListSpaceThreadsResponse>(
				spaceQueryKeys.threads(input.spaceId, input.profileId),
				(current) => ({
					threads: [
						...(current?.threads ?? threads).filter(
							(thread) => thread.threadId !== response.thread.threadId
						),
						response.thread,
					],
					previews: current?.previews ?? threadPreviews,
				})
			);
			await Promise.all([
				threadsQuery.refetch(),
				input.queryClient.invalidateQueries({
					queryKey: spaceQueryKeys.threadSignals(
						input.spaceId,
						response.thread.threadId,
						input.profileId
					),
				}),
			]);
		} catch (error) {
			const failure = toStructuredApiClientFailure(error);
			if (requestId === threadCreationRequestRef.current) {
				setComposerErrorMessage(failure.message);
			}
			toast.error(`OpenMeld could not start the thread. ${failure.message}`);
		} finally {
			if (requestId === threadCreationRequestRef.current) {
				setIsCreatingThread(false);
			}
		}
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: thread send orchestration preserves ordered staging, publication, and retry identity.
	async function sendMessage(
		options?: SpaceComposerSendOptions,
		retry?: {
			submission: PendingComposerSubmission;
			files: readonly SpaceComposerFile[];
			thread: SpaceThread;
			clientMessageId: string;
		}
	) {
		if (!(input.statusReady && composerSession.send.begin())) {
			return;
		}
		const thread = retry?.thread ?? activeThread;
		const trimmedText =
			retry?.submission.text ??
			(mentionAuthoring.composerText.trim() || options?.taskDraft?.title || "");
		const fileSubmission = buildComposerFileSubmission({
			files: retry?.files ?? composerFilesController.files,
			isPendingMessage: false,
		});
		const blockedReason = resolveThreadComposerBlockedReason({
			hasActiveThread: thread !== null,
			hasSendableFiles: fileSubmission.hasSendableFiles,
			text: trimmedText,
		});
		if ((blockedReason && !retry) || !thread) {
			setComposerErrorMessage(blockedReason);
			composerSession.send.finish();
			return;
		}
		const submittedThread = thread;

		const clientMessageId = retry?.clientMessageId ?? createClientMessageId();
		const submittedAtMs = Date.now();
		let posted = false;
		let submissionClaimed = retry !== undefined;
		let localAdmissionReleased = false;
		let pendingSubmission: PendingComposerSubmission | null = null;
		let publishedLocalIds: readonly string[] = [];
		let submittedFiles: readonly SpaceComposerFile[] = [];
		try {
			const preparedSubmission: PendingComposerSubmission =
				retry?.submission ?? {
					contextSelection: options?.contextSelection,
					contextSelections: options?.contextSelections,
					taskDraft: options?.taskDraft,
					...applyDeviceWaitToSubmission(
						mentionAuthoring.composerText.trim().length > 0
							? mentionAuthoring.prepareSubmission(
									resolveMissingSpaceMembersMessage(input.membersErrorMessage)
								)
							: mentionAuthoring.prepareFileOnlySubmission(),
						options?.deviceWait
					),
				};
			if (options?.taskDraft && !preparedSubmission.text.trim()) {
				preparedSubmission.text = options.taskDraft.title;
			}
			pendingSubmission = preparedSubmission;
			submittedFiles = retry?.files ?? composerFilesController.files;
			await sendPreparedThreadMessage({
				composerFiles: submittedFiles,
				clientMessageId,
				onMessageStaged: (stagedClientMessageId) => {
					options?.onMessageStaged?.(stagedClientMessageId);
				},
				claimFiles: async () => {
					if (!retry) {
						await composerFilesController.waitForDiscovery();
						submittedFiles = composerSession.recordPendingSubmission({
							submittedAtMs,
						});
					}
					submissionClaimed = true;
					composerSession.send.finish();
					localAdmissionReleased = true;
					markSpaceSendPending(clientMessageId, () => {
						composerFilesController.consumePublishedFiles(
							submittedFiles.map((file) => file.localId)
						);
						composerFilesController.finishSubmission(submittedFiles);
					});
				},
				prepareFiles: async () => {
					const publishedFiles =
						await composerFilesController.publishReadyFiles(submittedFiles);
					publishedLocalIds = publishedFiles.publishedLocalIds;
					if (
						trimmedText.length === 0 &&
						publishedFiles.messageFiles.length === 0
					) {
						throw new Error(
							"None of the files could be sent. Add them again or enter a reply."
						);
					}
					return publishedFiles;
				},
				onPosted: () => {
					posted = true;
					if (!submissionClaimed) {
						mentionAuthoring.recordPendingSubmission(submittedAtMs);
					}
					completeSpaceSend(clientMessageId);
					mentionAuthoring.recordSuccessfulSubmission(preparedSubmission);
					composerFilesController.consumePublishedFiles(publishedLocalIds);
					setComposerBlockedWakeProfileId(null);
				},
				preparedSubmission,
				thread,
			});
		} catch (error) {
			await handleSubmissionFailure(error);
		} finally {
			if (posted) {
				composerFilesController.finishSubmission(submittedFiles);
			}
			if (!localAdmissionReleased) {
				composerSession.send.finish();
			}
		}
		async function handleSubmissionFailure(error: unknown) {
			if (!submissionClaimed) {
				removePendingOutgoingSignal(setPendingOutgoingSignals, clientMessageId);
				completeSpaceSend(clientMessageId);
				pendingSubmission = null;
			}
			if (pendingSubmission && !posted) {
				const submission = pendingSubmission;
				markPendingOutgoingSignalFailed(
					setPendingOutgoingSignals,
					clientMessageId
				);
				const sendError = unwrapPreparedSpaceMessageSendError(error);
				setSpaceSendFailure(clientMessageId, {
					message: sendError.outcomeUnknown
						? "Delivery not confirmed."
						: toStructuredApiClientFailure(sendError.originalError).message,
					retry: () =>
						sendMessage(undefined, {
							submission,
							files: submittedFiles,
							thread: submittedThread,
							clientMessageId,
						}),
				});
			} else {
				await handleSendMessageFailure({
					error,
					pendingSubmission,
					publishedLocalIds,
				});
			}
		}
	}

	async function requireThreadWakeAdmission(
		preparedSubmission: PreparedSpaceMessageSubmission
	) {
		await requireCurrentSpaceComposerWakeAdmission({
			deviceWait: preparedSubmission.deviceWait,
			agentProfileIds: resolveComposerWakeProgressTargetProfileIds({
				automaticWakeEnabled: input.status?.automaticWakeEnabled,
				isThreadMessage: true,
				explicitActivationTargets:
					preparedSubmission.messageEnvelope?.activationTargets ?? [],
				explicitReferenceTargets:
					preparedSubmission.messageEnvelope?.referenceTargets,
				membersSnapshot: input.membersSnapshot,
				senderProfileId: input.profileId,
				status: input.status,
			}),
			readCurrentMembers: input.readCurrentMembers,
		});
	}

	async function handleSendMessageFailure(failureInput: {
		error: unknown;
		pendingSubmission: PendingComposerSubmission | null;
		publishedLocalIds: readonly string[];
	}) {
		const sendError =
			failureInput.error instanceof PreparedSpaceMessageSendError
				? failureInput.error
				: null;
		const originalError = sendError?.originalError ?? failureInput.error;
		const failure = toStructuredApiClientFailure(originalError);
		const postedMessage = sendError?.postedMessage ?? false;
		const outcomeUnknown =
			sendError?.outcomeUnknown ?? isSpaceComposerSendOutcomeUnknown(failure);
		consumePublishedComposerFilesAfterAcceptedOrUnknownSend({
			clientMessageId: sendError?.clientMessageId ?? null,
			consumePublishedFiles: composerFilesController.consumePublishedFiles,
			outcomeUnknown,
			postedMessage,
			publishedLocalIds: failureInput.publishedLocalIds,
			setPendingSignals: setPendingOutgoingSignals,
		});
		if (!(postedMessage || outcomeUnknown)) {
			const restoredPreviousSubmission = restoreFailedPendingSubmission({
				mentionAuthoring,
				pendingSubmission: failureInput.pendingSubmission,
			});
			if (sendError && restoredPreviousSubmission) {
				removePendingOutgoingSignal(
					setPendingOutgoingSignals,
					sendError.clientMessageId
				);
			} else if (sendError) {
				markPendingOutgoingSignalFailed(
					setPendingOutgoingSignals,
					sendError.clientMessageId
				);
				composerFilesController.consumePublishedFiles(
					failureInput.publishedLocalIds
				);
			}
		}
		reportComposerSendFailure({
			failure,
			logMessage: "A thread reply was posted, but a follow-up step failed.",
			postedMessage,
			setComposerErrorMessage,
		});
		setComposerBlockedWakeProfileId(
			resolveBlockedWakeProfileIdFromSubmissionError(originalError)
		);
		if (isProtectedSpaceFailure(failure)) {
			await input.statusRefetch();
		}
	}

	async function sendTextMessage(text: string) {
		const thread = activeThread;
		const trimmedText = text.trim();
		if (!thread) {
			throw new Error("Open a thread before sending.");
		}
		if (!trimmedText) {
			throw new Error("Enter a message before sending.");
		}

		setComposerErrorMessage(null);
		setComposerBlockedWakeProfileId(null);
		setIsSendingMessage(true);
		try {
			const preparedSubmission = mentionAuthoring.preparePlainTextSubmission(
				trimmedText,
				resolveMissingSpaceMembersMessage(input.membersErrorMessage)
			);
			await sendPreparedThreadMessage({
				preparedSubmission,
				thread,
			});
		} catch (error) {
			const sendError =
				error instanceof PreparedSpaceMessageSendError ? error : null;
			const originalError = sendError?.originalError ?? error;
			const failure = toStructuredApiClientFailure(originalError);
			reportComposerSendFailure({
				failure,
				logMessage: "A thread reply was posted, but a follow-up step failed.",
				postedMessage: sendError?.postedMessage ?? false,
				setComposerErrorMessage,
			});
			setComposerBlockedWakeProfileId(
				resolveBlockedWakeProfileIdFromSubmissionError(originalError)
			);
			if (isProtectedSpaceFailure(failure)) {
				await input.statusRefetch();
			}
			throwSpaceSendFailureWhenRequested({
				error: originalError,
				postedMessage: sendError?.postedMessage ?? false,
				throwOnFailure: true,
			});
		} finally {
			setIsSendingMessage(false);
		}
	}

	type ThreadMessageSendInput = {
		onMessageStaged?: SpaceComposerSendOptions["onMessageStaged"];
		composerFiles?: readonly SpaceComposerFile[];
		clientMessageId?: string;
		claimFiles?: () => Promise<void>;
		prepareFiles?: () => Promise<{
			messageFiles: SpaceMessageFileReference[];
			previewUrlsByFileId: Map<string, string>;
		}>;
		onPosted?: () => void;
		preparedSubmission: PreparedSpaceMessageSubmission;
		thread: SpaceThread;
	};
	async function tryQueueThreadMessage(
		sendInput: ThreadMessageSendInput,
		clientMessageId: string
	): Promise<boolean> {
		const submission = sendInput.preparedSubmission;
		const queueTarget = resolveQueuedExecutionInput({
			profileId: input.profileId,
			threadId: sendInput.thread.threadId,
			timelineItems: buildSpaceTimelineItems({
				envelopes: threadSignals,
				membersSnapshot: input.membersSnapshot,
			}),
			centerAgentProfileId: input.centerAgentProfileId,
			automaticTargetProfileId:
				threadSignalsQuery.data?.wakeContinuation?.automaticTargetProfileId,
			replyToSignalId: submission.messageEnvelope?.replyToSignalId,
			members: input.membersSnapshot,
			activationTargets: submission.messageEnvelope?.activationTargets ?? [],
			hasFiles: Boolean(sendInput.composerFiles?.length),
			items: mergeWakeProgressItemState({
				currentItems: input.queueProgressItems,
				incomingItems: wakeProgressItems,
				signals: threadSignals,
			}),
		});
		if (
			queueTarget &&
			!submission.contextSelection &&
			!submission.contextSelections &&
			!submission.taskDraft &&
			!submission.deviceWait
		) {
			const request = composerSession.send.reserveRequest();
			try {
				if (queueTarget === "ambiguous") {
					throw new Error(
						"More than one task is active in this Thread. Reply to your original request to choose which task to update."
					);
				}
				if (!input.inputQueue.supportsConversationContext) {
					throw new Error(
						"This server can’t queue Thread replies yet. Your draft is still here. Refresh and try again."
					);
				}
				await request.ready;
				await requireThreadWakeAdmission(submission);
				await input.inputQueue.enqueue({
					action: "enqueue",
					inputId: clientMessageId,
					target: queueTarget,
					text: submission.text,
				});
				sendInput.onPosted?.();
				sendInput.onMessageStaged?.(clientMessageId);
				return true;
			} catch (error) {
				throw new PreparedSpaceMessageSendError({
					clientMessageId,
					originalError: error,
					outcomeUnknown: false,
					postedMessage: false,
				});
			} finally {
				request.complete();
			}
		}
		return false;
	}

	function buildThreadDeliveryOptions(
		submission: PreparedSpaceMessageSubmission
	) {
		return {
			...(submission.threadWakeContinuation
				? { threadWakeContinuation: true as const }
				: {}),
			...(submission.deviceWait ? { deviceWait: submission.deviceWait } : {}),
		};
	}
	async function sendPreparedThreadMessage(
		sendInput: ThreadMessageSendInput
	): Promise<void> {
		const clientMessageId =
			sendInput.clientMessageId ?? createClientMessageId();
		if (await tryQueueThreadMessage(sendInput, clientMessageId)) {
			return;
		}
		const request = composerSession.send.reserveRequest();
		markSpaceSendPending(clientMessageId, () => {
			const files = sendInput.composerFiles ?? [];
			composerFilesController.consumePublishedFiles(
				files.map((file) => file.localId)
			);
			composerFilesController.finishSubmission(files);
		});
		const messageCreatedAtMs = Date.now();
		let activationTargets =
			sendInput.preparedSubmission.messageEnvelope?.activationTargets ?? [];
		const pendingSignal = createPendingOutgoingSignal({
			composerFiles: sendInput.composerFiles,
			clientMessageId,
			createdAtMs: messageCreatedAtMs,
			membersSnapshot: input.membersSnapshot,
			messageEnvelope: sendInput.preparedSubmission.messageEnvelope,
			profileId: input.profileId,
			spaceId: input.spaceId,
			text: sendInput.preparedSubmission.text,
		});
		appendPendingOutgoingSignal(setPendingOutgoingSignals, pendingSignal);
		sendInput.onMessageStaged?.(clientMessageId);
		const sendingWakeProgressItems = buildLocalWakeProgressItems({
			activationTargets,
			clientMessageId,
			membersSnapshot: input.membersSnapshot,
			phase: "sending",
			sourceSignal: pendingSignal.signal,
			threadId: sendInput.thread.threadId,
			updatedAtMs: messageCreatedAtMs,
		});
		setWakeProgressItems((currentItems) =>
			mergeWakeProgressItemState({
				currentItems,
				incomingItems: sendingWakeProgressItems,
				signals: threadSignals,
			})
		);
		input.onWakeProgressItems(sendingWakeProgressItems);

		let postedMessage = false;
		let publicationStarted = false;
		try {
			await sendInput.claimFiles?.();
			await request.ready;
			await requireThreadWakeAdmission(sendInput.preparedSubmission);
			const publishedFiles = await sendInput.prepareFiles?.();
			if (publishedFiles) {
				appendPendingOutgoingSignal(setPendingOutgoingSignals, {
					...pendingSignal,
					filePreviewUrlsById: publishedFiles.previewUrlsByFileId,
					signal: {
						...pendingSignal.signal,
						data: {
							...pendingSignal.signal.data,
							files: publishedFiles.messageFiles,
						},
					},
				});
			}
			const postInput = {
				body: {
					contextSelection: sendInput.preparedSubmission.contextSelection,
					contextSelections: sendInput.preparedSubmission.contextSelections,
					taskDraft: sendInput.preparedSubmission.taskDraft,
					...buildThreadDeliveryOptions(sendInput.preparedSubmission),
					clientMessageId,
					restoredFromSignalId:
						sendInput.preparedSubmission.restoredFromSignalId,
					authorHasRead: true as const,
					...(publishedFiles?.messageFiles.length
						? { files: publishedFiles.messageFiles }
						: {}),
					...(sendInput.preparedSubmission.messageEnvelope
						? {
								messageEnvelope: sendInput.preparedSubmission.messageEnvelope,
							}
						: {}),
					text: sendInput.preparedSubmission.text,
				},
				spaceId: input.spaceId,
				threadId: sendInput.thread.threadId,
				timeoutMs: SPACE_MESSAGE_SEND_TIMEOUT_MS,
			};
			publicationStarted = true;
			const response = await runSpaceComposerIdempotentRequestWithRetry(
				async () =>
					await createUnscopedWebSpaceApi({
						openMeldProfileId: input.profileId,
					}).postThreadSignal(postInput)
			);
			postedMessage = true;
			activationTargets = readPublishedWakeTargetProfileIds(response.signal);
			updateAccountSpaceAcceptedMessage(
				input.queryClient,
				input.profileId,
				response.signal
			);
			completeSpaceSend(clientMessageId);
			recordWakeDiagnosticIfNeeded({
				clientMessageId,
				sourceSignalId: response.signal.id,
				spaceId: input.spaceId,
				targetProfileIds: activationTargets,
				threadId: sendInput.thread.threadId,
			});
			mergeLiveThreadSignalIntoCache({
				openMeldProfileId: input.profileId,
				placement: response.placement,
				queryClient: input.queryClient,
				signal: response.signal,
				spaceId: input.spaceId,
				threadContext: {
					rootSignalId: sendInput.thread.rootSignalId,
					threadId: sendInput.thread.threadId,
				},
			});
			removePendingOutgoingSignal(setPendingOutgoingSignals, clientMessageId);
			const requestSentWakeProgressItems = buildLocalWakeProgressItems({
				activationTargets,
				clientMessageId,
				membersSnapshot: input.membersSnapshot,
				phase: "request_sent",
				sourceSignal: response.signal,
				threadId: sendInput.thread.threadId,
				updatedAtMs: Math.max(response.signal.ts, Date.now()),
			});
			setWakeProgressItems((currentItems) =>
				mergeWakeProgressItemState({
					currentItems,
					incomingItems: requestSentWakeProgressItems,
					signals: threadSignals,
				})
			);
			input.onWakeProgressItems(requestSentWakeProgressItems);
			if (activationTargets.length > 0) {
				invalidateAgentAccessQueries(input.queryClient);
			}
			sendInput.onPosted?.();
			Promise.all([
				threadSignalsQuery.refetch(),
				threadsQuery.refetch(),
				input.membersRefetch(),
				input.statusRefetch(),
			]).catch((error) => {
				console.error(
					"A sent thread reply's projections could not be refreshed.",
					error
				);
			});
		} catch (error) {
			const outcomeUnknown =
				publicationStarted &&
				isSpaceComposerSendOutcomeUnknown(toStructuredApiClientFailure(error));
			if (!(postedMessage || outcomeUnknown)) {
				setWakeProgressItems((currentItems) =>
					removeWakeProgressItemsForClientMessageId({
						clientMessageId,
						items: currentItems,
					})
				);
				input.onWakeProgressRemoveClientMessageId(clientMessageId);
				markPendingOutgoingSignalFailed(
					setPendingOutgoingSignals,
					clientMessageId
				);
			}
			throw new PreparedSpaceMessageSendError({
				clientMessageId,
				originalError: error,
				outcomeUnknown,
				postedMessage,
			});
		} finally {
			request.complete();
		}
	}
}

function useWakeProgressPolling(input: {
	enabled: boolean;
	items: readonly WakeProgressItem[];
	logEventName: string;
	profileId: string;
	setItems: (value: SetStateAction<WakeProgressItem[]>) => void;
	signals: readonly SignalEnvelope[];
	spaceId: string;
}) {
	const queryClient = useQueryClient();
	const {
		enabled,
		items,
		logEventName,
		profileId,
		setItems,
		signals,
		spaceId,
	} = input;
	const pollAttemptsRef = useRef(new Map<string, number>());

	useEffect(() => {
		recordSpaceWakeProgressEvidence({
			queryClient,
			spaceId,
			openMeldProfileId: profileId,
			signals,
		});
		// History can close a Wake, but an old transient cannot prove it is still running.
		const terminalSignals = signals.filter(
			(signal) =>
				buildWakeProgressItemFromTransientSignal(signal)?.terminal === true ||
				readWakeProgressTerminalSignalEvidence(signal) !== null
		);
		if (terminalSignals.length === 0) {
			return;
		}
		setItems((currentItems) => {
			const nextItems = applyWakeProgressSignals({
				currentItems,
				signals: terminalSignals,
			});
			return areWakeProgressItemsEqual(currentItems, nextItems)
				? currentItems
				: nextItems;
		});
	}, [setItems, signals, queryClient, spaceId, profileId]);

	useEffect(() => {
		const pendingClientMessageIds =
			listPendingWakeProgressClientMessageIds(items);
		const pendingSet = new Set(pendingClientMessageIds);
		for (const clientMessageId of pollAttemptsRef.current.keys()) {
			if (!pendingSet.has(clientMessageId)) {
				pollAttemptsRef.current.delete(clientMessageId);
			}
		}
	}, [items]);

	useEffect(() => {
		if (!enabled) {
			return;
		}
		const pendingClientMessageIds =
			listPendingWakeProgressClientMessageIds(items);
		if (pendingClientMessageIds.length === 0) {
			return;
		}
		let cancelled = false;
		let timeoutId: number | null = null;
		const abort = new AbortController();
		const schedulePoll = () => {
			const delayMs = resolveWakeProgressPollDelayMs({
				attemptCounts: pendingClientMessageIds.map(
					(clientMessageId) => pollAttemptsRef.current.get(clientMessageId) ?? 0
				),
			});
			timeoutId = window.setTimeout(() => {
				const polledItems: WakeProgressItem[] = [];
				const fulfilledIds: string[] = [];
				pollWakeProgress({
					signal: abort.signal,
					openMeldProfileId: profileId,
					clientMessageIds: pendingClientMessageIds,
					onItems: (items, fulfilledClientMessageIds) => {
						polledItems.push(...items);
						fulfilledIds.push(...fulfilledClientMessageIds);
					},
					onSettled: () => {
						if (cancelled) {
							return;
						}
						recordSpaceWakeProgressEvidence({
							queryClient,
							spaceId,
							openMeldProfileId: profileId,
							items: polledItems,
						});
						// Updating items replaces this effect. Finish all bounded groups
						// before publishing so early groups cannot starve later targets.
						setItems((currentItems) =>
							reconcilePolledWakeProgressItems({
								currentItems,
								snapshotItemsAtRequestStart: items,
								fulfilledClientMessageIds: fulfilledIds,
								incomingItems: polledItems,
								signals,
							})
						);
						for (const clientMessageId of pendingClientMessageIds) {
							pollAttemptsRef.current.set(
								clientMessageId,
								(pollAttemptsRef.current.get(clientMessageId) ?? 0) + 1
							);
						}
						schedulePoll();
					},
					spaceId,
				}).catch((error) => {
					console.warn(logEventName, {
						error: error instanceof Error ? error.message : String(error),
						spaceId,
					});
				});
			}, delayMs);
		};
		schedulePoll();
		return () => {
			cancelled = true;
			abort.abort();
			if (timeoutId !== null) {
				window.clearTimeout(timeoutId);
			}
		};
	}, [
		enabled,
		items,
		logEventName,
		profileId,
		setItems,
		signals,
		spaceId,
		queryClient,
	]);
}

async function refreshWakeStopAfterResponse(input: {
	openMeldProfileId: string;
	clientMessageId: string | null;
	onProgressItems: (items: readonly WakeProgressItem[]) => void;
	queryClient: ReturnType<typeof useQueryClient>;
	sourceSignalId: string | null;
	spaceId: string;
	targetProfileId: string | null;
	threadId: string | null;
}): Promise<void> {
	const refreshes: Promise<unknown>[] = [
		invalidateSpaceWakeStopQueries({
			openMeldProfileId: input.openMeldProfileId,
			queryClient: input.queryClient,
			sourceSignalId: input.sourceSignalId,
			spaceId: input.spaceId,
			threadId: input.threadId,
		}),
	];

	if (input.clientMessageId) {
		refreshes.push(
			pollWakeProgress({
				openMeldProfileId: input.openMeldProfileId,
				clientMessageIds: [input.clientMessageId],
				onItems: input.onProgressItems,
				onSettled: () => undefined,
				spaceId: input.spaceId,
			})
		);
	} else if (input.targetProfileId) {
		refreshes.push(
			createUnscopedWebSpaceApi({
				openMeldProfileId: input.openMeldProfileId,
			})
				.getActiveWakeProgress({
					includePreviewText: true,
					includeSourceContext: true,
					includeTiming: true,
					includeWaitReason: true,
					includeDeviceWait: true,
					includeWakeStopEligibility: true,
					spaceId: input.spaceId,
					targetProfileId: input.targetProfileId,
					timeoutMs: SPACE_WAKE_PROGRESS_TIMEOUT_MS,
				})
				.then((response) => {
					input.onProgressItems(response.items);
				})
		);
	}

	await Promise.all(refreshes);
}

function useActiveSpaceHistorySync(input: {
	currentProfileIsActiveSpaceMember: boolean;
	membersReady: boolean;
	profileId: string;
	queryClient: ReturnType<typeof useQueryClient>;
	spaceId: string;
	spaceName: string | null;
	statusReady: boolean;
}) {
	const syncKeyRef = useRef<string | null>(null);
	const shouldSync =
		input.statusReady &&
		input.membersReady &&
		input.currentProfileIsActiveSpaceMember;

	useEffect(() => {
		if (!shouldSync) {
			return;
		}

		const spaceName = normalizeOptionalText(input.spaceName);
		const syncKey = `${input.spaceId}:${input.profileId}:${spaceName ?? ""}`;
		if (syncKeyRef.current === syncKey) {
			return;
		}
		syncKeyRef.current = syncKey;

		let cancelled = false;
		upsertProfileSpaceHistory({
			data: {
				spaceId: input.spaceId,
				...(spaceName ? { spaceName } : {}),
				lastSeenTs: Date.now(),
				items: [{ profileId: input.profileId }],
			},
		})
			.then(async () => {
				if (cancelled) {
					return;
				}
				await input.queryClient.invalidateQueries({
					queryKey: accountSpaceQueryKeys.all,
				});
			})
			.catch((error) => {
				if (cancelled) {
					return;
				}
				if (syncKeyRef.current === syncKey) {
					syncKeyRef.current = null;
				}
				console.warn("[openmeld.web.space.history_sync_failed]", {
					error: error instanceof Error ? error.message : String(error),
					profileId: input.profileId,
					spaceId: input.spaceId,
				});
			});

		return () => {
			cancelled = true;
		};
	}, [
		input.profileId,
		input.queryClient,
		input.spaceId,
		input.spaceName,
		shouldSync,
	]);
}

function resolveNavigationPresentation(
	navigation: SpaceHistoryNavigationController,
	live: {
		hasEarlierHistory: boolean;
		historyActionErrorMessage: string | null;
		isLoadingEarlierHistory: boolean;
	}
) {
	return {
		hasEarlierHistory:
			navigation.activeWindow?.hasBefore ??
			(navigation.hasHiddenLiveHistory || live.hasEarlierHistory),
		historyActionErrorMessage:
			navigation.error ?? live.historyActionErrorMessage,
		isLoadingEarlierHistory: navigation.activeWindow
			? navigation.pending
			: live.isLoadingEarlierHistory,
	};
}

function usePendingOutgoingSignals(
	spaceId: string,
	profileId: string,
	threadId: string | null
) {
	const queryClient = useQueryClient();
	const queryKey = useMemo(
		() => pendingOutgoingSignalsQueryKey(spaceId, profileId, threadId),
		[spaceId, profileId, threadId]
	);
	const query = useQuery({
		queryKey,
		queryFn: skipToken,
		initialData: [] as PendingOutgoingSignal[],
		gcTime: Number.POSITIVE_INFINITY,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const update = useCallback(
		(value: SetStateAction<PendingOutgoingSignal[]>) => {
			queryClient.setQueryData<PendingOutgoingSignal[]>(queryKey, (current) =>
				typeof value === "function" ? value(current ?? []) : value
			);
		},
		[queryClient, queryKey]
	);
	return [query.data ?? [], update] as const;
}

function useReconcilePendingOutgoingSignals(
	pending: readonly PendingOutgoingSignal[],
	persisted: readonly SignalEnvelope[],
	update: (value: SetStateAction<PendingOutgoingSignal[]>) => void
) {
	useEffect(() => {
		const confirmed = new Set(
			persisted.flatMap((signal) =>
				signal.type === "signal.text" &&
				typeof signal.data.meta?.clientMessageId === "string"
					? [signal.data.meta.clientMessageId]
					: []
			)
		);
		const delivered = pending.filter((item) =>
			confirmed.has(item.clientMessageId)
		);
		if (!delivered.length) {
			return;
		}
		for (const item of delivered) {
			completeSpaceSend(item.clientMessageId);
		}
		update((current) =>
			current.filter((item) => !confirmed.has(item.clientMessageId))
		);
	}, [pending, persisted, update]);
}
