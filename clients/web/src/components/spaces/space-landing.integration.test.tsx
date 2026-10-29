import { resolveAgentWakeAvailability } from "@openmeld/agent-runtime";
import {
	createFetchTransport,
	createOpenMeldApiClient,
	createSpaceApi,
	OpenMeldApiClientHttpError,
	readOrUpdateSpaceInputQueue,
} from "@openmeld/api-client";
import { SPACE_STREAM_KEEPALIVE_PING } from "@openmeld/protocol";
import {
	type AccountSidebarSnapshot,
	AGENT_REPLY_FINAL_PURPOSE,
	AGENT_REPLYING_PURPOSE,
	CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
	CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
	createDaemonRouteObservationSummary,
	DISPATCH_ACTIVITY_DISPATCHING_PURPOSE,
	DISPATCH_ACTIVITY_FAILED_PURPOSE,
	listMemberAgentsResponseSchema,
	listPermissionModeSuggestionsResponseSchema,
	listPluginActionRequestsResponseSchema,
} from "@openmeld/schemas";
import { createSpaceMemberAgentExecutionReadiness } from "@openmeld/schemas/testing";
import type {
	AgentProfileCreationRequest,
	AuthProfileView,
	CreateAgentProfileCreationRequestResponse,
	CreateSpaceThreadResponse,
	GetSpaceStatusResponse,
	ListSpaceFilesResponse,
	ListSpaceTasksResponse,
	OrganizationAgentRuntimeOverviewResponse,
	OrganizationDirectoryResponse,
	SignalEnvelope,
	SpaceAgentStreamSnapshot,
	SpaceMemberAgentSnapshot,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
	createWakeProgressItem,
	OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
} from "@openmeld/space";
import { QueryClient } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const JORDAN_OPTION_NAME = /Jordan/;

// These submission tests start with an empty draft store; browser reload
// persistence is outside this component/API integration boundary.
const composerDraftRead = vi.hoisted(() => ({
	error: null as Error | null,
	task: null as Promise<[]> | null,
}));
const composerDiscoveryWait = vi.hoisted(() => ({
	task: null as Promise<void> | null,
	onEntered: null as (() => void) | null,
}));
const wakeProgressFixture = vi.hoisted(() => ({
	presentationEpoch: null as string | null,
}));
vi.mock("#/lib/spaces/composer-file-drafts", () => ({
	isComposerFileDraftRetired: () => false,
	readComposerFileDraftCleanup: () => [],
	retryComposerFileDraftCleanup: async () => undefined,
	subscribeComposerFileDrafts: () => () => undefined,
	readComposerFileDrafts: () => {
		if (composerDraftRead.task) {
			return composerDraftRead.task;
		}
		if (composerDraftRead.error) {
			return Promise.reject(composerDraftRead.error);
		}
		return Promise.resolve([]);
	},
	readComposerFileDraftsByIds: async () => [],
	removeComposerFileDraft: async () => undefined,
	saveComposerFileDraft: async () => undefined,
	saveComposerFileDraftUpload: async () => undefined,
}));
vi.mock("./use-space-composer-session", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("./use-space-composer-session")>();
	return {
		...actual,
		useSpaceComposerSession: (
			input: Parameters<typeof actual.useSpaceComposerSession>[0]
		) => {
			const session = actual.useSpaceComposerSession(input);
			return {
				...session,
				files: {
					...session.files,
					waitForDiscovery: async () => {
						await session.files.waitForDiscovery();
						if (composerDiscoveryWait.task) {
							composerDiscoveryWait.onEntered?.();
							await composerDiscoveryWait.task;
						}
					},
				},
			};
		},
	};
});

import { AppOrganizationProvider } from "#/lib/organizations/organization-context";
import type { OrganizationScopeAuthorized } from "#/lib/organizations/organization-types";
import type { AccountSpaceSections } from "#/lib/spaces/account-spaces";
import type { OrganizationSpaceProfileCandidates } from "#/query/organizations/organization-directory";
import { setSpaceWakeProgressPresentationItems } from "#/query/spaces/active-wake-progress";
import { createSpaceConversationDisplaySnapshot } from "#/query/spaces/display-snapshot";
import { SpaceEntryConfirmationContext } from "./space-entry-confirmation";
import {
	SpaceWakeProgressVisibleProjectionProvider,
	useSpaceWakeProgressVisibleProjection,
} from "./space-wake-progress-visible-projection";
import { SPACE_WAKE_STATUS_AUTO_REFRESH_ATTEMPTS } from "./space-wake-status-refresh";

type WebCreateAgentProfileCreationRequestInput = Parameters<
	typeof import("#/lib/profiles/agent-profile-creation-requests").createAgentProfileCreationRequest
>[0];

type SpaceMemberAgentAgentWakeAvailability = NonNullable<
	SpaceMemberAgentSnapshot["agentWakeAvailability"]
>;

function createHangingFetchRequest() {
	let timeoutController: AbortController | null = null;
	const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
		timeoutController = new AbortController();
		return timeoutController.signal;
	});
	const fetchMock = vi.fn((_resource, init) => {
		return new Promise<Response>((_resolve, reject) => {
			const signal = init?.signal;
			if (!signal) {
				return;
			}
			const rejectForAbort = () => {
				reject(signal.reason ?? new DOMException("aborted", "AbortError"));
			};
			if (signal.aborted) {
				rejectForAbort();
				return;
			}
			signal.addEventListener("abort", rejectForAbort, { once: true });
		});
	});
	const transport = createFetchTransport({
		fetch: fetchMock as typeof globalThis.fetch,
	});

	return {
		abortForTimeout: () => {
			timeoutController?.abort(new DOMException("timed out", "TimeoutError"));
		},
		fetchMock,
		request: async (input: { operation: string; timeoutMs?: number }) =>
			await transport({
				operation: input.operation,
				timeoutMs: input.timeoutMs ?? 1,
				url: "https://gateway.openmeld.invalid/v1/spaces/space-123/signals",
			}),
		timeoutSpy,
	};
}

function createUnavailableExecutionRecovery(input: {
	dispatchId: string;
	targetProfileId: string;
}) {
	return {
		actions: {
			recoverResult: {
				action: "recover_result" as const,
				enabled: false,
				label: "Recover result" as const,
				reasonCode: "execution_recovery.unavailable",
				warning: null,
			},
			resumeControllerConversation: {
				action: "resume_controller_conversation" as const,
				enabled: false,
				label: "Recover reply" as const,
				reasonCode: "execution_recovery.unavailable",
				warning: null,
			},
			retryAsNewExecution: {
				action: "retry_as_new_execution" as const,
				enabled: false,
				label: "Retry as new execution" as const,
				reasonCode: "execution_recovery.unavailable",
				warning: null,
			},
		},
		destination: {
			spaceId: "space-123",
			surface: "space" as const,
			threadId: null,
		},
		identity: {
			agentControllerConversationId: null,
			agentControllerRef: null,
			attemptId: null,
			dispatchId: input.dispatchId,
			resultRef: null,
			runtimeCoordinatorExecutionId: null,
			spaceId: "space-123",
			targetProfileId: input.targetProfileId,
			taskId: null,
		},
		recommendedAction: null,
		recoveredPublicationId: null,
		status: "unavailable" as const,
		tier: "none" as const,
		updatedAtMs: RECENT_ACTIVITY_TS,
	};
}

function createLegacyFreshExecutionRecovery(input: {
	dispatchId: string;
	targetProfileId: string;
}) {
	const unavailable = createUnavailableExecutionRecovery(input);
	return {
		...unavailable,
		actions: {
			...unavailable.actions,
			retryAsNewExecution: {
				action: "retry_as_new_execution" as const,
				enabled: true,
				label: "Retry as new execution" as const,
				reasonCode: "execution_recovery.available",
				warning:
					"This starts a new execution and may run the task and its side effects again.",
			},
		},
		recommendedAction: "retry_as_new_execution" as const,
		status: "available" as const,
		tier: "fresh_execution" as const,
	};
}

const {
	createDirectMessageApiMock,
	createWebSpaceApiMock,
	prepareSpaceImageAttachmentMock,
	ensureWebAgentProfileRuntimeBindingMock,
	rememberProtectedSpaceAccessMock,
	updateProfileSpaceHistoryStatusMock,
	upsertProfileSpaceHistoryMock,
	useQueryMock,
	useQueryClientMock,
	useNavigateMock,
	useLocalAgentRecoveryControllerMock,
	listStartProfilesMock,
	createAgentProfileCreationRequestMock,
	createStartHumanProfileMock,
	notifyAgentExecutionReadinessRefreshMock,
	readSpaceMembersMock,
	threadProgrammaticSendHarness,
	toastMock,
	useAccountAvatarMock,
	clearSpaceConversationCacheMock,
} = vi.hoisted(() => ({
	createDirectMessageApiMock: vi.fn(),
	useQueryMock: vi.fn(),
	useQueryClientMock: vi.fn(),
	useNavigateMock: vi.fn(),
	createWebSpaceApiMock: vi.fn(),
	prepareSpaceImageAttachmentMock: vi.fn(),
	ensureWebAgentProfileRuntimeBindingMock: vi.fn(),
	rememberProtectedSpaceAccessMock: vi.fn(),
	updateProfileSpaceHistoryStatusMock: vi.fn(),
	upsertProfileSpaceHistoryMock: vi.fn(),
	useLocalAgentRecoveryControllerMock: vi.fn(),
	listStartProfilesMock: vi.fn(),
	createAgentProfileCreationRequestMock: vi.fn(),
	createStartHumanProfileMock: vi.fn(),
	notifyAgentExecutionReadinessRefreshMock: vi.fn(),
	readSpaceMembersMock: vi.fn(),
	threadProgrammaticSendHarness: {
		enabled: false,
		text: "Programmatic thread message",
	},
	useAccountAvatarMock: vi.fn(),
	clearSpaceConversationCacheMock: vi.fn(async () => undefined),
	toastMock: Object.assign(vi.fn(), {
		error: vi.fn(),
		success: vi.fn(),
		warning: vi.fn(),
	}),
}));

vi.mock("#/query/persistence/app-query-persistence", () => ({
	resolveAppQueryPersistenceController: () => ({
		activateSpaceConversation: vi.fn(async () => undefined),
		clearSpaceConversation: clearSpaceConversationCacheMock,
	}),
}));

vi.mock("@openmeld/api-client", async () => {
	const actual = await vi.importActual<typeof import("@openmeld/api-client")>(
		"@openmeld/api-client"
	);

	return {
		...actual,
		createDirectMessageApi: (...args: unknown[]) =>
			createDirectMessageApiMock(...args),
		readOrUpdateSpaceInputQueue: vi.fn(async () => ({ items: [] })),
	};
});

vi.mock("@tanstack/react-query", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
		"@tanstack/react-query"
	);
	const react = await vi.importActual<typeof import("react")>("react");
	const isWakeProgressPresentationQuery = (queryKey: unknown) =>
		Array.isArray(queryKey) &&
		queryKey[0] === "spaces" &&
		queryKey[1] === "wake-progress-presentation";
	// File previews must exercise the real enabled/queryFn contract against the
	// mocked download API, including the optimistic local-preview phase.
	const usesRealQuery = (queryKey: unknown) =>
		isWakeProgressPresentationQuery(queryKey) ||
		(Array.isArray(queryKey) && queryKey[0] === "space-input-queue") ||
		(Array.isArray(queryKey) && queryKey[0] === "space-link-previews") ||
		(Array.isArray(queryKey) &&
			queryKey[0] === "spaces" &&
			(queryKey[1] === "pending-outgoing" ||
				queryKey[1] === "composer-tray-display" ||
				queryKey[1] === "header-title-display" ||
				queryKey[1] === "viewer-membership-display" ||
				queryKey.includes("member-directory-display"))) ||
		(Array.isArray(queryKey) && queryKey[0] === "space-message-reactions") ||
		(Array.isArray(queryKey) &&
			queryKey[0] === "space-files" &&
			queryKey[2] === "content");

	return {
		...actual,
		useQuery: (options: { queryKey?: readonly unknown[] }) => {
			const useActualQuery = usesRealQuery(options.queryKey);
			const actualQuery = actual.useQuery(
				(useActualQuery
					? options
					: {
							enabled: false,
							queryFn: () => null,
							queryKey: ["test", "mocked-query", options.queryKey ?? null],
						}) as Parameters<typeof actual.useQuery>[0]
			);
			if (
				isWakeProgressPresentationQuery(options.queryKey) &&
				actualQuery.data &&
				typeof actualQuery.data === "object" &&
				"epoch" in actualQuery.data &&
				typeof actualQuery.data.epoch === "string"
			) {
				wakeProgressFixture.presentationEpoch = actualQuery.data.epoch;
			}
			const queryMock = useQueryMock;
			if (options.queryKey?.[0] === "message-notification-preferences") {
				return createQueryResult({ isPending: true });
			}
			if (options.queryKey?.[3] === "history-navigation") {
				return createQueryResult({
					isSuccess: true,
					data: { entries: [], total: 0 },
				});
			}
			if (
				options.queryKey?.[0] === "space-message-pins" ||
				options.queryKey?.[0] === "space-file-pins"
			) {
				return createQueryResult({ isSuccess: true, data: { pins: [] } });
			}
			return useActualQuery ? actualQuery : queryMock(options);
		},
		useQueryClient: () => {
			const actualQueryClient = actual.useQueryClient();
			const mockedQueryClient = useQueryClientMock();
			return react.useMemo(() => {
				if (mockedQueryClient === actualQueryClient) {
					return actualQueryClient;
				}
				const setActualQueryData = actualQueryClient.setQueryData.bind(
					actualQueryClient
				) as (queryKey: readonly unknown[], update: unknown) => unknown;
				return new Proxy(mockedQueryClient, {
					get(target, property, receiver) {
						if (property === "getQueryCache") {
							return actualQueryClient.getQueryCache.bind(actualQueryClient);
						}
						if (!(property in target)) {
							const actualValue = Reflect.get(actualQueryClient, property);
							return typeof actualValue === "function"
								? actualValue.bind(actualQueryClient)
								: actualValue;
						}
						if (property === "setQueryData") {
							return (queryKey: readonly unknown[], update: unknown) => {
								if (usesRealQuery(queryKey)) {
									return setActualQueryData(queryKey, update);
								}
								const mockedSetQueryData = Reflect.get(
									target,
									property,
									receiver
								);
								if (typeof mockedSetQueryData !== "function") {
									throw new TypeError(
										"Mocked QueryClient must implement setQueryData"
									);
								}
								return mockedSetQueryData.call(target, queryKey, update);
							};
						}
						const value = Reflect.get(target, property, receiver);
						return typeof value === "function" ? value.bind(target) : value;
					},
				});
			}, [actualQueryClient, mockedQueryClient]);
		},
	};
});

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
	useBlocker: () => ({ status: "unblocked" as const }),
	useElementScrollRestoration: () => undefined,
	useNavigate: () => useNavigateMock,
	useLocation: (options?: {
		select?: (location: { pathname: string }) => unknown;
	}) => {
		const location = { pathname: "/o/acme/spaces/space-123" };
		return options?.select ? options.select(location) : location;
	},
	useRouterState: (input: {
		select?: (state: { location: { pathname: string } }) => unknown;
	}) => {
		const state = { location: { pathname: "/o/acme/spaces/space-123" } };
		return input.select ? input.select(state) : state;
	},
}));

vi.mock("#/lib/spaces/api", () => {
	const createTestSpaceApi = (...args: unknown[]) => ({
		getActiveWakeProgress: async () => ({
			items: [],
			query: {
				spaceId: "space-123",
				targetProfileId: null,
			},
		}),
		getUpdates: async () => ({ signals: [] }),
		getWakeProgress: async () => ({
			items: [],
			query: {
				clientMessageId: "client-message-1",
				spaceId: "space-123",
				targetProfileId: null,
			},
		}),
		listSignalEnvelopes: async () => ({
			envelopes: [],
			nextCursor: null,
		}),
		listThreads: async () => ({ previews: [], threads: [] }),
		...createWebSpaceApiMock(...args),
	});
	return {
		createOrganizationScopedWebSpaceApi: createTestSpaceApi,
		createUnscopedWebSpaceApi: createTestSpaceApi,
	};
});

vi.mock("#/lib/spaces/image-attachment", () => ({
	prepareSpaceImageAttachment: (...args: unknown[]) =>
		prepareSpaceImageAttachmentMock(...args),
}));

vi.mock("#/lib/spaces/protected-space-access", () => ({
	rememberProtectedSpaceAccess: rememberProtectedSpaceAccessMock,
}));

vi.mock("#/lib/onboarding/update-profile-space-history-status", () => ({
	updateProfileSpaceHistoryStatus: updateProfileSpaceHistoryStatusMock,
}));

vi.mock("#/lib/onboarding/upsert-profile-space-history", () => ({
	upsertProfileSpaceHistory: upsertProfileSpaceHistoryMock,
}));

vi.mock("#/lib/profiles/agent-profile-runtime-binding", () => ({
	ensureWebAgentProfileRuntimeBinding: ensureWebAgentProfileRuntimeBindingMock,
	formatWebAgentProfileRuntimeBindingFailure: () =>
		"OpenMeld could not confirm this agent profile connection. Run the setup command again, then try connecting the agent profile.",
}));

vi.mock("#/lib/agents/agent-execution-readiness", () => ({
	notifyAgentExecutionReadinessRefresh:
		notifyAgentExecutionReadinessRefreshMock,
}));

vi.mock("#/query/spaces/members", async () => {
	const actual = await vi.importActual<typeof import("#/query/spaces/members")>(
		"#/query/spaces/members"
	);
	return {
		...actual,
		readSpaceMembers: readSpaceMembersMock,
	};
});

vi.mock("#/hooks/account.hooks", async () => {
	const actual = await vi.importActual<typeof import("#/hooks/account.hooks")>(
		"#/hooks/account.hooks"
	);
	return {
		...actual,
		useAccountAvatar: useAccountAvatarMock,
	};
});

vi.mock("sonner", () => ({
	toast: toastMock,
}));

vi.mock("./space-thread-panel", async () => {
	const actual = await vi.importActual<typeof import("./space-thread-panel")>(
		"./space-thread-panel"
	);
	return {
		...actual,
		SpaceThreadPanel: (...args: Parameters<typeof actual.SpaceThreadPanel>) => {
			const [props] = args;
			const ActualSpaceThreadPanel = actual.SpaceThreadPanel;
			return (
				<>
					<ActualSpaceThreadPanel {...props} />
					{threadProgrammaticSendHarness.enabled &&
					props.activeThread &&
					props.onSendText ? (
						<button
							onClick={() => {
								const sendPromise = props.onSendText?.(
									threadProgrammaticSendHarness.text
								);
								sendPromise?.catch(() => undefined);
							}}
							type="button"
						>
							Send programmatic thread text
						</button>
					) : null}
				</>
			);
		},
	};
});

vi.mock("#/components/agents/use-local-agent-recovery-controller", () => ({
	useLocalAgentRecoveryController: (...args: unknown[]) => ({
		currentDeviceTargetQuery: {
			data: {
				availability: "missing",
			},
		},
		currentLocalRuntimeReplyReadinessQuery: {
			data: undefined,
			isPending: false,
		},
		// The Get-set-up banner composer reads `localRuntimesQuery`. Default to
		// "not yet resolved" (isSuccess false -> noConnectedComputer false ->
		// deviceStatus "unknown"), which blocks the connect row so the banner stays
		// empty for these conversation-focused fixtures. Tests that exercise the
		// banner override this with an explicit query.
		localRuntimesQuery: {
			data: undefined,
			isSuccess: false,
		},
		refreshAll: vi.fn().mockResolvedValue(undefined),
		deviceId: null,
		runtimeLane: null,
		selectedExecutionTarget: null,
		selectedHumanProfileId: null,
		selectedTargetDevice: null,
		storageScope: "test-storage-scope",
		...useLocalAgentRecoveryControllerMock(...args),
	}),
}));

vi.mock("#/lib/profiles/existing-profiles", () => ({
	listStartProfiles: () => listStartProfilesMock(),
}));

vi.mock(
	"#/lib/profiles/agent-profile-creation-requests",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("#/lib/profiles/agent-profile-creation-requests")
			>();
		return {
			...actual,
			createAgentProfileCreationRequest: (
				...args: Parameters<typeof createAgentProfileCreationRequestMock>
			) => createAgentProfileCreationRequestMock(...args),
		};
	}
);

vi.mock("#/lib/profiles/create-human-profile", () => ({
	createStartHumanProfile: (
		...args: Parameters<typeof createStartHumanProfileMock>
	) => createStartHumanProfileMock(...args),
}));

import { StartFlowStateProvider } from "#/components/app/start-flow-state";
import { COMPLETED_PREPARE_SESSION_POINTER_STORAGE_KEY } from "#/components/connect/prepare-session-pointer";
import { agentExecutionReadinessQueryKeys } from "#/query/agents/execution-readiness";
import { startQueryKeys } from "#/query/query-keys";
import { spaceMembersQueryOptions } from "#/query/spaces/members";
import { spaceQueryKeys, spaceStatusQueryOptions } from "#/query/spaces/status";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { SpaceLanding } from "./space-landing";
import { SPACE_MEMBERS_LOAD_ERROR_MESSAGE } from "./space-members-error-copy";
import { hardRefreshSpaceStatusAndMembers } from "./use-space-landing-controller";

const DEFAULT_SPACE_PROFILE_ID = "11111111-1111-1111-1111-111111111111";
const REMOVE_ATTACHMENT_NAME = /^Remove /;
const DEFAULT_AGENT_PROFILE_ID = "agt_22222222-2222-2222-2222-222222222222";
const SECOND_AGENT_PROFILE_ID = "agt_33333333-3333-3333-3333-333333333333";
const HISTORY_BOOTSTRAP_ERROR_TEXT = /Couldn't load recent history\./;
const MIRA_OPTION_NAME = /Mira/;
const MEMBERS_TOGGLE_BUTTON_NAME = /Members, \d+ total/;
const REVIEWER_OPTION_NAME = /Reviewer/;
const RUNNER_OPTION_NAME = /Runner/;
const SCOUT_OPTION_NAME = /Scout/;
const WATCHER_OPTION_NAME = /Watcher/;
const DIAGNOSTIC_REPORT_POINTER_COPY = /Message text is not included\./;
const LOCAL_SETUP_PREFERENCE_TEXT = /Local setup preference/;
const PREPARE_TEXT = /prepare/i;
const DELETE_CONFIRMATION_LABEL_TEXT = /Type DELETE to confirm/i;
const RECENT_ACTIVITY_TS = Date.now();
const TEST_FILE_EXTENSION_PATTERN = /\.[^.]+$/u;
const THREAD_REPLY_PREVIEW_PATTERN = /^Open reply from .*:/;
const MESSAGE_DETAILS_ACTION_NAME_PATTERN =
	/^(?:Message details$|View error details:)/;
const SPACE_MEMBERS_PANEL_OPEN_STORAGE_KEY =
	"openmeld.space.members-panel.open:space-123";
const OTHER_SPACE_MEMBERS_PANEL_OPEN_STORAGE_KEY =
	"openmeld.space.members-panel.open:space-456";
const SPACE_THREAD_PANEL_SELECTION_STORAGE_KEY =
	"openmeld.space.thread-panel.active-thread:space-123";
const NOTIFICATIONS_BUTTON_NAME_PATTERN = /notifications/i;
const ACTIVE_WAKE_SERVICE_WAITING_NOTE_PATTERN =
	/A Wake is waiting for the computer to reconnect\./;
const READY_WORD_PATTERN = /\bReady\b/u;
const WAITING_FOR_OPENMELD_SERVICE_PATTERN = /Waiting for OpenMeld Service/;
const SHOW_ME_AROUND_BUTTON_NAME_PATTERN = /Show me around/;
const CREATE_SPACE_BUTTON_NAME_PATTERN = /Create a Space/;
const ADD_PEOPLE_OR_AGENTS_BUTTON_NAME_PATTERN = /^Add people or agents/;
const CONNECT_THIS_COMPUTER_BUTTON_NAME_PATTERN = /^Connect this computer/;
const CAN_VIEW_TEXT_PATTERN = /can view$/;
const OWNED_BY_MING_PATTERN = /Owned by Ming Yoo/;
const CONTROLLED_BY_PATTERN = /Controlled by/;
type TestAgentExecutionReadiness = ReturnType<
	typeof createSpaceMemberAgentExecutionReadiness
>;

function WakeProgressVisibleProjectionProbe(input: {
	profileId: string;
	spaceId: string;
}) {
	const items = useSpaceWakeProgressVisibleProjection(input);
	return (
		<output data-testid="wake-progress-visible-projection">
			{items === null
				? "unpublished"
				: items.map((item) => item.phase).join(",") || "none"}
		</output>
	);
}

function renderSpaceLanding(
	input: {
		accountProfiles?: readonly AuthProfileView[];
		currentUserAvatarImageUrl?: string | null;
		initialFocusInteractionId?: string;
		initialFocusRequestId?: string;
		initialFocusSignalId?: string;
		initialFocusThreadRootSignalId?: string;
		initialPendingMessage?: {
			files?: readonly File[];
			clientMessageId: string;
			createdAtMs: number;
			text: string;
		} | null;
		isCenterAgentDirectMessage?: boolean;
		onInitialPendingMessageConsumed?: () => void;
		organizationScope?: OrganizationScopeAuthorized;
		presentation?: "compact" | "full";
		profileId?: string;
		queryClient?: QueryClient;
		spaceId?: string;
		observeVisibleWakeProgress?: boolean;
		entryConfirmed?: boolean;
		ensureEntryConfirmed?: () => Promise<boolean>;
	} = {}
) {
	// SpaceLanding's Slack-discovery header state always mounts two real
	// useMutation hooks (Slack connect/disconnect), independent of any given
	// test's own fixtures, so a QueryClientProvider must always be present --
	// useQuery/useQueryClient stay fully mocked above and never read this
	// client, but useMutation does.
	const queryClient = input.queryClient ?? createTestQueryClient();
	const profileId = input.profileId ?? DEFAULT_SPACE_PROFILE_ID;
	const spaceId = input.spaceId ?? "space-123";
	const organizationScope =
		input.organizationScope === undefined
			? createOrganizationScope()
			: input.organizationScope;
	const wrap = (ui: ReactNode) => (
		<TestQueryClientProvider queryClient={queryClient}>
			<SpaceWakeProgressVisibleProjectionProvider
				profileId={profileId}
				spaceId={spaceId}
			>
				{input.observeVisibleWakeProgress ? (
					<WakeProgressVisibleProjectionProbe
						profileId={profileId}
						spaceId={spaceId}
					/>
				) : null}
				<AppOrganizationProvider scope={organizationScope}>
					<StartFlowStateProvider storageScope="test-storage-scope">
						<SpaceEntryConfirmationContext
							value={{
								confirmed: input.entryConfirmed ?? true,
								ensureConfirmed:
									input.ensureEntryConfirmed ?? (async () => true),
							}}
						>
							{ui}
						</SpaceEntryConfirmationContext>
					</StartFlowStateProvider>
				</AppOrganizationProvider>
			</SpaceWakeProgressVisibleProjectionProvider>
		</TestQueryClientProvider>
	);
	const view = render(
		wrap(
			<SpaceLanding
				accountProfiles={input.accountProfiles}
				currentUserAvatarImageUrl={input.currentUserAvatarImageUrl}
				initialFocusInteractionId={input.initialFocusInteractionId}
				initialFocusRequestId={input.initialFocusRequestId}
				initialFocusSignalId={input.initialFocusSignalId}
				initialFocusThreadRootSignalId={input.initialFocusThreadRootSignalId}
				initialPendingMessage={input.initialPendingMessage}
				isCenterAgentDirectMessage={input.isCenterAgentDirectMessage}
				onInitialPendingMessageConsumed={input.onInitialPendingMessageConsumed}
				orgSlug="acme"
				presentation={input.presentation}
				profileId={profileId}
				spaceId={spaceId}
			/>
		)
	);
	return {
		...view,
		// Plain view.rerender(<SpaceLanding .../>) would replace the whole
		// rendered tree, dropping the TestQueryClientProvider ancestor above
		// and crashing the same Slack-discovery useMutation hooks. Re-wrap
		// every rerender the same way the initial render is wrapped.
		rerender: (ui: Parameters<typeof view.rerender>[0]) =>
			view.rerender(wrap(ui)),
	};
}

function openDesktopMembersPanel(): HTMLElement {
	const membersButton = screen.getByRole("button", {
		name: MEMBERS_TOGGLE_BUTTON_NAME,
	});
	if (membersButton.getAttribute("aria-expanded") !== "true") {
		fireEvent.click(membersButton);
	}
	return screen.getByRole("complementary", { name: "Members" });
}

function PendingCenterAgentSpaceLanding(input: {
	message: {
		clientMessageId: string;
		createdAtMs: number;
		text: string;
	};
	onConsumed: () => void;
}) {
	const [pendingMessage, setPendingMessage] = useState<
		typeof input.message | null
	>(input.message);
	return (
		<SpaceLanding
			initialPendingMessage={pendingMessage}
			onInitialPendingMessageConsumed={() => {
				setPendingMessage(null);
				input.onConsumed();
			}}
			orgSlug="acme"
			profileId={DEFAULT_SPACE_PROFILE_ID}
			spaceId="space-123"
		/>
	);
}

function renderSpaceLandingWithCreateProfileDialogProviders(
	input: {
		accountProfiles?: readonly AuthProfileView[];
		profileId?: string;
		spaceId?: string;
	} = {}
) {
	const queryClient = createTestQueryClient();
	return render(
		<TestQueryClientProvider queryClient={queryClient}>
			<StartFlowStateProvider>
				<AppOrganizationProvider scope={createOrganizationScope()}>
					<SpaceLanding
						accountProfiles={input.accountProfiles}
						orgSlug="acme"
						profileId={input.profileId ?? DEFAULT_SPACE_PROFILE_ID}
						spaceId={input.spaceId ?? "space-123"}
					/>
				</AppOrganizationProvider>
			</StartFlowStateProvider>
		</TestQueryClientProvider>
	);
}

async function flushPromiseQueue() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});
}

function buildSharedReadinessCacheInvalidations(
	storageScope = "test-storage-scope"
) {
	return [
		{
			queryKey: agentExecutionReadinessQueryKeys.batchesForOrganization(
				storageScope,
				"org-acme"
			),
			refetchType: "active",
		},
	] as const;
}

function buildLocalRuntimeCacheInvalidations(
	storageScope = "test-storage-scope"
) {
	return [
		{
			queryKey: startQueryKeys.currentDeviceTarget(storageScope),
			refetchType: "active",
		},
		{
			queryKey: startQueryKeys.localRuntimes(storageScope),
			refetchType: "active",
		},
		{
			queryKey: startQueryKeys.currentLocalRuntimeReplyReadiness(storageScope),
			refetchType: "active",
		},
	] as const;
}

describe("SpaceLanding", () => {
	beforeEach(() => {
		wakeProgressFixture.presentationEpoch = null;
		composerDraftRead.task = null;
		composerDraftRead.error = null;
		composerDiscoveryWait.task = null;
		composerDiscoveryWait.onEntered = null;
		vi.stubGlobal(
			"IntersectionObserver",
			class {
				observe = vi.fn();
				unobserve = vi.fn();
				disconnect = vi.fn();
			}
		);
		clearSpaceConversationCacheMock.mockClear();
		useQueryMock.mockReset();
		useAccountAvatarMock.mockReset().mockReturnValue({
			data: {
				avatar: null,
				defaultHumanProfileId: DEFAULT_SPACE_PROFILE_ID,
				ok: true,
			},
			isPending: false,
		});
		useQueryClientMock.mockReset().mockReturnValue({
			getQueryCache: () => ({ subscribe: () => () => undefined }),
			getQueryState: vi.fn(() => undefined),
			cancelQueries: vi.fn().mockResolvedValue(undefined),
			fetchQuery: vi.fn(
				async (options: {
					queryFn?: (context: { signal: AbortSignal }) => unknown;
					queryKey?: readonly unknown[];
				}) => {
					if (
						options.queryKey?.[0] === "spaces" &&
						options.queryKey[1] === "updates" &&
						options.queryFn
					) {
						return await options.queryFn({
							signal: new AbortController().signal,
						});
					}
					return undefined;
				}
			),
			getQueryData: vi.fn(() => undefined),
			getQueriesData: vi.fn(() => []),
			invalidateQueries: vi.fn().mockResolvedValue(undefined),
			resetQueries: vi.fn().mockResolvedValue(undefined),
			setQueriesData: vi.fn(),
			setQueryData: vi.fn(),
		});
		useNavigateMock.mockReset().mockResolvedValue(undefined);
		createDirectMessageApiMock.mockReset();
		createWebSpaceApiMock.mockReset();
		prepareSpaceImageAttachmentMock
			.mockReset()
			.mockImplementation(async (file: File) => ({
				blob: new Blob(["converted-image"], { type: "image/jpeg" }),
				fileName: `${file.name.replace(TEST_FILE_EXTENSION_PATTERN, "")}.jpg`,
				height: 800,
				mimeType: "image/jpeg",
				width: 1200,
			}));
		rememberProtectedSpaceAccessMock.mockReset();
		ensureWebAgentProfileRuntimeBindingMock.mockReset().mockResolvedValue({
			agentControllerRef: "builtin:codex",
			deviceId: "device-office",
			lane: "dev-local",
			outcome: "created",
			reasonCodes: ["agent_profile_binding.command_eligible"],
			routable: true,
			openMeldServiceRuntimeId: {
				source: "runtime_registry_authority",
				value: "runtime_opaque_codex",
			},
			status: "accepted",
		});
		updateProfileSpaceHistoryStatusMock.mockReset().mockResolvedValue({
			profileId: DEFAULT_SPACE_PROFILE_ID,
			gatewayHost: "gateway.openmeld.invalid",
			spaceId: "space-123",
			status: "removed",
			updatedAt: "2026-04-29T00:00:00.000Z",
		});
		upsertProfileSpaceHistoryMock.mockReset().mockResolvedValue([]);
		notifyAgentExecutionReadinessRefreshMock
			.mockReset()
			.mockResolvedValue(undefined);
		readSpaceMembersMock
			.mockReset()
			.mockResolvedValue(createMembersSnapshot() as SpaceMembersSnapshot);
		threadProgrammaticSendHarness.enabled = false;
		threadProgrammaticSendHarness.text = "Programmatic thread message";
		toastMock.mockReset();
		toastMock.error.mockReset();
		toastMock.success.mockReset();
		toastMock.warning.mockReset();
		window.localStorage.clear();
		window.sessionStorage.clear();
		FakeWebSocket.reset();
		createWebSpaceApiMock.mockReturnValue({
			deleteSpace: vi.fn().mockResolvedValue({
				deleted: true,
				spaceId: "space-123",
			}),
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: vi.fn().mockResolvedValue({
				items: [],
				query: {
					clientMessageId: "client-message-1",
					spaceId: "space-123",
					targetProfileId: null,
				},
			}),
			inspectExecutionRecovery: vi.fn(
				async (input: { dispatchId: string }) => ({
					recovery: createUnavailableExecutionRecovery({
						dispatchId: input.dispatchId,
						targetProfileId: DEFAULT_AGENT_PROFILE_ID,
					}),
				})
			),
			leaveSpace: vi.fn().mockResolvedValue({
				leftProfileId: DEFAULT_SPACE_PROFILE_ID,
				status: "left",
			}),
			listSignalEnvelopes: vi.fn().mockResolvedValue({
				envelopes: [],
				nextCursor: null,
			}),
			postNormalMessage: vi.fn(),
		});
		useLocalAgentRecoveryControllerMock.mockReset().mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "missing",
				},
			},
			selectedTargetDevice: null,
			selectedHumanProfileId: DEFAULT_SPACE_PROFILE_ID,
			refreshAll: vi.fn().mockResolvedValue(undefined),
			runtimeLane: "dev-local",
			startStateQuery: {
				data: undefined,
			},
		});
		listStartProfilesMock.mockReset().mockResolvedValue([
			createLandingAccountProfile({
				openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
				ownerUserId: "user-mira",
				profileKind: "human",
				profileName: "Mira",
			}),
		]);
		createAgentProfileCreationRequestMock
			.mockReset()
			.mockImplementation(async (requestInput) =>
				buildCompletedAgentProfileCreationRequest(requestInput)
			);
		createStartHumanProfileMock.mockReset().mockResolvedValue(
			createLandingAccountProfile({
				openMeldProfileId: "22222222-2222-4222-8222-222222222222",
				ownerUserId: "user-mira",
				profileKind: "human",
				profileName: "Mira Alt",
			})
		);
		vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
		vi.stubGlobal("matchMedia", createMatchMediaMock());
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "visible",
		});
		HTMLElement.prototype.scrollIntoView = vi.fn();
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: vi
				.fn()
				.mockReturnValueOnce("blob:source-image-preview")
				.mockReturnValue("blob:converted-image-preview"),
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: vi.fn(),
		});
	});

	afterEach(() => {
		cleanup();
		FakeWebSocket.reset();
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it("renders an active Center Agent stream in the first bootstrap-backed frame", () => {
		vi.spyOn(Date, "now").mockReturnValue(RECENT_ACTIVITY_TS);
		mockSpaceQueries({
			activeAgentStreams: [
				createActiveAgentStreamSnapshot("Restored from bootstrap"),
			],
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "signal-trigger-1",
							text: "Please continue from the bootstrap snapshot.",
							ts: 1,
						}),
					],
					nextCursor: null,
				},
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
		});

		renderSpaceLanding();

		const streamMessage = document.querySelector(
			'[data-signal-id="stream:bootstrap-submission"]'
		);
		expect(streamMessage?.textContent).toContain("Restored from bootstrap");
	});

	it("renders the canonical Center Agent conversation and composer in the compact presentation", async () => {
		vi.spyOn(Date, "now").mockReturnValue(RECENT_ACTIVITY_TS);
		const postNormalMessageMock = vi.fn().mockResolvedValue(
			createTextSignal({
				id: "signal-compact-message",
				text: "Continue from the compact conversation.",
			})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			activeAgentStreams: [
				createActiveAgentStreamSnapshot("Working in the same conversation"),
			],
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "signal-trigger-1",
							text: "Check the current launch plan.",
							ts: 1,
						}),
					],
					nextCursor: null,
				},
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			status: createQueryResult({
				isSuccess: true,
				data: {
					...createSpaceStatus(),
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				},
			}),
		});

		renderSpaceLanding({
			isCenterAgentDirectMessage: true,
			presentation: "compact",
		});

		expect(
			screen.getAllByText("Check the current launch plan.").length
		).toBeGreaterThan(0);
		expect(
			document.querySelector('[data-signal-id="stream:bootstrap-submission"]')
				?.textContent
		).toContain("Working in the same conversation");
		const textarea = screen.getByRole("textbox", {
			name: "Message Center Agent",
		});
		await setComposerValue(textarea, "Continue from the compact conversation.");
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalledWith({
				meta: { clientMessageId: expect.any(String), authorHasRead: true },
				spaceId: "space-123",
				text: "Continue from the compact conversation.",
				timeoutMs: 30_000,
			});
		});
		expect(
			document.querySelector('[data-slot="center-agent-compact-conversation"]')
		).toBeTruthy();
		expect(
			document.querySelector('[data-space-conversation-presentation="compact"]')
		).toBeTruthy();
	});

	it.each([
		"button",
		"keyboard",
	] as const)("keeps the Space draft when attachment discovery fails from the %s submit path", async (method) => {
		composerDraftRead.error = new Error("database connection is closing");
		const postNormalMessageMock = vi.fn().mockResolvedValue(
			createTextSignal({
				id: "signal-after-recovery",
				text: "Draft survives",
			})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
		});
		renderSpaceLanding();
		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await setComposerValue(textarea, "Draft survives");
		await screen.findByText("Couldn't restore your attachment drafts.");

		if (method === "button") {
			fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		} else {
			fireEvent.keyDown(textarea, { key: "Enter" });
		}

		await waitFor(() =>
			expect(textarea.textContent).toContain("Draft survives")
		);
		expect(postNormalMessageMock).not.toHaveBeenCalled();
		composerDraftRead.error = null;
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() =>
			expect(
				screen.queryByText("Couldn't restore your attachment drafts.")
			).toBeNull()
		);
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		await waitFor(() => expect(postNormalMessageMock).toHaveBeenCalledTimes(1));
	});

	it("admits one Space submission when button and Enter join attachment discovery", async () => {
		let releaseDiscovery: (drafts: []) => void = () => undefined;
		composerDraftRead.task = new Promise<[]>((resolve) => {
			releaseDiscovery = resolve;
		});
		const postNormalMessageMock = vi
			.fn()
			.mockResolvedValue(
				createTextSignal({ id: "signal-single-admission", text: "Send once" })
			);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
		});
		renderSpaceLanding();
		const editor = screen.getByRole("textbox", { name: "Message this space" });
		await setComposerValue(editor, "Send once");
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		fireEvent.keyDown(editor, { key: "Enter" });
		releaseDiscovery([]);
		await waitFor(() => expect(postNormalMessageMock).toHaveBeenCalledTimes(1));
		expect(postNormalMessageMock).toHaveBeenCalledWith(
			expect.objectContaining({ text: "Send once" })
		);
	});

	it("does not release the next submission admission when a previous send settles", async () => {
		const descriptor = createSpaceFileDescriptor({
			mimeType: "text/plain",
			name: "second.txt",
		});
		const postResolvers: Array<
			(signal: ReturnType<typeof createTextSignal>) => void
		> = [];
		const postNormalMessageMock = vi.fn().mockImplementation(
			() =>
				new Promise<ReturnType<typeof createTextSignal>>((resolve) => {
					postResolvers.push(resolve);
				})
		);
		const stageComposerUploadMock = vi.fn().mockImplementation(async (input) =>
			createSpaceComposerUpload({
				id: input.uploadId,
				mimeType: input.mimeType,
				name: input.name,
				sizeBytes: input.bytes.size,
			})
		);
		const publishComposerUploadMock = vi.fn().mockResolvedValue(descriptor);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
			publishComposerUpload: publishComposerUploadMock,
			stageComposerUpload: stageComposerUploadMock,
		});
		mockSpaceQueries({
			status: createQueryResult({ isSuccess: true, data: createSpaceStatus() }),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding();
		const editor = screen.getByRole("textbox", { name: "Message this space" });
		const send = screen.getByRole("button", { name: "Send message" });
		await setComposerValue(editor, "First message");
		fireEvent.click(send);
		await waitFor(() => expect(postNormalMessageMock).toHaveBeenCalledTimes(1));

		let releaseSecondDiscovery: () => void = () => undefined;
		composerDiscoveryWait.task = new Promise<void>((resolve) => {
			releaseSecondDiscovery = resolve;
		});
		let secondDiscoveryEntered: () => void = () => undefined;
		const secondDiscoveryStarted = new Promise<void>((resolve) => {
			secondDiscoveryEntered = resolve;
		});
		composerDiscoveryWait.onEntered = secondDiscoveryEntered;
		fireEvent.change(screen.getByLabelText("Choose files to send"), {
			target: {
				files: [new File(["second"], "second.txt", { type: "text/plain" })],
			},
		});
		await waitFor(() =>
			expect(stageComposerUploadMock).toHaveBeenCalledTimes(1)
		);
		await setComposerValue(editor, "Second message");
		fireEvent.click(send);
		await secondDiscoveryStarted;
		expect(postNormalMessageMock).toHaveBeenCalledTimes(1);

		await act(async () => {
			postResolvers[0]?.(
				createTextSignal({ id: "signal-first", text: "First message" })
			);
			await Promise.resolve();
		});
		await waitFor(() =>
			expect(
				document.querySelector('[data-signal-id="signal-first"]')
			).toBeTruthy()
		);
		fireEvent.click(send);
		await act(async () => {
			releaseSecondDiscovery();
			await Promise.resolve();
		});

		await waitFor(() => expect(postNormalMessageMock).toHaveBeenCalledTimes(2));
		expect(
			screen.getAllByText("Second message", { selector: "p" })
		).toHaveLength(1);
		const [firstInput, secondInput] = postNormalMessageMock.mock.calls.map(
			([input]) => input
		);
		expect(firstInput.text).toBe("First message");
		expect(secondInput.text).toBe("Second message");
		expect(secondInput.files).toEqual([
			createSpaceMessageFileReference(descriptor),
		]);
		expect(secondInput.meta.clientMessageId).not.toBe(
			firstInput.meta.clientMessageId
		);
		expect(
			postNormalMessageMock.mock.calls.filter(
				([input]) => input.text === "Second message"
			)
		).toHaveLength(1);
		expect(publishComposerUploadMock).toHaveBeenCalledTimes(1);
	});

	it("hard-refreshes Space members while a previous members query is waiting to retry", async () => {
		vi.useFakeTimers();
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: {
					retryDelay: 60_000,
				},
			},
		});
		const getMembersSnapshotMock = vi
			.fn()
			.mockRejectedValueOnce(new Error("members unavailable"))
			.mockResolvedValueOnce(createMembersSnapshot());
		const getStatusMock = vi.fn().mockResolvedValue(createSpaceStatus());
		createWebSpaceApiMock.mockReturnValue({
			getMembersSnapshot: getMembersSnapshotMock,
			getStatus: getStatusMock,
		});
		const retryingMembersQuery = queryClient
			.fetchQuery(
				spaceMembersQueryOptions({
					enabled: true,
					spaceId: "space-123",
					openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
				})
			)
			.catch(() => undefined);
		await Promise.resolve();

		expect(getMembersSnapshotMock).toHaveBeenCalledTimes(1);

		await hardRefreshSpaceStatusAndMembers({
			profileId: DEFAULT_SPACE_PROFILE_ID,
			queryClient,
			spaceId: "space-123",
		});

		expect(getStatusMock).toHaveBeenCalledTimes(1);
		expect(getMembersSnapshotMock).toHaveBeenCalledTimes(2);
		await retryingMembersQuery;
		queryClient.clear();
	});

	it("hard-refreshes Space members and status even when cached snapshots are still fresh", async () => {
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: {
					retry: false,
				},
			},
		});
		const getMembersSnapshotMock = vi
			.fn()
			.mockResolvedValue(createMembersSnapshot());
		const getStatusMock = vi.fn().mockResolvedValue(createSpaceStatus());
		createWebSpaceApiMock.mockReturnValue({
			getMembersSnapshot: getMembersSnapshotMock,
			getStatus: getStatusMock,
		});
		queryClient.setQueryData(
			spaceMembersQueryOptions({
				enabled: true,
				spaceId: "space-123",
				openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
			}).queryKey,
			createMembersSnapshot({
				defaultAgentProfileName: "Cached Agent",
			}) as SpaceMembersSnapshot
		);
		queryClient.setQueryData(
			spaceStatusQueryOptions({
				enabled: true,
				spaceId: "space-123",
				openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
			}).queryKey,
			createSpaceStatus()
		);

		await hardRefreshSpaceStatusAndMembers({
			profileId: DEFAULT_SPACE_PROFILE_ID,
			queryClient,
			spaceId: "space-123",
		});

		expect(getStatusMock).toHaveBeenCalledTimes(1);
		expect(getMembersSnapshotMock).toHaveBeenCalledTimes(1);
		queryClient.clear();
	});

	it("renders the minimum usable conversation-first landing", () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(
			screen.getByRole("heading", { level: 1, name: "Design Room" })
		).toBeTruthy();
		expect(screen.queryByText("Space summary")).toBeNull();
		expect(screen.queryByText("People in this space")).toBeNull();
		expect(screen.queryByText("Conversation")).toBeNull();
		expect(
			screen.getByRole("button", { name: MEMBERS_TOGGLE_BUTTON_NAME })
		).toBeTruthy();
		expect(
			screen.getByText("A Space is where people and agents work together.")
		).toBeTruthy();
		expect(
			screen.getByText(
				"You and your teammates can give agents work. Agents can ask other agents for help. Everyone can see the results here."
			)
		).toBeTruthy();
		expect(
			screen
				.getByRole("textbox", { name: "Message this space" })
				.getAttribute("aria-placeholder")
		).toBe("To wake an agent, type @, then pick the agent.");
		expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "View All Members" })
		).toBeNull();
	});

	it("renders members from the members cache instead of replaying older bootstrap members after a refetch failure", () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		const currentMembersResult = createQueryResult({
			data: createMembersSnapshot({ defaultAgentProfileName: "Current Cache" }),
			error: new Error("members unavailable"),
			isError: true,
		});
		mockSpaceQueries({
			bootstrap: createQueryResult({
				data: {
					status: createSpaceStatus(),
					members: createMembersSnapshot({
						defaultAgentProfileName: "Old Bootstrap",
					}),
					history: {
						envelopes: [],
						nextCursor: null,
					},
					threads: {
						threads: [],
						previews: [],
					},
				},
				isSuccess: true,
			}),
			status: createQueryResult({
				data: createSpaceStatus(),
				isSuccess: true,
			}),
			members: currentMembersResult,
			history: createQueryResult({
				data: {
					envelopes: [],
					nextCursor: null,
				},
				isSuccess: true,
			}),
		});

		const view = renderSpaceLanding();
		const panel = openDesktopMembersPanel();

		expect(within(panel).getByText("Current Cache")).toBeTruthy();
		expect(within(panel).queryByText("Old Bootstrap")).toBeNull();

		Object.assign(currentMembersResult, {
			data: createMembersSnapshot({ defaultAgentProfileName: "Fresh Members" }),
			error: null,
			isError: false,
			isSuccess: true,
		});
		view.rerender(
			<SpaceLanding
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);

		expect(within(panel).getByText("Fresh Members")).toBeTruthy();
		expect(within(panel).queryByText("Current Cache")).toBeNull();
		expect(within(panel).queryByText("Old Bootstrap")).toBeNull();
	});

	it("shows a retryable members error instead of skeletons when bootstrap fails before members load", async () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		const fetchQueryMock = vi.fn().mockResolvedValue(undefined);
		useQueryClientMock.mockReturnValue({
			cancelQueries: vi.fn().mockResolvedValue(undefined),
			fetchQuery: fetchQueryMock,
			getQueryData: vi.fn(() => undefined),
			invalidateQueries: vi.fn().mockResolvedValue(undefined),
			resetQueries: vi.fn().mockResolvedValue(undefined),
			setQueryData: vi.fn(),
		});
		const membersResult = createQueryResult({
			isPending: true,
		});
		mockSpaceQueries({
			bootstrap: createQueryResult({
				error: new Error("bootstrap unavailable"),
				isError: true,
			}),
			status: createQueryResult({
				data: createSpaceStatus(),
				isSuccess: true,
			}),
			members: membersResult,
			history: createQueryResult({
				data: {
					envelopes: [],
					nextCursor: null,
				},
				isSuccess: true,
			}),
		});

		const view = renderSpaceLanding();
		const panel = openDesktopMembersPanel();

		expect(
			within(panel).getByText(SPACE_MEMBERS_LOAD_ERROR_MESSAGE)
		).toBeTruthy();
		expect(within(panel).queryByText("Loading members")).toBeNull();
		fireEvent.click(within(panel).getByRole("button", { name: "Retry" }));

		await waitFor(() => {
			expect(fetchQueryMock).toHaveBeenCalledTimes(2);
		});

		Object.assign(membersResult, {
			data: createMembersSnapshot({
				defaultAgentProfileName: "Recovered Agent",
			}),
			isPending: false,
			isSuccess: true,
		});
		view.rerender(
			<SpaceLanding
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);

		expect(within(panel).getByText("Recovered Agent")).toBeTruthy();
		expect(
			within(panel).queryByText(SPACE_MEMBERS_LOAD_ERROR_MESSAGE)
		).toBeNull();
	});

	it("adds selected Organization Directory profiles through one Space request", async () => {
		const humanProfileId = "22222222-2222-4222-8222-222222222222";
		const centerAgentProfileId = "agt_44444444-4444-4444-8444-444444444444";
		const addOrganizationDirectoryProfilesToSpaceMock = vi
			.fn()
			.mockResolvedValue({
				addedMemberIds: [humanProfileId, centerAgentProfileId],
				alreadyMemberIds: [],
				items: [],
			});
		createWebSpaceApiMock.mockReturnValue({
			addOrganizationDirectoryProfilesToSpace:
				addOrganizationDirectoryProfilesToSpaceMock,
			deleteSpace: vi.fn().mockResolvedValue({
				deleted: true,
				spaceId: "space-123",
			}),
			getUpdates: vi.fn().mockResolvedValue({ signals: [] }),
			getWakeProgress: vi.fn().mockResolvedValue({
				items: [],
				query: {
					clientMessageId: "client-message-1",
					spaceId: "space-123",
					targetProfileId: null,
				},
			}),
			leaveSpace: vi.fn().mockResolvedValue({
				leftProfileId: DEFAULT_SPACE_PROFILE_ID,
				status: "left",
			}),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			history: createQueryResult({
				data: { envelopes: [], nextCursor: null },
				isSuccess: true,
			}),
			members: createQueryResult({
				data: createMembersSnapshot({ defaultAgentOwnerUserId: "user-mira" }),
				isSuccess: true,
			}),
			organizationDirectory: createOrganizationDirectoryFixture({
				centerAgentProfileId,
				humanProfileId,
			}),
			status: createQueryResult({
				data: createSpaceStatus(),
				isSuccess: true,
			}),
		});

		renderSpaceLandingWithCreateProfileDialogProviders({
			accountProfiles: [
				createLandingAccountProfile({
					openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "human",
					profileName: "Mira",
				}),
			],
		});

		fireEvent.click(
			screen.getByRole("button", { name: MEMBERS_TOGGLE_BUTTON_NAME })
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Add People or Agents" })
		);
		fireEvent.click(screen.getByRole("checkbox", { name: "Alex" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "Center Agent" }));
		fireEvent.click(screen.getByRole("button", { name: "Add 2 members" }));

		await waitFor(() => {
			expect(createWebSpaceApiMock).toHaveBeenCalledWith({
				organizationId: "org-acme",
				openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
			});
			expect(addOrganizationDirectoryProfilesToSpaceMock).toHaveBeenCalledWith({
				directoryProfileIds: [humanProfileId, centerAgentProfileId],
				expectedCenterAgentProfileId: centerAgentProfileId,
				spaceId: "space-123",
			});
		});
		await waitFor(() => {
			expect(
				screen
					.getByRole("button", { name: "Add People or Agents" })
					.getAttribute("aria-expanded")
			).toBe("false");
		});
	});

	it("keeps the Human viewer out of an agent-only Space until they explicitly join", async () => {
		const addMembersMock = vi.fn().mockResolvedValue({
			addedMemberIds: [DEFAULT_SPACE_PROFILE_ID],
			alreadyMemberIds: [],
			items: [],
		});
		createWebSpaceApiMock.mockReturnValue({
			addMembers: addMembersMock,
			deleteSpace: vi.fn().mockResolvedValue({
				deleted: true,
				spaceId: "space-123",
			}),
			getUpdates: vi.fn().mockResolvedValue({ signals: [] }),
			getWakeProgress: vi.fn().mockResolvedValue({
				items: [],
				query: {
					clientMessageId: "client-message-1",
					spaceId: "space-123",
					targetProfileId: null,
				},
			}),
			leaveSpace: vi.fn().mockResolvedValue({
				leftProfileId: DEFAULT_SPACE_PROFILE_ID,
				status: "left",
			}),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		const agentOnlyMembers = createMembersSnapshot({
			defaultAgentOwnerUserId: "user-mira",
		});
		agentOnlyMembers.humans = [];
		agentOnlyMembers.summary = {
			...agentOnlyMembers.summary,
			humanCount: 0,
			totalCount: 1,
		};
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: agentOnlyMembers,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding({
			accountProfiles: [
				createLandingAccountProfile({
					openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "human",
					profileName: "Mira",
				}),
				createLandingAccountProfile({
					openMeldProfileId: DEFAULT_AGENT_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "agent",
					profileName: "Runner",
				}),
			],
			organizationScope: createOrganizationScope({ isPersonal: true }),
		});

		expect(upsertProfileSpaceHistoryMock).not.toHaveBeenCalled();
		expect(FakeWebSocket.instances).toHaveLength(0);
		expect(
			screen.queryByRole("textbox", { name: "Message this space" })
		).toBeNull();
		expect(
			screen.getByText("Join as Mira to participate in this Space.")
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Join as Mira" }));

		await waitFor(() => {
			expect(addMembersMock).toHaveBeenCalledWith({
				memberProfileIds: [DEFAULT_SPACE_PROFILE_ID],
				requestContext: expect.objectContaining({
					actorContext: expect.objectContaining({
						openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
					}),
				}),
				spaceId: "space-123",
			});
		});
	});

	it("closes Add People or Agents when directory refresh fails after the membership write", async () => {
		const addMembersMock = vi.fn().mockResolvedValue({
			addedMemberIds: [SECOND_AGENT_PROFILE_ID],
			alreadyMemberIds: [],
			items: [],
		});
		const consoleWarnMock = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		useQueryClientMock.mockReturnValue({
			invalidateQueries: vi
				.fn()
				.mockRejectedValue(new Error("Directory refresh failed")),
			setQueryData: vi.fn(),
		});
		createWebSpaceApiMock.mockReturnValue({
			addOrganizationDirectoryProfilesToSpace: addMembersMock,
			deleteSpace: vi.fn().mockResolvedValue({
				deleted: true,
				spaceId: "space-123",
			}),
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: vi.fn().mockResolvedValue({
				items: [],
				query: {
					clientMessageId: "client-message-1",
					spaceId: "space-123",
					targetProfileId: null,
				},
			}),
			leaveSpace: vi.fn().mockResolvedValue({
				leftProfileId: DEFAULT_SPACE_PROFILE_ID,
				status: "left",
			}),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			organizationDirectory: createPersonalScoutDirectoryFixture(),
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentOwnerUserId: "user-mira",
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding({
			accountProfiles: [
				createLandingAccountProfile({
					openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "human",
					profileName: "Mira",
				}),
				createLandingAccountProfile({
					openMeldProfileId: SECOND_AGENT_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "agent",
					profileName: "Scout",
				}),
			],
			organizationScope: createOrganizationScope({ isPersonal: true }),
		});

		fireEvent.click(
			screen.getByRole("button", { name: MEMBERS_TOGGLE_BUTTON_NAME })
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Add People or Agents" })
		);
		fireEvent.click(screen.getByRole("checkbox", { name: SCOUT_OPTION_NAME }));
		fireEvent.click(screen.getByRole("button", { name: "Add 1 member" }));

		await waitFor(() => {
			expect(addMembersMock).toHaveBeenCalledWith({
				directoryProfileIds: [SECOND_AGENT_PROFILE_ID],
				expectedCenterAgentProfileId: SECOND_AGENT_PROFILE_ID,
				spaceId: "space-123",
			});
			expect(
				screen
					.getByRole("button", { name: "Add People or Agents" })
					.getAttribute("aria-expanded")
			).toBe("false");
		});
		expect(screen.queryByText("Member added to this Space.")).toBeNull();
		expect(screen.queryByText("history write failed")).toBeNull();
		await waitFor(() =>
			expect(consoleWarnMock).toHaveBeenCalledWith(
				"OpenMeld added Organization Directory profiles but could not refresh Space data.",
				expect.objectContaining({
					directoryProfileIds: [SECOND_AGENT_PROFILE_ID],
					spaceId: "space-123",
				})
			)
		);
	});

	it("refreshes added agent readiness before reloading Space members", async () => {
		const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		const addMembersMock = vi.fn().mockResolvedValue({
			addedMemberIds: [SECOND_AGENT_PROFILE_ID],
			alreadyMemberIds: [],
			items: [],
		});
		useQueryClientMock.mockReturnValue({
			invalidateQueries: invalidateQueriesMock,
			setQueryData: vi.fn(),
		});
		createWebSpaceApiMock.mockReturnValue({
			addOrganizationDirectoryProfilesToSpace: addMembersMock,
			deleteSpace: vi.fn().mockResolvedValue({
				deleted: true,
				spaceId: "space-123",
			}),
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: vi.fn().mockResolvedValue({
				items: [],
				query: {
					clientMessageId: "client-message-1",
					spaceId: "space-123",
					targetProfileId: null,
				},
			}),
			leaveSpace: vi.fn().mockResolvedValue({
				leftProfileId: DEFAULT_SPACE_PROFILE_ID,
				status: "left",
			}),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			organizationDirectory: createPersonalScoutDirectoryFixture(),
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentOwnerUserId: "user-mira",
				}),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding({
			accountProfiles: [
				createLandingAccountProfile({
					openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "human",
					profileName: "Mira",
				}),
				createLandingAccountProfile({
					openMeldProfileId: SECOND_AGENT_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "agent",
					profileName: "Scout",
				}),
			],
			organizationScope: createOrganizationScope({ isPersonal: true }),
		});

		fireEvent.click(
			screen.getByRole("button", { name: MEMBERS_TOGGLE_BUTTON_NAME })
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Add People or Agents" })
		);
		fireEvent.click(screen.getByRole("checkbox", { name: SCOUT_OPTION_NAME }));
		fireEvent.click(screen.getByRole("button", { name: "Add 1 member" }));

		await waitFor(
			() => {
				expect(membersRefetchMock).toHaveBeenCalledTimes(1);
			},
			{ timeout: 3000 }
		);
		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		for (const invalidation of buildSharedReadinessCacheInvalidations()) {
			expect(invalidateQueriesMock).toHaveBeenCalledWith(
				expect.objectContaining(invalidation),
				{ cancelRefetch: false }
			);
		}
	});

	it("adds a newly created Space agent only after confirmation without repeating the Core membership write", async () => {
		const executionTarget = {
			deviceId: "device-office",
			runtimeLane: "dev-local",
			openMeldServiceRuntimeId: "runtime-office",
			isCurrent: true,
			capabilities: [],
			localAgentControl: {
				refreshCatalog: true,
				setEnabled: true,
				setProfileWorkspace: true,
			},
			localAgentCatalog:
				createStartStateWithCodexCatalog().state.readModel.device.value
					.deviceAgentCatalog,
		};
		const computer = {
			deviceId: "device-office",
			deviceDisplayName: "Office Mac mini",
			connection: { status: "connected", sessions: [], reasonCodes: [] },
			isCurrent: true,
			executionTargets: [executionTarget],
		};
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			deviceId: "device-office",
			runtimeLane: "dev-local",
			currentComputer: computer,
			selectedExecutionTarget: executionTarget,
			currentLocalRuntimeReplyReadinessQuery: {
				data: createCurrentLocalRuntimeReplyReadiness({
					canReplyFromThisComputer: true,
					primaryBlocker: "none",
					serviceConnected: true,
					status: "ready",
				}),
			},
			localRuntimesQuery: {
				data: {
					localRuntimes: [computer],
					peopleComputers: { computers: [computer] },
				},
			},
		});
		const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
		const queryClient = createTestQueryClient();
		vi.spyOn(queryClient, "invalidateQueries").mockImplementation(
			invalidateQueriesMock
		);
		const directory = createOrganizationDirectoryFixture({
			centerAgentProfileId: SECOND_AGENT_PROFILE_ID,
			humanProfileId: DEFAULT_SPACE_PROFILE_ID,
		});
		const [createdAgent] = directory.agentProfiles;
		if (!createdAgent) {
			throw new Error("Expected an Agent directory fixture");
		}
		createdAgent.isCenterAgent = false;
		createdAgent.profileName = "Scout";
		createdAgent.profileHandle = "scout";
		const [owner] = directory.members;
		if (!owner) {
			throw new Error("Expected an owner directory fixture");
		}
		owner.userId = "user-mira";
		owner.memberName = "Mira";
		const rawDirectory: OrganizationDirectoryResponse = {
			organizationId: "org-acme",
			generatedAt: "2026-07-16T00:00:00.000Z",
			agentProfiles: [],
			members: [
				{
					memberId: "member-mira",
					organizationId: "org-acme",
					userId: "user-mira",
					role: "owner",
					joinedAt: "2026-07-16T00:00:00.000Z",
					humanProfile: owner.humanProfile,
					user: {
						id: "user-mira",
						name: "Mira",
						email: "mira@example.test",
						image: null,
					},
				},
			],
		};
		directory.agentProfiles = [];
		const directoryQuery: Record<string, unknown> = createQueryResult({
			isSuccess: true,
			data: directory,
		});
		createAgentProfileCreationRequestMock.mockImplementation(
			(request: WebCreateAgentProfileCreationRequestInput) => {
				directoryQuery.data = { ...directory, agentProfiles: [createdAgent] };
				return Promise.resolve(
					buildCompletedAgentProfileCreationRequest(request)
				);
			}
		);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const newAgentOfflineSnapshot = createMembersSnapshot({
			defaultAgentOwnerUserId: "user-mira",
			extraAgents: [
				{
					agentExecutionReadiness:
						createStaleLocalReadinessAgentExecutionReadiness(
							SECOND_AGENT_PROFILE_ID
						),
					mentionAlias: "scout",
					profileId: SECOND_AGENT_PROFILE_ID,
					profileName: "Scout",
				},
			],
		});
		const membersQuery = createQueryResult({
			isSuccess: true,
			data: createMembersSnapshot({
				defaultAgentOwnerUserId: "user-mira",
			}),
		}) as unknown as Record<string, unknown> & {
			data: ReturnType<typeof createMembersSnapshot>;
			refetch: ReturnType<typeof vi.fn>;
		};
		const membersRefetchMock = vi.fn().mockImplementation(() => {
			if (!addOrganizationDirectoryProfilesToSpaceMock.mock.calls.length) {
				return Promise.resolve({ data: membersQuery.data });
			}
			membersQuery.data = newAgentOfflineSnapshot;
			return Promise.resolve({ data: newAgentOfflineSnapshot });
		});
		membersQuery.refetch = membersRefetchMock;
		const addMembersMock = vi.fn().mockResolvedValue({
			addedMemberIds: [SECOND_AGENT_PROFILE_ID],
			alreadyMemberIds: [],
			items: [],
		});
		const addOrganizationDirectoryProfilesToSpaceMock = vi
			.fn()
			.mockResolvedValue({
				addedMemberIds: [SECOND_AGENT_PROFILE_ID],
				alreadyMemberIds: [],
				items: [],
			});
		useQueryClientMock.mockReturnValue(queryClient);
		createWebSpaceApiMock.mockReturnValue({
			addMembers: addMembersMock,
			addOrganizationDirectoryProfilesToSpace:
				addOrganizationDirectoryProfilesToSpaceMock,
			deleteSpace: vi.fn().mockResolvedValue({
				deleted: true,
				spaceId: "space-123",
			}),
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: vi.fn().mockResolvedValue({
				items: [],
				query: {
					clientMessageId: "client-message-1",
					spaceId: "space-123",
					targetProfileId: null,
				},
			}),
			leaveSpace: vi.fn().mockResolvedValue({
				leftProfileId: DEFAULT_SPACE_PROFILE_ID,
				status: "left",
			}),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			organizationDirectoryQuery: directoryQuery,
			organizationDirectoryResponse: rawDirectory,
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: membersQuery,
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLandingWithCreateProfileDialogProviders({
			accountProfiles: [
				createLandingAccountProfile({
					openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "human",
					profileName: "Mira",
				}),
			],
		});

		fireEvent.click(
			screen.getByRole("button", { name: MEMBERS_TOGGLE_BUTTON_NAME })
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Add People or Agents" })
		);
		fireEvent.click(screen.getByRole("button", { name: "New Agent" }));
		const dialog = await screen.findByRole("dialog", {
			name: "Create an Agent",
		});
		fireEvent.click(
			await within(dialog).findByRole("radio", { name: "Codex" })
		);
		fireEvent.change(await within(dialog).findByLabelText("Agent name"), {
			target: { value: "Scout" },
		});
		const submitButton = within(dialog).getByRole("button", {
			name: "Create Agent",
		}) as HTMLButtonElement;
		await waitFor(() => {
			expect(submitButton.disabled).toBe(false);
		});
		vi.useFakeTimers();
		fireEvent.click(submitButton);
		await flushPromiseQueue();
		expect(screen.getByRole("button", { name: "Add 1 member" })).toBeTruthy();
		expect(createAgentProfileCreationRequestMock).toHaveBeenCalledWith(
			expect.objectContaining({
				configuration: expect.objectContaining({
					agentControllerRef: "builtin:codex",
					defaultProjectId: null,
					targetComputerId: "device-office",
				}),
				idempotencyKey: expect.any(String),
				organizationId: "org-acme",
				profileName: "Scout",
				targetOwnerUserId: "user-mira",
			})
		);
		expect(addMembersMock).not.toHaveBeenCalled();
		expect(
			createAgentProfileCreationRequestMock.mock.calls[0]?.[0].requestedSpaceId
		).toBeNull();
		expect(addOrganizationDirectoryProfilesToSpaceMock).not.toHaveBeenCalled();
		const refreshesBeforeAdd = membersRefetchMock.mock.calls.length;
		fireEvent.click(screen.getByRole("button", { name: "Add 1 member" }));
		await flushPromiseQueue();
		expect(
			addOrganizationDirectoryProfilesToSpaceMock
		).toHaveBeenCalledExactlyOnceWith({
			directoryProfileIds: [SECOND_AGENT_PROFILE_ID],
			spaceId: "space-123",
		});
		expect(membersRefetchMock.mock.calls.length).toBeGreaterThan(
			refreshesBeforeAdd
		);
		expect(notifyAgentExecutionReadinessRefreshMock).toHaveBeenCalledWith({
			agentProfileIds: [SECOND_AGENT_PROFILE_ID],
			organizationId: "org-acme",
		});
		expect(
			notifyAgentExecutionReadinessRefreshMock.mock.invocationCallOrder[0] ?? 0
		).toBeLessThan(membersRefetchMock.mock.invocationCallOrder[0] ?? 0);
		for (const invalidation of buildSharedReadinessCacheInvalidations()) {
			expect(invalidateQueriesMock).toHaveBeenCalledWith(
				expect.objectContaining(invalidation),
				{ cancelRefetch: false }
			);
		}

		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});

		expect(addOrganizationDirectoryProfilesToSpaceMock).toHaveBeenCalledTimes(
			1
		);
		expect(addMembersMock).not.toHaveBeenCalled();
	});

	it("hides the Get-set-up Add agents row when an account agent is already a Space member even if owner metadata lags", () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentOwnerUserId: null,
					defaultAgentProfileName: "Scout",
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding({
			accountProfiles: [
				createLandingAccountProfile({
					openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "human",
					profileName: "Mira",
				}),
				createLandingAccountProfile({
					openMeldProfileId: DEFAULT_AGENT_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "agent",
					profileName: "Scout",
				}),
			],
		});

		expect(screen.queryByRole("region", { name: "Get set up" })).toBeNull();
		expect(screen.queryByText("Bring your agents")).toBeNull();
	});

	it("keeps confirmed private history visible when a background status refresh fails", () => {
		mockSpaceQueries({
			status: createQueryResult({
				isError: true,
				data: createSpaceStatus(),
				error: {
					code: "gateway.http_error",
					message:
						"OpenMeld couldn't reach the gateway upstream for this request.",
					requestId: "req-status-refresh-502",
					status: 502,
					upstreamCode: null,
				},
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "signal-private-history-refresh-failed",
							text: "Private launch numbers",
							ts: 1,
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(screen.getByText("Private launch numbers")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Design Room" })).toBeTruthy();
		expect(screen.queryByText("Couldn't Load This Space")).toBeNull();
	});

	it("keeps confirmed private history visible while status refreshes in the background", () => {
		mockSpaceQueries({
			status: createQueryResult({
				data: createSpaceStatus(),
				isFetchedAfterMount: false,
				isFetching: true,
				isSuccess: true,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "signal-private-history-revalidation-pending",
							text: "Private launch numbers",
							ts: 1,
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(screen.getByText("Private launch numbers")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Design Room" })).toBeTruthy();
		expect(screen.queryByText("Couldn't Load This Space")).toBeNull();
	});

	it.each([
		false,
		true,
	])("keeps the same editor and draft when a cold Space finishes loading (Center Agent: %s)", async (isCenterAgentDirectMessage) => {
		const postNormalMessageMock = vi.fn();
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			bootstrap: createQueryResult({
				isFetching: true,
				isPending: true,
			}),
			status: createQueryResult({
				isFetchedAfterMount: false,
				isFetching: true,
				isPending: true,
			}),
			members: createQueryResult({
				isPending: true,
			}),
			history: createQueryResult({
				isPending: true,
			}),
		});

		const rendered = renderSpaceLanding({ isCenterAgentDirectMessage });
		const loadingComposer = screen.getByRole("textbox");
		expect(loadingComposer).toBeInstanceOf(HTMLDivElement);
		expect(loadingComposer.getAttribute("contenteditable")).toBe("true");
		expect(document.querySelector('textarea[name="space-message"]')).toBeNull();
		expect(screen.queryByRole("button", { name: "Add" })).toBeTruthy();
		loadingComposer.focus();
		await setComposerValue(loadingComposer, "Draft from the first frame");
		expect(
			(
				screen.getByRole("button", {
					name: "Send message",
				}) as HTMLButtonElement
			).disabled
		).toBe(false);
		expect(postNormalMessageMock).not.toHaveBeenCalled();

		mockSpaceQueries({
			status: createQueryResult({ isSuccess: true, data: createSpaceStatus() }),
			members: createQueryResult({ isPending: true }),
			history: createQueryResult({ isPending: true }),
		});
		rendered.rerender(
			<SpaceLanding
				isCenterAgentDirectMessage={isCenterAgentDirectMessage}
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);
		expect(screen.getByRole("textbox")).toBe(loadingComposer);
		expect(loadingComposer.getAttribute("contenteditable")).toBe("true");

		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});
		rendered.rerender(
			<SpaceLanding
				isCenterAgentDirectMessage={isCenterAgentDirectMessage}
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);

		await waitFor(() => {
			const confirmedComposer = screen.getByRole("textbox");
			expect(confirmedComposer).toBe(loadingComposer);
			expect(readComposerValue(confirmedComposer)).toBe(
				"Draft from the first frame"
			);
			expect(document.activeElement).toBe(confirmedComposer);
		});
		expect(
			(
				screen.getByRole("button", {
					name: "Send message",
				}) as HTMLButtonElement
			).disabled
		).toBe(false);
	});

	it.each([
		false,
		true,
	])("keeps saved authoring natural and confirms access on Send (status already succeeded: %s)", async (statusConfirmed) => {
		const postNormalMessageMock = vi.fn().mockResolvedValue(
			createTextSignal({
				id: "signal-sent-after-access-confirmation",
				text: "Draft while access settles",
				ts: 2,
			})
		);
		const currentStatus = createSpaceStatus();
		const statusRefetch = vi.fn().mockResolvedValue({
			data: currentStatus,
			error: null,
		});
		const ensureEntryConfirmed = vi.fn().mockResolvedValue(true);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			bootstrap: createQueryResult({
				isFetching: true,
				isPending: true,
			}),
			displaySnapshot: createQueryResult({
				isSuccess: true,
				data: createSpaceConversationDisplaySnapshot(createSpaceStatus()),
			}),
			status: createQueryResult({
				isFetchedAfterMount: false,
				isFetching: true,
				isPending: !statusConfirmed,
				isSuccess: statusConfirmed,
				data: statusConfirmed ? currentStatus : undefined,
				refetch: statusRefetch,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "signal-private-history-awaiting-first-status",
							text: "Private launch numbers",
							ts: 1,
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding({
			entryConfirmed: false,
			ensureEntryConfirmed,
		});

		expect(screen.getByText("Private launch numbers")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Design Room" })).toBeTruthy();
		const composer = screen.getByRole("textbox", {
			name: "Message this space",
		});
		expect(composer.getAttribute("contenteditable")).toBe("true");
		expect(composer.getAttribute("aria-placeholder")).toBe(
			"To wake an agent, type @, then pick the agent."
		);
		await setComposerValue(composer, "Draft while access settles");
		expect(readComposerValue(composer)).toBe("Draft while access settles");
		const mentionButton = screen.getByRole("button", {
			name: "Mention a member",
		});
		expect((mentionButton as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(mentionButton);
		const mentionSearch = await screen.findByRole("combobox", {
			name: "Find a member to mention",
		});
		fireEvent.keyDown(mentionSearch, { key: "Escape" });
		fireEvent.click(screen.getByRole("button", { name: "Add" }));
		const filesItem = await screen.findByRole("menuitem", { name: "Files" });
		expect(filesItem.getAttribute("aria-disabled")).toBe("true");
		expect(
			(screen.getByLabelText("Choose files to send") as HTMLInputElement)
				.disabled
		).toBe(true);
		fireEvent.keyDown(filesItem, { key: "Escape" });
		expect(
			(
				screen.getByRole("button", {
					name: "Send message",
				}) as HTMLButtonElement
			).disabled
		).toBe(false);
		const membersButton = screen.getByRole("button", {
			name: MEMBERS_TOGGLE_BUTTON_NAME,
		});
		expect(membersButton.textContent).toBe("2");
		fireEvent.click(membersButton);
		expect(membersButton.getAttribute("aria-expanded")).toBe("true");
		expect(screen.queryByRole("dialog", { name: "Members" })).toBeNull();
		expect(
			screen.queryByRole("button", {
				name: "Add People or Agents",
			})
		).toBeNull();
		fireEvent.click(membersButton);
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		await waitFor(() => expect(ensureEntryConfirmed).toHaveBeenCalledTimes(1));
		expect(statusRefetch).toHaveBeenCalled();
		await waitFor(() => expect(postNormalMessageMock).toHaveBeenCalledTimes(1));
		expect(
			screen.queryByText(
				"Checking access before you can send. Your draft stays here."
			)
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		expect(screen.queryByRole("button", { name: "Leave space" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Delete space" })).toBeNull();
		expect(screen.queryByText("Couldn't Load This Space")).toBeNull();
	});

	it("keeps the draft and reports not sent when access confirmation cannot finish", async () => {
		const postNormalMessageMock = vi.fn();
		const ensureEntryConfirmed = vi
			.fn()
			.mockRejectedValue(new Error("Network unavailable"));
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			bootstrap: createQueryResult({
				isFetching: true,
				isPending: true,
			}),
			displaySnapshot: createQueryResult({
				isSuccess: true,
				data: createSpaceConversationDisplaySnapshot(createSpaceStatus()),
			}),
			status: createQueryResult({
				isFetching: true,
				isPending: true,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding({
			entryConfirmed: false,
			ensureEntryConfirmed,
		});
		const composer = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await setComposerValue(composer, "Keep this draft");
		fireEvent.keyDown(composer, { key: "Enter" });

		await waitFor(() =>
			expect(
				screen.getByText(
					"Message not sent. Check your connection and try again."
				)
			).toBeTruthy()
		);
		expect(readComposerValue(composer)).toBe("");
		expect(screen.getByText("Keep this draft")).toBeTruthy();
		expect(postNormalMessageMock).not.toHaveBeenCalled();
	});

	it.each([
		"space.forbidden",
		"space.membership_required",
	])("hides cached private history when the current Space status denies access with %s", async (code) => {
		const accessDeniedFailure = {
			code,
			message: "You no longer have access to this space.",
			requestId: "req-status-refresh-403",
			status: 403,
			upstreamCode: null,
		};
		mockSpaceQueries({
			bootstrap: createQueryResult({
				isError: true,
				error: accessDeniedFailure,
			}),
			status: createQueryResult({
				isError: true,
				data: createSpaceStatus(),
				error: accessDeniedFailure,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "signal-private-history",
							text: "Private launch numbers",
							ts: 1,
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLandingWithCreateProfileDialogProviders();

		expect(screen.queryByText("Private launch numbers")).toBeNull();
		await waitFor(() => {
			expect(clearSpaceConversationCacheMock).toHaveBeenCalledWith(
				expect.objectContaining({
					spaceId: "space-123",
					openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
				})
			);
		});
		expect(screen.queryByRole("heading", { name: "Design Room" })).toBeNull();
		expect(screen.getByText("Couldn't Load This Space")).toBeTruthy();
		expect(
			screen.getByText(`Request ID: ${accessDeniedFailure.requestId}`)
		).toBeTruthy();
	});

	it("repairs account Space history after Core confirms the current profile is an active member", async () => {
		const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
		useQueryClientMock.mockReturnValue({
			invalidateQueries: invalidateQueriesMock,
			setQueryData: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await waitFor(() => {
			expect(upsertProfileSpaceHistoryMock).toHaveBeenCalledWith({
				data: {
					lastSeenTs: expect.any(Number),
					items: [{ profileId: DEFAULT_SPACE_PROFILE_ID }],
					spaceId: "space-123",
					spaceName: "Design Room",
				},
			});
		});
		await waitFor(() => {
			expect(invalidateQueriesMock).toHaveBeenCalledWith({
				queryKey: ["spaces", "account-spaces"],
			});
		});
	});

	it("submits a Diagnostic Report pointer without sending message text", async () => {
		const createDiagnosticReportMock = vi.fn().mockResolvedValue({
			createdAtMs: 1_774_979_200_000,
			diagnosticReportId: "diag_reported-agent-reply",
			problemType: "reply_problem",
			reportedSignalId: "sig-agent-reply",
			reporterProfileId: DEFAULT_SPACE_PROFILE_ID,
			replyToSignalId: "sig-human-wake",
			spaceId: "space-123",
			threadId: null,
			wakePointerDerivation: {
				reasonCodes: ["diagnostic_report.reply_target_exact"],
				status: "exact",
			},
			wakePointers: [
				{
					clientMessageId: "cm_wake_123",
					sourceSignalId: "sig-human-wake",
					spaceId: "space-123",
					targetProfileId: DEFAULT_AGENT_PROFILE_ID,
				},
			],
		});
		createWebSpaceApiMock.mockReturnValue({
			createDiagnosticReport: createDiagnosticReportMock,
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: vi.fn().mockResolvedValue({
				items: [],
				query: {
					clientMessageId: "cm_wake_123",
					spaceId: "space-123",
					targetProfileId: DEFAULT_AGENT_PROFILE_ID,
				},
			}),
			leaveSpace: vi.fn(),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-agent-reply",
							meta: {
								dispatchId: "dispatch-123",
								sourceClientMessageId: "cm_wake_123",
								sourceEventId: "sig-human-wake",
								targetProfileId: DEFAULT_AGENT_PROFILE_ID,
							},
							profile: {
								kind: "agent",
								profileId: DEFAULT_AGENT_PROFILE_ID,
								profileName: "Runner",
							},
							replyTo: {
								previewText: "Can you inspect this?",
								profileId: DEFAULT_SPACE_PROFILE_ID,
								profileKind: "human",
								profileName: "Mira",
								signalId: "sig-human-wake",
							},
							text: "Agent answer text must stay out of diagnostics.",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();
		fireEvent.click(
			await screen.findByRole("button", { name: "More actions" })
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "Message details" }));

		expect(createDiagnosticReportMock).not.toHaveBeenCalled();
		expect(
			await screen.findByRole("heading", { name: "Message details" })
		).toBeTruthy();
		expect(screen.getByText("Report issue")).toBeTruthy();
		expect(screen.getByText(DIAGNOSTIC_REPORT_POINTER_COPY)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Send report" }));

		await waitFor(() => {
			expect(createDiagnosticReportMock).toHaveBeenCalledWith({
				body: {
					problemType: "reply_problem",
					reportedSignalId: "sig-agent-reply",
				},
				spaceId: "space-123",
			});
		});
		expect(JSON.stringify(createDiagnosticReportMock.mock.calls)).not.toContain(
			"Agent answer text must stay out of diagnostics."
		);
		expect(screen.getByRole("button", { name: "Issue reported" })).toBeTruthy();
		expect(
			JSON.parse(
				window.localStorage.getItem("openmeld.space.last-diagnostic-report") ??
					"{}"
			)
		).toEqual({
			createdAtMs: 1_774_979_200_000,
			diagnosticReportId: "diag_reported-agent-reply",
			reportedSignalId: "sig-agent-reply",
			replyToSignalId: "sig-human-wake",
			spaceId: "space-123",
			threadId: null,
			wakePointerDerivation: {
				reasonCodes: ["diagnostic_report.reply_target_exact"],
				status: "exact",
			},
			wakePointers: [
				{
					clientMessageId: "cm_wake_123",
					sourceSignalId: "sig-human-wake",
					spaceId: "space-123",
					targetProfileId: DEFAULT_AGENT_PROFILE_ID,
				},
			],
		});
		expect(
			window.localStorage.getItem("openmeld.space.last-diagnostic-report")
		).not.toContain("Agent answer text must stay out of diagnostics.");
	});

	it("shows the conversation notification control in the Space surface", () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(
			screen.getByRole("button", { name: NOTIFICATIONS_BUTTON_NAME_PATTERN })
		).toBeTruthy();
	});

	it("shows the current speaking profile beside the composer send action", async () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding({
			accountProfiles: [
				createLandingAccountProfile({
					openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
					isDefault: true,
					profileName: "Mira",
				}),
				createLandingAccountProfile({
					openMeldProfileId: "22222222-2222-4222-8222-222222222222",
					profileHandle: "jordan",
					profileName: "Jordan",
				}),
			],
		});

		const profileControl = screen.getByRole("combobox", {
			name: "Switch the profile you speak as in this Space",
		});
		const sendButton = screen.getByRole("button", { name: "Send message" });

		expect(profileControl.textContent).toContain("Speaking as Mira");
		expect(profileControl.compareDocumentPosition(sendButton)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(
			screen.queryByText(
				(_, element) =>
					element?.textContent === "Joined as Mira" &&
					element.classList.contains("truncate")
			)
		).toBeNull();
		fireEvent.click(profileControl);
		const profileListbox = await screen.findByRole("listbox");
		expect(
			within(profileListbox).getByRole("option", { name: JORDAN_OPTION_NAME })
		).toBeTruthy();
		expect(screen.queryByText("1 other profile also joined")).toBeNull();
		expect(screen.queryByText("+ 1 profile")).toBeNull();
	});

	it("shows login recovery when a secondary space query gets a 401", () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isError: true,
				error: {
					code: "auth.unauthenticated",
					message: "authentication required",
					requestId: "req-history-401",
					status: 401,
					upstreamCode: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(
			screen.getByText("Your session expired. Sign in again to continue.")
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Sign in again" }).getAttribute("href")
		).toBe("/login?redirect=%2F");
		expect(screen.queryByText("authentication required")).toBeNull();
		expect(screen.queryByRole("button", { name: "Try Again" })).toBeNull();
		expect(screen.queryByText("No messages yet")).toBeNull();
	});

	it("leaves the space after confirmation and returns to the spaces list", async () => {
		const leaveSpaceMock = vi.fn().mockResolvedValue({
			leftProfileId: DEFAULT_SPACE_PROFILE_ID,
			status: "left",
		});
		const cancelQueriesMock = vi.fn().mockResolvedValue(undefined);
		const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
		const removeQueriesMock = vi.fn();
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			leaveSpace: leaveSpaceMock,
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		useQueryClientMock.mockReturnValue({
			cancelQueries: cancelQueriesMock,
			invalidateQueries: invalidateQueriesMock,
			removeQueries: removeQueriesMock,
			setQueryData: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-user",
							messageEnvelope: {
								activationTargets: [DEFAULT_AGENT_PROFILE_ID],
								referenceTargets: [],
								text: "@codex(wake) status check",
							},
							meta: {
								clientMessageId: "client-message-1",
							},
							text: "@codex(wake) status check",
							ts: RECENT_ACTIVITY_TS,
						}),
						createTextSignal({
							id: "sig-route-failed",
							text: "Couldn't route @codex right now",
							ts: RECENT_ACTIVITY_TS + 1,
							meta: {
								clientMessageId: "client-message-1",
								dispatchId: "dispatch-1",
								errorCode: "profile.unbound",
								purpose: DISPATCH_ACTIVITY_FAILED_PURPOSE,
								sourceClientMessageId: "client-message-1",
								sourceEventId: "sig-user",
								targetMentionLabel: "codex",
								targetProfileId: DEFAULT_AGENT_PROFILE_ID,
								transient: true,
							},
							profile: {
								kind: "system",
								profileId: "openmeld-system",
								profileName: "OpenMeld System",
							},
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();
		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		fireEvent.click(screen.getByRole("button", { name: "Leave space" }));
		fireEvent.click(screen.getByRole("button", { name: "Confirm leave" }));

		await waitFor(() => {
			expect(leaveSpaceMock).toHaveBeenCalledWith({
				spaceId: "space-123",
			});
		});
		expect(updateProfileSpaceHistoryStatusMock).toHaveBeenCalledWith({
			data: {
				profileId: DEFAULT_SPACE_PROFILE_ID,
				spaceId: "space-123",
				status: "removed",
				reason: "left_space",
			},
		});
		await waitFor(() => {
			expect(useNavigateMock).toHaveBeenCalledWith({
				to: "/o/acme/spaces",
				replace: true,
			});
		});
		expect(toastMock.success).toHaveBeenCalledWith("You left this Space.");
		expect(cancelQueriesMock).toHaveBeenCalledWith(
			{ queryKey: ["space-files", "space-123"] },
			{ revert: false }
		);
		expect(removeQueriesMock).toHaveBeenCalledWith({
			queryKey: ["space-files", "space-123"],
		});
		expect(invalidateQueriesMock).toHaveBeenCalledWith({
			queryKey: ["spaces", "bootstrap", "space-123"],
		});
		expect(invalidateQueriesMock).not.toHaveBeenCalledWith({
			queryKey: ["spaces", "status", "space-123", DEFAULT_SPACE_PROFILE_ID],
		});
		expect(invalidateQueriesMock).not.toHaveBeenCalledWith({
			queryKey: ["spaces", "members", "space-123", DEFAULT_SPACE_PROFILE_ID],
		});
		expect(invalidateQueriesMock).toHaveBeenCalledWith({
			queryKey: ["spaces", "account-spaces"],
		});
	});

	it("reports refused Leave after optimistically returning to the list", async () => {
		const leaveSpaceMock = vi.fn().mockRejectedValue({
			code: "space.leave_space.creator_forbidden",
			message:
				"The space creator cannot leave this space. Delete the space instead when only you remain.",
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			leaveSpace: leaveSpaceMock,
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();
		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		fireEvent.click(screen.getByRole("button", { name: "Leave space" }));
		fireEvent.click(screen.getByRole("button", { name: "Confirm leave" }));

		await waitFor(() =>
			expect(toastMock.error).toHaveBeenCalledWith(
				"Leave failed: The space creator cannot leave this space. Delete the space instead when only you remain."
			)
		);
		expect(useNavigateMock).toHaveBeenCalledWith({
			to: "/o/acme/spaces",
			replace: true,
		});
		expect(useNavigateMock.mock.invocationCallOrder[0]).toBeLessThan(
			leaveSpaceMock.mock.invocationCallOrder[0]
		);
	});

	it("navigates away before delete finishes and retains account space history", async () => {
		let finishDelete!: (value: { deleted: true; spaceId: string }) => void;
		const pendingDelete = new Promise<{ deleted: true; spaceId: string }>(
			(resolve) => {
				finishDelete = resolve;
			}
		);
		const deleteSpaceMock = vi.fn(() => pendingDelete);
		const cancelQueriesMock = vi.fn().mockResolvedValue(undefined);
		const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
		const removeQueriesMock = vi.fn();
		createWebSpaceApiMock.mockReturnValue({
			deleteSpace: deleteSpaceMock,
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		useQueryClientMock.mockReturnValue({
			cancelQueries: cancelQueriesMock,
			getQueriesData: vi.fn(() => []),
			getQueryData: vi.fn(() => undefined),
			getQueryState: vi.fn(() => undefined),
			invalidateQueries: invalidateQueriesMock,
			removeQueries: removeQueriesMock,
			getQueryCache: () => ({ subscribe: () => () => undefined }),
			setQueriesData: vi.fn(),
			setQueryData: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: {
					...createSpaceStatus(),
					ownerUserIds: ["user-mira"],
				},
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();
		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		fireEvent.click(screen.getByRole("button", { name: "Delete space" }));
		fireEvent.change(screen.getByLabelText(DELETE_CONFIRMATION_LABEL_TEXT), {
			target: { value: "DELETE" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Delete Space" }));

		await waitFor(() => {
			expect(deleteSpaceMock).toHaveBeenCalledOnce();
		});
		await waitFor(() => {
			expect(useNavigateMock).toHaveBeenCalledWith({
				to: "/o/acme/spaces",
				replace: true,
			});
		});
		expect(updateProfileSpaceHistoryStatusMock).not.toHaveBeenCalled();
		expect(removeQueriesMock).not.toHaveBeenCalled();
		finishDelete({ deleted: true, spaceId: "space-123" });
		await waitFor(() => expect(invalidateQueriesMock).toHaveBeenCalled());
		expect(updateProfileSpaceHistoryStatusMock).not.toHaveBeenCalled();
		expect(cancelQueriesMock).toHaveBeenCalledWith(
			{ queryKey: ["space-files", "space-123"] },
			{ revert: false }
		);
		expect(removeQueriesMock).toHaveBeenCalledWith({
			queryKey: ["space-files", "space-123"],
		});
		expect(invalidateQueriesMock).toHaveBeenCalledWith({
			queryKey: ["spaces", "status", "space-123", DEFAULT_SPACE_PROFILE_ID],
		});
		expect(invalidateQueriesMock).toHaveBeenCalledWith({
			queryKey: ["spaces", "members", "space-123", DEFAULT_SPACE_PROFILE_ID],
		});
		expect(invalidateQueriesMock).toHaveBeenCalledWith({
			queryKey: ["spaces", "account-spaces"],
		});
	});

	it("restores a failed delete after optimistic navigation", async () => {
		const deleteSpaceMock = vi.fn().mockRejectedValue({
			code: "space.forbidden",
			message: "Only a Space Owner can delete this Space.",
		});
		createWebSpaceApiMock.mockReturnValue({
			deleteSpace: deleteSpaceMock,
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: {
					...createSpaceStatus(),
					ownerUserIds: ["user-mira"],
				},
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();
		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
		fireEvent.click(screen.getByRole("button", { name: "Delete space" }));
		fireEvent.change(screen.getByLabelText(DELETE_CONFIRMATION_LABEL_TEXT), {
			target: { value: "DELETE" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Delete Space" }));

		await waitFor(() => {
			expect(toastMock.error).toHaveBeenCalledWith(
				"Delete failed: Only a Space Owner can delete this Space.",
				expect.objectContaining({
					duration: Number.POSITIVE_INFINITY,
					action: { label: "Open Space", onClick: expect.any(Function) },
				})
			);
		});
		expect(updateProfileSpaceHistoryStatusMock).not.toHaveBeenCalled();
		expect(useNavigateMock).toHaveBeenCalledWith({
			to: "/o/acme/spaces",
			replace: true,
		});
	});

	it("hides delete space when the current profile is not the creator or owner", () => {
		const baseMembers = createMembersSnapshot();
		const currentHuman = baseMembers.humans[0];
		if (!currentHuman) {
			throw new Error("test requires a current human member");
		}
		const members = {
			...baseMembers,
			humans: [
				{
					...currentHuman,
					memberSource: "joined_directly" as const,
					memberSourceLabel: "Joined directly",
					ownerUserId: "user-mira",
				},
				{
					...currentHuman,
					liveNow: false,
					memberSource: "space_creator" as const,
					memberSourceLabel: "Creator",
					ownerName: "Host",
					ownerUserId: "user-host",
					profileId: "33333333-3333-4333-8333-333333333333",
					profileName: "Host",
				},
			],
			summary: {
				...baseMembers.summary,
				humanCount: 2,
				totalCount: 3,
			},
		};
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: members,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();
		fireEvent.click(screen.getByRole("button", { name: "Space settings" }));
		fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

		expect(screen.getByRole("button", { name: "Leave space" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Delete space" })).toBeNull();
		expect(screen.queryByText("Delete space")).toBeNull();
	});

	it("opens the live stream with the selected agent profile", async () => {
		const getUpdatesMock = vi.fn().mockResolvedValue({
			signals: [],
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: getUpdatesMock,
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			profileId: DEFAULT_AGENT_PROFILE_ID,
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentProfileName: "Codex",
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-seed-agent-live",
							text: "Seed message",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding({
			profileId: DEFAULT_AGENT_PROFILE_ID,
		});

		await waitFor(() => {
			expect(FakeWebSocket.instances).toHaveLength(1);
		});
		expect(screen.queryByText("Joined as Codex")).toBeNull();

		const socketUrl = new URL(FakeWebSocket.instances[0]?.url ?? "");
		expect(socketUrl.searchParams.get("profileId")).toBe(
			DEFAULT_AGENT_PROFILE_ID
		);

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
		});

		await waitFor(() => {
			expect(createWebSpaceApiMock).toHaveBeenCalledWith({
				openMeldProfileId: DEFAULT_AGENT_PROFILE_ID,
			});
			expect(getUpdatesMock).toHaveBeenCalledWith({
				spaceId: "space-123",
				afterSignalId: "sig-seed-agent-live",
				limit: 50,
				signal: expect.any(AbortSignal),
			});
		});
		expect(
			screen.queryByText("Live updates are unavailable right now.")
		).toBeNull();
	});

	it("keeps historical dispatch activity out of the transcript without reviving a Wake", () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-user",
							messageEnvelope: {
								activationTargets: [DEFAULT_AGENT_PROFILE_ID],
								referenceTargets: [],
								text: "@runner(wake) status check",
							},
							meta: {
								clientMessageId: "client-message-1",
							},
							text: "@runner(wake) status check",
							ts: RECENT_ACTIVITY_TS,
						}),
						createTextSignal({
							id: "sig-dispatching",
							text: "Dispatching to @runner...",
							ts: RECENT_ACTIVITY_TS + 1,
							meta: {
								dispatchId: "dispatch-1",
								purpose: DISPATCH_ACTIVITY_DISPATCHING_PURPOSE,
								sourceClientMessageId: "client-message-1",
								sourceEventId: "sig-user",
								targetMentionLabel: "runner",
								targetProfileId: DEFAULT_AGENT_PROFILE_ID,
								transient: true,
							},
							profile: {
								kind: "system",
								profileId: "openmeld-system",
								profileName: "OpenMeld System",
							},
						}),
						createTextSignal({
							id: "sig-replying",
							text: "@runner is replying...",
							ts: RECENT_ACTIVITY_TS + 2,
							meta: {
								dispatchId: "dispatch-1",
								purpose: AGENT_REPLYING_PURPOSE,
								sourceClientMessageId: "client-message-1",
								sourceEventId: "sig-user",
								targetMentionLabel: "runner",
								targetProfileId: DEFAULT_AGENT_PROFILE_ID,
								transient: true,
							},
							profile: {
								kind: "system",
								profileId: "openmeld-system",
								profileName: "OpenMeld System",
							},
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(screen.getByText("@runner(wake) status check")).toBeTruthy();
		const sourceMessage = screen
			.getByText("@runner(wake) status check")
			.closest("[data-message-row-id]");
		expect(sourceMessage).not.toBeNull();
		expect(screen.queryByTestId("space-wake-thinking-indicator")).toBeNull();
		expect(screen.queryByText("Starting Wake for @runner...")).toBeNull();
		expect(screen.queryByText("OpenMeld System")).toBeNull();
	});

	it("restores pending Wake progress from recent message history after page reload", async () => {
		const getWakeProgressMock = vi.fn().mockResolvedValue({
			items: [
				{
					clientMessageId: "client-message-1",
					dispatchId: "dispatch-1",
					message: "@runner is working on Felix's MacBook Pro Codex...",
					phase: "running",
					sourceSignalId: "sig-user",
					targetLabel: "@runner",
					targetProfileId: DEFAULT_AGENT_PROFILE_ID,
					terminal: false,
					updatedAtMs: RECENT_ACTIVITY_TS + 10,
				},
			],
			query: {
				clientMessageId: "client-message-1",
				spaceId: "space-123",
				targetProfileId: null,
			},
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: getWakeProgressMock,
			leaveSpace: vi.fn(),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-user",
							messageEnvelope: {
								activationTargets: [DEFAULT_AGENT_PROFILE_ID],
								referenceTargets: [],
								text: "@runner(wake) status check",
							},
							meta: {
								clientMessageId: "client-message-1",
							},
							text: "@runner(wake) status check",
							ts: RECENT_ACTIVITY_TS,
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await waitFor(() => {
			expect(getWakeProgressMock).toHaveBeenCalledWith({
				signal: expect.any(AbortSignal),
				clientMessageId: "client-message-1",
				includePreviewText: true,
				includeSourceContext: true,
				includeTiming: true,
				includeWaitReason: true,
				includeDeviceWait: true,
				includeWakeStopEligibility: true,
				spaceId: "space-123",
				timeoutMs: 15_000,
			});
		});
		const sourceMessage = screen
			.getByText("@runner(wake) status check")
			.closest("[data-message-row-id]");
		expect(sourceMessage).not.toBeNull();
		// Active Wake progress stays at the conversation tail while its source remains visible.
		const sourceMessageGroup = sourceMessage?.closest("[data-message-row-id]");
		expect(sourceMessageGroup).not.toBeNull();
		await waitFor(() => {
			const thinkingIndicator = screen.getByTestId(
				"space-wake-thinking-indicator"
			);
			expect(thinkingIndicator.textContent).toContain("runner · Working…");
		});
	});

	it("restores active Wake progress from Core when timeline cannot identify the client message", async () => {
		const activeWakeProgressSummary = {
			items: [
				{
					clientMessageId: "client-message-1",
					dispatchId: "dispatch-1",
					message: "@runner is working on Felix's MacBook Pro Codex...",
					phase: "running",
					sourceSignalId: "sig-user",
					targetLabel: "@runner",
					targetProfileId: DEFAULT_AGENT_PROFILE_ID,
					terminal: false,
					updatedAtMs: RECENT_ACTIVITY_TS + 10,
				},
			],
			query: {
				spaceId: "space-123",
				targetProfileId: null,
			},
		};
		let resolveDetailedWakeProgress!: (
			value: typeof activeWakeProgressSummary
		) => void;
		const detailedWakeProgress = new Promise<typeof activeWakeProgressSummary>(
			(resolve) => {
				resolveDetailedWakeProgress = resolve;
			}
		);
		const getActiveWakeProgressMock = vi.fn(
			async () => await detailedWakeProgress
		);
		createWebSpaceApiMock.mockReturnValue({
			getActiveWakeProgress: getActiveWakeProgressMock,
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: vi.fn().mockResolvedValue({
				items: [],
				query: {
					clientMessageId: "client-message-1",
					spaceId: "space-123",
					targetProfileId: null,
				},
			}),
			leaveSpace: vi.fn(),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			activeWakeProgressSummary: createQueryResult({
				isSuccess: true,
				data: {
					...activeWakeProgressSummary,
					get presentationEpoch() {
						return wakeProgressFixture.presentationEpoch;
					},
				},
			}),
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-user",
							messageEnvelope: {
								activationTargets: [DEFAULT_AGENT_PROFILE_ID],
								referenceTargets: [],
								text: "@runner(wake) status check",
							},
							text: "@runner(wake) status check",
							ts: RECENT_ACTIVITY_TS,
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await waitFor(() => {
			expect(getActiveWakeProgressMock).toHaveBeenCalledWith({
				includePreviewText: true,
				includeSourceContext: true,
				includeTiming: true,
				includeWaitReason: true,
				includeDeviceWait: true,
				includeWakeStopEligibility: true,
				spaceId: "space-123",
				timeoutMs: 15_000,
			});
		});
		const sourceMessage = screen
			.getByText("@runner(wake) status check")
			.closest("[data-message-row-id]");
		expect(sourceMessage).not.toBeNull();
		// Active Wake progress stays at the conversation tail while its source remains visible.
		const sourceMessageGroup = sourceMessage?.closest("[data-message-row-id]");
		expect(sourceMessageGroup).not.toBeNull();
		const thinkingIndicator = screen.getByTestId(
			"space-wake-thinking-indicator"
		);
		expect(thinkingIndicator.textContent).toContain("runner · Working…");

		await act(async () => {
			resolveDetailedWakeProgress({
				items: [],
				query: {
					spaceId: "space-123",
					targetProfileId: null,
				},
			});
			await detailedWakeProgress;
		});
	});

	it("queues a Thread follow-up from Core's active-task projection without a local progress cache", async () => {
		const root = createTextSignal({
			id: "thread-root",
			text: "Review the release",
		});
		const source = createTextSignal({
			id: "thread-source",
			text: "Check the build",
		});
		const item = createWakeProgressItem({
			clientMessageId: "thread-request",
			dispatchId: "thread-dispatch",
			phase: "running",
			sourceSignalId: source.id,
			targetLabel: "Center Agent",
			targetProfileId: DEFAULT_AGENT_PROFILE_ID,
			updatedAtMs: RECENT_ACTIVITY_TS + 10,
			sourceContext: {
				profileId: DEFAULT_SPACE_PROFILE_ID,
				profileKind: "human",
				profileName: "Mira",
				messagePreview: "Check the build",
				threadId: "thread-1",
			},
		});
		const postThreadSignal = vi.fn();
		vi.mocked(readOrUpdateSpaceInputQueue).mockResolvedValue({
			items: [],
			conversationContextIncluded: true,
		});
		createWebSpaceApiMock.mockReturnValue({
			postThreadSignal,
			getUpdates: vi.fn().mockResolvedValue({ signals: [] }),
		});
		mockSpaceQueries({
			centerAgentProfileId: DEFAULT_AGENT_PROFILE_ID,
			activeWakeProgressSummary: createQueryResult({
				isSuccess: true,
				isFetchedAfterMount: true,
				data: {
					items: [item],
					get presentationEpoch() {
						return wakeProgressFixture.presentationEpoch;
					},
					query: { spaceId: "space-123", targetProfileId: null },
				},
			}),
			status: createQueryResult({ isSuccess: true, data: createSpaceStatus() }),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentControllerRef: "hosted:center-agent",
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [root], nextCursor: null },
			}),
			threadSignals: createQueryResult({
				isSuccess: true,
				data: { signals: [root, source] },
			}),
			threads: createQueryResult({
				isSuccess: true,
				data: {
					threads: [
						{
							createdAt: "2026-04-11T00:00:00.000Z",
							createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
							rootSignalId: root.id,
							spaceId: "space-123",
							threadId: "thread-1",
							updatedAt: "2026-04-11T00:00:00.000Z",
						},
					],
				},
			}),
		});
		renderSpaceLanding({ isCenterAgentDirectMessage: true });
		fireEvent.click(
			screen.getAllByRole("button", { name: "Open thread" })[0] as HTMLElement
		);
		const panel = screen.getByLabelText("Thread");
		await setComposerValue(
			within(panel).getByRole("textbox"),
			"Only North America."
		);
		fireEvent.click(within(panel).getByRole("button", { name: "Send reply" }));
		await waitFor(() =>
			expect(readOrUpdateSpaceInputQueue).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					mutation: expect.objectContaining({
						action: "enqueue",
						text: "Only North America.",
						target: {
							dispatchId: "thread-dispatch",
							targetProfileId: DEFAULT_AGENT_PROFILE_ID,
						},
					}),
				})
			)
		);
		expect(postThreadSignal).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(within(panel).getByRole("textbox").textContent).not.toContain(
				"Only North America."
			)
		);
	});

	it.each([
		{
			controller: "Center",
			sameAuthor: true,
			otherThread: false,
			starting: false,
		},
		{
			controller: "Center",
			sameAuthor: true,
			otherThread: false,
			starting: true,
		},
		{
			controller: "Local",
			sameAuthor: true,
			otherThread: false,
			starting: false,
		},
		{
			controller: "Local",
			sameAuthor: true,
			otherThread: false,
			starting: true,
		},
		{
			controller: "Local",
			sameAuthor: false,
			otherThread: false,
			starting: false,
		},
		{
			controller: "Local",
			sameAuthor: true,
			otherThread: true,
			starting: false,
		},
		{
			controller: "Local",
			sameAuthor: true,
			otherThread: false,
			starting: false,
			multiple: true,
			reply: false,
		},
		{
			controller: "Local",
			sameAuthor: true,
			otherThread: false,
			starting: false,
			multiple: true,
			reply: true,
		},
		{
			controller: "Local",
			sameAuthor: true,
			otherThread: false,
			starting: false,
			shared: true,
			reply: false,
		},
		{
			controller: "Local",
			sameAuthor: true,
			otherThread: false,
			starting: false,
			shared: true,
			reply: true,
		},
	] as const)("routes follow-ups for $controller with sameAuthor=$sameAuthor, otherThread=$otherThread, starting=$starting, reply=$reply, shared=$shared", async (scenario) => {
		const { controller, sameAuthor, otherThread, starting } = scenario;
		const multiple = "multiple" in scenario && scenario.multiple;
		const reply = "reply" in scenario && scenario.reply;
		const shared = "shared" in scenario && scenario.shared;
		vi.stubGlobal(
			"IntersectionObserver",
			class {
				observe = vi.fn();
				unobserve = vi.fn();
				disconnect = vi.fn();
			}
		);
		const queryClient = createTestQueryClient();
		const item = createWakeProgressItem({
			clientMessageId: "original-message",
			dispatchId: starting ? null : "original-dispatch",
			phase: starting ? "request_sent" : "running",
			sourceSignalId: "original-signal",
			targetLabel: "Center Agent",
			targetProfileId: DEFAULT_AGENT_PROFILE_ID,
			updatedAtMs: RECENT_ACTIVITY_TS + 10,
			...(otherThread
				? {
						sourceContext: {
							profileId: DEFAULT_SPACE_PROFILE_ID,
							profileKind: "human" as const,
							profileName: "Mira",
							messagePreview: "Analyze customers.",
							threadId: "other-thread",
						},
					}
				: {}),
		});
		const items = multiple
			? [
					item,
					{
						...item,
						id: "second-active-response",
						dispatchId: "second-dispatch",
						clientMessageId: "second-message",
						sourceSignalId: "second-signal",
						sourceContext: {
							profileId: DEFAULT_SPACE_PROFILE_ID,
							profileKind: "human" as const,
							profileName: "Mira",
							messagePreview: "Another task.",
							threadId: null,
						},
					},
				]
			: [item];
		setSpaceWakeProgressPresentationItems({
			items,
			openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
			queryClient,
			spaceId: "space-123",
		});
		useQueryClientMock.mockReturnValue(queryClient);
		const postNormalMessage = vi.fn().mockResolvedValue(
			createTextSignal({
				id: "correction-signal",
				text: "Only North America.",
			})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage,
			getActiveWakeProgress: vi.fn().mockResolvedValue({
				items,
				query: { spaceId: "space-123", targetProfileId: null },
			}),
			getWakeProgress: vi.fn().mockResolvedValue({
				items,
				query: { spaceId: "space-123", targetProfileId: null },
			}),
			getUpdates: vi.fn().mockResolvedValue({ signals: [] }),
		});
		const queueMembers = createMembersSnapshot({
			defaultAgentControllerRef:
				controller === "Center" ? "hosted:center-agent" : "builtin:codex",
		});
		if (shared) {
			const human = queueMembers.humans[0];
			if (!human) {
				throw new Error("Expected a Human member.");
			}
			queueMembers.humans.push({
				...human,
				profileId: "22222222-2222-2222-2222-222222222222",
				profileName: "Another member",
			});
		}
		mockSpaceQueries({
			centerAgentProfileId:
				controller === "Center" ? DEFAULT_AGENT_PROFILE_ID : null,
			activeWakeProgressSummary: createQueryResult({
				isSuccess: true,
				isFetchedAfterMount: true,
				data: {
					items,
					get presentationEpoch() {
						return wakeProgressFixture.presentationEpoch;
					},
					query: { spaceId: "space-123", targetProfileId: null },
				},
			}),
			status: createQueryResult({ isSuccess: true, data: createSpaceStatus() }),
			members: createQueryResult({
				isSuccess: true,
				data: queueMembers,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "original-signal",
							text: "Analyze customers.",
							...(sameAuthor
								? {}
								: {
										profile: {
											kind: "human" as const,
											profileId: "22222222-2222-2222-2222-222222222222",
											profileName: "Another member",
										},
									}),
							ts: RECENT_ACTIVITY_TS,
						}),
					],
					nextCursor: null,
				},
			}),
		});
		renderSpaceLanding({
			queryClient,
			isCenterAgentDirectMessage: controller === "Center",
		});
		if (reply) {
			fireEvent.click(screen.getByRole("button", { name: "Reply" }));
		}
		await setComposerValue(screen.getByRole("textbox"), "Only North America.");
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		if (multiple && !reply) {
			await screen.findByText(
				"More than one task is active. Reply to your original request to choose which task to update."
			);
			expect(postNormalMessage).not.toHaveBeenCalled();
			expect(
				vi
					.mocked(readOrUpdateSpaceInputQueue)
					.mock.calls.some(
						([, request]) => request.mutation?.action === "enqueue"
					)
			).toBe(false);
			return;
		}
		if (!sameAuthor || otherThread || (shared && !reply)) {
			await waitFor(() => expect(postNormalMessage).toHaveBeenCalled());
			expect(
				vi
					.mocked(readOrUpdateSpaceInputQueue)
					.mock.calls.some(
						([, request]) => request.mutation?.action === "enqueue"
					)
			).toBe(false);
			return;
		}
		await waitFor(() =>
			expect(readOrUpdateSpaceInputQueue).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					spaceId: "space-123",
					mutation: expect.objectContaining({
						action: "enqueue",
						text: "Only North America.",
						target: {
							...(starting
								? { clientMessageId: "original-message" }
								: { dispatchId: "original-dispatch" }),
							targetProfileId: DEFAULT_AGENT_PROFILE_ID,
						},
					}),
				})
			)
		);
		expect(postNormalMessage).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(screen.getByRole("textbox").textContent).not.toContain(
				"Only North America."
			)
		);
	});

	it.each([
		"request_sent",
		"running",
	] as const)("does not present cached %s progress as current before Core confirms it", async (phase) => {
		const queryClient = createTestQueryClient();
		const cachedItem = createWakeProgressItem({
			clientMessageId: "client-message-stale",
			dispatchId: "dispatch-stale",
			phase,
			sourceSignalId: "sig-user-stale",
			targetLabel: "@runner",
			targetProfileId: DEFAULT_AGENT_PROFILE_ID,
			updatedAtMs: RECENT_ACTIVITY_TS + 10,
		});
		setSpaceWakeProgressPresentationItems({
			items: [cachedItem],
			openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
			queryClient,
			spaceId: "space-123",
		});
		useQueryClientMock.mockReturnValue(queryClient);
		let resolveActiveWakeProgress!: (value: {
			items: never[];
			query: { spaceId: string; targetProfileId: null };
		}) => void;
		const activeWakeProgress = new Promise<{
			items: never[];
			query: { spaceId: string; targetProfileId: null };
		}>((resolve) => {
			resolveActiveWakeProgress = resolve;
		});
		createWebSpaceApiMock.mockReturnValue({
			getActiveWakeProgress: vi.fn(async () => await activeWakeProgress),
			getUpdates: vi.fn().mockResolvedValue({ signals: [] }),
			getWakeProgress: vi.fn().mockResolvedValue({
				items: [],
				query: {
					clientMessageId: "client-message-stale",
					spaceId: "space-123",
					targetProfileId: null,
				},
			}),
			leaveSpace: vi.fn(),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			activeWakeProgressSummary: createQueryResult({
				isSuccess: true,
				isFetching: true,
				isFetchedAfterMount: false,
				data: {
					items: [cachedItem],
					get presentationEpoch() {
						return wakeProgressFixture.presentationEpoch;
					},
					query: { spaceId: "space-123", targetProfileId: null },
				},
			}),
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-user-stale",
							messageEnvelope: {
								activationTargets: [DEFAULT_AGENT_PROFILE_ID],
								referenceTargets: [],
								text: "@runner(wake) status check",
							},
							meta: { clientMessageId: "client-message-stale" },
							text: "@runner(wake) status check",
							ts: RECENT_ACTIVITY_TS - 12 * 60 * 60 * 1000,
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding({ queryClient });

		expect(screen.queryByTestId("space-wake-thinking-indicator")).toBeNull();

		await act(async () => {
			resolveActiveWakeProgress({
				items: [],
				query: { spaceId: "space-123", targetProfileId: null },
			});
			await activeWakeProgress;
		});

		await waitFor(() => {
			expect(screen.queryByTestId("space-wake-thinking-indicator")).toBeNull();
		});
	});

	it("keeps the Wake indicator visible while Core is still posting the final message", async () => {
		const getWakeProgressMock = vi.fn().mockResolvedValue({
			items: [
				{
					clientMessageId: "client-message-1",
					dispatchId: "dispatch-1",
					message: "Posting final message for @runner...",
					phase: "publishing",
					sourceSignalId: "sig-user",
					targetLabel: "@runner",
					targetProfileId: DEFAULT_AGENT_PROFILE_ID,
					terminal: false,
					updatedAtMs: RECENT_ACTIVITY_TS + 10,
				},
			],
			query: {
				clientMessageId: "client-message-1",
				spaceId: "space-123",
				targetProfileId: null,
			},
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: getWakeProgressMock,
			leaveSpace: vi.fn(),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-user",
							messageEnvelope: {
								activationTargets: [DEFAULT_AGENT_PROFILE_ID],
								referenceTargets: [],
								text: "@runner(wake) status check",
							},
							meta: {
								clientMessageId: "client-message-1",
							},
							text: "@runner(wake) status check",
							ts: RECENT_ACTIVITY_TS,
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await waitFor(() => {
			expect(getWakeProgressMock).toHaveBeenCalledWith({
				signal: expect.any(AbortSignal),
				clientMessageId: "client-message-1",
				includePreviewText: true,
				includeSourceContext: true,
				includeTiming: true,
				includeWaitReason: true,
				includeDeviceWait: true,
				includeWakeStopEligibility: true,
				spaceId: "space-123",
				timeoutMs: 15_000,
			});
		});
		const sourceMessage = screen
			.getByText("@runner(wake) status check")
			.closest("[data-message-row-id]");
		expect(sourceMessage).not.toBeNull();
		// Active Wake progress stays at the conversation tail while its source remains visible.
		const sourceMessageGroup = sourceMessage?.closest("[data-message-row-id]");
		expect(sourceMessageGroup).not.toBeNull();
		await waitFor(() => {
			const thinkingIndicator = screen.getByTestId(
				"space-wake-thinking-indicator"
			);
			expect(thinkingIndicator.textContent).toContain("runner · Replying…");
		});
	});

	it.each([
		false,
		true,
	])("does not restore stale running Wake progress after the final reply is visible (Thread: %s)", async (replyInThread) => {
		const finalReply = createTextSignal({
			id: "sig-reply",
			text: "Done.",
			ts: RECENT_ACTIVITY_TS + 20,
			meta: {
				dispatchId: "dispatch-1",
				purpose: AGENT_REPLY_FINAL_PURPOSE,
				targetProfileId: DEFAULT_AGENT_PROFILE_ID,
			},
			profile: {
				kind: "agent",
				profileId: DEFAULT_AGENT_PROFILE_ID,
				profileName: "Runner",
			},
			replyTo: {
				previewText: "@runner(wake) status check",
				profileId: DEFAULT_SPACE_PROFILE_ID,
				profileKind: "human",
				profileName: "Mira",
				signalId: "sig-user",
			},
		});
		const getWakeProgressMock = vi.fn().mockResolvedValue({
			items: [
				{
					clientMessageId: "client-message-1",
					dispatchId: "dispatch-1",
					message: "@runner is working on this computer...",
					phase: "running",
					sourceSignalId: "sig-user",
					targetLabel: "@runner",
					targetProfileId: DEFAULT_AGENT_PROFILE_ID,
					terminal: false,
					updatedAtMs: RECENT_ACTIVITY_TS + 10,
				},
			],
			query: {
				clientMessageId: "client-message-1",
				spaceId: "space-123",
				targetProfileId: null,
			},
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: getWakeProgressMock,
			leaveSpace: vi.fn(),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-user",
							messageEnvelope: {
								activationTargets: [DEFAULT_AGENT_PROFILE_ID],
								referenceTargets: [],
								text: "@runner(wake) status check",
							},
							meta: {
								clientMessageId: "client-message-1",
							},
							text: "@runner(wake) status check",
							ts: RECENT_ACTIVITY_TS,
						}),
						...(replyInThread ? [] : [finalReply]),
					],
					nextCursor: null,
				},
			}),
			threads: createQueryResult({
				isSuccess: true,
				data: {
					threads: replyInThread
						? [
								{
									threadId: "thread-1",
									spaceId: "space-123",
									rootSignalId: "sig-user",
									createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
									createdAt: "2026-04-11T00:00:00.000Z",
									updatedAt: "2026-04-11T00:00:00.000Z",
								},
							]
						: [],
					previews: replyInThread
						? [
								{
									threadId: "thread-1",
									replyCount: 1,
									signals: [finalReply],
									placements: [],
								},
							]
						: [],
				},
			}),
		});

		renderSpaceLanding({ observeVisibleWakeProgress: true });

		if (replyInThread) {
			await waitFor(() => {
				expect(getWakeProgressMock).toHaveBeenCalledWith({
					signal: expect.any(AbortSignal),
					clientMessageId: "client-message-1",
					includePreviewText: true,
					includeSourceContext: true,
					includeTiming: true,
					includeWaitReason: true,
					includeDeviceWait: true,
					includeWakeStopEligibility: true,
					spaceId: "space-123",
					timeoutMs: 15_000,
				});
			});
		} else {
			expect(getWakeProgressMock).not.toHaveBeenCalled();
		}
		expect(screen.getByText("Done.")).toBeTruthy();
		expect(screen.queryByText("Runner replied")).toBeNull();
		expect(screen.queryByText("Agent is working")).toBeNull();
		expect(
			screen.getByTestId("wake-progress-visible-projection").textContent
		).toBe("none");
	});

	it("does not offer local agent repair for non-owned failed Wake progress", async () => {
		const getWakeProgressMock = vi.fn().mockResolvedValue({
			items: [
				{
					clientMessageId: "client-message-1",
					dispatchId: "dispatch-1",
					failureReasonCode: "service.not_running",
					message: "@MYCC-Invoko couldn't reply.",
					phase: "failed",
					sourceSignalId: "sig-user",
					targetLabel: "@MYCC-Invoko",
					targetProfileId: DEFAULT_AGENT_PROFILE_ID,
					terminal: true,
					updatedAtMs: RECENT_ACTIVITY_TS + 10,
				},
			],
			query: {
				clientMessageId: "client-message-1",
				spaceId: "space-123",
				targetProfileId: null,
			},
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: getWakeProgressMock,
			leaveSpace: vi.fn(),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentMentionAlias: "MYCC-Invoko",
					defaultAgentOwnerName: "Ming Yoo",
					defaultAgentOwnerUserId: "user-ming",
					defaultAgentProfileName: "MYCC-Invoko",
					defaultHumanOwnerName: "Felix",
					defaultHumanOwnerUserId: "user-felix",
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-user",
							messageEnvelope: {
								activationTargets: [DEFAULT_AGENT_PROFILE_ID],
								referenceTargets: [],
								text: "@MYCC-Invoko(wake) status check",
							},
							meta: {
								clientMessageId: "client-message-1",
							},
							text: "@MYCC-Invoko(wake) status check",
							ts: RECENT_ACTIVITY_TS,
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await waitFor(() => {
			expect(getWakeProgressMock).toHaveBeenCalledWith({
				signal: expect.any(AbortSignal),
				clientMessageId: "client-message-1",
				includePreviewText: true,
				includeSourceContext: true,
				includeTiming: true,
				includeWaitReason: true,
				includeDeviceWait: true,
				includeWakeStopEligibility: true,
				spaceId: "space-123",
				timeoutMs: 15_000,
			});
		});
		const sourceMessage = document.querySelector('[data-signal-id="sig-user"]');
		expect(sourceMessage).not.toBeNull();
		// MessageHoverActions (the Message-details button) and
		// SpaceMessageWakeThinkingIndicator both render as siblings of the
		// Bubble under the shared data-message-row-id row, not inside the
		// bubble/data-signal-id element itself.
		const sourceMessageRow = sourceMessage?.closest("[data-message-row-id]");
		expect(sourceMessageRow).not.toBeNull();
		const messageDetailsButton = within(
			sourceMessageRow as HTMLElement
		).getByRole("button", { name: "Message details" });
		await waitFor(() => {
			expect(messageDetailsButton.className).toContain("text-destructive");
		});
		expect(
			within(sourceMessageRow as HTMLElement).queryByTestId(
				"space-wake-thinking-indicator"
			)
		).toBeNull();
		fireEvent.click(messageDetailsButton);
		const failedAgentActivity = await screen.findByRole("region", {
			name: "MYCC-Invoko activity",
		});
		expect(
			within(failedAgentActivity).getByText(
				"MYCC-Invoko could not complete this Wake because its computer was not connected to OpenMeld at the time."
			)
		).toBeTruthy();
		expect(
			screen.queryByRole("link", { name: "Check this computer" })
		).toBeNull();
		expect(screen.queryByText(READY_WORD_PATTERN)).toBeNull();
	});

	it("recovers active Wake progress from old message history after page reload", async () => {
		const getWakeProgressMock = vi.fn().mockResolvedValue({
			items: [
				{
					clientMessageId: "client-message-1",
					dispatchId: "dispatch-1",
					message: "@runner is working on Felix's MacBook Pro Codex...",
					phase: "running",
					sourceSignalId: "sig-user",
					targetLabel: "@runner",
					targetProfileId: DEFAULT_AGENT_PROFILE_ID,
					terminal: false,
					updatedAtMs: RECENT_ACTIVITY_TS + 10,
				},
			],
			query: {
				clientMessageId: "client-message-1",
				spaceId: "space-123",
				targetProfileId: null,
			},
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: getWakeProgressMock,
			leaveSpace: vi.fn(),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-user",
							messageEnvelope: {
								activationTargets: [DEFAULT_AGENT_PROFILE_ID],
								referenceTargets: [],
								text: "@runner(wake) old status check",
							},
							meta: {
								clientMessageId: "client-message-1",
							},
							text: "@runner(wake) old status check",
							ts: RECENT_ACTIVITY_TS - 601_000,
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(screen.getByText("@runner(wake) old status check")).toBeTruthy();
		await waitFor(() => {
			expect(getWakeProgressMock).toHaveBeenCalledWith({
				signal: expect.any(AbortSignal),
				clientMessageId: "client-message-1",
				includePreviewText: true,
				includeSourceContext: true,
				includeTiming: true,
				includeWaitReason: true,
				includeDeviceWait: true,
				includeWakeStopEligibility: true,
				spaceId: "space-123",
				timeoutMs: 15_000,
			});
		});
		const sourceMessage = screen
			.getByText("@runner(wake) old status check")
			.closest("[data-message-row-id]");
		expect(sourceMessage).not.toBeNull();
		// Active Wake progress stays at the conversation tail while its source remains visible.
		const sourceMessageGroup = sourceMessage?.closest("[data-message-row-id]");
		expect(sourceMessageGroup).not.toBeNull();
		await waitFor(() => {
			const thinkingIndicator = screen.getByTestId(
				"space-wake-thinking-indicator"
			);
			expect(thinkingIndicator.textContent).toContain("runner · Working…");
		});
	});

	it("does not restore unconfirmed cached Wake progress after switching away from and back to a Space", async () => {
		const cachedItem = {
			clientMessageId: "client-message-1",
			dispatchId: "dispatch-1",
			message: "@runner is working on Felix's MacBook Pro Codex...",
			phase: "running" as const,
			sourceSignalId: "sig-user",
			targetLabel: "@runner",
			targetProfileId: DEFAULT_AGENT_PROFILE_ID,
			terminal: false,
			updatedAtMs: RECENT_ACTIVITY_TS + 10,
		};
		const getWakeProgressMock = vi.fn().mockResolvedValue({
			items: [cachedItem],
			query: {
				clientMessageId: "client-message-1",
				spaceId: "space-123",
				targetProfileId: null,
			},
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: getWakeProgressMock,
			leaveSpace: vi.fn(),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		const queryClient = createTestQueryClient();
		useQueryClientMock.mockReturnValue(queryClient);
		setSpaceWakeProgressPresentationItems({
			items: [cachedItem],
			openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
			queryClient,
			spaceId: "space-123",
		});
		const statusResultsBySpaceId = new Map([
			[
				"space-123",
				createQueryResult({
					isSuccess: true,
					data: {
						...createSpaceStatus(),
						name: "Design Room",
						spaceId: "space-123",
					},
				}),
			],
			[
				"space-456",
				createQueryResult({
					isSuccess: true,
					data: {
						...createSpaceStatus(),
						name: "Ops Room",
						spaceId: "space-456",
					},
				}),
			],
		]);
		const membersResult = createQueryResult({
			isSuccess: true,
			data: createMembersSnapshot(),
		});
		const historyResultsBySpaceId = new Map([
			[
				"space-123",
				createQueryResult({
					isSuccess: true,
					data: {
						envelopes: [
							createTextSignal({
								id: "sig-user",
								messageEnvelope: {
									activationTargets: [DEFAULT_AGENT_PROFILE_ID],
									referenceTargets: [],
									text: "@runner(wake) status check",
								},
								meta: {
									clientMessageId: "client-message-1",
								},
								text: "@runner(wake) status check",
								ts: RECENT_ACTIVITY_TS - 601_000,
							}),
						],
						nextCursor: null,
					},
				}),
			],
			[
				"space-456",
				createQueryResult({
					isSuccess: true,
					data: {
						envelopes: [],
						nextCursor: null,
					},
				}),
			],
		]);
		const threadsResult = createQueryResult({
			isSuccess: true,
			data: {
				previews: [],
				threads: [],
			},
		});
		const threadSignalsResult = createQueryResult({
			isSuccess: true,
			data: {
				signals: [],
			},
		});
		const wakeTraceWaterfallResult = createQueryResult({
			isSuccess: true,
			data: {
				items: [],
				query: {
					clientMessageId: null,
					sourceSignalId: null,
					spaceId: "space-123",
					targetProfileId: null,
				},
			},
		});
		useQueryMock.mockImplementation(
			(options: { queryKey: readonly unknown[] }) => {
				if (!Array.isArray(options.queryKey)) {
					throw new Error("Unexpected non-array query key");
				}
				const directoryResult = resolveEmptyOrganizationDirectoryQueryResult(
					options.queryKey
				);
				if (directoryResult) {
					return directoryResult;
				}
				const modelCatalogResult = resolveModelCatalogQueryResult(
					options.queryKey
				);
				if (modelCatalogResult) {
					return modelCatalogResult;
				}
				const centerAgentDirectMessageProjectionResult =
					resolveCenterAgentDirectMessageProjectionQueryResult(
						options.queryKey
					);
				if (centerAgentDirectMessageProjectionResult) {
					return centerAgentDirectMessageProjectionResult;
				}
				const centerAgentDesignationResult =
					resolveCenterAgentDesignationQueryResult(options.queryKey);
				if (centerAgentDesignationResult) {
					return centerAgentDesignationResult;
				}
				const organizationRoleResult = resolveOrganizationRoleQueryResult(
					options.queryKey
				);
				if (organizationRoleResult) {
					return organizationRoleResult;
				}
				const organizationSpacesResult = resolveOrganizationSpacesQueryResult(
					options.queryKey
				);
				if (organizationSpacesResult) {
					return organizationSpacesResult;
				}
				const spaceInboxUnreadTargetsResult =
					resolveSpaceInboxUnreadTargetsQueryResult(options.queryKey);
				if (spaceInboxUnreadTargetsResult) {
					return spaceInboxUnreadTargetsResult;
				}
				const [scope, kind, spaceId] = options.queryKey;
				if (kind === "account-spaces") {
					return createQueryResult({
						isSuccess: true,
						data: createAccountSpaceSections(),
					});
				}
				if (scope === "user" && kind === "session") {
					return createQueryResult({
						isSuccess: true,
						data: { user: { id: "user-1", name: "Mira" } },
					});
				}
				if (scope !== "spaces") {
					throw new Error(
						`Unexpected query key: ${JSON.stringify(options.queryKey)}`
					);
				}
				if (kind === "active-wake-progress-summary") {
					return createQueryResult({
						isSuccess: true,
						data: {
							items: [],
							query: {
								spaceId: String(spaceId),
								targetProfileId: null,
							},
						},
					});
				}
				if (kind === "bootstrap") {
					if (options.queryKey[3] !== DEFAULT_SPACE_PROFILE_ID) {
						throw new Error(
							`Unexpected query key: ${JSON.stringify(options.queryKey)}`
						);
					}
					const status = statusResultsBySpaceId.get(String(spaceId));
					const history = historyResultsBySpaceId.get(String(spaceId));
					if (!(status && history)) {
						throw new Error(
							`Unexpected query key: ${JSON.stringify(options.queryKey)}`
						);
					}
					return createSpaceBootstrapQueryResult({
						history,
						members: membersResult,
						status,
						threads: threadsResult,
					});
				}
				if (kind === "display-snapshot") {
					return createQueryResult({
						isSuccess: true,
						data: undefined,
					});
				}
				if (kind === "status") {
					if (options.queryKey[3] !== DEFAULT_SPACE_PROFILE_ID) {
						throw new Error(
							`Unexpected query key: ${JSON.stringify(options.queryKey)}`
						);
					}
					const result = statusResultsBySpaceId.get(String(spaceId));
					if (!result) {
						throw new Error(
							`Unexpected query key: ${JSON.stringify(options.queryKey)}`
						);
					}
					return result;
				}
				if (kind === "members") {
					if (options.queryKey[3] !== DEFAULT_SPACE_PROFILE_ID) {
						throw new Error(
							`Unexpected query key: ${JSON.stringify(options.queryKey)}`
						);
					}
					return membersResult;
				}
				if (kind === "history") {
					if (options.queryKey[3] !== DEFAULT_SPACE_PROFILE_ID) {
						throw new Error(
							`Unexpected query key: ${JSON.stringify(options.queryKey)}`
						);
					}
					const result = historyResultsBySpaceId.get(String(spaceId));
					if (!result) {
						throw new Error(
							`Unexpected query key: ${JSON.stringify(options.queryKey)}`
						);
					}
					return result;
				}
				if (kind === "threads") {
					if (options.queryKey[3] !== DEFAULT_SPACE_PROFILE_ID) {
						throw new Error(
							`Unexpected query key: ${JSON.stringify(options.queryKey)}`
						);
					}
					return threadsResult;
				}
				if (kind === "thread-signals") {
					if (options.queryKey[4] !== DEFAULT_SPACE_PROFILE_ID) {
						throw new Error(
							`Unexpected query key: ${JSON.stringify(options.queryKey)}`
						);
					}
					return threadSignalsResult;
				}
				if (kind === "message-details") {
					if (options.queryKey[4] !== DEFAULT_SPACE_PROFILE_ID) {
						throw new Error(
							`Unexpected query key: ${JSON.stringify(options.queryKey)}`
						);
					}
					return createMessageDetailsQueryResult({
						signalId: String(options.queryKey[3] ?? ""),
					});
				}
				if (kind === "wake-trace-waterfall") {
					if (options.queryKey[6] !== DEFAULT_SPACE_PROFILE_ID) {
						throw new Error(
							`Unexpected query key: ${JSON.stringify(options.queryKey)}`
						);
					}
					return wakeTraceWaterfallResult;
				}
				throw new Error(
					`Unexpected query key: ${JSON.stringify(options.queryKey)}`
				);
			}
		);

		const view = renderSpaceLanding({ queryClient });

		await waitFor(() => {
			expect(getWakeProgressMock).toHaveBeenCalledWith({
				signal: expect.any(AbortSignal),
				clientMessageId: "client-message-1",
				includePreviewText: true,
				includeSourceContext: true,
				includeTiming: true,
				includeWaitReason: true,
				includeDeviceWait: true,
				includeWakeStopEligibility: true,
				spaceId: "space-123",
				timeoutMs: 15_000,
			});
		});
		expect(screen.queryByTestId("space-wake-thinking-indicator")).toBeNull();

		view.rerender(
			<SpaceLanding
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-456"
			/>
		);

		await waitFor(() => {
			expect(
				screen.getByText("A Space is where people and agents work together.")
			).toBeTruthy();
		});
		expect(screen.queryByTestId("space-wake-thinking-indicator")).toBeNull();
		expect(getWakeProgressMock.mock.calls[0]?.[0].signal.aborted).toBe(true);
		getWakeProgressMock.mockImplementation(() => new Promise(() => undefined));

		view.rerender(
			<SpaceLanding
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);

		expect(screen.queryByTestId("space-wake-thinking-indicator")).toBeNull();
	});

	it("does not show expired terminal Wake progress returned during history recovery", async () => {
		const getWakeProgressMock = vi.fn().mockResolvedValue({
			items: [
				{
					clientMessageId: "client-message-1",
					dispatchId: "dispatch-1",
					message: "@runner couldn't reply.",
					phase: "failed",
					sourceSignalId: "sig-user",
					targetLabel: "@runner",
					targetProfileId: DEFAULT_AGENT_PROFILE_ID,
					terminal: true,
					updatedAtMs: RECENT_ACTIVITY_TS - 181_000,
				},
			],
			query: {
				clientMessageId: "client-message-1",
				spaceId: "space-123",
				targetProfileId: null,
			},
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: getWakeProgressMock,
			leaveSpace: vi.fn(),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-user",
							messageEnvelope: {
								activationTargets: [DEFAULT_AGENT_PROFILE_ID],
								referenceTargets: [],
								text: "@runner(wake) status check",
							},
							meta: {
								clientMessageId: "client-message-1",
							},
							text: "@runner(wake) status check",
							ts: RECENT_ACTIVITY_TS,
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await waitFor(() => {
			expect(getWakeProgressMock).toHaveBeenCalledWith({
				signal: expect.any(AbortSignal),
				clientMessageId: "client-message-1",
				includePreviewText: true,
				includeSourceContext: true,
				includeTiming: true,
				includeWaitReason: true,
				includeDeviceWait: true,
				includeWakeStopEligibility: true,
				spaceId: "space-123",
				timeoutMs: 15_000,
			});
		});
		await act(async () => {
			await Promise.resolve();
		});
		expect(screen.queryByText("@runner couldn't reply.")).toBeNull();
		expect(screen.queryByRole("link", { name: "Run setup" })).toBeNull();
	});

	it("shows a choose-local-agent action when OpenMeld cannot route an unbound local agent", async () => {
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: vi.fn().mockResolvedValue(undefined),
			runtimeLane: "dev-local",
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentControllerRef: "builtin:codex",
					defaultAgentMentionAlias: "codex",
					defaultAgentProfileName: "Codex",
					defaultAgentExecutionReadiness:
						createMissingBindingAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["profile.unbound"],
						reasonText: "This profile currently has no daemon route",
					},
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-user",
							messageEnvelope: {
								activationTargets: [DEFAULT_AGENT_PROFILE_ID],
								referenceTargets: [],
								text: "@codex(wake) status check",
							},
							meta: {
								clientMessageId: "client-message-1",
							},
							text: "@codex(wake) status check",
							ts: RECENT_ACTIVITY_TS,
						}),
						createTextSignal({
							id: "sig-route-failed",
							text: "Couldn't route @codex right now",
							ts: RECENT_ACTIVITY_TS + 1,
							meta: {
								clientMessageId: "client-message-1",
								dispatchId: "dispatch-1",
								errorCode: "profile.unbound",
								purpose: DISPATCH_ACTIVITY_FAILED_PURPOSE,
								sourceClientMessageId: "client-message-1",
								sourceEventId: "sig-user",
								targetMentionLabel: "codex",
								targetProfileId: DEFAULT_AGENT_PROFILE_ID,
								transient: true,
							},
							profile: {
								kind: "system",
								profileId: "openmeld-system",
								profileName: "OpenMeld System",
							},
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const sourceMessage = screen
			.getByText("@codex(wake) status check")
			.closest("[data-message-row-id]");
		expect(sourceMessage).not.toBeNull();
		const sourceMessageRow = sourceMessage?.closest("[data-message-row-id]");
		expect(sourceMessageRow).not.toBeNull();
		const messageDetailsButton = within(
			sourceMessageRow as HTMLElement
		).getByRole("button", { name: "Message details" });
		fireEvent.click(messageDetailsButton);
		const failedAgentActivity = await screen.findByRole("region", {
			name: "Codex activity",
		});
		expect(
			within(failedAgentActivity).getByText(
				"Codex could not complete this Wake."
			)
		).toBeTruthy();
		const localAgentLink = within(failedAgentActivity).getByRole("link", {
			name: "Choose local agent",
		});
		expect(localAgentLink.getAttribute("href")).toBe(
			`/o/acme/agents?profileId=${DEFAULT_AGENT_PROFILE_ID}`
		);
		expect(ensureWebAgentProfileRuntimeBindingMock).not.toHaveBeenCalled();
	});

	it("shows reconnect guidance for a Core binding mismatch instead of prepare or service status", () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			selectedExecutionTarget: {
				deviceId: "device-office",
				runtimeLane: "dev-local",
				userFacingCommand: "openmeld-dev",
				openMeldServiceRuntimeId: null,
				status: "ready",
				capabilities: [],
				reasonCodes: [],
				lastObservedAtMs: 1_774_979_200_000,
				isCurrent: true,
				localAgentControl: { refreshCatalog: true, setEnabled: true },
				localAgentCatalog:
					createStartStateWithCodexCatalog().state.readModel.device.value
						.deviceAgentCatalog,
			},
			refreshAll: vi.fn().mockResolvedValue(undefined),
			runtimeLane: "dev-local",
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentControllerRef: "builtin:codex",
					defaultAgentMentionAlias: "codex",
					defaultAgentProfileName: "Codex",
					defaultAgentExecutionReadiness:
						createBindingRuntimeMismatchAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["local_service.identity_mismatch"],
						reasonText: "This agent is connected to a different local runtime.",
					},
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(
			screen.queryByRole("region", { name: "Local agent wake warning" })
		).toBeNull();
		const membersPanel = screen.getByRole("complementary", {
			name: "Members",
		});
		expect(
			within(membersPanel).getByRole("button", {
				name: "Reconnect local agent",
			})
		).toBeTruthy();
		expect(
			within(membersPanel).queryByRole("link", {
				name: "Check this computer",
			})
		).toBeNull();
		expect(
			within(membersPanel).queryByRole("link", {
				name: "Check OpenMeld Service status",
			})
		).toBeNull();
		expect(within(membersPanel).queryByText(PREPARE_TEXT)).toBeNull();
	});

	it("refreshes shared readiness facts after a Space recovery action succeeds", async () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
		const fetchQueryMock = vi.fn().mockResolvedValue(undefined);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		useQueryClientMock.mockReturnValue({
			cancelQueries: vi.fn().mockResolvedValue(undefined),
			fetchQuery: fetchQueryMock,
			getQueryData: vi.fn(() => undefined),
			invalidateQueries: invalidateQueriesMock,
			resetQueries: vi.fn().mockResolvedValue(undefined),
			setQueryData: vi.fn(),
		});
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			selectedExecutionTarget: {
				deviceId: "device-office",
				runtimeLane: "dev-local",
				userFacingCommand: "openmeld-dev",
				openMeldServiceRuntimeId: null,
				status: "ready",
				capabilities: [],
				reasonCodes: [],
				lastObservedAtMs: 1_774_979_200_000,
				isCurrent: true,
				localAgentControl: { refreshCatalog: true, setEnabled: true },
				localAgentCatalog:
					createStartStateWithCodexCatalog().state.readModel.device.value
						.deviceAgentCatalog,
			},
			refreshAll: refreshAllMock,
			runtimeLane: "dev-local",
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
			storageScope: "test-storage-scope",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentControllerRef: "builtin:codex",
					defaultAgentMentionAlias: "codex",
					defaultAgentProfileName: "Codex",
					defaultAgentExecutionReadiness:
						createBindingRuntimeMismatchAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["local_service.identity_mismatch"],
						reasonText: "This agent is connected to a different local runtime.",
					},
				}),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding({ organizationScope: createOrganizationScope() });

		fireEvent.click(
			screen.getByRole("button", {
				name: "Reconnect local agent",
			})
		);

		await waitFor(() => {
			expect(ensureWebAgentProfileRuntimeBindingMock).toHaveBeenCalledWith({
				actorProfileId: DEFAULT_SPACE_PROFILE_ID,
				agentProfileId: DEFAULT_AGENT_PROFILE_ID,
				agentControllerRef: "builtin:codex",
				deviceId: "device-office",
				organizationId: "org-acme",
				runtimeLane: "dev-local",
				writeMode: "reconnect",
			});
		});
		expect(notifyAgentExecutionReadinessRefreshMock).toHaveBeenCalledWith({
			agentProfileIds: [DEFAULT_AGENT_PROFILE_ID],
			organizationId: "org-acme",
		});
		for (const invalidation of buildSharedReadinessCacheInvalidations()) {
			expect(invalidateQueriesMock).toHaveBeenCalledWith(
				expect.objectContaining(invalidation),
				{ cancelRefetch: false }
			);
		}
		expect(refreshAllMock).toHaveBeenCalledTimes(1);
		expect(statusRefetchMock).toHaveBeenCalled();
		expect(membersRefetchMock).toHaveBeenCalled();
	});

	it("connects a local agent for failed Wake setup recovery", async () => {
		const membersSnapshot = createMembersSnapshot({
			defaultAgentExecutionReadiness:
				createWorkspaceMissingAgentExecutionReadiness(DEFAULT_AGENT_PROFILE_ID),
			wakeState: "offline",
			wakeability: {
				status: "blocked",
				reasonCodes: ["runtime.projection_missing"],
				reasonText: "Local setup is incomplete",
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: membersSnapshot,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-user",
							messageEnvelope: {
								activationTargets: [DEFAULT_AGENT_PROFILE_ID],
								referenceTargets: [],
								text: "@runner(wake) status check",
							},
							meta: {
								clientMessageId: "client-message-1",
							},
							text: "@runner(wake) status check",
							ts: RECENT_ACTIVITY_TS,
						}),
						createTerminalFailureNoticeSignal({
							actorProfileId: DEFAULT_AGENT_PROFILE_ID,
							dispatchId: "dispatch-1",
							id: "sig-route-failed",
							replyToSignalId: "sig-user",
							text: "Couldn't route @runner right now",
							ts: RECENT_ACTIVITY_TS + 1,
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const sourceMessage = screen
			.getByText("@runner(wake) status check")
			.closest("[data-message-row-id]");
		expect(sourceMessage).not.toBeNull();
		const sourceMessageRow = sourceMessage?.closest("[data-message-row-id]");
		expect(sourceMessageRow).not.toBeNull();
		fireEvent.click(
			within(sourceMessageRow as HTMLElement).getByRole("button", {
				name: MESSAGE_DETAILS_ACTION_NAME_PATTERN,
			})
		);
		const failedAgentActivity = await screen.findByRole("region", {
			name: "Runner activity",
		});
		const connectLocalAgent = await within(failedAgentActivity).findByRole(
			"link",
			{ name: "Connect local agent" }
		);
		expect(connectLocalAgent.getAttribute("href")).toBe(
			"/o/acme/connect?returnTo=space&session=fresh&spaceId=space-123"
		);
	});

	it("does not guess a local agent from the profile name when routing fails", () => {
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: vi.fn().mockResolvedValue(undefined),
			runtimeLane: "dev-local",
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentControllerRef: null,
					defaultAgentMentionAlias: "codex",
					defaultAgentProfileName: "Codex",
					defaultAgentExecutionReadiness:
						createMissingBindingAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["profile.unbound"],
						reasonText: "This profile currently has no daemon route",
					},
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-route-failed",
							text: "Couldn't route @codex right now",
							ts: RECENT_ACTIVITY_TS + 1,
							meta: {
								dispatchId: "dispatch-1",
								errorCode: "profile.unbound",
								purpose: DISPATCH_ACTIVITY_FAILED_PURPOSE,
								targetMentionLabel: "codex",
								targetProfileId: DEFAULT_AGENT_PROFILE_ID,
								transient: true,
							},
							profile: {
								kind: "system",
								profileId: "openmeld-system",
								profileName: "OpenMeld System",
							},
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(
			screen.queryByText(
				"Codex is in this space, but OpenMeld cannot tell which local agent should reply for it yet."
			)
		).toBeNull();
		expect(ensureWebAgentProfileRuntimeBindingMock).not.toHaveBeenCalled();
	});

	it("does not show the wake warning banner for manual-only unbound agents", () => {
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: vi.fn().mockResolvedValue(undefined),
			runtimeLane: "dev-local",
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentProfileName: "Runner",
					defaultAgentExecutionReadiness:
						createMissingBindingAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["profile.unbound"],
						reasonText: "This profile currently has no daemon route",
					},
					extraAgents: [
						{
							agentExecutionReadiness:
								createMissingBindingAgentExecutionReadiness(
									"agt_33333333-3333-3333-3333-333333333333"
								),
							mentionAlias: "watcher",
							profileId: "agt_33333333-3333-3333-3333-333333333333",
							profileName: "Watcher",
							wakeState: "offline",
							wakeability: {
								status: "blocked",
								reasonCodes: ["profile.unbound"],
								reasonText: "This profile currently has no daemon route",
							},
						},
					],
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(
			screen.queryByRole("region", {
				name: "Local agent wake warning",
			})
		).toBeNull();
		expect(ensureWebAgentProfileRuntimeBindingMock).not.toHaveBeenCalled();
	});

	it("keeps mixed member-row recovery actions distinguishable", () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: vi.fn().mockResolvedValue(undefined),
			runtimeLane: "dev-local",
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentProfileName: "Runner",
					defaultAgentExecutionReadiness:
						createServiceUpdateRequiredAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["profile.unbound"],
						reasonText: "This profile currently has no daemon route",
					},
					extraAgents: [
						{
							agentExecutionReadiness:
								createWorkspaceMissingAgentExecutionReadiness(
									"agt_44444444-4444-4444-4444-444444444444"
								),
							mentionAlias: "builder",
							profileId: "agt_44444444-4444-4444-4444-444444444444",
							profileName: "Builder",
							wakeState: "offline",
							wakeability: {
								status: "blocked",
								reasonCodes: ["runtime.projection_missing"],
								reasonText: "Local setup is incomplete",
							},
						},
					],
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(
			screen.queryByRole("region", { name: "Local agent wake warning" })
		).toBeNull();
		const membersPanel = screen.getByRole("complementary", {
			name: "Members",
		});
		// Computer/service-level Runner recovery is owned by the Get-set-up banner,
		// so per-agent member rows do not expose Runner actions.
		expect(
			within(membersPanel).queryByRole("link", {
				name: "Choose local agent",
			})
		).toBeNull();
		expect(
			within(membersPanel).queryByRole("link", {
				name: "Update OpenMeld Service",
			})
		).toBeNull();
		// The prepare_agent_profile agent (Builder) keeps its per-agent setup action,
		// pointing at the shortened Space-recovery connect URL.
		const sharedSetupLinks = within(membersPanel).getAllByRole("link", {
			name: "Connect local agent",
		});
		expect(sharedSetupLinks).toHaveLength(1);
		const sharedSetupHref = sharedSetupLinks[0]?.getAttribute("href") ?? "";
		const sharedSetupParams = new URLSearchParams(
			sharedSetupHref.split("?")[1] ?? ""
		);
		expect(sharedSetupHref.split("?")[0]).toBe("/o/acme/connect");
		// The reconnect URL no longer carries profileId / agentProfileIds.
		expect(sharedSetupParams.get("agentProfileIds")).toBeNull();
		expect(sharedSetupParams.get("profileId")).toBeNull();
		expect(sharedSetupParams.get("reset")).toBeNull();
		expect(sharedSetupParams.get("returnTo")).toBe("space");
		expect(sharedSetupParams.get("session")).toBe("fresh");
		// /o/acme/connect discriminates on returnTo=space; the corridor-only
		// setup=this-computer key is gone.
		expect(sharedSetupParams.get("setup")).toBeNull();
		expect(sharedSetupParams.get("spaceId")).toBe("space-123");
	});

	it("suppresses per-agent computer-level recovery and surfaces the Space setup connect action", () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			// No connected local runtime for this account -> the Space setup planner's
			// device.status resolves to not_connected, so connect_this_computer is
			// available and the "Connect this computer" row renders.
			localRuntimesQuery: {
				isSuccess: true,
				data: { localRuntimes: [] },
			},
			refreshAll: vi.fn().mockResolvedValue(undefined),
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentExecutionReadiness:
						createServiceNotConnectedAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["local_service.not_connected_for_account"],
						reasonText:
							"OpenMeld Service is not connected for this OpenMeld account on this computer.",
					},
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		// The old conversation-level recovery banner is gone for a
		// review_computer-only Space.
		expect(
			screen.queryByRole("region", { name: "Local agent wake warning" })
		).toBeNull();

		// The member row still surfaces the agent's live Offline indicator, but its
		// per-agent reconnect action is suppressed by the shared control (fix 1). This
		// member-row assertion fails if the control-level review_computer gate is
		// removed, so the test guards fix 1, not just the banner-level fix 2.
		const panel = screen.getByRole("complementary", { name: "Members" });
		expectSpaceAgentAvailabilityIndicator(panel, {
			label: "Offline",
			tooltip: "Computer not connected",
		});
		expect(
			within(panel).queryByRole("link", { name: "Reconnect OpenMeld Service" })
		).toBeNull();
		// No per-agent reconnect link survives on any surface.
		expect(
			screen.queryByRole("link", { name: "Reconnect OpenMeld Service" })
		).toBeNull();

		// The empty Space action card owns computer setup guidance and sends the
		// user to the canonical Connect page. The return route preserves this Space
		// so the user comes back after connecting OpenMeld Service.
		expect(screen.getByText("Connect this computer")).toBeTruthy();

		expect(screen.queryByRole("tab", { name: "Graph" })).toBeNull();
		expect(
			screen
				.getByRole("tab", { name: "Messages" })
				.getAttribute("aria-selected")
		).toBe("true");
		expect(screen.getByText("Connect this computer")).toBeTruthy();

		fireEvent.click(
			screen.getByRole("button", {
				name: CONNECT_THIS_COMPUTER_BUTTON_NAME_PATTERN,
			})
		);
		expect(useNavigateMock).toHaveBeenCalledWith({
			to: "/o/acme/connect?returnTo=space&spaceId=space-123",
		});
	});

	it.each([
		"setup",
		"composer",
	])("opens Add People or Agents from %s without opening Members", async (entry) => {
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			localRuntimesQuery: {
				data: { localRuntimes: [] },
				isSuccess: true,
			},
		});
		const members = createMembersSnapshot();
		members.agents = [];
		members.summary = {
			...members.summary,
			agentCount: 0,
			totalCount: 1,
		};
		mockSpaceQueries({
			history: createQueryResult({
				data: { envelopes: [], nextCursor: null },
				isSuccess: true,
			}),
			members: createQueryResult({ data: members, isSuccess: true }),
			status: createQueryResult({
				data: createSpaceStatus(),
				isSuccess: true,
			}),
		});

		renderSpaceLanding({
			accountProfiles: [
				createLandingAccountProfile({
					openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "human",
					profileName: "Mira",
				}),
				createLandingAccountProfile({
					openMeldProfileId: DEFAULT_AGENT_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "agent",
					profileName: "Scout",
				}),
			],
			organizationScope: createOrganizationScope({ isPersonal: true }),
		});

		const setupActions = screen.getByRole("group", {
			name: "Set up this Space",
		});
		expect(
			within(setupActions).getByRole("button", {
				name: CONNECT_THIS_COMPUTER_BUTTON_NAME_PATTERN,
			})
		).toBeTruthy();
		expect(
			within(setupActions).getByRole("button", {
				name: ADD_PEOPLE_OR_AGENTS_BUTTON_NAME_PATTERN,
			})
		).toBeTruthy();

		if (entry === "setup") {
			fireEvent.click(
				within(setupActions).getByRole("button", {
					name: ADD_PEOPLE_OR_AGENTS_BUTTON_NAME_PATTERN,
				})
			);
		} else {
			fireEvent.click(screen.getByRole("button", { name: "Add" }));
			fireEvent.click(
				await screen.findByRole("menuitem", { name: "People or agents" })
			);
		}
		const addMembersDialog = screen.getByRole("dialog", {
			name: "Add People or Agents",
		});
		expect(
			within(addMembersDialog).getByRole("heading", {
				name: "Add People or Agents",
			})
		).toBeTruthy();
		expect(
			within(addMembersDialog).getByRole("button", { name: "New Agent" })
		).toBeTruthy();
		expect(screen.queryByRole("complementary", { name: "Members" })).toBeNull();
		expect(screen.queryByRole("dialog", { name: "Members" })).toBeNull();
	});

	it("does not show ordinary setup guidance in a direct conversation with an agent", () => {
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			localRuntimesQuery: {
				isSuccess: true,
				data: { localRuntimes: [] },
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: {
					...createSpaceStatus(),
					name: "Mira and Center Agent",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				},
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentProfileName: "Center Agent",
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding({
			accountProfiles: [
				createLandingAccountProfile({
					openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "human",
					profileName: "Mira",
				}),
			],
			isCenterAgentDirectMessage: true,
		});

		expect(screen.queryByRole("region", { name: "Get set up" })).toBeNull();
		expect(screen.queryByText("Connect this computer")).toBeNull();
		expect(screen.queryByText("Bring your agents")).toBeNull();
		expect(screen.queryByText("Add your first agent")).toBeNull();
		expect(screen.queryByText(CAN_VIEW_TEXT_PATTERN)).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Join conversation" })
		).toBeNull();
	});

	it("lets an Agent owner view a Direct Message read-only and join explicitly", async () => {
		const convertToSpaceMock = vi.fn().mockResolvedValue({
			accessMode: "members_only",
			addedMemberIds: [DEFAULT_SPACE_PROFILE_ID],
			alreadyMemberIds: [],
			convertedAt: "2026-09-02T00:00:00.000Z",
			name: "Alice, Runner, and Mira",
			spaceId: "space-123",
		});
		createDirectMessageApiMock.mockReturnValue({
			convertToSpace: convertToSpaceMock,
		});
		const members = createMembersSnapshot({
			defaultAgentOwnerName: "Mira",
			defaultAgentOwnerUserId: "user-mira",
			defaultAgentProfileName: "Runner",
			defaultHumanOwnerName: "Alice",
			defaultHumanOwnerUserId: "user-alice",
		});
		members.humans[0] = {
			...members.humans[0],
			profileId: "33333333-3333-4333-8333-333333333333",
			profileName: "Alice",
		};
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: {
					...createSpaceStatus(),
					accessMode: "members_only",
					name: "Alice and Runner",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				},
			}),
			members: createQueryResult({ isSuccess: true, data: members }),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding({
			accountProfiles: [
				createLandingAccountProfile({
					openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "human",
					profileName: "Mira",
				}),
			],
		});

		expect(screen.getByText("View only")).toBeTruthy();
		expect(
			screen
				.getByText("View only")
				.closest('[data-slot="space-window-header-title"]')
		).not.toBeNull();
		expect(
			screen.queryByRole("textbox", { name: "Message Runner" })
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Add People or Agents" })
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Mention a member" })
		).toBeNull();
		expect(
			screen.getByText("Join the conversation to send the first message.")
		).toBeTruthy();
		const joinButtons = screen.getAllByRole("button", {
			name: "Join conversation",
		});
		expect(joinButtons).toHaveLength(2);
		const composerSection = document.querySelector(
			'[data-slot="space-composer-section"]'
		);
		expect(composerSection).not.toBeNull();
		expect(
			within(composerSection as HTMLElement).queryByText(
				"Alice is chatting with your agent, Runner. Join this conversation to send messages."
			)
		).not.toBeNull();
		expect(
			within(composerSection as HTMLElement).queryByRole("button", {
				name: "Send message",
			})
		).toBeNull();
		fireEvent.click(
			within(composerSection as HTMLElement).getByRole("button", {
				name: "Join conversation",
			})
		);
		expect(
			screen.getByRole("heading", {
				name: "Turn this Direct Message into a Space?",
			})
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Turn into a Space" }));

		await waitFor(() => {
			expect(convertToSpaceMock).toHaveBeenCalledWith({
				includeMemberSnapshots: true,
				name: "Alice, Runner, and Mira",
				profileIds: [DEFAULT_SPACE_PROFILE_ID],
				spaceId: "space-123",
			});
		});
	});

	it("tells the active Direct Message participant that the Agent owner can view", () => {
		const members = createMembersSnapshot({
			defaultAgentOwnerName: "Mira",
			defaultAgentOwnerUserId: "user-mira",
			defaultAgentProfileName: "Runner",
			defaultHumanOwnerName: "Alice",
			defaultHumanOwnerUserId: "user-alice",
		});
		members.humans[0] = {
			...members.humans[0],
			profileId: "33333333-3333-4333-8333-333333333333",
			profileName: "Alice",
		};
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: {
					...createSpaceStatus(),
					accessMode: "members_only",
					name: "Alice and Runner",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				},
			}),
			members: createQueryResult({ isSuccess: true, data: members }),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding({
			accountProfiles: [
				createLandingAccountProfile({
					openMeldProfileId: "33333333-3333-4333-8333-333333333333",
					ownerUserId: "user-alice",
					profileKind: "human",
					profileName: "Alice",
				}),
			],
		});

		expect(screen.getByText("Mira can view")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Join conversation" })
		).toBeNull();
	});

	it("keeps the joining Agent owner in membership cache while opening the converted Space", async () => {
		const pendingInvalidation = new Promise<void>(() => undefined);
		const invalidateQueriesMock = vi.fn().mockReturnValue(pendingInvalidation);
		const members = createMembersSnapshot({
			defaultAgentOwnerName: "Mira",
			defaultAgentOwnerUserId: "user-mira",
			defaultAgentProfileName: "Runner",
			defaultHumanOwnerName: "Alice",
			defaultHumanOwnerUserId: "user-alice",
		}) as SpaceMembersSnapshot;
		members.humans[0] = {
			...members.humans[0],
			profileId: "33333333-3333-4333-8333-333333333333",
			profileName: "Alice",
		};
		let cachedMembers = members;
		let cachedStatus: GetSpaceStatusResponse = {
			...createSpaceStatus(),
			accessMode: "members_only",
			name: "Mira and Runner",
			spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
		};
		let cachedAccountSections: AccountSpaceSections = {
			pinnedItems: [],
			spaceItems: [
				{
					activeAgentCount: 1,
					activeHumanCount: 1,
					activeMemberCount: 2,
					directMessageConvertedAt: null,
					joinedProfiles: [],
					lastJoinedAt: "2026-08-08T00:00:00.000Z",
					openProfileId: DEFAULT_SPACE_PROFILE_ID,
					openProfileName: "Mira",
					organizationId: "org-acme",
					pinnedAt: null,
					pinnedProfileIds: [],
					spaceId: "space-123",
					spaceName: "Mira and Runner",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
					visibility: "private",
				},
			],
		};
		let joiningProfileCachedAtNavigation = false;
		let memberCountAtNavigation = 0;
		const setQueryDataMock = vi.fn(
			(queryKey: readonly unknown[], updater: unknown) => {
				if (
					queryKey[0] === "spaces" &&
					queryKey[1] === "members" &&
					typeof updater === "function"
				) {
					cachedMembers = (
						updater as (members: SpaceMembersSnapshot) => SpaceMembersSnapshot
					)(cachedMembers);
				}
				if (
					queryKey[0] === "spaces" &&
					queryKey[1] === "status" &&
					typeof updater === "function"
				) {
					cachedStatus = (
						updater as (
							status: GetSpaceStatusResponse
						) => GetSpaceStatusResponse
					)(cachedStatus);
				}
			}
		);
		const setQueriesDataMock = vi.fn((_filters: unknown, updater: unknown) => {
			if (typeof updater === "function") {
				cachedAccountSections = (
					updater as (sections: AccountSpaceSections) => AccountSpaceSections
				)(cachedAccountSections);
			}
		});
		useQueryClientMock.mockReturnValue({
			cancelQueries: vi.fn().mockResolvedValue(undefined),
			fetchQuery: vi.fn().mockResolvedValue(undefined),
			getQueryData: vi.fn((queryKey: readonly unknown[]) =>
				queryKey[0] === "spaces" && queryKey[1] === "members"
					? cachedMembers
					: undefined
			),
			invalidateQueries: invalidateQueriesMock,
			resetQueries: vi.fn().mockResolvedValue(undefined),
			setQueriesData: setQueriesDataMock,
			setQueryData: setQueryDataMock,
		});
		useNavigateMock.mockImplementation(() => {
			joiningProfileCachedAtNavigation = cachedMembers.humans.some(
				(member) => member.profileId === DEFAULT_SPACE_PROFILE_ID
			);
			memberCountAtNavigation = cachedMembers.summary.totalCount;
			expect(cachedStatus.directMessageConvertedAt).toBe(
				"2026-08-08T00:00:00.000Z"
			);
			expect(cachedStatus.name).toBe("Launch Team");
			expect(cachedStatus.members).toMatchObject({
				humanCount: 2,
				totalCount: 3,
			});
			expect(cachedAccountSections.spaceItems[0]).toMatchObject({
				directMessageConvertedAt: "2026-08-08T00:00:00.000Z",
				spaceName: "Launch Team",
			});
			return Promise.resolve();
		});
		const convertToSpaceMock = vi.fn().mockResolvedValue({
			accessMode: "members_only",
			addedMemberIds: [DEFAULT_SPACE_PROFILE_ID],
			alreadyMemberIds: [],
			convertedAt: "2026-08-08T00:00:00.000Z",
			name: "Launch Team",
			spaceId: "space-123",
		});
		createDirectMessageApiMock.mockReturnValue({
			convertToSpace: convertToSpaceMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: cachedStatus,
			}),
			members: createQueryResult({ isSuccess: true, data: members }),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding({
			accountProfiles: [
				createLandingAccountProfile({
					openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "human",
					profileName: "Mira",
				}),
			],
		});

		fireEvent.click(
			screen.getAllByRole("button", {
				name: "Join conversation",
			})[0] as Element
		);
		fireEvent.change(screen.getByRole("textbox", { name: "Space name" }), {
			target: { value: "Launch Team" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Turn into a Space" }));

		await waitFor(() => {
			expect(convertToSpaceMock).toHaveBeenCalledWith({
				includeMemberSnapshots: true,
				name: "Launch Team",
				profileIds: [DEFAULT_SPACE_PROFILE_ID],
				spaceId: "space-123",
			});
		});
		await flushPromiseQueue();

		await waitFor(() => {
			expect(useNavigateMock).toHaveBeenCalledWith({
				replace: true,
				search: { profileId: DEFAULT_SPACE_PROFILE_ID },
				to: "/o/acme/spaces/space-123",
			});
		});
		expect(joiningProfileCachedAtNavigation).toBe(true);
		expect(memberCountAtNavigation).toBe(3);
	});

	it.each([
		"success",
		"failure",
	])("keeps human Direct Message conversion coherent while background reads are pending (%s)", async (outcome) => {
		const queryClient = createTestQueryClient();
		useQueryClientMock.mockReturnValue(queryClient);
		vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(
			new Promise(() => undefined)
		);
		const members = createMembersSnapshot() as SpaceMembersSnapshot;
		const addedAgent = members.agents[0];
		members.agents = [];
		members.humans.push({
			...members.humans[0],
			profileId: "33333333-3333-4333-8333-333333333333",
			profileName: "Alice",
		});
		members.summary = {
			...members.summary,
			humanCount: 2,
			agentCount: 0,
			totalCount: 2,
		};
		const status = {
			...createSpaceStatus(),
			accessMode: "members_only" as const,
			name: "Mira and Alice",
			spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
			members: {
				...createSpaceStatus().members,
				humanCount: 2,
				agentCount: 0,
				totalCount: 2,
			},
		};
		const membersKey = spaceQueryKeys.members(
			"space-123",
			DEFAULT_SPACE_PROFILE_ID
		);
		const statusKey = spaceQueryKeys.status(
			"space-123",
			DEFAULT_SPACE_PROFILE_ID
		);
		const bootstrapKey = spaceQueryKeys.bootstrap(
			"space-123",
			DEFAULT_SPACE_PROFILE_ID
		);
		queryClient.setQueryData(membersKey, members);
		queryClient.setQueryData(statusKey, status);
		queryClient.setQueryData(bootstrapKey, { members, status });
		const convertedAt = "2026-09-10T08:00:00.000Z";
		const conversionResult = {
			accessMode: "members_only",
			addedMemberIds: [addedAgent.profileId],
			alreadyMemberIds: [],
			convertedAt,
			items: [addedAgent],
			name: "Launch Team",
			spaceId: "space-123",
		};
		let confirmConversion: (result: typeof conversionResult) => void = () =>
			undefined;
		let rejectConversion: (error: Error) => void = () => undefined;
		const convertToSpace = vi.fn().mockReturnValue(
			new Promise((resolve, reject) => {
				confirmConversion = resolve;
				rejectConversion = reject;
			})
		);
		createDirectMessageApiMock.mockReturnValue({ convertToSpace });
		mockSpaceQueries({
			status: createQueryResult({ isSuccess: true, data: status }),
			members: createQueryResult({ isSuccess: true, data: members }),
			organizationDirectory: {
				agentProfiles: [
					{
						agentControllerRef: addedAgent.agentControllerRef,
						createdAt: addedAgent.createdAt,
						isCenterAgent: false,
						lastUsedAt: null,
						ownerName: addedAgent.ownerName ?? undefined,
						ownerUserId: addedAgent.ownerUserId,
						profileHandle: addedAgent.mentionAlias ?? "runner",
						profileId: addedAgent.profileId,
						profileName: addedAgent.profileName,
						status: "active",
					},
				],
				members: [
					{
						avatarImageUrl: null,
						humanProfile: {
							profileHandle: "mira",
							profileId: DEFAULT_SPACE_PROFILE_ID,
							profileName: "Mira",
							status: "active",
						},
						lastActiveAt: "2026-09-10T08:00:00.000Z",
						memberName: "Mira",
						userId: "user-mira",
					},
				],
				organizationId: "org-acme",
			},
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});
		useNavigateMock.mockImplementation(() => {
			expect(
				queryClient.getQueryData<SpaceMembersSnapshot>(membersKey)
			).toMatchObject({
				generatedAt: convertedAt,
				agents: [expect.objectContaining({ profileId: addedAgent.profileId })],
				summary: { totalCount: 3, humanCount: 2, agentCount: 1 },
			});
			expect(queryClient.getQueryData(statusKey)).toMatchObject({
				name: "Launch Team",
				directMessageConvertedAt: convertedAt,
				members: { totalCount: 3, humanCount: 2, agentCount: 1 },
			});
			expect(queryClient.getQueryData(bootstrapKey)).toMatchObject({
				members: {
					generatedAt: convertedAt,
					agents: [
						expect.objectContaining({ profileId: addedAgent.profileId }),
					],
					summary: { totalCount: 3 },
				},
				status: {
					name: "Launch Team",
					members: { totalCount: 3, agentCount: 1 },
				},
			});
			return Promise.resolve();
		});
		renderSpaceLanding({
			queryClient,
			organizationScope: createOrganizationScope({ isPersonal: true }),
			accountProfiles: [
				createLandingAccountProfile({
					openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "human",
					profileName: "Mira",
				}),
				createLandingAccountProfile({
					openMeldProfileId: addedAgent.profileId,
					ownerUserId: "user-mira",
					profileKind: "agent",
					profileName: addedAgent.profileName,
				}),
			],
		});
		fireEvent.click(screen.getByRole("button", { name: "Members, 2 total" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Add People or Agents" })
		);
		fireEvent.click(
			await screen.findByRole("checkbox", { name: addedAgent.profileName })
		);
		fireEvent.click(screen.getByRole("button", { name: "Add 1 member" }));
		fireEvent.change(screen.getByRole("textbox", { name: "Space name" }), {
			target: { value: "Launch Team" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Turn into a Space" }));
		await waitFor(() =>
			expect(convertToSpace).toHaveBeenCalledWith({
				includeMemberSnapshots: true,
				name: "Launch Team",
				profileIds: [addedAgent.profileId],
				spaceId: "space-123",
			})
		);
		expect(useNavigateMock).not.toHaveBeenCalled();
		expect(
			queryClient.getQueryData<SpaceMembersSnapshot>(membersKey)?.summary
				.totalCount
		).toBe(2);
		await act(async () => {
			if (outcome === "failure") {
				rejectConversion(new Error("Conversion rejected"));
			} else {
				confirmConversion(conversionResult);
			}
			await flushPromiseQueue();
		});
		if (outcome === "failure") {
			expect(useNavigateMock).not.toHaveBeenCalled();
			expect(queryClient.getQueryData(membersKey)).toEqual(members);
			expect(queryClient.getQueryData(statusKey)).toEqual(status);
			expect(await screen.findByText("Conversion rejected")).toBeTruthy();
			queryClient.clear();
			return;
		}
		await waitFor(() =>
			expect(useNavigateMock).toHaveBeenCalledWith({
				replace: true,
				search: { profileId: DEFAULT_SPACE_PROFILE_ID },
				to: "/o/acme/spaces/space-123",
			})
		);
		queryClient.clear();
	});

	it("shows only Connect this computer in a Direct Message with the user's own local Agent", () => {
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentLocalRuntimeReplyReadinessQuery: {
				data: undefined,
				isPending: true,
			},
			localRuntimesQuery: {
				isSuccess: true,
				data: { localRuntimes: [] },
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: {
					...createSpaceStatus(),
					name: "Mira and Scout",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				},
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentOwnerUserId: "user-mira",
					defaultAgentProfileName: "Scout",
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding({
			accountProfiles: [
				createLandingAccountProfile({
					openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "human",
					profileName: "Mira",
				}),
				createLandingAccountProfile({
					openMeldProfileId: DEFAULT_AGENT_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "agent",
					profileName: "Scout",
				}),
			],
		});

		expect(
			screen.getByRole("group", { name: "Set up this Space" })
		).toBeTruthy();
		expect(screen.getByText("Connect this computer")).toBeTruthy();
		expect(screen.queryByText("Bring your agents")).toBeNull();
		expect(screen.queryByText("Add your first agent")).toBeNull();
		expect(
			screen.queryByRole("button", {
				name: ADD_PEOPLE_OR_AGENTS_BUTTON_NAME_PATTERN,
			})
		).toBeNull();
	});

	it("does not show setup guidance in a human-to-human Direct Message", () => {
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentLocalRuntimeReplyReadinessQuery: {
				data: undefined,
				isPending: true,
			},
			localRuntimesQuery: {
				isSuccess: true,
				data: { localRuntimes: [] },
			},
		});
		const humanDirectMessageMembers = createMembersSnapshot();
		humanDirectMessageMembers.humans.push({
			...humanDirectMessageMembers.humans[0],
			profileId: "22222222-2222-2222-2222-222222222222",
			profileName: "Felix",
			memberSource: "added_by_member",
			memberSourceLabel: "Added by member",
		});
		humanDirectMessageMembers.agents = [];
		humanDirectMessageMembers.summary = {
			...humanDirectMessageMembers.summary,
			totalCount: 2,
			humanCount: 2,
			agentCount: 0,
		};
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: {
					...createSpaceStatus(),
					name: "Mira and Felix",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
					members: {
						...createSpaceStatus().members,
						totalCount: 2,
						humanCount: 2,
						agentCount: 0,
					},
				},
			}),
			members: createQueryResult({
				isSuccess: true,
				data: humanDirectMessageMembers,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding({
			accountProfiles: [
				createLandingAccountProfile({
					openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
					ownerUserId: "user-mira",
					profileKind: "human",
					profileName: "Mira",
				}),
			],
		});

		expect(screen.queryByRole("region", { name: "Get set up" })).toBeNull();
		expect(screen.queryByText("Connect this computer")).toBeNull();
		expect(
			screen.queryByRole("button", {
				name: ADD_PEOPLE_OR_AGENTS_BUTTON_NAME_PATTERN,
			})
		).toBeNull();
		expect(screen.queryByText(CAN_VIEW_TEXT_PATTERN)).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Join conversation" })
		).toBeNull();
	});

	it("does not write legacy controller compatibility when formal Binding cannot be confirmed", async () => {
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: vi.fn().mockResolvedValue(undefined),
			runtimeLane: "dev-local",
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		ensureWebAgentProfileRuntimeBindingMock.mockResolvedValueOnce({
			agentControllerRef: "builtin:codex",
			reason: "binding_rejected",
			reasonCodes: ["agent_profile_binding.agent_controller_report_missing"],
			routable: false,
			status: "rejected",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentControllerRef: "builtin:codex",
					defaultAgentMentionAlias: "codex",
					defaultAgentProfileName: "Codex",
					defaultAgentExecutionReadiness:
						createMissingBindingAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["profile.unbound"],
						reasonText: "This profile currently has no daemon route",
					},
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-user",
							messageEnvelope: {
								activationTargets: [DEFAULT_AGENT_PROFILE_ID],
								referenceTargets: [],
								text: "@codex(wake) status check",
							},
							meta: {
								clientMessageId: "client-message-1",
							},
							text: "@codex(wake) status check",
							ts: RECENT_ACTIVITY_TS,
						}),
						createTextSignal({
							id: "sig-route-failed",
							text: "Couldn't route @codex right now",
							ts: RECENT_ACTIVITY_TS + 1,
							meta: {
								clientMessageId: "client-message-1",
								dispatchId: "dispatch-1",
								errorCode: "profile.unbound",
								purpose: DISPATCH_ACTIVITY_FAILED_PURPOSE,
								sourceClientMessageId: "client-message-1",
								sourceEventId: "sig-user",
								targetMentionLabel: "codex",
								targetProfileId: DEFAULT_AGENT_PROFILE_ID,
								transient: true,
							},
							profile: {
								kind: "system",
								profileId: "openmeld-system",
								profileName: "OpenMeld System",
							},
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const sourceMessage = screen
			.getByText("@codex(wake) status check")
			.closest("[data-message-row-id]");
		expect(sourceMessage).not.toBeNull();
		const sourceMessageRow = sourceMessage?.closest("[data-message-row-id]");
		expect(sourceMessageRow).not.toBeNull();
		fireEvent.click(
			within(sourceMessageRow as HTMLElement).getByRole("button", {
				name: "Message details",
			})
		);
		const localAgentLink = await screen.findByRole("link", {
			name: "Choose local agent",
		});
		expect(localAgentLink.getAttribute("href")).toBe(
			`/o/acme/agents?profileId=${DEFAULT_AGENT_PROFILE_ID}`
		);
		expect(ensureWebAgentProfileRuntimeBindingMock).not.toHaveBeenCalled();
	});

	it("removes transient dispatch activity after the final agent reply arrives", () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-user",
							text: "@runner(wake) status check",
							ts: RECENT_ACTIVITY_TS,
						}),
						createTextSignal({
							id: "sig-dispatching",
							text: "Dispatching to @runner...",
							ts: RECENT_ACTIVITY_TS + 1,
							meta: {
								dispatchId: "dispatch-1",
								purpose: DISPATCH_ACTIVITY_DISPATCHING_PURPOSE,
								targetMentionLabel: "runner",
								targetProfileId: DEFAULT_AGENT_PROFILE_ID,
								transient: true,
							},
							profile: {
								kind: "system",
								profileId: "openmeld-system",
								profileName: "OpenMeld System",
							},
						}),
						createTextSignal({
							id: "sig-final",
							text: "All good.",
							ts: RECENT_ACTIVITY_TS + 10,
							meta: {
								dispatchId: "dispatch-1",
								purpose: AGENT_REPLY_FINAL_PURPOSE,
							},
							profile: {
								kind: "agent",
								profileId: "agt_22222222-2222-2222-2222-222222222222",
								profileName: "Runner",
							},
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(screen.queryByText("Dispatching to @runner...")).toBeNull();
		expect(screen.getByText("All good.")).toBeTruthy();
		expect(screen.queryByText("OpenMeld System")).toBeNull();
	});

	it("keeps current space agent recovery on member rows instead of the conversation banner", () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		window.localStorage.setItem(SPACE_MEMBERS_PANEL_OPEN_STORAGE_KEY, "open");
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
				isFetching: true,
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			selectedExecutionTarget: {
				deviceId: "device-office",
				runtimeLane: "dev-local",
				userFacingCommand: "openmeld-dev",
				openMeldServiceRuntimeId: null,
				status: "stale",
				capabilities: [],
				reasonCodes: ["background_helper.stale"],
				lastObservedAtMs: null,
				isCurrent: true,
				localAgentControl: { refreshCatalog: false, setEnabled: false },
			},
			startStateQuery: {
				data: {
					state: {
						readModel: {
							profileReadiness: [
								{
									profileId: "agt_22222222-2222-2222-2222-222222222222",
									projection: {
										availability: "ready",
										observedAt: "2026-04-11T00:00:00.000Z",
										observationIssues: [],
										value: {
											deviceId: "device-office",
											profileId: "agt_22222222-2222-2222-2222-222222222222",
											profileKind: "agent",
											observedAt: "2026-04-11T00:00:00.000Z",
											routeObservation: createDaemonRouteObservationSummary({
												observedAt: "2026-04-11T00:00:00.000Z",
												status: "offline",
											}),
											replyReadiness: {
												level: "blocked",
												reasonCodes: ["service.not_running"],
											},
										},
									},
								},
							],
						},
					},
				},
				isFetching: true,
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				isFetching: true,
				data: createMembersSnapshot({
					defaultAgentExecutionReadiness:
						createRunPrepareAgentExecutionReadiness(
							"agt_22222222-2222-2222-2222-222222222222"
						),
					wakeRouteEvidence: createDaemonRouteObservationSummary({
						observedAt: "2026-04-11T00:00:00.000Z",
						status: "offline",
					}),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["route.not_registered"],
						reasonText: "Route still registering",
					},
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const conversation = screen.getByRole("region", {
			name: "Space conversation",
		});
		expect(
			within(conversation).queryByRole("region", {
				name: "Local agent wake warning",
			})
		).toBeNull();
		const membersPanel = screen.getByRole("complementary", {
			name: "Members",
		});
		expect(
			within(membersPanel).queryByRole("region", {
				name: "Local agent wake warning",
			})
		).toBeNull();
		expect(
			within(membersPanel).getByText("2 members in this space")
		).toBeTruthy();
		expect(
			within(membersPanel).queryByText("Refreshing setup status...")
		).toBeNull();
		expect(
			within(membersPanel).queryByRole("button", { name: "Refresh members" })
		).toBeNull();
		expect(
			within(membersPanel).queryByRole("link", {
				name: "Review this computer",
			})
		).toBeNull();
		expect(
			within(membersPanel)
				.getByRole("link", { name: "Connect local agent" })
				.getAttribute("href")
		).toBe("/o/acme/connect?returnTo=space&session=fresh&spaceId=space-123");
	});

	it("keeps non-owned agent readiness visible without local setup controls", () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		window.localStorage.setItem(SPACE_MEMBERS_PANEL_OPEN_STORAGE_KEY, "open");
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			selectedExecutionTarget: {
				deviceId: "device-office",
				runtimeLane: "dev-local",
				userFacingCommand: "openmeld-dev",
				openMeldServiceRuntimeId: null,
				status: "stale",
				capabilities: [],
				reasonCodes: ["background_helper.stale"],
				lastObservedAtMs: null,
				isCurrent: true,
				localAgentControl: { refreshCatalog: false, setEnabled: false },
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: withDefaultAgentAgentWakeAvailability(
					createMembersSnapshot({
						defaultAgentExecutionReadiness:
							createRunPrepareAgentExecutionReadiness(DEFAULT_AGENT_PROFILE_ID),
						defaultAgentOwnerName: "Ming Yoo",
						defaultAgentOwnerUserId: "user-ming",
						defaultAgentRuntimeDeviceDisplayName: "Ming's MacBook Pro",
						wakeState: "offline",
						wakeability: {
							status: "blocked",
							reasonCodes: ["runtime.projection_missing"],
							reasonText: "Local setup is incomplete",
						},
					}) as SpaceMembersSnapshot,
					createTestAgentAgentWakeAvailability("available_for_wake")
				),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-non-owned-agent",
							profile: {
								kind: "agent",
								profileId: DEFAULT_AGENT_PROFILE_ID,
								profileName: "Runner",
							},
							text: "I am checking.",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const panel = screen.getByRole("complementary", {
			name: "Members",
		});
		expect(within(panel).getByText("Runner")).toBeTruthy();
		expectSpaceAgentAvailabilityIndicator(panel, {
			label: "Available",
			tooltip: "Available for Wake",
		});
		expect(within(panel).queryByText(LOCAL_SETUP_PREFERENCE_TEXT)).toBeNull();
		expect(within(panel).queryByText(OWNED_BY_MING_PATTERN)).toBeNull();
		expect(within(panel).queryByText(CONTROLLED_BY_PATTERN)).toBeNull();
		expect(within(panel).queryByRole("link", { name: "Run setup" })).toBeNull();
		expect(
			within(panel).queryByRole("link", { name: "Check this computer again" })
		).toBeNull();
		expect(
			screen.queryByText(
				"Wake mentions may not reach local agents on Office Mac mini"
			)
		).toBeNull();
		expect(screen.getByText("I am checking.")).toBeTruthy();
		expect(
			screen.queryByText("Controlled by Ming's MacBook Pro Codex")
		).toBeNull();
	});

	it("keeps a non-owned agent concise without repeating ownership", () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		window.localStorage.setItem(SPACE_MEMBERS_PANEL_OPEN_STORAGE_KEY, "open");
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentControllerRef: null,
					defaultAgentOwnerName: "Ming Yoo",
					defaultAgentOwnerUserId: "user-ming",
					defaultAgentRuntimeDeviceDisplayName: null,
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-non-owned-agent-no-controller",
							profile: {
								kind: "agent",
								profileId: DEFAULT_AGENT_PROFILE_ID,
								profileName: "Runner",
							},
							text: "I can still reply manually.",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const panel = screen.getByRole("complementary", {
			name: "Members",
		});
		expect(within(panel).getByText("Runner")).toBeTruthy();
		expect(within(panel).queryByText("Owned by Ming Yoo")).toBeNull();
		expect(within(panel).queryByText("managed by Ming Yoo")).toBeNull();
	});

	it("does not show setup recovery when the space member is already wakeable", () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		window.localStorage.setItem(SPACE_MEMBERS_PANEL_OPEN_STORAGE_KEY, "open");
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			currentLocalRuntimeReplyReadinessQuery: {
				data: createCurrentLocalRuntimeReplyReadiness({
					canReplyFromThisComputer: false,
					primaryBlocker: "service_not_connected",
					serviceConnected: false,
					status: "blocked",
				}),
				isPending: false,
			},
			selectedExecutionTarget: {
				deviceId: "device-office",
				runtimeLane: "dev-local",
				userFacingCommand: "openmeld-dev",
				openMeldServiceRuntimeId: null,
				status: "stale",
				capabilities: [],
				reasonCodes: ["background_helper.stale"],
				lastObservedAtMs: null,
				isCurrent: true,
				localAgentControl: { refreshCatalog: false, setEnabled: false },
			},
			startStateQuery: {
				data: {
					state: {
						readModel: {
							profileReadiness: [
								{
									profileId: DEFAULT_AGENT_PROFILE_ID,
									projection: {
										availability: "stale",
										observedAt: "2026-04-11T00:00:00.000Z",
										observationIssues: [],
										value: {
											deviceId: "device-office",
											profileId: DEFAULT_AGENT_PROFILE_ID,
											profileKind: "agent",
											observedAt: "2026-04-11T00:00:00.000Z",
											routeObservation: createDaemonRouteObservationSummary({
												observedAt: "2026-04-11T00:00:00.000Z",
												status: "offline",
											}),
											replyReadiness: {
												level: "blocked",
												reasonCodes: ["service.drifted"],
											},
										},
									},
								},
							],
						},
					},
				},
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					wakeRouteEvidence: createDaemonRouteObservationSummary({
						observedAt: "2026-04-11T00:00:00.000Z",
						status: "online",
					}),
					wakeState: "wakeable",
					wakeability: {
						status: "ready",
						reasonCodes: [],
						reasonText: "Available for Wake",
					},
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const panel = screen.getByRole("complementary", {
			name: "Members",
		});
		expect(within(panel).getByText("Runner")).toBeTruthy();
		expectSpaceAgentAvailabilityIndicator(panel, {
			isRefreshing: false,
			label: "Available",
			tooltip: "Available for Wake",
		});
		expect(within(panel).getByText("Live")).toBeTruthy();
		expect(within(panel).queryByText("Needs setup")).toBeNull();
		expect(
			within(panel).queryByText("Local setup preference: Codex")
		).toBeNull();
		expect(
			within(panel).queryByText("Added by Mira", { exact: false })
		).toBeNull();
		expect(within(panel).queryByRole("link", { name: "Run setup" })).toBeNull();
		expect(
			screen.queryByText(
				"Wake mentions may not reach local agents on Office Mac mini"
			)
		).toBeNull();
		expect(
			screen.queryByText(
				"OpenMeld Service on this computer needs repair before local agents can reply."
			)
		).toBeNull();
	});

	it("opens the full member roster drawer and filters members", async () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		fireEvent.click(
			screen.getByRole("button", { name: MEMBERS_TOGGLE_BUTTON_NAME })
		);

		const dialog = await screen.findByRole("dialog");
		expect(
			within(dialog).getByRole("heading", { name: "Members" })
		).toBeTruthy();
		expect(
			within(dialog).getByRole("heading", { name: "People & Agents" })
		).toBeTruthy();
		expect(within(dialog).getByText("@Runner")).toBeTruthy();

		fireEvent.click(
			within(dialog).getByRole("button", { name: "Search members" })
		);
		fireEvent.change(
			within(dialog).getByRole("textbox", { name: "Search members" }),
			{
				target: { value: "agt_22222222" },
			}
		);

		await waitFor(() => {
			expect(within(dialog).getByText("Runner")).toBeTruthy();
			expect(within(dialog).getByText("Mira")).toBeTruthy();
		});
	});

	it("keeps the desktop member roster closed until the user opens it", async () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const membersButton = screen.getByRole("button", {
			name: MEMBERS_TOGGLE_BUTTON_NAME,
		});
		expect(membersButton.getAttribute("aria-controls")).toBe(
			"space-members-panel"
		);

		const conversationLayout = screen.getByRole("region", {
			name: "Space conversation",
		}).parentElement;
		expect(membersButton.getAttribute("aria-expanded")).toBe("false");
		expect(
			conversationLayout?.getAttribute("data-space-members-panel-open")
		).toBe("false");
		expect(screen.queryByRole("complementary", { name: "Members" })).toBeNull();
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(
			screen.getByRole("log", { name: "Conversation history" })
		).toBeTruthy();

		fireEvent.click(membersButton);
		const panel = await screen.findByRole("complementary", {
			name: "Members",
		});
		expect(membersButton.getAttribute("aria-expanded")).toBe("true");
		expect(
			conversationLayout?.getAttribute("data-space-members-panel-open")
		).toBe("true");
		expect(
			within(panel).getByRole("heading", { name: "Members" })
		).toBeTruthy();
		expect(within(panel).getByText("@Runner")).toBeTruthy();

		fireEvent.click(
			within(panel).getByRole("button", { name: "Search members" })
		);
		fireEvent.change(
			within(panel).getByRole("textbox", { name: "Search members" }),
			{
				target: { value: "agt_22222222" },
			}
		);

		await waitFor(() => {
			expect(within(panel).getByText("Runner")).toBeTruthy();
			expect(within(panel).getByText("Mira")).toBeTruthy();
		});

		fireEvent.click(membersButton);

		await waitFor(() => {
			expect(
				screen.queryByRole("complementary", { name: "Members" })
			).toBeNull();
		});
		expect(membersButton.getAttribute("aria-expanded")).toBe("false");
		expect(
			conversationLayout?.getAttribute("data-space-members-panel-open")
		).toBe("false");
	});

	it("restores the desktop member roster panel state for the current space", async () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		window.localStorage.setItem(SPACE_MEMBERS_PANEL_OPEN_STORAGE_KEY, "open");
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(
			await screen.findByRole("complementary", { name: "Members" })
		).toBeTruthy();
		const membersButton = screen.getByRole("button", {
			name: MEMBERS_TOGGLE_BUTTON_NAME,
		});
		expect(membersButton.getAttribute("aria-expanded")).toBe("true");
	});

	it("restores the desktop member roster closed state for the current space", () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		window.localStorage.setItem(SPACE_MEMBERS_PANEL_OPEN_STORAGE_KEY, "closed");
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const membersButton = screen.getByRole("button", {
			name: MEMBERS_TOGGLE_BUTTON_NAME,
		});
		expect(membersButton.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByRole("complementary", { name: "Members" })).toBeNull();
	});

	it("keeps an explicitly closed member roster panel closed when returning to a space that needs setup", async () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: vi.fn().mockResolvedValue(undefined),
			startStateQuery: {
				data: createStartStateWithCodexCatalog({
					profileReadiness: [
						{
							profileId: DEFAULT_AGENT_PROFILE_ID,
							projection: {
								availability: "ready",
								observedAt: "2026-04-29T00:00:00.000Z",
								observationIssues: [],
								value: {
									deviceId: "device-office",
									observedAt: "2026-04-29T00:00:00.000Z",
									profileId: DEFAULT_AGENT_PROFILE_ID,
									profileKind: "agent",
									routeObservation: createDaemonRouteObservationSummary({
										observedAt: "2026-04-29T00:00:00.000Z",
										status: "offline",
									}),
									replyReadiness: {
										level: "blocked",
										reasonCodes: ["workspace.missing", "service.not_running"],
									},
								},
							},
						},
					],
				}),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentMentionAlias: "codex",
					defaultAgentProfileName: "Codex",
					defaultAgentExecutionReadiness:
						createWorkspaceMissingAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["runtime.projection_missing"],
						reasonText: "Local setup is incomplete",
					},
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		const firstVisit = renderSpaceLanding();

		const panel = screen.getByRole("complementary", {
			name: "Members",
		});
		expect(
			screen
				.getByRole("button", { name: MEMBERS_TOGGLE_BUTTON_NAME })
				.getAttribute("aria-expanded")
		).toBe("true");
		expectSpaceAgentAvailabilityIndicator(panel, {
			label: "Connect",
			tooltip: "Connect local agent",
		});
		expect(within(panel).queryByText("Needs setup")).toBeNull();
		expect(
			within(panel).getAllByText("Connect local agent").length
		).toBeGreaterThan(0);

		fireEvent.click(
			screen.getByRole("button", { name: MEMBERS_TOGGLE_BUTTON_NAME })
		);
		expect(
			window.localStorage.getItem(SPACE_MEMBERS_PANEL_OPEN_STORAGE_KEY)
		).toBe("closed");
		firstVisit.unmount();

		renderSpaceLanding();

		await waitFor(() => {
			expect(
				screen
					.getByRole("button", { name: MEMBERS_TOGGLE_BUTTON_NAME })
					.getAttribute("aria-expanded")
			).toBe("false");
		});
		expect(screen.queryByRole("complementary", { name: "Members" })).toBeNull();
	});

	it("stores the member roster panel state at the space level", async () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		window.localStorage.setItem(
			OTHER_SPACE_MEMBERS_PANEL_OPEN_STORAGE_KEY,
			"open"
		);
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const membersButton = screen.getByRole("button", {
			name: MEMBERS_TOGGLE_BUTTON_NAME,
		});
		expect(membersButton.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByRole("complementary", { name: "Members" })).toBeNull();
		expect(
			window.localStorage.getItem(SPACE_MEMBERS_PANEL_OPEN_STORAGE_KEY)
		).toBeNull();
		expect(
			window.localStorage.getItem(OTHER_SPACE_MEMBERS_PANEL_OPEN_STORAGE_KEY)
		).toBe("open");

		fireEvent.click(membersButton);
		expect(
			await screen.findByRole("complementary", { name: "Members" })
		).toBeTruthy();
		expect(
			window.localStorage.getItem(SPACE_MEMBERS_PANEL_OPEN_STORAGE_KEY)
		).toBe("open");
		expect(
			window.localStorage.getItem(OTHER_SPACE_MEMBERS_PANEL_OPEN_STORAGE_KEY)
		).toBe("open");

		fireEvent.click(membersButton);
		await waitFor(() => {
			expect(
				screen.queryByRole("complementary", { name: "Members" })
			).toBeNull();
		});
		expect(
			window.localStorage.getItem(SPACE_MEMBERS_PANEL_OPEN_STORAGE_KEY)
		).toBe("closed");
	});

	it("restores each Space's member roster state without remounting the page", async () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		window.localStorage.setItem(SPACE_MEMBERS_PANEL_OPEN_STORAGE_KEY, "closed");
		window.localStorage.setItem(
			OTHER_SPACE_MEMBERS_PANEL_OPEN_STORAGE_KEY,
			"open"
		);
		mockSpaceQueries({
			spaceIds: ["space-123", "space-456"],
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		const view = renderSpaceLanding({ spaceId: "space-123" });
		expect(
			screen
				.getByRole("button", { name: MEMBERS_TOGGLE_BUTTON_NAME })
				.getAttribute("aria-expanded")
		).toBe("false");

		view.rerender(
			<SpaceLanding
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-456"
			/>
		);

		await waitFor(() => {
			expect(
				screen
					.getByRole("button", { name: MEMBERS_TOGGLE_BUTTON_NAME })
					.getAttribute("aria-expanded")
			).toBe("true");
		});
	});

	it("shows a choose-local-agent action beside unavailable unbound agents in the member roster", () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: vi.fn().mockResolvedValue(undefined),
			runtimeLane: "dev-local",
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentControllerRef: "builtin:codex",
					defaultAgentMentionAlias: "codex",
					defaultAgentProfileName: "Codex",
					defaultAgentExecutionReadiness:
						createMissingBindingAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["profile.unbound"],
						reasonText: "This profile currently has no daemon route",
					},
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const panel = openDesktopMembersPanel();
		expect(
			screen.queryByRole("region", {
				name: "Local agent wake warning",
			})
		).toBeNull();
		expectSpaceAgentAvailabilityIndicator(panel, {
			label: "Connect",
			tooltip: "Connect local agent",
		});
		expect(
			within(panel).queryByText("No local agent selected for Wake", {
				exact: false,
			})
		).toBeNull();
		const localAgentLink = within(panel).getByRole("link", {
			name: "Choose local agent",
		});
		expect(localAgentLink.getAttribute("href")).toBe(
			`/o/acme/agents?profileId=${DEFAULT_AGENT_PROFILE_ID}`
		);
		expect(ensureWebAgentProfileRuntimeBindingMock).not.toHaveBeenCalled();
	});

	it("shows a profile-specific prepare action after a connected agent is still offline on this computer", async () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: vi.fn().mockResolvedValue(undefined),
			startStateQuery: {
				data: createStartStateWithCodexCatalog({
					profileReadiness: [
						{
							profileId: DEFAULT_AGENT_PROFILE_ID,
							projection: {
								availability: "ready",
								observedAt: "2026-04-29T00:00:00.000Z",
								observationIssues: [],
								value: {
									deviceId: "device-office",
									observedAt: "2026-04-29T00:00:00.000Z",
									profileId: DEFAULT_AGENT_PROFILE_ID,
									profileKind: "agent",
									routeObservation: createDaemonRouteObservationSummary({
										observedAt: "2026-04-29T00:00:00.000Z",
										status: "offline",
									}),
									replyReadiness: {
										level: "blocked",
										reasonCodes: ["workspace.missing", "service.not_running"],
									},
								},
							},
						},
					],
				}),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentMentionAlias: "codex",
					defaultAgentProfileName: "Codex",
					defaultAgentExecutionReadiness:
						createWorkspaceMissingAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["runtime.projection_missing"],
						reasonText: "Local setup is incomplete",
					},
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const panel = await screen.findByRole("complementary", {
			name: "Members",
		});
		expect(
			within(panel).getAllByText("Connect local agent").length
		).toBeGreaterThan(0);
		expect(within(panel).getByText("Needs connection")).toBeTruthy();
		expect(
			within(panel).queryByText("Local setup preference: Codex")
		).toBeNull();
		expect(within(panel).queryByText("Connected to Codex for Wake")).toBeNull();
		expect(
			within(panel).getByRole("link", { name: "Connect local agent" })
		).toBeTruthy();
		expect(
			within(panel).queryByRole("link", { name: "Review this computer" })
		).toBeNull();
	});

	it("keeps shared AgentWakeAvailability while stale owner diagnostics refreshes", async () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: vi.fn().mockResolvedValue(undefined),
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: withDefaultAgentAgentWakeAvailability(
					createMembersSnapshot({
						defaultAgentMentionAlias: "codex",
						defaultAgentProfileName: "Codex",
						defaultAgentExecutionReadiness:
							createActionRequiredLocalReadinessAgentExecutionReadiness(
								DEFAULT_AGENT_PROFILE_ID
							),
						wakeState: "offline",
						wakeability: {
							status: "blocked",
							reasonCodes: ["runtime.agent_controller_report_stale"],
							reasonText: "Local readiness report is stale",
						},
					}) as SpaceMembersSnapshot,
					createTestAgentAgentWakeAvailability("available_for_wake")
				),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const panel = openDesktopMembersPanel();
		await waitFor(() => {
			expectSpaceAgentAvailabilityIndicator(panel, {
				label: "Available",
				tooltip: "Available for Wake",
			});
		});
		expect(within(panel).queryByText("Checking connection")).toBeNull();
		expect(
			within(panel).queryByText(
				"OpenMeld is checking this agent's local connection."
			)
		).toBeNull();
		expect(
			within(panel).queryByText(
				"Wake will be available after OpenMeld finishes checking this agent's local connection.",
				{ exact: false }
			)
		).toBeNull();
		expect(
			within(panel).queryByRole("link", { name: "Connect local agent" })
		).toBeNull();
		expect(
			within(panel).queryByRole("link", { name: "Review this computer" })
		).toBeNull();
		await waitFor(() => {
			expect(notifyAgentExecutionReadinessRefreshMock).toHaveBeenCalled();
		});
	});

	it("shows Update OpenMeld Service without a transient Connecting state for OpenMeld Service execution contract blockers", async () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: vi.fn().mockResolvedValue(undefined),
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentMentionAlias: "codex",
					defaultAgentProfileName: "Codex",
					defaultAgentExecutionReadiness:
						createServiceUpdateRequiredAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["service.update_required"],
						reasonText:
							"OpenMeld Service needs an update before this agent can reply from this computer.",
					},
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const panel = await screen.findByRole("complementary", {
			name: "Members",
		});
		// Computer-level update is owned by the Get-set-up banner. It is a settled
		// blocker, not a transient Connecting/Checking state, so it must not trigger
		// a passive readiness refresh.
		expect(
			within(panel).queryByRole("link", { name: "Update OpenMeld Service" })
		).toBeNull();
		expect(within(panel).queryByText("Connecting")).toBeNull();
		expect(within(panel).queryByText("Checking")).toBeNull();
		expect(
			within(panel).queryByText(
				"OpenMeld is checking this agent's local reply route."
			)
		).toBeNull();
		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
	});

	it("keeps exhausted owner diagnostics refresh out of AgentWakeAvailability", async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: refreshAllMock,
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: withDefaultAgentAgentWakeAvailability(
					createMembersSnapshot({
						defaultAgentMentionAlias: "codex",
						defaultAgentProfileName: "Codex",
						defaultAgentExecutionReadiness:
							createStaleLocalReadinessAgentExecutionReadiness(
								DEFAULT_AGENT_PROFILE_ID
							),
						wakeState: "offline",
						wakeability: {
							status: "blocked",
							reasonCodes: ["runtime.agent_controller_report_stale"],
							reasonText: "Local readiness report is stale",
						},
					}) as SpaceMembersSnapshot,
					createTestAgentAgentWakeAvailability("available_for_wake")
				),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const panel = openDesktopMembersPanel();
		await flushPromiseQueue();
		expectSpaceAgentAvailabilityIndicator(panel, {
			isRefreshing: false,
			label: "Available",
			tooltip: "Available for Wake",
		});
		expect(within(panel).queryByText("Checking connection")).toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(62_000);
		});

		expect(within(panel).queryByText("Checking availability")).toBeNull();
		expect(within(panel).queryByText("Checking connection")).toBeNull();
		expectSpaceAgentAvailabilityIndicator(panel, {
			isRefreshing: false,
			label: "Available",
			tooltip: "Available for Wake",
		});
		expect(
			within(panel).queryByRole("link", { name: "Connect local agent" })
		).toBeNull();
		expect(
			within(panel).queryByRole("link", { name: "Reconnect OpenMeld Service" })
		).toBeNull();
		expect(notifyAgentExecutionReadinessRefreshMock).toHaveBeenCalledOnce();
		expect(refreshAllMock).not.toHaveBeenCalled();
		expect(statusRefetchMock).toHaveBeenCalledTimes(
			SPACE_WAKE_STATUS_AUTO_REFRESH_ATTEMPTS
		);
		expect(membersRefetchMock).toHaveBeenCalledTimes(
			SPACE_WAKE_STATUS_AUTO_REFRESH_ATTEMPTS
		);
	});

	it("builds a short Space-recovery prepare link without profileId or agentProfileIds", () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedHumanProfileId: DEFAULT_SPACE_PROFILE_ID,
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: vi.fn().mockResolvedValue(undefined),
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			profileId: DEFAULT_AGENT_PROFILE_ID,
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentExecutionReadiness:
						createWorkspaceMissingAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["runtime.projection_missing"],
						reasonText: "Local setup is incomplete",
					},
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding({ profileId: DEFAULT_AGENT_PROFILE_ID });

		const panel = screen.getByRole("complementary", {
			name: "Members",
		});
		const link = within(panel).getByRole("link", {
			name: "Connect local agent",
		});
		const href = link.getAttribute("href") ?? "";
		const params = new URLSearchParams(href.split("?")[1] ?? "");
		// The viewer is resolved from the Space's last-used human profile on arrival,
		// so the reconnect URL encodes neither profileId nor agentProfileIds.
		expect(href.split("?")[0]).toBe("/o/acme/connect");
		expect(params.get("profileId")).toBeNull();
		expect(params.get("agentProfileIds")).toBeNull();
		expect(params.get("returnTo")).toBe("space");
		expect(params.get("spaceId")).toBe("space-123");
	});

	it("refreshes local agent recovery state while a ready local route is reconnecting after recovery starts", async () => {
		vi.useFakeTimers();
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		const historyRefetchMock = vi.fn().mockResolvedValue(undefined);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: refreshAllMock,
			startStateQuery: {
				data: createStartStateWithCodexCatalog({
					profileReadiness: [
						{
							profileId: DEFAULT_AGENT_PROFILE_ID,
							projection: {
								availability: "ready",
								observedAt: "2026-04-29T00:00:00.000Z",
								observationIssues: [],
								value: {
									deviceId: "device-office",
									observedAt: "2026-04-29T00:00:00.000Z",
									profileId: DEFAULT_AGENT_PROFILE_ID,
									profileKind: "agent",
									routeObservation: createDaemonRouteObservationSummary({
										observedAt: "2026-04-29T00:00:00.000Z",
										status: "offline",
									}),
									replyReadiness: {
										level: "blocked",
										reasonCodes: ["workspace.missing"],
									},
								},
							},
						},
					],
				}),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentExecutionReadiness:
						createRouteUpdatingAgentExecutionReadiness(),
					wakeRouteEvidence: createDaemonRouteObservationSummary({
						observedAt: "2026-04-29T00:00:00.000Z",
						status: "offline",
					}),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["route.not_registered"],
						reasonText: "Route still registering",
					},
				}),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
				refetch: historyRefetchMock,
			}),
		});

		renderSpaceLanding();
		await act(async () => {
			window.dispatchEvent(
				new StorageEvent("storage", {
					key: COMPLETED_PREPARE_SESSION_POINTER_STORAGE_KEY,
					newValue: JSON.stringify({
						humanProfileId: DEFAULT_SPACE_PROFILE_ID,
						prepareSessionId: "prepare-complete",
					}),
					oldValue: null,
				})
			);
			await Promise.resolve();
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});

		expect(refreshAllMock).not.toHaveBeenCalled();
		expect(useLocalAgentRecoveryControllerMock).toHaveBeenCalledWith({
			currentLocalRuntimeReplyReadinessRefetchIntervalMs: false,
			loadAgentExecutionReadiness: false,
			loadAgentProfiles: false,
			loadSetupState: false,
		});
		expect(statusRefetchMock).toHaveBeenCalled();
		expect(membersRefetchMock).toHaveBeenCalled();
		expect(historyRefetchMock).not.toHaveBeenCalled();
	});

	it("does not keep refreshing Space member readiness for passive OpenMeld Service disconnected guidance", async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: refreshAllMock,
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentExecutionReadiness:
						createServiceNotConnectedAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["local_service.not_connected_for_account"],
						reasonText:
							"OpenMeld Service is not connected for this OpenMeld account on this computer.",
					},
				}),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const panel = screen.getByRole("complementary", {
			name: "Members",
		});
		expect(within(panel).queryByText("Connecting")).toBeNull();
		expect(within(panel).queryByText("Reconnect OpenMeld Service")).toBeNull();
		expect(
			within(panel).queryByText(
				"Runner is connected, but OpenMeld Service is not connected for this OpenMeld account on this computer. Reconnect OpenMeld Service for this account.",
				{ exact: false }
			)
		).toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});

		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		expect(refreshAllMock).not.toHaveBeenCalled();
		expect(statusRefetchMock).not.toHaveBeenCalled();
		expect(membersRefetchMock).not.toHaveBeenCalled();
	});

	it("force-refreshes members, status, and readiness when checking an offline member", async () => {
		const members = createMembersSnapshot();
		const offlineMembers = {
			...members,
			agents: members.agents.map((agent) => ({
				...agent,
				agentWakeAvailability: resolveAgentWakeAvailability({
					readiness: createReadyAgentExecutionReadiness(agent.profileId),
					wakeRouteStatus: { status: "offline" },
					agentWakeRouteRegistration: {
						status: "expired",
						reasonCode: "wake_route.registration_expired",
						reportedAtMs: null,
						daemonSessionId: null,
						deviceId: null,
						lane: null,
						serviceVersion: null,
					},
				}),
			})),
		};
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
		const fetchQueryMock = vi.fn().mockResolvedValue(undefined);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		useQueryClientMock.mockReturnValue({
			cancelQueries: vi.fn().mockResolvedValue(undefined),
			fetchQuery: fetchQueryMock,
			getQueryData: vi.fn(() => undefined),
			invalidateQueries: invalidateQueriesMock,
			resetQueries: vi.fn().mockResolvedValue(undefined),
			setQueryData: vi.fn(),
		});
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: refreshAllMock,
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: offlineMembers,
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const panel = openDesktopMembersPanel();
		fireEvent.click(within(panel).getByRole("button", { name: "Check again" }));

		await waitFor(() => {
			expect(fetchQueryMock).toHaveBeenCalledTimes(2);
		});
		expect(notifyAgentExecutionReadinessRefreshMock).toHaveBeenCalledWith({
			agentProfileIds: [DEFAULT_AGENT_PROFILE_ID],
			organizationId: "org-acme",
		});
		for (const invalidation of buildSharedReadinessCacheInvalidations()) {
			expect(invalidateQueriesMock).toHaveBeenCalledWith(
				expect.objectContaining(invalidation),
				{ cancelRefetch: false }
			);
		}
		expect(refreshAllMock).toHaveBeenCalledTimes(1);
		expect(statusRefetchMock).not.toHaveBeenCalled();
		expect(membersRefetchMock).not.toHaveBeenCalled();
	});

	it("keeps visible Space member readiness fresh with low-frequency refresh", async () => {
		vi.useFakeTimers();
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: refreshAllMock,
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(59_000);
		});
		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		expect(refreshAllMock).not.toHaveBeenCalled();
		expect(statusRefetchMock).not.toHaveBeenCalled();
		expect(membersRefetchMock).not.toHaveBeenCalled();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});

		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		expect(refreshAllMock).toHaveBeenCalledTimes(1);
		expect(statusRefetchMock).toHaveBeenCalledTimes(1);
		expect(membersRefetchMock).toHaveBeenCalledTimes(1);
	});

	it("pauses high-frequency recovery refresh while the page is hidden and refreshes once when visible", async () => {
		vi.useFakeTimers();
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "hidden",
		});
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: refreshAllMock,
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentExecutionReadiness:
						createServiceNotConnectedAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["local_service.not_connected_for_account"],
						reasonText:
							"OpenMeld Service is not connected for this OpenMeld account on this computer.",
					},
				}),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();
		act(() => {
			window.dispatchEvent(
				new StorageEvent("storage", {
					key: COMPLETED_PREPARE_SESSION_POINTER_STORAGE_KEY,
					newValue: JSON.stringify({
						humanProfileId: DEFAULT_SPACE_PROFILE_ID,
						prepareSessionId: "prepare-complete",
					}),
					oldValue: null,
				})
			);
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(4000);
		});

		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		expect(refreshAllMock).not.toHaveBeenCalled();
		expect(statusRefetchMock).not.toHaveBeenCalled();
		expect(membersRefetchMock).not.toHaveBeenCalled();

		act(() => {
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				value: "visible",
			});
			document.dispatchEvent(new Event("visibilitychange"));
		});
		await act(async () => {
			await Promise.resolve();
		});

		expect(notifyAgentExecutionReadinessRefreshMock).toHaveBeenCalledWith({
			agentProfileIds: [DEFAULT_AGENT_PROFILE_ID],
			organizationId: "org-acme",
		});
		expect(refreshAllMock).not.toHaveBeenCalled();
		expect(statusRefetchMock).toHaveBeenCalledTimes(1);
		expect(membersRefetchMock).toHaveBeenCalledTimes(1);
	});

	it("reconciles a recovery-eligible agent immediately on the foreground edge, not a high-frequency interval later", async () => {
		// Regression coverage for "leave and come back clears a stale Offline": a
		// recovery-eligible agent whose backend availability recovered while the tab
		// was hidden must converge the moment the tab returns to the foreground. The
		// recovery-eligible edge fires an immediate refresh on the visible edge — it
		// does not wait for the high-frequency interval's first tick (note there is no
		// timer advance after the visibility flip below).
		vi.useFakeTimers();
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "hidden",
		});
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: refreshAllMock,
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentExecutionReadiness:
						createRouteUpdatingAgentExecutionReadiness(),
					wakeRouteEvidence: createDaemonRouteObservationSummary({
						observedAt: "2026-04-29T00:00:00.000Z",
						status: "offline",
					}),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["route.not_registered"],
						reasonText: "Route still registering",
					},
				}),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		// While hidden, the gated/throttled refresh intervals do not run.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(4000);
		});
		expect(membersRefetchMock).not.toHaveBeenCalled();

		// On the visible edge we reconcile immediately — note there is NO timer
		// advance here, so a refetch can only have come from the foreground-edge
		// effect, not from the high-frequency interval's first tick.
		act(() => {
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				value: "visible",
			});
			document.dispatchEvent(new Event("visibilitychange"));
		});
		await act(async () => {
			await Promise.resolve();
		});
		expect(membersRefetchMock).toHaveBeenCalled();
	});

	it("shows active Wake OpenMeld Service waiting as a note without taking over the member indicator", async () => {
		const getWakeProgressMock = vi.fn().mockResolvedValue({
			items: [
				{
					clientMessageId: "client-message-1",
					dispatchId: "dispatch-1",
					message: "Still trying to reach @runner...",
					phase: "retrying",
					sourceSignalId: "sig-user",
					targetLabel: "@runner",
					targetProfileId: DEFAULT_AGENT_PROFILE_ID,
					terminal: false,
					updatedAtMs: RECENT_ACTIVITY_TS + 10,
				},
			],
			query: {
				clientMessageId: "client-message-1",
				spaceId: "space-123",
				targetProfileId: null,
			},
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: getWakeProgressMock,
			leaveSpace: vi.fn(),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: refreshAllMock,
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentExecutionReadiness:
						createServiceNotConnectedAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					defaultAgentMentionAlias: "runner",
					defaultAgentProfileName: "Runner",
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["local_service.not_connected_for_account"],
						reasonText:
							"OpenMeld Service is not connected for this OpenMeld account on this computer.",
					},
				}),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-user",
							messageEnvelope: {
								activationTargets: [DEFAULT_AGENT_PROFILE_ID],
								referenceTargets: [],
								text: "@runner(wake) status check",
							},
							meta: {
								clientMessageId: "client-message-1",
							},
							text: "@runner(wake) status check",
							ts: RECENT_ACTIVITY_TS,
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const panel = screen.getByRole("complementary", {
			name: "Members",
		});
		expect(within(panel).queryByText("Reconnect OpenMeld Service")).toBeNull();
		expect(
			within(panel).queryByText(WAITING_FOR_OPENMELD_SERVICE_PATTERN)
		).toBeNull();
		await waitFor(() => {
			expectSpaceAgentAvailabilityIndicator(panel, {
				label: "Waiting",
				tooltip: "Wake waiting for this computer to reconnect",
			});
		});
		await waitFor(() => {
			expect(notifyAgentExecutionReadinessRefreshMock).toHaveBeenCalledWith({
				agentProfileIds: [DEFAULT_AGENT_PROFILE_ID],
				organizationId: "org-acme",
			});
		});
		expect(refreshAllMock).not.toHaveBeenCalled();
		expect(statusRefetchMock).toHaveBeenCalled();
		expect(membersRefetchMock).toHaveBeenCalled();
	});

	it("does not show the active Wake OpenMeld Service note after terminal Wake progress", async () => {
		const getWakeProgressMock = vi.fn().mockResolvedValue({
			items: [
				{
					clientMessageId: "client-message-1",
					dispatchId: "dispatch-1",
					message: "@runner couldn't reply.",
					phase: "failed",
					sourceSignalId: "sig-user",
					targetLabel: "@runner",
					targetProfileId: DEFAULT_AGENT_PROFILE_ID,
					terminal: true,
					updatedAtMs: RECENT_ACTIVITY_TS + 10,
				},
				{
					clientMessageId: "client-message-1",
					dispatchId: "dispatch-2",
					message: "@runner replied.",
					phase: "replied",
					sourceSignalId: "sig-user",
					targetLabel: "@runner",
					targetProfileId: DEFAULT_AGENT_PROFILE_ID,
					terminal: true,
					updatedAtMs: RECENT_ACTIVITY_TS + 20,
				},
			],
			query: {
				clientMessageId: "client-message-1",
				spaceId: "space-123",
				targetProfileId: null,
			},
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: getWakeProgressMock,
			leaveSpace: vi.fn(),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: vi.fn().mockResolvedValue(undefined),
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentExecutionReadiness:
						createServiceNotConnectedAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					defaultAgentMentionAlias: "runner",
					defaultAgentProfileName: "Runner",
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["local_service.not_connected_for_account"],
						reasonText:
							"OpenMeld Service is not connected for this OpenMeld account on this computer.",
					},
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-user",
							messageEnvelope: {
								activationTargets: [DEFAULT_AGENT_PROFILE_ID],
								referenceTargets: [],
								text: "@runner(wake) status check",
							},
							meta: {
								clientMessageId: "client-message-1",
							},
							text: "@runner(wake) status check",
							ts: RECENT_ACTIVITY_TS,
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await waitFor(() => {
			expect(getWakeProgressMock).toHaveBeenCalledWith({
				signal: expect.any(AbortSignal),
				clientMessageId: "client-message-1",
				includePreviewText: true,
				includeSourceContext: true,
				includeTiming: true,
				includeWaitReason: true,
				includeDeviceWait: true,
				includeWakeStopEligibility: true,
				spaceId: "space-123",
				timeoutMs: 15_000,
			});
		});
		const panel = screen.getByRole("complementary", {
			name: "Members",
		});
		expect(within(panel).queryByText("Reconnect OpenMeld Service")).toBeNull();
		expect(
			within(panel).queryByText(ACTIVE_WAKE_SERVICE_WAITING_NOTE_PATTERN)
		).toBeNull();
		expect(
			within(panel).queryByText(WAITING_FOR_OPENMELD_SERVICE_PATTERN)
		).toBeNull();
	});

	it("refreshes Space member readiness when current local runtime readiness becomes ready", async () => {
		const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		useQueryClientMock.mockReturnValue({
			invalidateQueries: invalidateQueriesMock,
			setQueryData: vi.fn(),
		});
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			currentLocalRuntimeReplyReadinessQuery: {
				data: createCurrentLocalRuntimeReplyReadiness({
					canReplyFromThisComputer: false,
					primaryBlocker: "service_not_connected",
					serviceConnected: false,
					status: "blocked",
				}),
				isPending: false,
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: refreshAllMock,
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentExecutionReadiness:
						createServiceNotConnectedAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["local_service.not_connected_for_account"],
						reasonText:
							"OpenMeld Service is not connected for this OpenMeld account on this computer.",
					},
				}),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});
		const view = renderSpaceLanding();

		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			currentLocalRuntimeReplyReadinessQuery: {
				data: createCurrentLocalRuntimeReplyReadiness({
					canReplyFromThisComputer: true,
					primaryBlocker: "none",
					serviceConnected: true,
					status: "ready",
				}),
				isPending: false,
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: refreshAllMock,
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		view.rerender(
			<SpaceLanding
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);

		await waitFor(() => {
			expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		});
		expect(refreshAllMock).not.toHaveBeenCalled();
		for (const invalidation of buildSharedReadinessCacheInvalidations()) {
			expect(invalidateQueriesMock).toHaveBeenCalledWith(
				expect.objectContaining(invalidation),
				{ cancelRefetch: false }
			);
		}
		expect(statusRefetchMock).toHaveBeenCalledTimes(1);
		expect(membersRefetchMock).toHaveBeenCalledTimes(1);
	});

	it("refreshes Space member readiness when Prepare completes in another Web tab", async () => {
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: refreshAllMock,
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentExecutionReadiness:
						createServiceNotConnectedAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["local_service.not_connected_for_account"],
						reasonText:
							"OpenMeld Service is not connected for this OpenMeld account on this computer.",
					},
				}),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();
		act(() => {
			window.dispatchEvent(
				new StorageEvent("storage", {
					key: COMPLETED_PREPARE_SESSION_POINTER_STORAGE_KEY,
					newValue: JSON.stringify({
						humanProfileId: DEFAULT_SPACE_PROFILE_ID,
						prepareSessionId: "prepare-complete",
					}),
					oldValue: null,
				})
			);
		});

		await waitFor(() => {
			expect(notifyAgentExecutionReadinessRefreshMock).toHaveBeenCalledWith({
				agentProfileIds: [DEFAULT_AGENT_PROFILE_ID],
				organizationId: "org-acme",
			});
		});
		expect(refreshAllMock).not.toHaveBeenCalled();
		expect(statusRefetchMock).toHaveBeenCalledTimes(1);
		expect(membersRefetchMock).toHaveBeenCalledTimes(1);
	});

	it("does not auto-refresh local agent recovery while setup needs a setup command", async () => {
		vi.useFakeTimers();
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: refreshAllMock,
			startStateQuery: {
				data: createStartStateWithCodexCatalog({
					profileReadiness: [
						{
							profileId: DEFAULT_AGENT_PROFILE_ID,
							projection: {
								availability: "ready",
								observedAt: "2026-04-29T00:00:00.000Z",
								observationIssues: [],
								value: {
									deviceId: "device-office",
									observedAt: "2026-04-29T00:00:00.000Z",
									profileId: DEFAULT_AGENT_PROFILE_ID,
									profileKind: "agent",
									routeObservation: createDaemonRouteObservationSummary({
										observedAt: "2026-04-29T00:00:00.000Z",
										status: "online",
									}),
									replyReadiness: {
										level: "blocked",
										reasonCodes: ["workspace.missing"],
									},
								},
							},
						},
					],
				}),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentExecutionReadiness:
						createRunPrepareAgentExecutionReadiness(DEFAULT_AGENT_PROFILE_ID),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["runtime.projection_missing"],
						reasonText: "Local setup is incomplete",
					},
				}),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();
		act(() => {
			window.dispatchEvent(
				new StorageEvent("storage", {
					key: COMPLETED_PREPARE_SESSION_POINTER_STORAGE_KEY,
					newValue: JSON.stringify({
						humanProfileId: DEFAULT_SPACE_PROFILE_ID,
						prepareSessionId: "prepare-complete",
					}),
					oldValue: null,
				})
			);
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(4000);
		});

		expect(refreshAllMock).not.toHaveBeenCalled();
		expect(statusRefetchMock).not.toHaveBeenCalled();
		expect(membersRefetchMock).not.toHaveBeenCalled();
	});

	it("auto-refreshes route registration while the system is reconnecting after recovery starts", async () => {
		vi.useFakeTimers();
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: refreshAllMock,
			startStateQuery: {
				data: createStartStateWithCodexCatalog({
					profileReadiness: [
						{
							profileId: DEFAULT_AGENT_PROFILE_ID,
							projection: {
								availability: "ready",
								observedAt: "2026-04-29T00:00:00.000Z",
								observationIssues: [],
								value: {
									deviceId: "device-office",
									observedAt: "2026-04-29T00:00:00.000Z",
									profileId: DEFAULT_AGENT_PROFILE_ID,
									profileKind: "agent",
									routeObservation: createDaemonRouteObservationSummary({
										observedAt: "2026-04-29T00:00:00.000Z",
										status: "offline",
									}),
									replyReadiness: {
										level: "blocked",
										reasonCodes: ["route.not_registered"],
									},
								},
							},
						},
					],
				}),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentExecutionReadiness:
						createLegacyRouteReconnectAgentExecutionReadiness(),
					wakeRouteEvidence: createDaemonRouteObservationSummary({
						observedAt: "2026-04-29T00:00:00.000Z",
						status: "offline",
					}),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["route.not_registered"],
						reasonText: "Route still registering",
					},
				}),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();
		act(() => {
			window.dispatchEvent(
				new StorageEvent("storage", {
					key: COMPLETED_PREPARE_SESSION_POINTER_STORAGE_KEY,
					newValue: JSON.stringify({
						humanProfileId: DEFAULT_SPACE_PROFILE_ID,
						prepareSessionId: "prepare-complete",
					}),
					oldValue: null,
				})
			);
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(4000);
		});

		expect(refreshAllMock).not.toHaveBeenCalled();
		expect(statusRefetchMock).toHaveBeenCalled();
		expect(membersRefetchMock).toHaveBeenCalled();
	});

	it("shows shared checking route status when the member roster opens while a ready local agent route refreshes", () => {
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: vi.fn().mockResolvedValue(undefined),
			startStateQuery: {
				data: createStartStateWithCodexCatalog({
					profileReadiness: [
						{
							profileId: DEFAULT_AGENT_PROFILE_ID,
							projection: {
								availability: "stale",
								observedAt: "2026-04-29T00:00:00.000Z",
								observationIssues: [],
								value: {
									deviceId: "device-office",
									observedAt: "2026-04-29T00:00:00.000Z",
									profileId: DEFAULT_AGENT_PROFILE_ID,
									profileKind: "agent",
									routeObservation: createDaemonRouteObservationSummary({
										observedAt: "2026-04-29T00:00:00.000Z",
										status: "online",
									}),
									replyReadiness: {
										level: "ready",
										reasonCodes: [],
									},
								},
							},
						},
					],
				}),
			},
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentMentionAlias: "codex",
					defaultAgentProfileName: "Codex",
					defaultAgentExecutionReadiness:
						createRouteUpdatingAgentExecutionReadiness(),
					wakeRouteEvidence: createDaemonRouteObservationSummary({
						observedAt: "2026-04-29T00:00:00.000Z",
						status: "offline",
					}),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["route.not_registered"],
						reasonText: "Route is reconnecting",
					},
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();
		act(() => {
			window.dispatchEvent(
				new StorageEvent("storage", {
					key: COMPLETED_PREPARE_SESSION_POINTER_STORAGE_KEY,
					newValue: JSON.stringify({
						humanProfileId: DEFAULT_SPACE_PROFILE_ID,
						prepareSessionId: "prepare-complete",
					}),
					oldValue: null,
				})
			);
		});

		const panel = openDesktopMembersPanel();
		expect(
			screen
				.getByRole("button", { name: MEMBERS_TOGGLE_BUTTON_NAME })
				.getAttribute("aria-expanded")
		).toBe("true");
		expectSpaceAgentAvailabilityIndicator(panel, {
			isRefreshing: true,
			label: "Checking",
			tooltip: "Checking Wake route",
		});
		expect(
			within(panel).queryByText(
				"OpenMeld is checking this agent's local connection."
			)
		).toBeNull();
		expect(
			within(panel).queryByText(
				"Wake will be available after OpenMeld finishes checking this agent's local connection.",
				{ exact: false }
			)
		).toBeNull();
		expect(
			within(panel).queryByRole("link", { name: "Review this computer" })
		).toBeNull();
		expect(
			within(panel).queryByRole("button", { name: "Run setup" })
		).toBeNull();
		expect(within(panel).queryByText("Needs setup")).toBeNull();
		expect(within(panel).queryByText("Offline")).toBeNull();
	});

	it("groups consecutive text messages into one speaker run and keeps status events outside message bubbles", () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-1",
							ts: 10,
							text: "First message",
						}),
						createTextSignal({
							id: "sig-2",
							ts: 20,
							text: "Second message",
						}),
						createStatusSignal({
							id: "sig-3",
							ts: 30,
							text: "Runner needs input",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const selfMessageRun = screen
			.getByText("First message")
			.closest('[data-slot="message"]');
		expect(selfMessageRun).not.toBeNull();
		expect(
			within(selfMessageRun as HTMLElement).getByText("Mira")
		).toBeTruthy();
		expect(screen.queryByText("Mira (You)")).toBeNull();
		const statusEvent = screen
			.getByText("Runner needs input")
			.closest("[data-signal-id]");
		expect(statusEvent).not.toBeNull();
		expect(
			within(statusEvent as HTMLElement).queryByRole("button", {
				name: "Reply",
			})
		).toBeNull();
		expect(statusEvent?.getAttribute("aria-label")).toBe("Message details");
	});

	it("keeps the Agent identity visible without repeating controller metadata", () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentRuntimeDeviceDisplayName: "Felix's composer",
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-agent",
							profile: {
								kind: "agent",
								profileId: DEFAULT_AGENT_PROFILE_ID,
								profileName: "Runner",
							},
							text: "Done",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(
			screen.queryByText("Controlled by Felix's composer Codex")
		).toBeNull();
		expect(
			screen.queryByText("Controlled by Felix's composer Codex · Owned by Mira")
		).toBeNull();
		expect(
			screen.getByTestId(
				`space-agent-profile-avatar-${DEFAULT_AGENT_PROFILE_ID}`
			)
		).toBeTruthy();
		expect(screen.getByTestId("local-agent-logo-codex")).toBeTruthy();
		expect(screen.queryByText("Runs on Codex")).toBeNull();
		expect(screen.queryByText("managed by Mira")).toBeNull();
	});

	it("uses current bootstrap Agent identity over stale unbound caches in the first frame", () => {
		const members = createMembersSnapshot();
		const history = {
			envelopes: [
				createTextSignal({
					id: "sig-agent-bootstrap-identity",
					profile: {
						kind: "agent",
						profileId: DEFAULT_AGENT_PROFILE_ID,
						profileName: "Runner",
					},
					text: "Rendered from bootstrap",
				}),
			],
			nextCursor: null,
		};
		mockSpaceQueries({
			bootstrap: createQueryResult({
				data: {
					history,
					members,
					status: createSpaceStatus(),
					threads: { previews: [], threads: [] },
				},
				isSuccess: true,
			}),
			status: createQueryResult({
				data: createSpaceStatus(),
				isSuccess: true,
			}),
			members: createQueryResult({
				data: createMembersSnapshot({ defaultAgentControllerRef: null }),
				isSuccess: true,
			}),
			history: createQueryResult({ data: history, isSuccess: true }),
		});

		renderSpaceLanding();

		expect(
			screen.getByTestId(
				`space-agent-profile-avatar-${DEFAULT_AGENT_PROFILE_ID}`
			)
		).toBeTruthy();
		expect(
			screen.queryByTestId(
				`space-agent-profile-fallback-avatar-${DEFAULT_AGENT_PROFILE_ID}`
			)
		).toBeNull();
	});

	it("does not write stale bootstrap Agent identity over newer restored history", async () => {
		const queryClient = createTestQueryClient();
		useQueryClientMock.mockReturnValue(queryClient);
		const currentMembers = {
			...createMembersSnapshot({
				defaultAgentControllerRef: "builtin:claude",
			}),
			generatedAt: "2026-07-01T00:00:02.000Z",
		};
		const bootstrapMembers = {
			...createMembersSnapshot({
				defaultAgentControllerRef: "builtin:codex",
			}),
			generatedAt: "2026-07-01T00:00:01.000Z",
		};
		const currentSignal = {
			...createTextSignal({
				id: "sig-restored-newer-agent-identity",
				profile: {
					kind: "agent",
					profileId: DEFAULT_AGENT_PROFILE_ID,
					profileName: "Runner",
				},
				text: "Keep the restored identity current",
			}),
			profile: {
				agentControllerRef: "builtin:claude",
				kind: "agent",
				profileId: DEFAULT_AGENT_PROFILE_ID,
				profileName: "Runner",
			},
		} as SignalEnvelope;
		const bootstrapSignal = {
			...currentSignal,
			profile: {
				...currentSignal.profile,
				agentControllerRef: "builtin:codex",
			},
		} as SignalEnvelope;
		const currentHistory = {
			envelopes: [currentSignal],
			nextCursor: null,
		};

		queryClient.setQueryData(
			spaceQueryKeys.members("space-123", DEFAULT_SPACE_PROFILE_ID),
			currentMembers
		);
		queryClient.setQueryData(
			spaceQueryKeys.history("space-123", DEFAULT_SPACE_PROFILE_ID),
			currentHistory
		);
		mockSpaceQueries({
			bootstrap: createQueryResult({
				data: {
					history: {
						envelopes: [bootstrapSignal],
						nextCursor: null,
					},
					members: bootstrapMembers,
					status: createSpaceStatus(),
					threads: { previews: [], threads: [] },
				},
				isSuccess: true,
			}),
			history: createQueryResult({ data: currentHistory, isSuccess: true }),
			members: createQueryResult({ data: currentMembers, isSuccess: true }),
			status: createQueryResult({
				data: createSpaceStatus(),
				isSuccess: true,
			}),
		});

		renderSpaceLanding({ queryClient });
		await flushPromiseQueue();

		expect(
			queryClient
				.getQueryData<{
					envelopes: readonly SignalEnvelope[];
				}>(spaceQueryKeys.history("space-123", DEFAULT_SPACE_PROFILE_ID))
				?.envelopes.find(
					(signal) => signal.id === "sig-restored-newer-agent-identity"
				)?.profile.agentControllerRef
		).toBe("builtin:claude");
		queryClient.clear();
	});

	it("uses successful bootstrap Agent identity while the empty members query retains an error", () => {
		const history = {
			envelopes: [
				createTextSignal({
					id: "sig-agent-bootstrap-after-members-error",
					profile: {
						kind: "agent",
						profileId: DEFAULT_AGENT_PROFILE_ID,
						profileName: "Runner",
					},
					text: "Rendered after a stale members error",
				}),
			],
			nextCursor: null,
		};
		mockSpaceQueries({
			bootstrap: createQueryResult({
				data: {
					history,
					members: createMembersSnapshot(),
					status: createSpaceStatus(),
					threads: { previews: [], threads: [] },
				},
				isSuccess: true,
			}),
			status: createQueryResult({
				data: createSpaceStatus(),
				isSuccess: true,
			}),
			members: createQueryResult({
				error: new Error("stale members failure"),
				isError: true,
			}),
			history: createQueryResult({ data: history, isSuccess: true }),
		});

		renderSpaceLanding();

		expect(
			screen.getByTestId(
				`space-agent-profile-avatar-${DEFAULT_AGENT_PROFILE_ID}`
			)
		).toBeTruthy();
		expect(
			screen.queryByTestId(
				`space-agent-profile-fallback-avatar-${DEFAULT_AGENT_PROFILE_ID}`
			)
		).toBeNull();
	});

	it("uses the Center Agent Fluid avatar in an ordinary Space", () => {
		mockSpaceQueries({
			centerAgentProfileId: DEFAULT_AGENT_PROFILE_ID,
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentProfileName: "Center Agent",
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-center-agent",
							profile: {
								kind: "agent",
								profileId: DEFAULT_AGENT_PROFILE_ID,
								profileName: "Center Agent",
							},
							text: "Organization update",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(
			screen.getByTestId(
				`space-center-agent-profile-avatar-${DEFAULT_AGENT_PROFILE_ID}`
			)
		).toBeTruthy();
		expect(screen.queryByTestId("local-agent-logo-codex")).toBeNull();
	});

	it("uses the generic Agent Profile avatar without a bound controller", () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentControllerRef: null,
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-agent-unbound",
							profile: {
								kind: "agent",
								profileId: DEFAULT_AGENT_PROFILE_ID,
								profileName: "Runner",
							},
							text: "Done",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(
			screen.getByTestId(
				`space-agent-profile-fallback-avatar-${DEFAULT_AGENT_PROFILE_ID}`
			)
		).toBeTruthy();
		expect(screen.queryByTestId("local-agent-logo-codex")).toBeNull();
	});

	it("opens the mention target picker, keeps Agents before Humans, and filters by query", async () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					extraAgents: [
						{
							mentionAlias: "watcher",
							profileId: "agt_33333333-3333-3333-3333-333333333333",
							profileName: "Watcher",
						},
						{
							agentControllerRef: null,
							mentionAlias: "manual",
							profileId: "agt_44444444-4444-4444-4444-444444444444",
							profileName: "Manual Agent",
						},
					],
				}),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const targetList = await openComposerMemberPicker();
		expect(targetList.className).toContain("z-500");
		expect(targetList.className).toContain("max-h-[288px]");
		expect(
			targetList.querySelector('[data-slot="scroll-area-viewport"]')
		).not.toBeNull();
		expect(within(targetList).getByText("Agents")).toBeTruthy();
		expect(within(targetList).getByText("People")).toBeTruthy();
		expect(within(targetList).getByText("Runner")).toBeTruthy();
		expect(within(targetList).getByText("Watcher")).toBeTruthy();
		expect(within(targetList).getByText("Manual Agent")).toBeTruthy();
		expect(within(targetList).getByText("Mira")).toBeTruthy();
		expect(
			within(targetList).getAllByTestId("local-agent-logo-codex").length
		).toBeGreaterThan(0);
		expect(
			within(targetList).getByTestId(
				"space-agent-profile-fallback-icon-agt_44444444-4444-4444-4444-444444444444"
			)
		).toBeTruthy();
		fireEvent.change(
			screen.getByRole("combobox", { name: "Find a member to mention" }),
			{ target: { value: "watch" } }
		);

		await waitFor(() => {
			const filteredTargetList = screen.getByRole("listbox", {
				name: "Member options",
			});
			expect(within(filteredTargetList).getByText("Watcher")).toBeTruthy();
			expect(within(filteredTargetList).queryByText("Runner")).toBeNull();
			expect(within(filteredTargetList).queryByText("Mira")).toBeNull();
		});
	});

	it("shows a clear no-match state and lets the user keep searching", async () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await openComposerMemberPicker("missing");
		await screen.findByText("No matching members");

		fireEvent.change(
			screen.getByRole("combobox", { name: "Find a member to mention" }),
			{ target: { value: "Mir" } }
		);
		await waitFor(() => {
			expect(screen.queryByText("No matching members")).toBeNull();
		});
		const nextTargetList = screen.getByRole("listbox", {
			name: "Member options",
		});
		expect(within(nextTargetList).getByText("Mira")).toBeTruthy();
	});

	it("keeps the mention picker scrollable when many profiles match", async () => {
		const extraAgents = Array.from({ length: 18 }, (_, index) => {
			const displayIndex = index + 1;
			const profileIdSuffix = String(displayIndex).padStart(12, "0");
			return {
				mentionAlias: `scroll-agent-${String(displayIndex)}`,
				profileId: `agt_50000000-0000-4000-8000-${profileIdSuffix}`,
				profileName: `Scroll Agent ${String(displayIndex)}`,
			};
		});

		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({ extraAgents }),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const targetList = await openComposerMemberPicker();
		expect(targetList.className).toContain("max-h-[288px]");
		expect(
			targetList.querySelector('[data-slot="scroll-area-viewport"]')
		).not.toBeNull();
		expect(within(targetList).getByText("Scroll Agent 18")).toBeTruthy();
		expect(within(targetList).getAllByRole("option").length).toBeGreaterThan(
			18
		);
	});

	it("keeps an exact pasted Agent name literal until a recipient is selected", async () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await setComposerValue(textarea, "@Runner wake please reply");

		expect(screen.queryByTestId("space-composer-profile-token")).toBeNull();
		expect(readComposerValue(textarea)).toBe("@Runner wake please reply");
		expect(screen.queryByText("Waking 1 agent")).toBeNull();
	});

	it("rechecks a rejected Wake on explicit retry without changing its intent", async () => {
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: vi.fn().mockResolvedValue(undefined),
			runtimeLane: "dev-local",
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
		});
		const postNormalMessageMock = vi.fn().mockResolvedValue(
			createTextSignal({
				id: "sig-runner-reference",
				text: "@Runner please review this context",
			})
		);
		const currentMembersSnapshot = createMembersSnapshot({
			defaultAgentExecutionReadiness:
				createMissingBindingAgentExecutionReadiness(DEFAULT_AGENT_PROFILE_ID),
		}) as SpaceMembersSnapshot;
		const initialMembersSnapshot =
			createMembersSnapshot() as SpaceMembersSnapshot;
		const membersResult = createQueryResult({
			isSuccess: true,
			data: initialMembersSnapshot,
		});
		const setQueryDataMock = vi.fn(
			(queryKey: readonly unknown[], update: unknown) => {
				if (
					JSON.stringify(queryKey) ===
					JSON.stringify(
						spaceQueryKeys.members("space-123", DEFAULT_SPACE_PROFILE_ID)
					)
				) {
					const snapshot =
						typeof update === "function"
							? (update as (current: unknown) => unknown)(membersResult.data)
							: update;
					if (
						typeof snapshot === "object" &&
						snapshot !== null &&
						"humans" in snapshot &&
						"agents" in snapshot
					) {
						Object.assign(membersResult, { data: snapshot });
					}
				}
			}
		);
		useQueryClientMock.mockReturnValue({
			cancelQueries: vi.fn().mockResolvedValue(undefined),
			fetchQuery: vi.fn().mockResolvedValue(undefined),
			getQueryData: vi.fn(() => undefined),
			invalidateQueries: vi.fn().mockResolvedValue(undefined),
			resetQueries: vi.fn().mockResolvedValue(undefined),
			setQueriesData: vi.fn(),
			setQueryData: setQueryDataMock,
		});
		const currentBlockedReason =
			currentMembersSnapshot.agents[0]?.agentWakeAvailability?.summary;
		if (!currentBlockedReason) {
			throw new Error(
				"Expected current Core Wakeability reason in the fixture."
			);
		}
		readSpaceMembersMock.mockResolvedValue(currentMembersSnapshot);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: membersResult,
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await insertComposerMember(RUNNER_OPTION_NAME);
		await appendComposerText(textarea, "please reply", "@Runner please reply");
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() => {
			expect(readSpaceMembersMock).toHaveBeenCalledWith({
				openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
				spaceId: "space-123",
			});
			expect(
				screen.getAllByText(currentBlockedReason).length
			).toBeGreaterThanOrEqual(1);
		});
		expect(postNormalMessageMock).not.toHaveBeenCalled();
		expect(readComposerValue(textarea)).toBe("");
		expect(textarea.getAttribute("contenteditable")).toBe("true");
		expect(membersResult.data).toBe(initialMembersSnapshot);
		expect(membersResult.data).not.toBe(currentMembersSnapshot);
		expect(
			initialMembersSnapshot.agents[0]?.agentWakeAvailability?.status
		).toBe("available_for_wake");
		await setComposerValue(textarea, "My new draft");
		readSpaceMembersMock.mockResolvedValue(createMembersSnapshot());
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() =>
			expect(postNormalMessageMock).toHaveBeenCalledWith(
				expect.objectContaining({
					messageEnvelope: expect.objectContaining({
						activationTargets: [DEFAULT_AGENT_PROFILE_ID],
						referenceTargets: [],
						text: "@Runner please reply",
					}),
				})
			)
		);
		expect(readSpaceMembersMock).toHaveBeenCalledTimes(2);
		expect(readComposerValue(textarea)).toBe("My new draft");
	});

	it("retains the Wake message for retry when the current readiness check fails", async () => {
		const postNormalMessageMock = vi.fn();
		readSpaceMembersMock.mockRejectedValueOnce(
			new Error("network unavailable")
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await insertComposerMember(RUNNER_OPTION_NAME);
		await appendComposerText(
			textarea,
			"keep this draft",
			"@Runner keep this draft"
		);
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		const errorMessage = await screen.findByText(
			"OpenMeld couldn't confirm that this agent can reply right now. Try again."
		);
		expect(postNormalMessageMock).not.toHaveBeenCalled();
		expect(readComposerValue(textarea)).toBe("");
		expect(
			screen.getByRole("log", { name: "Conversation history" }).textContent
		).toContain("keep this draft");
		expect(textarea.getAttribute("contenteditable")).toBe("true");
		const errorSurface = errorMessage.parentElement;
		if (!errorSurface) {
			throw new Error("Expected the Composer error surface.");
		}
		expect(
			within(errorSurface).getByRole("button", { name: "Retry" })
		).toBeTruthy();
		expect(within(errorSurface).queryByRole("link")).toBeNull();
	});

	it("inserts a bare Wake mention when an agent is selected", async () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await insertComposerMember(RUNNER_OPTION_NAME);

		await waitFor(() => {
			expect(readComposerValue(textarea)).toBe("@Runner ");
		});
		expect(
			screen.queryByRole("listbox", { name: "Member options" })
		).toBeNull();
		expect(
			screen.getByRole("combobox", {
				name: "Change relation for Runner",
			}).textContent
		).toBe("Wake");
		expect(screen.getAllByTestId("space-composer-profile-token")).toHaveLength(
			1
		);
	});

	it("inserts a bare Human Mention when a human is selected", async () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await insertComposerMember(MIRA_OPTION_NAME, "Mir");

		await waitFor(() => {
			expect(readComposerValue(textarea)).toBe("@Mira ");
		});
		expect(
			screen.queryByRole("combobox", { name: "Change relation for Mira" })
		).toBeNull();
	});

	it("keeps an explicit Agent Reference out of Wake targets", async () => {
		const postNormalMessageMock = vi.fn().mockResolvedValue(
			createTextSignal({
				id: "sig-runner-reference",
				text: "@Runner for context",
			})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await insertComposerMember(RUNNER_OPTION_NAME);

		await waitFor(() => {
			expect(readComposerValue(textarea)).toBe("@Runner ");
		});
		const relationControl = screen.getByRole("combobox", {
			name: "Change relation for Runner",
		});
		fireEvent.click(relationControl);
		fireEvent.click(
			screen.getByRole("option", {
				name: "Mention only — Won’t wake the agent",
			})
		);
		await waitFor(() => {
			expect(relationControl.textContent).toBe("Mention only");
		});
		await appendComposerText(textarea, "for context", "@Runner for context");
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalledWith({
				messageEnvelope: {
					activationTargets: [],
					mentionTargets: [],
					referenceTargets: [DEFAULT_AGENT_PROFILE_ID],
					text: "@Runner for context",
				},
				meta: {
					clientMessageId: expect.any(String),
					authorHasRead: true,
				},
				spaceId: "space-123",
				text: "@Runner for context",
				timeoutMs: 30_000,
			});
		});
	});

	it("keeps the first picker relation when the same Agent is mentioned twice", async () => {
		const postNormalMessageMock = vi.fn().mockResolvedValue(
			createTextSignal({
				id: "sig-repeated-runner-reference",
				text: "@Runner for context, then @Runner again",
			})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding();
		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await insertComposerMember(RUNNER_OPTION_NAME);
		fireEvent.click(
			screen.getByRole("combobox", {
				name: "Change relation for Runner",
			})
		);
		fireEvent.click(
			screen.getByRole("option", {
				name: "Mention only — Won’t wake the agent",
			})
		);
		await appendComposerText(
			textarea,
			"for context, then ",
			"@Runner for context, then "
		);
		await insertComposerMember(RUNNER_OPTION_NAME, "Run");
		await waitFor(() => {
			expect(readComposerValue(textarea)).toBe(
				"@Runner for context, then @Runner "
			);
			const tokens = screen.getAllByTestId("space-composer-profile-token");
			expect(tokens).toHaveLength(2);
			expect(
				within(tokens[1] as HTMLElement).getByText("Mention only")
			).toBeTruthy();
		});
		await appendComposerText(
			textarea,
			"again",
			"@Runner for context, then @Runner again"
		);
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalledWith({
				messageEnvelope: {
					activationTargets: [],
					mentionTargets: [],
					referenceTargets: [DEFAULT_AGENT_PROFILE_ID],
					text: "@Runner for context, then @Runner again",
				},
				meta: { clientMessageId: expect.any(String), authorHasRead: true },
				spaceId: "space-123",
				text: "@Runner for context, then @Runner again",
				timeoutMs: 30_000,
			});
		});
	});

	it("keeps multiple structured targets self-explanatory without a duplicate summary", async () => {
		const reviewerProfileId = "agt_33333333-3333-4333-8333-333333333333";
		const membersSnapshot = createMembersSnapshot({
			extraAgents: [
				{
					mentionAlias: "reviewer",
					profileId: reviewerProfileId,
					profileName: "Reviewer",
				},
			],
		});
		const postNormalMessageMock = vi.fn().mockResolvedValue(
			createTextSignal({
				id: "sig-multi-wake",
				text: "@Runner @Reviewer please compare",
			})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: membersSnapshot,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});
		readSpaceMembersMock.mockResolvedValue(membersSnapshot);

		renderSpaceLanding();

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await insertComposerMember(RUNNER_OPTION_NAME);
		await waitFor(() => {
			expect(readComposerValue(textarea)).toBe("@Runner ");
		});

		await insertComposerMember(REVIEWER_OPTION_NAME, "Rev");

		expect(screen.getAllByTestId("space-composer-profile-token")).toHaveLength(
			2
		);
		expect(screen.queryByText("Waking 2 agents")).toBeNull();

		await appendComposerText(
			textarea,
			"please compare",
			"@Runner @Reviewer please compare"
		);
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalledWith({
				messageEnvelope: {
					activationTargets: [DEFAULT_AGENT_PROFILE_ID, reviewerProfileId],
					mentionTargets: [],
					referenceTargets: [],
					text: "@Runner @Reviewer please compare",
				},
				meta: {
					clientMessageId: expect.any(String),
					authorHasRead: true,
				},
				spaceId: "space-123",
				text: "@Runner @Reviewer please compare",
				timeoutMs: 30_000,
			});
		});
	});

	it("keeps the landing live when history bootstrap fails", async () => {
		const getUpdatesMock = vi.fn().mockResolvedValue({
			signals: [],
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: getUpdatesMock,
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isError: true,
				error: createStructuredFailure({
					code: "network.request_failed",
					message: "History unavailable",
					requestId: "req-history-123",
				}),
			}),
		});

		renderSpaceLanding();

		expect(screen.getByText(HISTORY_BOOTSTRAP_ERROR_TEXT)).toBeTruthy();

		await waitFor(() => {
			expect(FakeWebSocket.instances).toHaveLength(1);
		});

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
		});
		expect(getUpdatesMock).not.toHaveBeenCalled();
	});

	it("tails canonical updates after the live socket opens when history already has a latest signal", async () => {
		const getUpdatesMock = vi.fn().mockResolvedValue({
			signals: [
				createTextSignal({
					id: "sig-tail",
					ts: 20,
					text: "Tail update",
				}),
			],
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: getUpdatesMock,
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-seed",
							ts: 10,
							text: "Seed message",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await waitFor(() => {
			expect(screen.getAllByText("Seed message").length).toBeGreaterThan(0);
			expect(FakeWebSocket.instances).toHaveLength(1);
		});

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
		});

		await waitFor(() => {
			expect(createWebSpaceApiMock).toHaveBeenCalledWith({
				openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
			});
			expect(getUpdatesMock).toHaveBeenCalledWith({
				spaceId: "space-123",
				afterSignalId: "sig-seed",
				limit: 50,
				signal: expect.any(AbortSignal),
			});
			expect(screen.getAllByText("Tail update").length).toBeGreaterThan(0);
		});
	});

	it("merges refreshed history snapshots without reconnecting the live socket", async () => {
		const getUpdatesMock = vi.fn().mockResolvedValue({
			signals: [],
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: getUpdatesMock,
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});

		const statusResult = createQueryResult({
			isSuccess: true,
			data: createSpaceStatus(),
		});
		const membersResult = createQueryResult({
			isSuccess: true,
			data: createMembersSnapshot(),
		});
		const historyRefetchMock = vi.fn().mockResolvedValue(undefined);
		let historyResult = createQueryResult({
			isSuccess: true,
			data: {
				envelopes: [
					createTextSignal({
						id: "sig-seed-1",
						ts: 10,
						text: "Seed message",
					}),
				],
				nextCursor: null,
			},
			refetch: historyRefetchMock,
		});
		const activeWakeProgressSummaryResult = createQueryResult({
			isSuccess: true,
			data: {
				items: [],
				get presentationEpoch() {
					return wakeProgressFixture.presentationEpoch;
				},
				query: {
					spaceId: "space-123",
					targetProfileId: null,
				},
			},
		});
		const threadsResult = createQueryResult({
			isSuccess: true,
			data: { previews: [], threads: [] },
		});
		const threadSignalsResult = createQueryResult({
			isSuccess: true,
			data: { signals: [] },
		});
		let bootstrapResult = createSpaceBootstrapQueryResult({
			history: historyResult,
			members: membersResult,
			status: statusResult,
			threads: threadsResult,
		});
		useQueryMock.mockImplementation(
			(options: { queryKey: readonly unknown[] }) => {
				const queryKey = JSON.stringify(options.queryKey);
				const directoryResult = resolveEmptyOrganizationDirectoryQueryResult(
					options.queryKey
				);
				if (directoryResult) {
					return directoryResult;
				}
				const modelCatalogResult = resolveModelCatalogQueryResult(
					options.queryKey
				);
				if (modelCatalogResult) {
					return modelCatalogResult;
				}
				const centerAgentDirectMessageProjectionResult =
					resolveCenterAgentDirectMessageProjectionQueryResult(
						options.queryKey
					);
				if (centerAgentDirectMessageProjectionResult) {
					return centerAgentDirectMessageProjectionResult;
				}
				const centerAgentDesignationResult =
					resolveCenterAgentDesignationQueryResult(options.queryKey);
				if (centerAgentDesignationResult) {
					return centerAgentDesignationResult;
				}
				const organizationRoleResult = resolveOrganizationRoleQueryResult(
					options.queryKey
				);
				if (organizationRoleResult) {
					return organizationRoleResult;
				}
				const organizationSpacesResult = resolveOrganizationSpacesQueryResult(
					options.queryKey
				);
				if (organizationSpacesResult) {
					return organizationSpacesResult;
				}
				const spaceInboxUnreadTargetsResult =
					resolveSpaceInboxUnreadTargetsQueryResult(options.queryKey);
				if (spaceInboxUnreadTargetsResult) {
					return spaceInboxUnreadTargetsResult;
				}
				if (
					queryKey ===
					JSON.stringify([
						"spaces",
						"display-snapshot",
						"space-123",
						DEFAULT_SPACE_PROFILE_ID,
					])
				) {
					return createQueryResult({
						isSuccess: true,
						data: undefined,
					});
				}
				if (
					JSON.stringify(options.queryKey.slice(0, 4)) ===
					JSON.stringify([
						"spaces",
						"active-wake-progress-summary",
						"space-123",
						DEFAULT_SPACE_PROFILE_ID,
					])
				) {
					return activeWakeProgressSummaryResult;
				}
				if (
					queryKey ===
					JSON.stringify([
						"spaces",
						"bootstrap",
						"space-123",
						DEFAULT_SPACE_PROFILE_ID,
					])
				) {
					return bootstrapResult;
				}
				if (
					queryKey ===
					JSON.stringify([
						"spaces",
						"status",
						"space-123",
						DEFAULT_SPACE_PROFILE_ID,
					])
				) {
					return statusResult;
				}
				if (
					queryKey ===
					JSON.stringify([
						"spaces",
						"members",
						"space-123",
						DEFAULT_SPACE_PROFILE_ID,
					])
				) {
					return membersResult;
				}
				if (
					queryKey ===
					JSON.stringify([
						"spaces",
						"history",
						"space-123",
						DEFAULT_SPACE_PROFILE_ID,
					])
				) {
					return historyResult;
				}
				if (
					queryKey ===
					JSON.stringify([
						"spaces",
						"threads",
						"space-123",
						DEFAULT_SPACE_PROFILE_ID,
					])
				) {
					return threadsResult;
				}
				if (
					Array.isArray(options.queryKey) &&
					options.queryKey[0] === "spaces" &&
					options.queryKey[1] === "thread-signals" &&
					options.queryKey[2] === "space-123" &&
					options.queryKey[4] === DEFAULT_SPACE_PROFILE_ID
				) {
					return threadSignalsResult;
				}
				if (
					Array.isArray(options.queryKey) &&
					options.queryKey[1] === "account-spaces"
				) {
					return createQueryResult({
						isSuccess: true,
						data: createAccountSpaceSections(),
					});
				}
				if (
					Array.isArray(options.queryKey) &&
					options.queryKey[0] === "user" &&
					options.queryKey[1] === "session"
				) {
					return createQueryResult({
						isSuccess: true,
						data: { user: { id: "user-1", name: "Mira" } },
					});
				}
				throw new Error(`Unexpected query key: ${queryKey}`);
			}
		);

		const { rerender } = renderSpaceLanding();

		await waitFor(() => {
			expect(screen.getAllByText("Seed message").length).toBeGreaterThan(0);
			expect(FakeWebSocket.instances).toHaveLength(1);
		});

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
		});

		expect(getUpdatesMock).toHaveBeenCalledTimes(2);

		historyResult = createQueryResult({
			isSuccess: true,
			data: {
				envelopes: [
					createTextSignal({
						id: "sig-seed-1",
						ts: 10,
						text: "Seed message",
					}),
					createTextSignal({
						id: "sig-seed-2",
						ts: 20,
						text: "Refetched message",
					}),
				],
				nextCursor: null,
			},
			refetch: historyRefetchMock,
		});
		bootstrapResult = createSpaceBootstrapQueryResult({
			history: historyResult,
			members: membersResult,
			status: statusResult,
			threads: threadsResult,
		});

		rerender(
			<SpaceLanding
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);

		await waitFor(() => {
			expect(screen.getAllByText("Refetched message").length).toBeGreaterThan(
				0
			);
		});

		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(getUpdatesMock).toHaveBeenCalledTimes(2);
	});

	it("appends live text updates to the conversation without refetching status", async () => {
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(FakeWebSocket.instances).toHaveLength(1);
		const conversationHistory = screen.getByRole("log", {
			name: "Conversation history",
		});
		setElementScrollMetrics(conversationHistory, {
			clientHeight: 320,
			scrollHeight: 960,
			scrollTop: 640,
		});

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
		});

		setElementScrollMetrics(conversationHistory, {
			clientHeight: 320,
			scrollHeight: 1280,
			scrollTop: 640,
		});
		await act(async () => {
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createTextSignal({
						id: "sig-live-1",
						ts: 30,
						text: "Live text update",
					})
				)
			);
		});

		await waitFor(() => {
			expect(screen.getAllByText("Live text update")).toHaveLength(1);
			expect(conversationHistory.scrollTop).toBe(960);
		});
		expect(statusRefetchMock).not.toHaveBeenCalled();
	});

	it("keeps the history skeleton while live messages arrive before history is ready", async () => {
		mockSpaceQueries({
			bootstrap: createQueryResult({
				isPending: true,
			}),
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isPending: true,
			}),
		});

		renderSpaceLanding();

		await waitFor(() => {
			expect(FakeWebSocket.instances).toHaveLength(1);
		});
		const conversationHistory = screen.getByRole("log", {
			name: "Conversation history",
		});
		expect(conversationHistory.getAttribute("aria-busy")).toBe("true");

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createTextSignal({
						id: "sig-live-before-history",
						ts: 30,
						text: "Live text before history",
					})
				)
			);
		});

		expect(conversationHistory.getAttribute("aria-busy")).toBe("true");
		expect(
			within(conversationHistory).queryByText("Live text before history")
		).toBeNull();
	});

	it("shows saved conversation history while the full bootstrap is still loading", () => {
		mockSpaceQueries({
			bootstrap: createQueryResult({
				isPending: true,
			}),
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isPending: true,
			}),
			threads: createQueryResult({ isPending: true }),
			history: createQueryResult({
				isSuccess: true,
				data: {
					threadDisplay: {
						threads: [
							{
								threadId: "thr_11111111-1111-4111-8111-111111111111",
								spaceId: "space-123",
								rootSignalId: "sig-saved-history",
								createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
								createdAt: "2026-09-14T00:00:00.000Z",
								updatedAt: "2026-09-14T00:00:00.000Z",
							},
						],
						previews: [
							{
								threadId: "thr_11111111-1111-4111-8111-111111111111",
								replyCount: 7,
								placements: [
									{
										createdAt: "2026-09-14T00:00:01.000Z",
										placement: "thread",
										signalId: "saved-reply",
										threadId: "thr_11111111-1111-4111-8111-111111111111",
									},
								],
								signals: [
									createTextSignal({
										id: "saved-reply",
										text: "Saved reply preview",
									}),
								],
							},
						],
					},
					envelopes: [
						createTextSignal({
							id: "sig-saved-history",
							text: "Visible from the saved browser view",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(
			screen.getByText("Visible from the saved browser view")
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Open thread (7 replies)" })
		).toBeTruthy();
		expect(
			within(
				screen.getByRole("button", { name: THREAD_REPLY_PREVIEW_PATTERN })
			).getByText("Saved reply preview")
		).toBeTruthy();
		expect(
			screen
				.getByRole("log", { name: "Conversation history" })
				.getAttribute("aria-busy")
		).toBe("false");
	});

	it("keeps an unresolved cached Agent identity as a placeholder while bootstrap loads", () => {
		mockSpaceQueries({
			bootstrap: createQueryResult({ isPending: true }),
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({ isPending: true }),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-saved-agent-history",
							profile: {
								kind: "agent",
								profileId: DEFAULT_AGENT_PROFILE_ID,
								profileName: "Runner",
							},
							text: "Visible from the saved browser view",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(
			screen.getByTestId(
				`space-agent-profile-pending-avatar-${DEFAULT_AGENT_PROFILE_ID}`
			)
		).toBeTruthy();
		expect(
			screen.queryByTestId(
				`space-agent-profile-fallback-avatar-${DEFAULT_AGENT_PROFILE_ID}`
			)
		).toBeNull();
	});

	it("routes live thread replies to thread state instead of the main conversation", async () => {
		const setQueryDataMock = vi.fn();
		const threadId = "thr_11111111-1111-4111-8111-111111111111";
		useQueryClientMock.mockReturnValue({
			invalidateQueries: vi.fn().mockResolvedValue(undefined),
			setQueryData: setQueryDataMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-root",
							text: "Root message",
						}),
					],
					nextCursor: null,
				},
			}),
			threads: createQueryResult({
				isSuccess: true,
				data: {
					threads: [
						{
							threadId,
							spaceId: "space-123",
							rootSignalId: "sig-root",
							createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
							createdAt: "2026-04-11T00:00:00.000Z",
							updatedAt: "2026-04-11T00:00:00.000Z",
						},
					],
					previews: [],
				},
			}),
		});

		renderSpaceLanding();

		await waitFor(() => {
			expect(FakeWebSocket.instances).toHaveLength(1);
		});
		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
		});
		await act(async () => {
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify({
					type: "space.signal",
					signal: createTextSignal({
						id: "sig-thread-live",
						text: "Live thread reply",
						ts: 30,
					}),
					threadContext: {
						threadId,
						rootSignalId: "sig-root",
					},
					threadPlacement: {
						threadId,
						signalId: "sig-thread-live",
						placement: "thread",
						createdAt: "2026-04-11T00:00:03.000Z",
					},
				})
			);
		});

		await waitFor(() => {
			expect(setQueryDataMock).toHaveBeenCalled();
		});
		expect(screen.queryByText("Live thread reply")).toBeNull();
	});

	it("keeps thread Wake progress out of the main transcript when the final reply arrives in a thread", async () => {
		const threadId = "thr_11111111-1111-4111-8111-111111111111";
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-root",
							text: "Root message",
						}),
						createTextSignal({
							id: "sig-thread-running",
							text: "@runner is working on this computer...",
							ts: RECENT_ACTIVITY_TS,
							meta: {
								dispatchId: "dispatch-thread-1",
								purpose: AGENT_REPLYING_PURPOSE,
								sourceEventId: "sig-thread-wake",
								targetMentionLabel: "runner",
								targetProfileId: DEFAULT_AGENT_PROFILE_ID,
								transient: true,
							},
							profile: {
								kind: "agent",
								profileId: DEFAULT_AGENT_PROFILE_ID,
								profileName: "Runner",
							},
						}),
					],
					nextCursor: null,
				},
			}),
			threads: createQueryResult({
				isSuccess: true,
				data: {
					threads: [
						{
							threadId,
							spaceId: "space-123",
							rootSignalId: "sig-root",
							createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
							createdAt: "2026-04-11T00:00:00.000Z",
							updatedAt: "2026-04-11T00:00:00.000Z",
						},
					],
					previews: [],
				},
			}),
		});

		renderSpaceLanding();

		expect(
			screen.queryByText("@runner is working on this computer...")
		).toBeNull();
		await waitFor(() => {
			expect(FakeWebSocket.instances).toHaveLength(1);
		});
		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
		});
		await act(async () => {
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify({
					type: "space.signal",
					signal: createTextSignal({
						id: "sig-thread-final",
						text: "Done in the thread.",
						ts: RECENT_ACTIVITY_TS + 1,
						meta: {
							dispatchId: "dispatch-thread-1",
							purpose: AGENT_REPLY_FINAL_PURPOSE,
						},
						profile: {
							kind: "agent",
							profileId: DEFAULT_AGENT_PROFILE_ID,
							profileName: "Runner",
						},
					}),
					threadContext: {
						threadId,
						rootSignalId: "sig-root",
					},
					threadPlacement: {
						threadId,
						signalId: "sig-thread-final",
						placement: "thread",
						createdAt: "2026-04-11T00:00:03.000Z",
					},
				})
			);
		});

		await waitFor(() => {
			expect(
				screen.queryByText("@runner is working on this computer...")
			).toBeNull();
		});
		expect(screen.queryByText("Done in the thread.")).toBeNull();
	});

	it("shows a jump-to-latest button when the conversation is scrolled above the latest message", async () => {
		// jsdom's shared frame scheduler can retain an interval from an earlier
		// fake-clock test. Give this real-clock interaction its own frame queue.
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
			window.setTimeout(() => callback(performance.now()), 0)
		);
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) =>
			window.clearTimeout(id)
		);
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-scroll-1",
							ts: 10,
							text: "Earlier visible message",
						}),
						createTextSignal({
							id: "sig-scroll-2",
							ts: 20,
							text: "Latest visible message",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const conversationHistory = screen.getByRole("log", {
			name: "Conversation history",
		});
		setElementScrollMetrics(conversationHistory, {
			clientHeight: 320,
			scrollHeight: 960,
			scrollTop: 320,
		});
		const scrollToMock = vi.fn((options: ScrollToOptions) => {
			conversationHistory.scrollTop = Math.min(Number(options.top), 640);
			fireEvent.scroll(conversationHistory);
		});
		Object.defineProperty(conversationHistory, "scrollTo", {
			configurable: true,
			value: scrollToMock,
		});

		const jumpButton = screen.getByRole("button", {
			name: "Jump to latest message",
		});
		expect(
			jumpButton.closest("[data-active]")?.getAttribute("data-active")
		).toBe("false");
		expect(jumpButton.closest("[data-active]")?.hasAttribute("inert")).toBe(
			true
		);

		const latestMessageItem = conversationHistory.querySelector<HTMLElement>(
			"[data-message-id='sig-scroll-2']"
		);
		if (!latestMessageItem) {
			throw new Error("Expected the latest MessageScroller item");
		}
		vi.spyOn(latestMessageItem, "getBoundingClientRect").mockImplementation(
			() =>
				createTestDomRect({
					bottom: 960 - conversationHistory.scrollTop,
					height: 80,
					top: 880 - conversationHistory.scrollTop,
				})
		);
		fireEvent.wheel(conversationHistory);
		fireEvent.scroll(conversationHistory);

		await waitFor(() => {
			expect(
				jumpButton.closest("[data-active]")?.getAttribute("data-active")
			).toBe("true");
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Jump to latest message" }),
			{ button: 0, detail: 1 }
		);

		await waitFor(() => expect(conversationHistory.scrollTop).toBe(640));
		await waitFor(() => {
			expect(
				screen
					.getByRole("button", { name: "Jump to latest message" })
					.closest("[data-active]")
					?.getAttribute("data-active")
			).toBe("false");
		});
		expect(
			screen
				.getByRole("button", { name: "Jump to latest message" })
				.closest("[data-active]")
				?.hasAttribute("inert")
		).toBe(true);
	});

	it("refetches members after a live agent reply so member readiness does not stay stale", async () => {
		vi.useFakeTimers();
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentExecutionReadiness:
						createRouteUpdatingAgentExecutionReadiness(),
					wakeRouteEvidence: createDaemonRouteObservationSummary({
						observedAt: "2026-04-11T00:00:00.000Z",
						status: "offline",
					}),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["route.not_registered"],
						reasonText: "Route still registering",
					},
				}),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(FakeWebSocket.instances).toHaveLength(1);

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createTextSignal({
						id: "sig-agent-reply",
						ts: 35,
						text: "The agent can reply now.",
						meta: {
							dispatchId: "dispatch-1",
							purpose: AGENT_REPLY_FINAL_PURPOSE,
						},
						profile: {
							kind: "agent",
							profileId: "agt_22222222-2222-2222-2222-222222222222",
							profileName: "Runner",
						},
					})
				)
			);
		});

		expect(membersRefetchMock).toHaveBeenCalledTimes(1);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(301);
		});

		expect(membersRefetchMock).toHaveBeenCalledTimes(2);
	});

	it("refreshes canonical members and owner-only recovery after a live final agent reply", async () => {
		vi.useFakeTimers();
		const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		useQueryClientMock.mockReturnValue({
			invalidateQueries: invalidateQueriesMock,
			setQueryData: vi.fn(),
		});
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			refreshAll: refreshAllMock,
			storageScope: "test-storage-scope",
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createTextSignal({
						id: "sig-agent-final-reply",
						ts: 35,
						text: "The final answer is ready.",
						meta: {
							dispatchId: "dispatch-1",
							purpose: AGENT_REPLY_FINAL_PURPOSE,
							targetProfileId: DEFAULT_AGENT_PROFILE_ID,
						},
						profile: {
							kind: "agent",
							profileId: DEFAULT_AGENT_PROFILE_ID,
							profileName: "Runner",
						},
					})
				)
			);
		});

		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		expect(refreshAllMock).not.toHaveBeenCalled();
		expect(statusRefetchMock).not.toHaveBeenCalled();
		expect(membersRefetchMock).not.toHaveBeenCalled();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(301);
		});
		await flushPromiseQueue();

		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		expect(refreshAllMock).not.toHaveBeenCalled();
		for (const invalidation of buildSharedReadinessCacheInvalidations()) {
			expect(invalidateQueriesMock).toHaveBeenCalledWith(
				expect.objectContaining(invalidation),
				{ cancelRefetch: false }
			);
		}
		for (const invalidation of buildLocalRuntimeCacheInvalidations()) {
			expect(invalidateQueriesMock).not.toHaveBeenCalledWith(
				expect.objectContaining(invalidation)
			);
		}
		expect(statusRefetchMock).toHaveBeenCalledTimes(1);
		expect(membersRefetchMock).toHaveBeenCalledTimes(1);
	});

	it("refreshes canonical readiness from a server-owned Core facts changed marker", async () => {
		vi.useFakeTimers();
		const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		useQueryClientMock.mockReturnValue({
			invalidateQueries: invalidateQueriesMock,
			setQueryData: vi.fn(),
		});
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			refreshAll: refreshAllMock,
			storageScope: "test-storage-scope",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createStatusSignal({
						coreReadinessFactsChanged: {
							agentProfileId: DEFAULT_AGENT_PROFILE_ID,
							kind: CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
						},
						id: "sig-core-readiness-facts-changed",
						text: "Blocked by local setup.",
						ts: 35,
					})
				)
			);
			await vi.advanceTimersByTimeAsync(301);
		});
		await flushPromiseQueue();

		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		expect(statusRefetchMock).toHaveBeenCalledTimes(1);
		expect(membersRefetchMock).toHaveBeenCalledTimes(1);
		expect(refreshAllMock).not.toHaveBeenCalled();
		for (const invalidation of buildLocalRuntimeCacheInvalidations()) {
			expect(invalidateQueriesMock).not.toHaveBeenCalledWith(
				expect.objectContaining(invalidation)
			);
		}
	});

	it("does not refresh local runtime caches after a live Agent readiness invalidation", async () => {
		vi.useFakeTimers();
		const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		useQueryClientMock.mockReturnValue({
			invalidateQueries: invalidateQueriesMock,
			setQueryData: vi.fn(),
		});
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			refreshAll: refreshAllMock,
			storageScope: "test-storage-scope",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify({
					agentProfileIds: [DEFAULT_AGENT_PROFILE_ID],
					reason: "daemon.session.registered",
					spaceId: "space-123",
					type: "agent.readiness.invalidated",
					version: 1,
				})
			);
			await vi.advanceTimersByTimeAsync(501);
		});
		await flushPromiseQueue();

		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		for (const invalidation of buildLocalRuntimeCacheInvalidations()) {
			expect(invalidateQueriesMock).not.toHaveBeenCalledWith(
				expect.objectContaining(invalidation)
			);
		}
		expect(refreshAllMock).not.toHaveBeenCalled();
		expect(statusRefetchMock).toHaveBeenCalledTimes(1);
		expect(membersRefetchMock).toHaveBeenCalledTimes(1);
	});

	it("refreshes canonical members and owner-only recovery after a RuntimeCoordinator terminal failure notice", async () => {
		vi.useFakeTimers();
		const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		useQueryClientMock.mockReturnValue({
			invalidateQueries: invalidateQueriesMock,
			setQueryData: vi.fn(),
		});
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			refreshAll: refreshAllMock,
			storageScope: "test-storage-scope",
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createTerminalFailureNoticeSignal({
						actorProfileId: DEFAULT_AGENT_PROFILE_ID,
						id: "sig-agent-terminal-failure",
						ts: 35,
					})
				)
			);
			await vi.advanceTimersByTimeAsync(301);
		});
		await flushPromiseQueue();

		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		expect(statusRefetchMock).toHaveBeenCalledTimes(1);
		expect(membersRefetchMock).toHaveBeenCalledTimes(1);
		expect(refreshAllMock).not.toHaveBeenCalled();
		expect(invalidateQueriesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				queryKey: agentExecutionReadinessQueryKeys.batchesForOrganization(
					"test-storage-scope",
					"org-acme"
				),
				refetchType: "active",
			}),
			{ cancelRefetch: false }
		);
		for (const invalidation of buildLocalRuntimeCacheInvalidations()) {
			expect(invalidateQueriesMock).not.toHaveBeenCalledWith(
				expect.objectContaining(invalidation)
			);
		}
	});

	it("refreshes canonical members after a thread final agent reply", async () => {
		vi.useFakeTimers();
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		const threadId = "thr_11111111-1111-4111-8111-111111111111";
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			refreshAll: refreshAllMock,
			storageScope: "test-storage-scope",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
			threads: createQueryResult({
				isSuccess: true,
				data: {
					threads: [
						{
							threadId,
							spaceId: "space-123",
							rootSignalId: "sig-root",
							createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
							createdAt: "2026-04-11T00:00:00.000Z",
							updatedAt: "2026-04-11T00:00:00.000Z",
						},
					],
					previews: [],
				},
			}),
		});

		renderSpaceLanding();

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify({
					type: "space.signal",
					signal: createTextSignal({
						id: "sig-thread-final-reply-refresh",
						text: "Done in the thread.",
						ts: RECENT_ACTIVITY_TS + 1,
						meta: {
							dispatchId: "dispatch-thread-1",
							purpose: AGENT_REPLY_FINAL_PURPOSE,
							targetProfileId: DEFAULT_AGENT_PROFILE_ID,
						},
						profile: {
							kind: "agent",
							profileId: DEFAULT_AGENT_PROFILE_ID,
							profileName: "Runner",
						},
					}),
					threadContext: {
						threadId,
						rootSignalId: "sig-root",
					},
					threadPlacement: {
						threadId,
						signalId: "sig-thread-final-reply-refresh",
						placement: "thread",
						createdAt: "2026-04-11T00:00:03.000Z",
					},
				})
			);
			await vi.advanceTimersByTimeAsync(301);
		});
		await flushPromiseQueue();

		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		expect(statusRefetchMock).toHaveBeenCalledTimes(1);
		expect(membersRefetchMock).toHaveBeenCalledTimes(1);
		expect(refreshAllMock).not.toHaveBeenCalled();
	});

	it("clears recovery banner and member row after canonical members refresh returns ready", async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const blockedMembersSnapshot = createMembersSnapshot({
			defaultAgentExecutionReadiness:
				createServiceNotConnectedAgentExecutionReadiness(
					DEFAULT_AGENT_PROFILE_ID
				),
			wakeState: "offline",
			wakeability: {
				status: "blocked",
				reasonCodes: ["local_service.not_connected_for_account"],
				reasonText:
					"OpenMeld Service is not connected for this OpenMeld account on this computer.",
			},
		});
		const readyMembersSnapshot = createMembersSnapshot();
		const membersQueryResult = createQueryResult({
			isSuccess: true,
			data: blockedMembersSnapshot,
			refetch: vi.fn().mockImplementation(() => {
				(membersQueryResult as { data: unknown }).data = readyMembersSnapshot;
				return Promise.resolve({ data: readyMembersSnapshot });
			}),
		});
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: refreshAllMock,
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
			storageScope: "test-storage-scope",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: membersQueryResult,
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		const view = renderSpaceLanding();

		// Computer-level recovery is owned by the Get-set-up banner, so the old
		// conversation-level recovery banner stays removed while the member row still
		// shows its Offline indicator.
		expect(
			screen.queryByRole("region", { name: "Local agent wake warning" })
		).toBeNull();
		const blockedPanel = screen.getByRole("complementary", {
			name: "Members",
		});
		expectSpaceAgentAvailabilityIndicator(blockedPanel, {
			label: "Offline",
			tooltip: "Computer not connected",
		});
		expect(
			within(blockedPanel).queryByText("Reconnect OpenMeld Service")
		).toBeNull();

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createTextSignal({
						id: "sig-final-ready-refresh",
						ts: 35,
						text: "The final answer is ready.",
						meta: {
							dispatchId: "dispatch-1",
							purpose: AGENT_REPLY_FINAL_PURPOSE,
							targetProfileId: DEFAULT_AGENT_PROFILE_ID,
						},
						profile: {
							kind: "agent",
							profileId: DEFAULT_AGENT_PROFILE_ID,
							profileName: "Runner",
						},
					})
				)
			);
			await vi.advanceTimersByTimeAsync(301);
		});
		await flushPromiseQueue();
		view.rerender(
			<SpaceLanding
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);

		expect(
			screen.queryByRole("region", { name: "Local agent wake warning" })
		).toBeNull();
		const readyPanel = screen.getByRole("complementary", { name: "Members" });
		expect(
			within(readyPanel).queryByText("Reconnect OpenMeld Service")
		).toBeNull();
		expectSpaceAgentAvailabilityIndicator(readyPanel, {
			label: "Available",
			tooltip: "Available for Wake",
		});
	});

	it("keeps refreshing member recovery after a final reply until canonical members converge", async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const blockedMembersSnapshot = createMembersSnapshot({
			defaultAgentExecutionReadiness:
				createServiceNotConnectedAgentExecutionReadiness(
					DEFAULT_AGENT_PROFILE_ID
				),
			wakeState: "offline",
			wakeability: {
				status: "blocked",
				reasonCodes: ["local_service.not_connected_for_account"],
				reasonText:
					"OpenMeld Service is not connected for this OpenMeld account on this computer.",
			},
		});
		const readyMembersSnapshot = createMembersSnapshot();
		let membersRefetchCount = 0;
		const membersQueryResult = createQueryResult({
			isSuccess: true,
			data: blockedMembersSnapshot,
			refetch: vi.fn().mockImplementation(() => {
				membersRefetchCount += 1;
				const nextSnapshot =
					membersRefetchCount >= 3
						? readyMembersSnapshot
						: blockedMembersSnapshot;
				(membersQueryResult as { data: unknown }).data = nextSnapshot;
				return Promise.resolve({ data: nextSnapshot });
			}),
		});
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: refreshAllMock,
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
			storageScope: "test-storage-scope",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: membersQueryResult,
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		const view = renderSpaceLanding();
		const blockedPanel = screen.getByRole("complementary", {
			name: "Members",
		});
		expectSpaceAgentAvailabilityIndicator(blockedPanel, {
			label: "Offline",
			tooltip: "Computer not connected",
		});
		expect(
			within(blockedPanel).queryByText("Reconnect OpenMeld Service")
		).toBeNull();

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createTextSignal({
						id: "sig-final-slow-members-convergence",
						ts: 35,
						text: "The final answer is ready.",
						meta: {
							dispatchId: "dispatch-1",
							purpose: AGENT_REPLY_FINAL_PURPOSE,
							targetProfileId: DEFAULT_AGENT_PROFILE_ID,
						},
						profile: {
							kind: "agent",
							profileId: DEFAULT_AGENT_PROFILE_ID,
							profileName: "Runner",
						},
					})
				)
			);
			await vi.advanceTimersByTimeAsync(301);
		});
		await flushPromiseQueue();
		view.rerender(
			<SpaceLanding
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);

		const checkingPanel = screen.getByRole("complementary", {
			name: "Members",
		});
		expectSpaceAgentAvailabilityIndicator(checkingPanel, {
			label: "Offline",
			tooltip: "Computer not connected",
		});
		expect(
			within(checkingPanel).queryByRole("link", {
				name: "Reconnect OpenMeld Service",
			})
		).toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});
		await flushPromiseQueue();
		view.rerender(
			<SpaceLanding
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);

		const readyPanel = screen.getByRole("complementary", { name: "Members" });
		expect(
			within(readyPanel).queryByText("Reconnect OpenMeld Service")
		).toBeNull();
		expectNoSpaceAgentAvailabilityIndicator(readyPanel, {
			label: "Checking",
		});
		expectSpaceAgentAvailabilityIndicator(readyPanel, {
			label: "Available",
			tooltip: "Available for Wake",
		});
		expect(membersQueryResult.refetch).toHaveBeenCalledTimes(3);
	});

	it("refreshes from public checking presence until canonical members converge", async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const checkingMembersSnapshot = withDefaultAgentAgentWakeAvailability(
			createMembersSnapshot({
				defaultAgentExecutionReadiness: null,
			}) as SpaceMembersSnapshot,
			createTestAgentAgentWakeAvailability("checking_connection")
		);
		const readyMembersSnapshot = createMembersSnapshot();
		const membersQueryResult = createQueryResult({
			isSuccess: true,
			data: checkingMembersSnapshot,
			refetch: vi.fn().mockImplementation(() => {
				(membersQueryResult as { data: unknown }).data = readyMembersSnapshot;
				return Promise.resolve({ data: readyMembersSnapshot });
			}),
		});
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: refreshAllMock,
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
			storageScope: "test-storage-scope",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: membersQueryResult,
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		const view = renderSpaceLanding();
		const checkingPanel = openDesktopMembersPanel();
		expectSpaceAgentAvailabilityIndicator(checkingPanel, {
			isRefreshing: true,
			label: "Checking",
			tooltip: "Checking Wake availability",
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});
		await flushPromiseQueue();
		view.rerender(
			<SpaceLanding
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);

		const readyPanel = screen.getByRole("complementary", {
			name: "Members",
		});
		expectNoSpaceAgentAvailabilityIndicator(readyPanel, {
			label: "Checking",
		});
		expectSpaceAgentAvailabilityIndicator(readyPanel, {
			label: "Available",
			tooltip: "Available for Wake",
		});
		expect(notifyAgentExecutionReadinessRefreshMock).toHaveBeenCalledWith({
			agentProfileIds: [DEFAULT_AGENT_PROFILE_ID],
			organizationId: "org-acme",
		});
		expect(refreshAllMock).not.toHaveBeenCalled();
		expect(membersQueryResult.refetch).toHaveBeenCalled();
	});

	it("does not refresh from public unavailable presence alone", async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const unavailableMembersSnapshot = withDefaultAgentAgentWakeAvailability(
			createMembersSnapshot({
				defaultAgentExecutionReadiness: null,
			}) as SpaceMembersSnapshot,
			createTestAgentAgentWakeAvailability("unavailable_for_wake")
		);
		const membersQueryResult = createQueryResult({
			isSuccess: true,
			data: unavailableMembersSnapshot,
			refetch: vi.fn(),
		});
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: refreshAllMock,
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
			storageScope: "test-storage-scope",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: membersQueryResult,
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		const view = renderSpaceLanding();
		const unavailablePanel = openDesktopMembersPanel();
		expect(
			within(unavailablePanel).queryByText("Checking availability")
		).toBeNull();
		expect(
			within(unavailablePanel).queryByText("Reconnect OpenMeld Service")
		).toBeNull();

		await flushPromiseQueue();
		view.rerender(
			<SpaceLanding
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);

		const currentPanel = screen.getByRole("complementary", {
			name: "Members",
		});
		expectNoSpaceAgentAvailabilityIndicator(currentPanel, {
			label: "Available",
			tooltip: "Available for Wake",
		});
		expect(
			within(currentPanel).queryByText("Checking availability")
		).toBeNull();
		expect(
			within(currentPanel).queryByText("Reconnect OpenMeld Service")
		).toBeNull();
		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		expect(refreshAllMock).not.toHaveBeenCalled();
		expect(membersQueryResult.refetch).not.toHaveBeenCalled();
	});

	it("does not let shared cache refresh failure block status and members refresh", async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"matchMedia",
			createMatchMediaMock({ desktopMembersPanel: true })
		);
		const warnMock = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		let failedReadinessInvalidation = false;
		const invalidateQueriesMock = vi.fn(
			(input: { queryKey?: readonly unknown[] }) => {
				const isReadinessInvalidation =
					input.queryKey?.[0] === "agents" &&
					input.queryKey?.[1] === "execution-readiness";
				if (isReadinessInvalidation && !failedReadinessInvalidation) {
					failedReadinessInvalidation = true;
					return Promise.reject(new Error("readiness refresh failed"));
				}
				return Promise.resolve(undefined);
			}
		);
		useQueryClientMock.mockReturnValue({
			getQueryCache: vi.fn(() => ({ find: vi.fn(() => null) })),
			getQueryData: vi.fn(),
			invalidateQueries: invalidateQueriesMock,
			setQueryData: vi.fn(),
		});
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			currentDeviceTargetQuery: {
				data: {
					availability: "resolved",
					deviceId: "device-office",
				},
			},
			selectedTargetDevice: {
				deviceId: "device-office",
				deviceDisplayName: "Office Mac mini",
			},
			refreshAll: refreshAllMock,
			startStateQuery: {
				data: createStartStateWithCodexCatalog(),
			},
			storageScope: "test-storage-scope",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentExecutionReadiness:
						createServiceNotConnectedAgentExecutionReadiness(
							DEFAULT_AGENT_PROFILE_ID
						),
					wakeState: "offline",
					wakeability: {
						status: "blocked",
						reasonCodes: ["local_service.not_connected_for_account"],
						reasonText:
							"OpenMeld Service is not connected for this OpenMeld account on this computer.",
					},
				}),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		// Computer-level recovery is owned by the Get-set-up banner, and the
		// shared-cache refresh below still runs from the member recovery state.
		expect(
			screen.queryByRole("region", { name: "Local agent wake warning" })
		).toBeNull();
		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createTextSignal({
						id: "sig-final-refresh-failed",
						ts: 35,
						text: "The final answer is ready.",
						meta: {
							dispatchId: "dispatch-1",
							purpose: AGENT_REPLY_FINAL_PURPOSE,
							targetProfileId: DEFAULT_AGENT_PROFILE_ID,
						},
						profile: {
							kind: "agent",
							profileId: DEFAULT_AGENT_PROFILE_ID,
							profileName: "Runner",
						},
					})
				)
			);
			await vi.advanceTimersByTimeAsync(301);
		});
		await flushPromiseQueue();

		expect(
			screen.queryByRole("region", { name: "Local agent wake warning" })
		).toBeNull();
		expect(warnMock).toHaveBeenCalledWith(
			"[openmeld.web.space.wake_final_outcome_refresh_failed]",
			expect.objectContaining({
				agentProfileId: DEFAULT_AGENT_PROFILE_ID,
				error: "readiness refresh failed",
				signalId: "sig-final-refresh-failed",
				spaceId: "space-123",
				step: "shared_caches",
			})
		);
		expect(statusRefetchMock).toHaveBeenCalledTimes(2);
		expect(membersRefetchMock).toHaveBeenCalledTimes(2);
		expect(invalidateQueriesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				queryKey: agentExecutionReadinessQueryKeys.batchesForOrganization(
					"test-storage-scope",
					"org-acme"
				),
				refetchType: "active",
			}),
			{ cancelRefetch: false }
		);
	});

	it("does not let members refresh failure hide an observable final outcome refresh failure", async () => {
		vi.useFakeTimers();
		const warnMock = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi
			.fn()
			.mockRejectedValue(new Error("members refresh failed"));
		useQueryClientMock.mockReturnValue({
			getQueryCache: vi.fn(() => ({ find: vi.fn(() => null) })),
			getQueryData: vi.fn(),
			invalidateQueries: invalidateQueriesMock,
			setQueryData: vi.fn(),
		});
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			refreshAll: refreshAllMock,
			storageScope: "test-storage-scope",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createTextSignal({
						id: "sig-final-members-refresh-failed",
						ts: 35,
						text: "The final answer is ready.",
						meta: {
							dispatchId: "dispatch-1",
							purpose: AGENT_REPLY_FINAL_PURPOSE,
							targetProfileId: DEFAULT_AGENT_PROFILE_ID,
						},
						profile: {
							kind: "agent",
							profileId: DEFAULT_AGENT_PROFILE_ID,
							profileName: "Runner",
						},
					})
				)
			);
			await vi.advanceTimersByTimeAsync(301);
		});
		await flushPromiseQueue();

		expect(statusRefetchMock).toHaveBeenCalledTimes(2);
		expect(membersRefetchMock).toHaveBeenCalledTimes(2);
		expect(invalidateQueriesMock.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
			membersRefetchMock.mock.invocationCallOrder[0] ?? 0
		);
		expect(warnMock).toHaveBeenCalledWith(
			"[openmeld.web.space.wake_final_outcome_refresh_failed]",
			expect.objectContaining({
				agentProfileId: DEFAULT_AGENT_PROFILE_ID,
				error: "members refresh failed",
				signalId: "sig-final-members-refresh-failed",
				spaceId: "space-123",
				step: "status_members",
			})
		);
		expect(invalidateQueriesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				queryKey: agentExecutionReadinessQueryKeys.batchesForOrganization(
					"test-storage-scope",
					"org-acme"
				),
				refetchType: "active",
			}),
			{ cancelRefetch: false }
		);
		expect(refreshAllMock).not.toHaveBeenCalled();
		for (const invalidation of buildLocalRuntimeCacheInvalidations()) {
			expect(invalidateQueriesMock).not.toHaveBeenCalledWith(
				expect.objectContaining(invalidation)
			);
		}
	});

	it("leaves shared cache retry ownership to TanStack Query", async () => {
		vi.useFakeTimers();
		const warnMock = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		const readinessCachePrefix =
			agentExecutionReadinessQueryKeys.batchesForOrganization(
				"test-storage-scope",
				"org-acme"
			);
		let rejectedReadinessCacheRefresh = false;
		const invalidateQueriesMock = vi
			.fn()
			.mockImplementation((input: { queryKey: unknown }) => {
				if (
					!rejectedReadinessCacheRefresh &&
					JSON.stringify(input.queryKey) ===
						JSON.stringify(readinessCachePrefix)
				) {
					rejectedReadinessCacheRefresh = true;
					return Promise.reject(new Error("query cache unavailable"));
				}
				return Promise.resolve();
			});
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		useQueryClientMock.mockReturnValue({
			getQueryCache: vi.fn(() => ({ find: vi.fn(() => null) })),
			getQueryData: vi.fn(),
			invalidateQueries: invalidateQueriesMock,
			setQueryData: vi.fn(),
		});
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			refreshAll: refreshAllMock,
			storageScope: "test-storage-scope",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createTextSignal({
						id: "sig-final-shared-cache-retry",
						ts: 35,
						text: "The final answer is ready.",
						meta: {
							dispatchId: "dispatch-1",
							purpose: AGENT_REPLY_FINAL_PURPOSE,
							targetProfileId: DEFAULT_AGENT_PROFILE_ID,
						},
						profile: {
							kind: "agent",
							profileId: DEFAULT_AGENT_PROFILE_ID,
							profileName: "Runner",
						},
					})
				)
			);
			await vi.advanceTimersByTimeAsync(301);
		});
		await flushPromiseQueue();

		expect(warnMock).toHaveBeenCalledWith(
			"[openmeld.web.space.wake_final_outcome_refresh_failed]",
			expect.objectContaining({
				attempt: 1,
				error: "query cache unavailable",
				maxAttempts: 1,
				signalId: "sig-final-shared-cache-retry",
				step: "shared_caches",
				willRetry: false,
			})
		);
		expect(
			invalidateQueriesMock.mock.calls.filter(
				([input]) =>
					JSON.stringify(input.queryKey) ===
					JSON.stringify(readinessCachePrefix)
			)
		).toHaveLength(1);
		expect(statusRefetchMock).toHaveBeenCalledTimes(1);
		expect(membersRefetchMock).toHaveBeenCalledTimes(1);
		expect(refreshAllMock).not.toHaveBeenCalled();
		for (const invalidation of buildLocalRuntimeCacheInvalidations()) {
			expect(invalidateQueriesMock).not.toHaveBeenCalledWith(
				expect.objectContaining(invalidation)
			);
		}
	});

	it("only refreshes Space projections for a non-owner final reply", async () => {
		vi.useFakeTimers();
		const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		useQueryClientMock.mockReturnValue({
			invalidateQueries: invalidateQueriesMock,
			setQueryData: vi.fn(),
		});
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			refreshAll: refreshAllMock,
			storageScope: "test-storage-scope",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot({
					defaultAgentOwnerName: "Another Owner",
					defaultAgentOwnerUserId: "user-other",
				}),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createTextSignal({
						id: "sig-non-owner-final-reply",
						ts: 35,
						text: "The final answer is ready.",
						meta: {
							dispatchId: "dispatch-1",
							purpose: AGENT_REPLY_FINAL_PURPOSE,
							targetProfileId: DEFAULT_AGENT_PROFILE_ID,
						},
						profile: {
							kind: "agent",
							profileId: DEFAULT_AGENT_PROFILE_ID,
							profileName: "Runner",
						},
					})
				)
			);
			await vi.advanceTimersByTimeAsync(301);
		});
		await flushPromiseQueue();

		expect(statusRefetchMock).toHaveBeenCalledTimes(1);
		expect(membersRefetchMock).toHaveBeenCalledTimes(1);
		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		expect(refreshAllMock).not.toHaveBeenCalled();
		for (const invalidation of buildSharedReadinessCacheInvalidations()) {
			expect(invalidateQueriesMock).not.toHaveBeenCalledWith(
				expect.objectContaining(invalidation)
			);
		}
		for (const invalidation of buildLocalRuntimeCacheInvalidations()) {
			expect(invalidateQueriesMock).not.toHaveBeenCalledWith(
				expect.objectContaining(invalidation)
			);
		}
	});

	it("waits for confirmed Human membership before refreshing shared readiness caches", async () => {
		vi.useFakeTimers();
		const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		useQueryClientMock.mockReturnValue({
			invalidateQueries: invalidateQueriesMock,
			setQueryData: vi.fn(),
		});
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			refreshAll: refreshAllMock,
			storageScope: "test-storage-scope",
		});
		const membersResult = createQueryResult({
			isPending: true,
			refetch: membersRefetchMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: membersResult,
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		const view = renderSpaceLanding();

		expect(FakeWebSocket.instances).toHaveLength(0);
		Object.assign(membersResult, {
			data: createMembersSnapshot(),
			isPending: false,
			isSuccess: true,
		});
		view.rerender(
			<SpaceLanding
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createTextSignal({
						id: "sig-final-before-members",
						ts: 35,
						text: "Final reply before members are loaded.",
						meta: {
							dispatchId: "dispatch-1",
							purpose: AGENT_REPLY_FINAL_PURPOSE,
							targetProfileId: DEFAULT_AGENT_PROFILE_ID,
						},
						profile: {
							kind: "agent",
							profileId: DEFAULT_AGENT_PROFILE_ID,
							profileName: "Runner",
						},
					})
				)
			);
			await vi.advanceTimersByTimeAsync(301);
		});
		await flushPromiseQueue();

		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		expect(statusRefetchMock).toHaveBeenCalledTimes(1);
		expect(membersRefetchMock).toHaveBeenCalledTimes(1);
		expect(refreshAllMock).not.toHaveBeenCalled();
		expect(invalidateQueriesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				queryKey: agentExecutionReadinessQueryKeys.batchesForOrganization(
					"test-storage-scope",
					"org-acme"
				),
				refetchType: "active",
			}),
			{ cancelRefetch: false }
		);
		for (const invalidation of buildLocalRuntimeCacheInvalidations()) {
			expect(invalidateQueriesMock).not.toHaveBeenCalledWith(
				expect.objectContaining(invalidation)
			);
		}
	});

	it("invalidates an inactive Agents page readiness batch cache after a Space final agent reply without forcing a refetch", async () => {
		vi.useFakeTimers();
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: {
					gcTime: Number.POSITIVE_INFINITY,
					retry: false,
				},
			},
		});
		const agentsPageReadinessFetchMock = vi
			.fn()
			.mockResolvedValue({ items: [] });
		const agentsPageBatchQueryKey = agentExecutionReadinessQueryKeys.batch(
			"test-storage-scope",
			"org-acme",
			[DEFAULT_AGENT_PROFILE_ID],
			undefined
		);
		await queryClient.fetchQuery({
			queryKey: agentsPageBatchQueryKey,
			queryFn: agentsPageReadinessFetchMock,
			staleTime: Number.POSITIVE_INFINITY,
		});
		expect(agentsPageReadinessFetchMock).toHaveBeenCalledTimes(1);
		useQueryClientMock.mockReturnValue(queryClient);
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			refreshAll: vi.fn().mockResolvedValue(undefined),
			storageScope: "test-storage-scope",
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createTextSignal({
						id: "sig-agent-final-cross-page",
						ts: 35,
						text: "Final answer for the cross-page cache.",
						meta: {
							dispatchId: "dispatch-1",
							purpose: AGENT_REPLY_FINAL_PURPOSE,
							targetProfileId: DEFAULT_AGENT_PROFILE_ID,
						},
						profile: {
							kind: "agent",
							profileId: DEFAULT_AGENT_PROFILE_ID,
							profileName: "Runner",
						},
					})
				)
			);
			await vi.advanceTimersByTimeAsync(301);
		});
		await flushPromiseQueue();

		expect(agentsPageReadinessFetchMock).toHaveBeenCalledTimes(1);
		expect(
			queryClient.getQueryState(agentsPageBatchQueryKey)?.isInvalidated
		).toBe(true);
		queryClient.clear();
	});

	it("does not run a final outcome refresh for ordinary agent text", async () => {
		vi.useFakeTimers();
		const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		useQueryClientMock.mockReturnValue({
			invalidateQueries: invalidateQueriesMock,
			setQueryData: vi.fn(),
		});
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			refreshAll: refreshAllMock,
			storageScope: "test-storage-scope",
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createTextSignal({
						id: "sig-agent-ordinary-text",
						ts: 45,
						text: "This is not a final Wake reply.",
						profile: {
							kind: "agent",
							profileId: DEFAULT_AGENT_PROFILE_ID,
							profileName: "Runner",
						},
					})
				)
			);
			await vi.advanceTimersByTimeAsync(301);
		});

		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		expect(refreshAllMock).not.toHaveBeenCalled();
		for (const invalidation of buildSharedReadinessCacheInvalidations()) {
			expect(invalidateQueriesMock).not.toHaveBeenCalledWith(
				expect.objectContaining(invalidation)
			);
		}
	});

	it("does not run a strong final outcome refresh for initial history messages", async () => {
		vi.useFakeTimers();
		const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
		const refreshAllMock = vi.fn().mockResolvedValue(undefined);
		useQueryClientMock.mockReturnValue({
			invalidateQueries: invalidateQueriesMock,
			setQueryData: vi.fn(),
		});
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			refreshAll: refreshAllMock,
			storageScope: "test-storage-scope",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-initial-history-final",
							ts: 35,
							text: "Already loaded final reply.",
							meta: {
								dispatchId: "dispatch-1",
								purpose: AGENT_REPLY_FINAL_PURPOSE,
								targetProfileId: DEFAULT_AGENT_PROFILE_ID,
							},
							profile: {
								kind: "agent",
								profileId: DEFAULT_AGENT_PROFILE_ID,
								profileName: "Runner",
							},
						}),
						createTerminalFailureNoticeSignal({
							actorProfileId: DEFAULT_AGENT_PROFILE_ID,
							id: "sig-initial-history-terminal-failure",
							ts: 36,
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(301);
		});

		expect(notifyAgentExecutionReadinessRefreshMock).not.toHaveBeenCalled();
		expect(refreshAllMock).not.toHaveBeenCalled();
		for (const invalidation of buildSharedReadinessCacheInvalidations()) {
			expect(invalidateQueriesMock).not.toHaveBeenCalledWith(
				expect.objectContaining(invalidation)
			);
		}
	});

	it("debounces status and members refetches for live agent status and notice events", async () => {
		vi.useFakeTimers();
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(FakeWebSocket.instances).toHaveLength(1);

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createStatusSignal({
						id: "sig-status-1",
						ts: 40,
						text: "Runner needs input",
					})
				)
			);
		});

		expect(statusRefetchMock).not.toHaveBeenCalled();
		expect(membersRefetchMock).not.toHaveBeenCalled();

		act(() => {
			vi.advanceTimersByTime(301);
		});
		expect(statusRefetchMock).toHaveBeenCalledTimes(1);
		expect(membersRefetchMock).toHaveBeenCalledTimes(1);

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createSystemNoticeSignal({
						id: "sig-notice-1",
						ts: 50,
						text: "Runner chose to stay silent",
					})
				)
			);
			await vi.advanceTimersByTimeAsync(301);
		});

		expect(statusRefetchMock).toHaveBeenCalledTimes(2);
		expect(membersRefetchMock).toHaveBeenCalledTimes(2);
	});

	it("debounces both members and status refetches for presence events", async () => {
		vi.useFakeTimers();
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(FakeWebSocket.instances).toHaveLength(1);

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createPresenceSignal({
						id: "sig-presence-1",
						ts: 60,
						type: "presence.join",
					})
				)
			);
		});

		expect(statusRefetchMock).not.toHaveBeenCalled();
		expect(membersRefetchMock).not.toHaveBeenCalled();

		act(() => {
			vi.advanceTimersByTime(301);
		});

		expect(statusRefetchMock).toHaveBeenCalledTimes(1);
		expect(membersRefetchMock).toHaveBeenCalledTimes(1);
	});

	it("delays freshness feedback for websocket server errors", async () => {
		vi.useFakeTimers();
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(FakeWebSocket.instances).toHaveLength(1);

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify({
					error: "space.password_required",
					requestId: "req-space-stream-1",
				})
			);
		});

		expect(
			screen.queryByText("Messages and activity may be out of date.")
		).toBeNull();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(15_000);
		});
		expect(
			screen.getByText("Messages and activity may be out of date.")
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
	});

	it("automatically reconnects after websocket close with a fresh tail catch-up", async () => {
		vi.useFakeTimers();
		const getUpdatesMock = vi.fn().mockResolvedValue({
			signals: [],
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: getUpdatesMock,
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-seed",
							ts: 10,
							text: "Seed message",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(FakeWebSocket.instances).toHaveLength(1);

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
		});

		expect(getUpdatesMock).toHaveBeenCalledTimes(2);
		getUpdatesMock.mockClear();

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitClose(1011, "upstream_error");
		});

		// Within the grace window a dropped stream stays quiet — no status flip.
		expect(
			screen.queryByText("Messages and activity may be out of date.")
		).toBeNull();
		expect(screen.queryByTestId("space-live-status")).toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});

		expect(FakeWebSocket.instances).toHaveLength(2);
		// Reconnect fired but the grace window has not elapsed — still quiet.
		expect(
			screen.queryByText("Messages and activity may be out of date.")
		).toBeNull();
		expect(screen.queryByTestId("space-live-status")).toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1500);
		});

		// Internal recovery stays quiet until the presentation grace elapses.
		expect(
			screen.queryByText("Messages and activity may be out of date.")
		).toBeNull();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(15_000);
		});
		expect(
			screen.getByText("Messages and activity may be out of date.")
		).toBeTruthy();

		await act(async () => {
			await FakeWebSocket.instances[1]?.emitOpen();
		});

		expect(getUpdatesMock).toHaveBeenCalledTimes(1);
		expect(
			screen.queryByText("Messages and activity may be out of date.")
		).toBeNull();
	});

	it("reconnects from the last authoritative history/updates cursor despite newer live frames", async () => {
		vi.useFakeTimers();
		const getUpdatesMock = vi.fn().mockResolvedValue({
			signals: [],
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: getUpdatesMock,
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-seed",
							ts: 10,
							text: "Seed message",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(FakeWebSocket.instances).toHaveLength(1);

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
		});

		expect(getUpdatesMock).toHaveBeenLastCalledWith({
			spaceId: "space-123",
			afterSignalId: "sig-seed",
			limit: 50,
			signal: expect.any(AbortSignal),
		});
		getUpdatesMock.mockClear();

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createLiveSignalFrame({
						historyPersisted: true,
						signal: createTextSignal({
							id: "sig-live-persisted",
							ts: 20,
							text: "Persisted live message",
						}),
					})
				)
			);
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createLiveSignalFrame({
						historyPersisted: false,
						signal: createTextSignal({
							id: "sig-live-only",
							ts: 30,
							text: "Live-only preview",
						}),
					})
				)
			);
			await FakeWebSocket.instances[0]?.emitMessage(
				JSON.stringify(
					createLiveSignalFrame({
						historyPersisted: false,
						signal: createPresenceSignal({
							id: "sig-presence-latest",
							ts: 40,
							type: "presence.join",
						}),
					})
				)
			);
			await FakeWebSocket.instances[0]?.emitClose(1011, "upstream_error");
		});
		expect(screen.getByText("Persisted live message")).toBeTruthy();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});

		expect(FakeWebSocket.instances).toHaveLength(2);

		await act(async () => {
			await FakeWebSocket.instances[1]?.emitOpen();
		});

		expect(getUpdatesMock).toHaveBeenCalledTimes(1);
		expect(getUpdatesMock).toHaveBeenLastCalledWith({
			spaceId: "space-123",
			afterSignalId: "sig-seed",
			limit: 50,
			signal: expect.any(AbortSignal),
		});
		expect(getUpdatesMock).not.toHaveBeenCalledWith(
			expect.objectContaining({
				afterSignalId: "sig-live-only",
			})
		);
		expect(getUpdatesMock).not.toHaveBeenCalledWith(
			expect.objectContaining({
				afterSignalId: "sig-presence-latest",
			})
		);
	});

	it("marks live updates stale when live tail catch-up fails without reconnecting", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		// Non-anchor catch-up failures are not proof that the anchor was reaped.
		// They must not be hidden behind a recent-window reload, and they must not
		// spin the transport reconnect loop.
		const getUpdatesMock = vi
			.fn()
			.mockRejectedValue(new Error("tail unavailable"));
		const listSignalEnvelopesMock = vi.fn().mockResolvedValue({
			envelopes: [
				createTextSignal({ id: "sig-seed", ts: 10, text: "Seed message" }),
				createTextSignal({
					id: "sig-recovered-tail",
					ts: 20,
					text: "Recovered tail message",
				}),
			],
			nextCursor: null,
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: getUpdatesMock,
			listSignalEnvelopes: listSignalEnvelopesMock,
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-seed",
							ts: 10,
							text: "Seed message",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(FakeWebSocket.instances).toHaveLength(1);

		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
		});

		// Both the speculative catch-up and the mandatory post-acceptance catch-up
		// failed. Because neither is an explicit anchor_not_found response, the UI
		// reports stale freshness instead of pretending the data layer healed from
		// a recent-window fallback.
		expect(getUpdatesMock).toHaveBeenCalledTimes(2);
		expect(listSignalEnvelopesMock).not.toHaveBeenCalled();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(2500);
		});

		// No reconnect and no recovered tail message: the open socket stays live,
		// while freshness is honestly marked as stale until a retry succeeds.
		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(
			screen.queryByText("Messages and activity may be out of date.")
		).toBeNull();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(15_000);
		});
		expect(
			screen.getByText("Messages and activity may be out of date.")
		).toBeTruthy();
		expect(screen.queryByText("Recovered tail message")).toBeNull();
		getUpdatesMock.mockResolvedValue({ signals: [] });
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Retry" }));
			await Promise.resolve();
		});
		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(
			screen.queryByText("Messages and activity may be out of date.")
		).toBeNull();
	});

	it("retries from the freshness notice without claiming recovery", async () => {
		vi.useFakeTimers();
		const getUpdatesMock = vi.fn().mockResolvedValue({ signals: [] });
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: getUpdatesMock,
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({ isSuccess: true, data: createSpaceStatus() }),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({ id: "sig-seed", ts: 10, text: "Seed message" }),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();
		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
		});
		await act(async () => {
			await FakeWebSocket.instances[0]?.emitClose(1011, "upstream_error");
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1500);
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(15_000);
		});
		expect(
			screen.getByText("Messages and activity may be out of date.")
		).toBeTruthy();

		const socketsBeforeRetry = FakeWebSocket.instances.length;
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Retry" }));
			await Promise.resolve();
		});

		// A fresh socket opens right away — no waiting out the backoff timer.
		expect(FakeWebSocket.instances.length).toBe(socketsBeforeRetry + 1);
		expect(
			screen.getByText("Messages and activity may be out of date.")
		).toBeTruthy();
		await act(async () => {
			await FakeWebSocket.instances.at(-1)?.emitOpen();
		});
		expect(
			screen.queryByText("Messages and activity may be out of date.")
		).toBeNull();
	});

	it("reconnects immediately when the tab returns to the foreground while degraded", async () => {
		vi.useFakeTimers();
		const getUpdatesMock = vi.fn().mockResolvedValue({ signals: [] });
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: getUpdatesMock,
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({ isSuccess: true, data: createSpaceStatus() }),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({ id: "sig-seed", ts: 10, text: "Seed message" }),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();
		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
		});
		await act(async () => {
			await FakeWebSocket.instances[0]?.emitClose(1011, "upstream_error");
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1500);
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(15_000);
		});
		expect(
			screen.getByText("Messages and activity may be out of date.")
		).toBeTruthy();

		const socketsBeforeForeground = FakeWebSocket.instances.length;
		await act(async () => {
			document.dispatchEvent(new Event("visibilitychange"));
			await Promise.resolve();
		});

		// Returning to a visible tab reconnects now instead of waiting out the
		// (background-throttled) backoff timer.
		expect(FakeWebSocket.instances.length).toBe(socketsBeforeForeground + 1);
	});

	it("sends a transport keepalive ping while the live socket is open", async () => {
		vi.useFakeTimers();
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({ signals: [] }),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({ isSuccess: true, data: createSpaceStatus() }),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding();
		await act(async () => {
			await FakeWebSocket.instances[0]?.emitOpen();
		});

		// No keepalive frame before the interval elapses.
		expect(FakeWebSocket.instances[0]?.sentFrames ?? []).not.toContain(
			SPACE_STREAM_KEEPALIVE_PING
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(20_000);
		});

		expect(FakeWebSocket.instances[0]?.sentFrames ?? []).toContain(
			SPACE_STREAM_KEEPALIVE_PING
		);
	});

	it("sends the first normal message from Enter and appends it to the timeline", async () => {
		const queryClient = createTestQueryClient();
		useQueryClientMock.mockReturnValue(queryClient);
		queryClient.setQueryData(
			spaceQueryKeys.history("space-123", DEFAULT_SPACE_PROFILE_ID),
			{
				envelopes: [],
				nextCursor: null,
			}
		);
		const membersRefetchMock = vi.fn().mockResolvedValue(undefined);
		const statusRefetchMock = vi.fn().mockResolvedValue(undefined);
		const postNormalMessageMock = vi.fn().mockResolvedValue(
			createTextSignal({
				id: "sig-1",
				text: "First hello",
			})
		);
		statusRefetchMock.mockResolvedValue({
			data: createSpaceStatus(),
			error: null,
		});
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
				refetch: membersRefetchMock,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await setComposerValue(textarea, "First hello");
		fireEvent.keyDown(textarea, { key: "Enter" });

		await waitFor(() => {
			expect(createWebSpaceApiMock).toHaveBeenCalledWith({
				openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
			});
			expect(postNormalMessageMock).toHaveBeenCalledWith({
				meta: {
					clientMessageId: expect.any(String),
					authorHasRead: true,
				},
				spaceId: "space-123",
				text: "First hello",
				timeoutMs: 30_000,
			});
			expect(membersRefetchMock).toHaveBeenCalledTimes(1);
			expect(statusRefetchMock).toHaveBeenCalledTimes(2);
			expect(screen.getAllByText("First hello").length).toBeGreaterThan(0);
			expect(readComposerValue(textarea)).toBe("");
		});
		expect(
			queryClient
				.getQueryData<{
					envelopes: readonly SignalEnvelope[];
				}>(spaceQueryKeys.history("space-123", DEFAULT_SPACE_PROFILE_ID))
				?.envelopes.map((signal) => signal.id)
		).toEqual(["sig-1"]);
		queryClient.clear();
	});

	it("shows an outgoing normal message before the access refresh or post responds", async () => {
		let releaseStatus: (() => void) | undefined;
		const statusRefetch = vi.fn().mockImplementation(
			() =>
				new Promise((resolve) => {
					releaseStatus = () =>
						resolve({ data: createSpaceStatus(), error: null });
				})
		);
		let resolvePost:
			| ((signal: ReturnType<typeof createTextSignal>) => void)
			| null = null;
		const postNormalMessageMock = vi.fn().mockImplementation(
			() =>
				new Promise<ReturnType<typeof createTextSignal>>((resolve) => {
					resolvePost = resolve;
				})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetch,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await setComposerValue(textarea, "Optimistic hello");
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		await waitFor(() => {
			expect(readComposerValue(textarea)).toBe("");
			expect(
				within(
					screen.getByRole("log", { name: "Conversation history" })
				).getByText("Optimistic hello")
			).toBeTruthy();
		});
		expect(postNormalMessageMock).not.toHaveBeenCalled();
		await waitFor(() => expect(statusRefetch).toHaveBeenCalled());
		await act(async () => releaseStatus?.());

		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalled();
		});
		expect(readComposerValue(textarea)).toBe("");
		const conversationLog = screen.getByRole("log", {
			name: "Conversation history",
		});
		expect(within(conversationLog).getByText("Optimistic hello")).toBeTruthy();

		await act(async () => {
			resolvePost?.(
				createTextSignal({
					id: "sig-optimistic",
					text: "Optimistic hello",
				})
			);
			await Promise.resolve();
		});

		await waitFor(() => {
			expect(
				within(conversationLog).getAllByText("Optimistic hello")
			).toHaveLength(1);
		});
		await setComposerValue(textarea, "Next message while projections refresh");
		expect(screen.getByRole("button", { name: "Send message" })).toHaveProperty(
			"disabled",
			false
		);
	});

	it.each([
		"http-first",
		"live-first",
		"live-accepted-http-error",
	] as const)("keeps the selected image and open viewer through %s acknowledgement", async (acknowledgement) => {
		vi.stubGlobal(
			"IntersectionObserver",
			class implements IntersectionObserver {
				readonly root = null;
				readonly rootMargin = "0px";
				readonly scrollMargin = "0px 0px 0px 0px";
				readonly thresholds = [0];
				private readonly callback: IntersectionObserverCallback;
				constructor(callback: IntersectionObserverCallback) {
					this.callback = callback;
				}
				observe(target: Element) {
					const rect = target.getBoundingClientRect();
					queueMicrotask(() =>
						this.callback(
							[
								{
									target,
									time: 0,
									isIntersecting: true,
									intersectionRatio: 1,
									boundingClientRect: rect,
									intersectionRect: rect,
									rootBounds: null,
								},
							],
							this
						)
					);
				}
				unobserve = vi.fn();
				disconnect = vi.fn();
				takeRecords(): IntersectionObserverEntry[] {
					return [];
				}
			}
		);
		const descriptor = createSpaceFileDescriptor();
		const messageFile = createSpaceMessageFileReference(descriptor);
		const stageComposerUploadMock = vi.fn().mockImplementation((input) =>
			Promise.resolve(
				createSpaceComposerUpload({
					id: input.uploadId,
					mimeType: input.mimeType,
					name: input.name,
					sizeBytes: input.bytes.size,
				})
			)
		);
		const publishComposerUploadMock = vi.fn().mockResolvedValue(descriptor);
		const discardComposerUploadMock = vi.fn().mockResolvedValue(undefined);
		const downloadFileContentMock = vi.fn().mockResolvedValue({
			bytes: new TextEncoder().encode("image").buffer,
			mimeType: "image/png",
			revision: 1,
		});
		let resolvePost:
			| ((signal: ReturnType<typeof createTextSignal>) => void)
			| null = null;
		let rejectPost: ((error: Error) => void) | null = null;
		const postNormalMessageMock = vi.fn().mockImplementation(
			() =>
				new Promise<ReturnType<typeof createTextSignal>>((resolve, reject) => {
					resolvePost = resolve;
					rejectPost = reject;
				})
		);
		let liveSnapshot: ReturnType<typeof createTextSignal> | undefined;
		createWebSpaceApiMock.mockReturnValue({
			discardComposerUpload: discardComposerUploadMock,
			downloadFileContent: downloadFileContentMock,
			postNormalMessage: postNormalMessageMock,
			publishComposerUpload: publishComposerUploadMock,
			stageComposerUpload: stageComposerUploadMock,
			getUpdates: vi.fn(() =>
				Promise.resolve({ signals: liveSnapshot ? [liveSnapshot] : [] })
			),
			listSignalEnvelopes: vi.fn(() =>
				Promise.resolve({
					envelopes: liveSnapshot ? [liveSnapshot] : [],
					nextCursor: null,
				})
			),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		const queryClient = createTestQueryClient();
		useQueryClientMock.mockReturnValue(queryClient);
		renderSpaceLanding({ queryClient });
		fireEvent.change(screen.getByLabelText("Choose files to send"), {
			target: {
				files: [new File(["source"], "picnic.png", { type: "image/png" })],
			},
		});

		await waitFor(() => {
			expect(createWebSpaceApiMock).toHaveBeenCalledWith({
				openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
			});
			expect(stageComposerUploadMock).toHaveBeenCalledWith({
				bytes: expect.any(File),
				mimeType: "image/png",
				name: "picnic.png",
				onProgress: expect.any(Function),
				signal: expect.any(AbortSignal),
				spaceId: "space-123",
				uploadId: expect.any(String),
			});
			expect(screen.getByRole("group", { name: "Files to send" })).toBeTruthy();
		});
		expect(publishComposerUploadMock).not.toHaveBeenCalled();
		createWebSpaceApiMock.mockClear();

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await setComposerValue(textarea, "Photos from the picnic");
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() => {
			expect(createWebSpaceApiMock).toHaveBeenCalledWith({
				openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
			});
			expect(postNormalMessageMock).toHaveBeenCalledWith({
				files: [messageFile],
				meta: {
					clientMessageId: expect.any(String),
					authorHasRead: true,
				},
				spaceId: "space-123",
				text: "Photos from the picnic",
				timeoutMs: 30_000,
			});
		});
		expect(publishComposerUploadMock).toHaveBeenCalledWith({
			clientMutationId: expect.any(String),
			spaceId: "space-123",
			timeoutMs: 30_000,
			uploadId: expect.any(String),
		});
		const optimisticImage = document.querySelector(
			'img[src="blob:source-image-preview"]'
		);
		expect(optimisticImage).not.toBeNull();
		expect(optimisticImage?.getAttribute("src")).toBe(
			"blob:source-image-preview"
		);

		if (!optimisticImage) {
			throw new Error("Expected the optimistic original.");
		}
		const originalFrame = optimisticImage.closest("[data-image-frame]");
		const originalStyle = originalFrame?.getAttribute("style");
		fireEvent.click(screen.getByRole("button", { name: "Open picnic.png" }));
		const originalViewer = screen.getByRole("dialog", { name: "picnic.png" });
		const published = createTextSignal({
			files: [messageFile],
			id: "sig-image-message",
			text: "Photos from the picnic",
			ts: Date.now(),
			meta: postNormalMessageMock.mock.calls[0]?.[0].meta,
		});
		liveSnapshot = published;
		const emitLive = async () => {
			await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
			await act(async () => {
				await FakeWebSocket.instances[0]?.emitOpen();
				await FakeWebSocket.instances[0]?.emitMessage(
					JSON.stringify(published)
				);
			});
		};
		if (acknowledgement !== "http-first") {
			await emitLive();
		}
		await act(async () => {
			if (acknowledgement === "live-accepted-http-error") {
				rejectPost?.(
					new Error("The HTTP response was lost after live acceptance.")
				);
			} else {
				resolvePost?.(published);
			}
			await Promise.resolve();
		});
		if (acknowledgement === "http-first") {
			await emitLive();
		}
		await waitFor(() => {
			expect(screen.getByRole("dialog", { name: "picnic.png" })).toBe(
				originalViewer
			);
			expect(originalFrame?.querySelector("img")).toBe(optimisticImage);
			expect(optimisticImage.isConnected).toBe(true);
			expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
		});
		expect(originalFrame?.getAttribute("style")).toBe(originalStyle);
		expect(optimisticImage.getAttribute("src")).toBe(
			"blob:source-image-preview"
		);
		expect(downloadFileContentMock).not.toHaveBeenCalled();
		expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(
			"blob:source-image-preview"
		);
		expect(discardComposerUploadMock).not.toHaveBeenCalled();
	});

	it("retries an outcome-unknown stage once with the same upload identity", async () => {
		const stageComposerUploadMock = vi
			.fn()
			.mockRejectedValueOnce(
				createStructuredFailure({
					code: "network.request_failed",
					message: "The stage response was lost.",
				})
			)
			.mockImplementationOnce((input) =>
				Promise.resolve(
					createSpaceComposerUpload({
						id: input.uploadId,
						mimeType: input.mimeType,
						name: input.name,
						sizeBytes: input.bytes.size,
					})
				)
			);
		createWebSpaceApiMock.mockReturnValue({
			stageComposerUpload: stageComposerUploadMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding();
		fireEvent.change(screen.getByLabelText("Choose files to send"), {
			target: {
				files: [new File(["retry"], "retriable.txt", { type: "text/plain" })],
			},
		});

		await screen.findByRole("group", { name: "Files to send" });
		expect(stageComposerUploadMock).toHaveBeenCalledTimes(2);
		expect(stageComposerUploadMock.mock.calls[1]?.[0]).toMatchObject({
			bytes: stageComposerUploadMock.mock.calls[0]?.[0].bytes,
			mimeType: stageComposerUploadMock.mock.calls[0]?.[0].mimeType,
			name: stageComposerUploadMock.mock.calls[0]?.[0].name,
			spaceId: stageComposerUploadMock.mock.calls[0]?.[0].spaceId,
			uploadId: stageComposerUploadMock.mock.calls[0]?.[0].uploadId,
		});
		expect(stageComposerUploadMock.mock.calls[1]?.[0].signal).toBe(
			stageComposerUploadMock.mock.calls[0]?.[0].signal
		);
	});

	it("shows a file-only message before file publication completes", async () => {
		let releasePublication: (() => void) | undefined;
		const descriptor = createSpaceFileDescriptor({
			mimeType: "application/pdf",
			name: "brief.pdf",
		});
		const stageComposerUploadMock = vi.fn().mockImplementation((input) =>
			Promise.resolve(
				createSpaceComposerUpload({
					id: input.uploadId,
					mimeType: input.mimeType,
					name: input.name,
					sizeBytes: input.bytes.size,
				})
			)
		);
		const postNormalMessageMock = vi.fn().mockResolvedValue(
			createTextSignal({
				files: [createSpaceMessageFileReference(descriptor)],
				id: "sig-file-only",
				text: "",
			})
		);
		createWebSpaceApiMock.mockReturnValue({
			discardComposerUpload: vi.fn().mockResolvedValue(undefined),
			postNormalMessage: postNormalMessageMock,
			publishComposerUpload: vi.fn().mockImplementation(
				() =>
					new Promise((resolve) => {
						releasePublication = () => resolve(descriptor);
					})
			),
			stageComposerUpload: stageComposerUploadMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding();
		fireEvent.change(screen.getByLabelText("Choose files to send"), {
			target: {
				files: [new File(["source"], "brief.pdf", { type: "application/pdf" })],
			},
		});

		await screen.findByRole("group", { name: "Files to send" });
		expect(screen.getByRole("button", { name: "Send message" })).toHaveProperty(
			"disabled",
			false
		);
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		const log = screen.getByRole("log", { name: "Conversation history" });
		await waitFor(() =>
			expect(within(log).getByText("brief.pdf")).toBeTruthy()
		);
		expect(within(log).queryByText("Open in Files")).toBeNull();
		expect(
			within(log).queryByRole("button", { name: "Copy message" })
		).toBeNull();
		expect(postNormalMessageMock).not.toHaveBeenCalled();
		await waitFor(() => expect(releasePublication).toBeDefined());
		await act(async () => releasePublication?.());

		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalledWith({
				files: [createSpaceMessageFileReference(descriptor)],
				meta: { clientMessageId: expect.any(String), authorHasRead: true },
				spaceId: "space-123",
				text: "",
				timeoutMs: 30_000,
			});
		});
	});

	it("sends intact content after the user removes a failed upload", async () => {
		const descriptor = createSpaceFileDescriptor({
			mimeType: "text/plain",
			name: "ready.txt",
		});
		const messageFile = createSpaceMessageFileReference(descriptor);
		const postNormalMessageMock = vi.fn().mockResolvedValue(
			createTextSignal({
				files: [messageFile],
				id: "signal-with-successful-file",
				text: "Text can still be sent",
			})
		);
		const stageComposerUploadMock = vi.fn().mockImplementation((input) => {
			if (input.name === "ready.txt") {
				return Promise.resolve(
					createSpaceComposerUpload({
						id: input.uploadId,
						mimeType: input.mimeType,
						name: input.name,
						sizeBytes: input.bytes.size,
					})
				);
			}
			return Promise.reject(
				new OpenMeldApiClientHttpError({
					code: "upstream_error",
					message: "The Space does not belong to this Organization.",
					rawBody: "",
					requestId: "request-upload-403",
					status: 403,
					upstreamCode: "space.organization_mismatch",
				})
			);
		});
		createWebSpaceApiMock.mockReturnValue({
			discardComposerUpload: vi.fn().mockResolvedValue(undefined),
			postNormalMessage: postNormalMessageMock,
			publishComposerUpload: vi.fn().mockResolvedValue(descriptor),
			stageComposerUpload: stageComposerUploadMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding();
		fireEvent.change(screen.getByLabelText("Choose files to send"), {
			target: {
				files: [
					new File(["ready"], "ready.txt", { type: "text/plain" }),
					new File(["broken"], "broken.png", { type: "image/png" }),
				],
			},
		});

		await screen.findByText("The Space does not belong to this Organization.");
		await screen.findByRole("group", { name: "Files to send" });
		fireEvent.click(
			screen.getByRole("button", { name: "Attachment error: broken.png" })
		);
		expect(screen.getByText("Request ID: request-upload-403")).toBeTruthy();
		fireEvent.keyDown(document.activeElement ?? document.body, {
			key: "Escape",
		});
		await setComposerValue(
			screen.getByRole("textbox", { name: "Message this space" }),
			"Text can still be sent"
		);
		expect(screen.getByRole("button", { name: "Send message" })).toHaveProperty(
			"disabled",
			true
		);
		expect(
			screen.getByText("Retry or remove the failed attachment to continue.")
		).toBeTruthy();
		expect(postNormalMessageMock).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Remove broken.png" }));
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalledWith({
				files: [messageFile],
				meta: { clientMessageId: expect.any(String), authorHasRead: true },
				spaceId: "space-123",
				text: "Text can still be sent",
				timeoutMs: 30_000,
			});
		});
	});

	it("retains the entire message for retry when one attachment cannot be published", async () => {
		const descriptor = createSpaceFileDescriptor({
			mimeType: "text/plain",
			name: "ready.txt",
		});
		let failedUploadId: string | null = null;
		const stageComposerUploadMock = vi.fn().mockImplementation((input) => {
			if (input.name === "broken.png") {
				failedUploadId = input.uploadId;
			}
			return Promise.resolve(
				createSpaceComposerUpload({
					id: input.uploadId,
					mimeType: input.mimeType,
					name: input.name,
					sizeBytes: input.bytes.size,
				})
			);
		});
		const publishComposerUploadMock = vi.fn().mockImplementation((input) => {
			if (input.uploadId === failedUploadId) {
				return Promise.reject(
					new OpenMeldApiClientHttpError({
						code: "upstream_error",
						message: "This file could not be published.",
						rawBody: "",
						requestId: "request-publish-500",
						status: 500,
						upstreamCode: "space_file.publish_failed",
					})
				);
			}
			return Promise.resolve(descriptor);
		});
		const postNormalMessageMock = vi.fn();
		createWebSpaceApiMock.mockReturnValue({
			discardComposerUpload: vi.fn().mockResolvedValue(undefined),
			postNormalMessage: postNormalMessageMock,
			publishComposerUpload: publishComposerUploadMock,
			stageComposerUpload: stageComposerUploadMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding();
		fireEvent.change(screen.getByLabelText("Choose files to send"), {
			target: {
				files: [
					new File(["ready"], "ready.txt", { type: "text/plain" }),
					new File(["broken"], "broken.png", { type: "image/png" }),
				],
			},
		});
		await waitFor(() => {
			expect(
				within(
					screen.getByRole("group", { name: "Files to send" })
				).getAllByRole("button", { name: REMOVE_ATTACHMENT_NAME })
			).toHaveLength(2);
		});
		await setComposerValue(
			screen.getByRole("textbox", { name: "Message this space" }),
			"Text can still be sent"
		);

		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await screen.findByRole("button", { name: "Retry" });
		expect(postNormalMessageMock).not.toHaveBeenCalled();
		expect(screen.getByText("Text can still be sent")).toBeTruthy();
		expect(
			readComposerValue(
				screen.getByRole("textbox", { name: "Message this space" })
			)
		).toBe("");
	});

	it("retries an outcome-unknown publication once with the same mutation", async () => {
		const descriptor = createSpaceFileDescriptor({
			mimeType: "text/plain",
			name: "retriable.txt",
		});
		const messageFile = createSpaceMessageFileReference(descriptor);
		const publishComposerUploadMock = vi
			.fn()
			.mockRejectedValueOnce(
				createStructuredFailure({
					code: "network.request_failed",
					message: "The publication response was lost.",
				})
			)
			.mockResolvedValueOnce(descriptor);
		const postNormalMessageMock = vi.fn().mockResolvedValue(
			createTextSignal({
				files: [messageFile],
				id: "signal-after-publication-retry",
				text: "Send this with the file",
			})
		);
		createWebSpaceApiMock.mockReturnValue({
			discardComposerUpload: vi.fn().mockResolvedValue(undefined),
			postNormalMessage: postNormalMessageMock,
			publishComposerUpload: publishComposerUploadMock,
			stageComposerUpload: vi.fn().mockImplementation((input) =>
				Promise.resolve(
					createSpaceComposerUpload({
						id: input.uploadId,
						mimeType: input.mimeType,
						name: input.name,
						sizeBytes: input.bytes.size,
					})
				)
			),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding();
		fireEvent.change(screen.getByLabelText("Choose files to send"), {
			target: {
				files: [new File(["retry"], "retriable.txt", { type: "text/plain" })],
			},
		});
		await screen.findByRole("group", { name: "Files to send" });
		await setComposerValue(
			screen.getByRole("textbox", { name: "Message this space" }),
			"Send this with the file"
		);
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() =>
			expect(publishComposerUploadMock).toHaveBeenCalledTimes(2)
		);
		expect(publishComposerUploadMock.mock.calls[1]?.[0]).toEqual(
			publishComposerUploadMock.mock.calls[0]?.[0]
		);
		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalledWith({
				files: [messageFile],
				meta: { clientMessageId: expect.any(String), authorHasRead: true },
				spaceId: "space-123",
				text: "Send this with the file",
				timeoutMs: 30_000,
			});
		});
	});

	it("validates mentions before publishing selected files", async () => {
		const membersResult = createQueryResult({
			isSuccess: true,
			data: createMembersSnapshot(),
		});
		const publishComposerUploadMock = vi.fn();
		createWebSpaceApiMock.mockReturnValue({
			discardComposerUpload: vi.fn().mockResolvedValue(undefined),
			publishComposerUpload: publishComposerUploadMock,
			stageComposerUpload: vi.fn().mockImplementation((input) =>
				Promise.resolve(
					createSpaceComposerUpload({
						id: input.uploadId,
						mimeType: input.mimeType,
						name: input.name,
						sizeBytes: input.bytes.size,
					})
				)
			),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: membersResult,
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		const view = renderSpaceLanding();
		fireEvent.change(screen.getByLabelText("Choose files to send"), {
			target: {
				files: [new File(["notes"], "notes.txt", { type: "text/plain" })],
			},
		});
		await screen.findByRole("group", { name: "Files to send" });

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await insertComposerMember(RUNNER_OPTION_NAME, "Run");
		await waitFor(() => {
			expect(readComposerValue(textarea)).toBe("@Runner ");
		});
		await appendComposerText(
			textarea,
			"review these notes",
			"@Runner review these notes"
		);

		Object.assign(membersResult, {
			data: undefined,
			error: new Error("members unavailable"),
			isError: true,
			isSuccess: false,
		});
		view.rerender(
			<SpaceLanding
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		expect(screen.getByRole("button", { name: "Send message" })).toHaveProperty(
			"disabled",
			true
		);
		expect(publishComposerUploadMock).not.toHaveBeenCalled();
		expect(screen.getByRole("group", { name: "Files to send" })).toBeTruthy();
		expect(readComposerValue(textarea)).toBe("@Runner review these notes");
	});

	it("checks current Wakeability before publishing selected files", async () => {
		let finishAdmission: (snapshot: SpaceMembersSnapshot) => void = () => {
			throw new Error("Admission read has not started.");
		};
		const postNormalMessageMock = vi.fn();
		const publishComposerUploadMock = vi.fn();
		const currentMembersSnapshot = createMembersSnapshot({
			defaultAgentExecutionReadiness:
				createServiceNotConnectedAgentExecutionReadiness(
					DEFAULT_AGENT_PROFILE_ID
				),
		}) as SpaceMembersSnapshot;
		const currentBlockedReason =
			currentMembersSnapshot.agents[0]?.agentWakeAvailability?.summary;
		if (!currentBlockedReason) {
			throw new Error(
				"Expected current Core Wakeability reason in the fixture."
			);
		}
		readSpaceMembersMock.mockImplementation(
			() =>
				new Promise<SpaceMembersSnapshot>((resolve) => {
					finishAdmission = resolve;
				})
		);
		createWebSpaceApiMock.mockReturnValue({
			discardComposerUpload: vi.fn().mockResolvedValue(undefined),
			postNormalMessage: postNormalMessageMock,
			publishComposerUpload: publishComposerUploadMock,
			stageComposerUpload: vi.fn().mockImplementation((input) =>
				Promise.resolve(
					createSpaceComposerUpload({
						id: input.uploadId,
						mimeType: input.mimeType,
						name: input.name,
						sizeBytes: input.bytes.size,
					})
				)
			),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding();
		fireEvent.change(screen.getByLabelText("Choose files to send"), {
			target: {
				files: [new File(["notes"], "notes.txt", { type: "text/plain" })],
			},
		});
		await screen.findByRole("group", { name: "Files to send" });

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await insertComposerMember(RUNNER_OPTION_NAME);
		await appendComposerText(
			textarea,
			"review these notes",
			"@Runner review these notes"
		);
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() => {
			expect(readSpaceMembersMock).toHaveBeenCalledOnce();
		});
		expect(
			document.querySelector('[data-signal-id^="pending:"]')?.textContent
		).toContain("review these notes");
		expect(readComposerValue(textarea)).toBe("");
		expect(publishComposerUploadMock).not.toHaveBeenCalled();
		expect(postNormalMessageMock).not.toHaveBeenCalled();
		await act(async () => {
			finishAdmission(currentMembersSnapshot);
			await Promise.resolve();
		});
		await waitFor(() => {
			expect(screen.getByText(currentBlockedReason)).toBeTruthy();
		});
		expect(publishComposerUploadMock).not.toHaveBeenCalled();
		expect(postNormalMessageMock).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(readComposerValue(textarea)).toBe("");
	});

	it("keeps a file-only Composer open when its staged file cannot be published", async () => {
		const postNormalMessageMock = vi.fn();
		createWebSpaceApiMock.mockReturnValue({
			discardComposerUpload: vi.fn().mockResolvedValue(undefined),
			postNormalMessage: postNormalMessageMock,
			publishComposerUpload: vi
				.fn()
				.mockRejectedValue(new Error("This file could not be published.")),
			stageComposerUpload: vi.fn().mockImplementation((input) =>
				Promise.resolve(
					createSpaceComposerUpload({
						id: input.uploadId,
						mimeType: input.mimeType,
						name: input.name,
						sizeBytes: input.bytes.size,
					})
				)
			),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding();
		fireEvent.change(screen.getByLabelText("Choose files to send"), {
			target: {
				files: [new File(["broken"], "broken.png", { type: "image/png" })],
			},
		});
		await screen.findByRole("group", { name: "Files to send" });

		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await screen.findByText(
			"A file couldn't be attached. Your message wasn't sent."
		);
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(postNormalMessageMock).not.toHaveBeenCalled();
		expect(
			screen.getByRole("textbox", { name: "Message this space" })
		).toBeTruthy();
	});

	it("accepts pasted and dropped files and stops at ten files", async () => {
		const stageComposerUploadMock = vi.fn().mockImplementation((input) =>
			createSpaceComposerUpload({
				id: input.uploadId,
				mimeType: input.mimeType,
				name: input.name,
				sizeBytes: input.bytes.size,
			})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: vi.fn(),
			stageComposerUpload: stageComposerUploadMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding();
		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		const pastedFile = new File(["pasted"], "pasted.png", {
			type: "image/png",
		});
		fireEvent.paste(textarea, {
			clipboardData: {
				items: [
					{
						getAsFile: () => pastedFile,
						kind: "file",
						type: "image/png",
					},
				],
			},
		});
		const droppedFiles = Array.from(
			{ length: 10 },
			(_, index) => `file-${String(index + 1)}`
		).map(
			(name) =>
				new File([name], `${name}.txt`, {
					type: "text/plain",
				})
		);
		fireEvent.drop(textarea, {
			dataTransfer: {
				files: droppedFiles,
				types: ["Files"],
			},
		});

		await waitFor(() => {
			expect(
				within(
					screen.getByRole("group", { name: "Files to send" })
				).getAllByRole("button", { name: REMOVE_ATTACHMENT_NAME })
			).toHaveLength(10);
		});
		expect(screen.getByRole("button", { name: "Add" })).toHaveProperty(
			"disabled",
			false
		);
		expect(screen.getByText("You can add up to 10 files.")).toBeTruthy();
	});

	it.each([
		"Review this file",
		"",
	])("sends queued files once without consuming a newer draft (text: %s)", async (text) => {
		const descriptor = createSpaceFileDescriptor();
		const messageFile = createSpaceMessageFileReference(descriptor);
		const postNormalMessage = vi.fn().mockResolvedValue(
			createTextSignal({
				id: "first-file-message",
				text,
				files: [messageFile],
			})
		);
		let releaseUpload: () => void = () => undefined;
		const uploadGate = new Promise<void>((resolve) => {
			releaseUpload = resolve;
		});
		const stageComposerUpload = vi.fn().mockImplementation(async (input) => {
			if (input.name === "launch.txt") {
				await uploadGate;
			}
			return createSpaceComposerUpload({
				id: input.uploadId,
				mimeType: input.mimeType,
				name: input.name,
				sizeBytes: input.bytes.size,
			});
		});
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage,
			stageComposerUpload,
			publishComposerUpload: vi.fn().mockResolvedValue(descriptor),
			discardComposerUpload: vi.fn().mockResolvedValue(undefined),
		});
		mockSpaceQueries({
			status: createQueryResult({ isSuccess: true, data: createSpaceStatus() }),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});
		renderSpaceLanding({
			initialPendingMessage: {
				clientMessageId: "first-files",
				createdAtMs: 1_751_000_000_000,
				text,
				files: [new File(["launch"], "launch.txt", { type: "text/plain" })],
			},
		});
		await waitFor(() => expect(stageComposerUpload).toHaveBeenCalledTimes(1));
		const composer = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await setComposerValue(composer, "My next draft");
		fireEvent.change(screen.getByLabelText("Choose files to send"), {
			target: {
				files: [new File(["next"], "next.txt", { type: "text/plain" })],
			},
		});
		await waitFor(() => expect(stageComposerUpload).toHaveBeenCalledTimes(2));
		act(() => {
			releaseUpload();
		});
		await waitFor(() =>
			expect(postNormalMessage).toHaveBeenCalledWith(
				expect.objectContaining({ files: [messageFile], text })
			)
		);
		expect(readComposerValue(composer)).toBe("My next draft");
		expect(
			screen.getByRole("button", { name: "Remove next.txt" })
		).toBeTruthy();
		expect(postNormalMessage).toHaveBeenCalledTimes(1);
	});

	it("automatically sends a Center Agent message queued before Space bootstrap", async () => {
		const postNormalMessageMock = vi.fn().mockResolvedValue(
			createTextSignal({
				id: "sig-center-agent-first-message",
				text: "Start the launch plan",
			})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});
		const onConsumed = vi.fn();

		renderSpaceLanding({
			initialPendingMessage: {
				clientMessageId: "client-center-agent-first-message",
				createdAtMs: 1_751_000_000_000,
				text: "Start the launch plan",
			},
			onInitialPendingMessageConsumed: onConsumed,
		});

		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalledWith({
				meta: {
					clientMessageId: "client-center-agent-first-message",
					authorHasRead: true,
				},
				spaceId: "space-123",
				text: "Start the launch plan",
				timeoutMs: 30_000,
			});
		});
		expect(onConsumed).toHaveBeenCalledTimes(1);
	});

	it("sends a drafted Center Agent starter after explicit Send as an optimistic message", async () => {
		let resolvePost:
			| ((signal: ReturnType<typeof createTextSignal>) => void)
			| null = null;
		const starterPrompt =
			"I'm new to OpenMeld. Give me a short, plain-English tour, then recommend the best first step for me.";
		const postNormalMessageMock = vi.fn().mockImplementation(
			() =>
				new Promise<ReturnType<typeof createTextSignal>>((resolve) => {
					resolvePost = resolve;
				})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding({ isCenterAgentDirectMessage: true });
		fireEvent.click(
			await screen.findByRole("button", {
				name: SHOW_ME_AROUND_BUTTON_NAME_PATTERN,
			})
		);
		expect(postNormalMessageMock).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(
				readComposerValue(
					screen.getByRole("textbox", { name: "Message Center Agent" })
				)
			).toBe(starterPrompt);
		});
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalledWith({
				meta: { clientMessageId: expect.any(String), authorHasRead: true },
				spaceId: "space-123",
				text: starterPrompt,
				timeoutMs: 30_000,
			});
		});
		expect(screen.getByText(starterPrompt)).toBeTruthy();
		expect(
			screen.queryByRole("group", { name: "Suggested starting points" })
		).toBeTruthy();

		await act(async () => {
			resolvePost?.(
				createTextSignal({
					id: "sig-center-agent-starter",
					text: starterPrompt,
				})
			);
			await Promise.resolve();
		});
	});

	it("retains a failed Center Agent starter message for retry", async () => {
		const starterPrompt =
			"I want to create a Space. Ask me what I'm trying to accomplish, then help me set up the right Space, people, and agents.";
		const postNormalMessageMock = vi
			.fn()
			.mockRejectedValue(new Error("The starter message could not be sent."));
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding({ isCenterAgentDirectMessage: true });
		fireEvent.click(
			await screen.findByRole("button", {
				name: CREATE_SPACE_BUTTON_NAME_PATTERN,
			})
		);
		expect(postNormalMessageMock).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(
				readComposerValue(
					screen.getByRole("textbox", { name: "Message Center Agent" })
				)
			).toBe(starterPrompt);
		});
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		expect(
			await screen.findByText("The starter message could not be sent.")
		).toBeTruthy();
		expect(
			readComposerValue(
				screen.getByRole("textbox", {
					name: "Message Center Agent",
				})
			)
		).toBe("");
		expect(screen.getByText(starterPrompt)).toBeTruthy();
		expect(
			screen.queryByRole("group", { name: "Suggested starting points" })
		).toBeTruthy();
	});

	it("automatically sends a Center Agent message queued while Space bootstrap is still settling", async () => {
		const postNormalMessageMock = vi.fn().mockResolvedValue(
			createTextSignal({
				id: "sig-center-agent-late-first-message",
				text: "Continue from the loading shell",
			})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});
		const onConsumed = vi.fn();
		const rendered = renderSpaceLanding();

		rendered.rerender(
			<SpaceLanding
				initialPendingMessage={{
					clientMessageId: "client-center-agent-late-first-message",
					createdAtMs: 1_751_000_000_000,
					text: "Continue from the loading shell",
				}}
				onInitialPendingMessageConsumed={onConsumed}
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);

		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalledWith({
				meta: {
					clientMessageId: "client-center-agent-late-first-message",
					authorHasRead: true,
				},
				spaceId: "space-123",
				text: "Continue from the loading shell",
				timeoutMs: 30_000,
			});
		});
		expect(onConsumed).toHaveBeenCalledTimes(1);
	});

	it("reuses an explicitly provided avatar without repeating the canonical account avatar request", () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding({
			currentUserAvatarImageUrl: "https://example.com/me.png",
		});

		expect(useAccountAvatarMock).toHaveBeenCalledWith({ enabled: false });
	});

	it("retains a queued Center Agent message for retry when its send fails", async () => {
		const postNormalMessageMock = vi
			.fn()
			.mockRejectedValue(new Error("The message could not be sent."));
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		const queryClient = createTestQueryClient();
		const onConsumed = vi.fn();
		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<PendingCenterAgentSpaceLanding
					message={{
						clientMessageId: "client-center-agent-failed-message",
						createdAtMs: 1_751_000_000_000,
						text: "Keep this draft",
					}}
					onConsumed={onConsumed}
				/>
			</TestQueryClientProvider>
		);

		expect(
			await screen.findByText("The message could not be sent.")
		).toBeTruthy();
		expect(readComposerValue(screen.getByRole("textbox"))).toBe("");
		expect(screen.getByText("Keep this draft")).toBeTruthy();
		expect(onConsumed).toHaveBeenCalledTimes(1);
	});

	it.each([
		OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
		"ordinary_private_space",
	])("shows local Wake progress immediately for automatic Wake in %s", async (spacePurpose) => {
		let resolvePost:
			| ((signal: ReturnType<typeof createTextSignal>) => void)
			| null = null;
		const postNormalMessageMock = vi.fn().mockImplementation(
			() =>
				new Promise<ReturnType<typeof createTextSignal>>((resolve) => {
					resolvePost = resolve;
				})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: {
					...createSpaceStatus(),
					spacePurpose,
				},
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const textarea = screen.getByRole("textbox", {
			name: "Message Runner",
		});
		await setComposerValue(textarea, "DM hello");
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalledWith({
				meta: {
					clientMessageId: expect.any(String),
					authorHasRead: true,
				},
				spaceId: "space-123",
				text: "DM hello",
				timeoutMs: 30_000,
			});
		});
		const sourceMessage = screen
			.getByText("DM hello")
			.closest("[data-message-row-id]");
		expect(sourceMessage).not.toBeNull();
		expect(sourceMessage?.textContent).not.toContain("Wake");
		// Active Wake progress stays at the conversation tail while its source remains visible.
		const sourceMessageGroup = sourceMessage?.closest("[data-message-row-id]");
		expect(sourceMessageGroup).not.toBeNull();
		const wakeThinkingIndicator = screen.getByTestId(
			"space-wake-thinking-indicator"
		);
		expect(wakeThinkingIndicator.textContent).toContain("runner · Working…");

		await act(async () => {
			resolvePost?.(
				createTextSignal({
					id: "sig-dm-automatic-wake",
					text: "DM hello",
				})
			);
			await Promise.resolve();
		});
	});

	it("retains an Agent Direct Message for retry when current admission rejects Wake", async () => {
		const postNormalMessageMock = vi.fn();
		const currentMembersSnapshot = createMembersSnapshot({
			defaultAgentExecutionReadiness:
				createServiceNotConnectedAgentExecutionReadiness(
					DEFAULT_AGENT_PROFILE_ID
				),
		}) as SpaceMembersSnapshot;
		const currentBlockedReason =
			currentMembersSnapshot.agents[0]?.agentWakeAvailability?.summary;
		if (!currentBlockedReason) {
			throw new Error(
				"Expected current Core Wakeability reason in the fixture."
			);
		}
		readSpaceMembersMock.mockResolvedValue(currentMembersSnapshot);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: {
					...createSpaceStatus(),
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				},
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding();

		const composer = screen.getByRole("textbox", { name: "Message Runner" });
		await setComposerValue(composer, "Keep this Direct Message draft");
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() => {
			expect(screen.getByText(currentBlockedReason)).toBeTruthy();
		});
		expect(postNormalMessageMock).not.toHaveBeenCalled();
		expect(readComposerValue(composer)).toBe("");
		expect(screen.getByText("Keep this Direct Message draft")).toBeTruthy();
		expect(composer.getAttribute("contenteditable")).toBe("true");
	});

	it("retries an explicit offline wait with the original deadline and identity while preserving the next draft", async () => {
		const members = createMembersSnapshot({
			defaultAgentExecutionReadiness:
				createServiceNotConnectedAgentExecutionReadiness(
					DEFAULT_AGENT_PROFILE_ID
				),
		}) as SpaceMembersSnapshot;
		const agent = members.agents[0];
		if (!agent) {
			throw new Error("Expected Agent fixture");
		}
		agent.deviceWaitTarget = {
			bindingId: "binding-wait-test",
			openMeldServiceRuntimeId: "runtime-wait-test",
		};
		readSpaceMembersMock.mockResolvedValue(members);
		const post = vi.fn().mockRejectedValue(new Error("Network unavailable"));
		createWebSpaceApiMock.mockReturnValue({ postNormalMessage: post });
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: {
					...createSpaceStatus(),
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				},
			}),
			members: createQueryResult({ isSuccess: true, data: members }),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});
		renderSpaceLanding();
		const composer = screen.getByRole("textbox", { name: "Message Runner" });
		await setComposerValue(composer, "Run when my computer reconnects");
		fireEvent.click(screen.getByRole("button", { name: "Send and wait" }));
		await screen.findByRole("button", { name: "Retry" });
		expect(post).toHaveBeenCalledTimes(1);
		const first = post.mock.calls[0]?.[0];
		expect(first.deviceWait).toMatchObject({
			...agent.deviceWaitTarget,
			targetProfileId: DEFAULT_AGENT_PROFILE_ID,
			deadlineAtMs: expect.any(Number),
		});
		expect(readComposerValue(composer)).toBe("");
		expect(composer.getAttribute("contenteditable")).toBe("true");
		await setComposerValue(composer, "My next draft");
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
		const second = post.mock.calls[1]?.[0];
		expect(second.deviceWait).toEqual(first.deviceWait);
		expect(second.meta.clientMessageId).toBe(first.meta.clientMessageId);
		expect(readComposerValue(composer)).toBe("My next draft");
	});

	it("retains a failed outgoing message with retry without restoring the composer", async () => {
		let rejectPost: ((error: Error) => void) | null = null;
		const postNormalMessageMock = vi.fn().mockImplementation(
			() =>
				new Promise<ReturnType<typeof createTextSignal>>((_resolve, reject) => {
					rejectPost = reject;
				})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await setComposerValue(textarea, "Message that fails");
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalled();
		});
		expect(readComposerValue(textarea)).toBe("");
		const conversationLog = screen.getByRole("log", {
			name: "Conversation history",
		});
		expect(
			within(conversationLog).getByText("Message that fails")
		).toBeTruthy();

		await act(async () => {
			rejectPost?.(new Error("send failed"));
			await Promise.resolve();
		});

		await waitFor(() => {
			expect(
				within(conversationLog).getByText("Message that fails")
			).toBeTruthy();
		});
		expect(readComposerValue(textarea)).toBe("");
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(screen.getByText("send failed")).toBeTruthy();
	});

	it("keeps the composer editable and preserves the next draft while a message sends", async () => {
		let resolvePost:
			| ((signal: ReturnType<typeof createTextSignal>) => void)
			| null = null;
		const postNormalMessageMock = vi.fn().mockImplementation(
			() =>
				new Promise<ReturnType<typeof createTextSignal>>((resolve) => {
					resolvePost = resolve;
				})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding();

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await setComposerValue(textarea, "First message");
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalledTimes(1);
		});
		expect(textarea.getAttribute("contenteditable")).toBe("true");
		await setComposerValue(textarea, "My next message");
		expect(readComposerValue(textarea)).toBe("My next message");
		expect(
			(
				screen.getByRole("button", {
					name: "Send message",
				}) as HTMLButtonElement
			).disabled
		).toBe(false);
		fireEvent.keyDown(textarea, { key: "Enter" });
		await waitFor(() =>
			expect(
				screen.getByText("My next message", { selector: "p" })
			).toBeTruthy()
		);
		await waitFor(() => expect(readComposerValue(textarea)).toBe(""));
		await setComposerValue(textarea, "Third draft");
		expect(postNormalMessageMock).toHaveBeenCalledTimes(1);

		await act(async () => {
			resolvePost?.(
				createTextSignal({
					id: "sig-first-message",
					text: "First message",
				})
			);
			await Promise.resolve();
		});

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy();
		});
		expect(readComposerValue(textarea)).toBe("Third draft");
		expect(postNormalMessageMock).toHaveBeenCalledTimes(2);
		await act(async () => {
			resolvePost?.(
				createTextSignal({ id: "sig-second-message", text: "My next message" })
			);
			await Promise.resolve();
		});
		expect(textarea.getAttribute("contenteditable")).toBe("true");
	});

	it.each([
		"automatic",
		"manual",
	] as const)("recovers a stalled file publication through %s retry without blocking later text", async (recovery) => {
		const hanging = createHangingFetchRequest();
		const descriptor = createSpaceFileDescriptor({
			mimeType: "text/plain",
			name: "progress.txt",
		});
		const publicationApi = createSpaceApi(
			createOpenMeldApiClient({
				baseUrl: "https://gateway.openmeld.invalid",
				transport: createFetchTransport({
					fetch: hanging.fetchMock as typeof fetch,
				}),
			})
		);
		const publish = vi.fn(publicationApi.publishComposerUpload);
		const post = vi.fn().mockImplementation(async (input) =>
			createTextSignal({
				id: input.meta.clientMessageId,
				text: input.text,
				files: input.files,
			})
		);
		const stage = vi.fn().mockImplementation(async (input) =>
			createSpaceComposerUpload({
				id: input.uploadId,
				mimeType: input.mimeType,
				name: input.name,
				sizeBytes: input.bytes.size,
			})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: post,
			publishComposerUpload: publish,
			stageComposerUpload: stage,
		});
		mockSpaceQueries({
			status: createQueryResult({ isSuccess: true, data: createSpaceStatus() }),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});
		renderSpaceLanding();
		fireEvent.change(screen.getByLabelText("Choose files to send"), {
			target: {
				files: [new File(["progress"], "progress.txt", { type: "text/plain" })],
			},
		});
		const send = screen.getByRole("button", { name: "Send message" });
		await waitFor(() => expect(send).toHaveProperty("disabled", false));
		const editor = screen.getByRole("textbox", { name: "Message this space" });
		await setComposerValue(editor, "Progress with attachment");
		fireEvent.click(send);
		await waitFor(() => expect(hanging.fetchMock).toHaveBeenCalledTimes(1));
		// This assertion fails before the fix: the stalled fetch has no deadline.
		expect(hanging.timeoutSpy).toHaveBeenCalledWith(30_000);
		await setComposerValue(editor, "Following text");
		fireEvent.keyDown(editor, { key: "Enter" });
		await waitFor(() => expect(readComposerValue(editor)).toBe(""));
		await setComposerValue(editor, "Next draft");
		expect(post).not.toHaveBeenCalled();
		const recover = () =>
			hanging.fetchMock.mockImplementation(async () =>
				Response.json({ file: descriptor })
			);
		if (recovery === "automatic") {
			recover();
		}
		await act(async () => hanging.abortForTimeout());
		await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
		if (recovery === "manual") {
			await act(async () => hanging.abortForTimeout());
			await screen.findByText(
				"A file couldn't be attached. Your message wasn't sent."
			);
			await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
			expect(post.mock.calls[0]?.[0].text).toBe("Following text");
			expect(
				screen.getByText("Progress with attachment", { selector: "p" })
			).toBeTruthy();
			recover();
			fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		}
		await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
		const original = post.mock.calls.find(
			([input]) => input.text === "Progress with attachment"
		)?.[0];
		expect(original?.files).toEqual([
			createSpaceMessageFileReference(descriptor),
		]);
		expect(post.mock.calls.map(([input]) => input.text)).toEqual(
			recovery === "automatic"
				? ["Progress with attachment", "Following text"]
				: ["Following text", "Progress with attachment"]
		);
		expect(
			publish.mock.calls.every(
				([input]) =>
					input.clientMutationId ===
						publish.mock.calls[0]?.[0].clientMutationId &&
					input.uploadId === stage.mock.calls[0]?.[0].uploadId
			)
		).toBe(true);
		expect(stage).toHaveBeenCalledTimes(1);
		expect(readComposerValue(editor)).toBe("Next draft");
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
	});

	it("preserves both the failed submission and a next draft written during sending", async () => {
		let rejectPost: ((error: Error) => void) | null = null;
		const postNormalMessageMock = vi.fn().mockImplementation(
			() =>
				new Promise<ReturnType<typeof createTextSignal>>((_resolve, reject) => {
					rejectPost = reject;
				})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding();

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await setComposerValue(textarea, "Message that fails");
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalledTimes(1);
		});
		await setComposerValue(textarea, "Do not overwrite this next draft");

		await act(async () => {
			rejectPost?.(new Error("send failed"));
			await Promise.resolve();
		});

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		});
		expect(readComposerValue(textarea)).toBe(
			"Do not overwrite this next draft"
		);
		expect(screen.getByText("Message that fails")).toBeTruthy();
		expect(screen.getByText("send failed")).toBeTruthy();
	});

	it("keeps an outcome-unknown main message under one idempotent send identity", async () => {
		const descriptor = createSpaceFileDescriptor({
			mimeType: "text/plain",
			name: "pending-main.txt",
		});
		const hangingRequest = createHangingFetchRequest();
		const postNormalMessageMock = vi.fn(
			async (input: { timeoutMs?: number }) =>
				await hangingRequest.request({
					operation: "space.send",
					timeoutMs: input.timeoutMs,
				})
		);
		const publishComposerUploadMock = vi.fn().mockResolvedValue(descriptor);
		createWebSpaceApiMock.mockReturnValue({
			discardComposerUpload: vi.fn().mockResolvedValue(undefined),
			postNormalMessage: postNormalMessageMock,
			publishComposerUpload: publishComposerUploadMock,
			stageComposerUpload: vi.fn().mockImplementation((input) =>
				Promise.resolve(
					createSpaceComposerUpload({
						id: input.uploadId,
						mimeType: input.mimeType,
						name: input.name,
						sizeBytes: input.bytes.size,
					})
				)
			),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding();
		fireEvent.change(screen.getByLabelText("Choose files to send"), {
			target: {
				files: [
					new File(["pending"], "pending-main.txt", {
						type: "text/plain",
					}),
				],
			},
		});
		await screen.findByRole("group", { name: "Files to send" });

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		const sendButton = screen.getByRole("button", { name: "Send message" });
		await setComposerValue(textarea, "Message that times out");
		fireEvent.click(sendButton);

		await waitFor(() => {
			expect(hangingRequest.fetchMock).toHaveBeenCalledTimes(1);
		});
		expect(hangingRequest.timeoutSpy).toHaveBeenCalledWith(30_000);
		expect(postNormalMessageMock).toHaveBeenCalledWith(
			expect.objectContaining({ timeoutMs: 30_000 })
		);
		expect(readComposerValue(textarea)).toBe("");
		expect((sendButton as HTMLButtonElement).disabled).toBe(true);
		const conversationLog = screen.getByRole("log", {
			name: "Conversation history",
		});
		expect(
			within(conversationLog).getByText("Message that times out")
		).toBeTruthy();

		await act(async () => {
			hangingRequest.abortForTimeout();
			await Promise.resolve();
		});
		await waitFor(() => {
			expect(hangingRequest.fetchMock).toHaveBeenCalledTimes(2);
		});
		await act(async () => {
			hangingRequest.abortForTimeout();
			await Promise.resolve();
		});

		await waitFor(() => {
			expect(
				within(conversationLog).getByText("Message that times out")
			).toBeTruthy();
			expect(readComposerValue(textarea)).toBe("");
			expect((sendButton as HTMLButtonElement).disabled).toBe(true);
			expect(screen.getByText("Delivery not confirmed.")).toBeTruthy();
		});
		expect(postNormalMessageMock.mock.calls[1]?.[0]).toEqual(
			postNormalMessageMock.mock.calls[0]?.[0]
		);
		expect(screen.queryByRole("group", { name: "Files to send" })).toBeNull();
		expect((sendButton as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(sendButton);
		expect(postNormalMessageMock).toHaveBeenCalledTimes(2);
		expect(publishComposerUploadMock).toHaveBeenCalledTimes(1);
	});

	it("does not show a send-failure banner when the message posted but a follow-up step failed", async () => {
		const postNormalMessageMock = vi.fn().mockResolvedValue(
			createTextSignal({
				id: "sig-mention-success",
				text: "@Runner(wake) please reply",
			})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [], nextCursor: null },
			}),
		});

		renderSpaceLanding();

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await waitFor(() => {
			expect(textarea).toBeTruthy();
		});

		// Install the storage failure only after the initial mount settles, so
		// this reproduces the real trigger (mention-recency bookkeeping hitting
		// a full/blocked localStorage in `recordSuccessfulSubmission`, which
		// runs strictly after the message already posted) without touching
		// unrelated storage reads/writes made while the page renders.
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const storageSetItemSpy = vi
			.spyOn(Storage.prototype, "setItem")
			.mockImplementation(() => {
				throw new DOMException(
					"The quota has been exceeded.",
					"QuotaExceededError"
				);
			});

		await setComposerValue(textarea, "@Runner(wake) please reply");
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalled();
		});
		const conversationLog = screen.getByRole("log", {
			name: "Conversation history",
		});
		await waitFor(() => {
			expect(
				within(conversationLog).getAllByText("@Runner(wake) please reply")
					.length
			).toBeGreaterThan(0);
		});
		expect(consoleErrorSpy).toHaveBeenCalled();
		expect(screen.queryByText("The quota has been exceeded.")).toBeNull();
		expect(
			within(conversationLog).getAllByText("@Runner(wake) please reply")
		).toHaveLength(1);

		storageSetItemSpy.mockRestore();
	});

	it("does not send a message when Enter confirms IME composition", async () => {
		const postNormalMessageMock = vi.fn().mockResolvedValue(
			createTextSignal({
				id: "sig-ime",
				text: "zhong",
			})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await setComposerValue(textarea, "zhong");
		fireEvent.keyDown(textarea, { isComposing: true, key: "Enter" });

		await act(async () => {
			await Promise.resolve();
		});

		expect(postNormalMessageMock).not.toHaveBeenCalled();
		expect(readComposerValue(textarea)).toBe("zhong");
	});

	it("sends plain text without a message envelope", async () => {
		const statusRefetchMock = vi
			.fn()
			.mockResolvedValue({ data: createSpaceStatus(), error: null });
		const postNormalMessageMock = vi.fn().mockResolvedValue(
			createTextSignal({
				id: "sig-plain",
				text: "Plain text message",
			})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
				refetch: statusRefetchMock,
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await setComposerValue(textarea, "Plain text message");
		expect(readComposerValue(textarea)).toBe("Plain text message");
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalledWith({
				meta: {
					clientMessageId: expect.any(String),
					authorHasRead: true,
				},
				spaceId: "space-123",
				text: "Plain text message",
				timeoutMs: 30_000,
			});
			expect(statusRefetchMock).toHaveBeenCalledTimes(2);
		});
	});

	it("sends a bare @token as plain text without a message envelope", async () => {
		const postNormalMessageMock = vi.fn().mockResolvedValue(
			createTextSignal({
				id: "sig-bare-token",
				text: "@unknown-token stays plain text",
			})
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await setComposerValue(textarea, "@unknown-token stays plain text");
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalledWith({
				meta: {
					clientMessageId: expect.any(String),
					authorHasRead: true,
				},
				spaceId: "space-123",
				text: "@unknown-token stays plain text",
				timeoutMs: 30_000,
			});
		});
	});

	it("sends picker-authored bare mentions with a structured message envelope and reorders recent mentions after success", async () => {
		const queryClient = createTestQueryClient();
		useQueryClientMock.mockReturnValue(queryClient);
		const watcherProfileId = "agt_33333333-3333-3333-3333-333333333333";
		const membersSnapshot = createMembersSnapshot({
			extraAgents: [
				{
					mentionAlias: "watcher",
					profileId: watcherProfileId,
					profileName: "Watcher",
				},
			],
		});
		const postNormalMessageMock = vi.fn().mockImplementation((input) =>
			Promise.resolve(
				createTextSignal({
					id: "sig-mention",
					messageEnvelope: input.messageEnvelope,
					meta: input.meta,
					text: input.text,
				})
			)
		);
		createWebSpaceApiMock.mockReturnValue({
			postNormalMessage: postNormalMessageMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: membersSnapshot,
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [],
					nextCursor: null,
				},
			}),
			messageDetailsBySignalId: {
				"sig-mention": createMessageDetailsQueryResult({
					signalId: "sig-mention",
					wakeContext: createWakeContext({
						clientMessageId: "client-message-1",
						sourceSignalId: "sig-mention",
						targets: [
							createWakeTarget({
								status: "running",
								targetLabel: "@watcher",
								targetProfileId: watcherProfileId,
							}),
						],
					}),
				}),
			},
		});
		readSpaceMembersMock.mockResolvedValue(membersSnapshot);

		renderSpaceLanding({ queryClient });

		const textarea = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await insertComposerMember(WATCHER_OPTION_NAME, "watch");
		await waitFor(() => {
			expect(readComposerValue(textarea)).toBe("@Watcher ");
		});
		await appendComposerText(textarea, "hello there", "@Watcher hello there");
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() => {
			expect(postNormalMessageMock).toHaveBeenCalledWith({
				messageEnvelope: {
					activationTargets: [watcherProfileId],
					mentionTargets: [],
					referenceTargets: [],
					text: "@Watcher hello there",
				},
				meta: {
					clientMessageId: expect.any(String),
					authorHasRead: true,
				},
				spaceId: "space-123",
				text: "@Watcher hello there",
				timeoutMs: 30_000,
			});
		});
		await waitFor(() => {
			const publishedMessage = document.querySelector(
				'[data-signal-id="sig-mention"]'
			);
			expect(publishedMessage?.textContent).toContain("hello there");
			expect(
				publishedMessage?.querySelector(
					'[data-slot="space-message-profile-mention"]'
				)?.textContent
			).toContain("Watcher");
		});
		const sourceMessage = document.querySelector(
			'[data-signal-id="sig-mention"]'
		);
		expect(sourceMessage).not.toBeNull();
		// Active Wake progress stays at the conversation tail while its source remains visible.
		const sourceMessageGroup = sourceMessage?.closest("[data-message-row-id]");
		expect(sourceMessageGroup).not.toBeNull();
		const wakeThinkingIndicator = screen.getByTestId(
			"space-wake-thinking-indicator"
		);
		expect(wakeThinkingIndicator.textContent).toContain("watcher · Working…");
		fireEvent.click(wakeThinkingIndicator);
		expect(
			await screen.findByRole("heading", { name: "Message details" })
		).toBeTruthy();
		const watcherActivity = await screen.findByRole("region", {
			name: "Watcher activity",
		});
		expect(within(watcherActivity).getByText("Working")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Close message details" })
		);
		await waitFor(() => {
			expect(
				screen.queryByRole("heading", { name: "Message details" })
			).toBeNull();
		});
		expect(
			JSON.parse(
				window.localStorage.getItem("openmeld.space.last-wake-diagnostic") ??
					"{}"
			)
		).toMatchObject({
			clientMessageId: expect.any(String),
			sourceSignalId: "sig-mention",
			spaceId: "space-123",
			targetProfileIds: ["agt_33333333-3333-3333-3333-333333333333"],
		});

		const targetList = await openComposerMemberPicker();
		const options = within(targetList).getAllByRole("option");
		expect(options[0]?.textContent).toContain("@all");
		expect(options[1]?.textContent).toContain("Watcher");
		expect(options[2]?.textContent).toContain("Runner");
	});

	it("lets users jump from a loaded reply preview to the original message", () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-1",
							text: "Original question",
						}),
						createTextSignal({
							id: "sig-2",
							text: "Follow-up answer",
							replyTo: {
								signalId: "sig-1",
								profileId: "11111111-1111-1111-1111-111111111111",
								profileKind: "human",
								profileName: "Mira",
								previewText: "Original question",
							},
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(
			screen.getByRole("button", { name: "Jump to original message" })
				.textContent
		).toContain("Replying to Mira");
		expect(screen.getAllByText("Original question").length).toBeGreaterThan(0);
		fireEvent.click(
			screen.getByRole("button", { name: "Jump to original message" })
		);
		expect(
			document
				.querySelector('[data-signal-id="sig-1"]')
				?.getAttribute("data-highlighted")
		).toBe("true");
		expect(
			screen.queryByRole("button", { name: "View Original Message" })
		).toBeNull();
	});

	it("opens an Inbox source at the highlighted message", async () => {
		const offsetHeightSpy = vi
			.spyOn(HTMLElement.prototype, "offsetHeight", "get")
			.mockReturnValue(500);
		const rectSpy = vi
			.spyOn(HTMLElement.prototype, "getBoundingClientRect")
			.mockImplementation(function (this: HTMLElement) {
				if (this.getAttribute("role") === "log") {
					return createDomRect({ bottom: 500, top: 0 });
				}
				if (this.hasAttribute("data-signal-id")) {
					const conversation = this.closest<HTMLElement>("[role='log']");
					const scrollTop = conversation?.scrollTop ?? 0;
					return createDomRect({
						bottom: 760 - scrollTop,
						top: 700 - scrollTop,
					});
				}
				return createDomRect({ bottom: 0, top: 0 });
			});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-inbox-target",
							text: "Review this exact message.",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		const view = renderSpaceLanding({
			initialFocusRequestId: "visit-1",
			initialFocusSignalId: "sig-inbox-target",
		});

		const target = document.querySelector(
			'[data-signal-id="sig-inbox-target"]'
		);
		expect(target?.getAttribute("data-highlighted")).toBe("true");
		expect(
			target?.querySelector('[data-slot="space-message-text-surface"]')
				?.className
		).toContain("motion-reduce:transition-none");
		expect(
			screen.getByRole("log", { name: "Conversation history" }).scrollTop
		).toBe(480);
		expect(document.activeElement).toBe(target);
		(target as HTMLElement | null)?.blur();
		expect(document.activeElement).not.toBe(target);
		(
			screen.getByRole("log", { name: "Conversation history" }) as HTMLElement
		).scrollTop = 0;
		view.rerender(
			<SpaceLanding
				initialFocusRequestId="visit-2"
				initialFocusSignalId="sig-inbox-target"
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);
		await waitFor(() => {
			const refocusedTarget = document.querySelector(
				'[data-signal-id="sig-inbox-target"]'
			);
			expect(
				screen.getByRole("log", { name: "Conversation history" }).scrollTop
			).toBe(480);
			expect(document.activeElement).toBe(refocusedTarget);
		});
		rectSpy.mockRestore();
		offsetHeightSpy.mockRestore();
	});

	it("opens a terminal Wake failure Inbox target at the source message that presents its outcome", () => {
		const sourceSignal = createTextSignal({
			id: "sig-failed-wake-source",
			text: "@Runner(wake) check the deployment.",
		});
		const failureSignal = createTerminalFailureNoticeSignal({
			actorProfileId: "agt_22222222-2222-2222-2222-222222222222",
			dispatchId: null,
			id: "sig-failed-wake-outcome",
			replyToSignalId: sourceSignal.id,
			text: "Runner could not complete this Wake.",
			ts: 20,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [sourceSignal, failureSignal],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding({ initialFocusSignalId: sourceSignal.id });

		const source = document.querySelector(
			`[data-signal-id="${sourceSignal.id}"]`
		);
		expect(source?.getAttribute("data-highlighted")).toBe("true");
		expect(document.activeElement).toBe(source);
		expect(
			screen.queryByRole("status", {
				name: "Linked message isn't available",
			})
		).toBeNull();
	});

	it("opens an old Inbox message directly without loading the intervening history", async () => {
		const recentSignal = createTextSignal({
			id: "sig-recent",
			text: "Recent message",
			ts: 20,
		});
		const olderTarget = createTextSignal({
			id: "sig-older-inbox-target",
			text: "Older linked message",
			ts: 10,
		});
		const listSignalEnvelopesMock = vi.fn().mockImplementation(({ query }) =>
			Promise.resolve({
				envelopes: query.aroundSignalId === olderTarget.id ? [olderTarget] : [],
				nextCursor: null,
			})
		);
		createWebSpaceApiMock.mockReturnValue({
			listSignalEnvelopes: listSignalEnvelopesMock,
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({ isSuccess: true, data: createSpaceStatus() }),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [recentSignal], nextCursor: null },
			}),
		});

		renderSpaceLanding({ initialFocusSignalId: olderTarget.id });

		await waitFor(() => {
			expect(
				document
					.querySelector(`[data-signal-id="${olderTarget.id}"]`)
					?.getAttribute("data-highlighted")
			).toBe("true");
		});
		expect(screen.queryByText("Recent message")).toBeNull();
		expect(document.activeElement?.getAttribute("data-signal-id")).toBe(
			olderTarget.id
		);
		expect(listSignalEnvelopesMock).toHaveBeenCalledTimes(1);
		expect(listSignalEnvelopesMock).toHaveBeenCalledWith({
			spaceId: "space-123",
			signal: expect.any(AbortSignal),
			query: {
				afterCount: 30,
				aroundSignalId: olderTarget.id,
				beforeCount: 30,
				kinds: ["text", "status", "system_notice"],
			},
		});
	});

	it.each([
		"missing",
		"network failure",
	])("explains an old Inbox lookup failure: %s", async (failure) => {
		const recentSignal = createTextSignal({
			id: "sig-only-recent",
			text: "Only recent message",
			ts: 20,
		});
		createWebSpaceApiMock.mockReturnValue({
			listSignalEnvelopes:
				failure === "missing"
					? vi.fn().mockResolvedValue({ envelopes: [], nextCursor: null })
					: vi
							.fn()
							.mockRejectedValue(
								new Error("The connection was interrupted. Try again.")
							),
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({ isSuccess: true, data: createSpaceStatus() }),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [recentSignal], nextCursor: null },
			}),
		});

		renderSpaceLanding({ initialFocusSignalId: "sig-missing-inbox-target" });

		expect(
			await screen.findByText(
				failure === "missing"
					? "This message is no longer available in this conversation. Showing the latest messages."
					: "Couldn’t load this part of the conversation. Try again."
			)
		).toBeTruthy();
	});

	it.each([
		false,
		true,
	])("opens the exact Inbox reply while unrelated bootstrap is pending: %s", async (bootstrapPending) => {
		const rootSignal = createTextSignal({
			id: "sig-linked-thread-root",
			text: "Thread root",
			ts: 10,
		});
		const replySignal = createTextSignal({
			id: "sig-linked-thread-reply",
			text: "Exact linked reply",
			ts: 20,
		});
		const threadSignals = createQueryResult({ isPending: true });
		const threads = createQueryResult({ isPending: true, isFetching: true });
		const status = bootstrapPending
			? createQueryResult({ isPending: true })
			: createQueryResult({ isSuccess: true, data: createSpaceStatus() });
		mockSpaceQueries({
			...(bootstrapPending
				? { bootstrap: createQueryResult({ isPending: true }) }
				: {}),
			status,
			members: bootstrapPending
				? createQueryResult({ isPending: true })
				: createQueryResult({
						isSuccess: true,
						data: createMembersSnapshot(),
					}),
			history: bootstrapPending
				? createQueryResult({ isPending: true })
				: createQueryResult({
						isSuccess: true,
						data: { envelopes: [rootSignal], nextCursor: null },
					}),
			threads,
			threadSignals,
		});

		const view = renderSpaceLanding({
			initialFocusRequestId: "visit-1",
			initialFocusSignalId: replySignal.id,
			initialFocusThreadRootSignalId: rootSignal.id,
		});
		if (bootstrapPending) {
			const pendingPanel = screen.getByRole("complementary", {
				name: "Thread",
			});
			expect(within(pendingPanel).getByText("Loading messages…")).toBeTruthy();
			expect(within(pendingPanel).queryByText("Exact linked reply")).toBeNull();
			expect(
				within(pendingPanel).getByRole("button", { name: "Close thread" })
			).toBeTruthy();
			expect(
				useQueryMock.mock.calls.some(
					([options]) =>
						options.queryKey[1] === "status" && options.enabled === true
				)
			).toBe(true);
			Object.assign(
				status,
				createQueryResult({ isSuccess: true, data: createSpaceStatus() })
			);
			view.rerender(
				<SpaceLanding
					initialFocusRequestId="visit-1"
					initialFocusSignalId={replySignal.id}
					initialFocusThreadRootSignalId={rootSignal.id}
					orgSlug="acme"
					profileId={DEFAULT_SPACE_PROFILE_ID}
					spaceId="space-123"
				/>
			);
		}

		const threadPanel = await screen.findByRole("complementary", {
			name: "Thread",
		});
		expect(
			within(threadPanel).getByText("Thread", { exact: true })
		).toBeTruthy();
		if (!bootstrapPending) {
			expect(within(threadPanel).getByRole("textbox")).toBeTruthy();
		}
		expect(within(threadPanel).queryByText("Exact linked reply")).toBeNull();
		Object.assign(
			threads,
			createQueryResult({
				isSuccess: true,
				data: {
					previews: [],
					threads: [
						{
							createdAt: "2026-04-11T00:00:00.000Z",
							createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
							rootSignalId: rootSignal.id,
							spaceId: "space-123",
							threadId: "thread-linked",
							updatedAt: "2026-04-11T00:00:00.000Z",
						},
					],
				},
			})
		);
		view.rerender(
			<SpaceLanding
				initialFocusRequestId="visit-1"
				initialFocusSignalId={replySignal.id}
				initialFocusThreadRootSignalId={rootSignal.id}
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);
		expect(within(threadPanel).getByText("Loading messages…")).toBeTruthy();
		Object.assign(
			threadSignals,
			createQueryResult({ isSuccess: true, data: { signals: [replySignal] } })
		);
		view.rerender(
			<SpaceLanding
				initialFocusRequestId="visit-1"
				initialFocusSignalId={replySignal.id}
				initialFocusThreadRootSignalId={rootSignal.id}
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);
		await waitFor(() => {
			const target = threadPanel.querySelector(
				`[data-signal-id="${replySignal.id}"]`
			);
			expect(target?.getAttribute("data-highlighted")).toBe("true");
			expect(
				target?.querySelector('[data-slot="space-message-text-surface"]')
					?.className
			).toContain("motion-reduce:transition-none");
		});
		expect(document.activeElement?.getAttribute("data-signal-id")).toBe(
			replySignal.id
		);
		fireEvent.click(
			within(threadPanel).getByRole("button", { name: "Close thread" })
		);
		expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull();
		view.rerender(
			<SpaceLanding
				initialFocusRequestId="visit-2"
				initialFocusSignalId={replySignal.id}
				initialFocusThreadRootSignalId={rootSignal.id}
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);
		const reopenedThreadPanel = await screen.findByRole("complementary", {
			name: "Thread",
		});
		await waitFor(() => {
			const target = reopenedThreadPanel.querySelector(
				`[data-signal-id="${replySignal.id}"]`
			);
			expect(target?.getAttribute("data-highlighted")).toBe("true");
			expect(document.activeElement).toBe(target);
		});
	});

	it("prefills a Wake mention when replying directly to an agent message", async () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-agent-answer",
							profile: {
								kind: "agent",
								profileId: DEFAULT_AGENT_PROFILE_ID,
								profileName: "Runner",
							},
							text: "The current time is 12:53 AM.",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const agentMessage = screen
			.getByText("The current time is 12:53 AM.")
			.closest("[data-message-row-id]");
		expect(agentMessage).not.toBeNull();
		fireEvent.mouseEnter(agentMessage as HTMLElement);
		fireEvent.click(screen.getByRole("button", { name: "Reply" }));

		const replyBanner = document.querySelector(
			'[data-slot="composer-reply-banner"]'
		);
		expect(replyBanner?.textContent).toContain(
			"Replying Runner: The current time is 12:53 AM."
		);
		expect(replyBanner?.className).toContain("border-b");
		const composer = screen.getByRole("textbox", {
			name: "Message this space",
		});
		await waitFor(() => {
			expect(readComposerValue(composer)).toBe("@Runner ");
			expect(
				screen.getByRole("combobox", {
					name: "Change relation for Runner",
				})
			).toBeTruthy();
		});
	});

	it.each([
		"stay",
		"close",
		"failure",
	])("opens a new Thread before creation finishes and handles %s", async (action) => {
		const rootSignal = createTextSignal({
			id: "new-thread-root",
			text: "Start a thread here.",
		});
		let resolveCreation!: (response: CreateSpaceThreadResponse) => void;
		let rejectCreation!: (error: Error) => void;
		const pending = new Promise<CreateSpaceThreadResponse>(
			(resolve, reject) => {
				resolveCreation = resolve;
				rejectCreation = reject;
			}
		);
		const createThread = vi.fn(() => pending);
		createWebSpaceApiMock.mockReturnValue({ createThread });
		const threads = createQueryResult({
			isSuccess: true,
			data: { threads: [], previews: [] },
		});
		mockSpaceQueries({
			status: createQueryResult({ isSuccess: true, data: createSpaceStatus() }),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [rootSignal], nextCursor: null },
			}),
			threads,
			threadSignals: createQueryResult({ isPending: true }),
		});
		const view = renderSpaceLanding();
		fireEvent.click(screen.getByRole("button", { name: "Reply in thread" }));
		const panel = screen.getByRole("complementary", { name: "Thread" });
		expect(within(panel).getByText("Loading messages…")).toBeTruthy();
		expect(createThread).toHaveBeenCalledTimes(1);
		if (action === "close") {
			fireEvent.click(
				within(panel).getByRole("button", { name: "Close thread" })
			);
		}
		if (action === "failure") {
			await act(async () =>
				rejectCreation(new Error("Thread creation failed."))
			);
			expect(
				within(panel).getAllByText("Thread creation failed.").length
			).toBeGreaterThan(0);
			return;
		}
		const response: CreateSpaceThreadResponse = {
			thread: {
				threadId: "new-thread",
				spaceId: "space-123",
				rootSignalId: rootSignal.id,
				createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
				createdAt: "2026-04-11T00:00:00.000Z",
				updatedAt: "2026-04-11T00:00:00.000Z",
			},
			rootSignal: rootSignal as SignalEnvelope,
			placement: {
				threadId: "new-thread",
				signalId: rootSignal.id,
				placement: "root",
				createdAt: "2026-04-11T00:00:00.000Z",
			},
		};
		await act(async () => resolveCreation(response));
		Object.assign(
			threads,
			createQueryResult({
				isSuccess: true,
				data: { threads: [response.thread], previews: [] },
			})
		);
		view.rerender(
			<SpaceLanding
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);
		expect(
			screen.queryByRole("complementary", { name: "Thread" }) !== null
		).toBe(action === "stay");
	});

	it("adds tooltips to the main message action buttons", () => {
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-actions",
							text: "Please review this.",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const actionMessage = screen
			.getByText("Please review this.")
			.closest("[data-message-row-id]");
		expect(actionMessage).not.toBeNull();
		// The reserved footer is a sibling of the bubble under the shared
		// data-message-row-id row. Its actions stay mounted while opacity handles
		// hover and keyboard reveal, so they are reachable without pointer state.
		const actionRow = actionMessage?.closest("[data-message-row-id]");
		expect(actionRow).not.toBeNull();
		const actionScope = within(actionRow as HTMLElement);

		const moreActionsButton = actionScope.getByRole("button", {
			name: "More actions",
		});
		expect(moreActionsButton.getAttribute("data-slot")).toBe("tooltip-trigger");
		fireEvent.click(moreActionsButton);
		expect(
			screen.getByRole("menuitem", { name: "Message details" })
		).toBeTruthy();

		const replyButton = actionScope.getByRole("button", { name: "Reply" });
		expect(replyButton.getAttribute("data-slot")).toBe("tooltip-trigger");

		const threadButton = actionScope.getByRole("button", {
			name: "Reply in thread",
		});
		expect(threadButton.getAttribute("data-slot")).toBe("tooltip-trigger");
	});

	it("keeps thread replies out of the main conversation and shows a compact preview", () => {
		const rootSignal = createTextSignal({
			id: "sig-root",
			text: "Can someone check the privacy page?",
			ts: 10,
		});
		const firstThreadReply = createTextSignal({
			id: "sig-thread-1",
			profile: {
				kind: "human",
				profileId: "22222222-2222-2222-2222-222222222222",
				profileName: "Nora",
			},
			text: "I'll check it.",
			ts: 20,
		});
		const secondThreadReply = createTextSignal({
			id: "sig-thread-2",
			profile: {
				kind: "agent",
				profileId: DEFAULT_AGENT_PROFILE_ID,
				profileName: "Runner",
			},
			text: "Filed the issue.",
			ts: 30,
		});
		const hiddenThreadReply = createTextSignal({
			id: "sig-thread-3",
			text: "Third reply that should stay inside the thread.",
			ts: 40,
		});

		mockSpaceQueries({
			threadSignals: createQueryResult({
				isSuccess: true,
				data: {
					signals: [firstThreadReply, secondThreadReply, hiddenThreadReply],
				},
			}),
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						rootSignal,
						firstThreadReply,
						secondThreadReply,
						hiddenThreadReply,
					],
					nextCursor: null,
				},
			}),
			threads: createQueryResult({
				isSuccess: true,
				data: {
					threads: [
						{
							threadId: "thread-1",
							spaceId: "space-123",
							rootSignalId: "sig-root",
							createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
							createdAt: "2026-04-11T00:00:00.000Z",
							updatedAt: "2026-04-11T00:00:00.000Z",
						},
					],
					previews: [
						{
							threadId: "thread-1",
							replyCount: 3,
							signals: [secondThreadReply, hiddenThreadReply],
							placements: [
								{
									threadId: "thread-1",
									signalId: "sig-thread-1",
									placement: "thread",
									createdAt: "2026-04-11T00:00:01.000Z",
								},
								{
									threadId: "thread-1",
									signalId: "sig-thread-2",
									placement: "thread",
									createdAt: "2026-04-11T00:00:02.000Z",
								},
								{
									threadId: "thread-1",
									signalId: "sig-thread-3",
									placement: "thread",
									createdAt: "2026-04-11T00:00:03.000Z",
								},
							],
						},
					],
				},
			}),
		});

		renderSpaceLanding();

		expect(
			screen.getByText("Can someone check the privacy page?")
		).toBeTruthy();
		const previews = screen.getAllByRole("button", {
			name: THREAD_REPLY_PREVIEW_PATTERN,
		});
		expect(previews).toHaveLength(2);
		expect(
			within(previews[0] as HTMLElement).getByText("Filed the issue.")
		).toBeTruthy();
		expect(
			within(previews[1] as HTMLElement).getByText(
				"Third reply that should stay inside the thread."
			)
		).toBeTruthy();
		expect(screen.queryByText("I'll check it.")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Open thread (3 replies)" })
		).toBeTruthy();
		const rootMessage = screen
			.getByText("Can someone check the privacy page?")
			.closest("[data-message-row-id]");
		expect(rootMessage).not.toBeNull();
		// The fixed footer always mounts so keyboard and screen-reader users can
		// reach the action without a hover-only DOM change.
		expect(screen.getByRole("button", { name: "Open thread" })).toBeTruthy();
		const focus = vi.spyOn(HTMLElement.prototype, "focus");
		for (const index of [0, 1, 1]) {
			focus.mockClear();
			fireEvent.click(previews[index] as HTMLElement);
			const panel = screen.getByRole("complementary", { name: "Thread" });
			const highlighted = panel.querySelector('[data-highlighted="true"]');
			expect(highlighted?.getAttribute("data-signal-id")).toBe(
				index === 0 ? secondThreadReply.id : hiddenThreadReply.id
			);
			expect(focus.mock.instances).toContain(highlighted);
		}
		focus.mockRestore();
	});

	it("restores the active Thread across reload and tab navigation until the user closes it", async () => {
		const rootSignal = createTextSignal({
			id: "sig-persisted-thread-root",
			text: "Keep this Thread open after reload.",
			ts: 10,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [rootSignal],
					nextCursor: null,
				},
			}),
			threads: createQueryResult({
				isSuccess: true,
				data: {
					threads: [
						{
							threadId: "thread-1",
							spaceId: "space-123",
							rootSignalId: rootSignal.id,
							createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
							createdAt: "2026-04-11T00:00:00.000Z",
							updatedAt: "2026-04-11T00:00:00.000Z",
						},
					],
					previews: [],
				},
			}),
		});

		const firstView = renderSpaceLanding();
		const rootMessage = screen
			.getByText("Keep this Thread open after reload.")
			.closest("[data-message-row-id]");
		expect(rootMessage).not.toBeNull();
		fireEvent.mouseEnter(rootMessage as HTMLElement);
		fireEvent.click(
			within(rootMessage as HTMLElement).getAllByRole("button", {
				name: "Open thread",
			})[0] as HTMLElement
		);

		expect(
			await screen.findByRole("complementary", { name: "Thread" })
		).toBeTruthy();
		expect(
			window.localStorage.getItem(SPACE_THREAD_PANEL_SELECTION_STORAGE_KEY)
		).toBe("thread-1");

		firstView.unmount();
		renderSpaceLanding();

		const restoredPanel = await screen.findByRole("complementary", {
			name: "Thread",
		});
		expect(restoredPanel).toBeTruthy();
		fireEvent.click(
			within(restoredPanel).getByRole("button", { name: "Go to message" })
		);
		await waitFor(() => {
			expect(document.activeElement?.getAttribute("data-signal-id")).toBe(
				rootSignal.id
			);
		});
		expect(screen.getByRole("complementary", { name: "Thread" })).toBeTruthy();

		await setComposerValue(
			within(restoredPanel).getByRole("textbox", { name: "Reply in thread" }),
			"Keep this draft while browsing the Space."
		);
		for (const tab of ["Tasks", "Files"]) {
			fireEvent.click(screen.getByRole("tab", { name: tab }));
			await waitFor(() => {
				expect(
					screen.queryByRole("complementary", { name: "Thread" })
				).toBeNull();
			});
			expect(screen.getByRole("tabpanel", { name: tab })).toBeTruthy();
			fireEvent.click(screen.getByRole("tab", { name: "Messages" }));
			const thread = await screen.findByRole("complementary", {
				name: "Thread",
			});
			expect(
				readComposerValue(
					within(thread).getByRole("textbox", { name: "Reply in thread" })
				)
			).toBe("Keep this draft while browsing the Space.");
		}

		fireEvent.click(
			within(restoredPanel).getByRole("button", { name: "Close thread" })
		);
		await waitFor(() => {
			expect(
				screen.queryByRole("complementary", { name: "Thread" })
			).toBeNull();
		});
		expect(
			window.localStorage.getItem(SPACE_THREAD_PANEL_SELECTION_STORAGE_KEY)
		).toBeNull();
	});

	it("opens unified Message details with Wake, reply, and system notice sections", async () => {
		const runnerAgentContext = createAgentContext({
			agentControllerConversationId: "conv-runner",
			agentControllerRef: "builtin:codex",
			bindingId: "binding-runner",
			profileId: DEFAULT_AGENT_PROFILE_ID,
			profileName: "@runner",
			runtimeId: "runtime-runner",
			workspacePath: "/Users/mira/.openmeld/runner",
		});
		const watcherAgentContext = createAgentContext({
			agentControllerConversationId: "conv-watcher",
			agentControllerRef: "builtin:codex",
			bindingId: "binding-watcher",
			profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
			profileName: "@watcher",
			runtimeId: "runtime-watcher",
			workspacePath: "/Users/mira/.openmeld/watcher",
		});
		const sourceWakeContext = createWakeContext({
			clientMessageId: "client-message-1",
			sourceSignalId: "sig-wake",
			targets: [
				createWakeTarget({
					agentContext: runnerAgentContext,
					reasonCode: "final_visible_message.reply_signal",
					status: "replied",
					targetLabel: "@runner",
					targetProfileId: DEFAULT_AGENT_PROFILE_ID,
				}),
				createWakeTarget({
					agentContext: watcherAgentContext,
					reasonCode: "final_visible_message.terminal_failure_notice",
					status: "failed",
					targetLabel: "@watcher",
					targetProfileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
				}),
				createWakeTarget({
					reasonCode: "wake_trace.planner_output_not_found",
					status: "missing",
					targetLabel: "Unknown target",
					targetProfileId: "agt_99999999-9999-4999-8999-999999999999",
				}),
			],
		});

		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-wake",
							text: "@runner(wake) @watcher(wake) please check",
							messageEnvelope: {
								activationTargets: [
									DEFAULT_AGENT_PROFILE_ID,
									"agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
									"agt_99999999-9999-4999-8999-999999999999",
								],
								referenceTargets: [],
								text: "@runner(wake) @watcher(wake) please check",
							},
							meta: {
								clientMessageId: "client-message-1",
							},
						}),
						createTextSignal({
							id: "sig-agent-reply",
							text: "Done.",
							meta: {
								dispatchId: "dispatch-runner",
								purpose: AGENT_REPLY_FINAL_PURPOSE,
								sourceClientMessageId: "client-message-1",
								sourceEventId: "sig-wake",
								targetProfileId: DEFAULT_AGENT_PROFILE_ID,
							},
							profile: {
								kind: "agent",
								profileId: DEFAULT_AGENT_PROFILE_ID,
								profileName: "Runner",
							},
							replyTo: {
								signalId: "sig-wake",
								profileId: DEFAULT_SPACE_PROFILE_ID,
								profileKind: "human",
								profileName: "Mira",
								previewText: "@runner(wake) @watcher(wake) please check",
							},
						}),
						createTerminalFailureNoticeSignal({
							actorProfileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
							dispatchId: "dispatch-watcher",
							id: "sig-terminal-failure",
							replyToSignalId: "sig-wake",
							text: "Watcher could not complete this Wake.",
						}),
					],
					nextCursor: null,
				},
			}),
			messageDetailsBySignalId: {
				"sig-wake": createMessageDetailsQueryResult({
					signalId: "sig-wake",
					wakeContext: sourceWakeContext,
				}),
				"sig-agent-reply": createMessageDetailsQueryResult({
					agentContext: runnerAgentContext,
					message: {
						actor: {
							profileId: DEFAULT_AGENT_PROFILE_ID,
							profileKind: "agent",
							displayName: "Runner",
							profileName: "Runner",
							profileHandle: null,
						},
					},
					replyContext: createReplyContext({
						author: "Mira",
						previewText: "@runner(wake) @watcher(wake) please check",
						replyingToSignalId: "sig-wake",
					}),
					signalId: "sig-agent-reply",
					wakeContext: createWakeContext({
						clientMessageId: "client-message-1",
						sourceSignalId: "sig-wake",
						targets: [
							createWakeTarget({
								agentContext: runnerAgentContext,
								reasonCode: "final_visible_message.reply_signal",
								status: "replied",
								targetLabel: "@runner",
								targetProfileId: DEFAULT_AGENT_PROFILE_ID,
							}),
						],
					}),
				}),
				"sig-terminal-failure": createMessageDetailsQueryResult({
					message: {
						signalType: "signal.system_notice",
						actor: {
							profileId: "openmeld-system",
							profileKind: "system",
							displayName: "OpenMeld",
							profileName: "OpenMeld",
							profileHandle: null,
						},
					},
					replyContext: createReplyContext({
						author: "Mira",
						previewText: "@runner(wake) @watcher(wake) please check",
						replyingToSignalId: "sig-wake",
					}),
					signalId: "sig-terminal-failure",
					wakeContext: createWakeContext({
						clientMessageId: "client-message-1",
						sourceSignalId: "sig-wake",
						targets: [
							createWakeTarget({
								agentContext: watcherAgentContext,
								reasonCode: "final_visible_message.terminal_failure_notice",
								status: "failed",
								targetLabel: "@watcher",
								targetProfileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
							}),
						],
					}),
				}),
			},
		});

		renderSpaceLanding();

		expect(
			screen.queryByRole("button", { name: "Open Wake details" })
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Report issue" })).toBeNull();

		const sourceMessage = document.querySelector('[data-signal-id="sig-wake"]');
		expect(sourceMessage).not.toBeNull();
		// The fixed footer renders as a sibling of the bubble under the shared
		// data-message-row-id row. It remains mounted while hover/focus controls
		// opacity, so this scope stays stable for pointer and keyboard users.
		const sourceRow = sourceMessage?.closest("[data-message-row-id]");
		expect(sourceRow).not.toBeNull();
		const sourceActionScope = within(sourceRow as HTMLElement);
		const sourceMessageDetailsButton =
			sourceRow?.querySelector<HTMLButtonElement>(
				'[data-slot="message-footer"] button[aria-label="View error details: Agent couldn’t reply"]'
			);
		if (!sourceMessageDetailsButton) {
			throw new Error("Expected the source message footer details action.");
		}
		expect(sourceMessageDetailsButton.className).toContain("text-destructive");
		fireEvent.click(
			sourceActionScope.getByRole("button", { name: "More actions" })
		);
		expect(screen.getByRole("menuitem", { name: "Reply" })).toBeTruthy();
		expect(
			screen.getByRole("menuitem", { name: "Reply in thread" })
		).toBeTruthy();
		// The source footer keeps only the failure icon. The diagnostic
		// body remains in Message details instead of extending the timeline.
		expect(
			within(sourceRow as HTMLElement).queryByText("Agent couldn’t reply")
		).toBeNull();
		expect(
			within(sourceRow as HTMLElement).queryByText(
				"Watcher could not complete this Wake."
			)
		).toBeNull();
		fireEvent.click(sourceMessageDetailsButton);

		expect(
			await screen.findByRole("heading", { name: "Message details" })
		).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Activity" })).toBeTruthy();
		expect(screen.getAllByText("@runner").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Replied").length).toBeGreaterThan(0);
		expect(screen.getAllByText("@watcher").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Unknown target").length).toBeGreaterThan(0);
		const watcherActivity = screen.getByRole("region", {
			name: "@watcher activity",
		});
		expect(
			within(watcherActivity).getByText("Watcher could not complete this Wake.")
		).toBeTruthy();
		const runnerActivity = screen.getByRole("region", {
			name: "Runner activity",
		});
		expect(within(runnerActivity).getByText("Runner")).toBeTruthy();
		expect(within(runnerActivity).getByText("Done.")).toBeTruthy();
		expect(within(runnerActivity).queryByText("OpenMeld")).toBeNull();
		expect(
			within(runnerActivity).getByRole("button", {
				name: "Go to message",
			})
		).toBeTruthy();
		expect(useQueryMock).toHaveBeenCalledWith(
			expect.objectContaining({
				queryKey: [
					"spaces",
					"message-details",
					"space-123",
					"sig-wake",
					DEFAULT_SPACE_PROFILE_ID,
				],
			})
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Close message details" })
		);

		const finalReply = screen
			.getByText("Done.")
			.closest("[data-message-row-id]");
		expect(finalReply).not.toBeNull();
		expect(
			screen.queryByRole("heading", { name: "Message details" })
		).toBeNull();
		const finalReplyRow = finalReply?.closest("[data-message-row-id]");
		expect(finalReplyRow).not.toBeNull();

		fireEvent.click(
			within(finalReplyRow as HTMLElement).getByRole("button", {
				name: "More actions",
			})
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "Message details" }));

		expect(
			await screen.findByRole("heading", { name: "Message details" })
		).toBeTruthy();
		expect(screen.getByText("Replied")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Activity" })).toBeTruthy();
		expect(screen.queryByText("Wake details")).toBeNull();

		fireEvent.click(screen.getByText("Technical details"));
		expect(
			screen.getAllByText("Message author Agent Controller Conversation ID")
				.length
		).toBeGreaterThan(0);
		expect(screen.getAllByText("conv-runner").length).toBeGreaterThan(0);
		fireEvent.click(
			screen.getByRole("button", { name: "Close message details" })
		);
		// The persistent failure footer remains after Message details closes.
		expect(
			within(sourceRow as HTMLElement).getByRole("button", {
				name: "View error details: Agent couldn’t reply",
			})
		).toBeTruthy();
	});

	it("does not turn a Message details recovery inspection failure into a user error", async () => {
		const inspectExecutionRecovery = vi
			.fn()
			.mockRejectedValue(new Error("recovery capability mismatch"));
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		createWebSpaceApiMock.mockReturnValue({
			getActiveWakeProgress: vi.fn().mockResolvedValue({ items: [] }),
			getUpdates: vi.fn().mockResolvedValue({ signals: [] }),
			getWakeProgress: vi.fn().mockResolvedValue({
				items: [],
				query: {
					clientMessageId: "client-message-recovery",
					spaceId: "space-123",
					targetProfileId: null,
				},
			}),
			inspectExecutionRecovery,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-recovery-source",
							messageEnvelope: {
								activationTargets: [DEFAULT_AGENT_PROFILE_ID],
								referenceTargets: [],
								text: "@Runner finish the report",
							},
							text: "@Runner finish the report",
						}),
						createTerminalFailureNoticeSignal({
							actorProfileId: DEFAULT_AGENT_PROFILE_ID,
							dispatchId: "dispatch-recovery",
							id: "sig-recovery-failure",
							replyToSignalId: "sig-recovery-source",
							text: "Runner stopped before posting the result.",
						}),
						createExecutionRecoveryAvailableSignal({
							actorProfileId: DEFAULT_AGENT_PROFILE_ID,
							dispatchId: "dispatch-recovery",
							id: "sig-recovery-available",
							replyToSignalId: "sig-recovery-source",
							resultRef: "dispatch-recovery::attempt-1",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		const sourceMessage = document.querySelector(
			'[data-signal-id="sig-recovery-source"]'
		);
		const sourceRow = sourceMessage?.closest("[data-message-row-id]");
		if (!sourceRow) {
			throw new Error("Expected the failed Wake source message row.");
		}
		fireEvent.click(
			within(sourceRow as HTMLElement).getByRole("button", {
				name: MESSAGE_DETAILS_ACTION_NAME_PATTERN,
			})
		);
		expect(
			await screen.findByRole("dialog", { name: "Message details" })
		).toBeTruthy();
		await waitFor(() =>
			expect(inspectExecutionRecovery).toHaveBeenCalledOnce()
		);
		await waitFor(() => {
			expect(
				screen.queryByRole("button", { name: "Recovery unavailable" })
			).toBeNull();
		});
		expect(toastMock.error).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalledWith(
			"Failed to inspect execution recovery.",
			expect.any(Error)
		);
	});

	it("does not execute an older Core fresh Wake through execution recovery", async () => {
		const inspectExecutionRecovery = vi.fn().mockResolvedValue({
			recovery: createLegacyFreshExecutionRecovery({
				dispatchId: "dispatch-legacy-fresh",
				targetProfileId: DEFAULT_AGENT_PROFILE_ID,
			}),
		});
		const executeExecutionRecovery = vi.fn();
		createWebSpaceApiMock.mockReturnValue({
			executeExecutionRecovery,
			getActiveWakeProgress: vi.fn().mockResolvedValue({ items: [] }),
			getUpdates: vi.fn().mockResolvedValue({ signals: [] }),
			getWakeProgress: vi.fn().mockResolvedValue({
				items: [],
				query: {
					clientMessageId: "client-message-legacy-fresh",
					spaceId: "space-123",
					targetProfileId: null,
				},
			}),
			inspectExecutionRecovery,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-legacy-fresh-source",
							messageEnvelope: {
								activationTargets: [DEFAULT_AGENT_PROFILE_ID],
								referenceTargets: [],
								text: "@Runner finish the report",
							},
							text: "@Runner finish the report",
						}),
						createTerminalFailureNoticeSignal({
							actorProfileId: DEFAULT_AGENT_PROFILE_ID,
							dispatchId: "dispatch-legacy-fresh",
							id: "sig-legacy-fresh-failure",
							replyToSignalId: "sig-legacy-fresh-source",
							text: "Runner could not complete this Wake.",
						}),
					],
					nextCursor: null,
				},
			}),
			messageDetailsBySignalId: {
				"sig-legacy-fresh-source": createMessageDetailsQueryResult({
					signalId: "sig-legacy-fresh-source",
				}),
			},
		});

		renderSpaceLanding();

		const sourceMessage = document.querySelector(
			'[data-signal-id="sig-legacy-fresh-source"]'
		);
		const sourceRow = sourceMessage?.closest("[data-message-row-id]");
		if (!sourceRow) {
			throw new Error("Expected the failed Wake source message row.");
		}
		fireEvent.click(
			within(sourceRow as HTMLElement).getByRole("button", {
				name: MESSAGE_DETAILS_ACTION_NAME_PATTERN,
			})
		);
		await screen.findByRole("dialog", { name: "Message details" });
		await waitFor(() =>
			expect(inspectExecutionRecovery).toHaveBeenCalledOnce()
		);
		expect(
			screen.queryByRole("button", { name: "Retry as new execution" })
		).toBeNull();
		expect(executeExecutionRecovery).not.toHaveBeenCalled();
	});

	it.each([
		false,
		true,
	])("keeps historical Wake failures diagnostic-only (thread: %s)", async (thread) => {
		const postNormalMessageMock = vi.fn();
		const postThreadSignalMock = vi.fn();
		const dialog = await openHistoricalWakeFailure({
			postNormalMessageMock,
			postThreadSignalMock,
			stageComposerUploadMock: vi.fn(),
			thread,
		});
		expect(
			within(dialog).queryByRole("button", { name: "Retry as new execution" })
		).toBeNull();
		expect(postNormalMessageMock).not.toHaveBeenCalled();
		expect(postThreadSignalMock).not.toHaveBeenCalled();
	});

	it.each([
		"blocked",
		"network failure",
	] as const)("blocks Agent Direct Message programmatic thread text before publication when current Wakeability is %s", async (failureKind) => {
		const postThreadSignalMock = vi.fn();
		const stageComposerUploadMock = vi.fn();
		const initialMembersSnapshot =
			createMembersSnapshot() as SpaceMembersSnapshot;
		const membersResult = createQueryResult({
			isSuccess: true,
			data: initialMembersSnapshot,
		});
		const currentMembersSnapshot = createMembersSnapshot({
			defaultAgentExecutionReadiness:
				createMissingBindingAgentExecutionReadiness(DEFAULT_AGENT_PROFILE_ID),
		}) as SpaceMembersSnapshot;
		const setQueryDataMock = vi.fn(
			(queryKey: readonly unknown[], update: unknown) => {
				if (
					JSON.stringify(queryKey) ===
					JSON.stringify(
						spaceQueryKeys.members("space-123", DEFAULT_SPACE_PROFILE_ID)
					)
				) {
					const snapshot =
						typeof update === "function"
							? (update as (current: unknown) => unknown)(membersResult.data)
							: update;
					if (
						typeof snapshot === "object" &&
						snapshot !== null &&
						"humans" in snapshot &&
						"agents" in snapshot
					) {
						Object.assign(membersResult, { data: snapshot });
					}
				}
			}
		);
		useQueryClientMock.mockReturnValue({
			cancelQueries: vi.fn().mockResolvedValue(undefined),
			fetchQuery: vi.fn().mockResolvedValue(undefined),
			getQueryData: vi.fn(() => undefined),
			invalidateQueries: vi.fn().mockResolvedValue(undefined),
			resetQueries: vi.fn().mockResolvedValue(undefined),
			setQueriesData: vi.fn(),
			setQueryData: setQueryDataMock,
		});
		if (failureKind === "blocked") {
			useLocalAgentRecoveryControllerMock.mockReturnValue({
				currentDeviceTargetQuery: {
					data: {
						availability: "resolved",
						deviceId: "device-office",
					},
				},
				selectedTargetDevice: {
					deviceId: "device-office",
					deviceDisplayName: "Office Mac mini",
				},
				refreshAll: vi.fn().mockResolvedValue(undefined),
				runtimeLane: "dev-local",
				startStateQuery: {
					data: createStartStateWithCodexCatalog(),
				},
			});
			readSpaceMembersMock.mockResolvedValue(currentMembersSnapshot);
		} else {
			readSpaceMembersMock.mockRejectedValue(new Error("network unavailable"));
		}
		const expectedErrorMessage =
			failureKind === "blocked"
				? currentMembersSnapshot.agents[0]?.agentWakeAvailability?.summary
				: "OpenMeld couldn't confirm that this agent can reply right now. Try again.";
		if (!expectedErrorMessage) {
			throw new Error("Expected a current Wakeability failure message.");
		}
		threadProgrammaticSendHarness.enabled = true;
		threadProgrammaticSendHarness.text =
			"Keep this programmatic Agent DM thread message";
		const sendButton = await openAgentDirectMessageThreadProgrammaticSend({
			membersQueryResult: membersResult,
			postThreadSignalMock,
			stageComposerUploadMock,
		});

		fireEvent.click(sendButton);

		await waitFor(() => {
			expect(readSpaceMembersMock).toHaveBeenCalledOnce();
			expect(screen.getByText(expectedErrorMessage)).toBeTruthy();
		});
		expect(postThreadSignalMock).not.toHaveBeenCalled();
		expect(stageComposerUploadMock).not.toHaveBeenCalled();
		expect(
			screen.getByRole("button", {
				name: "Send programmatic thread text",
			})
		).toBeTruthy();
		expect(threadProgrammaticSendHarness.text).toBe(
			"Keep this programmatic Agent DM thread message"
		);
		const threadComposer = screen
			.getByRole("textbox", { name: "Reply in thread" })
			.closest('[data-slot="thread-composer"]');
		if (!threadComposer) {
			throw new Error("Expected the Agent Direct Message thread Composer.");
		}
		expect(threadComposer.textContent).not.toContain(DEFAULT_AGENT_PROFILE_ID);
		expect(
			within(threadComposer as HTMLElement).getByRole("alert").textContent
		).toBe(expectedErrorMessage);
		if (failureKind === "blocked") {
			expect(expectedErrorMessage).toContain("Connect a local agent");
		} else {
			expect(
				within(threadComposer as HTMLElement).queryByRole("link")
			).toBeNull();
		}
		expect(membersResult.data).toBe(initialMembersSnapshot);
		expect(membersResult.data).not.toBe(currentMembersSnapshot);
		expect(
			initialMembersSnapshot.agents[0]?.agentWakeAvailability?.status
		).toBe("available_for_wake");
	});

	it("submits Diagnostic Reports from thread messages", async () => {
		const createDiagnosticReportMock = vi.fn().mockResolvedValue({
			createdAtMs: 1_774_979_200_000,
			diagnosticReportId: "diag_thread-reply",
			problemType: "reply_problem",
			reportedSignalId: "sig-thread-agent",
			reporterProfileId: DEFAULT_SPACE_PROFILE_ID,
			replyToSignalId: "sig-root",
			spaceId: "space-123",
			threadId: "thread-1",
			wakePointerDerivation: {
				reasonCodes: ["diagnostic_report.not_wake_related"],
				status: "not_wake",
			},
			wakePointers: [],
		});
		createWebSpaceApiMock.mockReturnValue({
			createDiagnosticReport: createDiagnosticReportMock,
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: vi.fn().mockResolvedValue({
				items: [],
				query: {
					clientMessageId: "client-message-1",
					spaceId: "space-123",
					targetProfileId: null,
				},
			}),
			leaveSpace: vi.fn(),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
		});
		const rootSignal = createTextSignal({
			id: "sig-root",
			text: "Can someone check the privacy page?",
		});
		const threadAgentReply = createTextSignal({
			id: "sig-thread-agent",
			profile: {
				kind: "agent",
				profileId: DEFAULT_AGENT_PROFILE_ID,
				profileName: "Runner",
			},
			replyTo: {
				previewText: "Can someone check the privacy page?",
				profileId: DEFAULT_SPACE_PROFILE_ID,
				profileKind: "human",
				profileName: "Mira",
				signalId: "sig-root",
			},
			text: "Thread reply text must stay out of diagnostics.",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [rootSignal],
					nextCursor: null,
				},
			}),
			threadSignals: createQueryResult({
				isSuccess: true,
				data: {
					signals: [threadAgentReply],
				},
			}),
			threads: createQueryResult({
				isSuccess: true,
				data: {
					threads: [
						{
							threadId: "thread-1",
							spaceId: "space-123",
							rootSignalId: "sig-root",
							createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
							createdAt: "2026-04-11T00:00:00.000Z",
							updatedAt: "2026-04-11T00:00:00.000Z",
						},
					],
					previews: [
						{
							threadId: "thread-1",
							replyCount: 1,
							signals: [threadAgentReply],
							placements: [
								{
									threadId: "thread-1",
									signalId: "sig-thread-agent",
									placement: "thread",
									createdAt: "2026-04-11T00:00:01.000Z",
								},
							],
						},
					],
				},
			}),
		});

		renderSpaceLanding();

		const rootMessage = screen
			.getByText("Can someone check the privacy page?")
			.closest("[data-message-row-id]");
		expect(rootMessage).not.toBeNull();
		fireEvent.click(
			within(rootMessage as HTMLElement).getByRole("button", {
				name: "Open thread (1 reply)",
			})
		);
		const threadPanel = screen.getByLabelText("Thread");
		expect(
			within(threadPanel).queryByRole("button", { name: "Report issue" })
		).toBeNull();
		fireEvent.click(
			within(threadPanel).getByRole("button", { name: "More actions" })
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "Message details" }));

		expect(createDiagnosticReportMock).not.toHaveBeenCalled();
		expect(
			await screen.findByRole("heading", { name: "Message details" })
		).toBeTruthy();
		expect(screen.getByText("Report issue")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Send report" }));

		await waitFor(() => {
			expect(createDiagnosticReportMock).toHaveBeenCalledWith({
				body: {
					problemType: "reply_problem",
					reportedSignalId: "sig-thread-agent",
				},
				spaceId: "space-123",
			});
		});
		expect(JSON.stringify(createDiagnosticReportMock.mock.calls)).not.toContain(
			"Thread reply text must stay out of diagnostics."
		);
		expect(
			JSON.parse(
				window.localStorage.getItem("openmeld.space.last-diagnostic-report") ??
					"{}"
			)
		).toMatchObject({
			diagnosticReportId: "diag_thread-reply",
			reportedSignalId: "sig-thread-agent",
			threadId: "thread-1",
		});
	});

	it.each([
		false,
		true,
	])("shows a thread reply before admission or publication responds (Wake: %s)", async (wake) => {
		let releaseAdmission: (() => void) | undefined;
		readSpaceMembersMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					releaseAdmission = () => resolve(createMembersSnapshot());
				})
		);
		const outgoingText = wake
			? "@Runner Optimistic thread reply"
			: "Optimistic thread reply";
		const postThreadSignalMock = vi.fn().mockImplementation(
			() =>
				new Promise(() => {
					// Keep the request pending so the test observes the optimistic reply.
				})
		);
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: vi.fn().mockResolvedValue({
				items: [],
				query: {
					clientMessageId: "client-message-1",
					spaceId: "space-123",
					targetProfileId: null,
				},
			}),
			leaveSpace: vi.fn(),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
			postThreadSignal: postThreadSignalMock,
		});
		const rootSignal = createTextSignal({
			id: "sig-thread-root",
			profile: {
				kind: "agent",
				profileId: DEFAULT_AGENT_PROFILE_ID,
				profileName: "Runner",
			},
			text: "I found the issue.",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [rootSignal],
					nextCursor: null,
				},
			}),
			threadSignals: createQueryResult({
				isSuccess: true,
				data: {
					signals: [rootSignal],
				},
			}),
			threads: createQueryResult({
				isSuccess: true,
				data: {
					threads: [
						{
							threadId: "thread-1",
							spaceId: "space-123",
							rootSignalId: "sig-thread-root",
							createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
							createdAt: "2026-04-11T00:00:00.000Z",
							updatedAt: "2026-04-11T00:00:00.000Z",
						},
					],
				},
			}),
		});

		renderSpaceLanding();

		const rootMessage = screen
			.getByText("I found the issue.")
			.closest("[data-message-row-id]");
		expect(rootMessage).not.toBeNull();
		fireEvent.mouseEnter(rootMessage as HTMLElement);
		fireEvent.click(
			within(rootMessage as HTMLElement).getAllByRole("button", {
				name: "Open thread",
			})[0] as HTMLElement
		);

		const threadPanel = screen.getByLabelText("Thread");
		const threadComposer = within(threadPanel).getByRole("textbox", {
			name: "Reply in thread",
		});
		if (wake) {
			await insertComposerMember(RUNNER_OPTION_NAME, "", threadPanel);
			await appendComposerText(
				threadComposer,
				"Optimistic thread reply",
				outgoingText
			);
		} else {
			await setComposerValue(threadComposer, outgoingText);
		}
		fireEvent.click(
			within(threadPanel).getByRole("button", { name: "Send reply" })
		);

		if (wake) {
			await waitFor(() => expect(readSpaceMembersMock).toHaveBeenCalled());
			expect(readComposerValue(threadComposer)).toBe("");
			expect(
				within(threadPanel).getByText("Optimistic thread reply", {
					exact: false,
					selector: "p",
				})
			).toBeTruthy();
			expect(postThreadSignalMock).not.toHaveBeenCalled();
			await act(async () => releaseAdmission?.());
		}

		await waitFor(() => {
			expect(postThreadSignalMock).toHaveBeenCalled();
		});
		expect(readComposerValue(threadComposer)).toBe("");
		expect(
			within(threadPanel).getByText("Optimistic thread reply", {
				exact: false,
				selector: "p",
			})
		).toBeTruthy();
		expect(threadComposer.getAttribute("contenteditable")).toBe("true");
		await setComposerValue(threadComposer, "Next thread reply");
		expect(readComposerValue(threadComposer)).toBe("Next thread reply");
		expect(
			(
				within(threadPanel).getByRole("button", {
					name: "Send reply",
				}) as HTMLButtonElement
			).disabled
		).toBe(false);
		fireEvent.keyDown(threadComposer, { key: "Enter" });
		expect(postThreadSignalMock).toHaveBeenCalledTimes(1);
	});

	it("sends a thread reply after the user removes a failed upload", async () => {
		const descriptor = createSpaceFileDescriptor({
			mimeType: "text/plain",
			name: "thread-ready.txt",
		});
		const messageFile = createSpaceMessageFileReference(descriptor);
		const postedThreadSignal = createTextSignal({
			files: [messageFile],
			id: "sig-thread-with-successful-file",
			text: "Thread text can still be sent",
		});
		const postThreadSignalMock = vi.fn().mockResolvedValue({
			placement: {
				createdAt: "2026-04-11T00:00:00.000Z",
				placement: "thread",
				signalId: postedThreadSignal.id,
				threadId: "thread-1",
			},
			signal: postedThreadSignal,
		});
		const stageComposerUploadMock = vi.fn().mockImplementation((input) => {
			if (input.name === "thread-ready.txt") {
				return Promise.resolve(
					createSpaceComposerUpload({
						id: input.uploadId,
						mimeType: input.mimeType,
						name: input.name,
						sizeBytes: input.bytes.size,
					})
				);
			}
			return Promise.reject(new Error("Thread file could not be uploaded."));
		});
		createWebSpaceApiMock.mockReturnValue({
			discardComposerUpload: vi.fn().mockResolvedValue(undefined),
			getUpdates: vi.fn().mockResolvedValue({ signals: [] }),
			getWakeProgress: vi.fn().mockResolvedValue({
				items: [],
				query: {
					clientMessageId: "client-message-1",
					spaceId: "space-123",
					targetProfileId: null,
				},
			}),
			leaveSpace: vi.fn(),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
			postThreadSignal: postThreadSignalMock,
			publishComposerUpload: vi.fn().mockResolvedValue(descriptor),
			stageComposerUpload: stageComposerUploadMock,
		});
		const rootSignal = createTextSignal({
			id: "sig-thread-file-root",
			text: "Attach the thread notes here.",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [rootSignal], nextCursor: null },
			}),
			threadSignals: createQueryResult({
				isSuccess: true,
				data: { signals: [rootSignal] },
			}),
			threads: createQueryResult({
				isSuccess: true,
				data: {
					threads: [
						{
							threadId: "thread-1",
							spaceId: "space-123",
							rootSignalId: rootSignal.id,
							createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
							createdAt: "2026-04-11T00:00:00.000Z",
							updatedAt: "2026-04-11T00:00:00.000Z",
						},
					],
				},
			}),
		});

		renderSpaceLanding();
		const rootMessage = screen
			.getByText("Attach the thread notes here.")
			.closest("[data-message-row-id]");
		expect(rootMessage).not.toBeNull();
		fireEvent.mouseEnter(rootMessage as HTMLElement);
		fireEvent.click(
			within(rootMessage as HTMLElement).getAllByRole("button", {
				name: "Open thread",
			})[0] as HTMLElement
		);

		const threadPanel = screen.getByLabelText("Thread");
		fireEvent.change(
			within(threadPanel).getByLabelText("Choose files to send"),
			{
				target: {
					files: [
						new File(["ready"], "thread-ready.txt", {
							type: "text/plain",
						}),
						new File(["broken"], "thread-broken.png", {
							type: "image/png",
						}),
					],
				},
			}
		);

		await within(threadPanel).findByText("Thread file could not be uploaded.");
		const threadComposer = within(threadPanel).getByRole("textbox", {
			name: "Reply in thread",
		});
		await setComposerValue(threadComposer, "Thread text can still be sent");
		expect(
			within(threadPanel).getByText(
				"Retry or remove the failed attachment to continue."
			)
		).toBeTruthy();
		expect(
			within(threadPanel).getByRole("button", { name: "Send reply" })
		).toHaveProperty("disabled", true);

		fireEvent.click(
			within(threadPanel).getByRole("button", {
				name: "Remove thread-broken.png",
			})
		);
		fireEvent.click(
			within(threadPanel).getByRole("button", { name: "Send reply" })
		);
		await waitFor(() => {
			expect(postThreadSignalMock).toHaveBeenCalledWith({
				body: expect.objectContaining({
					files: [messageFile],
					text: "Thread text can still be sent",
				}),
				spaceId: "space-123",
				threadId: "thread-1",
				timeoutMs: 30_000,
			});
		});
	});

	it("validates thread mentions before publishing selected files", async () => {
		const membersResult = createQueryResult({
			isSuccess: true,
			data: createMembersSnapshot(),
		});
		const publishComposerUploadMock = vi.fn();
		createWebSpaceApiMock.mockReturnValue({
			discardComposerUpload: vi.fn().mockResolvedValue(undefined),
			publishComposerUpload: publishComposerUploadMock,
			stageComposerUpload: vi.fn().mockImplementation((input) =>
				Promise.resolve(
					createSpaceComposerUpload({
						id: input.uploadId,
						mimeType: input.mimeType,
						name: input.name,
						sizeBytes: input.bytes.size,
					})
				)
			),
		});
		const rootSignal = createTextSignal({
			id: "sig-thread-mention-file-root",
			text: "Review the attached notes in this thread.",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: membersResult,
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [rootSignal], nextCursor: null },
			}),
			threadSignals: createQueryResult({
				isSuccess: true,
				data: { signals: [rootSignal] },
			}),
			threads: createQueryResult({
				isSuccess: true,
				data: {
					threads: [
						{
							threadId: "thread-1",
							spaceId: "space-123",
							rootSignalId: rootSignal.id,
							createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
							createdAt: "2026-04-11T00:00:00.000Z",
							updatedAt: "2026-04-11T00:00:00.000Z",
						},
					],
				},
			}),
		});

		const view = renderSpaceLanding();
		const rootMessage = screen
			.getByText("Review the attached notes in this thread.")
			.closest("[data-message-row-id]");
		expect(rootMessage).not.toBeNull();
		fireEvent.mouseEnter(rootMessage as HTMLElement);
		fireEvent.click(
			within(rootMessage as HTMLElement).getAllByRole("button", {
				name: "Open thread",
			})[0] as HTMLElement
		);

		let threadPanel = screen.getByLabelText("Thread");
		fireEvent.change(
			within(threadPanel).getByLabelText("Choose files to send"),
			{
				target: {
					files: [
						new File(["thread notes"], "thread-notes.txt", {
							type: "text/plain",
						}),
					],
				},
			}
		);
		await within(threadPanel).findByRole("group", { name: "Files to send" });
		const threadComposer = within(threadPanel).getByRole("textbox", {
			name: "Reply in thread",
		});
		await insertComposerMember(RUNNER_OPTION_NAME, "Run", threadPanel);
		await waitFor(() => {
			expect(readComposerValue(threadComposer)).toBe("@Runner ");
		});
		await appendComposerText(
			threadComposer,
			"review these thread notes",
			"@Runner review these thread notes"
		);

		Object.assign(membersResult, {
			data: undefined,
			error: new Error("members unavailable"),
			isError: true,
			isSuccess: false,
		});
		view.rerender(
			<SpaceLanding
				orgSlug="acme"
				profileId={DEFAULT_SPACE_PROFILE_ID}
				spaceId="space-123"
			/>
		);
		threadPanel = screen.getByLabelText("Thread");
		fireEvent.click(
			within(threadPanel).getByRole("button", { name: "Send reply" })
		);

		expect(
			within(threadPanel).getByRole("button", { name: "Send reply" })
		).toHaveProperty("disabled", true);
		expect(publishComposerUploadMock).not.toHaveBeenCalled();
		expect(
			within(threadPanel).getByRole("group", { name: "Files to send" })
		).toBeTruthy();
		expect(
			readComposerValue(
				within(threadPanel).getByRole("textbox", {
					name: "Reply in thread",
				})
			)
		).toBe("@Runner review these thread notes");
	});

	it("keeps an outcome-unknown thread reply under one idempotent send identity", async () => {
		const descriptor = createSpaceFileDescriptor({
			mimeType: "text/plain",
			name: "pending-thread.txt",
		});
		const hangingRequest = createHangingFetchRequest();
		const postThreadSignalMock = vi.fn(
			async (input: { timeoutMs?: number }) =>
				await hangingRequest.request({
					operation: "space.thread.send",
					timeoutMs: input.timeoutMs,
				})
		);
		const publishComposerUploadMock = vi.fn().mockResolvedValue(descriptor);
		createWebSpaceApiMock.mockReturnValue({
			discardComposerUpload: vi.fn().mockResolvedValue(undefined),
			getUpdates: vi.fn().mockResolvedValue({ signals: [] }),
			getWakeProgress: vi.fn().mockResolvedValue({
				items: [],
				query: {
					clientMessageId: "client-message-1",
					spaceId: "space-123",
					targetProfileId: null,
				},
			}),
			leaveSpace: vi.fn(),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
			postThreadSignal: postThreadSignalMock,
			publishComposerUpload: publishComposerUploadMock,
			stageComposerUpload: vi.fn().mockImplementation((input) =>
				Promise.resolve(
					createSpaceComposerUpload({
						id: input.uploadId,
						mimeType: input.mimeType,
						name: input.name,
						sizeBytes: input.bytes.size,
					})
				)
			),
		});
		const rootSignal = createTextSignal({
			id: "sig-thread-timeout-root",
			profile: {
				kind: "agent",
				profileId: DEFAULT_AGENT_PROFILE_ID,
				profileName: "Runner",
			},
			text: "Thread timeout root",
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: { envelopes: [rootSignal], nextCursor: null },
			}),
			threadSignals: createQueryResult({
				isSuccess: true,
				data: { signals: [rootSignal] },
			}),
			threads: createQueryResult({
				isSuccess: true,
				data: {
					threads: [
						{
							threadId: "thread-1",
							spaceId: "space-123",
							rootSignalId: rootSignal.id,
							createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
							createdAt: "2026-04-11T00:00:00.000Z",
							updatedAt: "2026-04-11T00:00:00.000Z",
						},
					],
				},
			}),
		});

		renderSpaceLanding();

		const rootMessage = screen
			.getByText("Thread timeout root")
			.closest("[data-message-row-id]");
		expect(rootMessage).not.toBeNull();
		fireEvent.mouseEnter(rootMessage as HTMLElement);
		fireEvent.click(
			within(rootMessage as HTMLElement).getAllByRole("button", {
				name: "Open thread",
			})[0] as HTMLElement
		);
		const threadPanel = screen.getByLabelText("Thread");
		fireEvent.change(
			within(threadPanel).getByLabelText("Choose files to send"),
			{
				target: {
					files: [
						new File(["pending"], "pending-thread.txt", {
							type: "text/plain",
						}),
					],
				},
			}
		);
		await within(threadPanel).findByRole("group", { name: "Files to send" });
		const threadComposer = within(threadPanel).getByRole("textbox", {
			name: "Reply in thread",
		});
		const sendButton = within(threadPanel).getByRole("button", {
			name: "Send reply",
		});
		await setComposerValue(threadComposer, "Thread reply that times out");
		fireEvent.click(sendButton);

		await waitFor(() => {
			expect(hangingRequest.fetchMock).toHaveBeenCalledTimes(1);
		});
		expect(hangingRequest.timeoutSpy).toHaveBeenCalledWith(30_000);
		expect(postThreadSignalMock).toHaveBeenCalledWith(
			expect.objectContaining({ timeoutMs: 30_000 })
		);
		expect(readComposerValue(threadComposer)).toBe("");
		expect((sendButton as HTMLButtonElement).disabled).toBe(true);
		expect(
			within(threadPanel).getByText("Thread reply that times out", {
				selector: "p",
			})
		).toBeTruthy();

		await act(async () => {
			hangingRequest.abortForTimeout();
			await Promise.resolve();
		});
		await waitFor(() => {
			expect(hangingRequest.fetchMock).toHaveBeenCalledTimes(2);
		});
		await act(async () => {
			hangingRequest.abortForTimeout();
			await Promise.resolve();
		});

		await waitFor(() => {
			expect(
				within(threadPanel).getByText("Thread reply that times out", {
					selector: "p",
				})
			).toBeTruthy();
			expect(readComposerValue(threadComposer)).toBe("");
			expect((sendButton as HTMLButtonElement).disabled).toBe(true);
			expect(
				within(threadPanel).getByText("Delivery not confirmed.")
			).toBeTruthy();
		});
		expect(postThreadSignalMock.mock.calls[1]?.[0]).toEqual(
			postThreadSignalMock.mock.calls[0]?.[0]
		);
		expect(
			within(threadPanel).queryByRole("group", { name: "Files to send" })
		).toBeNull();
		expect((sendButton as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(sendButton);
		expect(postThreadSignalMock).toHaveBeenCalledTimes(2);
		expect(publishComposerUploadMock).toHaveBeenCalledTimes(1);
	});

	it("records thread Wake diagnostics without rendering the old composer strip", async () => {
		const postThreadSignalMock = vi.fn().mockResolvedValue({
			placement: {
				threadId: "thread-1",
				signalId: "sig-thread-wake",
				placement: "thread",
				createdAt: "2026-04-11T00:00:00.000Z",
			},
			signal: createTextSignal({
				id: "sig-thread-wake",
				messageEnvelope: {
					activationTargets: [DEFAULT_AGENT_PROFILE_ID],
					referenceTargets: [],
					text: "@runner(wake) keep going",
				},
				text: "@runner(wake) keep going",
			}),
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: vi.fn().mockResolvedValue({
				items: [],
				query: {
					clientMessageId: "client-message-1",
					spaceId: "space-123",
					targetProfileId: null,
				},
			}),
			leaveSpace: vi.fn(),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
			postThreadSignal: postThreadSignalMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-agent-answer",
							profile: {
								kind: "agent",
								profileId: DEFAULT_AGENT_PROFILE_ID,
								profileName: "Runner",
							},
							text: "I found the issue.",
						}),
					],
					nextCursor: null,
				},
			}),
			threadSignals: createQueryResult({
				isSuccess: true,
				data: {
					signals: [
						createTextSignal({
							id: "sig-agent-answer",
							profile: {
								kind: "agent",
								profileId: DEFAULT_AGENT_PROFILE_ID,
								profileName: "Runner",
							},
							text: "I found the issue.",
						}),
					],
				},
			}),
			threads: createQueryResult({
				isSuccess: true,
				data: {
					threads: [
						{
							threadId: "thread-1",
							spaceId: "space-123",
							rootSignalId: "sig-agent-answer",
							createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
							createdAt: "2026-04-11T00:00:00.000Z",
							updatedAt: "2026-04-11T00:00:00.000Z",
						},
					],
				},
			}),
		});

		renderSpaceLanding();

		const rootMessage = screen
			.getByText("I found the issue.")
			.closest("[data-message-row-id]");
		expect(rootMessage).not.toBeNull();
		fireEvent.mouseEnter(rootMessage as HTMLElement);
		fireEvent.click(
			within(rootMessage as HTMLElement).getAllByRole("button", {
				name: "Open thread",
			})[0] as HTMLElement
		);
		const threadComposer = screen.getByRole("textbox", {
			name: "Reply in thread",
		});
		await insertComposerMember(
			RUNNER_OPTION_NAME,
			"",
			screen.getByLabelText("Thread")
		);
		await appendComposerText(
			threadComposer,
			"keep going",
			"@Runner keep going"
		);
		fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

		await waitFor(() => {
			expect(postThreadSignalMock).toHaveBeenCalledWith({
				body: expect.objectContaining({
					clientMessageId: expect.any(String),
					authorHasRead: true,
					messageEnvelope: expect.objectContaining({
						activationTargets: [DEFAULT_AGENT_PROFILE_ID],
					}),
					text: "@Runner keep going",
				}),
				spaceId: "space-123",
				threadId: "thread-1",
				timeoutMs: 30_000,
			});
		});
		expect(screen.queryByText("Wake request sent to @runner.")).toBeNull();
		expect(
			JSON.parse(
				window.localStorage.getItem("openmeld.space.last-wake-diagnostic") ??
					"{}"
			)
		).toMatchObject({
			clientMessageId: expect.any(String),
			sourceSignalId: "sig-thread-wake",
			spaceId: "space-123",
			targetProfileIds: [DEFAULT_AGENT_PROFILE_ID],
			threadId: "thread-1",
		});
	});

	it("does not show a send-failure banner when a thread reply posted but a follow-up step failed", async () => {
		const postThreadSignalMock = vi.fn().mockResolvedValue({
			placement: {
				threadId: "thread-1",
				signalId: "sig-thread-wake",
				placement: "thread",
				createdAt: "2026-04-11T00:00:00.000Z",
			},
			signal: createTextSignal({
				id: "sig-thread-wake",
				messageEnvelope: {
					activationTargets: [DEFAULT_AGENT_PROFILE_ID],
					referenceTargets: [],
					text: "@runner(wake) keep going",
				},
				text: "@runner(wake) keep going",
			}),
		});
		createWebSpaceApiMock.mockReturnValue({
			getUpdates: vi.fn().mockResolvedValue({
				signals: [],
			}),
			getWakeProgress: vi.fn().mockResolvedValue({
				items: [],
				query: {
					clientMessageId: "client-message-1",
					spaceId: "space-123",
					targetProfileId: null,
				},
			}),
			leaveSpace: vi.fn(),
			listSignalEnvelopes: vi.fn(),
			postNormalMessage: vi.fn(),
			postThreadSignal: postThreadSignalMock,
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-agent-answer",
							profile: {
								kind: "agent",
								profileId: DEFAULT_AGENT_PROFILE_ID,
								profileName: "Runner",
							},
							text: "I found the issue.",
						}),
					],
					nextCursor: null,
				},
			}),
			threadSignals: createQueryResult({
				isSuccess: true,
				data: {
					signals: [
						createTextSignal({
							id: "sig-agent-answer",
							profile: {
								kind: "agent",
								profileId: DEFAULT_AGENT_PROFILE_ID,
								profileName: "Runner",
							},
							text: "I found the issue.",
						}),
					],
				},
			}),
			threads: createQueryResult({
				isSuccess: true,
				data: {
					threads: [
						{
							threadId: "thread-1",
							spaceId: "space-123",
							rootSignalId: "sig-agent-answer",
							createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
							createdAt: "2026-04-11T00:00:00.000Z",
							updatedAt: "2026-04-11T00:00:00.000Z",
						},
					],
				},
			}),
		});

		renderSpaceLanding();

		const rootMessage = screen
			.getByText("I found the issue.")
			.closest("[data-message-row-id]");
		expect(rootMessage).not.toBeNull();
		fireEvent.mouseEnter(rootMessage as HTMLElement);
		fireEvent.click(
			within(rootMessage as HTMLElement).getAllByRole("button", {
				name: "Open thread",
			})[0] as HTMLElement
		);
		const threadComposer = screen.getByRole("textbox", {
			name: "Reply in thread",
		});

		// Install the storage failure only after the thread panel settles, so
		// this reproduces the real trigger (mention-recency bookkeeping hitting
		// a full/blocked localStorage in `recordSuccessfulSubmission`, which
		// runs strictly after the reply already posted) without touching
		// unrelated storage reads/writes made while the thread opens.
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const storageSetItemSpy = vi
			.spyOn(Storage.prototype, "setItem")
			.mockImplementation(() => {
				throw new DOMException(
					"The quota has been exceeded.",
					"QuotaExceededError"
				);
			});

		await setComposerValue(threadComposer, "@runner(wake) keep going");
		fireEvent.click(screen.getByRole("button", { name: "Send reply" }));

		await waitFor(() => {
			expect(postThreadSignalMock).toHaveBeenCalled();
		});
		await waitFor(() => {
			expect(consoleErrorSpy).toHaveBeenCalled();
		});
		expect(readComposerValue(threadComposer)).toBe("");
		expect(screen.queryByText("The quota has been exceeded.")).toBeNull();

		storageSetItemSpy.mockRestore();
	});

	it("lazy-loads earlier history when the conversation scroll reaches the top", async () => {
		const listSignalEnvelopesMock = vi.fn().mockResolvedValue({
			envelopes: [
				createTextSignal({
					id: "sig-0",
					ts: 5,
					text: "Earlier message",
				}),
				createTextSignal({
					id: "sig-1",
					ts: 10,
					text: "Current first message",
				}),
			],
			nextCursor: null,
		});
		createWebSpaceApiMock.mockReturnValue({
			listSignalEnvelopes: listSignalEnvelopesMock,
			postNormalMessage: vi.fn(),
		});
		mockSpaceQueries({
			status: createQueryResult({
				isSuccess: true,
				data: createSpaceStatus(),
			}),
			members: createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
			history: createQueryResult({
				isSuccess: true,
				data: {
					envelopes: [
						createTextSignal({
							id: "sig-1",
							ts: 10,
							text: "Current first message",
						}),
						createTextSignal({
							id: "sig-2",
							ts: 20,
							text: "Latest message",
						}),
					],
					nextCursor: null,
				},
			}),
		});

		renderSpaceLanding();

		expect(
			screen.queryByRole("button", { name: "Show Earlier Messages" })
		).toBeNull();

		const conversationHistory = screen.getByRole("log", {
			name: "Conversation history",
		});
		setElementScrollMetrics(conversationHistory, {
			clientHeight: 320,
			scrollHeight: 960,
			scrollTop: 0,
		});

		fireEvent.scroll(conversationHistory);

		await waitFor(() => {
			expect(createWebSpaceApiMock).toHaveBeenCalledWith({
				openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
			});
			expect(listSignalEnvelopesMock).toHaveBeenCalledWith({
				spaceId: "space-123",
				query: {
					aroundSignalId: "sig-1",
					beforeCount: 20,
					afterCount: 0,
					kinds: ["text", "status", "system_notice"],
				},
			});
			expect(screen.getByText("Earlier message")).toBeTruthy();
		});
	});
});

async function openHistoricalWakeFailure(input: {
	postNormalMessageMock?: ReturnType<typeof vi.fn>;
	postThreadSignalMock?: ReturnType<typeof vi.fn>;
	stageComposerUploadMock: ReturnType<typeof vi.fn>;
	thread: boolean;
}) {
	const sourceText = "@Runner check the release build";
	const sourceSignal = createTextSignal({
		id: "sig-blocked-retry-source",
		messageEnvelope: {
			activationTargets: [DEFAULT_AGENT_PROFILE_ID],
			referenceTargets: [],
			text: sourceText,
		},
		meta: { clientMessageId: "client-message-original" },
		text: sourceText,
	});
	const failureSignal = createTerminalFailureNoticeSignal({
		actorProfileId: DEFAULT_AGENT_PROFILE_ID,
		dispatchId: null,
		failureStage: "execution",
		id: "sig-blocked-retry-failure",
		replyToSignalId: sourceSignal.id,
		text: "Runner could not complete this Wake.",
	});
	createWebSpaceApiMock.mockReturnValue({
		getUpdates: vi.fn().mockResolvedValue({ signals: [] }),
		getWakeProgress: vi.fn().mockResolvedValue({
			items: [],
			query: {
				clientMessageId: "client-message-original",
				spaceId: "space-123",
				targetProfileId: null,
			},
		}),
		postNormalMessage: input.postNormalMessageMock ?? vi.fn(),
		postThreadSignal: input.postThreadSignalMock ?? vi.fn(),
		stageComposerUpload: input.stageComposerUploadMock,
	});
	mockSpaceQueries({
		status: createQueryResult({
			isSuccess: true,
			data: createSpaceStatus(),
		}),
		members: createQueryResult({
			isSuccess: true,
			data: createMembersSnapshot(),
		}),
		history: createQueryResult({
			isSuccess: true,
			data: {
				envelopes: input.thread
					? [sourceSignal]
					: [sourceSignal, failureSignal],
				nextCursor: null,
			},
		}),
		...(input.thread
			? {
					threadSignals: createQueryResult({
						isSuccess: true,
						data: { signals: [sourceSignal, failureSignal] },
					}),
					threads: createQueryResult({
						isSuccess: true,
						data: {
							threads: [
								{
									createdAt: "2026-04-11T00:00:00.000Z",
									createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
									rootSignalId: sourceSignal.id,
									spaceId: "space-123",
									threadId: "thread-1",
									updatedAt: "2026-04-11T00:00:00.000Z",
								},
							],
						},
					}),
				}
			: {
					messageDetailsBySignalId: {
						[sourceSignal.id]: createMessageDetailsQueryResult({
							signalId: sourceSignal.id,
						}),
					},
				}),
	});

	renderSpaceLanding();

	let sourceRow: Element | null;
	if (input.thread) {
		const rootMessage = document.querySelector(
			`[data-message-row-id="${sourceSignal.id}"]`
		);
		if (!rootMessage) {
			throw new Error("Expected the failed Wake source message.");
		}
		fireEvent.mouseEnter(rootMessage as HTMLElement);
		fireEvent.click(
			within(rootMessage as HTMLElement).getAllByRole("button", {
				name: "Open thread",
			})[0] as HTMLElement
		);
		const threadPanel = screen.getByLabelText("Thread");
		sourceRow =
			threadPanel
				.querySelector(`[data-signal-id="${sourceSignal.id}"]`)
				?.closest("[data-message-row-id]") ?? null;
	} else {
		sourceRow =
			document
				.querySelector(`[data-signal-id="${sourceSignal.id}"]`)
				?.closest("[data-message-row-id]") ?? null;
	}
	if (!sourceRow) {
		throw new Error("Expected the failed Wake source message row.");
	}
	fireEvent.click(
		within(sourceRow as HTMLElement).getByRole("button", {
			name: MESSAGE_DETAILS_ACTION_NAME_PATTERN,
		})
	);
	return await screen.findByRole("dialog", { name: "Message details" });
}

async function openAgentDirectMessageThreadProgrammaticSend(input: {
	membersQueryResult?: ReturnType<typeof createQueryResult>;
	postThreadSignalMock: ReturnType<typeof vi.fn>;
	stageComposerUploadMock: ReturnType<typeof vi.fn>;
}) {
	const rootSignal = createTextSignal({
		id: "sig-agent-dm-thread-root",
		text: "Start an Agent Direct Message thread",
	});
	createWebSpaceApiMock.mockReturnValue({
		getUpdates: vi.fn().mockResolvedValue({ signals: [] }),
		getWakeProgress: vi.fn().mockResolvedValue({
			items: [],
			query: {
				clientMessageId: "client-message-1",
				spaceId: "space-123",
				targetProfileId: null,
			},
		}),
		postNormalMessage: vi.fn(),
		postThreadSignal: input.postThreadSignalMock,
		stageComposerUpload: input.stageComposerUploadMock,
	});
	mockSpaceQueries({
		status: createQueryResult({
			isSuccess: true,
			data: {
				...createSpaceStatus(),
				spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
			},
		}),
		members:
			input.membersQueryResult ??
			createQueryResult({
				isSuccess: true,
				data: createMembersSnapshot(),
			}),
		history: createQueryResult({
			isSuccess: true,
			data: { envelopes: [rootSignal], nextCursor: null },
		}),
		threadSignals: createQueryResult({
			isSuccess: true,
			data: { signals: [rootSignal] },
		}),
		threads: createQueryResult({
			isSuccess: true,
			data: {
				threads: [
					{
						createdAt: "2026-04-11T00:00:00.000Z",
						createdByProfileId: DEFAULT_SPACE_PROFILE_ID,
						rootSignalId: rootSignal.id,
						spaceId: "space-123",
						threadId: "thread-1",
						updatedAt: "2026-04-11T00:00:00.000Z",
					},
				],
			},
		}),
	});

	renderSpaceLanding();
	const rootMessage = document.querySelector(
		`[data-message-row-id="${rootSignal.id}"]`
	);
	if (!rootMessage) {
		throw new Error("Expected the Agent Direct Message thread root.");
	}
	fireEvent.mouseEnter(rootMessage as HTMLElement);
	fireEvent.click(
		within(rootMessage as HTMLElement).getAllByRole("button", {
			name: "Open thread",
		})[0] as HTMLElement
	);
	return await screen.findByRole("button", {
		name: "Send programmatic thread text",
	});
}

function expectSpaceAgentAvailabilityIndicator(
	scope: HTMLElement,
	input: { isRefreshing?: boolean; label: string; tooltip?: string }
) {
	const indicators = within(scope).getAllByTestId(
		"space-agent-availability-indicator"
	);
	const indicator = indicators.find((candidate) => {
		const labelMatches = candidate.getAttribute("aria-label") === input.label;
		const tooltipMatches =
			input.tooltip === undefined ||
			candidate.getAttribute("aria-description") === input.tooltip;
		return labelMatches && tooltipMatches;
	});
	if (!indicator) {
		const actual = indicators.map((candidate) => ({
			label: candidate.getAttribute("aria-label"),
			tooltip: candidate.getAttribute("aria-description"),
		}));
		throw new Error(
			`Expected space agent availability indicator ${input.label}; received ${JSON.stringify(actual)}`
		);
	}
	const indicatorClassName = indicator.className;
	if (
		!(
			indicatorClassName.includes("inline-flex") &&
			indicatorClassName.includes("items-center") &&
			indicatorClassName.includes("shrink-0")
		)
	) {
		throw new Error(
			"Expected space agent availability indicator to render inline"
		);
	}
	if (
		indicatorClassName.includes("w-[7.25rem]") ||
		indicatorClassName.includes("min-w-[7.25rem]") ||
		indicatorClassName.includes("max-w-[7.25rem]")
	) {
		throw new Error(
			"Expected space agent availability indicator not to use fixed width"
		);
	}
	if (input.tooltip !== undefined) {
		const actualTooltip = indicator.getAttribute("aria-description");
		if (actualTooltip !== input.tooltip) {
			throw new Error(
				`Expected space agent availability tooltip ${input.tooltip}, got ${actualTooltip}`
			);
		}
	}
	if (input.isRefreshing) {
		if (indicator.getAttribute("data-refreshing") !== "true") {
			throw new Error(
				"Expected a refreshing space agent availability indicator"
			);
		}
	} else if (
		input.isRefreshing === false &&
		indicator.getAttribute("data-refreshing") !== null
	) {
		throw new Error(
			"Expected a non-refreshing space agent availability indicator"
		);
	}
	return indicator;
}

function expectNoSpaceAgentAvailabilityIndicator(
	scope: HTMLElement,
	input: { label: string; tooltip?: string }
) {
	const indicators = within(scope).queryAllByTestId(
		"space-agent-availability-indicator"
	);
	const indicator = indicators.find((candidate) => {
		const labelMatches = candidate.getAttribute("aria-label") === input.label;
		const tooltipMatches =
			input.tooltip === undefined ||
			candidate.getAttribute("aria-description") === input.tooltip;
		return labelMatches && tooltipMatches;
	});
	if (indicator) {
		throw new Error(
			`Expected no space agent availability indicator ${input.label}`
		);
	}
}

function withDefaultAgentAgentWakeAvailability(
	snapshot: SpaceMembersSnapshot,
	agentWakeAvailability: SpaceMemberAgentAgentWakeAvailability
): SpaceMembersSnapshot {
	const [defaultAgent, ...remainingAgents] = snapshot.agents;
	if (!defaultAgent) {
		throw new Error("Expected default agent in members snapshot");
	}
	return {
		...snapshot,
		agents: [{ ...defaultAgent, agentWakeAvailability }, ...remainingAgents],
	};
}

function createTestAgentAgentWakeAvailability(
	status: "available_for_wake" | "checking_connection" | "unavailable_for_wake"
): SpaceMemberAgentAgentWakeAvailability {
	if (status === "available_for_wake") {
		return {
			action: "none",
			badgeLabel: "Available",
			category: "available",
			isRefreshing: false,
			label: "Available for Wake",
			phase: "available",
			reasonCode: "agent_execution.ready",
			status,
			summary: "This agent can receive Wake requests.",
			tooltip: "Available for Wake",
		};
	}
	if (status === "checking_connection") {
		return {
			action: "check_status",
			badgeLabel: "Checking",
			category: "checking",
			isRefreshing: true,
			label: "Checking connection",
			phase: "checking_status",
			reasonCode: "agent_execution.check_status",
			status,
			summary: "Checking whether this agent can reply.",
			tooltip: "Checking Wake availability",
		};
	}
	return {
		action: "reconnect_binding",
		badgeLabel: "Connect",
		category: "unavailable",
		isRefreshing: false,
		label: "Connect local agent",
		phase: "connect_local_agent",
		reasonCode: "agent_profile_binding.missing",
		status,
		summary: "Connect a local agent before this profile can reply.",
		tooltip: "Connect local agent",
	};
}

function setElementScrollMetrics(
	element: HTMLElement,
	input: {
		clientHeight: number;
		scrollHeight: number;
		scrollTop: number;
	}
) {
	Object.defineProperties(element, {
		clientHeight: {
			configurable: true,
			value: input.clientHeight,
		},
		scrollHeight: {
			configurable: true,
			value: input.scrollHeight,
		},
		scrollTop: {
			configurable: true,
			value: input.scrollTop,
			writable: true,
		},
	});
}

function createTestDomRect(input: {
	bottom: number;
	height: number;
	top: number;
}): DOMRect {
	return {
		bottom: input.bottom,
		height: input.height,
		left: 0,
		right: 0,
		top: input.top,
		width: 0,
		x: 0,
		y: input.top,
		toJSON: () => ({}),
	};
}

function mockSpaceQueries(input: {
	profileId?: string;
	spaceIds?: readonly string[];
	bootstrap?: Record<string, unknown>;
	displaySnapshot?: Record<string, unknown>;
	activeAgentStreams?: readonly SpaceAgentStreamSnapshot[];
	activeWakeProgressSummary?: Record<string, unknown>;
	centerAgentProfileId?: string | null;
	status: Record<string, unknown>;
	members: Record<string, unknown>;
	history: Record<string, unknown>;
	organizationDirectory?: OrganizationSpaceProfileCandidates;
	organizationDirectoryQuery?: Record<string, unknown>;
	organizationDirectoryResponse?: OrganizationDirectoryResponse;
	messageDetailsBySignalId?: Record<string, Record<string, unknown>>;
	threads?: Record<string, unknown>;
	threadSignals?: Record<string, unknown>;
	wakeTraceWaterfall?: Record<string, unknown>;
}) {
	const profileId = input.profileId ?? DEFAULT_SPACE_PROFILE_ID;
	const spaceIds = new Set(input.spaceIds ?? ["space-123"]);
	const threads =
		input.threads ??
		createQueryResult({
			isSuccess: true,
			data: {
				threads: [],
				previews: [],
			},
		});
	const bootstrap =
		input.bootstrap ??
		createSpaceBootstrapQueryResult({
			activeAgentStreams: input.activeAgentStreams,
			history: input.history,
			members: input.members,
			status: input.status,
			threads,
		});
	const threadSignals =
		input.threadSignals ??
		createQueryResult({
			isSuccess: true,
			data: {
				signals: [],
			},
		});
	useQueryMock.mockImplementation(
		(options: {
			enabled?: boolean;
			queryKey: readonly unknown[];
			select?: unknown;
		}) => {
			const queryKey = JSON.stringify(options.queryKey);
			if (options.queryKey[0] === "pending-permission-mode-suggestions") {
				return createQueryResult({
					isSuccess: true,
					data: listPermissionModeSuggestionsResponseSchema.parse({
						suggestions: [],
					}),
				});
			}
			if (
				options.queryKey[0] === "member-agents" &&
				options.queryKey.length === 2
			) {
				return createQueryResult({
					isSuccess: true,
					data: listMemberAgentsResponseSchema.parse({
						ok: true,
						organizationId: "org-acme",
						memberAgents: [],
						unassignedProfiles: [],
					}),
				});
			}
			if (
				options.queryKey[0] === "agent-access" &&
				(options.queryKey[2] === "list" ||
					options.queryKey[2] === "viewer-grants")
			) {
				return createQueryResult({ isSuccess: true, data: [] });
			}
			if (
				options.queryKey[0] === "pending-plugin-action-requests" ||
				options.queryKey[0] === "message-plugin-action-requests"
			) {
				return createQueryResult({
					isSuccess: true,
					data: listPluginActionRequestsResponseSchema.parse({ requests: [] }),
				});
			}
			if (options.queryKey[0] === "space-tasks") {
				return createQueryResult({ isPending: true });
			}
			if (
				options.enabled === false &&
				options.queryKey[0] === "spaces" &&
				options.queryKey[2] === ""
			) {
				return createQueryResult({ isPending: true });
			}
			if (
				options.queryKey[0] === "space-invitations" &&
				spaceIds.has(String(options.queryKey[3]))
			) {
				return createQueryResult({ isSuccess: true, data: [] });
			}
			const querySpaceId = options.queryKey[2];
			const isExpectedSpace =
				typeof querySpaceId === "string" && spaceIds.has(querySpaceId);
			const modelCatalogResult = resolveModelCatalogQueryResult(
				options.queryKey
			);
			if (modelCatalogResult) {
				return modelCatalogResult;
			}
			const centerAgentDirectMessageProjectionResult =
				resolveCenterAgentDirectMessageProjectionQueryResult(options.queryKey);
			if (centerAgentDirectMessageProjectionResult) {
				return centerAgentDirectMessageProjectionResult;
			}
			const centerAgentDesignationResult =
				resolveCenterAgentDesignationQueryResult(
					options.queryKey,
					input.centerAgentProfileId ?? null
				);
			if (centerAgentDesignationResult) {
				return centerAgentDesignationResult;
			}
			const organizationRoleResult = resolveOrganizationRoleQueryResult(
				options.queryKey
			);
			if (organizationRoleResult) {
				return organizationRoleResult;
			}
			const organizationSpacesResult = resolveOrganizationSpacesQueryResult(
				options.queryKey
			);
			if (organizationSpacesResult) {
				return organizationSpacesResult;
			}
			const spaceInboxUnreadTargetsResult =
				resolveSpaceInboxUnreadTargetsQueryResult(options.queryKey);
			if (spaceInboxUnreadTargetsResult) {
				return spaceInboxUnreadTargetsResult;
			}
			if (
				isExpectedSpace &&
				options.queryKey[0] === "spaces" &&
				options.queryKey[1] === "display-snapshot" &&
				options.queryKey[3] === profileId
			) {
				return (
					input.displaySnapshot ??
					createQueryResult({
						isSuccess: true,
						data: undefined,
					})
				);
			}
			if (
				isExpectedSpace &&
				options.queryKey[0] === "spaces" &&
				options.queryKey[1] === "bootstrap" &&
				options.queryKey[3] === profileId
			) {
				return bootstrap;
			}
			if (
				isExpectedSpace &&
				options.queryKey[0] === "spaces" &&
				options.queryKey[1] === "active-wake-progress-summary" &&
				options.queryKey[3] === profileId
			) {
				if (input.activeWakeProgressSummary) {
					return input.activeWakeProgressSummary;
				}
				return createQueryResult({
					isSuccess: true,
					data: {
						items: [],
						presentationEpoch: wakeProgressFixture.presentationEpoch,
						query: {
							spaceId: querySpaceId,
							targetProfileId: null,
						},
					},
				});
			}
			if (
				isExpectedSpace &&
				options.queryKey[0] === "spaces" &&
				options.queryKey[1] === "status" &&
				options.queryKey[3] === profileId
			) {
				return input.status;
			}
			if (
				isExpectedSpace &&
				options.queryKey[0] === "spaces" &&
				options.queryKey[1] === "members" &&
				options.queryKey[3] === profileId
			) {
				return input.members;
			}
			if (
				isExpectedSpace &&
				options.queryKey[0] === "spaces" &&
				options.queryKey[1] === "history" &&
				options.queryKey[3] === profileId
			) {
				return input.history;
			}
			if (
				Array.isArray(options.queryKey) &&
				options.queryKey[0] === "spaces" &&
				options.queryKey[1] === "message-details" &&
				isExpectedSpace &&
				options.queryKey[4] === profileId
			) {
				const signalId = String(options.queryKey[3] ?? "");
				return (
					input.messageDetailsBySignalId?.[signalId] ??
					createMessageDetailsQueryResult({
						signalId,
					})
				);
			}
			if (
				Array.isArray(options.queryKey) &&
				options.queryKey[0] === "spaces" &&
				options.queryKey[1] === "wake-trace-waterfall" &&
				isExpectedSpace &&
				options.queryKey[6] === profileId
			) {
				return (
					input.wakeTraceWaterfall ??
					createQueryResult({
						isSuccess: true,
						data: {
							items: [],
							query: {
								clientMessageId:
									options.queryKey[3] === "client_message"
										? options.queryKey[4]
										: null,
								sourceSignalId:
									options.queryKey[3] === "source_signal"
										? options.queryKey[4]
										: null,
								spaceId: querySpaceId,
								targetProfileId: options.queryKey[5],
							},
						},
					})
				);
			}
			if (
				isExpectedSpace &&
				options.queryKey[0] === "spaces" &&
				options.queryKey[1] === "threads" &&
				options.queryKey[3] === profileId
			) {
				return threads;
			}
			if (
				Array.isArray(options.queryKey) &&
				options.queryKey[0] === "spaces" &&
				options.queryKey[1] === "thread-signals" &&
				isExpectedSpace &&
				options.queryKey[4] === profileId
			) {
				return threadSignals;
			}
			if (
				options.queryKey[0] === "inbox" &&
				options.queryKey[2] === "space-unread-targets" &&
				typeof options.queryKey[3] === "string" &&
				spaceIds.has(options.queryKey[3])
			) {
				return createQueryResult({
					isSuccess: true,
					data: { targets: [], totalUnreadCount: 0 },
				});
			}
			if (
				Array.isArray(options.queryKey) &&
				options.queryKey[0] === "spaces" &&
				options.queryKey[1] === "account-spaces"
			) {
				return createQueryResult({
					isSuccess: true,
					data: createAccountSpaceSections(),
				});
			}
			if (
				Array.isArray(options.queryKey) &&
				options.queryKey[0] === "user" &&
				options.queryKey[1] === "session"
			) {
				// Auth session, read by the Get-set-up onboarding banner. A signed-in
				// session lets the plan reach the connect_this_computer decision.
				return createQueryResult({
					isSuccess: true,
					data: { user: { id: "user-1", name: "Mira" } },
				});
			}
			if (
				Array.isArray(options.queryKey) &&
				options.queryKey[0] === "start" &&
				options.queryKey[1] === "profile-capabilities"
			) {
				return createQueryResult({
					isSuccess: true,
					data: {
						additionalHumanProfileCreationEnabled: false,
						ok: true,
					},
				});
			}
			if (
				Array.isArray(options.queryKey) &&
				options.queryKey[0] === "start" &&
				options.queryKey[1] === "profiles"
			) {
				return createQueryResult({
					isSuccess: true,
					data: [
						createLandingAccountProfile({
							openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
							ownerUserId: "user-mira",
							profileKind: "human",
							profileName: "Mira",
						}),
					],
				});
			}
			if (
				Array.isArray(options.queryKey) &&
				options.queryKey[0] === "start" &&
				options.queryKey[1] === "human-profiles"
			) {
				return createQueryResult({
					isSuccess: true,
					data: [
						createLandingAccountProfile({
							openMeldProfileId: DEFAULT_SPACE_PROFILE_ID,
							ownerUserId: "user-mira",
							profileKind: "human",
							profileName: "Mira",
						}),
					],
				});
			}
			if (
				Array.isArray(options.queryKey) &&
				options.queryKey[0] === "organizations" &&
				options.queryKey[2] === "computers"
			) {
				return createQueryResult({
					isSuccess: true,
					data: {
						computers: [],
						generatedAt: "2026-07-16T00:00:00.000Z",
						organizationId: "org-acme",
					},
				});
			}
			if (
				Array.isArray(options.queryKey) &&
				options.queryKey[0] === "organizations" &&
				(options.queryKey[2] === "directory" ||
					options.queryKey[2] === "profile-directory")
			) {
				if (!options.select && input.organizationDirectoryResponse) {
					return createQueryResult({
						isSuccess: true,
						data: input.organizationDirectoryResponse,
					});
				}
				return (
					input.organizationDirectoryQuery ??
					createQueryResult({
						isSuccess: true,
						data: input.organizationDirectory ?? {
							agentProfiles: [],
							generatedAt: "2026-07-16T00:00:00.000Z",
							members: [],
							organizationId: "org-acme",
						},
					})
				);
			}
			if (
				Array.isArray(options.queryKey) &&
				options.queryKey[0] === "agent-profile" &&
				options.queryKey[1] === "creation-defaults"
			) {
				const organizationId = String(options.queryKey[2] ?? "");
				const agentControllerRef = String(options.queryKey[3] ?? "");
				return createQueryResult({
					isSuccess: Boolean(agentControllerRef),
					data: agentControllerRef
						? {
								agentControllerPermissionMode: null,
								agentControllerRef,
								defaultProjectId: null,
								modelId: null,
								openCodePermission: null,
								organizationId,
								reasoningLevel: null,
								updatedAt: null,
								userId: "user-mira",
							}
						: undefined,
				});
			}
			if (
				Array.isArray(options.queryKey) &&
				options.queryKey[0] === "agent-activity" &&
				options.queryKey[2] === "sessions"
			) {
				return createQueryResult({
					isSuccess: true,
					data: {
						asOfMs: 1_773_792_000_000,
						coverage: [],
						nextCursor: null,
						organization: { id: "org-acme", name: "Acme" },
						sessions: [],
					},
				});
			}
			if (
				Array.isArray(options.queryKey) &&
				options.queryKey[0] === "projects"
			) {
				// CreateProfileDialog now loads active Projects so a new agent can choose
				// its Default Project. This scenario has no Projects to select.
				return createQueryResult({
					isSuccess: true,
					data: { organizationId: "org-acme", projects: [] },
				});
			}
			if (
				Array.isArray(options.queryKey) &&
				options.queryKey[0] === "start" &&
				options.queryKey[1] === "current-local-runtime-reply-readiness"
			) {
				if (options.enabled !== false) {
					throw new Error(
						"This fixture does not fetch readiness for a different computer."
					);
				}
				return createQueryResult({ isPending: true });
			}
			if (
				options.queryKey[0] === "organizations" &&
				options.queryKey[2] === "agent-runtime-overview"
			) {
				return createQueryResult({
					isSuccess: true,
					data: {
						organizationId: "org-acme",
						generatedAt: "2026-07-16T00:00:00.000Z",
						agentProfiles: [],
					} satisfies OrganizationAgentRuntimeOverviewResponse,
				});
			}
			if (options.queryKey[0] === "account-sidebar") {
				return createQueryResult({
					isSuccess: true,
					data: {
						revision: 0,
						preferences: {
							pinned: { sort: "manual", spaceIds: [] },
							spaces: { sort: "recent", spaceIds: [] },
							groups: [],
						},
					} satisfies AccountSidebarSnapshot,
				});
			}
			if (options.queryKey[0] === "space-tasks") {
				return createQueryResult({
					isSuccess: true,
					data: {
						tasks: [],
						truncated: false,
					} satisfies ListSpaceTasksResponse,
				});
			}
			if (
				options.queryKey[0] === "space-files" &&
				options.queryKey[2] === "folder"
			) {
				return createQueryResult({
					isSuccess: true,
					data: {
						spaceId: "space-123",
						parentId: null,
						view: "active",
						origin: "all",
						breadcrumbs: [],
						entries: [],
						capabilities: { canRead: true, canWrite: true },
					} satisfies ListSpaceFilesResponse,
				});
			}
			if (options.enabled === false) {
				return createQueryResult({ isPending: true });
			}
			throw new Error(`Unexpected query key: ${queryKey}`);
		}
	);
}

async function setComposerValue(
	composerElement: HTMLElement,
	value: string,
	selectionStart = value.length,
	selectionEnd = selectionStart
) {
	if (composerElement instanceof HTMLTextAreaElement) {
		fireEvent.change(composerElement, {
			target: {
				selectionEnd,
				selectionStart,
				value,
			},
		});
		composerElement.setSelectionRange(selectionStart, selectionEnd);
		fireEvent.select(composerElement);
		return;
	}

	if (selectionStart !== value.length || selectionEnd !== selectionStart) {
		throw new Error(
			"Structured Composer tests must select inline content through the visible editor controls."
		);
	}
	fireEvent.focus(composerElement);
	const range = document.createRange();
	range.selectNodeContents(composerElement);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);
	document.dispatchEvent(new Event("selectionchange"));
	fireEvent.paste(composerElement, {
		clipboardData: {
			files: [],
			getData: () => value,
			items: [],
		},
	});
	await waitFor(() => {
		expect(readComposerValue(composerElement)).toBe(value);
	});
	await flushReactEffects();
}

async function openComposerMemberPicker(
	filter = "",
	scope?: HTMLElement
): Promise<HTMLElement> {
	const surface = scope ? within(scope) : screen;
	fireEvent.click(surface.getByRole("button", { name: "Mention a member" }));
	const search = await screen.findByRole("combobox", {
		name: "Find a member to mention",
	});
	if (filter) {
		fireEvent.change(search, { target: { value: filter } });
	}
	return await screen.findByRole("listbox", { name: "Member options" });
}

async function insertComposerMember(
	optionName: RegExp,
	filter = "",
	scope?: HTMLElement
): Promise<void> {
	await openComposerMemberPicker(filter, scope);
	const option = within(
		screen.getByRole("listbox", { name: "Member options" })
	).getByRole("option", { name: optionName });
	fireEvent.mouseDown(option);
	fireEvent.click(option);
	await waitFor(() => {
		expect(
			screen.queryByRole("combobox", { name: "Find a member to mention" })
		).toBeNull();
	});
}

async function appendComposerText(
	composerElement: HTMLElement,
	text: string,
	expectedValue: string
): Promise<void> {
	fireEvent.paste(composerElement, {
		clipboardData: {
			files: [],
			getData: () => text,
			items: [],
		},
	});
	await waitFor(() => {
		expect(readComposerValue(composerElement)).toBe(expectedValue);
	});
}

function readComposerValue(composerElement: HTMLElement): string {
	if (composerElement instanceof HTMLTextAreaElement) {
		return composerElement.value;
	}

	const clone = composerElement.cloneNode(true) as HTMLElement;
	for (const node of clone.querySelectorAll("[data-slate-placeholder]")) {
		node.remove();
	}
	for (const node of clone.querySelectorAll("[data-slate-zero-width]")) {
		node.textContent = "";
	}
	for (const node of clone.querySelectorAll<HTMLElement>(
		"[data-mention-text]"
	)) {
		node.replaceWith(node.dataset.mentionText ?? "");
	}
	for (const node of clone.querySelectorAll<HTMLInputElement>(
		'input[role="combobox"]'
	)) {
		node.replaceWith(node.value);
	}
	return Array.from(clone.children)
		.map((block) => block.textContent ?? "")
		.join("\n");
}

function createSpaceBootstrapQueryResult(input: {
	activeAgentStreams?: readonly SpaceAgentStreamSnapshot[];
	dataUpdatedAt?: number;
	status: Record<string, unknown>;
	members: Record<string, unknown>;
	history: Record<string, unknown>;
	threads: Record<string, unknown>;
}) {
	const status = input.status.data;
	const members = input.members.data;
	const history = input.history.data;
	if (!(status && members && history)) {
		return createQueryResult({
			error:
				input.status.error ??
				input.members.error ??
				input.history.error ??
				new Error("Space bootstrap test fixture is missing data."),
			isError: true,
		});
	}
	return createQueryResult({
		dataUpdatedAt: input.dataUpdatedAt ?? Date.now(),
		isSuccess: true,
		data: {
			...(input.activeAgentStreams === undefined
				? {}
				: { activeAgentStreams: input.activeAgentStreams }),
			status,
			members,
			history,
			threads: normalizeSpaceBootstrapThreads(input.threads.data),
		},
	});
}

function normalizeSpaceBootstrapThreads(value: unknown) {
	if (!value || typeof value !== "object") {
		return {
			threads: [],
			previews: [],
		};
	}
	const snapshot = value as Record<string, unknown>;
	return {
		...snapshot,
		threads: Array.isArray(snapshot.threads) ? snapshot.threads : [],
		previews: Array.isArray(snapshot.previews) ? snapshot.previews : [],
	};
}

function createQueryResult(overrides: Record<string, unknown>) {
	const result = {
		dataUpdatedAt: 1,
		isPending: false,
		isFetching: false,
		isFetchedAfterMount: true,
		isError: false,
		isSuccess: false,
		error: null,
		data: undefined,
		...overrides,
	};
	return {
		...result,
		refetch:
			overrides.refetch ??
			vi.fn().mockResolvedValue({ data: result.data, error: result.error }),
	};
}

function createAccountSpaceSections() {
	return {
		pinnedItems: [],
		recentlyDeletedItems: [],
		spaceItems: [],
	};
}

function createOrganizationScope(
	input: { isPersonal?: boolean } = {}
): OrganizationScopeAuthorized {
	const currentOrganization = {
		id: "org-acme",
		...(input.isPersonal === true ? { isPersonal: true } : {}),
		name: "Acme",
		slug: "acme",
	};
	return {
		access: "authorized",
		account: {
			email: "mira@example.com",
			image: null,
			name: "Mira",
		},
		activeOrganization: currentOrganization,
		currentOrganization,
		currentUserId: "user-mira",
		organizations: [currentOrganization],
		storageScope: "user-mira",
	};
}

function createPersonalScoutDirectoryFixture(): OrganizationSpaceProfileCandidates {
	const directory = createOrganizationDirectoryFixture({
		centerAgentProfileId: SECOND_AGENT_PROFILE_ID,
		humanProfileId: DEFAULT_SPACE_PROFILE_ID,
	});
	return {
		...directory,
		agentProfiles: directory.agentProfiles.map((agent) => ({
			...agent,
			profileName: "Scout",
		})),
	};
}

function createOrganizationDirectoryFixture(input: {
	centerAgentProfileId: string;
	humanProfileId: string;
}): OrganizationSpaceProfileCandidates {
	return {
		agentProfiles: [
			{
				agentControllerRef: null,
				createdAt: "2026-07-16T00:00:00.000Z",
				isCenterAgent: true,
				lastUsedAt: null,
				ownerName: "Mira",
				ownerUserId: "user-mira",
				profileHandle: "center-agent",
				profileId: input.centerAgentProfileId,
				profileName: "Center Agent",
				status: "active",
			},
		],
		members: [
			{
				avatarImageUrl: null,
				humanProfile: {
					profileHandle: "alex",
					profileId: input.humanProfileId,
					profileName: "Alex",
					status: "active",
				},
				lastActiveAt: "2026-07-16T00:00:00.000Z",
				memberName: "Alex",
				userId: "user-alex",
			},
		],
		organizationId: "org-acme",
	};
}

function resolveEmptyOrganizationDirectoryQueryResult(
	queryKey: readonly unknown[]
) {
	return queryKey[0] === "organizations" &&
		(queryKey[2] === "directory" || queryKey[2] === "profile-directory")
		? createQueryResult({
				isSuccess: true,
				data: {
					agentProfiles: [],
					members: [],
					organizationId: "org-acme",
				} satisfies OrganizationSpaceProfileCandidates,
			})
		: null;
}

function resolveModelCatalogQueryResult(queryKey: readonly unknown[]) {
	return queryKey[0] === "config" && queryKey[1] === "model-catalog"
		? createQueryResult({
				isSuccess: true,
				data: null,
			})
		: null;
}

function resolveCenterAgentDirectMessageProjectionQueryResult(
	queryKey: readonly unknown[]
) {
	return queryKey[0] === "center-agent" && queryKey[2] === "dm-space-projection"
		? createQueryResult({
				isSuccess: true,
				data: {
					generatedAt: "2026-07-08T00:00:00.000Z",
					organizationId: String(queryKey[1] ?? ""),
					projection: null,
				},
			})
		: null;
}

// SpaceLanding's Slack-discovery header state (useSpaceSlackDiscoveryState)
// always issues this designation read, independent of any test's own space
// fixtures -- every mockSpaceQueries/useQueryMock dispatcher needs to answer
// it or the whole SpaceLanding render throws before reaching what the test
// actually exercises.
function resolveCenterAgentDesignationQueryResult(
	queryKey: readonly unknown[],
	centerAgentProfileId: string | null = null
) {
	return queryKey[0] === "center-agent" && queryKey[2] === "designation"
		? createQueryResult({
				isSuccess: true,
				data: {
					designation:
						centerAgentProfileId === null
							? null
							: {
									organizationId: String(queryKey[1] ?? ""),
									agentProfileId: centerAgentProfileId,
									duty: null,
									designatedBy: "user-mira",
									createdAt: "2026-07-08T00:00:00.000Z",
								},
					organizationId: String(queryKey[1] ?? ""),
				},
			})
		: null;
}

// The same Slack-discovery header state also reads the active member's
// organization role to decide who can manage the Slack connection. Default
// to a plain "member" so existing fixtures do not unexpectedly gain
// Slack-management affordances they were not written to account for.
function resolveOrganizationRoleQueryResult(queryKey: readonly unknown[]) {
	return queryKey[0] === "organizations" && queryKey[2] === "role"
		? createQueryResult({
				isSuccess: true,
				data: "member",
			})
		: null;
}

// useSpaceMessageReferences (the Space cross-reference link renderer) reads
// the organization's Space directory to resolve `/spaces/<id>` references
// outside the current Space. It always issues this query once an
// organization id is known, independent of any given test's own fixtures.
function resolveOrganizationSpacesQueryResult(queryKey: readonly unknown[]) {
	return queryKey[0] === "organizations" && queryKey[2] === "spaces"
		? createQueryResult({
				isSuccess: true,
				data: {
					generatedAt: "2026-07-08T00:00:00.000Z",
					organizationId: String(queryKey[1] ?? ""),
					spaces: [],
				},
			})
		: null;
}

// SpaceLanding always reads the current Space's Inbox position so it can place
// the unread divider. Keep this shared default at the strict query-dispatch
// boundary so each fixture still rejects genuinely unknown queries.
function resolveSpaceInboxUnreadTargetsQueryResult(
	queryKey: readonly unknown[]
) {
	if (queryKey[0] === "inbox" && queryKey[2] === "space-summary") {
		return createQueryResult({
			isSuccess: true,
			data: {
				organizationId: String(queryKey[1] ?? ""),
				spaces: [],
				totalUnreadCount: 0,
			},
		});
	}
	return queryKey[0] === "inbox" && queryKey[2] === "space-unread-targets"
		? createQueryResult({
				isSuccess: true,
				data: {
					hasMoreTargets: false,
					organizationId: String(queryKey[1] ?? ""),
					spaceId: String(queryKey[3] ?? ""),
					targets: [],
					totalUnreadCount: 0,
				},
			})
		: null;
}

function createDomRect(input: { bottom: number; top: number }): DOMRect {
	return {
		bottom: input.bottom,
		height: input.bottom - input.top,
		left: 0,
		right: 0,
		top: input.top,
		width: 0,
		x: 0,
		y: input.top,
		toJSON: () => ({}),
	};
}

function buildCompletedAgentProfileCreationRequest(
	requestInput: WebCreateAgentProfileCreationRequestInput
): CreateAgentProfileCreationRequestResponse {
	const request: AgentProfileCreationRequest = {
		actorProfileId: DEFAULT_SPACE_PROFILE_ID,
		completedAt: "2026-08-20T00:00:05.000Z",
		configuration: requestInput.configuration,
		createdAgentProfileId: SECOND_AGENT_PROFILE_ID,
		createdAt: "2026-08-20T00:00:00.000Z",
		decidedAt: "2026-08-20T00:00:01.000Z",
		failureMessage: null,
		id: "apcr-space-agent",
		nativeSessionId: requestInput.nativeSessionId ?? null,
		organizationId: requestInput.organizationId,
		profileName: requestInput.profileName,
		requestedSpaceId: requestInput.requestedSpaceId ?? null,
		requesterUserId: "user-mira",
		sessionStrategy: requestInput.sessionStrategy ?? "new",
		source: "web",
		status: "completed",
		statusReason: "profile_created",
		targetOwnerUserId: requestInput.targetOwnerUserId,
		updatedAt: "2026-08-20T00:00:05.000Z",
	};
	return { replayed: false, request };
}

function createLandingAccountProfile(
	overrides: Partial<AuthProfileView> = {}
): AuthProfileView {
	return {
		openMeldProfileId:
			overrides.openMeldProfileId ?? "11111111-1111-1111-1111-111111111111",
		createdAt: overrides.createdAt ?? "2026-04-11T00:00:00.000Z",
		createdByUserId: overrides.createdByUserId ?? "user-mira",
		creatorProfileId: overrides.creatorProfileId ?? null,
		isDefault: overrides.isDefault ?? false,
		lastUsedAt: overrides.lastUsedAt ?? null,
		managedRole: overrides.managedRole ?? null,
		ownerName: overrides.ownerName ?? "Mira",
		ownerUserId: overrides.ownerUserId ?? "user-mira",
		profileHandle: overrides.profileHandle ?? "mira",
		profileKind: overrides.profileKind ?? "human",
		profileName: overrides.profileName ?? "Mira",
		source: overrides.source ?? "user",
		status: overrides.status ?? "active",
		updatedAt: overrides.updatedAt ?? "2026-04-11T00:00:00.000Z",
	};
}

function createMessageDetailsQueryResult(input: {
	agentContext?: Record<string, unknown>;
	message?: Record<string, unknown>;
	replyContext?: Record<string, unknown>;
	signalId: string;
	wakeContext?: Record<string, unknown>;
}) {
	return createQueryResult({
		isSuccess: true,
		data: {
			query: {
				spaceId: "space-123",
				signalId: input.signalId,
			},
			message: {
				signalId: input.signalId,
				signalType: "signal.text",
				sentAtMs: 10,
				actor: {
					profileId: DEFAULT_SPACE_PROFILE_ID,
					profileKind: "human",
					displayName: "Mira",
					profileName: "Mira",
					profileHandle: null,
				},
				...input.message,
			},
			agentContext: input.agentContext ?? createNotApplicableAgentContext(),
			wakeContext: input.wakeContext ?? createNotApplicableWakeContext(),
			replyContext: input.replyContext ?? createNotApplicableReplyContext(),
			diagnostics: {
				signalId: input.signalId,
				traceSelectors: [
					{
						kind: "signal",
						label: "Message ID",
						value: input.signalId,
						targetProfileId: null,
					},
				],
			},
		},
	});
}

function createMessageDetailsFact(
	state: "recorded" | "not_recorded" | "redacted" | "not_applicable",
	value: string | null,
	source:
		| "space_signal"
		| "space_signal_profile"
		| "reply_signal"
		| "wake_trace"
		| "wake_trace_execution_context"
		| "wake_trace_correlation"
		| "none"
) {
	return {
		state,
		value,
		source,
	};
}

function createRecordedMessageDetailsFact(
	value: string,
	source:
		| "space_signal"
		| "space_signal_profile"
		| "reply_signal"
		| "wake_trace"
		| "wake_trace_execution_context"
		| "wake_trace_correlation"
) {
	return createMessageDetailsFact("recorded", value, source);
}

function createNotRecordedMessageDetailsFact(
	source:
		| "space_signal"
		| "space_signal_profile"
		| "reply_signal"
		| "wake_trace"
		| "wake_trace_execution_context"
		| "wake_trace_correlation"
) {
	return createMessageDetailsFact("not_recorded", null, source);
}

function createNotApplicableMessageDetailsFact() {
	return createMessageDetailsFact("not_applicable", null, "none");
}

function createNotApplicableAgentContext() {
	return {
		state: "not_applicable",
		profileId: createNotApplicableMessageDetailsFact(),
		profileName: createNotApplicableMessageDetailsFact(),
		agentControllerRef: createNotApplicableMessageDetailsFact(),
		agentControllerConversationId: createNotApplicableMessageDetailsFact(),
		workspacePath: createNotApplicableMessageDetailsFact(),
		openMeldServiceRuntimeId: createNotApplicableMessageDetailsFact(),
		bindingId: createNotApplicableMessageDetailsFact(),
		workspaceFingerprint: createNotApplicableMessageDetailsFact(),
	};
}

function createAgentContext(input: {
	agentControllerConversationId?: string;
	agentControllerRef?: string;
	bindingId?: string;
	profileId: string;
	profileName: string;
	runtimeId?: string;
	workspacePath?: string;
}) {
	return {
		state: "recorded",
		profileId: createRecordedMessageDetailsFact(input.profileId, "wake_trace"),
		profileName: createRecordedMessageDetailsFact(
			input.profileName,
			"wake_trace"
		),
		agentControllerRef: input.agentControllerRef
			? createRecordedMessageDetailsFact(
					input.agentControllerRef,
					"wake_trace_execution_context"
				)
			: createNotRecordedMessageDetailsFact("wake_trace_execution_context"),
		agentControllerConversationId: input.agentControllerConversationId
			? createRecordedMessageDetailsFact(
					input.agentControllerConversationId,
					"wake_trace_execution_context"
				)
			: createNotRecordedMessageDetailsFact("wake_trace_execution_context"),
		workspacePath: input.workspacePath
			? createRecordedMessageDetailsFact(
					input.workspacePath,
					"wake_trace_execution_context"
				)
			: createNotRecordedMessageDetailsFact("wake_trace_execution_context"),
		openMeldServiceRuntimeId: input.runtimeId
			? createRecordedMessageDetailsFact(
					input.runtimeId,
					"wake_trace_execution_context"
				)
			: createNotRecordedMessageDetailsFact("wake_trace_execution_context"),
		bindingId: input.bindingId
			? createRecordedMessageDetailsFact(
					input.bindingId,
					"wake_trace_execution_context"
				)
			: createNotRecordedMessageDetailsFact("wake_trace_execution_context"),
		workspaceFingerprint: createNotRecordedMessageDetailsFact(
			"wake_trace_execution_context"
		),
	};
}

function createNotApplicableWakeContext() {
	return {
		state: "not_applicable",
		sourceSignalId: createNotApplicableMessageDetailsFact(),
		clientMessageId: createNotApplicableMessageDetailsFact(),
		targets: [],
	};
}

function createWakeContext(input: {
	clientMessageId?: string;
	sourceSignalId: string;
	targets: Record<string, unknown>[];
}) {
	return {
		state: "recorded",
		sourceSignalId: createRecordedMessageDetailsFact(
			input.sourceSignalId,
			"space_signal"
		),
		clientMessageId: input.clientMessageId
			? createRecordedMessageDetailsFact(input.clientMessageId, "space_signal")
			: createNotRecordedMessageDetailsFact("space_signal"),
		targets: input.targets,
	};
}

function createWakeTarget(input: {
	agentContext?: Record<string, unknown>;
	reasonCode?: string;
	status: "missing" | "pending" | "running" | "failed" | "replied";
	targetLabel: string;
	targetProfileId: string;
}) {
	return {
		targetProfileId: input.targetProfileId,
		targetLabel: input.targetLabel,
		status: input.status,
		terminalStep: input.status === "missing" ? "planner" : "reply_signal",
		reasonCode: input.reasonCode ?? null,
		agentContext:
			input.agentContext ??
			createAgentContext({
				profileId: input.targetProfileId,
				profileName: input.targetLabel,
			}),
		steps: [
			{
				order: 8,
				name: "reply_signal",
				status: input.status === "replied" ? "found" : "missing",
				factSource:
					input.status === "replied" ? "space_final_reply_claim" : null,
				observedAt: null,
				reasonCode: input.reasonCode ?? null,
				ids: {
					clientMessageId: "client-message-1",
					sourceSignalId: "sig-wake",
					targetProfileId: input.targetProfileId,
					targetWakeLifecycleId: null,
					dispatchId: null,
					attemptId: null,
					claimLeaseId: null,
					bindingId: null,
					openMeldServiceRuntimeId: null,
					agentControllerRef: null,
					resultKey: null,
					resultRef: null,
					publishedSignalId: null,
					replySignalId: null,
				},
			},
		],
	};
}

function createNotApplicableReplyContext() {
	return {
		state: "not_applicable",
		replyingToSignalId: createNotApplicableMessageDetailsFact(),
		replyingToAuthor: createNotApplicableMessageDetailsFact(),
		previewText: createNotApplicableMessageDetailsFact(),
		resolved: false,
	};
}

function createReplyContext(input: {
	author: string;
	previewText: string;
	replyingToSignalId: string;
}) {
	return {
		state: "recorded",
		replyingToSignalId: createRecordedMessageDetailsFact(
			input.replyingToSignalId,
			"reply_signal"
		),
		replyingToAuthor: createRecordedMessageDetailsFact(
			input.author,
			"reply_signal"
		),
		previewText: createRecordedMessageDetailsFact(
			input.previewText,
			"reply_signal"
		),
		resolved: true,
	};
}

function createStartStateWithCodexCatalog(input?: {
	profileReadiness?: unknown[];
}) {
	return {
		state: {
			readModel: {
				device: {
					value: {
						backgroundHelper: {
							expectedVersion: "1.0.0",
							installedVersion: "1.0.0",
							installStatus: "installed_current",
							runtimeStatus: "running",
						},
						deviceAgentCatalog: {
							totalBuiltins: 1,
							detectedSupported: 1,
							needsChoice: 0,
							needsRepair: 0,
							detectedNotSupportedYet: 0,
							notDetected: 0,
							entries: [
								{
									agentId: "codex",
									displayName: "Codex",
									targetKind: "builtin",
									detected: true,
									enabled: true,
									launchStatus: "ready",
									selectable: true,
									selectableReason: null,
								},
							],
						},
						deviceReplyReadiness: {
							level: "ready",
							reasonCodes: [],
						},
						observedAt: "2026-04-11T00:00:00.000Z",
						runtimeLane: "dev-local",
						skillsReadiness: {
							status: "up_to_date",
							summary: {
								externalConflict: 0,
								missing: 0,
								outdated: 0,
								upToDate: 1,
							},
							targetCount: 1,
						},
					},
				},
				profileReadiness: input?.profileReadiness ?? [],
			},
		},
	};
}

function createMatchMediaMock(input?: {
	desktopMembersPanel?: boolean;
	reducedMotion?: boolean;
}): typeof window.matchMedia {
	return (query: string) =>
		({
			addEventListener: vi.fn(),
			addListener: vi.fn(),
			dispatchEvent: vi.fn(),
			matches: resolveMatchMediaQuery(query, input),
			media: query,
			onchange: null,
			removeEventListener: vi.fn(),
			removeListener: vi.fn(),
		}) as MediaQueryList;
}

function resolveMatchMediaQuery(
	query: string,
	input?: {
		desktopMembersPanel?: boolean;
		reducedMotion?: boolean;
	}
): boolean {
	if (query === "(min-width: 1280px)") {
		return input?.desktopMembersPanel ?? false;
	}

	if (query === "(prefers-reduced-motion: reduce)") {
		return input?.reducedMotion ?? false;
	}

	return false;
}

function createSpaceStatus(): GetSpaceStatusResponse {
	return {
		spaceId: "space-123",
		generatedAt: "2026-04-11T00:00:00.000Z",
		name: "Design Room",
		accessMode: "public",
		passwordProtected: false,
		dispatchPolicy: {
			mode: "mention_only",
		},
		publicationMode: "collaboration",
		allowedActions: ["post_message", "post_status", "stay_silent"],
		resultArchivePolicy: {
			mode: "all_final_results",
		},
		entryBrief: "default",
		dispatchBrief: "default",
		members: {
			totalCount: 2,
			humanCount: 1,
			agentCount: 1,
			liveNowCount: 1,
			liveHumanCount: 1,
			liveAgentCount: 0,
		},
		latestVisibleUpdate: {
			signalId: "sig-last",
			signalType: "signal.text",
			createdAt: "2026-04-11T00:00:00.000Z",
			actorProfileId: "11111111-1111-1111-1111-111111111111",
			actorName: "Mira",
			previewText: "Recent update",
		},
	};
}

function createActiveAgentStreamSnapshot(
	textSnapshot: string
): SpaceAgentStreamSnapshot {
	return {
		v: 1,
		spaceId: "space-123",
		streamId: "stream:bootstrap-submission",
		sequence: 6,
		profileId: DEFAULT_AGENT_PROFILE_ID,
		triggerMessageId: "signal-trigger-1",
		dispatchId: "dispatch-bootstrap-1",
		textSnapshot,
		state: "streaming",
		gapDetected: false,
		createdAtMs: Date.parse("2026-04-11T00:00:00.000Z"),
		updatedAtMs: Date.parse("2026-04-11T00:00:01.000Z"),
		expiresAtMs: Date.parse("2026-04-11T00:30:00.000Z"),
	};
}

function createMembersSnapshot(input?: {
	defaultAgentControllerRef?: string | null;
	defaultAgentExecutionReadiness?: TestAgentExecutionReadiness | null;
	defaultAgentMentionAlias?: string;
	defaultAgentOwnerName?: string | null;
	defaultAgentOwnerUserId?: string | null;
	defaultAgentProfileName?: string;
	defaultAgentRuntimeDeviceDisplayName?: string | null;
	defaultHumanOwnerName?: string | null;
	defaultHumanOwnerUserId?: string | null;
	wakeRouteEvidence?: ReturnType<typeof createDaemonRouteObservationSummary>;
	extraAgents?: Array<{
		agentExecutionReadiness?: TestAgentExecutionReadiness | null;
		agentControllerRef?: string | null;
		daemonRouteStatus?: "online" | "offline";
		liveNow?: boolean;
		mentionAlias: string;
		ownerName?: string | null;
		ownerUserId?: string | null;
		profileId: string;
		profileName: string;
		runtimeDeviceDisplayName?: string | null;
		wakeState?: "wakeable" | "offline";
		wakeability?: {
			status: "ready" | "blocked";
			reasonCodes: string[];
			reasonText: string;
		};
	}>;
	wakeState?: "wakeable" | "offline";
	wakeability?: {
		status: "ready" | "blocked";
		reasonCodes: string[];
		reasonText: string;
	};
}) {
	const requestedDefaultAgentExecutionReadiness =
		input && "defaultAgentExecutionReadiness" in input
			? input.defaultAgentExecutionReadiness
			: createReadyAgentExecutionReadiness(DEFAULT_AGENT_PROFILE_ID);
	const defaultAgentExecutionReadiness =
		requestedDefaultAgentExecutionReadiness === undefined
			? createReadyAgentExecutionReadiness(DEFAULT_AGENT_PROFILE_ID)
			: requestedDefaultAgentExecutionReadiness;
	const defaultWakeRouteEvidence =
		input?.wakeRouteEvidence ??
		createDaemonRouteObservationSummary({
			observedAt: "2026-04-11T00:00:00.000Z",
			status: "online",
		});
	const defaultAgentLocalRecoveryFields =
		defaultAgentExecutionReadiness === null
			? {}
			: createAgentLocalRecoveryFields({
					wakeRouteEvidence: defaultWakeRouteEvidence,
					readiness: defaultAgentExecutionReadiness,
				});

	return {
		spaceId: "space-123",
		generatedAt: "2026-04-11T00:00:00.000Z",
		summary: {
			totalCount: 2,
			humanCount: 1,
			agentCount: 1,
			liveNowCount: 1,
		},
		humans: [
			{
				profileId: "11111111-1111-1111-1111-111111111111",
				profileName: "Mira",
				profileKind: "human",
				status: "active",
				memberSource: "space_creator",
				memberSourceLabel: "Creator",
				addedAt: "2026-04-11T00:00:00.000Z",
				removedAt: null,
				createdAt: "2026-04-11T00:00:00.000Z",
				updatedAt: "2026-04-11T00:00:00.000Z",
				addedByProfileId: null,
				addedByOwnerUserId: null,
				addedByDisplayName: null,
				removedByProfileId: null,
				removedByOwnerUserId: null,
				removalReason: null,
				firstEnteredAt: null,
				lastEnteredAt: null,
				lastSeenAt: null,
				lastSeenLabel: null,
				liveNow: true,
				mentionAlias: null,
				ownerUserId:
					input && "defaultHumanOwnerUserId" in input
						? input.defaultHumanOwnerUserId
						: "user-mira",
				ownerName:
					input && "defaultHumanOwnerName" in input
						? input.defaultHumanOwnerName
						: "Mira",
			},
		],
		agents: [
			{
				profileId: DEFAULT_AGENT_PROFILE_ID,
				profileName: input?.defaultAgentProfileName ?? "Runner",
				profileKind: "agent",
				runtimeDeviceDisplayName: input?.defaultAgentRuntimeDeviceDisplayName,
				status: "active",
				memberSource: "added_by_member",
				memberSourceLabel: "Added by member",
				addedAt: "2026-04-11T00:00:00.000Z",
				removedAt: null,
				createdAt: "2026-04-11T00:00:00.000Z",
				updatedAt: "2026-04-11T00:00:00.000Z",
				addedByProfileId: "11111111-1111-1111-1111-111111111111",
				addedByOwnerUserId: "user-mira",
				addedByDisplayName: "Mira",
				removedByProfileId: null,
				removedByOwnerUserId: null,
				removalReason: null,
				firstEnteredAt: null,
				lastEnteredAt: null,
				lastSeenAt: null,
				lastSeenLabel: null,
				liveNow: false,
				mentionAlias: input?.defaultAgentMentionAlias ?? "runner",
				ownerUserId:
					input && "defaultAgentOwnerUserId" in input
						? input.defaultAgentOwnerUserId
						: "user-mira",
				ownerName:
					input && "defaultAgentOwnerName" in input
						? input.defaultAgentOwnerName
						: "Mira",
				agentControllerRef:
					input && "defaultAgentControllerRef" in input
						? input.defaultAgentControllerRef
						: "builtin:codex",
				agentControllerConversationId: null,
				...defaultAgentLocalRecoveryFields,
				workingDirectory: null,
			},
			...(input?.extraAgents ?? []).map((member) => {
				const requestedAgentExecutionReadiness =
					"agentExecutionReadiness" in member
						? member.agentExecutionReadiness
						: createReadyAgentExecutionReadiness(member.profileId);
				const agentExecutionReadiness =
					requestedAgentExecutionReadiness === undefined
						? createReadyAgentExecutionReadiness(member.profileId)
						: requestedAgentExecutionReadiness;
				const wakeRouteEvidence = createDaemonRouteObservationSummary({
					observedAt: "2026-04-11T00:00:00.000Z",
					status: member.daemonRouteStatus ?? "online",
				});
				const agentLocalRecoveryFields =
					agentExecutionReadiness === null
						? {}
						: createAgentLocalRecoveryFields({
								wakeRouteEvidence,
								readiness: agentExecutionReadiness,
							});

				return {
					profileId: member.profileId,
					profileName: member.profileName,
					profileKind: "agent",
					runtimeDeviceDisplayName: member.runtimeDeviceDisplayName,
					status: "active",
					memberSource: "added_by_member",
					memberSourceLabel: "Added by member",
					addedAt: "2026-04-11T00:00:00.000Z",
					removedAt: null,
					createdAt: "2026-04-11T00:00:00.000Z",
					updatedAt: "2026-04-11T00:00:00.000Z",
					addedByProfileId: "11111111-1111-1111-1111-111111111111",
					addedByOwnerUserId: "user-mira",
					addedByDisplayName: "Mira",
					removedByProfileId: null,
					removedByOwnerUserId: null,
					removalReason: null,
					firstEnteredAt: null,
					lastEnteredAt: null,
					lastSeenAt: null,
					lastSeenLabel: null,
					liveNow: member.liveNow ?? false,
					mentionAlias: member.mentionAlias,
					ownerUserId:
						"ownerUserId" in member ? member.ownerUserId : "user-mira",
					ownerName: "ownerName" in member ? member.ownerName : "Mira",
					agentControllerRef:
						"agentControllerRef" in member
							? member.agentControllerRef
							: "builtin:codex",
					agentControllerConversationId: null,
					...agentLocalRecoveryFields,
					workingDirectory: null,
				};
			}),
		],
	};
}

function createAgentLocalRecoveryFields(input: {
	wakeRouteEvidence: ReturnType<typeof createDaemonRouteObservationSummary>;
	readiness: TestAgentExecutionReadiness;
}) {
	const wakeRouteStatus =
		input.wakeRouteEvidence.status === "online"
			? ({
					connectionGeneration: 1,
					daemonSessionId: "daemon-session-1",
					deviceId: input.readiness.facts.route.deviceId ?? "device-current",
					lane: input.readiness.facts.route.lane ?? "dev-local",
					lastHeartbeatMs: 1_768_000_000_000,
					leaseEpoch: 1,
					status: "ready",
				} as const)
			: ({
					status: input.wakeRouteEvidence.status,
				} as const);
	const agentWakeRouteRegistration =
		wakeRouteStatus.status === "ready"
			? ({
					status: "registered",
					reasonCode: "wake_route.registered",
					reportedAtMs: 1_768_000_000_000,
					daemonSessionId: wakeRouteStatus.daemonSessionId,
					deviceId: wakeRouteStatus.deviceId,
					lane: wakeRouteStatus.lane,
					serviceVersion: "0.7.52",
				} as const)
			: ({
					status: "pending",
					reasonCode: "wake_route.registration_pending",
					reportedAtMs: null,
					daemonSessionId: null,
					deviceId: null,
					lane: null,
					serviceVersion: null,
				} as const);
	const agentWakeAvailability = resolveAgentWakeAvailability({
		agentWakeRouteRegistration,
		wakeRouteStatus,
		readiness: input.readiness,
	});
	return {
		agentWakeAvailability,
		ownerWakeDiagnostics: {
			state: createOwnerWakeDiagnosticsState(agentWakeAvailability),
			agentExecutionReadiness: input.readiness,
			agentWakeRouteRegistration,
			wakeRouteEvidence: input.wakeRouteEvidence,
			wakeRouteStatus,
		},
	};
}

function createOwnerWakeDiagnosticsState(
	agentWakeAvailability: ReturnType<typeof resolveAgentWakeAvailability>
) {
	if (agentWakeAvailability.status === "available_for_wake") {
		return "none" as const;
	}
	if (agentWakeAvailability.status === "checking_connection") {
		return "checking_local_connection" as const;
	}
	return "action_required" as const;
}

function createReadyAgentExecutionReadiness(
	agentProfileId: string
): TestAgentExecutionReadiness {
	return createSpaceMemberAgentExecutionReadiness({
		agentProfileId,
		displayState: "ready",
		primaryAction: "none",
		reasonCodes: [],
	});
}

function createMissingBindingAgentExecutionReadiness(
	agentProfileId: string
): TestAgentExecutionReadiness {
	return createSpaceMemberAgentExecutionReadiness({
		agentProfileId,
		displayState: "not_ready",
		facts: {
			binding: {
				reasonCodes: ["agent_profile_binding.missing"],
				routable: false,
				source: "missing",
			},
		},
		primaryAction: "reconnect_binding",
		reasonCodes: ["agent_profile_binding.missing"],
	});
}

function createBindingRuntimeMismatchAgentExecutionReadiness(
	agentProfileId: string
): TestAgentExecutionReadiness {
	return createSpaceMemberAgentExecutionReadiness({
		agentProfileId,
		displayState: "not_ready",
		facts: {
			binding: {
				reasonCodes: ["agent_profile_binding.command_eligible"],
				routable: true,
				source: "binding_truth",
			},
			claim: {
				executionBlocked: true,
				grantsClaimSuccess: false,
				reasonCodes: ["claim_eligibility.binding_runtime_mismatch"],
				source: "claim_diagnostics",
			},
			route: {
				deviceId: "device-office",
				lane: "dev-local",
				observedAt: "2026-04-29T00:00:00.000Z",
				online: true,
				reasonCodes: [],
				source: "daemon_route",
			},
			runtime: {
				ready: true,
				reasonCodes: ["runtime.ready"],
				source: "prepare_readiness",
			},
		},
		primaryAction: "reconnect_binding",
		reasonCodes: [
			"agent_profile_binding.command_eligible",
			"claim_eligibility.binding_runtime_mismatch",
			"local_service.identity_mismatch",
		],
	});
}

function createRouteUpdatingAgentExecutionReadiness() {
	return createSpaceMemberAgentExecutionReadiness({
		agentProfileId: DEFAULT_AGENT_PROFILE_ID,
		displayState: "not_ready",
		facts: {
			binding: {
				reasonCodes: ["agent_profile_binding.command_eligible"],
				routable: true,
				source: "binding_truth",
			},
			claim: {
				executionBlocked: false,
				grantsClaimSuccess: false,
				reasonCodes: ["claim.not_checked"],
				source: "not_checked",
			},
			route: {
				deviceId: "device-office",
				lane: "dev-local",
				observedAt: "2026-04-29T00:00:00.000Z",
				online: false,
				reasonCodes: ["agent_execution.route_missing"],
				source: "daemon_route",
			},
			localService: {
				reachable: true,
				refreshable: true,
				reasonCodes: ["local_service.refresh_in_progress"],
				source: "runtime_transport",
			},
			runtime: {
				ready: true,
				reasonCodes: ["runtime.ready"],
				source: "prepare_readiness",
			},
		},
		primaryAction: "check_status",
		reasonCodes: ["agent_execution.route_missing"],
	});
}

function createLegacyRouteReconnectAgentExecutionReadiness() {
	return createSpaceMemberAgentExecutionReadiness({
		agentProfileId: DEFAULT_AGENT_PROFILE_ID,
		displayState: "not_ready",
		facts: {
			binding: {
				reasonCodes: ["agent_profile_binding.command_eligible"],
				routable: true,
				source: "binding_truth",
			},
			claim: {
				executionBlocked: false,
				grantsClaimSuccess: false,
				reasonCodes: ["claim.not_checked"],
				source: "not_checked",
			},
			route: {
				deviceId: "device-office",
				lane: "dev-local",
				observedAt: "2026-04-29T00:00:00.000Z",
				online: false,
				reasonCodes: ["route.not_registered"],
				source: "daemon_route",
			},
			localService: {
				reachable: true,
				refreshable: true,
				reasonCodes: ["local_service.refresh_in_progress"],
				source: "runtime_transport",
			},
			runtime: {
				ready: true,
				reasonCodes: ["runtime.ready"],
				source: "prepare_readiness",
			},
		},
		primaryAction: "check_status",
		reasonCodes: ["route.not_registered"],
	});
}

function createRunPrepareAgentExecutionReadiness(agentProfileId: string) {
	return createSpaceMemberAgentExecutionReadiness({
		agentProfileId,
		displayState: "not_ready",
		facts: {
			binding: {
				reasonCodes: [],
				routable: true,
				source: "binding_truth",
			},
			claim: {
				executionBlocked: false,
				grantsClaimSuccess: false,
				reasonCodes: [],
				source: "not_checked",
			},
			route: {
				deviceId: "device-office",
				observedAt: "2026-04-29T00:00:00.000Z",
				online: true,
				reasonCodes: [],
				source: "daemon_route",
			},
			runtime: {
				ready: false,
				reasonCodes: ["runtime.projection_missing"],
				source: "missing",
			},
		},
		primaryAction: "run_prepare",
		reasonCodes: ["runtime.projection_missing"],
	});
}

function createWorkspaceMissingAgentExecutionReadiness(agentProfileId: string) {
	return createSpaceMemberAgentExecutionReadiness({
		agentProfileId,
		displayState: "not_ready",
		facts: {
			binding: {
				reasonCodes: [],
				routable: true,
				source: "binding_truth",
			},
			claim: {
				executionBlocked: false,
				grantsClaimSuccess: false,
				reasonCodes: [],
				source: "not_checked",
			},
			route: {
				deviceId: "device-office",
				observedAt: "2026-04-29T00:00:00.000Z",
				online: true,
				reasonCodes: [],
				source: "daemon_route",
			},
			runtime: {
				ready: false,
				reasonCodes: ["workspace.missing"],
				source: "prepare_readiness",
			},
		},
		primaryAction: "run_prepare",
		reasonCodes: ["workspace.missing"],
	});
}

function createServiceUpdateRequiredAgentExecutionReadiness(
	agentProfileId: string
) {
	return createSpaceMemberAgentExecutionReadiness({
		agentProfileId,
		displayState: "blocked",
		facts: {
			binding: {
				reasonCodes: ["agent_profile_binding.enabled_primary"],
				routable: true,
				source: "binding_truth",
			},
			claim: {
				executionBlocked: false,
				grantsClaimSuccess: false,
				reasonCodes: [],
				source: "not_checked",
			},
			localService: {
				reachable: true,
				refreshable: false,
				reasonCodes: [],
				source: "runtime_transport",
			},
			route: {
				deviceId: "device-office",
				lane: "dev-local",
				observedAt: "2026-04-29T00:00:00.000Z",
				online: false,
				reasonCodes: ["route.not_registered"],
				source: "daemon_route",
			},
			runtime: {
				ready: true,
				reasonCodes: ["runtime.ready"],
				source: "prepare_readiness",
			},
			service: {
				executionCompatible: false,
				expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
				observedEpoch: null,
				reasonCodes: [
					"service.update_required",
					"daemon.runtime_contract.missing",
				],
				source: "runtime_transport",
			},
		},
		primaryAction: "update_service",
		reasonCodes: [
			"service.update_required",
			"daemon.runtime_contract.missing",
			"route.not_registered",
		],
	});
}

function createServiceNotConnectedAgentExecutionReadiness(
	agentProfileId: string
) {
	return createSpaceMemberAgentExecutionReadiness({
		agentProfileId,
		displayState: "not_ready",
		facts: {
			binding: {
				reasonCodes: ["agent_profile_binding.command_eligible"],
				routable: true,
				source: "binding_truth",
			},
			claim: {
				executionBlocked: false,
				grantsClaimSuccess: false,
				reasonCodes: [],
				source: "not_checked",
			},
			localService: {
				reachable: false,
				refreshable: false,
				reasonCodes: ["local_service.not_connected_for_account"],
				source: "runtime_transport",
			},
			route: {
				deviceId: "device-office",
				lane: "dev-local",
				observedAt: "2026-04-29T00:00:00.000Z",
				online: false,
				reasonCodes: ["route.not_registered"],
				source: "daemon_route",
			},
			runtime: {
				ready: true,
				reasonCodes: ["runtime.ready"],
				source: "prepare_readiness",
			},
		},
		primaryAction: "connect_service",
		reasonCodes: [
			"local_service.not_connected_for_account",
			"route.not_registered",
		],
	});
}

function createCurrentLocalRuntimeReplyReadiness(input: {
	canReplyFromThisComputer: boolean;
	primaryBlocker:
		| "none"
		| "current_runtime_missing"
		| "agent_controller_report_not_ready"
		| "agent_controller_report_stale"
		| "agent_controller_report_unknown"
		| "service_not_connected"
		| "service_update_required"
		| "service_unavailable";
	serviceConnected: boolean;
	status: "ready" | "blocked" | "checking" | "unknown";
}) {
	return {
		canReplyFromThisComputer: input.canReplyFromThisComputer,
		currentTarget: {
			availability: "resolved",
			deviceId: "device-office",
			runtimeLane: "dev-local",
		},
		generatedAt: "2026-04-29T00:00:00.000Z",
		localComponents: {
			agentSetupCommand:
				"npm install -g openmeld@latest && openmeld setup --view agent",
			generatedAt: "2026-04-29T00:00:00.000Z",
			humanSetupCommand: "npm install -g openmeld@latest && openmeld setup",
			schemaVersion: 1,
			cli: {
				commandContractVersion:
					"openmeld-cli-command-contract-2026-05-local-components-v1",
				installedPackageVersion: "1.0.0",
				latestPackageVersion: "1.0.0",
				reasonCodes: [],
				requiredCommandContractVersion: null,
				status: "current",
				updatePolicy: "ok",
				wakeBlocked: false,
			},
			service: {
				installedVersion: input.serviceConnected ? "1.0.0" : null,
				latestVersion: "1.0.0",
				reasonCodes: input.serviceConnected ? [] : ["service.not_connected"],
				requiredVersion: input.serviceConnected ? null : "1.0.0",
				status: input.serviceConnected ? "current" : "unknown",
				updatePolicy: input.serviceConnected ? "ok" : "required",
				wakeBlocked: false,
			},
			skills: {
				expectedBundleHash: null,
				expectedTargetCount: 1,
				installedBundleHash: null,
				reasonCodes: [],
				skillContractVersion: "openmeld-skills-contract-2026-05-required-v1",
				status: "current",
				targetCount: 1,
				updatePolicy: "ok",
				wakeBlocked: false,
			},
			setupAction: "none",
			setupActionDescription:
				"OpenMeld local components are aligned for this computer.",
			setupActionLabel: "Everything is up to date",
		},
		message: input.canReplyFromThisComputer
			? "This computer can reply in Spaces."
			: "OpenMeld Service is not connected for this account on this computer.",
		nextAction: input.canReplyFromThisComputer ? "none" : "connect_service",
		primaryBlocker: input.primaryBlocker,
		runtime: {
			deviceDisplayName: "Office Mac mini",
			deviceId: "device-office",
			executionTargetStatus: input.canReplyFromThisComputer
				? "ready"
				: "unknown",
			lastObservedAtMs: 1_774_979_200_000,
			reasonCodes: input.canReplyFromThisComputer ? ["runtime.ready"] : [],
			openMeldServiceRuntimeId: input.canReplyFromThisComputer
				? {
						source: "runtime_registry_authority",
						value: "runtime_opaque_codex",
					}
				: null,
			runtimeLane: "dev-local",
		},
		service: {
			connected: input.serviceConnected,
			executionCompatibility: null,
			matchingCurrentRuntime: input.serviceConnected,
			reasonCodes: input.serviceConnected
				? ["service.ready"]
				: ["local_service.not_connected_for_account"],
			sessionDeviceId: input.serviceConnected ? "device-office" : null,
			sessionLane: input.serviceConnected ? "dev-local" : null,
		},
		status: input.status,
	};
}

function createStaleLocalReadinessAgentExecutionReadiness(
	agentProfileId: string
) {
	return createSpaceMemberAgentExecutionReadiness({
		agentProfileId,
		displayState: "not_ready",
		facts: {
			binding: {
				reasonCodes: [],
				routable: true,
				source: "binding_truth",
			},
			claim: {
				executionBlocked: false,
				grantsClaimSuccess: false,
				reasonCodes: ["claim.not_checked"],
				source: "not_checked",
			},
			route: {
				deviceId: "device-office",
				lane: "dev-local",
				observedAt: "2026-04-29T00:00:00.000Z",
				online: true,
				reasonCodes: [],
				source: "daemon_route",
			},
			localService: {
				reachable: true,
				refreshable: true,
				reasonCodes: ["local_service.refresh_in_progress"],
				source: "runtime_transport",
			},
			runtime: {
				ready: false,
				reasonCodes: ["runtime.agent_controller_report_stale"],
				source: "prepare_readiness",
			},
		},
		primaryAction: "check_status",
		reasonCodes: ["runtime.agent_controller_report_stale"],
	});
}

function createActionRequiredLocalReadinessAgentExecutionReadiness(
	agentProfileId: string
) {
	return createSpaceMemberAgentExecutionReadiness({
		agentProfileId,
		displayState: "not_ready",
		facts: {
			binding: {
				reasonCodes: [],
				routable: true,
				source: "binding_truth",
			},
			claim: {
				executionBlocked: false,
				grantsClaimSuccess: false,
				reasonCodes: ["claim.not_checked"],
				source: "not_checked",
			},
			route: {
				deviceId: "device-office",
				lane: "dev-local",
				observedAt: "2026-04-29T00:00:00.000Z",
				online: true,
				reasonCodes: [],
				source: "daemon_route",
			},
			localService: {
				reachable: true,
				refreshable: true,
				reasonCodes: ["local_service.refresh_in_progress"],
				source: "runtime_transport",
			},
			runtime: {
				ready: false,
				reasonCodes: ["runtime.agent_controller_report_stale"],
				source: "prepare_readiness",
			},
		},
		primaryAction: "run_prepare",
		reasonCodes: ["runtime.agent_controller_report_stale"],
	});
}

function createTextSignal(input: {
	attachments?: Array<{
		fileName?: string;
		height?: number;
		id: string;
		mimeType: "image/jpeg" | "image/png";
		sizeBytes: number;
		width?: number;
	}>;
	files?: Array<{
		fileId: string;
		mimeType: string;
		name: string;
		revision: number;
		sizeBytes: number;
	}>;
	id: string;
	messageEnvelope?: {
		activationTargets: string[];
		referenceTargets: string[];
		text: string;
	};
	meta?: {
		clientMessageId?: string;
		dispatchId?: string;
		errorCode?: string;
		purpose?: string;
		sourceClientMessageId?: string;
		sourceEventId?: string;
		targetMentionLabel?: string;
		targetProfileId?: string;
		targetProfileName?: string;
		transient?: true;
	};
	profile?: {
		kind: "human" | "agent" | "system";
		profileId: string;
		profileName: string;
	};
	text: string;
	ts?: number;
	replyTo?: {
		signalId: string;
		profileId: string;
		profileKind: "human" | "agent" | "system";
		profileName: string;
		previewText: string;
	};
}) {
	return {
		v: 1,
		id: input.id,
		spaceId: "space-123",
		ts: input.ts ?? 10,
		profile: input.profile ?? {
			kind: "human",
			profileId: "11111111-1111-1111-1111-111111111111",
			profileName: "Mira",
		},
		type: "signal.text",
		data: {
			text: input.text,
			...(input.attachments ? { attachments: input.attachments } : {}),
			...(input.files ? { files: input.files } : {}),
			...(input.messageEnvelope
				? { messageEnvelope: input.messageEnvelope }
				: {}),
			...(input.meta ? { meta: input.meta } : {}),
			...(input.replyTo ? { replyTo: input.replyTo } : {}),
		},
	};
}

function createSpaceFileDescriptor(
	input: {
		id?: string;
		mimeType?: string;
		name?: string;
		sizeBytes?: number;
	} = {}
) {
	const actor = {
		displayName: "Mira",
		ownerUserId: "user-mira",
		profileId: DEFAULT_SPACE_PROFILE_ID,
		profileKind: "human" as const,
	};
	const id = input.id ?? "file-picnic";
	const name = input.name ?? "picnic.png";
	return {
		createdAt: "2026-07-11T00:00:00.000Z",
		createdBy: actor,
		id,
		kind: "file" as const,
		latestRevision: {
			createdAt: "2026-07-11T00:00:00.000Z",
			createdBy: actor,
			fileId: id,
			id: `revision-${id}`,
			mimeType: input.mimeType ?? "image/png",
			revision: 1,
			sizeBytes: input.sizeBytes ?? 6,
		},
		name,
		parentId: null,
		path: `/${name}`,
		spaceId: "space-123",
		updatedAt: "2026-07-11T00:00:00.000Z",
		updatedBy: actor,
	};
}

function createSpaceComposerUpload(input: {
	id: string;
	mimeType: string;
	name: string;
	sizeBytes: number;
}) {
	return {
		expiresAt: "2099-07-12T00:00:00.000Z",
		...input,
	};
}

function createSpaceMessageFileReference(
	file: ReturnType<typeof createSpaceFileDescriptor>
) {
	return {
		fileId: file.id,
		mimeType: file.latestRevision.mimeType,
		name: file.name,
		revision: file.latestRevision.revision,
		sizeBytes: file.latestRevision.sizeBytes,
	};
}

function createStatusSignal(input: {
	coreReadinessFactsChanged?: {
		agentProfileId: string;
		kind: typeof CORE_READINESS_FACTS_CHANGED_MARKER_KIND;
	};
	id: string;
	text: string;
	ts?: number;
}) {
	return {
		v: 1,
		id: input.id,
		spaceId: "space-123",
		ts: input.ts ?? 10,
		profile: {
			kind: "agent",
			profileId: "agt_22222222-2222-2222-2222-222222222222",
			profileName: "Runner",
		},
		type: "signal.status",
		data: {
			actorProfileId: "agt_22222222-2222-2222-2222-222222222222",
			status: "needs_input",
			dispatchId: "dispatch-1",
			text: input.text,
			generatedBy: "openmeld",
			...(input.coreReadinessFactsChanged
				? { coreReadinessFactsChanged: input.coreReadinessFactsChanged }
				: {}),
		},
	};
}

function createSystemNoticeSignal(input: {
	id: string;
	text: string;
	ts?: number;
}) {
	return {
		v: 1,
		id: input.id,
		spaceId: "space-123",
		ts: input.ts ?? 10,
		profile: {
			kind: "agent",
			profileId: "agt_22222222-2222-2222-2222-222222222222",
			profileName: "Runner",
		},
		type: "signal.system_notice",
		data: {
			noticeType: "stay_silent",
			actorProfileId: "agt_22222222-2222-2222-2222-222222222222",
			actorName: "Runner",
			dispatchId: "dispatch-2",
			text: input.text,
			generatedBy: "openmeld",
		},
	};
}

function createTerminalFailureNoticeSignal(input: {
	actorProfileId: string;
	dispatchId?: string | null;
	failureStage?: "execution" | "publication";
	id: string;
	replyToSignalId?: string;
	text?: string;
	ts?: number;
}) {
	return {
		v: 1,
		id: input.id,
		spaceId: "space-123",
		ts: input.ts ?? 10,
		profile: {
			kind: "system",
			profileId: "openmeld-system",
			profileName: "OpenMeld",
		},
		type: "signal.system_notice",
		data: {
			noticeType: "terminal_failure",
			actorProfileId: input.actorProfileId,
			actorName: "Runner",
			...(input.dispatchId === null
				? {}
				: { dispatchId: input.dispatchId ?? "dispatch-terminal-1" }),
			...(input.failureStage ? { failureStage: input.failureStage } : {}),
			...(input.replyToSignalId
				? {
						replyTo: {
							previewText: "Wake source message",
							profileId: DEFAULT_SPACE_PROFILE_ID,
							profileKind: "human",
							profileName: "Mira",
							signalId: input.replyToSignalId,
						},
					}
				: {}),
			text:
				input.text ??
				"Runner could not complete this Wake. Check OpenMeld Service and try again.",
			generatedBy: "openmeld",
		},
	};
}

function createExecutionRecoveryAvailableSignal(input: {
	actorProfileId: string;
	dispatchId: string;
	id: string;
	replyToSignalId: string;
	resultRef: string;
}): SignalEnvelope {
	return {
		v: 1,
		id: input.id,
		spaceId: "space-123",
		ts: 11,
		profile: {
			kind: "system",
			profileId: "openmeld-system",
			profileName: "OpenMeld",
		},
		type: "signal.system_notice",
		data: {
			noticeType: "execution_recovery_available",
			actorProfileId: input.actorProfileId,
			dispatchId: input.dispatchId,
			generatedBy: "openmeld",
			replyTo: {
				previewText: "@Runner finish the report",
				profileId: DEFAULT_SPACE_PROFILE_ID,
				profileKind: "human",
				profileName: "Mira",
				signalId: input.replyToSignalId,
			},
			resultRef: input.resultRef,
			text: "OpenMeld retained the completed result.",
		},
	} as SignalEnvelope;
}

function createPresenceSignal(input: {
	id: string;
	ts?: number;
	type: "presence.join" | "presence.quit";
}) {
	return {
		v: 1,
		id: input.id,
		spaceId: "space-123",
		ts: input.ts ?? 10,
		profile: {
			kind: "human",
			profileId: "11111111-1111-1111-1111-111111111111",
			profileName: "Mira",
		},
		type: input.type,
		data: {
			role: "participant",
		},
	};
}

function createLiveSignalFrame(input: {
	historyPersisted: boolean;
	signal:
		| ReturnType<typeof createPresenceSignal>
		| ReturnType<typeof createTextSignal>;
}) {
	return {
		type: "space.signal",
		signal: input.signal,
		history: {
			persisted: input.historyPersisted,
		},
	};
}

function createStructuredFailure(input: {
	code: string;
	message: string;
	requestId?: string | null;
}) {
	return {
		code: input.code,
		message: input.message,
		requestId: input.requestId ?? null,
		status: null,
		upstreamCode: null,
	};
}

class FakeWebSocket {
	static instances: FakeWebSocket[] = [];
	url: string;
	readonly sentFrames: string[] = [];
	private readonly listeners = new Map<
		string,
		Set<(event?: unknown) => void | Promise<void>>
	>();

	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
	}

	static reset() {
		FakeWebSocket.instances = [];
	}

	addEventListener(
		type: string,
		listener: (event?: unknown) => void | Promise<void>
	) {
		if (!this.listeners.has(type)) {
			this.listeners.set(type, new Set());
		}
		this.listeners.get(type)?.add(listener);
	}

	removeEventListener(
		type: string,
		listener: (event?: unknown) => void | Promise<void>
	) {
		this.listeners.get(type)?.delete(listener);
	}

	send(data: string) {
		this.sentFrames.push(data);
	}

	async emitOpen() {
		await this.emit("open");
		await this.emit("message", {
			data: JSON.stringify({
				type: "system.hello.ack",
				profile: {
					kind: "human",
					profileId: DEFAULT_SPACE_PROFILE_ID,
				},
			}),
		});
	}

	async emitMessage(data: unknown) {
		await this.emit("message", {
			data,
		});
	}

	async emitClose(code = 1000, reason = "") {
		await this.emit("close", {
			code,
			reason,
		});
	}

	async emitError() {
		await this.emit("error", new Event("error"));
	}

	close() {
		this.emitClose().catch(() => undefined);
	}

	private async emit(type: string, event?: unknown) {
		for (const listener of this.listeners.get(type) ?? []) {
			await listener(event);
		}
	}
}

async function flushReactEffects() {
	await act(async () => {
		await Promise.resolve();
	});
}
