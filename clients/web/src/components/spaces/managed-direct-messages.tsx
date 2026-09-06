import type { AccountSidebarPreferences } from "@openmeld/schemas";
import { FluidNavMenu } from "@openmeld/ui/fluid/nav-menu";
import { cn } from "@openmeld/ui/lib/utils";
import { useQueries } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { spaceActiveWakeProgressSummaryQueryOptions } from "#/query/spaces/active-wake-progress";
import {
	APP_NAV_GROUP_CLASS_NAME,
	APP_NAV_GROUP_SPACING_CLASS_NAME,
} from "../app/app-nav-item-style";
import { AppSidebarGroup } from "../app/app-sidebar-group";
import { SidebarDrag, SidebarDropSection } from "../app/sidebar-drag";
import { SidebarSectionActions } from "../app/sidebar-section-actions";
import { useSidebarPreferences } from "../app/use-sidebar-preferences";
import { NewDirectMessageDialog } from "./new-direct-message-dialog";
import { moveSidebarSpace, sortSidebarSpaces } from "./sidebar-space-order";
import { buildSpaceActiveWakeSummary } from "./space-sidebar-menu-item";
import { useAccountSpaceIndicators } from "./use-account-space-indicators";
import { useAccountSpacePinMutation } from "./use-account-space-pin-mutation";

type Preferences = NonNullable<AccountSidebarPreferences["messages"]>;
const EMPTY: Preferences = {
	pinned: { sort: "priority", spaceIds: [] },
	spaces: { sort: "priority", spaceIds: [] },
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
	const sections = [
		...(input.items.some((i) => i.pinnedAt !== null)
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
			indicators.activeWakeSpaceIds
		),
	}));
	const save = (messages: Preferences) => {
		if (sidebar.preferences) {
			sidebar.save({ ...sidebar.preferences, messages });
		}
	};
	return (
		<>
			<SidebarDrag
				isolatedSection="pinned"
				onMove={(section, id, before) => {
					if (!sidebar.disabled) {
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
								disabled={sidebar.disabled}
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
							/>
						}
						labelClassName="ps-1.5"
						labelText={section.label}
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
