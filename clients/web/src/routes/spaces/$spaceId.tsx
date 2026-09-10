"use client";

import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import { normalizeSpacePasswordText } from "@openmeld/schemas";
import type {
	AuthProfileView,
	GetSpaceEntryResolutionResponse,
	GetSpaceStatusResponse,
	SignalEnvelope,
	SpaceAccessMode,
	SpaceThread,
	SpaceThreadPreview,
	SpaceViewerMembershipResponse,
} from "@openmeld/schemas/types";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { OpenMeldLogoStrong } from "@openmeld/ui/components/openmeld-logo-strong";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { LockKeyIcon, SignInIcon, UserIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { z } from "zod/v4";
import { CrossPageHeader } from "#/components/app/cross-page-header";
import {
	APP_PAGE_FRAME_CLASS_NAME,
	APP_PAGE_FRAME_PADDING_CLASS_NAME,
} from "#/components/app/shell-layout";
import { StartFlowStateProvider } from "#/components/app/start-flow-state";
import type { SpaceComposerInputRef } from "#/components/spaces/space-composer-editor";
import { SpaceConversationPanel } from "#/components/spaces/space-conversation-panel";
import { SpaceEntryGate } from "#/components/spaces/space-entry-gate";
import { SpaceFilesPanel } from "#/components/spaces/space-files-panel";
import { SpaceWindowHeader } from "#/components/spaces/space-header";
import { SpaceLanding } from "#/components/spaces/space-landing";
import { SpaceThreadPanel } from "#/components/spaces/space-thread-panel";
import type { SpaceView } from "#/components/spaces/space-view";
import { SpaceViewTabs } from "#/components/spaces/space-view-tabs";
import { useSpaceMessageReferences } from "#/components/spaces/use-space-message-references";
import { getSession } from "#/lib/auth-session";
import { recordProfileSpaceHistory } from "#/lib/onboarding/record-profile-space-history";
import { buildOrganizationSpacePath } from "#/lib/organizations/organization-routes";
import {
	resolveActiveOrganizationHumanProfilesPath,
	resolveActiveOrganizationSpacePath,
} from "#/lib/organizations/organization-scope";
import { listStartProfiles } from "#/lib/profiles/existing-profiles";
import { buildProfileRequestContext } from "#/lib/profiles/human-profiles";
import { listActiveProfilesByKind } from "#/lib/profiles/profiles";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { isProtectedSpaceFailure } from "#/lib/spaces/errors";
import { rememberProtectedSpaceAccess } from "#/lib/spaces/protected-space-access";
import { buildSpaceTimelineItems } from "#/lib/spaces/timeline";
import { baseQueryOptions } from "#/query/query-config";

const PUBLIC_SIGNAL_LIMIT = 80;
const PUBLIC_VIEWER_PROFILE_ID = "__public_space_viewer__";
const EMPTY_SIGNALS: readonly SignalEnvelope[] = [];
const EMPTY_THREADS: readonly SpaceThread[] = [];
const EMPTY_THREAD_PREVIEWS: readonly SpaceThreadPreview[] = [];
const EMPTY_AGENT_RECOVERY_PLANS = new Map<string, never>();
const EMPTY_EPHEMERAL_ACTIVITY_ITEMS: readonly never[] = [];
const EMPTY_WAKE_FAILURE_TARGET_CONTEXTS = new Map<string, never>();

const publicSpaceRouteSearchSchema = z.object({
	focusInteractionId: z.string().trim().min(1).optional(),
	focusSignalId: z.string().trim().min(1).optional(),
	focusThreadRootSignalId: z.string().trim().min(1).optional(),
	signalId: z.string().trim().min(1).optional(),
	threadRootSignalId: z.string().trim().min(1).optional(),
});

type PublicSpaceFocus = {
	signalId?: string;
	threadRootSignalId?: string;
};

function buildPublicSpacePath(
	spaceId: string,
	focus: PublicSpaceFocus
): string {
	const url = new URL(
		`/spaces/${encodeURIComponent(spaceId)}`,
		"http://localhost"
	);
	if (focus.signalId) {
		url.searchParams.set("signalId", focus.signalId);
	}
	if (focus.threadRootSignalId) {
		url.searchParams.set("threadRootSignalId", focus.threadRootSignalId);
	}
	return `${url.pathname}${url.search}`;
}

async function navigateToActiveOrganizationSpace(input: {
	navigate: ReturnType<typeof useNavigate>;
	profileId?: string;
	spaceId: string;
}) {
	const target = await resolveActiveOrganizationSpacePath({
		data: {
			...(input.profileId ? { profileId: input.profileId } : {}),
			routeFamily: `/spaces/${input.spaceId}`,
			spaceId: input.spaceId,
		},
	});
	await input.navigate({ replace: true, to: target });
}

async function navigateToOrganizationSpace(input: {
	focus: PublicSpaceFocus;
	navigate: ReturnType<typeof useNavigate>;
	organizationSlug: string;
	profileId?: string;
	spaceId: string;
}) {
	const target = buildOrganizationSpacePath({
		orgSlug: input.organizationSlug,
		search: {
			...(input.profileId ? { profileId: input.profileId } : {}),
			focusSignalId: input.focus.signalId,
			focusThreadRootSignalId: input.focus.threadRootSignalId,
		},
		spaceId: input.spaceId,
	});
	await input.navigate({ replace: true, to: target });
}

export const Route = createFileRoute("/spaces/$spaceId")({
	validateSearch: (search) => {
		const parsed = publicSpaceRouteSearchSchema.safeParse(search);
		return parsed.success ? parsed.data : {};
	},
	loader: async ({ location }) => {
		const session = await getSession({
			data: {
				currentUserSessionExpectation: "optional",
				routeFamily: location.pathname,
				sessionCacheMode: "bypass",
			},
		});
		return { isAuthenticated: Boolean(session) };
	},
	component: PublicSpaceRoute,
});

function PublicSpaceRoute() {
	const { spaceId } = Route.useParams();
	const { isAuthenticated } = Route.useLoaderData();
	const search = Route.useSearch();

	return (
		<PublicSpacePage
			isAuthenticated={isAuthenticated}
			signalId={search.focusSignalId ?? search.signalId}
			spaceId={spaceId}
			threadRootSignalId={
				search.focusThreadRootSignalId ?? search.threadRootSignalId
			}
		/>
	);
}

export function PublicSpacePage(input: {
	isAuthenticated: boolean;
	signalId?: string;
	spaceId: string;
	threadRootSignalId?: string;
}) {
	const focus = {
		...(input.signalId ? { signalId: input.signalId } : {}),
		...(input.threadRootSignalId
			? { threadRootSignalId: input.threadRootSignalId }
			: {}),
	};
	return (
		<SpaceEntryGate
			backHref="/"
			redirectToOrganization
			renderFrame={(content) => (
				<PublicSpaceEntryFrame>{content}</PublicSpaceEntryFrame>
			)}
			signalId={input.signalId}
			signInHref={`/login?redirect=${encodeURIComponent(
				buildPublicSpacePath(input.spaceId, focus)
			)}`}
			spaceId={input.spaceId}
			threadRootSignalId={input.threadRootSignalId}
		>
			{(resolution) =>
				resolution.view.state === "allowed" &&
				resolution.view.experience === "guest" ? (
					<GuestSpacePage
						signalId={input.signalId}
						spaceId={input.spaceId}
						threadRootSignalId={input.threadRootSignalId}
					/>
				) : (
					<PublicSpaceResolvedPage
						entryResolution={resolution}
						isAuthenticated={input.isAuthenticated}
						signalId={input.signalId}
						spaceId={input.spaceId}
						threadRootSignalId={input.threadRootSignalId}
					/>
				)
			}
		</SpaceEntryGate>
	);
}

function GuestSpacePage(input: {
	spaceId: string;
	signalId?: string;
	threadRootSignalId?: string;
}) {
	const profiles = useQuery({
		queryKey: ["public-space-join-profiles"],
		queryFn: listStartProfiles,
	});
	const human =
		listActiveProfilesByKind(profiles.data ?? [], "human").find(
			(profile) => profile.isDefault
		) ?? listActiveProfilesByKind(profiles.data ?? [], "human")[0];
	if (profiles.isPending) {
		return (
			<PublicSpaceEntryFrame>
				<p>Loading your Space…</p>
			</PublicSpaceEntryFrame>
		);
	}
	if (profiles.isError || !human) {
		return (
			<PublicSpaceEntryFrame>
				<p role="alert">Couldn't load your account.</p>
				<Button onClick={() => profiles.refetch()}>Try again</Button>
			</PublicSpaceEntryFrame>
		);
	}
	return (
		<StartFlowStateProvider storageScope={human.ownerUserId}>
			<div className="flex h-dvh min-h-0 flex-col">
				<SpaceLanding
					accountProfiles={[human]}
					conversationControl={
						<span className="text-muted-foreground text-xs">Guest</span>
					}
					initialFocusSignalId={input.signalId}
					initialFocusThreadRootSignalId={input.threadRootSignalId}
					isGuest
					profileId={human.openMeldProfileId}
					spaceId={input.spaceId}
				/>
			</div>
		</StartFlowStateProvider>
	);
}

function PublicSpaceResolvedPage(input: {
	entryResolution: GetSpaceEntryResolutionResponse;
	isAuthenticated: boolean;
	signalId?: string;
	spaceId: string;
	threadRootSignalId?: string;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const generatedSpaceViewId = useId();
	const spaceViewIdPrefix = `space-view-${generatedSpaceViewId}`;
	const [spaceView, setSpaceView] = useState<SpaceView>("messages");
	const [spaceFileToOpen, setSpaceFileToOpen] = useState<{
		fileId: string;
		requestId: string;
		revision: number;
	} | null>(null);
	const [selectedThreadId, setSelectedThreadId] = useState<
		string | null | undefined
	>(undefined);
	const textareaRef: SpaceComposerInputRef = useRef(null);
	const threadTextareaRef: SpaceComposerInputRef = useRef(null);
	const openSpaceFile = (fileId: string, revision: number) => {
		setSpaceFileToOpen({
			fileId,
			requestId: crypto.randomUUID(),
			revision,
		});
		setSelectedThreadId(null);
		setSpaceView("files");
	};

	const {
		protectedFailure: spaceProtectedFailure,
		signalsQuery,
		statusQuery,
		threadsQuery,
		viewerMembershipQuery,
	} = usePublicSpaceQueries({
		isAuthenticated: input.isAuthenticated,
		spaceId: input.spaceId,
	});
	useOpenAuthenticatedMemberSpace({
		activeMemberCount:
			viewerMembershipQuery.data?.activeMemberProfiles.length ?? 0,
		navigate,
		organizationSlug: input.entryResolution.safeContext.organizationSlug,
		signalId: input.signalId,
		spaceId: input.spaceId,
		threadRootSignalId: input.threadRootSignalId,
	});

	const refetchSpace = async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: publicSpaceQueryKey(input.spaceId, "status"),
			}),
			queryClient.invalidateQueries({
				queryKey: publicSpaceQueryKey(input.spaceId, "signals"),
			}),
			queryClient.invalidateQueries({
				queryKey: publicSpaceQueryKey(input.spaceId, "threads"),
			}),
			queryClient.invalidateQueries({
				queryKey: publicSpaceQueryKey(input.spaceId, "viewer-membership"),
			}),
			queryClient.invalidateQueries({
				queryKey: publicSpaceQueryKey(input.spaceId, "thread-signals"),
			}),
		]);
	};

	const passwordAccess = useProtectedSpacePassword({
		onAccepted: refetchSpace,
		spaceId: input.spaceId,
	});

	const status = statusQuery.data ?? null;
	const spaceName = status?.name?.trim() || "Shared Space";
	const membership = viewerMembershipQuery.data ?? null;
	const signalEnvelopes = signalsQuery.data?.envelopes ?? EMPTY_SIGNALS;
	const threads = threadsQuery.data?.threads ?? EMPTY_THREADS;
	const threadPreviews = threadsQuery.data?.previews ?? EMPTY_THREAD_PREVIEWS;
	const initialThreadId = input.threadRootSignalId
		? (threads.find(
				(thread) => thread.rootSignalId === input.threadRootSignalId
			)?.threadId ?? null)
		: null;
	const effectiveSelectedThreadId =
		selectedThreadId === undefined ? initialThreadId : selectedThreadId;
	const threadSignalsQuery = usePublicThreadSignalsQuery({
		selectedThreadId: effectiveSelectedThreadId,
		spaceId: input.spaceId,
		statusIsSuccess: statusQuery.isSuccess,
	});
	const protectedFailure = findProtectedFailure([
		spaceProtectedFailure,
		threadSignalsQuery.error,
	]);
	const threadSignals = threadSignalsQuery.data?.signals ?? EMPTY_SIGNALS;
	const timelineItems = useMemo(
		() =>
			buildSpaceTimelineItems({
				envelopes: signalEnvelopes,
				membersSnapshot: null,
			}),
		[signalEnvelopes]
	);
	const spaceReferenceMessageTexts = useMemo(() => {
		const threadTimelineItems = buildSpaceTimelineItems({
			envelopes: threadSignals,
			membersSnapshot: null,
		});
		return [...timelineItems, ...threadTimelineItems].map((item) => item.text);
	}, [threadSignals, timelineItems]);
	const spaceReferencesById = useSpaceMessageReferences({
		accountProfileId: null,
		currentSpace: status
			? { name: status.name ?? null, spaceId: input.spaceId }
			: null,
		messageTexts: spaceReferenceMessageTexts,
		organizationId: null,
		organizationSlug: null,
	});
	const activeThread = useMemo(
		() =>
			effectiveSelectedThreadId === null
				? null
				: (threads.find(
						(thread) => thread.threadId === effectiveSelectedThreadId
					) ?? null),
		[effectiveSelectedThreadId, threads]
	);

	if (protectedFailure) {
		return (
			<PublicSpaceChrome
				focus={{
					signalId: input.signalId,
					threadRootSignalId: input.threadRootSignalId,
				}}
				isAuthenticated={input.isAuthenticated}
				membership={membership}
				passwordProtectedOverride={true}
				spaceId={input.spaceId}
				spaceName={spaceName}
				status={status}
			>
				<ProtectedSpaceForm
					errorMessage={resolveProtectedSpaceErrorMessage({
						failure: protectedFailure,
						passwordError: passwordAccess.error,
					})}
					isSubmitting={passwordAccess.isSubmitting}
					onPasswordChange={passwordAccess.onChange}
					onSubmit={passwordAccess.onSubmit}
					password={passwordAccess.value}
				/>
			</PublicSpaceChrome>
		);
	}

	const pageError = findDisplayFailure([
		statusQuery.error,
		signalsQuery.error,
		threadsQuery.error,
	]);

	return (
		<PublicSpaceOpenView
			activeThread={activeThread}
			historyIsPending={statusQuery.isPending || signalsQuery.isPending}
			initialFocusSignalId={input.signalId}
			initialFocusThreadRootSignalId={input.threadRootSignalId}
			isAuthenticated={input.isAuthenticated}
			membership={membership}
			onOpenSpaceFile={openSpaceFile}
			onRetry={refetchSpace}
			onSelectedThreadChange={setSelectedThreadId}
			onSpaceViewChange={setSpaceView}
			pageError={pageError}
			spaceFileToOpen={spaceFileToOpen}
			spaceId={input.spaceId}
			spaceName={spaceName}
			spaceReferencesById={spaceReferencesById}
			spaceView={spaceView}
			spaceViewIdPrefix={spaceViewIdPrefix}
			status={status}
			textareaRef={textareaRef}
			threadPreviews={threadPreviews}
			threadSignals={threadSignals}
			threadSignalsError={threadSignalsQuery.error}
			threadSignalsIsPending={threadSignalsQuery.isPending}
			threads={threads}
			threadTextareaRef={threadTextareaRef}
			timelineItems={timelineItems}
		/>
	);
}

function usePublicSpaceQueries(input: {
	isAuthenticated: boolean;
	spaceId: string;
}) {
	const browserQueriesEnabled = typeof window !== "undefined";
	const statusQuery = useQuery({
		enabled: browserQueriesEnabled,
		queryKey: publicSpaceQueryKey(input.spaceId, "status"),
		queryFn: async () =>
			await createUnscopedWebSpaceApi().getStatus({ spaceId: input.spaceId }),
		gcTime: baseQueryOptions.gcTime,
		retry: shouldRetryPublicSpaceQuery,
		staleTime: baseQueryOptions.staleTime,
		refetchOnWindowFocus: false,
	});
	const signalsQuery = useQuery({
		enabled: browserQueriesEnabled,
		queryKey: publicSpaceQueryKey(input.spaceId, "signals"),
		queryFn: async () =>
			await createUnscopedWebSpaceApi().listSignalEnvelopes({
				spaceId: input.spaceId,
				query: { limit: PUBLIC_SIGNAL_LIMIT, recent: true },
			}),
		gcTime: baseQueryOptions.gcTime,
		retry: shouldRetryPublicSpaceQuery,
		staleTime: baseQueryOptions.staleTime,
		refetchOnWindowFocus: false,
	});
	const threadsQuery = useQuery({
		enabled: browserQueriesEnabled,
		queryKey: publicSpaceQueryKey(input.spaceId, "threads"),
		queryFn: async () =>
			await createUnscopedWebSpaceApi().listThreads({ spaceId: input.spaceId }),
		gcTime: baseQueryOptions.gcTime,
		retry: shouldRetryPublicSpaceQuery,
		staleTime: baseQueryOptions.staleTime,
		refetchOnWindowFocus: false,
	});
	const viewerMembershipQuery = useQuery({
		enabled:
			browserQueriesEnabled && input.isAuthenticated && statusQuery.isSuccess,
		queryKey: publicSpaceQueryKey(input.spaceId, "viewer-membership"),
		queryFn: async () =>
			await createUnscopedWebSpaceApi().getViewerMembership({
				spaceId: input.spaceId,
			}),
		gcTime: baseQueryOptions.gcTime,
		retry: shouldRetryPublicSpaceQuery,
		staleTime: baseQueryOptions.staleTime,
		refetchOnWindowFocus: false,
	});
	return {
		protectedFailure: findProtectedFailure([
			statusQuery.error,
			signalsQuery.error,
			threadsQuery.error,
			viewerMembershipQuery.error,
		]),
		signalsQuery,
		statusQuery,
		threadsQuery,
		viewerMembershipQuery,
	};
}

function usePublicThreadSignalsQuery(input: {
	selectedThreadId: string | null;
	spaceId: string;
	statusIsSuccess: boolean;
}) {
	const browserQueriesEnabled = typeof window !== "undefined";
	return useQuery({
		enabled:
			browserQueriesEnabled &&
			input.selectedThreadId !== null &&
			input.statusIsSuccess,
		queryKey: [
			...publicSpaceQueryKey(input.spaceId, "thread-signals"),
			input.selectedThreadId,
		],
		queryFn: async () =>
			await createUnscopedWebSpaceApi().listThreadSignals({
				spaceId: input.spaceId,
				threadId: input.selectedThreadId ?? "",
			}),
		gcTime: baseQueryOptions.gcTime,
		retry: shouldRetryPublicSpaceQuery,
		staleTime: baseQueryOptions.staleTime,
		refetchOnWindowFocus: false,
	});
}

function useOpenAuthenticatedMemberSpace(input: {
	activeMemberCount: number;
	navigate: ReturnType<typeof useNavigate>;
	organizationSlug?: string;
	signalId?: string;
	spaceId: string;
	threadRootSignalId?: string;
}) {
	useEffect(() => {
		if (input.activeMemberCount === 0 || !input.organizationSlug) {
			return;
		}
		// Membership proves same-account access, not the browser's acting identity.
		// Omit profileId so the app route resolves the account's current Human
		// Profile instead of treating an Agent member as a Web viewer.
		navigateToOrganizationSpace({
			focus: {
				signalId: input.signalId,
				threadRootSignalId: input.threadRootSignalId,
			},
			navigate: input.navigate,
			organizationSlug: input.organizationSlug,
			spaceId: input.spaceId,
		}).catch((error) => {
			console.error("Failed to open the member Space view.", error);
		});
	}, [
		input.activeMemberCount,
		input.navigate,
		input.organizationSlug,
		input.signalId,
		input.spaceId,
		input.threadRootSignalId,
	]);
}

function useProtectedSpacePassword(input: {
	onAccepted: () => Promise<void>;
	spaceId: string;
}) {
	const [value, setValue] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	return {
		error,
		isSubmitting,
		onChange: (nextValue: string) => {
			setError(null);
			setValue(nextValue);
		},
		onSubmit: async () => {
			const normalizedPassword = normalizeSpacePasswordText(value);
			if (normalizedPassword.length === 0) {
				setError("Enter the space password.");
				return;
			}
			setIsSubmitting(true);
			setError(null);
			try {
				await rememberProtectedSpaceAccess({
					data: { password: normalizedPassword, spaceId: input.spaceId },
				});
				await input.onAccepted();
			} catch (submissionError) {
				setError(
					submissionError instanceof Error
						? submissionError.message
						: "OpenMeld could not store this space password right now."
				);
			} finally {
				setIsSubmitting(false);
			}
		},
		value,
	};
}

type PublicSpaceFileSelection = {
	fileId: string;
	requestId: string;
	revision: number;
};

type PublicSpaceOpenViewProps = {
	activeThread: SpaceThread | null;
	historyIsPending: boolean;
	initialFocusSignalId?: string;
	initialFocusThreadRootSignalId?: string;
	isAuthenticated: boolean;
	membership: SpaceViewerMembershipResponse | null;
	onOpenSpaceFile: (fileId: string, revision: number) => void;
	onRetry: () => Promise<void>;
	onSelectedThreadChange: (threadId: string | null) => void;
	onSpaceViewChange: (view: SpaceView) => void;
	pageError: StructuredApiClientFailure | null;
	spaceFileToOpen: PublicSpaceFileSelection | null;
	spaceId: string;
	spaceName: string;
	spaceReferencesById: ReturnType<typeof useSpaceMessageReferences>;
	spaceView: SpaceView;
	spaceViewIdPrefix: string;
	status: GetSpaceStatusResponse | null;
	textareaRef: SpaceComposerInputRef;
	threadPreviews: readonly SpaceThreadPreview[];
	threads: readonly SpaceThread[];
	threadSignals: readonly SignalEnvelope[];
	threadSignalsError: unknown;
	threadSignalsIsPending: boolean;
	threadTextareaRef: SpaceComposerInputRef;
	timelineItems: ReturnType<typeof buildSpaceTimelineItems>;
};

function PublicSpaceOpenView(input: PublicSpaceOpenViewProps) {
	return (
		<PublicSpaceChrome
			focus={{
				signalId: input.initialFocusSignalId,
				threadRootSignalId: input.initialFocusThreadRootSignalId,
			}}
			isAuthenticated={input.isAuthenticated}
			membership={input.membership}
			spaceId={input.spaceId}
			spaceName={input.spaceName}
			status={input.status}
			viewControl={
				input.pageError ? null : (
					<SpaceViewTabs
						activeView={input.spaceView}
						className="shrink-0"
						idPrefix={input.spaceViewIdPrefix}
						onViewChange={input.onSpaceViewChange}
					/>
				)
			}
		>
			{input.pageError ? (
				<PublicSpaceErrorState
					error={input.pageError}
					onRetry={() => {
						input.onRetry().catch((error) => {
							console.error("Failed to refresh public Space.", error);
						});
					}}
				/>
			) : (
				<PublicSpacePanels input={input} />
			)}
		</PublicSpaceChrome>
	);
}

function PublicSpacePanels({ input }: { input: PublicSpaceOpenViewProps }) {
	return (
		<>
			<SpaceConversationPanel
				activeSpaceView={input.spaceView}
				agentRecoveryPlansByProfileId={EMPTY_AGENT_RECOVERY_PLANS}
				allowedActions={input.status?.allowedActions ?? []}
				centerAgentProfileId={input.status?.centerAgentProfileId ?? null}
				className="min-w-0"
				composerBlockedWakeProfileId={null}
				composerErrorMessage={null}
				composerFiles={[]}
				composerReplyToSignalId={null}
				composerText=""
				currentOwnerUserId={null}
				emptyStateDescription={null}
				emptyStateTitle="No messages yet."
				ephemeralActivityItems={EMPTY_EPHEMERAL_ACTIVITY_ITEMS}
				files={
					<SpaceFilesPanel
						fileToOpen={input.spaceFileToOpen}
						key={input.spaceId}
						readOnly={true}
						spaceId={input.spaceId}
					/>
				}
				firstUnreadSignalId={null}
				historyActionErrorMessage={null}
				historyErrorMessage={null}
				initialFocusSignalId={input.initialFocusSignalId}
				isAgentRecoveryPending={() => false}
				isDiagnosticReportPending={() => false}
				isDiagnosticReportSent={() => false}
				membersSnapshot={null}
				modelCatalog={null}
				onAddComposerFiles={noopPromise}
				onAgentRecoveryAction={noopPromise}
				onClearComposerReplyTo={() => undefined}
				onComposerEditorChange={() => undefined}
				onCreateThread={noopPromise}
				onLoadEarlierHistory={noopPromise}
				onMentionButtonClick={() => undefined}
				onOpenSpaceFile={input.onOpenSpaceFile}
				onOpenThread={input.onSelectedThreadChange}
				onRemoveComposerFile={() => undefined}
				onReplyToMessage={() => undefined}
				onReportMessage={noopPromise}
				onSend={noopPromise}
				onSendStarterPrompt={noopPromise}
				onSpaceViewChange={input.onSpaceViewChange}
				presentedWakeProgressItems={EMPTY_EPHEMERAL_ACTIVITY_ITEMS}
				selfProfileId={PUBLIC_VIEWER_PROFILE_ID}
				spaceReferencesById={input.spaceReferencesById}
				spaceViewIdPrefix={input.spaceViewIdPrefix}
				textareaRef={input.textareaRef}
				threadPreviews={input.threadPreviews}
				threads={input.threads}
				timelineItems={input.timelineItems}
				unreadCount={0}
				viewState={{
					composerFileLimitReached: false,
					composerHasAuthoredMentions: false,
					hasEarlierHistory: false,
					historyIsPending: input.historyIsPending,
					isCenterAgentDirectMessage: false,
					isCreatingThread: false,
					isDirectMessage: false,
					isLoadingEarlierHistory: false,
					isPersonalContext: false,
					isSendingMessage: false,
					readOnly: true,
					threadsIsLoading: false,
					unreadStateReady: true,
				}}
				wakeFailureTargetContextsByProfileId={
					EMPTY_WAKE_FAILURE_TARGET_CONTEXTS
				}
			/>
			<SpaceThreadPanel
				activeThread={input.activeThread}
				agentDirectConversationKind={null}
				agentRecoveryPlansByProfileId={EMPTY_AGENT_RECOVERY_PLANS}
				agentStreams={[]}
				centerAgentProfileId={input.status?.centerAgentProfileId ?? null}
				composerBlockedWakeProfileId={null}
				composerErrorMessage={null}
				composerFileLimitReached={false}
				composerFiles={[]}
				composerText=""
				currentOwnerUserId={null}
				ephemeralActivityItems={EMPTY_EPHEMERAL_ACTIVITY_ITEMS}
				initialFocusSignalId={input.initialFocusSignalId}
				isAgentRecoveryPending={() => false}
				isDiagnosticReportPending={() => false}
				isDiagnosticReportSent={() => false}
				isSendingMessage={false}
				membersSnapshot={null}
				modelCatalog={null}
				onAddComposerFiles={noopPromise}
				onAgentRecoveryAction={noopPromise}
				onClose={() => input.onSelectedThreadChange(null)}
				onComposerEditorChange={() => undefined}
				onMentionButtonClick={() => undefined}
				onOpenSpaceFile={input.onOpenSpaceFile}
				onRemoveComposerFile={() => undefined}
				onReportMessage={noopPromise}
				onSend={noopPromise}
				readOnly={true}
				selfProfileId={PUBLIC_VIEWER_PROFILE_ID}
				signals={input.threadSignals}
				signalsErrorMessage={formatOptionalFailure(input.threadSignalsError)}
				signalsIsLoading={input.threadSignalsIsPending}
				spaceReferencesById={input.spaceReferencesById}
				spaceTimelineItems={input.timelineItems}
				textareaRef={input.threadTextareaRef}
				wakeFailureTargetContextsByProfileId={
					EMPTY_WAKE_FAILURE_TARGET_CONTEXTS
				}
			/>
		</>
	);
}

function PublicSpaceEntryFrame(input: { children: ReactNode }) {
	return (
		<div className="flex min-h-dvh flex-col bg-background text-foreground">
			<CrossPageHeader
				brandStatusLabel={null}
				currentSection="space"
				frameSection="start"
				includeSpaces={true}
			/>
			<main className="flex flex-1 items-center justify-center px-6 py-10">
				{input.children}
			</main>
		</div>
	);
}

function PublicSpaceChrome(input: {
	children: ReactNode;
	focus?: PublicSpaceFocus;
	isAuthenticated: boolean;
	membership: SpaceViewerMembershipResponse | null;
	passwordProtectedOverride?: boolean;
	spaceId: string;
	spaceName: string;
	status: GetSpaceStatusResponse | null;
	viewControl?: ReactNode;
}) {
	const accessMode: SpaceAccessMode = input.passwordProtectedOverride
		? "protected"
		: (input.status?.accessMode ?? "public");

	return (
		<div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
			<CrossPageHeader
				brandStatusLabel={null}
				currentSection="space"
				frameSection="start"
				includeSpaces={true}
			/>
			<main className="flex min-h-0 flex-1 overflow-hidden">
				<PublicSpaceMainFrame
					accessMode={accessMode}
					focus={input.focus}
					isAuthenticated={input.isAuthenticated}
					membership={input.membership}
					spaceId={input.spaceId}
					spaceName={input.spaceName}
					viewControl={input.viewControl}
				>
					{input.children}
				</PublicSpaceMainFrame>
			</main>
		</div>
	);
}

function PublicSpaceMainFrame(input: {
	accessMode: SpaceAccessMode;
	children: ReactNode;
	focus?: PublicSpaceFocus;
	isAuthenticated: boolean;
	membership: SpaceViewerMembershipResponse | null;
	spaceId: string;
	spaceName: string;
	viewControl?: ReactNode;
}) {
	return (
		<div className="flex min-h-0 flex-1 overflow-hidden">
			<section
				className={`mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden border-border border-x bg-background ${APP_PAGE_FRAME_PADDING_CLASS_NAME} ${APP_PAGE_FRAME_CLASS_NAME}`}
			>
				<PublicSpaceContextHeader
					accessMode={input.accessMode}
					focus={input.focus}
					isAuthenticated={input.isAuthenticated}
					membership={input.membership}
					spaceId={input.spaceId}
					spaceName={input.spaceName}
					viewControl={input.viewControl}
				/>
				<div className="flex min-h-0 flex-1 overflow-hidden">
					{input.children}
				</div>
			</section>
		</div>
	);
}

function PublicSpaceContextHeader(input: {
	accessMode: SpaceAccessMode;
	focus?: PublicSpaceFocus;
	isAuthenticated: boolean;
	membership: SpaceViewerMembershipResponse | null;
	spaceId: string;
	spaceName: string;
	viewControl?: ReactNode;
}) {
	return (
		<SpaceWindowHeader
			actions={
				<PublicSpaceViewerAction
					accessMode={input.accessMode}
					focus={input.focus}
					isAuthenticated={input.isAuthenticated}
					membership={input.membership}
					spaceId={input.spaceId}
					spaceName={input.spaceName}
				/>
			}
			contentClassName="px-0"
			leadingControl={
				<Link
					aria-label="OpenMeld home"
					className="shrink-0 text-foreground"
					to="/"
				>
					<OpenMeldLogoStrong className="text-foreground" scale={0.32} />
				</Link>
			}
			navigation={input.viewControl}
			title={input.spaceName}
			titleAdornment={
				<span className="shrink-0 text-muted-foreground text-xs">
					{resolvePublicSpaceAccessLabel(input.accessMode)}
				</span>
			}
		/>
	);
}

function PublicSpaceViewerAction(input: {
	accessMode: SpaceAccessMode;
	focus?: PublicSpaceFocus;
	isAuthenticated: boolean;
	membership: SpaceViewerMembershipResponse | null;
	spaceId: string;
	spaceName: string;
}) {
	if (!input.isAuthenticated) {
		return (
			<Link
				className={buttonVariants({ size: "sm", variant: "outline" })}
				search={{
					redirect: buildPublicSpacePath(input.spaceId, input.focus ?? {}),
				}}
				to="/login"
			>
				<SignInIcon aria-hidden="true" className="size-4" />
				Sign in
			</Link>
		);
	}

	const profiles = input.membership?.activeMemberProfiles ?? [];

	// Authenticated but no profile in this account is a member yet → offer to join
	// in place
	// as one of the viewer's own human profiles. Membership is a server-side
	// fact (addMembers); we never gate the join on local agent readiness — agents
	// are brought in later from inside the Space (deferred-binding).
	if (profiles.length > 0) {
		return null;
	}

	return (
		<PublicSpaceJoinAction
			accessMode={input.accessMode}
			spaceId={input.spaceId}
			spaceName={input.spaceName}
		/>
	);
}

function PublicSpaceJoinAction(input: {
	accessMode: SpaceAccessMode;
	spaceId: string;
	spaceName: string;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [password, setPassword] = useState("");
	const [passwordError, setPasswordError] = useState<string | null>(null);
	const joinRequiresPassword = input.accessMode === "public_view_join_password";
	const profilesQuery = useQuery({
		gcTime: baseQueryOptions.gcTime,
		queryFn: async () => await listStartProfiles(),
		queryKey: ["public-space-join-profiles"],
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: baseQueryOptions.staleTime,
	});
	const humanProfiles = listActiveProfilesByKind(
		profilesQuery.data ?? [],
		"human"
	);

	const joinMutation = useMutation({
		mutationFn: async (joinInput: {
			humanProfile: AuthProfileView;
			password?: string;
		}) => {
			const { humanProfile } = joinInput;
			await createUnscopedWebSpaceApi({
				openMeldProfileId: humanProfile.openMeldProfileId,
			}).addMembers({
				memberProfileIds: [humanProfile.openMeldProfileId],
				requestContext: buildProfileRequestContext(humanProfile),
				...(joinInput.password === undefined
					? {}
					: { spacePassword: joinInput.password }),
				spaceId: input.spaceId,
			});
			try {
				await recordProfileSpaceHistory({
					creatorKind: "human",
					creatorProfileId: humanProfile.openMeldProfileId,
					profileIds: [humanProfile.openMeldProfileId],
					spaceId: input.spaceId,
					spaceName: input.spaceName,
				});
			} catch (error) {
				console.warn(
					"OpenMeld joined the Space but could not update Space history.",
					error
				);
			}
			return humanProfile.openMeldProfileId;
		},
		onSuccess: async (joinedProfileId) => {
			await queryClient.invalidateQueries({
				queryKey: publicSpaceQueryKey(input.spaceId, "viewer-membership"),
			});
			navigateToActiveOrganizationSpace({
				navigate,
				profileId: joinedProfileId,
				spaceId: input.spaceId,
			}).catch((error: unknown) => {
				console.error(
					"OpenMeld joined the Space but could not open it.",
					error
				);
			});
		},
	});

	if (profilesQuery.isPending) {
		return (
			<Button disabled size="sm" type="button" variant="outline">
				Join Space
			</Button>
		);
	}

	// Authenticated but no usable Human Profile yet → send them to Profiles to
	// create one before they can join.
	if (humanProfiles.length === 0) {
		return (
			<button
				className={buttonVariants({ size: "sm", variant: "outline" })}
				onClick={() => {
					resolveActiveOrganizationHumanProfilesPath({
						data: { routeFamily: `/spaces/${input.spaceId}` },
					})
						.then((target) => navigate({ to: target }))
						.catch((error) => {
							console.error("Failed to open profile setup.", error);
						});
				}}
				type="button"
			>
				Create a Profile
			</button>
		);
	}

	const joinError = joinMutation.isError
		? toStructuredApiClientFailure(joinMutation.error).message
		: null;
	const displayedJoinError = passwordError ?? joinError;
	const submitJoin = (humanProfile: AuthProfileView) => {
		const normalizedPassword = normalizeSpacePasswordText(password);
		if (joinRequiresPassword && normalizedPassword.length === 0) {
			setPasswordError("Enter the Space password to join.");
			return;
		}
		setPasswordError(null);
		joinMutation.mutate({
			humanProfile,
			...(joinRequiresPassword ? { password: normalizedPassword } : {}),
		});
	};

	const action =
		humanProfiles.length === 1 ? (
			<Button
				disabled={joinMutation.isPending}
				onClick={() => submitJoin(humanProfiles[0])}
				size="sm"
				type="button"
			>
				<SignInIcon aria-hidden="true" className="size-4" />
				{joinMutation.isPending
					? "Joining…"
					: `Join as ${humanProfiles[0].profileName}`}
			</Button>
		) : (
			<Select
				onValueChange={(profileId) => {
					const selected = humanProfiles.find(
						(profile) => profile.openMeldProfileId === profileId
					);
					if (selected) {
						submitJoin(selected);
					}
				}}
				value=""
			>
				<SelectTrigger
					aria-label="Join Space as"
					className="h-9 w-44 sm:w-64"
					placeholder="Join Space as..."
					variant="bordered"
				/>
				<SelectContent className="max-h-72">
					<SelectGroup>
						<SelectLabel>People</SelectLabel>
						{humanProfiles.map((profile, index) => (
							<SelectItem
								icon={UserIcon}
								index={index}
								key={profile.openMeldProfileId}
								value={profile.openMeldProfileId}
							>
								{profile.profileName}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		);

	return (
		<div className="flex flex-col items-end gap-2">
			{joinRequiresPassword ? (
				<Input
					aria-label="Space password"
					autoComplete="current-password"
					className="h-9 w-44 sm:w-64"
					disabled={joinMutation.isPending}
					onChange={(event) => {
						setPassword(event.target.value);
						setPasswordError(null);
					}}
					placeholder="Space password"
					type="password"
					value={password}
				/>
			) : null}
			{action}
			{displayedJoinError ? (
				<p className="max-w-[16rem] text-right text-destructive text-xs">
					{displayedJoinError}
				</p>
			) : null}
		</div>
	);
}

function resolvePublicSpaceAccessLabel(accessMode: SpaceAccessMode): string {
	switch (accessMode) {
		case "protected":
			return "Password protected";
		case "public_view_join_password":
			return "Password to join";
		default:
			return "Public";
	}
}

function ProtectedSpaceForm(input: {
	errorMessage: string | null;
	isSubmitting: boolean;
	onPasswordChange: (value: string) => void;
	onSubmit: () => Promise<void>;
	password: string;
}) {
	return (
		<ScrollArea className="min-h-0 flex-1" orientation="vertical">
			<section className="flex items-center justify-center px-4 py-10">
				<form
					className="flex w-full max-w-md flex-col gap-5 border border-border bg-background px-5 py-5"
					onSubmit={(event) => {
						event.preventDefault();
						input.onSubmit().catch((error) => {
							console.error("Failed to unlock protected Space.", error);
						});
					}}
				>
					<div className="flex items-center gap-3">
						<div className="flex size-10 items-center justify-center border border-border bg-muted">
							<LockKeyIcon aria-hidden="true" className="size-5" />
						</div>
						<div>
							<h2 className="font-semibold text-lg">
								View This Protected Space
							</h2>
							<p className="text-muted-foreground text-sm">
								Enter the space password to view the conversation.
							</p>
						</div>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="space-password">Space password</Label>
						<Input
							autoComplete="current-password"
							id="space-password"
							onChange={(event) => input.onPasswordChange(event.target.value)}
							type="password"
							value={input.password}
						/>
					</div>
					{input.errorMessage ? (
						<p className="text-destructive text-sm">{input.errorMessage}</p>
					) : null}
					<Button disabled={input.isSubmitting} type="submit">
						View Space
					</Button>
				</form>
			</section>
		</ScrollArea>
	);
}

function PublicSpaceErrorState(input: {
	error: StructuredApiClientFailure;
	onRetry: () => void;
}) {
	return (
		<ScrollArea className="min-h-0 flex-1" orientation="vertical">
			<section className="flex items-center justify-center px-4 py-10">
				<div className="w-full max-w-md border border-border px-5 py-5">
					<h2 className="font-semibold text-lg">Space unavailable</h2>
					<p className="mt-2 text-muted-foreground text-sm">
						{input.error.message}
					</p>
					<Button className="mt-4" onClick={input.onRetry} type="button">
						Try Again
					</Button>
				</div>
			</section>
		</ScrollArea>
	);
}

function publicSpaceQueryKey(spaceId: string, key: string) {
	return ["public-space", spaceId, key] as const;
}

function shouldRetryPublicSpaceQuery(
	failureCount: number,
	error: unknown
): boolean {
	if (isProtectedSpaceFailure(toStructuredApiClientFailure(error))) {
		return false;
	}
	return baseQueryOptions.retry(failureCount, error);
}

function findProtectedFailure(
	errors: readonly unknown[]
): StructuredApiClientFailure | null {
	for (const error of errors) {
		if (!error) {
			continue;
		}
		const failure = toStructuredApiClientFailure(error);
		if (isProtectedSpaceFailure(failure)) {
			return failure;
		}
	}
	return null;
}

function resolveProtectedSpaceErrorMessage(input: {
	failure: StructuredApiClientFailure;
	passwordError: string | null;
}): string | null {
	if (input.passwordError) {
		return input.passwordError;
	}
	if (input.failure.code === "space.password_invalid") {
		return "That password is not correct.";
	}
	if (input.failure.code === "space.password_rate_limited") {
		return input.failure.message;
	}
	return null;
}

function findDisplayFailure(
	errors: readonly unknown[]
): StructuredApiClientFailure | null {
	for (const error of errors) {
		if (!error) {
			continue;
		}
		return toStructuredApiClientFailure(error);
	}
	return null;
}

function formatOptionalFailure(error: unknown): string | null {
	if (!error) {
		return null;
	}
	return toStructuredApiClientFailure(error).message;
}

function noopPromise(): Promise<void> {
	return Promise.resolve();
}
