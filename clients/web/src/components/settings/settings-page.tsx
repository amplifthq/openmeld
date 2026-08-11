import { Badge } from "@openmeld/ui/components/badge";
import {
	resolveHostCapabilities,
	resolveSettingsSections,
	type SettingsNavItem,
	type SettingsSectionDef,
	toSettingsNavItems,
} from "@openmeld/ui/lib/settings-contract";
import { cn } from "@openmeld/ui/lib/utils";
import {
	BellIcon,
	BuildingsIcon,
	type Icon,
	MegaphoneIcon,
	PaletteIcon,
	ShieldCheckIcon,
	UserIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
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
import { useSettingsAttentionTone } from "#/components/app/use-settings-attention-tone";
import { SendFeedbackDialog } from "#/components/feedback/send-feedback-dialog";
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
] as const;
const ORGANIZATION_SETTINGS_SECTION_IDS = ["general"] as const;
const SETTINGS_IDENTITY_BADGE_CLASS_NAME =
	"h-4 shrink-0 border-border/70 bg-muted/30 px-1.5 text-[10px] text-muted-foreground";

/**
 * The Web usage of the shared Settings contract — see
 * developing/clients/shell-and-settings.md §7. It resolves the host's
 * capabilities (a plain Web host has only `CLOUD_ACCOUNT`), filters the section
 * registry by those capabilities, and renders the active section inside the
 * unified app shell.
 *
 * The contextual nav renders each `to` as a real route link (deep-linkable,
 * back/forward, open-in-new-tab). The active item is driven by
 * `activeSectionId`, which the active leaf route supplies.
 */

// Plain Web is a cloud-account host: no local OpenMeld Service, so the Service
// section's `LOCAL_SERVICE` requirement gates it out here. A CLI-driven or
// Desktop host would resolve a higher tier and surface it.
const WEB_HOST_CAPABILITIES = resolveHostCapabilities("cloud");

export function SettingsPage(input: {
	activeSectionId: string;
	initialSidebarStates?: AppSidebarPersistedStates;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const orgSlug = currentOrganization.slug;
	const sections = resolveSettingsSections(
		buildSettingsSections(orgSlug),
		WEB_HOST_CAPABILITIES
	);
	const navItems = toSettingsNavItems(sections);

	const activeSection = sections.find(
		(section) => section.id === input.activeSectionId
	);

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
			activeSectionId={input.activeSectionId}
			currentUserId={currentUserId}
			initialSidebarStates={input.initialSidebarStates}
			navItems={navItems}
			organization={currentOrganization}
		/>
	);
}

function SettingsPageShell(input: {
	activeSection: SettingsSectionDef;
	activeSectionId: string;
	currentUserId: string;
	initialSidebarStates?: AppSidebarPersistedStates;
	navItems: readonly SettingsNavItem[];
	organization: OrganizationSummary;
}) {
	const [feedbackOpen, setFeedbackOpen] = useState(false);
	const account = useAppShellAccount();
	const computerAttentionTone = useSettingsAttentionTone();
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

	return (
		<>
			<AppSurfaceLayout
				globalControls={<AppGlobalControls />}
				outerRail={
					<AppOuterRail
						account={account}
						computerAttentionTone={computerAttentionTone}
						initialState={
							input.initialSidebarStates?.outer ??
							APP_SIDEBAR_DEFAULT_STATES.outer
						}
					/>
				}
				sidebar={
					<AppInnerSidebar
						initialState={
							input.initialSidebarStates?.inner ??
							APP_SIDEBAR_DEFAULT_STATES.inner
						}
						preferenceKey="settings"
						separatorLabel="Resize the settings sidebar"
					>
						<SettingsInnerSidebar
							activeSectionId={input.activeSectionId}
							isPersonalWorkspace={input.organization.isPersonal === true}
							items={input.navItems}
							onSendFeedback={() => setFeedbackOpen(true)}
							organizationName={input.organization.name}
							organizationRole={organizationRole}
						/>
					</AppInnerSidebar>
				}
			>
				<SettingsContentFrame>
					{input.activeSection.render({
						capabilities: WEB_HOST_CAPABILITIES,
					})}
				</SettingsContentFrame>
			</AppSurfaceLayout>
			<SendFeedbackDialog onOpenChange={setFeedbackOpen} open={feedbackOpen} />
		</>
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
	activeSectionId: string;
	isPersonalWorkspace: boolean;
	items: readonly SettingsNavItem[];
	onSendFeedback: () => void;
	organizationName: string;
	organizationRole: SettingsOrganizationRole | null;
}) {
	const groups = toContextualSettingsNavGroups({
		isPersonalWorkspace: input.isPersonalWorkspace,
		items: input.items,
		organizationName: input.organizationName,
		organizationRole: input.organizationRole,
	});

	return (
		<AppContextualSidebarNav
			activeItemId={input.activeSectionId}
			ariaLabel="Settings"
			groups={groups}
			onActivate={(itemId) => {
				if (itemId === SEND_FEEDBACK_SETTINGS_ITEM_ID) {
					input.onSendFeedback();
				}
			}}
			title="Settings"
		/>
	);
}

function resolveSettingsNavIcon(sectionId: string): Icon {
	switch (sectionId) {
		case "account":
			return UserIcon;
		case "appearance":
			return PaletteIcon;
		case "notifications":
			return BellIcon;
		case "privacy":
			return ShieldCheckIcon;
		case "general":
			return BuildingsIcon;
		default:
			throw new Error(`Unsupported Settings sidebar item: ${sectionId}`);
	}
}

function toContextualSettingsNavGroups(input: {
	isPersonalWorkspace: boolean;
	items: readonly SettingsNavItem[];
	organizationName: string;
	organizationRole: SettingsOrganizationRole | null;
}): AppContextualNavGroup<string>[] {
	const items: SettingsContextualNavItem[] = input.items.map((item) => {
		if (!item.to) {
			throw new Error(`Settings sidebar item is missing a route: ${item.id}`);
		}
		return {
			icon: resolveSettingsNavIcon(item.id),
			id: item.id,
			label: item.title,
			to: item.to,
		};
	});
	const organizationLabel = input.organizationName;
	const identityBadges =
		input.organizationRole || !input.isPersonalWorkspace ? (
			<span className="flex shrink-0 items-center gap-1">
				{input.isPersonalWorkspace ? null : (
					<Badge
						aria-label="Organization"
						className={SETTINGS_IDENTITY_BADGE_CLASS_NAME}
						variant="outline"
					>
						Org
					</Badge>
				)}
				{input.organizationRole ? (
					<Badge
						aria-label={`Organization role: ${input.organizationRole}`}
						className={cn(SETTINGS_IDENTITY_BADGE_CLASS_NAME, "lowercase")}
						variant="outline"
					>
						{input.organizationRole}
					</Badge>
				) : null}
			</span>
		) : null;
	return [
		{
			ariaLabel: "Personal settings",
			id: "personal",
			items: [
				...orderSettingsNavItems(items, PERSONAL_SETTINGS_SECTION_IDS),
				{
					icon: MegaphoneIcon,
					id: SEND_FEEDBACK_SETTINGS_ITEM_ID,
					label: "Send feedback",
				},
			],
			label: "Personal",
		},
		{
			ariaLabel: `${organizationLabel} settings`,
			id: "organization",
			items: orderSettingsNavItems(items, ORGANIZATION_SETTINGS_SECTION_IDS),
			label: organizationLabel,
			labelAccessory: identityBadges,
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
