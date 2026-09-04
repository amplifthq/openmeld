"use client";

import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { SidebarContent } from "@openmeld/ui/components/sidebar";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { FluidNavMenu, FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import { cn } from "@openmeld/ui/lib/utils";
import { ChatCircleTextIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AppInnerSidebarHeader } from "#/components/app/app-inner-sidebar";
import {
	APP_NAV_ITEM_TONE_CLASS_NAME,
	APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
} from "#/components/app/app-nav-item-style";
import { CenterTruncatedText } from "#/components/app/center-truncated-text";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationDirectMessagePath } from "#/lib/organizations/organization-routes";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { centerAgentDesignationQueryOptions } from "#/query/organizations/center-agent";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import { spaceMembersQueryOptions } from "#/query/spaces/members";
import {
	resolveAccountSpaceViewerProfileId,
	selectAccountSpaceSections,
} from "./account-space-sections";
import { SpaceProfileIcon } from "./space-profile-icon";
import { useSpaceInboxUnreadById } from "./use-account-space-indicators";

type DirectMessagePeer =
	| SpaceMembersSnapshot["humans"][number]
	| SpaceMembersSnapshot["agents"][number];

type DirectMessagesListState =
	| "loading"
	| "load-error"
	| "ready"
	| "refresh-error"
	| "refresh-retrying";

export function AppDirectMessagesSidebar(input: {
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
	const centerAgentProfileId =
		centerAgentDesignationQuery.data?.designation?.agentProfileId ?? null;
	const unreadBySpaceId = useSpaceInboxUnreadById({
		enabled: input.currentProfileId.trim().length > 0,
		organizationId: currentOrganization.id,
	});
	let listState: DirectMessagesListState = "ready";
	if (spacesQuery.isPending) {
		listState = "loading";
	} else if (spacesQuery.isError && spacesQuery.data === undefined) {
		listState = "load-error";
	} else if (spacesQuery.isError && spacesQuery.isRefetching) {
		listState = "refresh-retrying";
	} else if (spacesQuery.isError) {
		listState = "refresh-error";
	}

	return (
		<nav
			aria-label="Direct Messages"
			className="flex h-full min-h-0 w-full flex-col text-sidebar-foreground"
			data-slot="app-direct-messages-sidebar"
		>
			<AppInnerSidebarHeader title="Direct Messages" />
			<SidebarContent className="px-3 pt-[9px] pb-2">
				<DirectMessagesList
					centerAgentProfileId={centerAgentProfileId}
					currentProfileId={input.currentProfileId}
					currentSpaceId={input.currentSpaceId}
					items={directMessageItems}
					onRetry={() => {
						spacesQuery.refetch().catch((error: unknown) => {
							console.error("Failed to refresh Direct Messages.", error);
						});
					}}
					organizationSlug={currentOrganization.slug}
					state={listState}
					unreadBySpaceId={unreadBySpaceId}
				/>
			</SidebarContent>
		</nav>
	);
}

function DirectMessagesList(input: {
	centerAgentProfileId: string | null;
	currentProfileId: string;
	currentSpaceId: string;
	items: readonly AccountSpaceItem[];
	onRetry: () => void;
	organizationSlug: string;
	state: DirectMessagesListState;
	unreadBySpaceId: ReadonlyMap<
		string,
		{ latestUnreadOccurredAtMs: number; unreadCount: number }
	>;
}) {
	if (input.state === "loading") {
		return (
			<output className="flex flex-col gap-1">
				<span className="sr-only">Loading Direct Messages</span>
				{Array.from({ length: 6 }).map((_, index) => (
					<div
						className="flex h-10 items-center gap-2 px-2"
						key={`direct-message-sidebar-skeleton-${String(index)}`}
					>
						<Skeleton className="size-6 rounded-full" />
						<Skeleton className="h-4 flex-1" />
					</div>
				))}
			</output>
		);
	}

	if (input.state === "load-error") {
		return (
			<div className="flex flex-col gap-3 p-2">
				<p className="text-muted-foreground text-xs">
					OpenMeld could not load your Direct Messages.
				</p>
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

	const conversations =
		input.items.length === 0 ? (
			<p className="p-2 text-muted-foreground text-xs">
				No Direct Messages yet.
			</p>
		) : (
			<FluidNavMenu
				activeIndicatorClassName="bg-sidebar-accent"
				activeValue={input.currentSpaceId || null}
				aria-label="Direct Message conversations"
				focusIndicatorClassName="border-sidebar-ring"
				hoverIndicatorClassName="bg-sidebar-accent"
			>
				{input.items.map((item, index) => (
					<DirectMessageSidebarItem
						centerAgentProfileId={input.centerAgentProfileId}
						currentProfileId={input.currentProfileId}
						index={index}
						isActive={item.spaceId === input.currentSpaceId}
						item={item}
						key={item.spaceId}
						organizationSlug={input.organizationSlug}
						unreadCount={
							input.unreadBySpaceId.get(item.spaceId)?.unreadCount ?? 0
						}
					/>
				))}
			</FluidNavMenu>
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

function DirectMessageSidebarItem(input: {
	centerAgentProfileId: string | null;
	currentProfileId: string;
	index: number;
	isActive: boolean;
	item: AccountSpaceItem;
	organizationSlug: string;
	unreadCount: number;
}) {
	const viewerProfileId = resolveAccountSpaceViewerProfileId({
		currentProfileId: input.currentProfileId,
		item: input.item,
	});
	const membersQuery = useQuery(
		spaceMembersQueryOptions({
			enabled: true,
			spaceId: input.item.spaceId,
			openMeldProfileId: viewerProfileId,
		})
	);
	const peer = resolveDirectMessagePeer({
		members: membersQuery.data,
		viewerProfileId,
	});
	const label = peer?.profileName ?? input.item.spaceName;
	const hasUnread = input.unreadCount > 0;
	const accessibleLabel = hasUnread ? `${label}, unread messages` : label;
	const routePath = buildOrganizationDirectMessagePath({
		orgSlug: input.organizationSlug,
		search: { profileId: viewerProfileId },
		spaceId: input.item.spaceId,
	});
	return (
		<FluidNavMenuItem index={input.index} value={input.item.spaceId}>
			<Tooltip>
				<TooltipTrigger
					render={
						<Link
							aria-current={input.isActive ? "page" : undefined}
							aria-label={accessibleLabel}
							className={cn(
								"flex min-h-10 w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring",
								APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
								APP_NAV_ITEM_TONE_CLASS_NAME,
								input.isActive
									? "font-medium text-sidebar-accent-foreground"
									: null,
								hasUnread ? "font-semibold text-sidebar-foreground" : null
							)}
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
									isCenterAgent={peer.profileId === input.centerAgentProfileId}
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
							<CenterTruncatedText className="flex-1" text={label} />
							{hasUnread ? (
								<span
									aria-hidden="true"
									className="size-1.5 shrink-0 rounded-full bg-amber-400"
									data-direct-message-unread-indicator="true"
								/>
							) : null}
						</Link>
					}
				/>
				<TooltipContent align="start" side="right">
					{label}
				</TooltipContent>
			</Tooltip>
		</FluidNavMenuItem>
	);
}

function resolveDirectMessagePeer(input: {
	members: SpaceMembersSnapshot | undefined;
	viewerProfileId: string;
}): DirectMessagePeer | null {
	const activeMembers = [
		...(input.members?.humans ?? []),
		...(input.members?.agents ?? []),
	].filter((member) => member.status === "active");
	return (
		activeMembers.find(
			(member) => member.profileId !== input.viewerProfileId
		) ?? null
	);
}
