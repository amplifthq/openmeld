import {
	SettingsAccountCliAccessSection,
	SettingsAccountProfileSection,
	SettingsAccountRoot,
	SettingsAccountSecuritySection,
	SettingsAccountSessionsSection,
} from "@openmeld/ui/components/settings-account";
import { OneTimeTokenCard } from "#/components/account/one-time-token-card";
import { PasswordChangeCard } from "#/components/account/password-change-card";
import { ProvidersManagementCard } from "#/components/account/providers-management-card";
import { SessionsManagementCard } from "#/components/account/sessions-management-card";
import { UserAvatarCard } from "#/components/account/user-avatar-card";
import { UserNameCard } from "#/components/account/user-name-card";
import { AppPageHeader } from "#/components/app/app-page-header";
import { DesktopAccountActions } from "#/desktop/desktop-account-actions";
import { getDesktopPlatform } from "#/desktop/platform";

/**
 * The Account leaf of the unified Settings destination — "who I am to the cloud":
 * identity, sign-in/providers, sessions, CLI tokens. See
 * developing/clients/shell-and-settings.md §3 (the four nouns) + §4 (hybrid IA).
 *
 * This is a purely presentational re-homing of the former account page:
 * the six account cards move under Settings UNCHANGED — each card keeps its own
 * React Query mutation, dirty/saving state, and per-card autonomous save (§7).
 * The cards are grouped into `SettingsSection`s so the flat Account leaf carries
 * scroll anchors (the `id` each section exposes) for future scroll-spy; no
 * data-layer change, no liveness/availability/Wake/readiness semantics.
 */
export function AccountSection() {
	const desktop = getDesktopPlatform();
	return (
		<>
			<AppPageHeader
				description="Manage your profile, sign-in security, CLI access, and active sessions."
				eyebrow="Personal"
				title="Account"
			/>
			<SettingsAccountRoot>
				<SettingsAccountProfileSection className="pt-0">
					<UserAvatarCard />
					<UserNameCard />
				</SettingsAccountProfileSection>

				{desktop ? (
					<DesktopAccountActions />
				) : (
					<>
						<SettingsAccountCliAccessSection>
							<OneTimeTokenCard />
						</SettingsAccountCliAccessSection>

						<SettingsAccountSecuritySection>
							<ProvidersManagementCard />
							<PasswordChangeCard />
						</SettingsAccountSecuritySection>

						<SettingsAccountSessionsSection>
							<SessionsManagementCard />
						</SettingsAccountSessionsSection>
					</>
				)}
			</SettingsAccountRoot>
		</>
	);
}
