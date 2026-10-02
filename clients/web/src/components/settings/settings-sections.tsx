import { TEAMMATE_AGENT_REQUESTS_ENABLED } from "@openmeld/schemas";
import type { SettingsSectionDef } from "@openmeld/ui/lib/settings-contract";
import { lazy, type ReactNode } from "react";
import { APP_CONTEXTUAL_MAIN_TEXT_BASE_START_CLASS_NAME } from "#/components/app/app-contextual-layout-style";
import { getDesktopPlatform } from "#/desktop/platform";
import { DesktopUpdatesSection } from "#/desktop/updater";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildSettingsRoutes } from "#/lib/settings-routes";
import { SettingsPlaceholderSection } from "./settings-placeholder-section";

const OrganizationUsagePage = lazy(() =>
	import("#/components/organizations/organization-usage-page").then(
		(module) => ({ default: module.OrganizationUsagePage })
	)
);
const AccountSection = lazy(() =>
	import("./account-section").then((module) => ({
		default: module.AccountSection,
	}))
);
const AppearanceSection = lazy(() =>
	import("./appearance-section").then((module) => ({
		default: module.AppearanceSection,
	}))
);
const NotificationsSection = lazy(() =>
	import("./notifications-section").then((module) => ({
		default: module.NotificationsSection,
	}))
);
const ReasoningStreamSetting = lazy(() =>
	import("./reasoning-stream-setting").then((module) => ({
		default: module.ReasoningStreamSetting,
	}))
);
const AgentProfileCreationApprovalSettings = lazy(() =>
	import("./agent-profile-creation-approval-settings").then((module) => ({
		default: module.AgentProfileCreationApprovalSettings,
	}))
);
const CenterAgentPrivacyPage = lazy(() =>
	import("#/components/organizations/center-agent-privacy-page").then(
		(module) => ({ default: module.CenterAgentPrivacyPage })
	)
);
const CenterAgentSettingsPage = lazy(() =>
	import("#/components/organizations/center-agent-settings-page").then(
		(module) => ({ default: module.CenterAgentSettingsPage })
	)
);
const OrganizationSettingsPage = lazy(() =>
	import("#/components/organizations/organization-settings-page").then(
		(module) => ({ default: module.OrganizationSettingsPage })
	)
);

/**
 * The Web Settings section registry. Account-scoped pages live under Personal;
 * organization-scoped pages live under the current Organization's name. Every
 * entry is a real route, and the shared runner (`resolveSettingsSections`)
 * filters the registry by host capability.
 *
 * - Account requires only `CLOUD_ACCOUNT` (the always-present
 *   shared tier for a signed-in account).
 * - Service requires `LOCAL_SERVICE`, which a plain Web host does not have, so it
 *   is gated out on Web today; a CLI-driven or Desktop host would surface it.
 *
 * Service still renders a placeholder panel until a later phase fills it.
 * Center Agent configuration is a real Settings leaf here: it is grouped under
 * the current Organization, or under Personal in a Personal Workspace. The
 * Center Agent product home no longer owns a second entry for it.
 */
export function buildSettingsSections(
	orgSlug: string
): readonly SettingsSectionDef[] {
	const settingsRoutes = buildSettingsRoutes(orgSlug);
	return [
		{
			id: "account",
			title: "Account",
			to: settingsRoutes.account,
			requires: ["CLOUD_ACCOUNT"],
			render: () => (
				<SettingsLeafLayout>
					<AccountSection />
				</SettingsLeafLayout>
			),
		},
		{
			id: "appearance",
			title: "Appearance",
			to: settingsRoutes.appearance,
			requires: ["CLOUD_ACCOUNT"],
			render: () => (
				<SettingsLeafLayout>
					<AppearanceSection />
				</SettingsLeafLayout>
			),
		},
		{
			id: "notifications",
			title: "Notifications",
			to: settingsRoutes.notifications,
			requires: ["CLOUD_ACCOUNT"],
			render: () => (
				<SettingsLeafLayout>
					<NotificationsSection />
				</SettingsLeafLayout>
			),
		},
		{
			id: "service",
			title: "Service",
			to: settingsRoutes.service,
			requires: ["LOCAL_SERVICE"],
			render: () => (
				<SettingsPlaceholderSection
					description="Local app behavior for the OpenMeld Service on this machine."
					id="service"
					title="Service"
				/>
			),
		},
		{
			id: "privacy",
			title: "Privacy & Safety",
			to: settingsRoutes.privacy,
			requires: ["CLOUD_ACCOUNT"],
			render: () => (
				<SettingsLeafLayout>
					<CenterAgentPrivacyPage />
					<ReasoningStreamSetting />
					<PersonalAgentPermissions />
				</SettingsLeafLayout>
			),
		},
		...(getDesktopPlatform()
			? [
					{
						id: "updates",
						title: "Updates",
						to: settingsRoutes.updates,
						render: () => (
							<SettingsLeafLayout>
								<DesktopUpdatesSection presentation="settings" />
							</SettingsLeafLayout>
						),
					},
				]
			: []),
		{
			id: "center-agent",
			title: "Center Agent",
			to: settingsRoutes["center-agent"],
			requires: ["CLOUD_ACCOUNT"],
			render: () => (
				<SettingsLeafLayout>
					<CenterAgentSettingsPage />
				</SettingsLeafLayout>
			),
		},
		{
			id: "usage",
			title: "Usage",
			to: settingsRoutes.usage,
			requires: ["CLOUD_ACCOUNT"],
			render: () => (
				<SettingsLeafLayout>
					<OrganizationUsagePage />
				</SettingsLeafLayout>
			),
		},
		{
			id: "general",
			title: "General",
			to: settingsRoutes.general,
			requires: ["CLOUD_ACCOUNT"],
			render: () => (
				<SettingsLeafLayout>
					<OrganizationSettingsPage />
				</SettingsLeafLayout>
			),
		},
		...(["members", "invitations", "security"] as const).map((section) => ({
			id: section,
			title: {
				members: "Members",
				invitations: "Invitations",
				security: "Security",
			}[section],
			to: settingsRoutes[section],
			requires: ["CLOUD_ACCOUNT"] as const,
			render: () => (
				<SettingsLeafLayout>
					<OrganizationSettingsPage section={section} />
				</SettingsLeafLayout>
			),
		})),
	] as const;
}

// Launch hold, not legacy. Keep the settings implementation and saved policies
// for Request an Agent; see agent-profiles.md#teammate-request-launch-hold.
function PersonalAgentPermissions() {
	const { currentOrganization } = useAppOrganization();
	return !TEAMMATE_AGENT_REQUESTS_ENABLED ||
		currentOrganization.isPersonal ? null : (
		<AgentProfileCreationApprovalSettings
			organizationId={currentOrganization.id}
			organizationName={currentOrganization.name}
		/>
	);
}

function SettingsLeafLayout(input: { children: ReactNode }) {
	return (
		<div
			className={`flex flex-col gap-4 ${APP_CONTEXTUAL_MAIN_TEXT_BASE_START_CLASS_NAME}`}
		>
			{input.children}
		</div>
	);
}
