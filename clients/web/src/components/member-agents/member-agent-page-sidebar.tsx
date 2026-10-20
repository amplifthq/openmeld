import type { AuthProfileView } from "@openmeld/schemas/types";
import { Input } from "@openmeld/ui/components/input";
import { FluidNavMenu } from "@openmeld/ui/fluid/nav-menu";
import {
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@openmeld/ui/fluid/sidebar-menu";
import { TabItem, Tabs, TabsList } from "@openmeld/ui/fluid/tabs";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArchiveIcon,
	CaretDownIcon,
	CaretRightIcon,
	ChatCircleTextIcon,
	ChatsCircleIcon,
	RobotIcon,
} from "@phosphor-icons/react";
import { useId, useState } from "react";
import {
	type AppContextualNavGroup,
	AppContextualSidebarNav,
} from "#/components/app/app-contextual-layout";
import {
	APP_NAV_ITEM_TONE_CLASS_NAME,
	APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
} from "#/components/app/app-nav-item-style";
import { CenterTruncatedText } from "#/components/app/center-truncated-text";
import {
	SidebarNestedNavList,
	type SidebarNestedNavSection,
} from "#/components/app/sidebar-nested-nav-list";
import { formatMemberAgentProfileDisplayName } from "./member-agent-display-name";
import { useMemberAgentPageSessionList } from "./member-agent-session-nav";

type SessionState = "active" | "archived";

/** Sessions whose title contains the search term; every section stays. */
export function filterMemberAgentSessionSections(
	sections: readonly SidebarNestedNavSection[],
	search: string
): SidebarNestedNavSection[] {
	const term = search.trim().toLocaleLowerCase();
	return sections.map((section) => ({
		...section,
		items: term
			? section.items.filter((item) =>
					item.label.toLocaleLowerCase().includes(term)
				)
			: section.items,
	}));
}

/**
 * Sidebar of an Agent's page. With one Profile it lists that Profile's chats
 * directly. With several, each Profile is a row that opens its page, with its
 * chats nested under it on the sub-menu guide line and a chevron at the far
 * right that folds them away.
 */
export function MemberAgentPageSidebar(input: {
	memberAgentId: string;
	displayName: string;
	profiles: readonly AuthProfileView[];
	defaultProfileId: string | null;
	activeProfileId: string | null;
	onSelectProfile: (profileId: string) => void;
}) {
	const [state, setState] = useState<SessionState>("active");
	const [search, setSearch] = useState("");
	const sections = filterMemberAgentSessionSections(
		useMemberAgentPageSessionList({
			memberAgentId: input.memberAgentId,
			archived: state === "archived",
		}),
		search
	);
	const emptyLabel = resolveEmptyLabel({ state, search });
	const groups: AppContextualNavGroup[] =
		input.profiles.length > 1
			? [
					{
						id: "profiles",
						ariaLabel: `${input.displayName} Profiles`,
						label: "Profiles",
						contentOnly: true,
						content: (
							<MemberAgentProfileNav
								activeProfileId={input.activeProfileId}
								defaultProfileId={input.defaultProfileId}
								displayName={input.displayName}
								emptyLabel={emptyLabel}
								onSelectProfile={input.onSelectProfile}
								profiles={input.profiles}
								sections={sections}
							/>
						),
					},
				]
			: [
					{
						id: "sessions",
						ariaLabel: `Chats with ${input.displayName}`,
						label: "Chats",
						contentOnly: true,
						items: (sections[0]?.items ?? []).map((item) => ({
							id: item.id,
							icon: ChatCircleTextIcon,
							label: item.label,
							accessory: item.accessory,
							ariaLabel: item.ariaLabel,
							to: item.to,
						})),
					},
				];
	const singleSection =
		input.profiles.length > 1
			? null
			: (sections[0] ?? { id: "sessions", items: [] });
	return (
		<AppContextualSidebarNav
			activeItemId={null}
			ariaLabel={`${input.displayName} chats`}
			groups={groups}
			leadingContent={
				<div className="space-y-2 px-1">
					<Tabs
						onValueChange={(value) =>
							setState(value === "archived" ? "archived" : "active")
						}
						value={state}
					>
						<TabsList aria-label="Chat state" className="flex w-full">
							<TabItem
								className="min-w-0 flex-1 justify-center"
								icon={ChatsCircleIcon}
								label="Active"
								value="active"
							/>
							<TabItem
								className="min-w-0 flex-1 justify-center"
								icon={ArchiveIcon}
								label="Archived"
								value="archived"
							/>
						</TabsList>
					</Tabs>
					<Input
						aria-label="Search chats"
						className="h-8"
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Search chats"
						value={search}
					/>
					{singleSection?.notice ? (
						<p className="px-1 text-muted-foreground text-xs">
							{singleSection.notice}
						</p>
					) : null}
					{singleSection && singleSection.items.length === 0 ? (
						<p className="px-1 text-muted-foreground text-xs">{emptyLabel}</p>
					) : null}
				</div>
			}
			placement="module"
			title={input.displayName}
		/>
	);
}

function resolveEmptyLabel(input: {
	state: SessionState;
	search: string;
}): string {
	if (input.search.trim()) {
		return "No chats match.";
	}
	return input.state === "archived" ? "No archived chats." : "No chats yet.";
}

function MemberAgentProfileNav(input: {
	displayName: string;
	profiles: readonly AuthProfileView[];
	defaultProfileId: string | null;
	activeProfileId: string | null;
	sections: readonly SidebarNestedNavSection[];
	emptyLabel: string;
	onSelectProfile: (profileId: string) => void;
}) {
	const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
	const listId = useId();
	return (
		<FluidNavMenu
			activeLayoutId="member-agent-page-sidebar-selection"
			// The open Profile's row draws its own selection, so the highlight
			// covers the row and not the chats nested under it.
			activeValue={null}
			aria-label={`${input.displayName} Profiles`}
		>
			{input.profiles.map((profile, index) => {
				// The sidebar is titled with the Agent, so a row names the Profile.
				const label = profile.profileName;
				const fullName = formatMemberAgentProfileDisplayName({
					memberAgentName: input.displayName,
					profileName: profile.profileName,
					isDefaultProfile:
						profile.openMeldProfileId === input.defaultProfileId,
				});
				const active = profile.openMeldProfileId === input.activeProfileId;
				const section = input.sections.find(
					(candidate) => candidate.id === profile.openMeldProfileId
				);
				const open = !folded.has(profile.openMeldProfileId);
				const nestedId = `${listId}-${index}`;
				return (
					<SidebarMenuItem key={profile.openMeldProfileId}>
						<SidebarMenuButton
							aria-current={active ? "page" : undefined}
							aria-label={fullName}
							className={cn(
								APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
								APP_NAV_ITEM_TONE_CLASS_NAME,
								active && "text-sidebar-accent-foreground"
							)}
							isActive={active}
							onClick={() => input.onSelectProfile(profile.openMeldProfileId)}
						>
							<RobotIcon aria-hidden="true" className="size-4 shrink-0" />
							<CenterTruncatedText className="flex-1" text={label} />
						</SidebarMenuButton>
						<SidebarMenuAction
							aria-controls={nestedId}
							aria-expanded={open}
							aria-label={`${open ? "Hide" : "Show"} chats with ${fullName}`}
							onClick={() =>
								setFolded((current) => {
									const next = new Set(current);
									if (open) {
										next.add(profile.openMeldProfileId);
									} else {
										next.delete(profile.openMeldProfileId);
									}
									return next;
								})
							}
						>
							{open ? <CaretDownIcon /> : <CaretRightIcon />}
						</SidebarMenuAction>
						<SidebarNestedNavList
							activeItemId={null}
							ariaLabel={`Chats with ${fullName}`}
							className="ml-[17px]"
							id={nestedId}
							open={open}
							sections={[
								{
									id: profile.openMeldProfileId,
									notice:
										section?.notice ??
										(section?.items.length ? undefined : input.emptyLabel),
									items: section?.items ?? [],
								},
							]}
						/>
					</SidebarMenuItem>
				);
			})}
		</FluidNavMenu>
	);
}
