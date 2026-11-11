import type { HarnessKind } from "@openmeld/schemas";
import type { AuthProfileView } from "@openmeld/schemas/types";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
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
} from "@phosphor-icons/react";
import {
	type ComponentProps,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
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
import { SpaceProfileIcon } from "#/components/spaces/space-profile-icon";
import { formatMemberAgentProfileDisplayName } from "./member-agent-display-name";
import { useMemberAgentPageSessionList } from "./member-agent-session-nav";

type SessionState = "active" | "archived";

/** Below this tab-list width a tab shows only its icon. */
const ICON_ONLY_TABS_MAX_WIDTH_PX = 160;

/**
 * Sidebar of an Agent's page. With one Profile it lists that Profile's chats
 * directly. With several, each Profile is a row that opens its page, with its
 * chats nested under it on the sub-menu guide line and a chevron at the far
 * right that folds them away. A colleague's Agent lists the viewer's own
 * chats with it the same way.
 */
export function MemberAgentPageSidebar(input: {
	harnessKind: HarnessKind | null;
	/** Null for a colleague's Agent, whose MemberAgent the viewer can't read. */
	memberAgentId: string | null;
	displayName: string;
	profiles: readonly AuthProfileView[];
	defaultProfileId: string | null;
	activeProfileId: string | null;
	onSelectProfile: (profileId: string) => void;
	/** Shown with the empty state when there are no active chats yet. */
	emptyAction?: ReactNode;
}) {
	const [state, setState] = useState<SessionState>("active");
	const sections = useMemberAgentPageSessionList({
		memberAgentId: input.memberAgentId,
		colleagueAgent: input.memberAgentId
			? null
			: {
					harnessKind: input.harnessKind,
					displayName: input.displayName,
					defaultProfileId: input.defaultProfileId,
					profiles: input.profiles,
				},
		archived: state === "archived",
	});
	const noChats = sections.every((section) => section.items.length === 0);
	// An empty list with an action shows only the action, never both.
	const showEmptyAction =
		state === "active" && noChats && Boolean(input.emptyAction);
	let emptyLabel: string | undefined =
		state === "archived" ? "No archived chats." : "No chats yet.";
	if (showEmptyAction) {
		emptyLabel = undefined;
	}
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
								harnessKind={input.harnessKind}
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
				<div className="space-y-2 px-1 pb-2">
					<SessionStateTabs onChange={setState} value={state} />
					{singleSection?.notice ? (
						<p className="px-1 text-muted-foreground text-xs">
							{singleSection.notice}
						</p>
					) : null}
					{emptyLabel && singleSection && singleSection.items.length === 0 ? (
						<p className="px-1 text-muted-foreground text-xs">{emptyLabel}</p>
					) : null}
					{showEmptyAction ? input.emptyAction : null}
				</div>
			}
			placement="module"
			title={input.displayName}
		/>
	);
}

/**
 * Active and Archived split the width evenly. Icons keep their size; labels
 * truncate first, and at the narrowest width move into a tooltip.
 */
function SessionStateTabs(input: {
	value: SessionState;
	onChange: (value: SessionState) => void;
}) {
	const listRef = useRef<HTMLDivElement>(null);
	const [iconOnly, setIconOnly] = useState(false);
	useEffect(() => {
		const node = listRef.current;
		if (!node) {
			return;
		}
		const observer = new ResizeObserver(([entry]) => {
			if (entry) {
				setIconOnly(entry.contentRect.width < ICON_ONLY_TABS_MAX_WIDTH_PX);
			}
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	return (
		<div ref={listRef}>
			<Tabs
				onValueChange={(value) =>
					input.onChange(value === "archived" ? "archived" : "active")
				}
				value={input.value}
			>
				<TabsList aria-label="Chat state" className="flex w-full">
					<SessionStateTab
						icon={ChatsCircleIcon}
						iconOnly={iconOnly}
						label="Active"
						value="active"
					/>
					<SessionStateTab
						icon={ArchiveIcon}
						iconOnly={iconOnly}
						label="Archived"
						value="archived"
					/>
				</TabsList>
			</Tabs>
		</div>
	);
}

function SessionStateTab({
	icon: Icon,
	iconOnly,
	label,
	...props
}: Omit<ComponentProps<typeof TabItem>, "icon" | "children"> & {
	icon: typeof ArchiveIcon;
	iconOnly: boolean;
}) {
	const tab = (
		<TabItem
			{...props}
			aria-label={label}
			className="min-w-0 flex-1 justify-center text-muted-foreground hover:text-foreground aria-selected:font-semibold aria-selected:text-foreground"
			label={label}
		>
			<Icon aria-hidden="true" className="size-4 shrink-0" />
			{iconOnly ? null : (
				<span className="min-w-0 truncate text-sm">{label}</span>
			)}
		</TabItem>
	);
	if (!iconOnly) {
		return tab;
	}
	return (
		<Tooltip>
			<TooltipTrigger render={tab} />
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}

function MemberAgentProfileNav(input: {
	harnessKind: HarnessKind | null;
	displayName: string;
	profiles: readonly AuthProfileView[];
	defaultProfileId: string | null;
	activeProfileId: string | null;
	sections: readonly SidebarNestedNavSection[];
	emptyLabel: string | undefined;
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
					harnessKind: input.harnessKind,
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
							<SpaceProfileIcon
								agentControllerRef={null}
								avatarImageUrl={profile.avatarUrl}
								avatarStyle={profile.avatarStyle}
								className="size-4"
								profileId={profile.openMeldProfileId}
								profileKind="agent"
								profileName={profile.profileName}
								size="xs"
							/>
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
