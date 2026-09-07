"use client";

import type { OrganizationProfileDirectoryResponse } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import {
	SidebarMenuActions,
	SidebarMenuButton,
} from "@openmeld/ui/fluid/sidebar-menu";
import { cn } from "@openmeld/ui/lib/utils";
import { ChatCircleTextIcon, PushPinIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	APP_NAV_ITEM_TONE_CLASS_NAME,
	APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
} from "#/components/app/app-nav-item-style";
import { CenterTruncatedText } from "#/components/app/center-truncated-text";
import { SidebarListSkeleton } from "#/components/app/sidebar-list-skeleton";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationDirectMessagePath } from "#/lib/organizations/organization-routes";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { useNowMs } from "#/lib/spaces/use-now-ms";
import { centerAgentDesignationQueryOptions } from "#/query/organizations/center-agent";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import { useSortableSidebarItem } from "../app/sidebar-drag";
import { SidebarRowAction } from "../app/sidebar-row-action";
import {
	resolveAccountSpaceViewerProfileId,
	selectAccountSpaceSections,
} from "./account-space-sections";
import {
	useDirectMessagePreview,
	useSpaceMessagePreview,
} from "./direct-message-preview";
import {
	type ManagedDirectMessageRowProps,
	ManagedDirectMessages,
} from "./managed-direct-messages";
import {
	resolveConversationTimestamp,
	SidebarConversationTime,
} from "./sidebar-conversation-time";
import { SpaceProfileIcon } from "./space-profile-icon";
import { useSpaceInboxUnreadById } from "./use-account-space-indicators";

type DirectMessagePeer = {
	agentControllerRef: string | null;
	avatarUrl: string | null;
	profileId: string;
	profileKind: "agent" | "human";
	profileName: string;
};

type DirectMessagesListState =
	| "loading"
	| "load-error"
	| "ready"
	| "refresh-error"
	| "refresh-retrying";

export function AppDirectMessagesSidebar(input: {
	onFirstChatChange?: (item: AccountSpaceItem | null | undefined) => void;
	embedded?: boolean;
	category?: "all" | "people" | "local";
	search?: string;
	currentProfileId: string;
	currentSpaceId: string;
}) {
	const { currentOrganization } = useAppOrganization();
	const spacesQuery = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: input.currentProfileId.trim().length > 0,
			profileId: input.currentProfileId,
			scope: "account",
		})
	);
	const directMessageItems = spacesQuery.data
		? selectAccountSpaceSections({
				currentOrganizationId: currentOrganization.id,
				sections: spacesQuery.data,
			}).directMessageItems
		: [];
	const centerAgentDesignationQuery = useQuery(
		centerAgentDesignationQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const profileDirectoryQuery = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: input.currentProfileId.trim().length > 0,
			organizationId: currentOrganization.id,
		})
	);
	const centerAgentProfileId =
		centerAgentDesignationQuery.data?.designation?.agentProfileId ?? null;
	const unreadBySpaceId = useSpaceInboxUnreadById({
		enabled: input.currentProfileId.trim().length > 0,
		organizationId: currentOrganization.id,
	});
	let listState: DirectMessagesListState = "ready";
	if (
		spacesQuery.isPending ||
		profileDirectoryQuery.isPending ||
		centerAgentDesignationQuery.isPending
	) {
		listState = "loading";
	} else if (
		(spacesQuery.isError && spacesQuery.data === undefined) ||
		(profileDirectoryQuery.isError &&
			profileDirectoryQuery.data === undefined) ||
		(centerAgentDesignationQuery.isError &&
			centerAgentDesignationQuery.data === undefined)
	) {
		listState = "load-error";
	} else if (spacesQuery.isError && spacesQuery.isRefetching) {
		listState = "refresh-retrying";
	} else if (spacesQuery.isError) {
		listState = "refresh-error";
	}

	return (
		<nav
			aria-label="People and local agent chats"
			className="flex w-full min-w-0 flex-col text-sidebar-foreground"
			data-slot="app-direct-messages-sidebar"
		>
			<DirectMessagesList
				centerAgentProfileId={centerAgentProfileId}
				currentProfileId={input.currentProfileId}
				currentSpaceId={input.currentSpaceId}
				embedded={input.embedded}
				items={directMessageItems.filter((item) => {
					const peer = resolveDirectMessagePeer({
						item,
						profileDirectory: profileDirectoryQuery.data,
						viewerProfileId: resolveAccountSpaceViewerProfileId({
							currentProfileId: input.currentProfileId,
							item,
						}),
					});
					if (peer?.profileId === centerAgentProfileId) {
						return false;
					}
					if (
						!(peer?.profileName ?? item.spaceName)
							.toLocaleLowerCase()
							.includes((input.search ?? "").toLocaleLowerCase())
					) {
						return false;
					}
					return (
						!input.category ||
						input.category === "all" ||
						(input.category === "people"
							? peer?.profileKind === "human"
							: peer?.profileKind === "agent")
					);
				})}
				onFirstChatChange={input.onFirstChatChange}
				onRetry={() => {
					Promise.all([
						spacesQuery.refetch(),
						profileDirectoryQuery.refetch(),
						centerAgentDesignationQuery.refetch(),
					]).catch((error: unknown) => {
						console.error("Failed to refresh Direct Messages.", error);
					});
				}}
				organizationSlug={currentOrganization.slug}
				profileDirectory={profileDirectoryQuery.data}
				state={listState}
				unreadBySpaceId={unreadBySpaceId}
			/>
		</nav>
	);
}

function DirectMessagesList(input: {
	embedded?: boolean;
	onFirstChatChange?: (item: AccountSpaceItem | null | undefined) => void;
	centerAgentProfileId: string | null;
	currentProfileId: string;
	currentSpaceId: string;
	items: readonly AccountSpaceItem[];
	onRetry: () => void;
	organizationSlug: string;
	profileDirectory: OrganizationProfileDirectoryResponse | undefined;
	state: DirectMessagesListState;
	unreadBySpaceId: ReadonlyMap<
		string,
		{ latestUnreadOccurredAtMs: number; unreadCount: number }
	>;
}) {
	if (input.state === "loading") {
		return (
			<SidebarListSkeleton label="Loading chats" rowCount={2} showPreview />
		);
	}

	if (input.state === "load-error") {
		return (
			<div className="flex flex-col gap-3 p-2">
				<p className="text-muted-foreground text-xs">Couldn’t load chats.</p>
				<Button
					onClick={input.onRetry}
					size="sm"
					type="button"
					variant="outline"
				>
					Retry
				</Button>
			</div>
		);
	}

	const conversations = (
		<ManagedDirectMessages
			categoryForItem={(item) => {
				const peer = resolveDirectMessagePeer({
					item,
					profileDirectory: input.profileDirectory,
					viewerProfileId: resolveAccountSpaceViewerProfileId({
						currentProfileId: input.currentProfileId,
						item,
					}),
				});
				if (peer?.profileKind === "human") {
					return "People";
				}
				if (peer?.profileKind === "agent") {
					return "Agents";
				}
				return "Chats";
			}}
			currentProfileId={input.currentProfileId}
			currentSpaceId={input.currentSpaceId}
			embedded={input.embedded}
			items={input.items}
			onFirstChatChange={input.onFirstChatChange}
			renderRow={(props) => (
				<DirectMessageSidebarItem
					{...props}
					centerAgentProfileId={input.centerAgentProfileId}
					currentProfileId={input.currentProfileId}
					isActive={props.item.spaceId === input.currentSpaceId}
					key={props.item.spaceId}
					organizationSlug={input.organizationSlug}
					profileDirectory={input.profileDirectory}
					unreadCount={
						input.unreadBySpaceId.get(props.item.spaceId)?.unreadCount ?? 0
					}
				/>
			)}
		/>
	);

	if (input.state === "ready") {
		return conversations;
	}

	return (
		<div className="flex flex-col gap-2">
			<output className="flex flex-col gap-2 rounded-md border border-border/70 bg-card/35 p-2">
				<p className="text-muted-foreground text-xs leading-5">
					Couldn&apos;t refresh Direct Messages. Showing the last saved list
					from this browser.
				</p>
				<Button
					className="self-start"
					disabled={input.state === "refresh-retrying"}
					onClick={input.onRetry}
					size="xs"
					type="button"
					variant="outline"
				>
					Retry
				</Button>
			</output>
			{conversations}
		</div>
	);
}

function DirectMessageSidebarItem(
	input: ManagedDirectMessageRowProps & {
		centerAgentProfileId: string | null;
		currentProfileId: string;
		index: number;
		isActive: boolean;
		item: AccountSpaceItem;
		organizationSlug: string;
		profileDirectory: OrganizationProfileDirectoryResponse | undefined;
		unreadCount: number;
	}
) {
	const viewerProfileId = resolveAccountSpaceViewerProfileId({
		currentProfileId: input.currentProfileId,
		item: input.item,
	});
	const peer = resolveDirectMessagePeer({
		item: input.item,
		profileDirectory: input.profileDirectory,
		viewerProfileId,
	});
	const label = peer?.profileName ?? input.item.spaceName;
	const preview = useDirectMessagePreview({
		spaceId: input.item.spaceId,
		viewerProfileId,
		peerProfileId: input.item.directMessageProfileIds?.find(
			(id) => id !== viewerProfileId
		),
	});
	const latestMessage = useSpaceMessagePreview({
		spaceId: input.item.spaceId,
		viewerProfileId,
		enabled: true,
	});
	const drag = useSortableSidebarItem({
		section: input.section,
		itemId: input.item.spaceId,
		name: label,
		disabled: input.disabled,
	});
	const hasUnread = input.unreadCount > 0;
	const nowMs = useNowMs(preview.data ? 60_000 : null);
	const timestamp = resolveConversationTimestamp(
		latestMessage.data?.timestamp,
		input.item.spaceCreatedAt
	);
	let previewText = "No messages yet";
	if (preview.isPending) {
		previewText = "Loading message…";
	}
	if (preview.isError) {
		previewText = "Couldn’t load preview. Open chat to retry.";
	}
	if (preview.data) {
		previewText = preview.data.text;
	}
	const accessibleLabel = hasUnread ? `${label}, unread messages` : label;
	const routePath = buildOrganizationDirectMessagePath({
		orgSlug: input.organizationSlug,
		search: { profileId: viewerProfileId },
		spaceId: input.item.spaceId,
	});
	return (
		<FluidNavMenuItem
			className="@container/conversation-row relative"
			index={input.index}
			ref={drag.ref}
			style={drag.style}
			value={input.item.spaceId}
		>
			<Tooltip>
				<TooltipTrigger
					render={
						<SidebarMenuButton
							actionLayout="heading"
							asChild
							className="h-auto"
							isActive={input.isActive}
						>
							<Link
								{...drag.rowProps}
								aria-current={input.isActive ? "page" : undefined}
								aria-label={accessibleLabel}
								className={cn(
									"flex min-h-12 w-full min-w-0 items-center gap-2 py-1.5 pl-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring",
									APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
									APP_NAV_ITEM_TONE_CLASS_NAME,
									input.isActive
										? "font-medium text-sidebar-accent-foreground"
										: null,
									hasUnread ? "font-semibold text-sidebar-foreground" : null
								)}
								onClick={() => {
									if (preview.isError) {
										return preview.refetch();
									}
								}}
								to={routePath}
							>
								{peer ? (
									<SpaceProfileIcon
										agentControllerRef={
											peer.profileKind === "agent"
												? peer.agentControllerRef
												: null
										}
										avatarImageUrl={
											peer.profileKind === "human" ? peer.avatarUrl : undefined
										}
										isCenterAgent={
											peer.profileId === input.centerAgentProfileId
										}
										profileId={peer.profileId}
										profileKind={peer.profileKind}
										profileName={peer.profileName}
										size="sm"
									/>
								) : (
									<span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
										<ChatCircleTextIcon aria-hidden="true" className="size-4" />
									</span>
								)}
								<span className="flex min-w-0 flex-1 flex-col gap-0.5">
									<span
										className="flex min-w-0 items-center gap-2"
										data-sidebar="menu-heading"
									>
										<CenterTruncatedText className="flex-1" text={label} />
										{timestamp !== null && (
											<SidebarConversationTime
												now={new Date(nowMs)}
												timestamp={timestamp}
											/>
										)}
									</span>
									<span className="truncate font-normal text-muted-foreground text-xs leading-4">
										{previewText}
									</span>
								</span>
								{hasUnread ? (
									<span
										aria-hidden="true"
										className="status-dot bg-unread"
										data-direct-message-unread-indicator="true"
									/>
								) : null}
							</Link>
						</SidebarMenuButton>
					}
				/>
				<TooltipContent align="start" side="right">
					{label}
				</TooltipContent>
			</Tooltip>
			<SidebarMenuActions className="top-auto bottom-0.5" showOnHover>
				<SidebarRowAction
					disabled={input.disabled}
					label={`${input.item.pinnedAt ? "Unpin" : "Pin"} ${label}`}
					onClick={input.onTogglePin}
				>
					<PushPinIcon weight={input.item.pinnedAt ? "fill" : "regular"} />
				</SidebarRowAction>
			</SidebarMenuActions>
		</FluidNavMenuItem>
	);
}

function resolveDirectMessagePeer(input: {
	item: AccountSpaceItem;
	profileDirectory: OrganizationProfileDirectoryResponse | undefined;
	viewerProfileId: string;
}): DirectMessagePeer | null {
	const profileIds = input.item.directMessageProfileIds;
	if (!profileIds?.includes(input.viewerProfileId)) {
		return null;
	}
	const profileId = profileIds.find(
		(candidate) => candidate !== input.viewerProfileId
	);
	if (!profileId) {
		return null;
	}
	const agent = input.profileDirectory?.agentProfiles.find(
		(profile) => profile.profileId === profileId && profile.status === "active"
	);
	if (agent) {
		return {
			agentControllerRef: agent.agentControllerRef,
			avatarUrl: agent.avatarUrl ?? null,
			profileId,
			profileKind: "agent",
			profileName: agent.profileName,
		};
	}
	const member = input.profileDirectory?.members.find(
		(candidate) =>
			candidate.humanProfile?.profileId === profileId &&
			candidate.humanProfile.status === "active"
	);
	if (!member?.humanProfile) {
		return null;
	}
	return {
		agentControllerRef: null,
		avatarUrl: member.user.image,
		profileId,
		profileKind: "human",
		profileName: member.humanProfile.profileName,
	};
}
