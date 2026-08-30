"use client";

import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import { normalizeSpacePasswordText } from "@openmeld/schemas";
import type {
	AuthProfileView,
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
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectSeparator,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import {
	LockKeyIcon,
	RobotIcon,
	SignInIcon,
	UserIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CrossPageHeader } from "#/components/app/cross-page-header";
import {
	APP_PAGE_FRAME_CLASS_NAME,
	APP_PAGE_FRAME_PADDING_CLASS_NAME,
} from "#/components/app/shell-layout";
import { SpaceConversationPanel } from "#/components/spaces/space-conversation-panel";
import { SpaceFilesPanel } from "#/components/spaces/space-files-panel";
import { SpaceWindowHeader } from "#/components/spaces/space-header";
import { SpaceThreadPanel } from "#/components/spaces/space-thread-panel";
import type { SpaceView } from "#/components/spaces/space-view";
import { SpaceViewTabs } from "#/components/spaces/space-view-tabs";
import type {
	SpaceComposerSelection,
	SpaceMentionPopoverState,
} from "#/components/spaces/use-space-mention-authoring";
import { useSpaceMessageReferences } from "#/components/spaces/use-space-message-references";
import { getSession } from "#/lib/auth-session";
import { recordProfileSpaceHistory } from "#/lib/onboarding/record-profile-space-history";
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
const EMPTY_COMPOSER_SELECTION: SpaceComposerSelection = { end: 0, start: 0 };
const CLOSED_MENTION_POPOVER: SpaceMentionPopoverState = { kind: "closed" };
type PublicSpaceMemberProfile =
	SpaceViewerMembershipResponse["activeMemberProfiles"][number];

function buildPublicSpacePostSignInRedirect(spaceId: string): string {
	return `/spaces/${encodeURIComponent(spaceId)}`;
}

async function navigateToActiveOrganizationSpace(input: {
	navigate: ReturnType<typeof useNavigate>;
	profileId: string;
	spaceId: string;
}) {
	const target = await resolveActiveOrganizationSpacePath({
		data: {
			profileId: input.profileId,
			routeFamily: `/spaces/${input.spaceId}`,
			spaceId: input.spaceId,
		},
	});
	await input.navigate({ to: target });
}

export const Route = createFileRoute("/spaces/$spaceId")({
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

	return (
		<PublicSpacePage isAuthenticated={isAuthenticated} spaceId={spaceId} />
	);
}

export function PublicSpacePage(input: {
	isAuthenticated: boolean;
	spaceId: string;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const browserQueriesEnabled = typeof window !== "undefined";
	const generatedSpaceViewId = useId();
	const spaceViewIdPrefix = `space-view-${generatedSpaceViewId}`;
	const [spaceView, setSpaceView] = useState<SpaceView>("messages");
	const [spaceFileToOpen, setSpaceFileToOpen] = useState<{
		fileId: string;
		requestId: string;
		revision: number;
	} | null>(null);
	const [password, setPassword] = useState("");
	const [passwordError, setPasswordError] = useState<string | null>(null);
	const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
	const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const threadTextareaRef = useRef<HTMLTextAreaElement | null>(null);
	const openSpaceFile = (fileId: string, revision: number) => {
		setSpaceFileToOpen({
			fileId,
			requestId: crypto.randomUUID(),
			revision,
		});
		setSelectedThreadId(null);
		setSpaceView("files");
	};

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
	const threadSignalsQuery = useQuery({
		enabled:
			browserQueriesEnabled &&
			selectedThreadId !== null &&
			statusQuery.isSuccess,
		queryKey: [
			...publicSpaceQueryKey(input.spaceId, "thread-signals"),
			selectedThreadId,
		],
		queryFn: async () =>
			await createUnscopedWebSpaceApi().listThreadSignals({
				spaceId: input.spaceId,
				threadId: selectedThreadId ?? "",
			}),
		gcTime: baseQueryOptions.gcTime,
		retry: shouldRetryPublicSpaceQuery,
		staleTime: baseQueryOptions.staleTime,
		refetchOnWindowFocus: false,
	});

	const protectedFailure = findProtectedFailure([
		statusQuery.error,
		signalsQuery.error,
		threadsQuery.error,
		viewerMembershipQuery.error,
		threadSignalsQuery.error,
	]);

	useEffect(() => {
		const preferredOpenProfileId =
			viewerMembershipQuery.data?.preferredOpenProfileId ?? null;
		if (!preferredOpenProfileId) {
			return;
		}
		navigateToActiveOrganizationSpace({
			navigate,
			profileId: preferredOpenProfileId,
			spaceId: input.spaceId,
		}).catch((error) => {
			console.error("Failed to open the member Space view.", error);
		});
	}, [
		input.spaceId,
		navigate,
		viewerMembershipQuery.data?.preferredOpenProfileId,
	]);

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

	const submitPassword = async () => {
		const normalizedPassword = normalizeSpacePasswordText(password);
		if (normalizedPassword.length === 0) {
			setPasswordError("Enter the space password.");
			return;
		}
		setIsSubmittingPassword(true);
		setPasswordError(null);
		try {
			await rememberProtectedSpaceAccess({
				data: {
					spaceId: input.spaceId,
					password: normalizedPassword,
				},
			});
			await refetchSpace();
		} catch (error) {
			setPasswordError(
				error instanceof Error
					? error.message
					: "OpenMeld could not store this space password right now."
			);
		} finally {
			setIsSubmittingPassword(false);
		}
	};

	const status = statusQuery.data ?? null;
	const spaceName = status?.name?.trim() || "Shared Space";
	const membership = viewerMembershipQuery.data ?? null;
	const signalEnvelopes = signalsQuery.data?.envelopes ?? EMPTY_SIGNALS;
	const threads = threadsQuery.data?.threads ?? EMPTY_THREADS;
	const threadPreviews = threadsQuery.data?.previews ?? EMPTY_THREAD_PREVIEWS;
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
			selectedThreadId === null
				? null
				: (threads.find((thread) => thread.threadId === selectedThreadId) ??
					null),
		[selectedThreadId, threads]
	);

	if (protectedFailure) {
		return (
			<PublicSpaceChrome
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
						passwordError,
					})}
					isSubmitting={isSubmittingPassword}
					onPasswordChange={(value) => {
						setPasswordError(null);
						setPassword(value);
					}}
					onSubmit={submitPassword}
					password={password}
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
		<PublicSpaceChrome
			isAuthenticated={input.isAuthenticated}
			membership={membership}
			spaceId={input.spaceId}
			spaceName={spaceName}
			status={status}
			viewControl={
				pageError ? null : (
					<SpaceViewTabs
						activeView={spaceView}
						className="shrink-0"
						idPrefix={spaceViewIdPrefix}
						onViewChange={setSpaceView}
					/>
				)
			}
		>
			{pageError ? (
				<PublicSpaceErrorState
					error={pageError}
					onRetry={() => {
						refetchSpace().catch((error) => {
							console.error("Failed to refresh public Space.", error);
						});
					}}
				/>
			) : (
				<>
					<SpaceConversationPanel
						activeSpaceView={spaceView}
						agentRecoveryPlansByProfileId={EMPTY_AGENT_RECOVERY_PLANS}
						allowedActions={status?.allowedActions ?? []}
						centerAgentProfileId={status?.centerAgentProfileId ?? null}
						className="min-w-0"
						composerBlockedWakeProfileId={null}
						composerErrorMessage={null}
						composerFileLimitReached={false}
						composerFiles={[]}
						composerReplyToSignalId={null}
						composerSelection={EMPTY_COMPOSER_SELECTION}
						composerText=""
						currentOwnerUserId={null}
						emptyStateDescription={null}
						emptyStateTitle="No messages yet."
						ephemeralActivityItems={EMPTY_EPHEMERAL_ACTIVITY_ITEMS}
						files={
							<SpaceFilesPanel
								fileToOpen={spaceFileToOpen}
								key={input.spaceId}
								readOnly={true}
								spaceId={input.spaceId}
							/>
						}
						firstUnreadSignalId={null}
						hasEarlierHistory={false}
						historyActionErrorMessage={null}
						historyErrorMessage={null}
						historyIsPending={statusQuery.isPending || signalsQuery.isPending}
						isAgentRecoveryPending={() => false}
						isCenterAgentDirectMessage={false}
						isCreatingThread={false}
						isDiagnosticReportPending={() => false}
						isDiagnosticReportSent={() => false}
						isDirectMessage={false}
						isLoadingEarlierHistory={false}
						isSendingMessage={false}
						membersSnapshot={null}
						mentionPopoverState={CLOSED_MENTION_POPOVER}
						modelCatalog={null}
						onAddComposerFiles={noopPromise}
						onAgentRecoveryAction={noopPromise}
						onClearComposerReplyTo={() => undefined}
						onComposerChange={() => undefined}
						onComposerKeyDown={noopPromise}
						onComposerSelectionChange={() => undefined}
						onCreateThread={noopPromise}
						onLoadEarlierHistory={noopPromise}
						onMentionButtonClick={() => undefined}
						onMentionItemHover={() => undefined}
						onMentionItemSelect={() => undefined}
						onMentionPopoverClose={() => undefined}
						onOpenSpaceFile={openSpaceFile}
						onOpenThread={setSelectedThreadId}
						onRemoveComposerFile={() => undefined}
						onReplyToMessage={() => undefined}
						onReportMessage={noopPromise}
						onSend={noopPromise}
						onSendStarterPrompt={noopPromise}
						onSpaceViewChange={setSpaceView}
						presentedWakeProgressItems={EMPTY_EPHEMERAL_ACTIVITY_ITEMS}
						readOnly={true}
						selfProfileId={PUBLIC_VIEWER_PROFILE_ID}
						spaceReferencesById={spaceReferencesById}
						spaceViewIdPrefix={spaceViewIdPrefix}
						textareaRef={textareaRef}
						threadPreviews={threadPreviews}
						threads={threads}
						timelineItems={timelineItems}
						unreadCount={0}
						unreadStateReady={true}
						wakeFailureTargetContextsByProfileId={
							EMPTY_WAKE_FAILURE_TARGET_CONTEXTS
						}
					/>
					<SpaceThreadPanel
						activeThread={activeThread}
						agentDirectConversationKind={null}
						agentRecoveryPlansByProfileId={EMPTY_AGENT_RECOVERY_PLANS}
						agentStreams={[]}
						centerAgentProfileId={status?.centerAgentProfileId ?? null}
						composerBlockedWakeProfileId={null}
						composerErrorMessage={null}
						composerFileLimitReached={false}
						composerFiles={[]}
						composerSelection={EMPTY_COMPOSER_SELECTION}
						composerText=""
						ephemeralActivityItems={EMPTY_EPHEMERAL_ACTIVITY_ITEMS}
						isAgentRecoveryPending={() => false}
						isDiagnosticReportPending={() => false}
						isDiagnosticReportSent={() => false}
						isSendingMessage={false}
						membersSnapshot={null}
						mentionPopoverState={CLOSED_MENTION_POPOVER}
						onAddComposerFiles={noopPromise}
						onAgentRecoveryAction={noopPromise}
						onClose={() => setSelectedThreadId(null)}
						onComposerChange={() => undefined}
						onComposerKeyDown={noopPromise}
						onComposerSelectionChange={() => undefined}
						onMentionButtonClick={() => undefined}
						onMentionItemHover={() => undefined}
						onMentionItemSelect={() => undefined}
						onMentionPopoverClose={() => undefined}
						onOpenSpaceFile={openSpaceFile}
						onRemoveComposerFile={() => undefined}
						onReportMessage={noopPromise}
						onSend={noopPromise}
						readOnly={true}
						selfProfileId={PUBLIC_VIEWER_PROFILE_ID}
						signals={threadSignals}
						signalsErrorMessage={formatOptionalFailure(
							threadSignalsQuery.error
						)}
						signalsIsLoading={threadSignalsQuery.isPending}
						spaceReferencesById={spaceReferencesById}
						spaceTimelineItems={timelineItems}
						textareaRef={threadTextareaRef}
						wakeFailureTargetContextsByProfileId={
							EMPTY_WAKE_FAILURE_TARGET_CONTEXTS
						}
					/>
				</>
			)}
		</PublicSpaceChrome>
	);
}

function PublicSpaceChrome(input: {
	children: ReactNode;
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
	isAuthenticated: boolean;
	membership: SpaceViewerMembershipResponse | null;
	spaceId: string;
	spaceName: string;
}) {
	const navigate = useNavigate();

	if (!input.isAuthenticated) {
		return (
			<Link
				className={buttonVariants({ size: "sm", variant: "outline" })}
				search={{
					redirect: buildPublicSpacePostSignInRedirect(input.spaceId),
				}}
				to="/login"
			>
				<SignInIcon aria-hidden="true" className="size-4" />
				Sign in
			</Link>
		);
	}

	const profiles = input.membership?.activeMemberProfiles ?? [];

	// Authenticated but not a member of this Space yet → offer to join in place
	// as one of the viewer's own human profiles. Membership is a server-side
	// fact (addMembers); we never gate the join on local agent readiness — agents
	// are brought in later from inside the Space (deferred-binding).
	if (profiles.length === 0) {
		return (
			<PublicSpaceJoinAction
				accessMode={input.accessMode}
				spaceId={input.spaceId}
				spaceName={input.spaceName}
			/>
		);
	}

	if (profiles.length <= 1) {
		return null;
	}

	const groupedProfiles = groupPublicSpaceProfiles(profiles);
	const openProfile = (profileId: string) => {
		if (!profiles.some((profile) => profile.profileId === profileId)) {
			throw new Error(
				`Public Space join profile is not available: ${profileId}`
			);
		}

		navigateToActiveOrganizationSpace({
			navigate,
			profileId,
			spaceId: input.spaceId,
		}).catch((error) => {
			console.error("Failed to join the member Space view.", error);
		});
	};

	return (
		<Select onValueChange={openProfile} value="">
			<SelectTrigger
				aria-label="Join Space as"
				className="h-9 w-44 sm:w-64"
				placeholder="Join Space as..."
				variant="bordered"
			/>
			<SelectContent className="max-h-72">
				{groupedProfiles.humanProfiles.length > 0 ? (
					<SelectGroup>
						<SelectLabel>Human Profiles</SelectLabel>
						{groupedProfiles.humanProfiles.map((profile, index) => (
							<SelectItem
								icon={UserIcon}
								index={index}
								key={profile.profileId}
								value={profile.profileId}
							>
								{profile.profileName}
							</SelectItem>
						))}
					</SelectGroup>
				) : null}
				{groupedProfiles.humanProfiles.length > 0 &&
				groupedProfiles.agentProfiles.length > 0 ? (
					<SelectSeparator />
				) : null}
				{groupedProfiles.agentProfiles.length > 0 ? (
					<SelectGroup>
						<SelectLabel>Agent Profiles</SelectLabel>
						{groupedProfiles.agentProfiles.map((profile, index) => (
							<SelectItem
								icon={RobotIcon}
								index={groupedProfiles.humanProfiles.length + index}
								key={profile.profileId}
								value={profile.profileId}
							>
								{profile.profileName}
							</SelectItem>
						))}
					</SelectGroup>
				) : null}
			</SelectContent>
		</Select>
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
				{joinMutation.isPending ? "Joining…" : "Join Space"}
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
						<SelectLabel>Human Profiles</SelectLabel>
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

function groupPublicSpaceProfiles(
	profiles: readonly PublicSpaceMemberProfile[]
): {
	agentProfiles: PublicSpaceMemberProfile[];
	humanProfiles: PublicSpaceMemberProfile[];
} {
	return {
		humanProfiles: profiles.filter(
			(profile) => profile.profileKind === "human"
		),
		agentProfiles: profiles.filter(
			(profile) => profile.profileKind === "agent"
		),
	};
}

function ProtectedSpaceForm(input: {
	errorMessage: string | null;
	isSubmitting: boolean;
	onPasswordChange: (value: string) => void;
	onSubmit: () => Promise<void>;
	password: string;
}) {
	return (
		<section className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-10">
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
						<h2 className="font-semibold text-lg">View This Protected Space</h2>
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
	);
}

function PublicSpaceErrorState(input: {
	error: StructuredApiClientFailure;
	onRetry: () => void;
}) {
	return (
		<section className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-10">
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
