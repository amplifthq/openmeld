import { Button } from "@openmeld/ui/components/button";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { SIDEBAR_ICON_WIDTH } from "@openmeld/ui/fluid/sidebar-state";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
import { PlusIcon } from "@phosphor-icons/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
	useNavigate,
	useRouterState,
} from "@tanstack/react-router";
import { NuqsAdapter } from "nuqs/adapters/react";
import {
	type ComponentType,
	type CSSProperties,
	type ReactNode,
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createRoot } from "react-dom/client";
import { MessageResponse } from "../../src/components/ai/message-response";
import { AppLinkCapability } from "../../src/components/app/app-link-capability";
import { APP_APPLICATION_RAIL_CLASS_NAME } from "../../src/components/app/app-nav-item-style";
import {
	AppRailNavigationGroup,
	buildAppRailGroups,
} from "../../src/components/app/app-rail-navigation";
import { AppSurfaceLayout } from "../../src/components/app/app-surface-layout";
import type { DirectoryHumanProfileRow } from "../../src/components/directory/directory-human-profile-model";
import { PeopleSidebar } from "../../src/components/directory/people-sidebar";
import {
	TeamSidebarHeader,
	TeamSidebarHeaderActionsProvider,
} from "../../src/components/directory/team-sidebar-header";
import { ConversationsSidebar } from "../../src/components/spaces/conversations-sidebar";
import { Bubble } from "../../src/components/spaces/primitives/bubble";
import {
	Message,
	MessageContent,
	MessageHeader,
} from "../../src/components/spaces/primitives/message";
import { SpaceAttachmentFileCard } from "../../src/components/spaces/space-attachment-file-card";
import { SpaceAttachmentStrip } from "../../src/components/spaces/space-attachment-strip";
import {
	buildSpaceCollaborationProfilePresentations,
	buildSpaceMemberDirectoryEntryByProfileId,
} from "../../src/components/spaces/space-collaboration-profile";
import { SpaceComposer } from "../../src/components/spaces/space-composer";
import type {
	SpaceComposerEditorChange,
	SpaceComposerEditorHandle,
} from "../../src/components/spaces/space-composer-editor";
import { SpaceWindowHeader } from "../../src/components/spaces/space-header";
import {
	SpaceMembersDrawer,
	SpaceMembersSidePanel,
	SpaceMembersToggleButton,
} from "../../src/components/spaces/space-members-drawer";
import { resolveSpaceMessageBubblePresentationClass } from "../../src/components/spaces/space-message-bubble-style";
import { SpaceMessageDeliveryStatus } from "../../src/components/spaces/space-message-delivery-status";
import { SpaceMessageProfileAvatar } from "../../src/components/spaces/space-message-profile-avatar";
import { buildSpaceMessageProfileMentionProfiles } from "../../src/components/spaces/space-message-profile-mention";
import { SpaceMessageProfileMentionText } from "../../src/components/spaces/space-message-profile-mention-view";
import { SpaceMessageSurface } from "../../src/components/spaces/space-message-surface";
import { SpaceMessageTime } from "../../src/components/spaces/space-message-time";
import type { SpaceView } from "../../src/components/spaces/space-view";
import { SpaceViewTabs } from "../../src/components/spaces/space-view-tabs";
import {
	buildSpaceComposerAddressingTargets,
	buildSpaceMentionTargetItems,
	resolveSpaceComposerAddressingMentions,
} from "../../src/components/spaces/use-space-mention-authoring";
import { SPACE_PANEL_WIDTH_METRICS } from "../../src/lib/spaces/panel-width-storage";
import { demoHumanAvatars } from "./demo-avatars";
import { demoProfileDirectory } from "./demo-catalogs";
import { DemoCenterAgent } from "./demo-center-agent";
import {
	buildDemoConversationDraft,
	DEMO_PRIMARY_SPACE_NAME,
	demoSampleMessages,
} from "./demo-conversation-content";
import {
	DemoConversationProvider,
	type DemoConversationTurn,
	useDemoConversationState,
} from "./demo-conversation-state";
import { DemoCreateAgent } from "./demo-create-agent";
import { demoAgentProfiles, demoSpaces } from "./demo-data";
import { DemoInbox, useDemoInboxAttention } from "./demo-inbox";
import { buildDemoSpaceMembers, DEMO_CENTER_PROFILE_ID } from "./demo-members";
import { demoModelCatalog } from "./demo-model-catalog";
import { DemoOrganizationSwitcher, DemoUserFooter } from "./demo-rail";
import {
	DemoFiles,
	DocumentDialog,
	FocusedTeamScene,
	SpaceDirectory,
	TeamScene,
} from "./demo-scenes";
import { DemoUsage } from "./demo-usage";
import "./preview.css";

const initialScene =
	new URLSearchParams(location.search).get("scene") ?? "Conversation";
const WORD_BOUNDARY = /\s+/u;
const focusedScenes: Record<string, ComponentType> = {
	CenterAgent: DemoCenterAgent,
	CreateAgent: DemoCreateAgent,
	Usage: DemoUsage,
};
const client = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
			staleTime: Number.POSITIVE_INFINITY,
			refetchOnWindowFocus: false,
		},
	},
});
client.setQueryData(["config", "model-catalog"], demoModelCatalog);
client.setQueryDefaults(["connector-connections", "org", "providers"], {
	enabled: false,
});
// Disable account reads before mounting real presentation components. All sample
// records live in this QueryClient, never in the public site's account state.
for (const key of ["profile-directory", "directory", "spaces"]) {
	const queryKey = ["organizations", "org", key];
	client.setQueryDefaults(queryKey, {
		enabled: false,
		staleTime: Number.POSITIVE_INFINITY,
	});
	client.setQueryData(
		queryKey,
		key === "spaces"
			? {
					organizationId: "org",
					spaces: demoSpaces.map((s) => ({
						spaceId: s.spaceId,
						name: s.spaceName,
					})),
				}
			: demoProfileDirectory
	);
}
const people: DirectoryHumanProfileRow[] = [
	"Maya Chen",
	"James Lee",
	"Alex Kim",
].map((name, i) => ({
	name,
	id: `person-${i}`,
	userId: ["preview", "james", "alex"][i],
	isCurrentUser: i === 0,
	isDefault: true,
	avatarImageUrl: demoHumanAvatars[name],
	canEdit: false,
	email: null,
	details: null,
	identityAccounts: [],
	joinedAt: null,
	lastActiveAt: null,
	notice: null,
	profileReport: { state: "missing" },
	profileStatus: "active",
	role: "member",
	presence: i === 0 ? "online" : "offline",
	agentProfiles: demoAgentProfiles
		.filter(
			(profile) => profile.ownerUserId === ["preview", "james", "alex"][i]
		)
		.map((profile) => ({
			id: profile.openMeldProfileId,
			name: profile.profileName,
			agentControllerRef:
				profile.profileHandle === "codex"
					? "builtin:codex"
					: "builtin:claude-code",
			avatarImageUrl: null,
			modelSelection: null,
			modelSelectionIsKnown: false,
			path: "/o/test/agents",
		})),
	agentProfilesPath: "/o/test/agents",
	computer: { count: 1, label: "Connected", path: null, state: "connected" },
}));
const resultFiles = {
	release: "Launch brief.md",
	research: "Customer interviews.md",
	website: "Launch brief.md",
};

function TranscriptMessage({
	name,
	kind,
	text,
	index,
	children,
	createdAtMs,
	working,
	file,
}: {
	name: string;
	kind: "human" | "agent";
	text: string;
	index: number;
	children?: ReactNode;
	createdAtMs?: number;
	working?: boolean;
	file?: { name: string; sizeBytes: number; onOpen: () => void };
}) {
	const isCenterAgent = name === "Center Agent";
	const agent = buildDemoSpaceMembers("release").agents.find(
		(member) => member.profileName === name
	);
	return (
		<Message className="px-0 py-2">
			<MessageContent className="w-full min-w-0 gap-0">
				<MessageHeader className="items-center gap-2 px-0">
					<SpaceMessageProfileAvatar
						agentControllerRef={agent?.agentControllerRef ?? null}
						avatarImageUrl={kind === "human" ? demoHumanAvatars[name] : null}
						avatarStyle={isCenterAgent ? "star" : undefined}
						displayName={name}
						isCenterAgent={isCenterAgent}
						profileId={agent?.profileId ?? `demo-${name}`}
						profileKind={kind}
						responsive
						working={working}
					/>
					<span className="text-foreground">{name}</span>
					{kind === "agent" && !isCenterAgent ? (
						<span className="text-muted-foreground">· {agent?.ownerName}</span>
					) : null}
					<SpaceMessageTime
						createdAtMs={createdAtMs ?? 1_791_334_800_000 + index * 120_000}
						isDirectMessage={false}
						placement="header"
					/>
				</MessageHeader>
				<Bubble className={file ? "w-full" : undefined}>
					<SpaceMessageSurface
						attachments={
							file ? (
								<SpaceAttachmentStrip
									label="Message attachments"
									matchTextWidth
								>
									<SpaceAttachmentFileCard
										fileName={file.name}
										mimeType="text/markdown"
										onOpen={file.onOpen}
										sizeBytes={file.sizeBytes}
									/>
								</SpaceAttachmentStrip>
							) : undefined
						}
						bubbleClassName={resolveSpaceMessageBubblePresentationClass({
							isSelf: name === "Maya Chen",
						})}
					>
						{children ?? (
							<MessageResponse variant="space-message">{text}</MessageResponse>
						)}
					</SpaceMessageSurface>
				</Bubble>
			</MessageContent>
		</Message>
	);
}

function Preview() {
	const conversationState = useDemoConversationState();
	const inboxAttention = useDemoInboxAttention();
	const navigate = useNavigate();
	const path = useRouterState({ select: (s) => s.location.pathname });
	const spaceId = path.split("/").at(-1) ?? "release";
	const isInbox = path.includes("/inbox");
	const isTeam = [
		"people",
		"agents",
		"plugins",
		"skills",
		"files",
		"routines",
	].includes(path.split("/")[3]);
	const scene = path.endsWith("/spaces") ? "Spaces" : "Conversation";
	const activeDestination = isTeam ? "people" : "spaces";
	const [file, setFile] = useState<string | null>(null);
	const [person, setPerson] = useState<string | null>(null);
	const [membersOpen, setMembersOpen] = useState(
		() => window.matchMedia("(min-width: 1024px)").matches
	);
	const [memberWidth, setMemberWidth] = useState<string>(
		SPACE_PANEL_WIDTH_METRICS.members.minWidth
	);
	const [view, setView] = useState<SpaceView>("messages");
	const wide = useMediaQuery("(min-width: 1024px)");
	const activeWakeTargetIds = new Set(
		conversationState.activeWakeSummaryBySpaceId
			.get(spaceId)
			?.activeTargets?.map((target) => target.profileId)
	);
	const membersProps = {
		currentOwnerUserId: "preview",
		currentProfileId: "11111111-1111-4111-8111-111111111111",
		orgSlug: "test",
		spaceId,
		centerAgentProfileId: DEMO_CENTER_PROFILE_ID,
		activeWakeDisplayTargetProfileIds: activeWakeTargetIds,
		isLoading: false,
		membersError: null,
		agentRecoveryPlansByProfileId: new Map(),
		autoRefreshExhaustedProfileIds: new Set<string>(),
		activeWakeWaitingTargetProfileIds: new Set<string>(),
		isAgentRecoveryPending: () => false,
		onAgentRecoveryAction: async () => undefined,
		onRefresh: async () => undefined,
		snapshot: buildDemoSpaceMembers(spaceId),
		open: membersOpen,
		onOpenChange: setMembersOpen,
	};
	let title =
		demoSpaces.find((s) => s.spaceId === spaceId)?.spaceName ??
		DEMO_PRIMARY_SPACE_NAME;
	let content = (
		<div className="flex min-h-0 flex-1">
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				{view === "files" ? (
					<DemoFiles />
				) : (
					<Conversation key={spaceId} onOpen={setFile} spaceId={spaceId} />
				)}
			</div>
			{wide ? (
				<SpaceMembersSidePanel
					{...membersProps}
					onPanelWidthChange={setMemberWidth}
					panelWidth={memberWidth}
				/>
			) : (
				<SpaceMembersDrawer {...membersProps} />
			)}
		</div>
	);
	if (scene === "Spaces") {
		title = "Spaces";
		content = <SpaceDirectory />;
	}
	if (isTeam) {
		title = "Team";
		content = (
			<TeamScene
				onSelectPerson={setPerson}
				people={people}
				selectedPerson={person}
			/>
		);
	}
	if (isInbox) {
		content = <DemoInbox />;
	}

	return (
		<QueryClientProvider client={client}>
			<NuqsAdapter>
				<TooltipProvider>
					<AppLinkCapability value={false}>
						<AppSurfaceLayout
							globalControls={null}
							initialModuleSidebarState={{ tier: "expanded", width: "200px" }}
							moduleNavigation={
								!isInbox &&
								(isTeam ? (
									<TeamSidebarHeaderActionsProvider>
										<TeamSidebarHeader />
										<PeopleSidebar
											activityNowMs={1_791_334_800_000}
											chatPending={false}
											computerGroups={[]}
											error={null}
											loading={false}
											members={people}
											onSelect={(id) => {
												setPerson(id);
												navigate({
													to: "/o/$orgSlug/people",
													params: { orgSlug: "test" },
												}).catch(console.error);
											}}
											selectedProfileId={person}
										/>
									</TeamSidebarHeaderActionsProvider>
								) : (
									<ConversationsSidebar />
								))
							}
							moduleNavigationKey={isTeam ? "people" : "conversations"}
							moduleNavigationLabel={isTeam ? "Team" : "Spaces"}
							outerRail={
								<aside
									className={APP_APPLICATION_RAIL_CLASS_NAME}
									data-presentation="inline"
									data-slot="app-outer-rail"
									style={
										{
											"--app-rail-icon-width": `${SIDEBAR_ICON_WIDTH}px`,
										} as CSSProperties
									}
								>
									<DemoOrganizationSwitcher />
									<div className="flex-1 px-1">
										{buildAppRailGroups({
											inboxAttention,
											orgSlug: "test",
											centerAgentUnreadCount: 0,
											spacesUnreadCount: 0,
											prefetchCenterAgentConversation: () => undefined,
										}).map((group, index) => (
											<AppRailNavigationGroup
												activeDestination={
													isInbox ? "inbox" : activeDestination
												}
												group={group}
												key={group.id}
												position={index}
												tier="icon"
											/>
										))}
									</div>
									<DemoUserFooter />
								</aside>
							}
						>
							<section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
								{!(isTeam || isInbox) && (
									<SpaceWindowHeader
										actions={
											scene === "Conversation" ? (
												<SpaceMembersToggleButton
													controlsId={
														wide
															? "space-members-panel"
															: "space-members-drawer"
													}
													memberCount={5}
													onOpenChange={setMembersOpen}
													open={membersOpen}
												/>
											) : undefined
										}
										navigation={
											scene === "Conversation" ? (
												<SpaceViewTabs
													activeView={view}
													idPrefix="demo-space"
													onViewChange={setView}
													tasksEnabled={false}
												/>
											) : undefined
										}
										title={title}
										titleAdornment={
											scene === "Conversation" ? (
												<span className="text-muted-foreground text-xs">
													Invite only
												</span>
											) : undefined
										}
									/>
								)}
								{content}
							</section>
						</AppSurfaceLayout>
					</AppLinkCapability>
					<DocumentDialog name={file} onClose={() => setFile(null)} />
				</TooltipProvider>
			</NuqsAdapter>
		</QueryClientProvider>
	);
}
const NO_TARGETS: readonly string[] = [];

function DemoMessageText({
	spaceId,
	text,
	wakeTargetProfileIds = NO_TARGETS,
	referenceTargetProfileIds = NO_TARGETS,
	mentionTargetProfileIds = NO_TARGETS,
}: {
	spaceId: string;
	text: string;
	wakeTargetProfileIds?: readonly string[];
	referenceTargetProfileIds?: readonly string[];
	mentionTargetProfileIds?: readonly string[];
}) {
	const snapshot = useMemo(() => buildDemoSpaceMembers(spaceId), [spaceId]);
	const profiles = useMemo(
		() =>
			buildSpaceMessageProfileMentionProfiles({
				profilePresentationsById: buildSpaceCollaborationProfilePresentations({
					centerAgentProfileId: DEMO_CENTER_PROFILE_ID,
					entriesByProfileId:
						buildSpaceMemberDirectoryEntryByProfileId(snapshot),
				}),
				wakeTargetProfileIds,
				referenceTargetProfileIds,
				mentionTargetProfileIds,
			}),
		[
			snapshot,
			wakeTargetProfileIds,
			referenceTargetProfileIds,
			mentionTargetProfileIds,
		]
	);
	return (
		<p className="whitespace-pre-wrap content-space-message">
			<SpaceMessageProfileMentionText profilesById={profiles} text={text} />
		</p>
	);
}

function DemoTurnMessages({ turn }: { turn: DemoConversationTurn }) {
	const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
	return (
		<>
			<TranscriptMessage
				createdAtMs={turn.createdAtMs}
				index={0}
				kind="human"
				name="Maya Chen"
				text={turn.text}
			>
				<DemoMessageText {...turn} />
			</TranscriptMessage>
			{turn.replies.map((reply) => {
				const working = turn.phase !== "complete";
				const text =
					turn.visibleWords > 0
						? reply.text
								.split(WORD_BOUNDARY)
								.slice(0, turn.visibleWords)
								.join(" ")
						: "";
				return (
					<TranscriptMessage
						createdAtMs={turn.createdAtMs}
						index={0}
						key={reply.profileId}
						kind="agent"
						name={reply.name}
						text={text}
						working={working}
					>
						{text && (
							<MessageResponse
								isStreaming={working && !reduceMotion}
								variant="space-message"
							>
								{text}
							</MessageResponse>
						)}
						{working && (
							<SpaceMessageDeliveryStatus
								presentation="agent_streaming"
								requestStartedAtMs={turn.createdAtMs}
							/>
						)}
					</TranscriptMessage>
				);
			})}
		</>
	);
}

function Conversation({
	spaceId,
	onOpen,
}: {
	spaceId: string;
	onOpen: (file: string) => void;
}) {
	const isReport = useRouterState({
		select: (state) =>
			state.location.searchStr.includes("focusSignalId=report"),
	});
	const composerRef = useRef<SpaceComposerEditorHandle>(null);
	const state = useDemoConversationState();
	const turns = state.turns.filter((turn) => turn.spaceId === spaceId);
	const isSending = turns.some((turn) => turn.phase === "sending");
	const sendLock = useRef(false);
	const [draft, setDraft] = useState<SpaceComposerEditorChange>(() =>
		buildDemoConversationDraft(!isReport && turns.length === 0 ? spaceId : "")
	);
	const [sendError, setSendError] = useState<string | null>(null);
	const snapshot = useMemo(() => buildDemoSpaceMembers(spaceId), [spaceId]);
	const mentionPickerItems = useMemo(
		() => buildSpaceMentionTargetItems({ snapshot, query: "" }),
		[snapshot]
	);
	const addressingTargets = useMemo(
		() =>
			buildSpaceComposerAddressingTargets({
				snapshot,
				mentions: resolveSpaceComposerAddressingMentions({
					snapshot,
					text: draft.text,
					authoredMentions: draft.authoredMentions,
				}),
			}),
		[snapshot, draft.text, draft.authoredMentions]
	);
	const scrollRef = useRef<HTMLDivElement>(null);
	const followLatest = useRef(true);
	useLayoutEffect(() => {
		if (followLatest.current && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	});
	useLayoutEffect(() => {
		sendLock.current = isSending;
	}, [isSending]);
	const id =
		spaceId === "research" || spaceId === "website" ? spaceId : "release";
	return (
		<>
			<div
				className="min-h-0 flex-1 overflow-auto px-6 pt-7 pb-4"
				onScroll={() => {
					const node = scrollRef.current;
					if (node) {
						followLatest.current =
							node.scrollHeight - node.scrollTop - node.clientHeight < 80;
					}
				}}
				ref={scrollRef}
			>
				<div className="flex w-full flex-col gap-3">
					{(isReport
						? [
								{
									name: "Center Agent",
									kind: "agent" as const,
									text: "Checkout fix is ready. Both billing edge cases have tests. James owns the final review.",
									wakeTargetProfileIds: NO_TARGETS,
								},
							]
						: demoSampleMessages[id]
					).map(({ name, kind, text, wakeTargetProfileIds }, index) => (
						<TranscriptMessage
							file={
								name === "Center Agent" && (isReport || id !== "release")
									? {
											name: isReport ? "Weekly review.md" : resultFiles[id],
											sizeBytes: isReport ? 3200 : 1800,
											onOpen: () =>
												onOpen(isReport ? "Weekly review.md" : resultFiles[id]),
										}
									: undefined
							}
							index={index}
							key={name}
							kind={kind}
							name={name}
							text={text}
						>
							{!isReport && (
								<DemoMessageText
									spaceId={spaceId}
									text={text}
									wakeTargetProfileIds={wakeTargetProfileIds}
								/>
							)}
						</TranscriptMessage>
					))}
					{turns.map((turn) => (
						<DemoTurnMessages key={turn.id} turn={turn} />
					))}
				</div>
			</div>
			<div className="w-full px-6 pb-4">
				<SpaceComposer
					actions={{
						onEditorChange: (nextDraft) => {
							// The simulated send clears immediately. Ignore the old editor's
							// focus/change event while that replacement is settling.
							if (!sendLock.current) {
								setDraft(nextDraft);
							}
						},
						onMentionButtonClick: () =>
							composerRef.current?.insertMentionTrigger(),
						onSubmit: (options) => {
							if (!draft.text.trim() || sendLock.current) {
								return;
							}
							try {
								sendLock.current = true;
								const messageId = state.send({
									spaceId,
									text: draft.text,
									authoredMentions: draft.authoredMentions,
								});
								options?.onMessageStaged?.(messageId);
								followLatest.current = true;
								setDraft({
									text: "",
									authoredMentions: [],
									selection: { start: 0, end: 0 },
								});
								setSendError(null);
							} catch (error) {
								sendLock.current = false;
								setSendError(
									error instanceof Error
										? error.message
										: "Unable to send this demo message."
								);
							}
						},
					}}
					availability={{
						canSendMessage: true,
						canUploadFiles: false,
						fileLimitReached: false,
						isSendingMessage: isSending,
						sendBlocked: !draft.text.trim(),
					}}
					centerAgentProfileId={DEMO_CENTER_PROFILE_ID}
					composerRef={composerRef}
					content={{
						addressingTargets,
						authoredMentions: draft.authoredMentions,
						hasAuthoredMentions: draft.authoredMentions.length > 0,
						files: [],
						mentionPickerItems,
						text: draft.text,
					}}
					context={{ conversationKind: "space", placement: "conversation" }}
					slots={{
						attachmentAction: (
							<Button
								aria-label="Add"
								disabled
								size="icon-sm"
								type="button"
								variant="ghost"
							>
								<PlusIcon aria-hidden="true" />
							</Button>
						),
						error: sendError ? (
							<p className="text-destructive text-xs" role="alert">
								{sendError}
							</p>
						) : null,
					}}
				/>
			</div>
		</>
	);
}
function FocusedPreview() {
	const Scene = focusedScenes[initialScene];
	const showcase = initialScene.startsWith("Showcase");
	const naturalHeight =
		showcase || ["CreateAgent", "CenterAgent", "Usage"].includes(initialScene);
	const measureContent = useCallback(
		(content: HTMLElement | null) => {
			if (!(naturalHeight && content) || window.parent === window) {
				return;
			}
			const reportHeight = () => {
				window.parent.postMessage(
					{
						type: "openmeld:demo-height",
						height: Math.ceil(content.getBoundingClientRect().height),
					},
					window.location.origin
				);
			};
			const requested = (event: MessageEvent) => {
				if (
					event.source === window.parent &&
					event.origin === window.location.origin &&
					event.data?.type === "openmeld:demo-measure"
				) {
					reportHeight();
				}
			};
			const resize = new ResizeObserver(reportHeight);
			resize.observe(content);
			window.addEventListener("message", requested);
			return () => {
				resize.disconnect();
				window.removeEventListener("message", requested);
			};
		},
		[naturalHeight]
	);
	const path = useRouterState({ select: (state) => state.location.pathname });
	const navigate = useNavigate();
	const [file, setFile] = useState<string | null>(null);
	const isSpace = initialScene === "Schedule" && path.includes("/spaces/");
	return (
		<QueryClientProvider client={client}>
			<NuqsAdapter>
				<TooltipProvider>
					<AppLinkCapability value={false}>
						<main
							className={
								naturalHeight
									? "flex flex-col bg-background"
									: "flex h-dvh min-h-0 flex-col overflow-auto bg-background"
							}
							inert={showcase}
							ref={measureContent}
						>
							{initialScene === "ShowcaseRoutineResult" && (
								<div className="flex flex-col">
									<SpaceWindowHeader title={DEMO_PRIMARY_SPACE_NAME} />
									<div className="space-y-5 px-6 py-6">
										<TranscriptMessage
											file={{
												name: "Weekly review.md",
												sizeBytes: 3200,
												onOpen: () => setFile("Weekly review.md"),
											}}
											index={0}
											kind="agent"
											name="Center Agent"
											text={
												"## Weekly project review\n\n- **Ready:** checkout fix and billing tests.\n- **Verified:** 24 tests pass.\n- **Next:** James’s final review."
											}
										/>
									</div>
								</div>
							)}
							{isSpace && (
								<>
									<div className="flex items-center gap-4 border-b px-6 py-3">
										<Button
											onClick={() =>
												navigate({
													to: "/o/$orgSlug/routines",
													params: { orgSlug: "test" },
												})
											}
											variant="ghost"
										>
											Back to Routines
										</Button>
										<strong>Launch room</strong>
									</div>
									<Conversation onOpen={setFile} spaceId="release" />
								</>
							)}
							{!isSpace &&
								initialScene !== "ShowcaseRoutineResult" &&
								(Scene ? <Scene /> : <FocusedTeamScene scene={initialScene} />)}
						</main>
						<DocumentDialog name={file} onClose={() => setFile(null)} />
					</AppLinkCapability>
				</TooltipProvider>
			</NuqsAdapter>
		</QueryClientProvider>
	);
}
const route = createRootRoute({
	component: [
		"CreateAgent",
		"CenterAgent",
		"Usage",
		"Knowledge",
		"Schedule",
		"ShowcaseFiles",
		"ShowcaseSkill",
		"ShowcaseRoutines",
		"ShowcaseRoutineResult",
	].includes(initialScene)
		? FocusedPreview
		: Preview,
});
let initialPath = "/o/test/spaces/release";
if (initialScene === "Spaces") {
	initialPath = "/o/test/spaces";
}
if (["Files", "Skills", "Routines"].includes(initialScene)) {
	initialPath = `/o/test/${initialScene.toLowerCase()}`;
}
if (initialScene === "Knowledge") {
	initialPath = "/o/test/files";
}
if (initialScene === "Schedule" || initialScene === "ShowcaseRoutines") {
	initialPath = "/o/test/routines";
}
const router = createRouter({
	history: createMemoryHistory({
		initialEntries: [initialPath],
	}),
	routeTree: route.addChildren([
		createRoute({
			getParentRoute: () => route,
			path: "$",
			component: () => null,
		}),
	]),
});
document.documentElement.dataset.sidebarDisplay = "icons-only";
const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<DemoConversationProvider>
			<RouterProvider router={router} />
		</DemoConversationProvider>
	);
}
