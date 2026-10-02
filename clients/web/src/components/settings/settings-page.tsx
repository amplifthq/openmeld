import { SettingsDialogContent } from "@openmeld/ui/components/settings-dialog-content";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	resolveHostCapabilities,
	resolveSettingsSections,
	type SettingsNavItem,
	type SettingsSectionDef,
	toSettingsNavItems,
} from "@openmeld/ui/lib/settings-contract";
import { useQuery } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { type ReactNode, Suspense, useEffect, useState } from "react";
import {
	AppContextualContentFrame,
	type AppContextualNavGroup,
	type AppContextualNavItem,
	AppContextualSidebarNav,
} from "#/components/app/app-contextual-layout";
import { AppGlobalControls } from "#/components/app/app-global-controls";
import { AppInnerSidebar } from "#/components/app/app-inner-sidebar";
import { AppOuterRail } from "#/components/app/app-outer-rail";
import { useAppShellAccount } from "#/components/app/app-shell-account";
import { AppSurfaceLayout } from "#/components/app/app-surface-layout";
import { SendFeedbackDialog } from "#/components/feedback/send-feedback-dialog";
import {
	DESKTOP_UPDATE_ATTENTION_LABEL,
	DesktopUpdateIndicator,
	useDesktopUpdateAttention,
} from "#/desktop/updater";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationAccountSettingsPath } from "#/lib/organizations/organization-routes";
import type {
	OrganizationRole,
	OrganizationSummary,
} from "#/lib/organizations/organization-types";
import {
	APP_SIDEBAR_DEFAULT_STATES,
	type AppSidebarPersistedStates,
} from "#/lib/sidebar-width-cookie";
import { organizationMemberRoleQueryOptions } from "#/query/organizations/organization-directory";
import { SettingsContentErrorBoundary } from "./settings-content-error-boundary";
import { buildSettingsSections } from "./settings-sections";

type SettingsOrganizationRole = "admin" | "member" | "owner";
type SettingsContextualNavItem = AppContextualNavItem;

const SEND_FEEDBACK_SETTINGS_ITEM_ID = "send-feedback";

const PERSONAL_SETTINGS_SECTION_IDS = [
	"account",
	"appearance",
	"notifications",
	"service",
	"privacy",
	"updates",
] as const;
const ORGANIZATION_SETTINGS_SECTION_IDS = [
	"general",
	"center-agent",
	"usage",
	"members",
	"invitations",
	"security",
] as const;
// A Personal Workspace has no Organization roster and no shared coordinator, so
// its own Center Agent belongs to the Personal group and the workspace group
// keeps General and Usage.
const PERSONAL_WORKSPACE_PERSONAL_SECTION_IDS = [
	...PERSONAL_SETTINGS_SECTION_IDS,
	"center-agent",
] as const;
const PERSONAL_WORKSPACE_ORGANIZATION_SECTION_IDS = [
	"general",
	"usage",
] as const;

/**
 * The Web usage of the shared Settings contract — see
 * developing/clients/shell-and-settings.md §7. It resolves the host's
 * capabilities (a plain Web host has only `CLOUD_ACCOUNT`), filters the section
 * registry by those capabilities, and renders the active section inside the
 * unified app shell.
 *
 * Both the standalone route and global dialog use this registry and navigation.
 * The host supplies the active section and, for the dialog, section navigation.
 */

// Plain Web is a cloud-account host: no local OpenMeld Service, so the Service
// section's `LOCAL_SERVICE` requirement gates it out here. A CLI-driven or
// Desktop host would resolve a higher tier and surface it.
const WEB_HOST_CAPABILITIES = resolveHostCapabilities("cloud");

export function SettingsPage(input: {
	activeSectionId: string;
	initialSidebarStates?: AppSidebarPersistedStates;
	presentation?: "page" | "dialog";
	onNavigate?: (section: string) => void;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const orgSlug = currentOrganization.slug;
	const sections = resolveSettingsSections(
		buildSettingsSections(orgSlug),
		WEB_HOST_CAPABILITIES
	);
	const navItems = toSettingsNavItems(sections);

	const requestedSection = sections.find(
		(section) => section.id === input.activeSectionId
	);
	const activeSection =
		requestedSection ??
		(input.presentation === "dialog"
			? sections.find((section) => section.id === "account")
			: undefined);
	useEffect(() => {
		if (!requestedSection && input.presentation === "dialog") {
			input.onNavigate?.("account");
		}
	}, [requestedSection, input.presentation, input.onNavigate]);

	// Gated-route guard: if the active leaf's section was filtered out by host
	// capability (e.g. /o/:orgSlug/settings/service on a plain Web host, which lacks
	// LOCAL_SERVICE), do NOT silently render some other section's content under
	// the requested URL. Redirect to the always-present Account leaf instead.
	// This also protects any future gated leaf added to the registry.
	if (!activeSection) {
		throw redirect({
			replace: true,
			to: buildOrganizationAccountSettingsPath(orgSlug),
		});
	}

	return (
		<SettingsPageShell
			activeSection={activeSection}
			activeSectionId={activeSection.id}
			currentUserId={currentUserId}
			initialSidebarStates={input.initialSidebarStates}
			navItems={navItems}
			onNavigate={input.onNavigate}
			organization={currentOrganization}
			presentation={input.presentation}
		/>
	);
}

function SettingsPageShell(input: {
	presentation?: "page" | "dialog";
	onNavigate?: (section: string) => void;
	activeSection: SettingsSectionDef;
	activeSectionId: string;
	currentUserId: string;
	initialSidebarStates?: AppSidebarPersistedStates;
	navItems: readonly SettingsNavItem[];
	organization: OrganizationSummary;
}) {
	const [feedbackOpen, setFeedbackOpen] = useState(false);
	const account = useAppShellAccount();
	const roleQuery = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: input.organization.isPersonal !== true,
			organizationId: input.organization.id,
			userId: input.currentUserId,
		})
	);
	const organizationRole = resolveSettingsOrganizationRole({
		isPersonal: input.organization.isPersonal === true,
		role: roleQuery.data,
	});
	const navigation = (
		<SettingsInnerSidebar
			activeSectionId={input.activeSectionId}
			isPersonalWorkspace={input.organization.isPersonal === true}
			items={input.navItems}
			onNavigate={input.onNavigate}
			onSendFeedback={() => setFeedbackOpen(true)}
			organizationName={input.organization.name}
			organizationRole={organizationRole}
			presentation={input.presentation}
		/>
	);
	const content = (
		<SettingsContentErrorBoundary key={input.activeSectionId}>
			<Suspense fallback={<SettingsContentSkeleton />}>
				{input.activeSection.render({ capabilities: WEB_HOST_CAPABILITIES })}
			</Suspense>
		</SettingsContentErrorBoundary>
	);
	if (input.presentation === "dialog") {
		return (
			<>
				<SettingsDialogContent
					contentKey={input.activeSectionId}
					description="Manage your account and organization preferences."
					navigation={navigation}
					spacious
					title="App settings"
				>
					{content}
				</SettingsDialogContent>
				<SendFeedbackDialog
					onOpenChange={setFeedbackOpen}
					open={feedbackOpen}
				/>
			</>
		);
	}

	return (
		<>
			<AppSurfaceLayout
				globalControls={<AppGlobalControls />}
				mobileSidebarTitle="Settings"
				outerRail={<AppOuterRail account={account} />}
				sidebar={
					<AppInnerSidebar
						initialState={
							input.initialSidebarStates?.inner ??
							APP_SIDEBAR_DEFAULT_STATES.inner
						}
						preferenceKey="settings"
						separatorLabel="Resize the settings sidebar"
					>
						{navigation}
					</AppInnerSidebar>
				}
			>
				<SettingsContentFrame>{content}</SettingsContentFrame>
			</AppSurfaceLayout>
			<SendFeedbackDialog onOpenChange={setFeedbackOpen} open={feedbackOpen} />
		</>
	);
}

function SettingsContentSkeleton() {
	return (
		<output aria-label="Loading settings" className="block w-full space-y-8">
			<div aria-hidden="true" className="space-y-3">
				<Skeleton className="h-3 w-16 animate-none" />
				<Skeleton className="h-7 w-40 animate-none" />
				<Skeleton className="h-4 w-3/4 max-w-md animate-none" />
			</div>
			<div aria-hidden="true" className="space-y-6">
				{[0, 1, 2].map((row) => (
					<div className="space-y-3 border-border border-t pt-6" key={row}>
						<Skeleton className="h-4 w-28 animate-none" />
						<Skeleton className="h-9 w-full max-w-sm animate-none" />
					</div>
				))}
			</div>
		</output>
	);
}

export function SettingsContentFrame(input: { children: ReactNode }) {
	return (
		<AppContextualContentFrame
			bodySlotName="settings-content-scroll"
			contentClassName="pt-3"
			headerSlotName="settings-content-header"
		>
			{input.children}
		</AppContextualContentFrame>
	);
}

export function SettingsInnerSidebar(input: {
	presentation?: "page" | "dialog";
	onNavigate?: (section: string) => void;
	activeSectionId: string;
	isPersonalWorkspace: boolean;
	items: readonly SettingsNavItem[];
	onSendFeedback: () => void;
	organizationName: string;
	organizationRole: SettingsOrganizationRole | null;
}) {
	const desktopUpdateAttention = useDesktopUpdateAttention();
	const groups = toContextualSettingsNavGroups({
		desktopUpdateAttention,
		isPersonalWorkspace: input.isPersonalWorkspace,
		items: input.items,
		organizationName: input.organizationName,
		organizationRole: input.organizationRole,
	});

	return (
		<AppContextualSidebarNav
			activeItemId={input.activeSectionId}
			ariaLabel="Settings"
			groups={
				input.onNavigate
					? groups.map((group) =>
							group.items
								? {
										...group,
										items: group.items.map(({ to: _to, ...item }) => item),
									}
								: group
						)
					: groups
			}
			onActivate={(itemId) => {
				if (itemId === SEND_FEEDBACK_SETTINGS_ITEM_ID) {
					input.onSendFeedback();
				} else {
					input.onNavigate?.(itemId);
				}
			}}
			placement={input.presentation === "dialog" ? "main" : "secondary"}
			title="Settings"
		/>
	);
}

function toContextualSettingsNavGroups(input: {
	desktopUpdateAttention: boolean;
	isPersonalWorkspace: boolean;
	items: readonly SettingsNavItem[];
	organizationName: string;
	organizationRole: SettingsOrganizationRole | null;
}): AppContextualNavGroup<string>[] {
	const items: SettingsContextualNavItem[] = input.items.map((item) => {
		if (!item.to) {
			throw new Error(`Settings sidebar item is missing a route: ${item.id}`);
		}
		const updateAttention =
			item.id === "updates" && input.desktopUpdateAttention;
		return {
			accessory: updateAttention ? <DesktopUpdateIndicator /> : undefined,
			ariaLabel: updateAttention
				? `${item.title}, ${DESKTOP_UPDATE_ATTENTION_LABEL}`
				: undefined,
			id: item.id,
			label: item.title,
			to: item.to,
		};
	});
	const organizationLabel = input.organizationName;
	return [
		{
			ariaLabel: "Personal settings",
			id: "personal",
			items: [
				...orderSettingsNavItems(
					items,
					input.isPersonalWorkspace
						? PERSONAL_WORKSPACE_PERSONAL_SECTION_IDS
						: PERSONAL_SETTINGS_SECTION_IDS
				),
				{
					id: SEND_FEEDBACK_SETTINGS_ITEM_ID,
					label: "Send feedback",
				},
			],
			label: "Personal",
		},
		{
			ariaLabel: `${organizationLabel} settings`,
			id: "organization",
			items: orderSettingsNavItems(
				items,
				input.isPersonalWorkspace
					? PERSONAL_WORKSPACE_ORGANIZATION_SECTION_IDS
					: ORGANIZATION_SETTINGS_SECTION_IDS
			).filter(
				(item) =>
					item.id !== "security" ||
					input.organizationRole === "owner" ||
					input.organizationRole === "admin"
			),
			label: organizationLabel,
		},
	];
}

function orderSettingsNavItems(
	items: readonly SettingsContextualNavItem[],
	orderedIds: readonly string[]
): SettingsContextualNavItem[] {
	const itemsById = new Map(items.map((item) => [item.id, item]));
	return orderedIds.flatMap((id) => {
		const item = itemsById.get(id);
		return item ? [item] : [];
	});
}

function resolveSettingsOrganizationRole(input: {
	isPersonal: boolean;
	role: OrganizationRole | undefined;
}): SettingsOrganizationRole | null {
	if (input.isPersonal) {
		return "owner";
	}
	if (
		input.role === "member" ||
		input.role === "admin" ||
		input.role === "owner"
	) {
		return input.role;
	}
	return null;
}
