"use client";

import { Popover } from "@base-ui/react/popover";
import {
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarRail,
	SidebarTrigger,
} from "@openmeld/ui/components/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	FluidActionList,
	FluidActionListItem,
} from "@openmeld/ui/fluid/action-list";
import { FluidNavMenu, FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import {
	resolveStatusToneCompactBadgeClassName,
	resolveStatusToneIndicatorClassName,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	BuildingsIcon,
	CaretDownIcon,
	ChatCircleTextIcon,
	GearSixIcon,
	HashIcon,
	HouseIcon,
	PlusIcon,
	RobotIcon,
	SidebarSimpleIcon,
	UserIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import {
	Link,
	useMatches,
	useNavigate,
	useRouter,
	useRouterState,
} from "@tanstack/react-router";
import {
	type ReactElement,
	type ReactNode,
	useCallback,
	useEffect,
	useEffectEvent,
	useMemo,
	useState,
} from "react";
import {
	APP_NAV_GROUP_CLASS_NAME,
	APP_NAV_GROUP_LABEL_CLASS_NAME,
	APP_NAV_GROUP_SPACING_CLASS_NAME,
	APP_NAV_ITEM_FULL_DENSITY_CLASS_NAME,
	APP_NAV_ITEM_TONE_CLASS_NAME,
	APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
} from "#/components/app/app-nav-item-style";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { AppOuterRailFrame } from "#/components/app/app-outer-rail-frame";
import {
	AppSidebarGroup,
	AppSidebarGroupStateProvider,
} from "#/components/app/app-sidebar-group";
import { CenterTruncatedText } from "#/components/app/center-truncated-text";
import {
	type AppOuterRailDestination,
	resolveAppOuterRailDestinationFromMatches,
} from "#/components/app/shell-layout";
import { useCenterAgentConversationIntentPrefetch } from "#/components/organizations/use-center-agent-conversation-intent-prefetch";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { useAccountAvatar } from "#/hooks/account.hooks";
import { selectLastSelectedOrganization } from "#/lib/organizations/account-organization-preference";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationAccountSettingsPath,
	buildOrganizationAgentsPath,
	buildOrganizationDirectMessagesPath,
	buildOrganizationNewOrganizationPath,
	buildOrganizationOrganizationsPath,
	buildOrganizationPeoplePath,
	buildOrganizationRootPath,
	buildOrganizationSpacesPath,
	resolveOrganizationSwitchPath,
} from "#/lib/organizations/organization-routes";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import {
	OUTER_SIDEBAR_DEFAULT_STATE,
	resolveClientSidebarInitialState,
	type SidebarPersistedState,
	type SidebarTier,
	writeOuterSidebarStateCookie,
} from "#/lib/sidebar-width-cookie";
import {
	centerAgentInboxSummaryQueryOptions,
	spaceInboxSummaryQueryOptions,
} from "#/query/organizations/inbox";

type AppOuterRailAccount = {
	email?: string | null;
	image?: string | null;
	name?: string | null;
};

type AppRailDestination = {
	attentionCount?: number;
	compactLabel?: string;
	icon: ReactNode;
	id: AppOuterRailDestination;
	label: string;
	onIntentPrefetch?: () => void;
	to: string;
	unreadCount?: number;
};

type AppRailGroup = {
	destinations: readonly AppRailDestination[];
	id: string;
	label: string | null;
};

type HumanProfileAvatarIdentity = {
	avatarImageUrl?: string | null;
	profileId: string;
	profileName: string;
};

type AppOuterRailProps = {
	account: AppOuterRailAccount;
	initialState?: SidebarPersistedState;
};

function resolveNextRailTier(tier: SidebarTier): SidebarTier {
	if (tier === "collapsed") {
		return "compact";
	}
	if (tier === "compact") {
		return "full";
	}
	return "collapsed";
}

function buildAppRailGroups(input: {
	orgSlug: string;
	centerAgentUnreadCount: number;
	prefetchCenterAgentConversation: () => void;
	spacesUnreadCount: number;
}): readonly AppRailGroup[] {
	return [
		{
			id: "home",
			label: null,
			destinations: [
				{
					id: "home",
					label: "Home",
					onIntentPrefetch: input.prefetchCenterAgentConversation,
					to: buildOrganizationRootPath(input.orgSlug),
					icon: <HouseIcon aria-hidden="true" className="size-4" />,
					unreadCount: input.centerAgentUnreadCount,
				},
			],
		},
		{
			id: "work",
			label: "Work",
			destinations: [
				{
					id: "spaces",
					label: "Spaces",
					to: buildOrganizationSpacesPath(input.orgSlug),
					unreadCount: input.spacesUnreadCount,
					icon: (
						<HashIcon
							aria-hidden="true"
							className="size-4"
							data-space-icon="channel"
						/>
					),
				},
				{
					compactLabel: "DMs",
					id: "directMessages",
					label: "Messages",
					to: buildOrganizationDirectMessagesPath(input.orgSlug),
					icon: <ChatCircleTextIcon aria-hidden="true" className="size-4" />,
				},
			],
		},
		{
			id: "team",
			label: "Team",
			destinations: [
				{
					id: "people",
					label: "People",
					to: buildOrganizationPeoplePath(input.orgSlug),
					icon: <UserIcon aria-hidden="true" className="size-4" />,
				},
				{
					id: "agents",
					label: "Agents",
					to: buildOrganizationAgentsPath(input.orgSlug),
					icon: <RobotIcon aria-hidden="true" className="size-4" />,
				},
			],
		},
	];
}

function buildSettingsRailItem(input: { orgSlug: string }): AppRailDestination {
	return {
		id: "settings",
		label: "Settings",
		to: buildOrganizationAccountSettingsPath(input.orgSlug),
		icon: <GearSixIcon aria-hidden="true" className="size-4" />,
	};
}

export function AppOuterRail({ account, initialState }: AppOuterRailProps) {
	const { presentation } = useAppNavigationPresentation();
	const drawerPresentation = presentation === "drawer";
	const [state, setState] = useState<SidebarPersistedState>(() =>
		resolveClientSidebarInitialState(
			"outer",
			initialState ?? OUTER_SIDEBAR_DEFAULT_STATE
		)
	);
	const displayState: SidebarPersistedState = drawerPresentation
		? { ...state, tier: "full", width: "100%" }
		: state;
	const activeDestination = useMatches({
		select: resolveAppOuterRailDestinationFromMatches,
	});
	const { currentOrganization } = useAppOrganization();
	const prefetchCenterAgentConversation =
		useCenterAgentConversationIntentPrefetch();
	const orgSlug = currentOrganization.slug;
	const centerAgentInboxSummary = useQuery(
		centerAgentInboxSummaryQueryOptions({
			organizationId: currentOrganization.id,
		})
	);
	const centerAgentUnreadCount = Math.max(
		0,
		centerAgentInboxSummary.data?.unreadCount ?? 0
	);
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const spaceInboxSummary = useQuery(
		spaceInboxSummaryQueryOptions({
			organizationId: currentOrganization.id,
		})
	);
	const spacesUnreadCount = Math.max(
		0,
		spaceInboxSummary.data?.ordinarySpaceUnreadCount ?? 0
	);
	const { data: currentAccountAvatar } = useAccountAvatar();
	const accountAvatarImage = currentAccountAvatar?.avatar ?? null;
	const humanProfileAvatar: HumanProfileAvatarIdentity | null =
		defaultHumanProfile
			? {
					avatarImageUrl: accountAvatarImage,
					profileId: defaultHumanProfile.openMeldProfileId,
					profileName:
						account.name?.trim() ||
						account.email?.trim() ||
						defaultHumanProfile.profileName,
				}
			: null;

	const persistState = useCallback((next: SidebarPersistedState) => {
		writeOuterSidebarStateCookie(next);
		return next;
	}, []);

	const handleWidthChange = useCallback(
		(width: string) => {
			setState((current) => persistState({ ...current, width }));
		},
		[persistState]
	);
	// packages/ui's SidebarProvider tracks open/compact as two independent
	// booleans; this component's persisted state holds a single `tier`
	// discriminant instead. Every place both can flip together (collapsed ->
	// compact, via drag/click/keyboard) fires onCompactChange before
	// onToggle/onOpenChange (see sidebar.tsx's cycleTier and
	// use-sidebar-resize.ts), so by the time handleOpenChange runs,
	// current.tier already reflects the paired compact update.
	const handleOpenChange = useCallback(
		(open: boolean) => {
			setState((current) =>
				persistState({ ...current, tier: open ? current.tier : "collapsed" })
			);
		},
		[persistState]
	);
	const handleCompactChange = useCallback(
		(compact: boolean) => {
			setState((current) =>
				persistState({ ...current, tier: compact ? "compact" : "full" })
			);
		},
		[persistState]
	);
	const handleCollapsedGroupIdsChange = useCallback(
		(collapsedGroupIds: readonly string[]) => {
			setState((current) => persistState({ ...current, collapsedGroupIds }));
		},
		[persistState]
	);
	// Cmd/Ctrl+B and the drag handle's plain click both cycle forward through
	// all three tiers in the same fixed order.
	const cycleTier = useEffectEvent(() => {
		setState((current) =>
			persistState({
				...current,
				tier: resolveNextRailTier(current.tier),
			})
		);
	});

	useEffect(() => {
		if (drawerPresentation) {
			return;
		}
		const handleKeyDown = (event: KeyboardEvent) => {
			const desktopNavigationQuery = window.matchMedia?.("(min-width: 64rem)");
			if (desktopNavigationQuery && !desktopNavigationQuery.matches) {
				return;
			}
			if (event.key.toLowerCase() === "b" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				cycleTier();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [drawerPresentation]);

	return (
		<AppSidebarGroupStateProvider
			collapsedGroupIds={state.collapsedGroupIds}
			onCollapsedGroupIdsChange={handleCollapsedGroupIdsChange}
		>
			<AppOuterRailFrame
				onCompactChange={drawerPresentation ? undefined : handleCompactChange}
				onOpenChange={drawerPresentation ? undefined : handleOpenChange}
				onWidthChange={drawerPresentation ? undefined : handleWidthChange}
				state={displayState}
			>
				<SidebarHeader className="shrink-0 overflow-hidden border-b-0 p-2 pt-3">
					<OrganizationSwitcher
						account={{ ...account, image: accountAvatarImage }}
						humanProfileAvatar={humanProfileAvatar}
						tier={displayState.tier}
					/>
				</SidebarHeader>
				<SidebarContent
					className={cn(
						"overflow-hidden py-2",
						displayState.tier === "full" ? "px-3" : "px-2"
					)}
				>
					{buildAppRailGroups({
						orgSlug,
						centerAgentUnreadCount,
						prefetchCenterAgentConversation,
						spacesUnreadCount,
					}).map((group, index) => (
						<AppRailNavigationGroup
							activeDestination={activeDestination}
							group={group}
							key={group.id}
							position={index}
							tier={displayState.tier}
						/>
					))}
				</SidebarContent>
				<SidebarFooter className="gap-1 border-t-0 p-2 pb-3">
					{drawerPresentation ? null : (
						<AppRailTrigger tier={displayState.tier} />
					)}
					<FluidNavMenu
						activeIndicatorClassName="bg-sidebar-accent"
						activeValue={activeDestination}
						aria-label="App utilities"
						focusIndicatorClassName="border-sidebar-ring"
						hoverIndicatorClassName="bg-sidebar-accent"
					>
						<AppRailLink
							active={activeDestination === "settings"}
							destination={buildSettingsRailItem({
								orgSlug,
							})}
							index={0}
							tier={displayState.tier}
						/>
					</FluidNavMenu>
				</SidebarFooter>
				{drawerPresentation ? null : (
					<SidebarRail
						autoCollapse
						className="after:top-2 after:bottom-9"
						separatorLabel="Resize app rail"
					/>
				)}
			</AppOuterRailFrame>
		</AppSidebarGroupStateProvider>
	);
}

function AppRailNavigationGroup(input: {
	activeDestination: AppOuterRailDestination | null;
	group: AppRailGroup;
	position: number;
	tier: SidebarTier;
}) {
	const navigation = (
		<FluidNavMenu
			activeIndicatorClassName="bg-sidebar-accent"
			activeValue={input.activeDestination}
			aria-label={input.group.label ?? "Home"}
			focusIndicatorClassName="border-sidebar-ring"
			hoverIndicatorClassName="bg-sidebar-accent"
		>
			{input.group.destinations.map((destination, index) => (
				<AppRailLink
					active={destination.id === input.activeDestination}
					destination={destination}
					index={index}
					key={destination.id}
					tier={input.tier}
				/>
			))}
		</FluidNavMenu>
	);
	const groupClassName = cn(
		APP_NAV_GROUP_CLASS_NAME,
		input.position > 0 &&
			(input.tier === "full" ? APP_NAV_GROUP_SPACING_CLASS_NAME : "mt-2")
	);

	if (input.tier === "full" && input.group.label) {
		return (
			<AppSidebarGroup
				groupClassName={groupClassName}
				groupId={input.group.id}
				label={input.group.label}
				labelClassName={APP_NAV_GROUP_LABEL_CLASS_NAME}
				labelText={input.group.label}
			>
				{navigation}
			</AppSidebarGroup>
		);
	}

	return (
		<SidebarGroup className={groupClassName}>
			<SidebarGroupContent>{navigation}</SidebarGroupContent>
		</SidebarGroup>
	);
}

function CollapsedRailTooltip(input: {
	children: ReactElement;
	label: string;
}) {
	return (
		<Tooltip>
			<TooltipTrigger delay={0} render={input.children} />
			<TooltipContent side="right">{input.label}</TooltipContent>
		</Tooltip>
	);
}

function AppRailTrigger(input: { tier: SidebarTier }) {
	const isIcon = input.tier === "collapsed";
	const isCompact = input.tier === "compact";
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<SidebarTrigger
						aria-label={isIcon ? "Toggle Sidebar" : undefined}
						className={cn(
							"flex min-w-0 items-center border border-transparent text-sidebar-foreground/60 outline-none transition-colors hover:bg-transparent hover:text-sidebar-accent-foreground focus-visible:text-sidebar-accent-foreground aria-expanded:bg-transparent aria-expanded:text-sidebar-foreground/60 dark:hover:bg-transparent",
							isIcon && "mx-auto h-10 justify-center px-0",
							isCompact && "h-auto flex-col justify-center gap-1 px-1 py-2",
							input.tier === "full" && "h-8 w-full justify-start gap-2 px-1"
						)}
						type="button"
						variant="ghost"
					>
						<SidebarSimpleIcon aria-hidden="true" className="size-4 shrink-0" />
						{isIcon ? null : (
							<span
								className={cn(
									"truncate font-medium text-[13px]",
									isCompact && "text-center text-[11px]"
								)}
							>
								{isCompact ? "Toggle" : "Toggle Sidebar"}
							</span>
						)}
					</SidebarTrigger>
				}
			/>
			<TooltipContent side="right">
				<span>Toggle Sidebar</span>
				<kbd data-slot="kbd">⌘+B</kbd>
			</TooltipContent>
		</Tooltip>
	);
}

function OrganizationSwitcher(input: {
	account: AppOuterRailAccount;
	humanProfileAvatar: HumanProfileAvatarIdentity | null;
	tier: SidebarTier;
}) {
	const { dismiss } = useAppNavigationPresentation();
	const isCollapsed = input.tier === "collapsed";
	const isFull = input.tier === "full";
	const isAvatarOnly = !isFull;
	const { currentOrganization, organizations } = useAppOrganization();
	const orderedOrganizations = useMemo(
		() => orderOrganizationsForOrganizationSelector(organizations),
		[organizations]
	);
	const currentOrganizationDisplay = resolveOrganizationDisplay({
		account: input.account,
		organization: currentOrganization,
	});
	const navigate = useNavigate();
	const router = useRouter();
	const currentPathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const [open, setOpen] = useState(false);
	const [isSwitching, setIsSwitching] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const organizationTooltipLabel = `${currentOrganizationDisplay.name} organization`;
	const handleOpenChange = (nextOpen: boolean) => {
		if (isSwitching && !nextOpen) {
			return;
		}
		setOpen(nextOpen);
		if (!nextOpen) {
			setErrorMessage(null);
		}
	};

	const switchOrganization = async (
		nextOrganization: OrganizationSummary
	): Promise<void> => {
		if (isSwitching) {
			return;
		}
		const shouldNavigate = nextOrganization.id !== currentOrganization.id;

		setIsSwitching(true);
		setErrorMessage(null);
		try {
			await selectLastSelectedOrganization(nextOrganization.id);
			if (shouldNavigate) {
				await navigate({
					to: resolveOrganizationSwitchPath({
						currentPathname,
						nextOrgSlug: nextOrganization.slug,
					}),
				});
			} else {
				await router.invalidate({ sync: true });
			}
			setOpen(false);
			dismiss();
		} catch (error) {
			setErrorMessage(
				error instanceof Error
					? error.message
					: "OpenMeld could not switch organizations."
			);
		} finally {
			setIsSwitching(false);
		}
	};

	const openDestination = (to: string, fallbackMessage: string) => {
		if (isSwitching) {
			return;
		}

		setIsSwitching(true);
		setErrorMessage(null);
		navigate({ to })
			.then(() => {
				setOpen(false);
				dismiss();
			})
			.catch((error: unknown) => {
				setErrorMessage(
					error instanceof Error ? error.message : fallbackMessage
				);
			})
			.finally(() => {
				setIsSwitching(false);
			});
	};
	const openCreateOrganization = () => {
		openDestination(
			buildOrganizationNewOrganizationPath(currentOrganization.slug),
			"OpenMeld could not open organization setup."
		);
	};
	const openManageOrganizations = () => {
		openDestination(
			buildOrganizationOrganizationsPath(currentOrganization.slug),
			"OpenMeld could not open organization management."
		);
	};
	const openSettings = () => {
		openDestination(
			buildOrganizationAccountSettingsPath(currentOrganization.slug),
			"OpenMeld could not open Settings."
		);
	};
	const popoverTrigger = (
		<Popover.Trigger
			render={
				<button
					aria-expanded={open}
					aria-haspopup="menu"
					aria-label="Switch organization"
					className={cn(
						"flex min-w-0 items-center rounded-md bg-transparent text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70",
						isAvatarOnly ? "size-9 justify-center" : "h-9 w-full gap-2 px-2"
					)}
					disabled={isSwitching}
					type="button"
				/>
			}
		>
			<OrganizationAvatar
				account={input.account}
				humanProfileAvatar={input.humanProfileAvatar}
				organization={currentOrganization}
				organizationDisplay={currentOrganizationDisplay}
				placement="rail"
			/>
			{isAvatarOnly ? null : (
				<span className="flex min-w-0 flex-1 items-center">
					<span className="truncate font-medium text-foreground text-sm leading-5">
						{currentOrganizationDisplay.name}
					</span>
				</span>
			)}
			{isFull ? (
				<CaretDownIcon aria-hidden="true" className="size-3.5 shrink-0" />
			) : null}
		</Popover.Trigger>
	);

	return (
		<div
			className={cn(
				"min-w-0",
				isAvatarOnly ? "flex flex-col items-center" : null
			)}
		>
			<Popover.Root modal={false} onOpenChange={handleOpenChange} open={open}>
				{isCollapsed ? (
					<CollapsedRailTooltip label={organizationTooltipLabel}>
						{popoverTrigger}
					</CollapsedRailTooltip>
				) : (
					popoverTrigger
				)}
				<OrganizationSwitcherPopover
					account={input.account}
					currentOrganization={currentOrganization}
					errorMessage={errorMessage}
					humanProfileAvatar={input.humanProfileAvatar}
					isSwitching={isSwitching}
					onCreateOrganization={openCreateOrganization}
					onManageOrganizations={openManageOrganizations}
					onOpenSettings={openSettings}
					onSwitchOrganization={switchOrganization}
					organizations={orderedOrganizations}
				/>
			</Popover.Root>
		</div>
	);
}

function OrganizationSwitcherPopover(input: {
	account: AppOuterRailAccount;
	currentOrganization: OrganizationSummary;
	errorMessage: string | null;
	humanProfileAvatar: HumanProfileAvatarIdentity | null;
	isSwitching: boolean;
	onCreateOrganization: () => void;
	onManageOrganizations: () => void;
	onOpenSettings: () => void;
	onSwitchOrganization: (organization: OrganizationSummary) => void;
	organizations: readonly OrganizationSummary[];
}) {
	return (
		<Popover.Portal>
			<Popover.Positioner
				align="start"
				className="z-50"
				collisionAvoidance={{
					align: "shift",
					fallbackAxisSide: "end",
					side: "flip",
				}}
				collisionPadding={12}
				side="right"
				sideOffset={8}
			>
				<Popover.Popup
					className="relative isolate w-72 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
					finalFocus={false}
					role="menu"
				>
					<div className="px-2 py-2">
						<p className="font-medium text-foreground text-xs">Organization</p>
					</div>
					<output
						aria-atomic="true"
						aria-live="polite"
						className={cn(
							input.errorMessage
								? "mx-2 mb-2 block rounded-sm bg-destructive/10 px-2.5 py-2 text-destructive text-xs leading-snug"
								: "sr-only"
						)}
					>
						{input.errorMessage ?? ""}
					</output>
					<FluidActionList
						aria-label="Organizations"
						className="max-h-72 overflow-y-auto"
						hoverIndicatorClassName="bg-muted"
					>
						{input.organizations.map((organization, index) => {
							const organizationDisplay = resolveOrganizationDisplay({
								account: input.account,
								organization,
							});
							const selected = organization.id === input.currentOrganization.id;
							return (
								<FluidActionListItem
									aria-checked={selected}
									aria-current={selected ? "true" : undefined}
									className={cn(
										"flex min-h-11 w-full min-w-0 items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm disabled:cursor-wait disabled:opacity-70",
										selected
											? "bg-muted text-foreground"
											: "text-muted-foreground"
									)}
									disabled={input.isSwitching}
									index={index}
									key={organization.id}
									onClick={() => input.onSwitchOrganization(organization)}
									role="menuitemradio"
									type="button"
								>
									<OrganizationAvatar
										account={input.account}
										humanProfileAvatar={input.humanProfileAvatar}
										organization={organization}
										organizationDisplay={organizationDisplay}
										placement="menu"
									/>
									<span className="grid min-w-0 flex-1 gap-0.5 leading-tight">
										<span className="truncate font-medium">
											{organizationDisplay.name}
										</span>
										<span className="truncate text-xs">
											{organization.isPersonal
												? "Personal workspace"
												: "Organization"}
										</span>
									</span>
								</FluidActionListItem>
							);
						})}
					</FluidActionList>
					<OrganizationSwitcherActions
						disabled={input.isSwitching}
						onCreateOrganization={input.onCreateOrganization}
						onManageOrganizations={input.onManageOrganizations}
					/>
					<OrganizationSwitcherGlobalActions
						disabled={input.isSwitching}
						onOpenSettings={input.onOpenSettings}
					/>
				</Popover.Popup>
			</Popover.Positioner>
		</Popover.Portal>
	);
}

function OrganizationSwitcherActions(input: {
	disabled: boolean;
	onCreateOrganization: () => void;
	onManageOrganizations: () => void;
}) {
	return (
		<FluidActionList
			aria-label="Organization actions"
			className="mt-1 border-border border-t pt-1"
			hoverIndicatorClassName="bg-muted"
		>
			<FluidActionListItem
				className="flex min-h-12 w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-muted-foreground text-sm disabled:cursor-wait disabled:opacity-70"
				disabled={input.disabled}
				index={0}
				onClick={input.onCreateOrganization}
				role="menuitem"
				type="button"
			>
				<PlusIcon aria-hidden="true" className="size-4 shrink-0" />
				<span className="grid min-w-0 gap-0.5 leading-tight">
					<span className="block font-medium text-foreground">
						Create organization
					</span>
					<span className="block text-xs">
						Set up shared work with your team.
					</span>
				</span>
			</FluidActionListItem>
			<FluidActionListItem
				className="flex min-h-12 w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-muted-foreground text-sm disabled:cursor-wait disabled:opacity-70"
				disabled={input.disabled}
				index={1}
				onClick={input.onManageOrganizations}
				role="menuitem"
				type="button"
			>
				<BuildingsIcon aria-hidden="true" className="size-4 shrink-0" />
				<span className="grid min-w-0 gap-0.5 leading-tight">
					<span className="block font-medium text-foreground">
						Manage organizations
					</span>
					<span className="block text-xs">
						Browse and manage your organizations.
					</span>
				</span>
			</FluidActionListItem>
		</FluidActionList>
	);
}

function OrganizationSwitcherGlobalActions(input: {
	disabled: boolean;
	onOpenSettings: () => void;
}) {
	return (
		<FluidActionList
			aria-label="Global actions"
			className="mt-1 border-border border-t pt-1"
			hoverIndicatorClassName="bg-muted"
		>
			<FluidActionListItem
				className="flex min-h-10 w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-muted-foreground text-sm disabled:cursor-wait disabled:opacity-70"
				disabled={input.disabled}
				index={0}
				onClick={input.onOpenSettings}
				role="menuitem"
				type="button"
			>
				<GearSixIcon aria-hidden="true" className="size-4 shrink-0" />
				<span className="font-medium text-foreground">Settings</span>
			</FluidActionListItem>
		</FluidActionList>
	);
}

function orderOrganizationsForOrganizationSelector(
	organizations: readonly OrganizationSummary[]
): OrganizationSummary[] {
	return [...organizations].sort((left, right) => {
		if (left.isPersonal === true && right.isPersonal !== true) {
			return -1;
		}
		if (right.isPersonal === true && left.isPersonal !== true) {
			return 1;
		}
		return left.name.localeCompare(right.name);
	});
}

function resolveOrganizationDisplay(input: {
	account: AppOuterRailAccount;
	organization: OrganizationSummary;
}): { fallback: string; image?: string | null; name: string } {
	if (input.organization.isPersonal) {
		const name =
			input.account.name?.trim() ||
			input.account.email?.trim() ||
			input.organization.name;
		return {
			fallback: resolveIdentityFallback(name),
			image: input.account.image,
			name,
		};
	}

	return {
		fallback: resolveIdentityFallback(input.organization.name),
		image: input.organization.logo,
		name: input.organization.name,
	};
}

function resolveIdentityFallback(displayName: string): string {
	const trimmed = displayName.trim();
	return (trimmed[0] ?? "A").toUpperCase();
}

function OrganizationAvatar(input: {
	account: AppOuterRailAccount;
	humanProfileAvatar: HumanProfileAvatarIdentity | null;
	organizationDisplay: {
		fallback: string;
		image?: string | null;
		name: string;
	};
	organization: OrganizationSummary;
	placement: "menu" | "rail";
}) {
	if (input.organization.isPersonal && input.humanProfileAvatar) {
		const size = input.placement === "rail" ? 20 : 28;
		return (
			<DitherProfileAvatar
				avatarImageUrl={input.humanProfileAvatar.avatarImageUrl}
				className={cn(
					"shrink-0",
					input.placement === "rail" ? "size-5" : "size-7"
				)}
				data-testid={
					input.placement === "menu"
						? "personal-workspace-human-profile-avatar"
						: "personal-workspace-rail-human-profile-avatar"
				}
				profileId={input.humanProfileAvatar.profileId}
				profileKind="human"
				profileName={input.humanProfileAvatar.profileName}
				size={size}
			/>
		);
	}

	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex shrink-0 items-center justify-center overflow-hidden bg-background text-foreground",
				input.placement === "rail"
					? "size-5 text-[0.6875rem]"
					: "size-7 text-xs",
				input.organization.isPersonal ? "rounded-full" : "rounded-sm"
			)}
			style={
				input.organizationDisplay.image
					? {
							backgroundImage: `url(${input.organizationDisplay.image})`,
							backgroundPosition: "center",
							backgroundSize: "cover",
						}
					: undefined
			}
		>
			{input.organizationDisplay.image
				? null
				: input.organizationDisplay.fallback}
		</span>
	);
}

function AppRailLink(input: {
	active: boolean;
	destination: AppRailDestination;
	index: number;
	tier: SidebarTier;
}) {
	const { dismiss } = useAppNavigationPresentation();
	const isIcon = input.tier === "collapsed";
	const isCompact = input.tier === "compact";
	const attentionCount = Math.max(0, input.destination.attentionCount ?? 0);
	const unreadCount = Math.max(0, input.destination.unreadCount ?? 0);
	let statusIndicator: AppRailStatusIndicator | null = null;
	const unreadIndicatorKind = resolveAppRailUnreadIndicatorKind(
		input.destination.id
	);
	if (unreadCount > 0 && unreadIndicatorKind) {
		statusIndicator = {
			kind: unreadIndicatorKind,
			tone: "warning",
		};
	}
	const accessibleLabel = buildAppRailAccessibleLabel({
		attentionCount,
		destinationId: input.destination.id,
		label: input.destination.label,
		unreadCount,
	});
	const children = (
		<>
			<AppRailDestinationIcon
				attentionCount={attentionCount}
				destination={input.destination}
				statusIndicator={statusIndicator}
				tier={input.tier}
			/>
			<AppRailDestinationLabel
				destination={input.destination}
				statusIndicator={statusIndicator}
				tier={input.tier}
			/>
			<AppRailTrailingAttentionBadge
				attentionCount={attentionCount}
				tier={input.tier}
			/>
		</>
	);
	const className = cn(
		"flex min-w-0 items-center border border-transparent outline-none focus-visible:text-sidebar-accent-foreground",
		APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
		APP_NAV_ITEM_TONE_CLASS_NAME,
		isIcon && "size-9 justify-center px-0",
		isCompact && "h-auto flex-col justify-center gap-1 px-1 py-2",
		input.tier === "full" && APP_NAV_ITEM_FULL_DENSITY_CLASS_NAME,
		input.active && "text-sidebar-accent-foreground"
	);
	const link = (
		<Link
			activeOptions={{ exact: true }}
			aria-current={input.active ? "page" : undefined}
			aria-label={accessibleLabel}
			className={className}
			onClick={(event) => {
				if (
					!(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
				) {
					dismiss();
				}
			}}
			onFocus={input.active ? undefined : input.destination.onIntentPrefetch}
			onPointerEnter={
				input.active ? undefined : input.destination.onIntentPrefetch
			}
			to={input.destination.to}
		>
			{children}
		</Link>
	);

	return (
		<FluidNavMenuItem
			className={isIcon ? "mx-auto size-9" : undefined}
			index={input.index}
			value={input.destination.id}
		>
			{isIcon ? (
				<CollapsedRailTooltip label={accessibleLabel}>
					{link}
				</CollapsedRailTooltip>
			) : (
				link
			)}
		</FluidNavMenuItem>
	);
}

function AppRailDestinationIcon(input: {
	attentionCount: number;
	destination: AppRailDestination;
	statusIndicator: AppRailStatusIndicator | null;
	tier: SidebarTier;
}) {
	return (
		<span className="relative flex size-4 shrink-0 items-center justify-center">
			{input.destination.icon}
			{input.statusIndicator && input.tier !== "full" ? (
				<AppRailStatusDot
					indicator={input.statusIndicator}
					placement="overlay"
				/>
			) : null}
			{input.attentionCount > 0 && input.tier !== "full" ? (
				<AppRailAttentionBadge
					count={input.attentionCount}
					placement="overlay"
				/>
			) : null}
		</span>
	);
}

function AppRailDestinationLabel(input: {
	destination: AppRailDestination;
	statusIndicator: AppRailStatusIndicator | null;
	tier: SidebarTier;
}) {
	if (input.tier === "collapsed") {
		return null;
	}
	const compactLabel =
		input.tier === "compact" ? input.destination.compactLabel : undefined;
	return (
		<span
			className={cn(
				"inline-flex min-w-0 items-center gap-1.5",
				input.tier === "full" && "flex-1"
			)}
		>
			{compactLabel ? (
				<span className="text-center text-[11px]">{compactLabel}</span>
			) : (
				<CenterTruncatedText
					className={cn(input.tier === "compact" && "text-center text-[11px]")}
					text={input.destination.label}
				/>
			)}
			{input.statusIndicator && input.tier === "full" ? (
				<AppRailStatusDot
					indicator={input.statusIndicator}
					placement="trailing"
				/>
			) : null}
		</span>
	);
}

function AppRailTrailingAttentionBadge(input: {
	attentionCount: number;
	tier: SidebarTier;
}) {
	return input.attentionCount > 0 && input.tier === "full" ? (
		<AppRailAttentionBadge count={input.attentionCount} placement="trailing" />
	) : null;
}

function AppRailAttentionBadge(input: {
	count: number;
	placement: "overlay" | "trailing";
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"inline-flex items-center justify-center rounded-full border font-semibold tabular-nums leading-none",
				input.placement === "overlay"
					? "absolute -end-2 -top-2 h-4 min-w-4 px-1 text-[9px] shadow-sm"
					: "ms-auto h-5 min-w-5 px-1.5 text-[10px]",
				resolveStatusToneCompactBadgeClassName("warning")
			)}
		>
			{input.count > 99 ? "99+" : input.count}
		</span>
	);
}

type AppRailStatusIndicatorKind = "center-agent-unread" | "spaces-unread";

type AppRailStatusIndicator = {
	kind: AppRailStatusIndicatorKind;
	tone: "danger" | "warning";
};

function AppRailStatusDot(input: {
	indicator: AppRailStatusIndicator;
	placement: "overlay" | "trailing";
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"size-2 shrink-0 rounded-full ring-2 ring-sidebar",
				resolveStatusToneIndicatorClassName(input.indicator.tone, "quiet"),
				input.placement === "overlay" && "absolute -end-1.5 -top-1.5"
			)}
			data-app-rail-status-indicator={input.indicator.kind}
			data-app-rail-status-placement={input.placement}
		/>
	);
}

function buildAppRailAccessibleLabel(input: {
	attentionCount: number;
	destinationId: AppOuterRailDestination;
	label: string;
	unreadCount: number;
}): string {
	if (input.unreadCount > 0) {
		const unreadCopy = resolveAppRailUnreadCopy({
			count: input.unreadCount,
			destinationId: input.destinationId,
		});
		return `${input.label}, ${input.unreadCount} unread ${unreadCopy}`;
	}
	if (input.attentionCount === 0) {
		return input.label;
	}
	const itemCopy = input.attentionCount === 1 ? "item needs" : "items need";
	return `${input.label}, ${input.attentionCount} ${itemCopy} your attention`;
}

function resolveAppRailUnreadIndicatorKind(
	destinationId: AppOuterRailDestination
): AppRailStatusIndicatorKind | null {
	if (destinationId === "home") {
		return "center-agent-unread";
	}
	if (destinationId === "spaces") {
		return "spaces-unread";
	}
	return null;
}

function resolveAppRailUnreadCopy(input: {
	count: number;
	destinationId: AppOuterRailDestination;
}): string {
	if (input.destinationId === "home") {
		return input.count === 1 ? "reply" : "replies";
	}
	return input.count === 1 ? "message" : "messages";
}
