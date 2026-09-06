import type { AccountSidebarPreferences } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { FluidNavMenu } from "@openmeld/ui/fluid/nav-menu";
import { cn } from "@openmeld/ui/lib/utils";
import { useQueries } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { spaceActiveWakeProgressSummaryQueryOptions } from "#/query/spaces/active-wake-progress";
import {
	APP_NAV_GROUP_CLASS_NAME,
	APP_NAV_GROUP_LABEL_CLASS_NAME,
	APP_NAV_GROUP_SPACING_CLASS_NAME,
} from "../app/app-nav-item-style";
import { AppSidebarGroup } from "../app/app-sidebar-group";
import { SidebarDrag, SidebarDropSection } from "../app/sidebar-drag";
import { SidebarSectionActions } from "../app/sidebar-section-actions";
import { useSidebarPreferences } from "../app/use-sidebar-preferences";
import { spaceMessagePreviewQueryOptions } from "./direct-message-preview";
import { NewDirectMessageDialog } from "./new-direct-message-dialog";
import { moveSidebarSpace, sortSidebarSpaces } from "./sidebar-space-order";
import { buildSpaceActiveWakeSummary } from "./space-active-wake-presentation";
import { useAccountSpaceIndicators } from "./use-account-space-indicators";
import { useAccountSpacePinMutation } from "./use-account-space-pin-mutation";

type Preferences = NonNullable<AccountSidebarPreferences["messages"]>;
const EMPTY: Preferences = {
	pinned: { sort: "priority", spaceIds: [] },
	spaces: { sort: "recent", spaceIds: [] },
	groups: [],
};
export type ManagedDirectMessageRowProps = {
	item: AccountSpaceItem;
	index: number;
	section: string;
	disabled: boolean;
	onTogglePin: () => void;
};

export function ManagedDirectMessages(input: {
	items: readonly AccountSpaceItem[];
	currentProfileId: string;
	currentSpaceId: string;
	renderRow: (props: ManagedDirectMessageRowProps) => ReactNode;
}) {
	const { currentOrganization } = useAppOrganization();
	const sidebar = useSidebarPreferences(
		input.currentProfileId,
		currentOrganization.id
	);
	const preferences = sidebar.preferences?.messages ?? EMPTY;
	const pin = useAccountSpacePinMutation({
		currentProfileId: input.currentProfileId,
	});
	const [creating, setCreating] = useState(false);
	const indicators = useAccountSpaceIndicators({
		enabled: !!input.currentProfileId,
		organizationId: currentOrganization.id,
		profileId: input.currentProfileId,
	});
	const activeItems = input.items.filter((item) =>
		indicators.activeWakeSpaceIds.has(item.spaceId)
	);
	const activeQueries = useQueries({
		queries: activeItems.map((item) => ({
			...spaceActiveWakeProgressSummaryQueryOptions({
				enabled: true,
				spaceId: item.spaceId,
				openMeldProfileId: item.openProfileId,
			}),
			refetchInterval: 15_000,
			refetchIntervalInBackground: false,
		})),
	});
	const attention = new Set(
		activeQueries.flatMap((query, index) => {
			const item = activeItems[index];
			if (!(query.data && item)) {
				return [];
			}
			const summary = buildSpaceActiveWakeSummary({
				items: query.data.items,
				spaceId: item.spaceId,
			});
			return summary.statuses?.some(
				(s) => s.kind === "needs_input" || s.kind === "waiting_for_owner"
			)
				? [item.spaceId]
				: [];
		})
	);
	const unread = new Map(
		[...indicators.unreadBySpaceId]
			.filter(([, s]) => s.unreadCount > 0)
			.map(([id, s]) => [id, s.latestUnreadOccurredAtMs])
	);
	const assigned = new Set(preferences.groups.flatMap((g) => g.spaceIds));
	const latestMessages = useQueries({
		queries: input.items.map((item) =>
			spaceMessagePreviewQueryOptions({
				spaceId: item.spaceId,
				viewerProfileId: item.openProfileId,
				enabled: true,
			})
		),
	});
	const conversationActivity = new Map(
		input.items.map((item, index) => [
			item.spaceId,
			latestMessages[index]?.data?.timestamp ??
				(Date.parse(item.spaceCreatedAt ?? "") || 0),
		])
	);
	const sections = [
		...(input.items.some((item) => item.pinnedAt !== null)
			? [
					{
						id: "pinned",
						label: "Pinned",
						settings: preferences.pinned,
						items: input.items.filter((i) => i.pinnedAt !== null),
					},
				]
			: []),
		...preferences.groups.map((g) => ({
			id: g.id,
			label: g.name,
			settings: g,
			items: input.items.filter(
				(i) => i.pinnedAt === null && g.spaceIds.includes(i.spaceId)
			),
		})),
		{
			id: "spaces",
			label: "Direct Messages",
			settings: preferences.spaces,
			items: input.items.filter(
				(i) => i.pinnedAt === null && !assigned.has(i.spaceId)
			),
		},
	].map((s) => ({
		...s,
		items: sortSidebarSpaces(
			s.items,
			s.settings,
			attention,
			unread,
			indicators.activeWakeSpaceIds,
			conversationActivity
		),
	}));
	const save = (messages: Preferences) => {
		if (sidebar.preferences) {
			sidebar.save({ ...sidebar.preferences, messages });
		}
	};
	if (sidebar.isPending || latestMessages.some((query) => query.isPending)) {
		return <Skeleton className="mx-2 h-32" />;
	}
	if (
		(!sidebar.preferences && sidebar.isError) ||
		latestMessages.some((query) => query.isError && query.data === undefined)
	) {
		return (
			<Button
				onClick={() =>
					Promise.all([
						sidebar.retry(),
						...latestMessages
							.filter((query) => query.isError)
							.map((query) => query.refetch()),
					])
				}
				variant="ghost"
			>
				Retry loading sidebar
			</Button>
		);
	}
	return (
		<>
			<SidebarDrag
				onMove={async (section, id, before) => {
					if (!sidebar.disabled) {
						const item = input.items.find((item) => item.spaceId === id);
						if (!(item && (await pin.setPinned(item, section === "pinned")))) {
							return;
						}
						save(
							moveSidebarSpace(
								preferences,
								section,
								id,
								sections
									.find((s) => s.id === section)
									?.items.map((i) => i.spaceId) ?? [],
								before
							)
						);
					}
				}}
			>
				{sections.map((section, sectionIndex) => (
					<AppSidebarGroup
						groupClassName={cn(
							APP_NAV_GROUP_CLASS_NAME,
							sectionIndex > 0 && APP_NAV_GROUP_SPACING_CLASS_NAME
						)}
						groupId={`direct-messages:${section.id}`}
						key={section.id}
						label={section.label}
						labelAccessory={
							<SidebarSectionActions
								addLabel="Add conversation or group"
								disabled={sidebar.disabled || pin.arePinActionsPending}
								label={section.label}
								newItemLabel="New conversation"
								onDelete={
									section.id !== "spaces" && section.id !== "pinned"
										? () =>
												save({
													...preferences,
													groups: preferences.groups.filter(
														(g) => g.id !== section.id
													),
												})
										: undefined
								}
								onNewGroup={
									section.id === "spaces"
										? (name) =>
												save({
													...preferences,
													groups: [
														...preferences.groups,
														{
															id: crypto.randomUUID(),
															name,
															sort: "manual",
															spaceIds: [],
														},
													],
												})
										: undefined
								}
								onNewItem={
									section.id === "spaces" ? () => setCreating(true) : undefined
								}
								onSort={(sort) =>
									save(
										section.id === "spaces" || section.id === "pinned"
											? {
													...preferences,
													[section.id]: { ...preferences[section.id], sort },
												}
											: {
													...preferences,
													groups: preferences.groups.map((g) =>
														g.id === section.id ? { ...g, sort } : g
													),
												}
									)
								}
								sort={section.settings.sort}
								sortOptions={[
									["priority", "Priority"],
									["recent", "Recent activity"],
									["manual", "Manual order"],
								]}
							/>
						}
						labelClassName={APP_NAV_GROUP_LABEL_CLASS_NAME}
						labelText={section.label}
						onRename={
							preferences.groups.some((group) => group.id === section.id)
								? (name) =>
										save({
											...preferences,
											groups: preferences.groups.map((group) =>
												group.id === section.id ? { ...group, name } : group
											),
										})
								: undefined
						}
					>
						<SidebarDropSection
							ids={section.items.map((i) => i.spaceId)}
							section={section.id}
						>
							<FluidNavMenu
								activeValue={input.currentSpaceId || null}
								aria-label={`${section.label} conversations`}
							>
								{section.items.map((item, index) =>
									input.renderRow({
										item,
										index,
										section: section.id,
										disabled: sidebar.disabled || pin.arePinActionsPending,
										onTogglePin: () => pin.toggle(item),
									})
								)}
							</FluidNavMenu>
							{!section.items.length && (
								<p className="p-2 text-muted-foreground text-xs">
									{section.id === "spaces"
										? "Conversations will appear here."
										: "Drag conversations here."}
								</p>
							)}
						</SidebarDropSection>
					</AppSidebarGroup>
				))}
			</SidebarDrag>
			<NewDirectMessageDialog onOpenChange={setCreating} open={creating} />
		</>
	);
}
