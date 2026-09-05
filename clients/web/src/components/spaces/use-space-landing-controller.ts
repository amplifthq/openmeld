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
	filterVisibleWakeProgressItems,
	resolveSpaceDeleteActionVisibility,
} from "@openmeld/space";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
	type ComposerDraftRecord,
	type ComposerDraftScope,
	createComposerDraftRecord,
	EMPTY_COMPOSER_DRAFT_CONTENT,
} from "#/lib/composer-draft-storage";
import { updateProfileSpaceHistoryStatus } from "#/lib/onboarding/update-profile-space-history-status";
import { upsertProfileSpaceHistory } from "#/lib/onboarding/upsert-profile-space-history";
import { buildOrganizationSpacesPath } from "#/lib/organizations/organization-routes";
import {
	ensureWebAgentProfileRuntimeBinding,
	formatWebAgentProfileRuntimeBindingFailure,
} from "#/lib/profiles/agent-profile-runtime-binding";
import {
	createOrganizationScopedWebSpaceApi,
	createUnscopedWebSpaceApi,
} from "#/lib/spaces/api";
import {
	isSpaceComposerFileInProgress,
	type SpaceComposerFile,
} from "#/lib/spaces/composer-attachment";
import type { SpaceConversationVisibleStreamProjection } from "#/lib/spaces/conversation-stream";
import { removeDeletedSpaceFromAccountHistory } from "#/lib/spaces/delete-space-history-cleanup";
import type { SpaceEphemeralActivityItem } from "#/lib/spaces/dispatch-activity";
import {
	isCurrentSpaceAccessRejection,
	isProtectedSpaceFailure,
	isSpaceComposerSendOutcomeUnknown,
	resolveSpaceComposerSendErrorMessage,
	runSpaceComposerIdempotentRequestWithRetry,
} from "#/lib/spaces/errors";
import {
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
import type {
	SpaceWakeStopRequestStatus,
	SpaceWakeStopTargetResolution,
} from "#/lib/spaces/wake-stop-target";
import { resolveAppQueryPersistenceController } from "#/query/persistence/app-query-persistence";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import {
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
import { spaceQueryKeys, spaceStatusQueryOptions } from "#/query/spaces/status";
import {
	spaceThreadSignalsQueryOptions,
	spaceThreadsQueryOptions,
} from "#/query/spaces/threads";
import {
	invalidateSpaceWakeStopQueries,
	postWebSpaceWakeStop,
} from "#/query/spaces/wake-stop";
import type {
	SpaceComposerEditorChange,
	SpaceComposerInputRef,
} from "./space-composer-editor";
import { requireCurrentSpaceComposerWakeAdmission } from "./space-composer-wake-admission";
import { projectSpaceExecutionRecoveryResolution } from "./space-execution-recovery";
import { persistSpaceNameUpdate } from "./space-name-update";
import { usePublishSpaceWakeProgressVisibleProjection } from "./space-wake-progress-visible-projection";
import type {
	SpaceExecutionRecoveryAttempt,
	SpaceExecutionRecoveryResolution,
	SpaceWakeRetryAttempt,
} from "./space-wake-retry";
import { useSpaceComposerSession } from "./use-space-composer-session";
import {
	addSetValue,
	areWakeProgressItemsEqual,
	buildLocalWakeProgressItems,
	createClientMessageId,
	createStatusAndMembersRefreshDedupe,
	findSessionExpiredError,
	hasActiveSpaceMember,
	listPendingWakeProgressClientMessageIds,
	listRecoverableWakeProgressClientMessageIds,
	mergeActiveWakeProgressPresentation,
	mergeLiveThreadSignalIntoCache,
	mergeWakeProgressItemState,
	normalizeOptionalText,
	pollWakeProgress,
	readSpaceStatusName,
	reconcileActiveWakeProgressSnapshot,
	reconcilePolledWakeProgressItems,
	recordDiagnosticReportPointer,
	recordWakeDiagnosticIfNeeded,
	refreshLanding,
	removeSetValue,
	removeWakeProgressItemsForClientMessageId,
	resolveBlockedWakeProfileIdFromSubmissionError,
	resolveComposerWakeProgressTargetProfileIds,
	resolveDeleteSpaceErrorMessage,
	resolveDiagnosticReportProblemType,
	resolveLeaveSpaceErrorMessage,
	resolveQueryError,
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

const EMPTY_WAKE_PROGRESS_ITEMS: WakeProgressItem[] = [];

type PendingOutgoingSignal = {
	filePreviewUrlsById: ReadonlyMap<string, string>;
	clientMessageId: string;
	signal: TextSignalEnvelope;
};

type SpaceMentionAuthoringController = ReturnType<
	typeof useSpaceMentionAuthoring
>;

type PendingComposerSubmission = ReturnType<
	SpaceMentionAuthoringController["prepareSubmission"]
>;

type PreparedSpaceMessageSubmission = Pick<
	PendingComposerSubmission,
	"messageEnvelope" | "text"
>;

type ProgrammaticWakeRetryInput = SpaceWakeRetryAttempt;

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

function throwSpaceSendFailureWhenRequested(input: {
	error: unknown;
	postedMessage: boolean;
	throwOnFailure: boolean;
}): void {
	if (input.throwOnFailure && !input.postedMessage) {
		throw input.error;
	}
}

function prepareProgrammaticWakeRetrySubmission(
	input: ProgrammaticWakeRetryInput
): PreparedSpaceMessageSubmission {
	const text = input.sourceText.trim();
	const targetProfileId = input.targetProfileId.trim();
	if (!text) {
		throw new Error("The Wake retry source message text is required.");
	}
	if (!targetProfileId) {
		throw new Error("The Wake retry target Agent Profile is required.");
	}

	return {
		messageEnvelope: {
			activationTargets: [targetProfileId],
			referenceTargets: [],
			text,
		},
		text,
	};
}

function createPendingOutgoingSignal(input: {
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
	return {
		filePreviewUrlsById: input.filePreviewUrlsById ?? new Map<string, string>(),
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
				...(input.files && input.files.length > 0
					? { files: [...input.files] }
					: {}),
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
		hasReadyFiles: composerFiles.some(
			(file) => file.status === "ready" && file.upload !== null
		),
		uploadInProgress: composerFiles.some(isSpaceComposerFileInProgress),
	};
}

function buildNormalMessagePostInput(input: {
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
			clientMessageId: input.clientMessageId,
		},
		spaceId: input.spaceId,
		text: input.text,
		timeoutMs: SPACE_MESSAGE_SEND_TIMEOUT_MS,
	};
}

function resolvePendingOutgoingProfile(input: {
	membersSnapshot: SpaceMembersSnapshot | null;
	profileId: string;
}): TextSignalEnvelope["profile"] {
	const human = input.membersSnapshot?.humans.find(
		(member) => member.profileId === input.profileId
	);
	if (human) {
		return {
			kind: "human",
			profileId: human.profileId,
			profileName: human.profileName,
			...(human.avatarUrl ? { avatarUrl: human.avatarUrl } : {}),
		};
	}

	const agent = input.membersSnapshot?.agents.find(
		(member) => member.profileId === input.profileId
	);
	if (agent) {
		return {
			kind: "agent",
			profileId: agent.profileId,
			profileName: agent.profileName,
			...(agent.ownerUserId ? { owner: agent.ownerUserId } : {}),
			...(agent.ownerName ? { ownerName: agent.ownerName } : {}),
			...(agent.agentControllerRef
				? { agentControllerRef: agent.agentControllerRef }
				: {}),
			...(agent.agentControllerConversationId
				? {
						agentControllerConversationId: agent.agentControllerConversationId,
					}
				: {}),
			...(agent.workingDirectory
				? { workingDirectory: agent.workingDirectory }
				: {}),
		};
	}

	const normalizedProfileId =
		normalizeOptionalText(input.profileId) ?? input.profileId;
	return {
		kind: normalizedProfileId.startsWith("agt_") ? "agent" : "human",
		profileId: normalizedProfileId,
		profileName: normalizedProfileId,
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

function canStartSpaceComposerSend(input: {
	allowedToPost: boolean;
	isInFlight: boolean;
	statusReady: boolean;
}): boolean {
	return input.statusReady && input.allowedToPost && !input.isInFlight;
}

function settleSpaceComposerSendFailure(input: {
	clearFiles: () => void;
	clientMessageId: string;
	consumePublishedFiles: (publishedLocalIds: readonly string[]) => void;
	hasPublishedFiles: boolean;
	isPendingMessage: boolean;
	mentionAuthoring: SpaceMentionAuthoringController;
	outcomeUnknown: boolean;
	pendingSubmission: PendingComposerSubmission | null;
	publishedLocalIds: readonly string[];
	postedMessage: boolean;
	setPendingSignals: (value: SetStateAction<PendingOutgoingSignal[]>) => void;
}) {
	if (input.postedMessage || input.outcomeUnknown) {
		consumePublishedComposerFilesAfterAcceptedOrUnknownSend({
			clientMessageId: input.clientMessageId,
			consumePublishedFiles: input.consumePublishedFiles,
			outcomeUnknown: input.outcomeUnknown,
			postedMessage: input.postedMessage,
			publishedLocalIds: input.publishedLocalIds,
			setPendingSignals: input.setPendingSignals,
		});
		return;
	}
	const restoredPreviousSubmission = restoreFailedPendingSubmission({
		mentionAuthoring: input.mentionAuthoring,
		pendingSubmission: input.pendingSubmission,
	});
	if (restoredPreviousSubmission) {
		removePendingOutgoingSignal(input.setPendingSignals, input.clientMessageId);
		return;
	}
	markPendingOutgoingSignalFailed(
		input.setPendingSignals,
		input.clientMessageId
	);
	if (input.hasPublishedFiles) {
		clearManualComposerFiles({
			clearFiles: input.clearFiles,
			isPendingMessage: input.isPendingMessage,
		});
	}
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
		isPendingMessage: input.pendingMessage !== undefined,
	});
	if (fileSubmission.uploadInProgress) {
		return { errorMessage: null, status: "blocked" as const };
	}
	const messageSeed = createSpaceMessageSendSeed({
		composerText: input.composerText,
		pendingMessage: input.pendingMessage,
	});
	if (messageSeed.text.length === 0 && !fileSubmission.hasReadyFiles) {
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
	if (input.pendingMessage) {
		return input.mentionAuthoring.preparePlainTextSubmission(
			input.messageSeed.text,
			input.missingMembersMessage
		);
	}
	if (input.messageSeed.text.length > 0) {
		return input.mentionAuthoring.prepareSubmission(
			input.missingMembersMessage
		);
	}
	return input.mentionAuthoring.prepareFileOnlySubmission();
}

function resolveThreadComposerBlockedReason(input: {
	hasActiveThread: boolean;
	hasReadyFiles: boolean;
	text: string;
	uploadInProgress: boolean;
}): string | null {
	if (!input.hasActiveThread) {
		return "Open a thread before sending.";
	}
	if (input.uploadInProgress) {
		return "Wait for files to finish uploading before sending.";
	}
	if (input.text.length === 0 && !input.hasReadyFiles) {
		return "Enter a reply or add a file before sending.";
	}
	return null;
}

function clearManualComposerFiles(input: {
	clearFiles: () => void;
	isPendingMessage: boolean;
}): void {
	if (!input.isPendingMessage) {
		input.clearFiles();
	}
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
			queryClient: input.queryClient,
			spaceId: input.spaceId,
			viewerProfileId: input.profileId,
		});
	}, [input.bootstrap, input.profileId, input.queryClient, input.spaceId]);
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

function useSpaceLandingBootstrapState(input: {
	profileId: string;
	queryClient: ReturnType<typeof useQueryClient>;
	spaceId: string;
}) {
	const bootstrapQuery = useQuery(
		spaceBootstrapQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
			enabled: true,
		})
	);
	useSpaceBootstrapQueryCache({
		bootstrap: bootstrapQuery.data ?? null,
		profileId: input.profileId,
		queryClient: input.queryClient,
		spaceId: input.spaceId,
	});
	const statusQuery = useQuery(
		spaceStatusQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
			enabled: true,
		})
	);
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
	const currentStatusSnapshot =
		currentAccessRejection === null ? (statusQuery.data ?? null) : null;
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
			enabled: false,
		})
	);
	const membersSnapshot = membersQuery.data ?? null;
	const presentationMembersSnapshot = bootstrapQuery.data
		? resolveSpaceMembersPresentationSnapshot({
				bootstrap: bootstrapQuery.data.members,
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
		historySnapshot !== null &&
		displaySnapshotQuery.data
			? readOnlySpaceStatusFromDisplaySnapshot(displaySnapshotQuery.data)
			: null;
	const statusSnapshot = currentStatusSnapshot ?? restoredDisplayStatus;
	const currentStatusConfirmationPending =
		currentStatusSnapshot === null &&
		landingError === null &&
		statusQuery.isPending;
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
	organizationSlug: string;
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
		if (!(input.currentAccessRejection && input.organizationId)) {
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

function resolveConfirmedViewedThroughHandler(input: {
	isCurrentAccessConfirmed: boolean;
	onViewedThroughTs?: (throughTs: number) => Promise<void> | void;
}): ((throughTs: number) => Promise<void> | void) | undefined {
	return input.isCurrentAccessConfirmed ? input.onViewedThroughTs : undefined;
}

function shouldShowSpaceLandingLoading(input: {
	bootstrapPending: boolean;
	currentStatusConfirmationPending: boolean;
	hasDisplayStatus: boolean;
}): boolean {
	return (
		!input.hasDisplayStatus &&
		(input.currentStatusConfirmationPending || input.bootstrapPending)
	);
}

export type SpaceLandingController =
	| {
			composerAddressingTargets: readonly SpaceComposerAddressingTarget[];
			composerAuthoredMentions: ComposerDraftRecord["authoredMentions"];
			composerMentionPickerItems: readonly SpaceMentionPickerItem[];
			composerText: string;
			mode: "loading";
			onComposerBlur: () => void;
			onComposerEditorChange: (change: SpaceComposerEditorChange) => void;
			onComposerFocus: () => void;
			textareaRef: SpaceComposerInputRef;
	  }
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
	| {
			activeThread: SpaceThread | null;
			agentStreams: readonly SpaceConversationVisibleStreamProjection[];
			composerAddressingTargets: readonly SpaceComposerAddressingTarget[];
			composerAuthoredMentions: ComposerDraftRecord["authoredMentions"];
			composerMentionPickerItems: readonly SpaceMentionPickerItem[];
			composerFiles: readonly SpaceComposerFile[];
			composerFileLimitReached: boolean;
			composerBlockedWakeProfileId: string | null;
			composerErrorMessage: string | null;
			composerHasAuthoredMentions: boolean;
			composerReplyToSignalId: string | null;
			composerText: string;
			ephemeralActivityItems: readonly SpaceEphemeralActivityItem[];
			presentedWakeProgressItems: readonly SpaceEphemeralActivityItem[];
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
			liveErrorMessage: string | null;
			liveState: SpaceLiveState;
			onReconnectLiveUpdates: () => void;
			membersError: StructuredApiClientFailure | null;
			membersSnapshot: SpaceMembersSnapshot | null;
			presentationMembersSnapshot: SpaceMembersSnapshot | null;
			mode: "ready";
			onComposerEditorChange: (change: SpaceComposerEditorChange) => void;
			onClearComposerReplyTo: () => void;
			onAddComposerFiles: (files: readonly File[]) => Promise<void>;
			onRemoveComposerFile: (localId: string) => void;
			onConversationViewingLatestChange: (isViewingLatest: boolean) => void;
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
				password?: string;
			}) => Promise<void>;
			onUpdateSpaceName: (name: string) => Promise<void>;
			onThreadComposerEditorChange: (change: SpaceComposerEditorChange) => void;
			onThreadMentionButtonClick: () => void;
			onThreadSend: () => Promise<void>;
			onThreadSendText: (text: string) => Promise<void>;
			onAddThreadComposerFiles: (files: readonly File[]) => Promise<void>;
			onRemoveThreadComposerFile: (localId: string) => void;
			onReplyToMessage: (item: SpaceTimelineItem) => void;
			onReportMessage: (item: SpaceTimelineItem) => Promise<void>;
			onRecoverExecution: (
				input: SpaceExecutionRecoveryAttempt
			) => Promise<SpaceExecutionRecoveryResolution>;
			onRetryWakeTarget: (input: ProgrammaticWakeRetryInput) => Promise<void>;
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
			onSend: () => Promise<void>;
			onSendText: (text: string) => Promise<void>;
			profileId: string;
			spaceId: string;
			status: GetSpaceStatusResponse;
			threadComposerBlockedWakeProfileId: string | null;
			threadComposerAddressingTargets: readonly SpaceComposerAddressingTarget[];
			threadComposerAuthoredMentions: ComposerDraftRecord["authoredMentions"];
			threadComposerMentionPickerItems: readonly SpaceMentionPickerItem[];
			threadComposerErrorMessage: string | null;
			threadComposerHasAuthoredMentions: boolean;
			threadComposerText: string;
			threadComposerFiles: readonly SpaceComposerFile[];
			threadComposerFileLimitReached: boolean;
			threadFilePreviewUrlsById: ReadonlyMap<string, string>;
			threadEphemeralActivityItems: readonly SpaceEphemeralActivityItem[];
			threads: readonly SpaceThread[];
			threadPreviews: readonly SpaceThreadPreview[];
			threadSignals: readonly SignalEnvelope[];
			threadsErrorMessage: string | null;
			threadSignalsErrorMessage: string | null;
			threadsIsLoading: boolean;
			threadSignalsIsLoading: boolean;
			threadUnreadFocus: {
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

export function useSpaceLandingController(input: {
	initialComposerDraft?: ComposerDraftRecord | null;
	composerDraftMigrationScopes?: readonly ComposerDraftScope[];
	initialPendingMessage?: PendingSpaceMessage | null;
	onAgentReadinessInvalidated?: (input: {
		agentProfileIds: readonly string[];
	}) => Promise<void> | void;
	onWakeFinalOutcomeFactsRefresh?: (input: {
		agentProfileIds: readonly string[];
		signalIds: readonly string[];
	}) => Promise<void> | void;
	onInitialPendingMessageConsumed?: () => void;
	onViewedThroughTs?: (throughTs: number) => Promise<void> | void;
	unreadStateReady?: boolean;
	unreadTargets?: readonly SpaceInboxUnreadTarget[];
	organizationId?: string | null;
	orgSlug: string;
	ownerAccountId: string;
	profileId: string;
	spaceId: string;
}): SpaceLandingController {
	const [password, setPassword] = useState("");
	const [passwordErrorMessage, setPasswordErrorMessage] = useState<
		string | null
	>(null);
	const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
	const [pendingOutgoingSignals, setPendingOutgoingSignals] = useState<
		PendingOutgoingSignal[]
	>([]);
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
	] = useState<ReadonlyMap<string, SpaceWakeStopRequestStatus>>(
		() => new Map()
	);
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
	const wakeProgressPresentationQuery = useQuery(
		spaceWakeProgressPresentationQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
		})
	);
	const wakeProgressItems =
		wakeProgressPresentationQuery.data ?? EMPTY_WAKE_PROGRESS_ITEMS;
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
	const activeWakeProgressSummaryQuery = useQuery(
		spaceActiveWakeProgressSummaryQueryOptions({
			enabled:
				input.profileId.trim().length > 0 && input.spaceId.trim().length > 0,
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
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
	const currentProfileId = input.profileId;
	const currentSpaceId = input.spaceId;
	const currentProfileMembershipState = useCurrentProfileSpaceMembershipState({
		membersSnapshot,
		profileId: input.profileId,
		spaceId: input.spaceId,
	});
	const currentProfileIsActiveSpaceMember =
		currentProfileMembershipState === "member";
	useEffect(() => {
		if (
			currentProfileId.trim().length === 0 ||
			currentSpaceId.trim().length === 0
		) {
			return;
		}
		setPendingOutgoingSignals([]);
		setWakeStopRequestStatusBySelectorKey(new Map());
	}, [currentProfileId, currentSpaceId]);
	useActiveSpaceHistorySync({
		currentProfileIsActiveSpaceMember,
		membersReady,
		profileId: input.profileId,
		queryClient,
		spaceId: input.spaceId,
		spaceName: readSpaceStatusName(statusSnapshot ?? undefined),
		statusReady,
	});
	const {
		agentStreamProjections,
		liveErrorMessage,
		liveState,
		mergePersistedIncoming,
		reconnectNow,
		timelineEnvelopes,
	} = useSpaceLandingFeed({
		openMeldProfileId: input.profileId,
		participationEnabled: currentProfileIsActiveSpaceMember,
		onAgentReadinessInvalidated: input.onAgentReadinessInvalidated,
		onWakeFinalOutcomeFactsRefresh: input.onWakeFinalOutcomeFactsRefresh,
		onThreadSignal: handleLiveThreadSignal,
		spaceId: input.spaceId,
		statusReady,
		statusRefetch: statusQuery.refetch,
		membersRefetch: membersQuery.refetch,
		initialAgentStreamPresences:
			bootstrapQuery.data?.activeAgentStreamPresences ?? [],
		initialAgentStreams: bootstrapQuery.data?.activeAgentStreams ?? [],
		history: {
			isPending: historyPending,
			isSuccess: historyReady,
			isError: historyQuery.isError,
			...(historySnapshot ? { data: historySnapshot } : {}),
		},
	});
	// Starts false: the unread watermark must not advance until the conversation
	// panel reports a real "scrolled to latest" measurement (a fresh open scrolls
	// to the bottom and emits true; a deep link to an old message stays false).
	const [isConversationViewingLatest, setIsConversationViewingLatest] =
		useState(false);
	// Reset that measurement synchronously (during render) whenever the
	// conversation identity changes, so a stale "viewing latest" from a previous
	// Space can never mark the next Space's messages read before its panel has
	// measured. The derived value also forces false until the reset lands, so the
	// in-flight render that triggered the reset never reports a stale measurement.
	const conversationViewingIdentity = `${input.spaceId}::${input.profileId}`;
	const [measuredViewingIdentity, setMeasuredViewingIdentity] = useState(
		conversationViewingIdentity
	);
	if (measuredViewingIdentity !== conversationViewingIdentity) {
		setMeasuredViewingIdentity(conversationViewingIdentity);
		setIsConversationViewingLatest(false);
	}
	const isViewingLatestForCurrentConversation =
		measuredViewingIdentity === conversationViewingIdentity &&
		isConversationViewingLatest;
	const unreadState = useSpaceUnread({
		envelopes: timelineEnvelopes,
		isReady: input.unreadStateReady === true,
		isViewingLatest: isViewingLatestForCurrentConversation,
		onViewedThroughTs: resolveConfirmedViewedThroughHandler({
			isCurrentAccessConfirmed: statusReady,
			onViewedThroughTs: input.onViewedThroughTs,
		}),
		spaceId: input.spaceId,
		targets: input.unreadTargets ?? [],
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
			initialComposerDraft: input.initialPendingMessage
				? createComposerDraftRecord(
						{
							...EMPTY_COMPOSER_DRAFT_CONTENT,
							text: input.initialPendingMessage.text,
						},
						input.initialPendingMessage.createdAtMs
					)
				: input.initialComposerDraft,
			isMembersLoading: membersLoading,
			membersErrorMessage,
			spaceId: input.spaceId,
			snapshot: membersSnapshot,
		},
		files: {
			organizationSlug: input.orgSlug,
			profileId: input.profileId,
			spaceId: input.spaceId,
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
	const {
		inFlightRef: composerSendInFlightRef,
		isSending: isSendingMessage,
		setIsSending: setIsSendingMessage,
	} = composerSession.send;
	const restoreColdLoadingComposerFocusRef = useRef(false);
	useLayoutEffect(() => {
		if (!(statusReady && restoreColdLoadingComposerFocusRef.current)) {
			return;
		}
		restoreColdLoadingComposerFocusRef.current = false;
		mentionAuthoring.textareaRef.current?.focus();
	}, [mentionAuthoring.textareaRef, statusReady]);
	const consumedInitialPendingMessageIdRef = useRef<string | null>(null);
	const sendInitialPendingMessage = useEffectEvent(
		async (pendingMessage: PendingSpaceMessage) => {
			input.onInitialPendingMessageConsumed?.();
			await sendMessage({ pendingMessage });
		}
	);
	useEffect(() => {
		const pendingMessage = input.initialPendingMessage;
		const canAttemptPendingMessage =
			statusReady &&
			currentProfileIsActiveSpaceMember &&
			(membersReady || membersError) &&
			!isSendingMessage &&
			mentionAuthoring.composerText.trim() === pendingMessage?.text.trim();
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
		currentProfileIsActiveSpaceMember,
		isSendingMessage,
		membersError,
		membersReady,
		mentionAuthoring.composerText,
		statusReady,
	]);
	const mergeConversationWakeProgressItems = useCallback(
		(incomingItems: readonly WakeProgressItem[]) => {
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
		[setWakeProgressItems, timelineEnvelopes]
	);
	const mergeRecoveredWakeProgressItems = useEffectEvent(
		(incomingItems: readonly WakeProgressItem[]) => {
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
		isMembersLoading: membersLoading,
		membersErrorMessage,
		membersRefetch: membersQuery.refetch,
		membersSnapshot,
		initialThreads: bootstrapQuery.data?.threads ?? null,
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
		threadsLoading:
			bootstrapQuery.isPending && bootstrapQuery.data === undefined,
		statusReady,
		statusRefetch: statusQuery.refetch,
	});
	const [threadUnreadFocus, setThreadUnreadFocus] = useState<{
		rootSignalId: string;
		signalId: string;
		spaceId: string;
	} | null>(null);
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
			const opened = await threadController.onOpenUnreadThread({
				rootSignalId: target.rootSignalId,
				...(target.threadId ? { threadId: target.threadId } : {}),
			});
			if (!opened) {
				return false;
			}
			setThreadUnreadFocus({
				rootSignalId: target.rootSignalId,
				signalId: target.signalId,
				spaceId: input.spaceId,
			});
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
		setWakeStopRequestStatusBySelectorKey(new Map());
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
				includeTiming: true,
				includeWaitReason: true,
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
		pollWakeProgress({
			openMeldProfileId: input.profileId,
			clientMessageIds,
			onItems: (items) => {
				if (cancelled || items.length === 0) {
					return;
				}
				mergeRecoveredWakeProgressItems(items);
			},
			onSettled: () => undefined,
			spaceId: input.spaceId,
		}).catch((error) => {
			console.warn("[openmeld.web.space.wake_progress_recovery_unhandled]", {
				error: error instanceof Error ? error.message : String(error),
				spaceId: input.spaceId,
			});
		});

		return () => {
			cancelled = true;
		};
	}, [input.profileId, input.spaceId, statusReady, timelineEnvelopes]);

	const presentedWakeProgressItems = useMemo(
		() =>
			mergeActiveWakeProgressPresentation({
				detailedItems: wakeProgressItems,
				signals: timelineEnvelopes,
				summaryItems: activeWakeProgressSummaryQuery.data?.items ?? [],
			}),
		[
			activeWakeProgressSummaryQuery.data?.items,
			timelineEnvelopes,
			wakeProgressItems,
		]
	);
	usePublishSpaceWakeProgressVisibleProjection(presentedWakeProgressItems);

	useWakeProgressPolling({
		enabled: statusReady,
		items: presentedWakeProgressItems,
		logEventName: "[openmeld.web.space.wake_progress_poll_unhandled]",
		profileId: input.profileId,
		setItems: setWakeProgressItems,
		signals: timelineEnvelopes,
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
					next.delete(selectorKey);
					return next;
				});
				throw toStructuredApiClientFailure(error);
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
		]
	);
	const handleAgentInteractionResponse = useCallback(
		async (body: RespondToSpaceAgentInteractionBody): Promise<void> => {
			try {
				const response = await createUnscopedWebSpaceApi({
					openMeldProfileId: input.profileId,
				}).respondToAgentInteraction({
					body,
					spaceId: input.spaceId,
					timeoutMs: SPACE_WAKE_PROGRESS_TIMEOUT_MS,
				});
				if (!response.ok) {
					throw new Error(response.message);
				}
			} catch (error) {
				const failure = toStructuredApiClientFailure(error);
				throw new Error(failure.message);
			}

			activeWakeProgressSummaryQuery.refetch().catch((error) => {
				console.warn("[openmeld.web.space.agent_interaction_refresh_failed]", {
					error: error instanceof Error ? error.message : String(error),
					interactionId: body.interactionId,
					spaceId: input.spaceId,
				});
			});
		},
		[activeWakeProgressSummaryQuery.refetch, input.profileId, input.spaceId]
	);
	const timelinePresentationEnvelopes = useMemo(
		() =>
			mergePersistedAndPendingOutgoingSignals({
				persisted: timelineEnvelopes,
				pending: pendingOutgoingSignals,
			}),
		[timelineEnvelopes, pendingOutgoingSignals]
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
				agentStreams: agentStreamProjections,
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
	if (
		shouldShowSpaceLandingLoading({
			bootstrapPending: bootstrapQuery.isPending,
			currentStatusConfirmationPending,
			hasDisplayStatus: statusSnapshot !== null,
		})
	) {
		return {
			composerAddressingTargets: mentionAuthoring.addressingTargets,
			composerAuthoredMentions: mentionAuthoring.authoredMentions,
			composerMentionPickerItems: mentionAuthoring.mentionPickerItems,
			composerText: mentionAuthoring.composerText,
			mode: "loading",
			onComposerBlur: () => {
				restoreColdLoadingComposerFocusRef.current = false;
			},
			onComposerEditorChange: composerSession.onEditorChange,
			onComposerFocus: () => {
				restoreColdLoadingComposerFocusRef.current = true;
			},
			textareaRef: mentionAuthoring.textareaRef,
		};
	}

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

	if (!statusSnapshot) {
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
		membersSnapshot,
	});

	return {
		activeThread: threadController.activeThread,
		agentStreams: agentStreamProjections,
		composerAddressingTargets: mentionAuthoring.addressingTargets,
		composerAuthoredMentions: mentionAuthoring.authoredMentions,
		composerMentionPickerItems: mentionAuthoring.mentionPickerItems,
		composerFiles: composerFilesController.files,
		composerFileLimitReached: composerFilesController.isAtLimit,
		composerErrorMessage,
		composerBlockedWakeProfileId,
		composerHasAuthoredMentions: mentionAuthoring.hasAuthoredMentions,
		composerReplyToSignalId: mentionAuthoring.replyTo?.signalId ?? null,
		composerText: mentionAuthoring.composerText,
		ephemeralActivityItems: presentedWakeProgressItems,
		presentedWakeProgressItems,
		hasEarlierHistory,
		historyActionErrorMessage,
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
		isLoadingEarlierHistory,
		isAgentRecoveryPending,
		isMembersLoading: membersLoading,
		isMembersRefreshing: membersQuery.isFetching && !membersQuery.isPending,
		isCurrentAccessConfirmed: statusReady,
		currentProfileMembershipState,
		isSendingMessage,
		isDiagnosticReportPending,
		isDiagnosticReportSent,
		leaveSpaceErrorMessage,
		liveErrorMessage,
		liveState,
		onReconnectLiveUpdates: reconnectNow,
		membersError,
		membersSnapshot,
		presentationMembersSnapshot,
		mode: "ready",
		onComposerEditorChange: composerSession.onEditorChange,
		onClearComposerReplyTo: mentionAuthoring.onClearReplyTo,
		onAddComposerFiles: composerFilesController.addFiles,
		onRemoveComposerFile: composerFilesController.removeFile,
		onConversationViewingLatestChange: setIsConversationViewingLatest,
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
		onAddThreadComposerFiles: threadController.onAddThreadComposerFiles,
		onRemoveThreadComposerFile: threadController.onRemoveThreadComposerFile,
		onReplyToMessage: (item: SpaceTimelineItem) => {
			mentionAuthoring.onReplyToSignal({
				signalId: item.id,
				wakeTargetProfileId:
					item.actorProfileKind === "agent" ? item.actorProfileId : null,
			});
		},
		onReportMessage: handleReportMessage,
		onRecoverExecution: handleRecoverExecution,
		onRetryWakeTarget: handleRetryWakeTarget,
		onAgentInteractionResponse: handleAgentInteractionResponse,
		onWakeStopRequest: handleWakeStopRequest,
		onUpdateAgentProfileBinding: handleUpdateAgentProfileBinding,
		onSend: sendMessage,
		onSendText: sendTextMessage,
		profileId: input.profileId,
		spaceId: input.spaceId,
		status: statusSnapshot,
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
		threadComposerFiles: threadController.threadComposerFiles,
		threadComposerFileLimitReached:
			threadController.threadComposerFileLimitReached,
		threadFilePreviewUrlsById: threadController.threadFilePreviewUrlsById,
		threadEphemeralActivityItems: threadController.threadEphemeralActivityItems,
		threads: threadController.threads,
		threadPreviews: threadController.threadPreviews,
		threadSignals: threadController.threadSignals,
		threadsErrorMessage: threadController.threadsErrorMessage,
		threadSignalsErrorMessage: threadController.threadSignalsErrorMessage,
		threadsIsLoading: threadController.threadsIsLoading,
		threadSignalsIsLoading: threadController.threadSignalsIsLoading,
		threadUnreadFocus:
			threadUnreadFocus?.spaceId === input.spaceId
				? {
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
		unreadCount: unreadState.count,
		unreadStateReady: unreadState.isReady,
		wakeStopRequestStatusBySelectorKey,
	};

	async function sendMessage(options?: {
		pendingMessage?: PendingSpaceMessage;
		throwOnFailure?: boolean;
	}) {
		if (
			!canStartSpaceComposerSend({
				allowedToPost:
					currentProfileIsActiveSpaceMember &&
					statusSnapshot?.allowedActions.includes("post_message") === true,
				isInFlight: composerSendInFlightRef.current,
				statusReady,
			})
		) {
			return;
		}
		const sendAttempt = prepareSpaceMessageSendAttempt({
			composerFiles: composerFilesController.files,
			composerText: mentionAuthoring.composerText,
			pendingMessage: options?.pendingMessage,
		});
		if (sendAttempt.status !== "ready") {
			setComposerErrorMessage(sendAttempt.errorMessage);
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
		const { messageSeed } = sendAttempt;

		composerSession.send.begin();

		let postedMessage = false;
		let hasPublishedFiles = false;
		let publishedLocalIds: readonly string[] = [];
		let pendingSubmission: PendingComposerSubmission | null = null;
		try {
			const missingMembersMessage =
				"OpenMeld couldn't load the current space members right now. Wait for members to finish loading before using @ mentions.";
			const preparedSubmission = prepareMainComposerSubmission({
				mentionAuthoring,
				messageSeed,
				missingMembersMessage,
				pendingMessage: options?.pendingMessage,
			});
			pendingSubmission = preparedSubmission;
			await requireCurrentSpaceComposerWakeAdmission({
				agentProfileIds: resolveComposerWakeProgressTargetProfileIds({
					explicitActivationTargets:
						preparedSubmission.messageEnvelope?.activationTargets ?? [],
					membersSnapshot,
					senderProfileId: input.profileId,
					status: statusSnapshot,
				}),
				readCurrentMembers: readCurrentMembersForWakeAdmission,
			});
			const publishedFiles = options?.pendingMessage
				? {
						messageFiles: [] as SpaceMessageFileReference[],
						previewUrlsByFileId: new Map<string, string>(),
						publishedLocalIds: [] as string[],
					}
				: await composerFilesController.publishReadyFiles();
			hasPublishedFiles = publishedFiles.messageFiles.length > 0;
			publishedLocalIds = publishedFiles.publishedLocalIds;
			if (
				hasNoPublishedComposerContent({
					files: publishedFiles.messageFiles,
					text: messageSeed.text,
				})
			) {
				setComposerErrorMessage(
					"None of the files could be sent. Add them again or enter a message."
				);
				return;
			}
			mentionAuthoring.recordPendingSubmission();
			await sendPreparedSpaceMessage({
				files: publishedFiles.messageFiles,
				filePreviewUrlsById: publishedFiles.previewUrlsByFileId,
				clientMessageId: messageSeed.clientMessageId,
				createdAtMs: messageSeed.createdAtMs,
				preparedSubmission,
			});
			postedMessage = true;
			mentionAuthoring.recordSuccessfulSubmission(preparedSubmission);
			clearManualComposerFiles({
				clearFiles: composerFilesController.clearFiles,
				isPendingMessage: options?.pendingMessage !== undefined,
			});
			setComposerBlockedWakeProfileId(null);
			await Promise.all([membersQuery.refetch(), statusQuery.refetch()]);
		} catch (error) {
			const sendError =
				error instanceof PreparedSpaceMessageSendError ? error : null;
			postedMessage ||= sendError?.postedMessage ?? false;
			const originalError = sendError?.originalError ?? error;
			settleSpaceComposerSendFailure({
				clearFiles: composerFilesController.clearFiles,
				clientMessageId: messageSeed.clientMessageId,
				consumePublishedFiles: composerFilesController.consumePublishedFiles,
				hasPublishedFiles,
				isPendingMessage: options?.pendingMessage !== undefined,
				mentionAuthoring,
				outcomeUnknown: sendError?.outcomeUnknown ?? false,
				pendingSubmission,
				publishedLocalIds,
				postedMessage,
				setPendingSignals: setPendingOutgoingSignals,
			});
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
		} finally {
			composerSession.send.finish();
		}
	}

	async function readCurrentMembersForWakeAdmission(): Promise<SpaceMembersSnapshot> {
		const currentMembersSnapshot = await readSpaceMembers({
			openMeldProfileId: input.profileId,
			spaceId: input.spaceId,
		});
		queryClient.setQueryData(
			spaceQueryKeys.members(input.spaceId, input.profileId),
			currentMembersSnapshot
		);
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

	async function sendPreparedSpaceMessage(sendInput: {
		files: readonly SpaceMessageFileReference[];
		filePreviewUrlsById: ReadonlyMap<string, string>;
		clientMessageId: string;
		createdAtMs: number;
		preparedSubmission: PreparedSpaceMessageSubmission;
	}): Promise<void> {
		let postedMessage = false;
		try {
			const explicitActivationTargets =
				sendInput.preparedSubmission.messageEnvelope?.activationTargets ?? [];
			const wakeProgressTargetProfileIds =
				resolveComposerWakeProgressTargetProfileIds({
					explicitActivationTargets,
					membersSnapshot,
					senderProfileId: input.profileId,
					status: statusSnapshot,
				});
			const pendingMessageEnvelope =
				sendInput.preparedSubmission.messageEnvelope ??
				(wakeProgressTargetProfileIds.length > 0
					? {
							activationTargets: wakeProgressTargetProfileIds,
							referenceTargets: [],
							text: sendInput.preparedSubmission.text,
						}
					: null);
			const pendingOutgoingSignal = createPendingOutgoingSignal({
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

			const spaceApi = createOrganizationScopedWebSpaceApi({
				organizationSlug: input.orgSlug,
				openMeldProfileId: input.profileId,
			});
			const postInput = buildNormalMessagePostInput({
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

	async function handleRetryWakeTarget(
		retryInput: ProgrammaticWakeRetryInput
	): Promise<void> {
		const isThreadRetry = retryInput.threadContext !== undefined;
		if (!isThreadRetry) {
			setIsSendingMessage(true);
		}
		let postedMessage = false;
		try {
			// The Retry control creates one clientMessageId per logical attempt and
			// keeps it across outcome-unknown redrives. A definite failure clears
			// that identity before the control offers a new attempt.
			if (isThreadRetry) {
				await threadController.onRetryWakeTarget(retryInput);
			} else {
				await requireCurrentSpaceComposerWakeAdmission({
					agentProfileIds: [retryInput.targetProfileId],
					readCurrentMembers: readCurrentMembersForWakeAdmission,
				});
				await sendPreparedSpaceMessage({
					files: [],
					filePreviewUrlsById: new Map<string, string>(),
					clientMessageId: retryInput.clientMessageId,
					createdAtMs: Date.now(),
					preparedSubmission:
						prepareProgrammaticWakeRetrySubmission(retryInput),
				});
			}
			postedMessage = true;
			if (!isThreadRetry) {
				await Promise.all([membersQuery.refetch(), statusQuery.refetch()]);
			}
			toast.success("Retried");
		} catch (error) {
			const sendError =
				error instanceof PreparedSpaceMessageSendError ? error : null;
			const originalError = sendError?.originalError ?? error;
			const failure = toStructuredApiClientFailure(originalError);
			postedMessage ||= sendError?.postedMessage ?? false;
			if (postedMessage) {
				console.error(
					"The retried Wake was posted, but a follow-up refresh failed.",
					failure
				);
				toast.success("Retried");
				return;
			}
			if (sendError?.outcomeUnknown) {
				console.warn("[openmeld.web.space.wake_retry_outcome_unknown]", {
					clientMessageId: retryInput.clientMessageId,
					code: failure.code,
					spaceId: input.spaceId,
				});
				toast.warning(resolveSpaceComposerSendErrorMessage(failure));
				throw originalError;
			}
			toast.error(`Couldn't retry this Wake. ${failure.message}`);
			if (isProtectedSpaceFailure(failure)) {
				await statusQuery.refetch();
			}
			throw originalError;
		} finally {
			if (!isThreadRetry) {
				setIsSendingMessage(false);
			}
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

		try {
			const response = await createUnscopedWebSpaceApi({
				openMeldProfileId: input.profileId,
			}).leaveSpace({
				spaceId: input.spaceId,
			});
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

			await Promise.all([
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
			toast.success("You left this Space.");
			await navigate({
				to: buildOrganizationSpacesPath(input.orgSlug),
				replace: true,
			});
		} catch (error) {
			const failure = toStructuredApiClientFailure(error);
			setLeaveSpaceErrorMessage(resolveLeaveSpaceErrorMessage(failure));
		} finally {
			setIsLeavingSpace(false);
		}
	}

	async function handleSetAccessMode(nextAccess: {
		accessMode: SpaceAccessMode;
		password?: string;
	}) {
		setIsAccessModePending(true);
		setAccessModeErrorMessage(null);

		try {
			await createUnscopedWebSpaceApi({
				openMeldProfileId: input.profileId,
			}).setAccessMode({
				spaceId: input.spaceId,
				accessMode: nextAccess.accessMode,
				...(nextAccess.password === undefined
					? {}
					: { password: nextAccess.password }),
			});

			await Promise.all([
				statusQuery.refetch(),
				queryClient.invalidateQueries({
					queryKey: accountSpaceQueryKeys.all,
				}),
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

		try {
			await createUnscopedWebSpaceApi({
				openMeldProfileId: input.profileId,
			}).deleteSpace({
				spaceId: input.spaceId,
			});

			try {
				await removeDeletedSpaceFromAccountHistory({
					currentProfileId: input.profileId,
					reason: "deleted_space",
					spaceId: input.spaceId,
				});
			} catch (error) {
				toast.warning(
					error instanceof Error
						? `Space deleted, but OpenMeld could not update your sidebar history. ${error.message}`
						: "Space deleted, but OpenMeld could not update your sidebar history."
				);
			}

			await Promise.all([
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
			await navigate({
				to: buildOrganizationSpacesPath(input.orgSlug),
				replace: true,
			});
		} catch (error) {
			const failure = toStructuredApiClientFailure(error);
			setDeleteSpaceErrorMessage(resolveDeleteSpaceErrorMessage(failure));
		} finally {
			setIsDeletingSpace(false);
		}
	}

	async function handleLoadEarlierHistory() {
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
			mergePersistedIncoming(history.envelopes);
			return getEarliestVisibleTimelineSignalId(history.envelopes);
		} catch (error) {
			const failure = toStructuredApiClientFailure(error);
			setHistoryActionErrorMessage(failure.message);
			throw failure;
		}
	}
}

function useSpaceThreadController(input: {
	isMembersLoading: boolean;
	initialThreads: ListSpaceThreadsResponse | null;
	membersErrorMessage: string | null;
	membersRefetch: () => Promise<unknown>;
	membersSnapshot: SpaceMembersSnapshot | null;
	onWakeProgressItems: (items: readonly WakeProgressItem[]) => void;
	onWakeProgressRemoveClientMessageId: (clientMessageId: string) => void;
	readCurrentMembers: () => Promise<SpaceMembersSnapshot | null>;
	organizationSlug: string;
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
	const [wakeProgressItems, setWakeProgressItems] = useState<
		WakeProgressItem[]
	>([]);
	const [pendingOutgoingSignals, setPendingOutgoingSignals] = useState<
		PendingOutgoingSignal[]
	>([]);
	const threadsQuery = useQuery(
		spaceThreadsQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
			enabled: input.statusReady && input.threadsEnabled,
		})
	);
	const threadsSnapshot = threadsQuery.data ?? input.initialThreads;
	const threads = threadsSnapshot?.threads ?? [];
	const threadPreviews = threadsSnapshot?.previews ?? [];
	const availableThreadIds = useMemo(
		() => new Set(threads.map((thread) => thread.threadId)),
		[threads]
	);
	const threadPanelSelection = useSpaceThreadPanelSelection({
		availableThreadIds,
		availableThreadsReady: threadsQuery.isSuccess,
		profileId: input.profileId,
		spaceId: input.spaceId,
	});
	const activeThreadId = threadPanelSelection.activeThreadId;
	const threadSignalsQuery = useQuery(
		spaceThreadSignalsQueryOptions({
			spaceId: input.spaceId,
			threadId: activeThreadId,
			openMeldProfileId: input.profileId,
			enabled: input.statusReady && activeThreadId !== null,
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
	const {
		inFlightRef: threadComposerSendInFlightRef,
		isSending: isSendingMessage,
		setIsSending: setIsSendingMessage,
	} = composerSession.send;
	const activeThread =
		threads.find((thread) => thread.threadId === activeThreadId) ?? null;
	const persistedThreadSignals = threadSignalsQuery.data?.signals ?? [];
	const threadSignals = mergePersistedAndPendingOutgoingSignals({
		persisted: persistedThreadSignals,
		pending: pendingOutgoingSignals,
	});
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
		composerSession.send.finish();
		setWakeProgressItems([]);
		setPendingOutgoingSignals([]);
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
		isCreatingThread,
		isSendingThreadMessage: isSendingMessage,
		onCloseThread: closeThread,
		onCreateThread: createThread,
		onOpenUnreadThread: openUnreadThread,
		onOpenThread: openThread,
		onRetryWakeTarget: retryWakeTarget,
		onThreadComposerEditorChange: composerSession.onEditorChange,
		onThreadMentionButtonClick: mentionAuthoring.onMentionButtonClick,
		onThreadSend: sendMessage,
		onThreadSendText: sendTextMessage,
		onAddThreadComposerFiles: composerFilesController.addFiles,
		onRemoveThreadComposerFile: composerFilesController.removeFile,
		threadComposerBlockedWakeProfileId: composerBlockedWakeProfileId,
		threadComposerAddressingTargets: mentionAuthoring.addressingTargets,
		threadComposerAuthoredMentions: mentionAuthoring.authoredMentions,
		threadComposerMentionPickerItems: mentionAuthoring.mentionPickerItems,
		threadComposerErrorMessage: composerErrorMessage,
		threadComposerHasAuthoredMentions: mentionAuthoring.hasAuthoredMentions,
		threadComposerText: mentionAuthoring.composerText,
		threadComposerFiles: composerFilesController.files,
		threadComposerFileLimitReached: composerFilesController.isAtLimit,
		threadFilePreviewUrlsById,
		threadEphemeralActivityItems: wakeProgressItems,
		threadPreviews,
		threadSignals,
		threadSignalsError: threadSignalsQuery.error,
		threadSignalsErrorMessage: threadSignalsQuery.isError
			? threadSignalsQuery.error.message
			: null,
		threadSignalsIsLoading: threadSignalsQuery.isPending,
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
		threadPanelSelection.close();
		composerSession.feedback.clear();
		setPendingOutgoingSignals([]);
		composerFilesController.clearFiles();
	}

	function openThread(threadId: string) {
		threadPanelSelection.open(threadId);
		composerSession.feedback.clear();
		setPendingOutgoingSignals([]);
		composerFilesController.clearFiles();
	}

	async function openUnreadThread(threadInput: {
		rootSignalId: string;
		threadId?: string;
	}): Promise<boolean> {
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

		openThread(threadId);
		return true;
	}

	async function createThread(threadInput: { rootSignalId: string }) {
		setIsCreatingThread(true);
		setComposerErrorMessage(null);

		try {
			const response = await createUnscopedWebSpaceApi({
				openMeldProfileId: input.profileId,
			}).createThread({
				spaceId: input.spaceId,
				rootSignalId: threadInput.rootSignalId,
				clientMutationId: createClientMessageId(),
			});
			openThread(response.thread.threadId);
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
			setComposerErrorMessage(failure.message);
			toast.error(`OpenMeld could not start the thread. ${failure.message}`);
		} finally {
			setIsCreatingThread(false);
		}
	}

	async function sendMessage() {
		if (threadComposerSendInFlightRef.current || !input.statusReady) {
			return;
		}
		const thread = activeThread;
		const trimmedText = mentionAuthoring.composerText.trim();
		const fileSubmission = buildComposerFileSubmission({
			files: composerFilesController.files,
			isPendingMessage: false,
		});
		const blockedReason = resolveThreadComposerBlockedReason({
			hasActiveThread: thread !== null,
			hasReadyFiles: fileSubmission.hasReadyFiles,
			text: trimmedText,
			uploadInProgress: fileSubmission.uploadInProgress,
		});
		if (blockedReason) {
			setComposerErrorMessage(blockedReason);
			return;
		}
		if (!thread) {
			return;
		}

		composerSession.send.begin();

		let pendingSubmission: PendingComposerSubmission | null = null;
		let publishedLocalIds: readonly string[] = [];
		try {
			const preparedSubmission =
				trimmedText.length > 0
					? mentionAuthoring.prepareSubmission(
							"OpenMeld couldn't load the current space members right now. Wait for members to finish loading before using @ mentions."
						)
					: mentionAuthoring.prepareFileOnlySubmission();
			pendingSubmission = preparedSubmission;
			await requireCurrentSpaceComposerWakeAdmission({
				agentProfileIds: resolveComposerWakeProgressTargetProfileIds({
					explicitActivationTargets:
						preparedSubmission.messageEnvelope?.activationTargets ?? [],
					membersSnapshot: input.membersSnapshot,
					senderProfileId: input.profileId,
					status: input.status,
				}),
				readCurrentMembers: input.readCurrentMembers,
			});
			const publishedFiles = await composerFilesController.publishReadyFiles();
			publishedLocalIds = publishedFiles.publishedLocalIds;
			if (
				trimmedText.length === 0 &&
				publishedFiles.messageFiles.length === 0
			) {
				setComposerErrorMessage(
					"None of the files could be sent. Add them again or enter a reply."
				);
				return;
			}
			mentionAuthoring.recordPendingSubmission();
			await sendPreparedThreadMessage({
				files: publishedFiles.messageFiles,
				filePreviewUrlsById: publishedFiles.previewUrlsByFileId,
				onPosted: () => {
					mentionAuthoring.recordSuccessfulSubmission(preparedSubmission);
					composerFilesController.clearFiles();
					setComposerBlockedWakeProfileId(null);
				},
				preparedSubmission,
				thread,
			});
		} catch (error) {
			await handleSendMessageFailure({
				error,
				pendingSubmission,
				publishedLocalIds,
			});
		} finally {
			composerSession.send.finish();
		}
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
				composerFilesController.clearFiles();
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
				"OpenMeld couldn't load the current space members right now. Wait for members to finish loading before continuing."
			);
			await requireCurrentSpaceComposerWakeAdmission({
				agentProfileIds: resolveComposerWakeProgressTargetProfileIds({
					explicitActivationTargets:
						preparedSubmission.messageEnvelope?.activationTargets ?? [],
					membersSnapshot: input.membersSnapshot,
					senderProfileId: input.profileId,
					status: input.status,
				}),
				readCurrentMembers: input.readCurrentMembers,
			});
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

	async function retryWakeTarget(
		retryInput: ProgrammaticWakeRetryInput
	): Promise<void> {
		const thread = activeThread;
		const threadContext = retryInput.threadContext;
		if (
			!(thread && threadContext) ||
			thread.threadId !== threadContext.threadId ||
			thread.rootSignalId !== threadContext.rootSignalId
		) {
			throw new Error(
				"The originating thread changed before this Wake could be retried."
			);
		}

		setIsSendingMessage(true);
		try {
			await requireCurrentSpaceComposerWakeAdmission({
				agentProfileIds: [retryInput.targetProfileId],
				readCurrentMembers: input.readCurrentMembers,
			});
			await sendPreparedThreadMessage({
				clientMessageId: retryInput.clientMessageId,
				preparedSubmission: prepareProgrammaticWakeRetrySubmission(retryInput),
				thread,
			});
		} finally {
			setIsSendingMessage(false);
		}
	}

	async function sendPreparedThreadMessage(sendInput: {
		clientMessageId?: string;
		files?: readonly SpaceMessageFileReference[];
		filePreviewUrlsById?: ReadonlyMap<string, string>;
		onPosted?: () => void;
		preparedSubmission: PreparedSpaceMessageSubmission;
		thread: SpaceThread;
	}): Promise<void> {
		const clientMessageId =
			sendInput.clientMessageId ?? createClientMessageId();
		const messageCreatedAtMs = Date.now();
		const activationTargets =
			sendInput.preparedSubmission.messageEnvelope?.activationTargets ?? [];
		appendPendingOutgoingSignal(
			setPendingOutgoingSignals,
			createPendingOutgoingSignal({
				clientMessageId,
				createdAtMs: messageCreatedAtMs,
				files: sendInput.files,
				filePreviewUrlsById: sendInput.filePreviewUrlsById,
				membersSnapshot: input.membersSnapshot,
				messageEnvelope: sendInput.preparedSubmission.messageEnvelope,
				profileId: input.profileId,
				spaceId: input.spaceId,
				text: sendInput.preparedSubmission.text,
			})
		);
		const sendingWakeProgressItems = buildLocalWakeProgressItems({
			activationTargets,
			clientMessageId,
			membersSnapshot: input.membersSnapshot,
			phase: "sending",
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
		try {
			const postInput = {
				body: {
					clientMessageId,
					...(sendInput.files?.length ? { files: [...sendInput.files] } : {}),
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
			const response = await runSpaceComposerIdempotentRequestWithRetry(
				async () =>
					await createUnscopedWebSpaceApi({
						openMeldProfileId: input.profileId,
					}).postThreadSignal(postInput)
			);
			postedMessage = true;
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
			sendInput.onPosted?.();
			await Promise.all([
				threadSignalsQuery.refetch(),
				threadsQuery.refetch(),
				input.membersRefetch(),
				input.statusRefetch(),
			]);
		} catch (error) {
			const outcomeUnknown = isSpaceComposerSendOutcomeUnknown(
				toStructuredApiClientFailure(error)
			);
			if (!(postedMessage || outcomeUnknown)) {
				setWakeProgressItems((currentItems) =>
					removeWakeProgressItemsForClientMessageId({
						clientMessageId,
						items: currentItems,
					})
				);
				input.onWakeProgressRemoveClientMessageId(clientMessageId);
			}
			throw new PreparedSpaceMessageSendError({
				clientMessageId,
				originalError: error,
				outcomeUnknown,
				postedMessage,
			});
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
		setItems((currentItems) => {
			const nextItems = applyWakeProgressSignals({
				currentItems,
				signals,
			});
			return areWakeProgressItemsEqual(currentItems, nextItems)
				? currentItems
				: nextItems;
		});
	}, [setItems, signals]);

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
		const schedulePoll = () => {
			const delayMs = resolveWakeProgressPollDelayMs({
				attemptCounts: pendingClientMessageIds.map(
					(clientMessageId) => pollAttemptsRef.current.get(clientMessageId) ?? 0
				),
			});
			timeoutId = window.setTimeout(() => {
				pollWakeProgress({
					openMeldProfileId: profileId,
					clientMessageIds: pendingClientMessageIds,
					onItems: (items, fulfilledClientMessageIds) => {
						if (cancelled) {
							return;
						}
						const visibleItems = filterVisibleWakeProgressItems({ items });
						setItems((currentItems) =>
							reconcilePolledWakeProgressItems({
								currentItems,
								fulfilledClientMessageIds,
								incomingItems: visibleItems,
								signals,
							})
						);
					},
					onSettled: () => {
						if (cancelled) {
							return;
						}
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
			if (timeoutId !== null) {
				window.clearTimeout(timeoutId);
			}
		};
	}, [enabled, items, logEventName, profileId, setItems, signals, spaceId]);
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
					includeTiming: true,
					includeWaitReason: true,
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
