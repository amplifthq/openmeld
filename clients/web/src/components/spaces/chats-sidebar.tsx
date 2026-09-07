import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { FunnelSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { SidebarDestinationAction } from "#/components/app/sidebar-destination-actions";
import { SidebarSearchInput } from "#/components/app/sidebar-search-input";
import { CenterAgentChatSidebar } from "#/components/organizations/center-agent-chat-sidebar";
import { EMPTY_CHAT_PREFERENCES } from "#/lib/organizations/center-agent-chat-preferences";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationDirectMessagePath,
	buildOrganizationDirectMessagesPath,
} from "#/lib/organizations/organization-routes";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import {
	APP_NAV_GROUP_CLASS_NAME,
	APP_NAV_GROUP_LABEL_CLASS_NAME,
	APP_NAV_GROUP_SPACING_CLASS_NAME,
} from "../app/app-nav-item-style";
import { AppSidebarGroup } from "../app/app-sidebar-group";
import { SidebarDrag } from "../app/sidebar-drag";
import { SidebarSectionActions } from "../app/sidebar-section-actions";
import { useSidebarPreferences } from "../app/use-sidebar-preferences";
import { resolveAccountSpaceViewerProfileId } from "./account-space-sections";
import { AppDirectMessagesSidebar } from "./app-direct-messages-sidebar";
import { NewDirectMessageDialog } from "./new-direct-message-dialog";

export type ChatCategory = "all" | "people" | "agents";
const TRAILING_SLASH = /\/$/;

export function ChatsSidebar(input: {
	currentProfileId?: string;
	currentSpaceId?: string;
}) {
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const { currentOrganization: org } = useAppOrganization();
	const profileId =
		input.currentProfileId ?? defaultHumanProfile?.openMeldProfileId ?? "";
	const [category, setCategory] = useState<ChatCategory>("all");
	const sidebar = useSidebarPreferences(profileId, org.id);
	const [archived, setArchived] = useState(false);
	const [creating, setCreating] = useState(false);
	const [search, setSearch] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const orderKey = `openmeld:chat-category-order:${org.id}:${profileId}`;
	const [savedOrder, setSavedOrder] = useState<{
		key: string;
		peopleFirst: boolean;
	} | null>(null);
	useEffect(() => {
		try {
			setSavedOrder({
				key: orderKey,
				peopleFirst: localStorage.getItem(orderKey) === "people",
			});
		} catch {
			setSavedOrder({ key: orderKey, peopleFirst: false });
		}
	}, [orderKey]);
	const order =
		savedOrder?.key === orderKey && savedOrder.peopleFirst
			? ["people", "agents"]
			: ["agents", "people"];
	const [firstPerson, setFirstPerson] = useState<string | null>();
	const [firstRemote, setFirstRemote] = useState<string | null>();
	const [firstOther, setFirstOther] = useState<string | null>();
	const [firstPinnedRemote, setFirstPinnedRemote] = useState<string | null>();
	const [firstPinnedOther, setFirstPinnedOther] = useState<string | null>();
	const navigate = useNavigate();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const pathForItem = useCallback(
		(item: AccountSpaceItem | null | undefined) => {
			return item
				? buildOrganizationDirectMessagePath({
						orgSlug: org.slug,
						spaceId: item.spaceId,
						search: {
							profileId: resolveAccountSpaceViewerProfileId({
								currentProfileId: profileId,
								item,
							}),
						},
					})
				: item;
		},
		[org.slug, profileId]
	);
	const onFirstOther = useCallback(
		(item: AccountSpaceItem | null | undefined) =>
			setFirstOther(pathForItem(item)),
		[pathForItem]
	);
	const onFirstPerson = useCallback(
		(item: AccountSpaceItem | null | undefined) =>
			setFirstPerson(pathForItem(item)),
		[pathForItem]
	);
	const onFirstPinnedOther = useCallback(
		(item: AccountSpaceItem | null | undefined) =>
			setFirstPinnedOther(pathForItem(item)),
		[pathForItem]
	);
	const pinnedRemote = category === "people" ? null : firstPinnedRemote;
	const firstPinned = pinnedRemote === null ? firstPinnedOther : pinnedRemote;
	const hasPinned = pinnedRemote !== null || firstPinnedOther !== null;
	const firstAgent = firstRemote === null ? firstOther : firstRemote;
	const firstCategory = category === "all" ? order[0] : category;
	const firstPath = firstCategory === "agents" ? firstAgent : firstPerson;
	const otherPath = firstCategory === "agents" ? firstPerson : firstAgent;
	const unpinnedEntryPath =
		firstPath === null && category === "all" ? otherPath : firstPath;
	const entryPath = firstPinned === null ? unpinnedEntryPath : firstPinned;
	useEffect(() => {
		if (
			pathname.replace(TRAILING_SLASH, "") ===
				buildOrganizationDirectMessagesPath(org.slug) &&
			entryPath &&
			savedOrder?.key === orderKey
		) {
			navigate({ to: entryPath, replace: true });
		}
	}, [entryPath, navigate, org.slug, pathname, savedOrder, orderKey]);
	return (
		<div className="min-w-0">
			<SidebarSearchInput
				destination="directMessages"
				label="Search chats"
				onOpenChange={setSearchOpen}
				onValueChange={setSearch}
				open={searchOpen}
				value={search}
			/>
			<SidebarDestinationAction destination="directMessages">
				<Button
					aria-label="New chat"
					className="size-6"
					onClick={() => setCreating(true)}
					size="icon-sm"
					title="New chat"
					variant="ghost"
				>
					<PlusIcon />
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								aria-label="Filter chats"
								className="size-6"
								size="icon-sm"
								title="Filter chats"
								variant="ghost"
							/>
						}
					>
						<FunnelSimpleIcon />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem
							onClick={() => requestAnimationFrame(() => setSearchOpen(true))}
						>
							Search manually
						</DropdownMenuItem>
						{(
							[
								["all", "All chats"],
								["people", "People"],
								["agents", "Agents"],
							] as const
						).map(([value, label]) => (
							<DropdownMenuCheckboxItem
								checked={category === value}
								key={value}
								onCheckedChange={() => {
									setCategory(value);
								}}
							>
								{label}
							</DropdownMenuCheckboxItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarDestinationAction>
			<div hidden={!hasPinned}>
				<AppSidebarGroup
					groupClassName={APP_NAV_GROUP_CLASS_NAME}
					groupId="chats:pinned"
					keepMounted
					label="Pinned"
					labelClassName={APP_NAV_GROUP_LABEL_CLASS_NAME}
					labelText="Pinned"
				>
					{category !== "people" && (
						<CenterAgentChatSidebar
							embedded
							onFirstChatChange={setFirstPinnedRemote}
							pinFilter="pinned"
							search={search}
							showArchived={archived}
						/>
					)}
					<AppDirectMessagesSidebar
						category={category === "agents" ? "local" : category}
						currentProfileId={profileId}
						currentSpaceId={input.currentSpaceId ?? ""}
						embedded
						onFirstChatChange={onFirstPinnedOther}
						pinFilter="pinned"
						search={search}
					/>
				</AppSidebarGroup>
			</div>
			<SidebarDrag
				groupIds={order}
				onMove={() => undefined}
				onMoveGroup={(id, before) => {
					const next = order.filter((item) => item !== id);
					const index = before ? next.indexOf(before) : next.length;
					next.splice(index < 0 ? next.length : index, 0, id);
					const peopleFirst = next[0] === "people";
					setSavedOrder({ key: orderKey, peopleFirst });
					try {
						localStorage.setItem(orderKey, peopleFirst ? "people" : "agents");
					} catch {
						/* Keep this visit's choice when storage is unavailable. */
					}
				}}
			>
				{order
					.filter((id) => category === "all" || category === id)
					.map((id, index) => (
						<AppSidebarGroup
							groupClassName={`${APP_NAV_GROUP_CLASS_NAME} ${index > 0 || hasPinned ? APP_NAV_GROUP_SPACING_CLASS_NAME : ""}`}
							groupId={`chats:${id}`}
							keepMounted
							key={id}
							label={id === "agents" ? "Agents" : "People"}
							labelAccessory={
								<SidebarSectionActions
									addLabel="Add chat or group"
									disabled={sidebar.disabled}
									filter={
										id === "agents"
											? {
													label: "Archived chats",
													checked: archived,
													onCheckedChange: setArchived,
												}
											: undefined
									}
									label={id === "agents" ? "Agents" : "People"}
									newItemLabel="New chat"
									onNewGroup={(name) => {
										if (!sidebar.preferences) {
											return;
										}
										const p = sidebar.preferences;
										const key = id === "agents" ? "chats" : "messages";
										const current =
											p[key] ??
											(key === "chats"
												? EMPTY_CHAT_PREFERENCES
												: {
														pinned: { sort: "priority" as const, spaceIds: [] },
														spaces: { sort: "priority" as const, spaceIds: [] },
														groups: [],
													});
										sidebar.save({
											...p,
											[key]: {
												...current,
												groups: [
													...current.groups,
													{
														id: crypto.randomUUID(),
														name,
														sort: "manual",
														spaceIds: [],
													},
												],
											},
										});
									}}
									onNewItem={() => setCreating(true)}
									onSort={(sort) => {
										if (!sidebar.preferences) {
											return;
										}
										const p = sidebar.preferences;
										const messages = p.messages ?? {
											pinned: { sort: "priority" as const, spaceIds: [] },
											spaces: { sort: "priority" as const, spaceIds: [] },
											groups: [],
										};
										const chats = p.chats ?? EMPTY_CHAT_PREFERENCES;
										sidebar.save({
											...p,
											messages: {
												...messages,
												spaces: { ...messages.spaces, sort },
											},
											...(id === "agents"
												? {
														chats: {
															...chats,
															spaces: { ...chats.spaces, sort },
														},
													}
												: {}),
										});
									}}
									sort={
										id === "agents"
											? (sidebar.preferences?.chats?.spaces.sort ?? "recent")
											: (sidebar.preferences?.messages?.spaces.sort ?? "recent")
									}
									sortOptions={[
										["recent", "Newest first"],
										["name", "Name"],
										["manual", "Manual order"],
									]}
								/>
							}
							labelClassName={APP_NAV_GROUP_LABEL_CLASS_NAME}
							labelText={id === "agents" ? "Agents" : "People"}
							reorderId={id}
						>
							{id === "agents" ? (
								<>
									<CenterAgentChatSidebar
										embedded
										onFirstChatChange={setFirstRemote}
										pinFilter="unpinned"
										search={search}
										showArchived={archived}
									/>
									<AppDirectMessagesSidebar
										category="local"
										currentProfileId={profileId}
										currentSpaceId={input.currentSpaceId ?? ""}
										embedded
										onFirstChatChange={onFirstOther}
										pinFilter="unpinned"
										search={search}
									/>
								</>
							) : (
								<AppDirectMessagesSidebar
									category="people"
									currentProfileId={profileId}
									currentSpaceId={input.currentSpaceId ?? ""}
									embedded
									onFirstChatChange={onFirstPerson}
									pinFilter="unpinned"
									search={search}
								/>
							)}
						</AppSidebarGroup>
					))}
			</SidebarDrag>
			<NewDirectMessageDialog onOpenChange={setCreating} open={creating} />
		</div>
	);
}
