import type { SettingsSectionDef } from "@openmeld/ui/lib/settings-contract";
import type { ReactNode } from "react";
import { APP_CONTEXTUAL_MAIN_TEXT_BASE_START_CLASS_NAME } from "#/components/app/app-contextual-layout-style";
import { CenterAgentPrivacyPage } from "#/components/organizations/center-agent-privacy-page";
import { OrganizationSettingsPage } from "#/components/organizations/organization-settings-page";
import { buildSettingsRoutes } from "#/lib/settings-routes";
import { AccountSection } from "./account-section";
import { AppearanceSection } from "./appearance-section";
import { NotificationsSection } from "./notifications-section";
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
 * Center Agent-owned configuration lives in the Center Agent product home,
 * outside this global Settings registry.
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
	] as const;
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
