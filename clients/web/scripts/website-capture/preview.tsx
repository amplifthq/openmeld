import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/agent-runtime";
import {
	createSpaceMemberAgentSnapshot,
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
	useRouterState,
} from "@tanstack/react-router";
import { NuqsAdapter } from "nuqs/adapters/react";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageResponse } from "../../src/components/ai/message-response";
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
import { SpaceComposer } from "../../src/components/spaces/space-composer";
import type { SpaceComposerEditorHandle } from "../../src/components/spaces/space-composer-editor";
import { SpaceWindowHeader } from "../../src/components/spaces/space-header";
import {
	SpaceMembersDrawer,
	SpaceMembersSidePanel,
	SpaceMembersToggleButton,
} from "../../src/components/spaces/space-members-drawer";
import { resolveSpaceMessageBubblePresentationClass } from "../../src/components/spaces/space-message-bubble-style";
import { SpaceMessageProfileAvatar } from "../../src/components/spaces/space-message-profile-avatar";
import { SpaceMessageSurface } from "../../src/components/spaces/space-message-surface";
import { SpaceMessageTime } from "../../src/components/spaces/space-message-time";
import type { SpaceView } from "../../src/components/spaces/space-view";
import { SpaceViewTabs } from "../../src/components/spaces/space-view-tabs";
import { demoDirectory, demoSpaces } from "./demo-data";
import {
	DemoFiles,
	DocumentDialog,
	SpaceDirectory,
	TeamScene,
} from "./demo-scenes";
import "./preview.css";

const initialScene =
	new URLSearchParams(location.search).get("scene") ?? "Conversation";
const client = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
			staleTime: Number.POSITIVE_INFINITY,
			refetchOnWindowFocus: false,
		},
	},
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
			: demoDirectory
	);
}
const people: DirectoryHumanProfileRow[] = [
	"Maya Chen",
	"James Lee",
	"Alex Kim",
].map((name, i) => ({
	name,
	id: `person-${i}`,
	userId: i === 0 ? "preview" : `user-${i}`,
	isCurrentUser: i === 0,
	isDefault: true,
	avatarImageUrl: null,
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
	agentProfiles: [],
	agentProfilesPath: "/o/test/people",
	computer: { count: 1, label: "Connected", path: null, state: "connected" },
}));
const sampleMessages = {
	release: [
		[
			"Maya Chen",
			"human",
			"Use the launch brief to draft Friday’s release notes.",
		],
		[
			"James Lee",
			"human",
			"Focus on the new setup flow. The guide is ready to link.",
		],
		[
			"Center Agent",
			"agent",
			"Release notes are ready for review. I included the setup changes and next steps.",
		],
	],
	research: [
		["James Lee", "human", "What keeps coming up in our customer interviews?"],
		[
			"Center Agent",
			"agent",
			"Three themes: continuing a teammate’s work, keeping files with the result, and knowing which agent did the work. I grouped the notes for review.",
		],
	],
	website: [
		[
			"Maya Chen",
			"human",
			"Review the website brief before we start the next draft.",
		],
		[
			"Center Agent",
			"agent",
			"The brief covers the audience, the Friday release, and who owns the final review. Open it here to check the scope.",
		],
	],
} as const;
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
}: {
	name: string;
	kind: "human" | "agent";
	text: string;
	index: number;
}) {
	return (
		<Message className="px-3 py-2">
			<MessageContent className="w-full min-w-0 gap-0">
				<MessageHeader className="items-center gap-2 px-0">
					<SpaceMessageProfileAvatar
						agentControllerRef={
							kind === "agent" ? HOSTED_CENTER_AGENT_CONTROLLER_REF : null
						}
						avatarStyle={kind === "agent" ? "star" : undefined}
						displayName={name}
						isCenterAgent={kind === "agent"}
						profileId={`demo-${name}`}
						profileKind={kind}
					/>
					<span className="text-foreground">{name}</span>
					<SpaceMessageTime
						createdAtMs={1_791_334_800_000 + index * 120_000}
						isDirectMessage={false}
						placement="header"
					/>
				</MessageHeader>
				<Bubble>
					<SpaceMessageSurface
						bubbleClassName={resolveSpaceMessageBubblePresentationClass({
							isSelf: name === "Maya Chen",
						})}
					>
						<MessageResponse variant="space-message">{text}</MessageResponse>
					</SpaceMessageSurface>
				</Bubble>
			</MessageContent>
		</Message>
	);
}

function Preview() {
	const path = useRouterState({ select: (s) => s.location.pathname });
	const spaceId = path.split("/").at(-1) ?? "release";
	const isTeam = path.includes("/people");
	let scene = path.endsWith("/spaces") ? "Spaces" : "Conversation";
	if (isTeam) {
		scene = ["Files", "Skills", "Routines"].includes(initialScene)
			? initialScene
			: "Files";
	}
	const [file, setFile] = useState<string | null>(null);
	const [person, setPerson] = useState<string | null>(null);
	const [membersOpen, setMembersOpen] = useState(false);
	const [memberWidth, setMemberWidth] = useState("300px");
	const [view, setView] = useState<SpaceView>("messages");
	const wide = useMediaQuery("(min-width: 1024px)");
	const membersProps = {
		currentOwnerUserId: "preview",
		currentProfileId: "11111111-1111-4111-8111-111111111111",
		orgSlug: "test",
		spaceId,
		centerAgentProfileId: "agt_33333333-3333-4333-8333-333333333333",
		isLoading: false,
		membersError: null,
		agentRecoveryPlansByProfileId: new Map(),
		autoRefreshExhaustedProfileIds: new Set<string>(),
		activeWakeWaitingTargetProfileIds: new Set<string>(),
		isAgentRecoveryPending: () => false,
		onAgentRecoveryAction: async () => undefined,
		onRefresh: async () => undefined,
		snapshot: createSpaceMembersSnapshot({
			spaceId,
			humans: [
				createSpaceMemberHumanSnapshot({
					profileId: "11111111-1111-4111-8111-111111111111",
					profileName: "Maya Chen",
					ownerUserId: "preview",
					liveNow: true,
				}),
				createSpaceMemberHumanSnapshot({
					profileId: "22222222-2222-4222-8222-222222222222",
					profileName: "James Lee",
					ownerUserId: "james",
					liveNow: true,
				}),
			],
			agents: [
				createSpaceMemberAgentSnapshot({
					profileId: "agt_33333333-3333-4333-8333-333333333333",
					profileName: "Center Agent",
					ownerName: "Atlas",
					ownerUserId: null,
					agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
					avatarStyle: "star",
					addedByDisplayName: "Maya Chen",
				}),
				createSpaceMemberAgentSnapshot({
					profileId: "agt_44444444-4444-4444-8444-444444444444",
					profileName: "Claude Code",
					ownerName: "Maya Chen",
					ownerUserId: "preview",
					agentControllerRef: "builtin:claude-code",
					addedByDisplayName: "Maya Chen",
				}),
			],
		}),
		open: membersOpen,
		onOpenChange: setMembersOpen,
	};
	let title =
		demoSpaces.find((s) => s.spaceId === spaceId)?.spaceName ?? "Launch room";
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
		content = <TeamScene initial={scene} people={people} />;
	}
	return (
		<QueryClientProvider client={client}>
			<NuqsAdapter>
				<TooltipProvider>
					<AppSurfaceLayout
						globalControls={null}
						initialModuleSidebarState={{ tier: "expanded", width: "248px" }}
						moduleNavigation={
							isTeam ? (
								<TeamSidebarHeaderActionsProvider>
									<TeamSidebarHeader />
									<PeopleSidebar
										activityNowMs={1_791_334_800_000}
										chatPending={false}
										computerGroups={[]}
										error={null}
										loading={false}
										members={people}
										onChat={async () =>
											setFile(
												"This demo keeps conversations in the shared Spaces."
											)
										}
										onSelect={setPerson}
										selectedProfileId={person}
									/>
								</TeamSidebarHeaderActionsProvider>
							) : (
								<ConversationsSidebar />
							)
						}
						moduleNavigationKey={isTeam ? "people" : "conversations"}
						moduleNavigationLabel={isTeam ? "Team" : "Spaces"}
						outerRail={
							<aside className={APP_APPLICATION_RAIL_CLASS_NAME}>
								<div className="flex h-16 items-center justify-center">
									<span
										className="flex size-9 items-center justify-center rounded-md bg-background text-base text-foreground"
										title="Atlas demo workspace"
									>
										A
									</span>
								</div>
								<div className="flex-1 px-1">
									{buildAppRailGroups({
										orgSlug: "test",
										centerAgentUnreadCount: 0,
										spacesUnreadCount: 0,
										prefetchCenterAgentConversation: () => undefined,
									}).map((group, index) => (
										<AppRailNavigationGroup
											activeDestination={isTeam ? "people" : "spaces"}
											group={{
												...group,
												destinations: group.destinations.filter(
													(destination) => destination.id !== "inbox"
												),
											}}
											key={group.id}
											position={index}
											tier="icon"
										/>
									))}
								</div>
							</aside>
						}
					>
						<section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
							{!isTeam && (
								<SpaceWindowHeader
									actions={
										scene === "Conversation" ? (
											<SpaceMembersToggleButton
												controlsId={
													wide ? "space-members-panel" : "space-members-drawer"
												}
												memberCount={4}
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
					<DocumentDialog name={file} onClose={() => setFile(null)} />
				</TooltipProvider>
			</NuqsAdapter>
		</QueryClientProvider>
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
	const [text, setText] = useState("");
	const [sent, setSent] = useState<{ id: number; text: string }[]>([]);
	const scrollRef = useRef<HTMLDivElement>(null);
	const id =
		spaceId === "research" || spaceId === "website" ? spaceId : "release";
	return (
		<>
			<div className="min-h-0 flex-1 overflow-auto px-5 py-4" ref={scrollRef}>
				<div className="mx-auto flex max-w-3xl flex-col gap-3">
					{(isReport
						? [
								[
									"Center Agent",
									"agent",
									"This week’s project review is ready. The setup guide and release notes are ready for review. The pilot team selection still needs a decision.",
								] as const,
							]
						: sampleMessages[id]
					).map(([name, kind, message], index) => (
						<TranscriptMessage
							index={index}
							key={name}
							kind={kind}
							name={name}
							text={message}
						/>
					))}
					{(isReport || id !== "release") && (
						<div className="ml-3">
							<SpaceAttachmentFileCard
								fileName={isReport ? "Weekly review.md" : resultFiles[id]}
								mimeType="text/markdown"
								onOpen={() =>
									onOpen(isReport ? "Weekly review.md" : resultFiles[id])
								}
								sizeBytes={1800}
							/>
						</div>
					)}
					{sent.map((message) => (
						<TranscriptMessage
							index={message.id + 3}
							key={message.id}
							kind="human"
							name="You"
							text={message.text}
						/>
					))}
				</div>
			</div>
			<div className="mx-auto w-full max-w-3xl px-6 pb-6">
				<SpaceComposer
					actions={{
						onEditorChange: (change) => setText(change.text),
						onSubmit: () => {
							if (text.trim()) {
								setSent((current) => [
									...current,
									{ id: current.length, text: text.trim() },
								]);
								setText("");
								requestAnimationFrame(() =>
									scrollRef.current?.scrollTo({
										top: scrollRef.current.scrollHeight,
									})
								);
							}
						},
					}}
					availability={{
						canSendMessage: true,
						canUploadFiles: false,
						fileLimitReached: false,
						isSendingMessage: false,
						sendBlocked: false,
					}}
					centerAgentProfileId={null}
					composerRef={composerRef}
					content={{
						addressingTargets: [],
						authoredMentions: [],
						files: [],
						mentionPickerItems: [],
						mentionEmptyMessage:
							"Agent execution is not connected in this demo.",
						text,
					}}
					context={{ conversationKind: "space", placement: "conversation" }}
					key={sent.length}
				/>
			</div>
		</>
	);
}
const route = createRootRoute({ component: Preview });
let initialPath = "/o/test/spaces/release";
if (initialScene === "Spaces") {
	initialPath = "/o/test/spaces";
}
if (["Files", "Skills", "Routines"].includes(initialScene)) {
	initialPath = "/o/test/people";
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
	createRoot(root).render(<RouterProvider router={router} />);
}
