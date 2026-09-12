import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { Dialog } from "@openmeld/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { SettingsDialogContent } from "@openmeld/ui/components/settings-dialog-content";
import { SettingsNav } from "@openmeld/ui/components/settings-nav";
import { FluidDropdownMenuContent } from "@openmeld/ui/fluid/dropdown-menu";
import {
	SharedLayoutGroup,
	SharedLayoutItem,
} from "@openmeld/ui/fluid/shared-layout-group";
import {
	// ChatCircleIcon,
	CheckIcon,
	DesktopTowerIcon,
	FunnelSimpleIcon,
	HashIcon,
	PlusIcon,
	PulseIcon,
	TrayIcon,
	// UsersIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppSidebarGroup } from "#/components/app/app-sidebar-group";
import { DirectorySearch } from "#/components/app/directory-search";
import { useSidebarFilter } from "#/components/app/sidebar-filter";
import { useSidebarPreferences } from "#/components/app/use-sidebar-preferences";
import type { SpaceAddMembersCandidateSummary } from "#/components/spaces/people-agent-picker-model";
import {
	resolveConversationTimestamp,
	SidebarConversationTime,
} from "#/components/spaces/sidebar-conversation-time";
import {
	resolveSidebarAttentionSpaceIds,
	sortSidebarSpaces,
} from "#/components/spaces/sidebar-space-order";
import { spaceDirectoryGroups } from "#/components/spaces/space-directory-groups";
import { SpaceDirectorySummary } from "#/components/spaces/space-directory-summary";
import { SpaceMemberAvatars } from "#/components/spaces/space-member-avatars";
import { useSpaceListIndicators } from "#/components/spaces/use-space-list-indicators";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationNewSpacePath } from "#/lib/organizations/organization-routes";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { DeskChatPicker } from "./desk-chat-picker";
import { DeskProfilePicker } from "./desk-profile-picker";
import type { DeskWidgetKind } from "./desk-widget-types";

const categories = [
	{ id: "spaces", label: "Spaces", icon: HashIcon },
	// MVP: enable these categories when their widgets are ready to ship.
	// { id: "chats", label: "Chats", icon: ChatCircleIcon },
	// { id: "updates", label: "Updates", icon: TrayIcon },
	// { id: "people", label: "People & Agents", icon: UsersIcon },
	// { id: "computers", label: "Computers", icon: DesktopTowerIcon },
] as const;
export function DeskAddDialog(input: {
	open: boolean;
	profileId: string;
	onOpenChange: (open: boolean) => void;
	spaces: readonly AccountSpaceItem[];
	shownIds: readonly string[];
	shownProfileIds: readonly string[];
	onProfiles: (profiles: readonly SpaceAddMembersCandidateSummary[]) => void;
	orgSlug: string;
	loading: boolean;
	error: boolean;
	onRetry: () => void;
	onAdd: (item: AccountSpaceItem) => void;
	onWidget: (kind: DeskWidgetKind) => void;
	onChat: (chat: { spaceId: string; profileId: string; title: string }) => void;
}) {
	const [category, setCategory] = useState<string>("spaces");
	const [query, setQuery] = useState("");
	const { currentOrganization } = useAppOrganization();
	const sidebar = useSidebarPreferences(
		input.profileId,
		currentOrganization.id
	);
	const items = input.spaces.filter((item) => !item.directMessageProfileIds);
	const groups = spaceDirectoryGroups(items, sidebar.preferences);
	const filter = useSidebarFilter(groups, "All groups");
	const indicators = useSpaceListIndicators({
		currentProfileId: input.open ? input.profileId : "",
		currentSpaceId: "",
		organizationId: currentOrganization.id,
		spaceIds: input.open ? items.map((item) => item.spaceId) : [],
	});
	const attention = resolveSidebarAttentionSpaceIds(
		indicators.activeWakeSummaryBySpaceId
	);
	const unread = new Map(
		[...indicators.unreadBySpaceId]
			.filter(([, item]) => item.unreadCount > 0)
			.map(([id, item]) => [id, item.latestUnreadOccurredAtMs])
	);
	const working = new Set(
		[...indicators.activeWakeSummaryBySpaceId]
			.filter(([, item]) => item.activeWakeCount > 0)
			.map(([id]) => id)
	);
	const activity = new Map(
		items.map((item) => [
			item.spaceId,
			resolveConversationTimestamp(
				item.messagePreview?.timestamp,
				item.spaceCreatedAt
			) ?? 0,
		])
	);
	const entries = groups
		.filter((group) => filter.includes(group.id))
		.map((group) => ({
			...group,
			items: sortSidebarSpaces(
				group.items.filter((item) =>
					item.spaceName
						.toLocaleLowerCase()
						.includes(query.trim().toLocaleLowerCase())
				),
				group.section ?? { sort: "priority", spaceIds: [] },
				attention,
				unread,
				working,
				activity
			),
		}))
		.filter((group) => group.items.length > 0);
	const grouped =
		(sidebar.preferences?.groups.length ?? 0) > 0 ||
		items.some((item) => item.pinnedAt !== null);
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<SettingsDialogContent
				description="Choose a Space to add to your canvas."
				navigation={
					<SettingsNav
						activeSectionId={category}
						items={categories.map(({ id, label }) => ({
							id,
							title: label,
						}))}
						onNavigate={setCategory}
					/>
				}
				title="Add to Desk"
			>
				<div className="space-y-4">
					<h2 className="font-medium text-base">
						{categories.find((c) => c.id === category)?.label}
					</h2>
					{category === "spaces" && (
						<>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<Link
									className={buttonVariants({ variant: "outline", size: "sm" })}
									to={buildOrganizationNewSpacePath(input.orgSlug)}
								>
									<PlusIcon aria-hidden />
									New Space
								</Link>
								<div className="flex min-w-0 items-center gap-1">
									<DirectorySearch
										alwaysVisible
										label="Search Spaces"
										onChange={setQuery}
										value={query}
									/>
									<DropdownMenu>
										<DropdownMenuTrigger
											render={
												<Button
													aria-label="Filter groups"
													size="icon-sm"
													variant="ghost"
												/>
											}
										>
											<FunnelSimpleIcon />
										</DropdownMenuTrigger>
										<FluidDropdownMenuContent align="end" className="w-56">
											{filter.menu}
										</FluidDropdownMenuContent>
									</DropdownMenu>
								</div>
							</div>
							{filter.badges}
							{sidebar.isError && (
								<p className="text-sm" role="alert">
									Couldn’t load your groups.{" "}
									<Button
										onClick={() => sidebar.retry()}
										size="sm"
										variant="ghost"
									>
										Try again
									</Button>
								</p>
							)}
							{input.loading && <output>Loading Spaces…</output>}
							{input.error && (
								<div role="alert">
									Couldn’t load Spaces.{" "}
									<Button onClick={input.onRetry} variant="outline">
										Try again
									</Button>
								</div>
							)}
							{!(
								input.loading ||
								input.error ||
								sidebar.isPending ||
								sidebar.isError
							) &&
								entries.length === 0 && (
									<p className="text-muted-foreground text-sm">
										{query || filter.selected.length
											? "No Spaces match your search or filters."
											: "No Spaces yet."}
									</p>
								)}
							<SharedLayoutGroup className="space-y-3">
								{!(sidebar.isPending || sidebar.isError) &&
									entries.map((group) => (
										<AppSidebarGroup
											contentOnly={!grouped}
											groupClassName="p-0"
											groupId={`desk-add-${group.id}`}
											key={`${group.id}:${query.trim()}:${filter.selected.join(",")}`}
											label={group.label}
											labelText={group.label}
										>
											{group.items.map((item) => (
												<SharedLayoutItem
													itemId={item.spaceId}
													key={item.spaceId}
												>
													<Button
														className="h-auto w-full justify-between gap-3 py-3 text-left hover:bg-transparent"
														onClick={() => input.onAdd(item)}
														variant="ghost"
													>
														<span className="min-w-0 flex-1">
															<SpaceDirectorySummary
																item={item}
																preview={item.messagePreview}
															/>
															<span className="mt-2 flex items-center gap-3 pl-6">
																<SpaceMemberAvatars
																	layout="horizontal"
																	members={item.memberPreviews ?? []}
																/>
																<SpaceTime item={item} />
															</span>
														</span>
														<span className="shrink-0 text-muted-foreground text-xs">
															{input.shownIds.includes(item.spaceId) ? (
																<span className="flex items-center gap-1">
																	<CheckIcon aria-hidden />
																	On Desk
																</span>
															) : (
																"Add"
															)}
														</span>
													</Button>
												</SharedLayoutItem>
											))}
										</AppSidebarGroup>
									))}
							</SharedLayoutGroup>
						</>
					)}
					{category === "chats" && (
						<DeskChatPicker
							enabled={input.open}
							onOpenCenterAgent={() => input.onWidget("center")}
							onOpenChat={input.onChat}
						/>
					)}
					{category === "updates" && (
						<>
							<WidgetChoice
								description="See what agents are working on in your Spaces and chats."
								icon={PulseIcon}
								onAdd={() => input.onWidget("activity")}
								title="Active agents"
							/>
							<WidgetChoice
								description="Recent messages, updates, and requests for you."
								icon={TrayIcon}
								onAdd={() => input.onWidget("inbox")}
								title="Inbox"
							/>
						</>
					)}
					{category === "people" && (
						<DeskProfilePicker
							onAdd={input.onProfiles}
							shownIds={input.shownProfileIds}
						/>
					)}
					{category === "computers" && (
						<WidgetChoice
							description="See your computers and their connection status."
							icon={DesktopTowerIcon}
							onAdd={() => input.onWidget("computer")}
							title="Computers"
						/>
					)}
				</div>
			</SettingsDialogContent>
		</Dialog>
	);
}
function SpaceTime({ item }: { item: AccountSpaceItem }) {
	const timestamp = resolveConversationTimestamp(
		item.messagePreview?.timestamp,
		item.spaceCreatedAt
	);
	return timestamp === null ? null : (
		<SidebarConversationTime timestamp={timestamp} />
	);
}
function WidgetChoice(input: {
	title: string;
	description: string;
	icon: typeof PlusIcon;
	onAdd: () => void;
}) {
	const Icon = input.icon;
	return (
		<div className="flex items-start gap-3 rounded-lg bg-surface-1 p-4 shadow-surface-1">
			<Icon
				aria-hidden
				className="mt-1 size-5 shrink-0 text-muted-foreground"
			/>
			<div className="min-w-0 flex-1">
				<h3 className="font-medium text-sm">{input.title}</h3>
				<p className="mt-1 text-muted-foreground text-sm">
					{input.description}
				</p>
			</div>
			<Button
				aria-label={`Add ${input.title}`}
				onClick={input.onAdd}
				size="sm"
				variant="outline"
			>
				<PlusIcon />
				Add
			</Button>
		</div>
	);
}
