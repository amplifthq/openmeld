import { OpenMeldLetterLogoStrong } from "@openmeld/ui/components/openmeld-letter-logo-strong";
import { SidebarUserFooter } from "@openmeld/ui/fluid/sidebar-user-footer";
import { OrganizationSwitcher } from "../../src/components/app/app-workspace-switcher";
import { DitherProfileAvatar } from "../../src/components/profiles/dither-profile-avatar";
import { demoHumanAvatars } from "./demo-avatars";

export function DemoOrganizationSwitcher() {
	return (
		<div className="flex justify-center px-2 pt-4 pb-4">
			<OrganizationSwitcher
				account={{ name: "Maya Chen" }}
				avatar={
					<OpenMeldLetterLogoStrong pointerTracking="viewport" size={5} />
				}
				humanProfileAvatar={null}
				tier="icon"
			/>
		</div>
	);
}

export function DemoUserFooter() {
	return (
		<div className="mt-auto px-2 py-3">
			<SidebarUserFooter
				avatar={
					<DitherProfileAvatar
						avatarImageUrl={demoHumanAvatars["Maya Chen"]}
						className="rounded-full"
						profileId="maya"
						profileKind="human"
						profileName="Maya Chen"
						size={28}
					/>
				}
				className="items-center"
				iconOnly
				menu={
					<div className="px-3 py-2">
						<p className="font-medium text-sm">Maya Chen</p>
						<p className="text-muted-foreground text-xs">OpenMeld</p>
					</div>
				}
				name="Maya Chen"
				triggerClassName="rounded-full"
			/>
		</div>
	);
}
