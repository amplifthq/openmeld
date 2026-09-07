"use client";

import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { GearSixIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { AppMainContent } from "#/components/app/app-main-content";
import { useStartFlowState } from "#/components/app/start-flow-state";
import { useSidebarPreferences } from "#/components/app/use-sidebar-preferences";
import { SpaceLanding } from "#/components/spaces/space-landing";
import type { SpaceView } from "#/components/spaces/space-view";
import { useAccountAvatar } from "#/hooks/account.hooks";
import { useComposerDraft } from "#/hooks/use-composer-draft";
import { resolveCenterAgentErrorMessage } from "#/lib/organizations/center-agent";
import { EMPTY_CHAT_PREFERENCES } from "#/lib/organizations/center-agent-chat-preferences";
import {
	activateCenterAgentPendingMessageScope,
	clearCenterAgentPendingMessage,
	createPendingCenterAgentMessage,
	type PendingCenterAgentMessage,
	readCenterAgentPendingMessage,
	writeCenterAgentPendingMessage,
} from "#/lib/organizations/center-agent-pending-message";
import {
	type CenterAgentDirectMessageRouteData,
	loadCenterAgentDirectMessageRouteData,
} from "#/lib/organizations/center-agent-route-loader";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationCenterAgentChatPath,
	buildOrganizationCenterAgentSettingsPath,
} from "#/lib/organizations/organization-routes";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";
import { CenterAgentOptimisticConversation } from "./center-agent-optimistic-conversation";
import { ChatTitleEditor } from "./chat-title-editor";

export function CenterAgentPage(input: {
	sessionId?: string;
	directMessageRouteData: CenterAgentDirectMessageRouteData | null;
	initialFocusSignalId?: string;
	initialSpaceView?: SpaceView;
	presentation?: "compact" | "full";
}) {
	if (!input.directMessageRouteData) {
		return null;
	}
	return (
		<CenterAgentDirectMessagePage
			directMessageRouteData={input.directMessageRouteData}
			initialFocusSignalId={input.initialFocusSignalId}
			initialSpaceView={input.initialSpaceView}
			presentation={input.presentation}
			sessionId={input.sessionId}
		/>
	);
}

function CenterAgentDirectMessagePage(input: {
	sessionId?: string;
	directMessageRouteData: CenterAgentDirectMessageRouteData;
	initialFocusSignalId?: string;
	initialSpaceView?: SpaceView;
	presentation?: "compact" | "full";
}) {
	const { currentOrganization } = useAppOrganization();
	const { data: currentAccountAvatar } = useAccountAvatar();

	return (
		<CenterAgentDirectMessageOrganizationBoundary
			currentUserAvatarImageUrl={currentAccountAvatar?.avatar ?? null}
			directMessageRouteData={input.directMessageRouteData}
			initialFocusSignalId={input.initialFocusSignalId}
			initialSpaceView={input.initialSpaceView}
			key={`${currentOrganization.id}:${input.sessionId ?? "default"}`}
			organizationId={currentOrganization.id}
			organizationSlug={currentOrganization.slug}
			presentation={input.presentation}
			sessionId={input.sessionId}
		/>
	);
}

function CenterAgentDirectMessageOrganizationBoundary(input: {
	sessionId?: string;
	currentUserAvatarImageUrl: string | null;
	directMessageRouteData: CenterAgentDirectMessageRouteData;
	initialFocusSignalId?: string;
	initialSpaceView?: SpaceView;
	organizationId: string;
	organizationSlug: string;
	presentation?: "compact" | "full";
}) {
	const [connectRequired, setConnectRequired] = useState(
		input.directMessageRouteData.status === "connect_required"
	);
	if (connectRequired) {
		return (
			<CenterAgentConnectRequiredPage
				organizationSlug={input.organizationSlug}
			/>
		);
	}

	return (
		<CenterAgentDirectMessageEntry
			currentUserAvatarImageUrl={input.currentUserAvatarImageUrl}
			directMessageRouteData={input.directMessageRouteData}
			initialFocusSignalId={input.initialFocusSignalId}
			initialSpaceView={input.initialSpaceView}
			onConnectRequired={(organizationId) => {
				if (organizationId === input.organizationId) {
					setConnectRequired(true);
				}
			}}
			organizationId={input.organizationId}
			organizationSlug={input.organizationSlug}
			presentation={input.presentation}
			sessionId={input.sessionId}
		/>
	);
}

function CenterAgentDirectMessageEntry(input: {
	sessionId?: string;
	currentUserAvatarImageUrl: string | null;
	directMessageRouteData: CenterAgentDirectMessageRouteData;
	initialFocusSignalId?: string;
	initialSpaceView?: SpaceView;
	onConnectRequired: (organizationId: string) => void;
	organizationId: string;
	organizationSlug: string;
	presentation?: "compact" | "full";
}) {
	const { currentOrganization } = useAppOrganization();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { storageScope } = useStartFlowState();
	const pendingScope = {
		...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
		organizationId: input.organizationId,
		organizationSlug: input.organizationSlug,
	};
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const sidebar = useSidebarPreferences(
		defaultHumanProfile?.openMeldProfileId ?? "",
		input.organizationId
	);
	const composerDraftScope = storageScope.trim()
		? {
				kind: "center_agent_pending" as const,
				...(input.sessionId === undefined
					? {}
					: { sessionId: input.sessionId }),
				organizationId: input.organizationId,
				ownerAccountId: storageScope,
			}
		: null;
	const composerDraft = useComposerDraft({ scope: composerDraftScope });
	const composerText = composerDraft.content.text;
	const setComposerText = (text: string) => {
		composerDraft.setContent((currentDraft) => ({
			...currentDraft,
			text,
		}));
	};
	const [pendingMessage, setPendingMessage] =
		useState<PendingCenterAgentMessage | null>(() => {
			activateCenterAgentPendingMessageScope(queryClient, pendingScope);
			return readCenterAgentPendingMessage(queryClient, pendingScope);
		});
	const [routeDataOverride, setRouteDataOverride] = useState<{
		source: CenterAgentDirectMessageRouteData;
		value: CenterAgentDirectMessageRouteData;
	} | null>(null);
	const directMessageRouteData =
		routeDataOverride?.source === input.directMessageRouteData
			? routeDataOverride.value
			: input.directMessageRouteData;
	const resolvedSessionId =
		directMessageRouteData.status === "ready"
			? directMessageRouteData.directMessage.spaceId
			: input.sessionId;
	const handleSpaceViewCommitted = useCallback(
		(view: SpaceView) => {
			navigate({
				replace: true,
				to: buildOrganizationCenterAgentChatPath(input.organizationSlug, {
					...(view === "messages" ? {} : { view }),
					...(resolvedSessionId === undefined
						? {}
						: { session: resolvedSessionId }),
				}),
			}).catch((error: unknown) => {
				console.error(
					"Failed to update the Center Agent conversation view.",
					error
				);
			});
		},
		[input.organizationSlug, resolvedSessionId, navigate]
	);
	const [retryPending, setRetryPending] = useState(false);
	const profilesQuery = useQuery(
		buildStartProfilesQueryOptions({ enabled: true, storageScope })
	);
	const errorMessage =
		directMessageRouteData.status === "error"
			? resolveCenterAgentErrorMessage(directMessageRouteData.error, "dm_open")
			: null;
	const optimisticConversation = (
		<CenterAgentOptimisticConversation
			composerText={pendingMessage ? "" : composerText}
			onComposerChange={setComposerText}
			onSend={() => {
				const text = composerText.trim();
				if (!text || pendingMessage) {
					return;
				}
				const nextPendingMessage = createPendingCenterAgentMessage(text);
				writeCenterAgentPendingMessage(
					queryClient,
					pendingScope,
					nextPendingMessage
				);
				setPendingMessage(nextPendingMessage);
			}}
			pendingMessage={pendingMessage}
			presentation={input.presentation}
		/>
	);

	if (directMessageRouteData.status === "ready") {
		const directMessage = directMessageRouteData.directMessage;
		return (
			<SpaceLanding
				accountProfiles={profilesQuery.data ?? []}
				composerDraftMigrationScopes={
					composerDraftScope ? [composerDraftScope] : undefined
				}
				conversationTitle={
					sidebar.preferences?.chats?.titles[directMessage.spaceId]
				}
				conversationTitleAction={(currentTitle) => (
					<ChatTitleEditor
						disabled={sidebar.disabled}
						onSave={async (title) => {
							if (!sidebar.preferences) {
								throw new Error("Chat settings are still loading.");
							}
							const chats = sidebar.preferences.chats ?? EMPTY_CHAT_PREFERENCES;
							await sidebar.saveAsync({
								...sidebar.preferences,
								chats: {
									...chats,
									titles: { ...chats.titles, [directMessage.spaceId]: title },
								},
							});
						}}
						title={currentTitle}
					/>
				)}
				currentUserAvatarImageUrl={input.currentUserAvatarImageUrl}
				initialComposerDraft={composerDraft.record}
				initialFocusSignalId={input.initialFocusSignalId}
				initialPendingMessage={pendingMessage}
				initialSpaceView={input.initialSpaceView}
				isCenterAgentDirectMessage
				isPersonalContext={currentOrganization.isPersonal === true}
				loadingFallback={optimisticConversation}
				onInitialPendingMessageConsumed={() => {
					clearCenterAgentPendingMessage(queryClient, pendingScope);
					setPendingMessage(null);
				}}
				onSpaceViewCommitted={handleSpaceViewCommitted}
				orgSlug={input.organizationSlug}
				presentation={input.presentation}
				profileId={directMessage.memberProfileId}
				spaceId={directMessage.spaceId}
			/>
		);
	}

	return (
		<AppMainContent bodyClassName="flex" header={null}>
			<section className="m-auto max-w-sm space-y-4 p-6">
				<div className="space-y-2">
					<p className="font-medium text-foreground text-sm">
						Center Agent is unavailable
					</p>
					<p className="text-muted-foreground text-sm">{errorMessage}</p>
				</div>
				<div className="flex flex-col gap-2 sm:flex-row">
					<Button
						disabled={retryPending}
						onClick={() => {
							setRetryPending(true);
							loadCenterAgentDirectMessageRouteData({
								...(input.sessionId === undefined
									? {}
									: { sessionId: input.sessionId }),
								organizationId: input.organizationId,
								queryClient,
							})
								.then((nextRouteData) => {
									if (nextRouteData.status === "connect_required") {
										input.onConnectRequired(input.organizationId);
										return;
									}
									setRouteDataOverride({
										source: input.directMessageRouteData,
										value: nextRouteData,
									});
								})
								.catch((error: unknown) => {
									console.error(
										"Failed to retry the Center Agent conversation.",
										error
									);
								})
								.finally(() => {
									setRetryPending(false);
								});
						}}
						size="sm"
						type="button"
						variant="outline"
					>
						Retry
					</Button>
					<Link
						className={buttonVariants({ size: "sm", variant: "ghost" })}
						to={buildOrganizationCenterAgentSettingsPath(
							input.organizationSlug
						)}
					>
						<GearSixIcon aria-hidden="true" data-icon="inline-start" />
						Manage Center Agent
					</Link>
				</div>
			</section>
		</AppMainContent>
	);
}

function CenterAgentConnectRequiredPage(input: { organizationSlug: string }) {
	return (
		<AppMainContent bodyClassName="flex" header={null}>
			<section className="m-auto max-w-sm space-y-4 p-6">
				<div className="space-y-2">
					<p className="font-medium text-foreground text-sm">
						Connect a Center Agent
					</p>
					<p className="text-muted-foreground text-sm">
						Connect your Center Agent in Center Agent settings before starting
						this conversation.
					</p>
				</div>
				<Link
					className={buttonVariants({ size: "sm" })}
					to={buildOrganizationCenterAgentSettingsPath(input.organizationSlug)}
				>
					<GearSixIcon aria-hidden="true" data-icon="inline-start" />
					Open Center Agent settings
				</Link>
			</section>
		</AppMainContent>
	);
}
