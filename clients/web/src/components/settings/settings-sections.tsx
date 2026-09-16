import { TEAMMATE_AGENT_REQUESTS_ENABLED } from "@openmeld/schemas";
import type { SettingsSectionDef } from "@openmeld/ui/lib/settings-contract";
import type { ReactNode } from "react";
import { APP_CONTEXTUAL_MAIN_TEXT_BASE_START_CLASS_NAME } from "#/components/app/app-contextual-layout-style";
import { CenterAgentPrivacyPage } from "#/components/organizations/center-agent-privacy-page";
import { CenterAgentSettingsPage } from "#/components/organizations/center-agent-settings-page";
import { OrganizationSettingsPage } from "#/components/organizations/organization-settings-page";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildSettingsRoutes } from "#/lib/settings-routes";
import { AccountSection } from "./account-section";
import { AgentProfileCreationApprovalSettings } from "./agent-profile-creation-approval-settings";
import { AppearanceSection } from "./appearance-section";
import { NotificationsSection } from "./notifications-section";
import { ReasoningStreamSetting } from "./reasoning-stream-setting";
import { SettingsPlaceholderSection } from "./settings-placeholder-section";

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
