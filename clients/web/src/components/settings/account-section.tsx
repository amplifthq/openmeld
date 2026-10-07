import {
	SettingsAccountCliAccessSection,
	SettingsAccountProfileSection,
	SettingsAccountRoot,
	SettingsAccountSecuritySection,
	SettingsAccountSessionsSection,
} from "@openmeld/ui/components/settings-account";
import { DeleteAccountSection } from "#/components/account/delete-account-section";
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
 * Each card owns its mutation and save state. Account deletion uses a separate
 * confirmation dialog and the server-owned account lifecycle.
 */
export function AccountSection() {
	const desktop = getDesktopPlatform();
	return (
		<>
			<AppPageHeader
				description={
					desktop
						? "Manage your profile here, or open the web app for more account settings."
						: "Manage your profile, sign-in security, CLI access, and active sessions."
				}
				eyebrow="Personal"
				title="Account"
			/>
			<SettingsAccountRoot>
				<SettingsAccountProfileSection className="pt-0">
					<UserAvatarCard desktop={Boolean(desktop)} />
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
						<DeleteAccountSection />
					</>
				)}
			</SettingsAccountRoot>
		</>
	);
}
