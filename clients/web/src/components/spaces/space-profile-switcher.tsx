import type { AuthProfileView } from "@openmeld/schemas/types";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { UserIcon } from "@phosphor-icons/react";

// Non-intrusive in-Space identity control. It only renders when the account has
// more than one human profile and lives beside the composer send action so the
// selected identity is tied to the next message. Switching navigates to the same
// Space with a different ?profileId — the web only ever speaks as a human
// profile (agents are CLI-only), so this lists human profiles exclusively.
export function SpaceProfileSwitcher(input: {
	currentProfileId: string;
	currentProfileName: string | null;
	humanProfiles: readonly AuthProfileView[];
	onSelectProfile: (profileId: string) => void;
}) {
	const currentLabel = input.currentProfileName?.trim() || "your profile";

	return (
		<Select
			onValueChange={(value) => {
				if (value && value !== input.currentProfileId) {
					input.onSelectProfile(value);
				}
			}}
			value={input.currentProfileId}
		>
			<SelectTrigger
				aria-label="Switch the profile you speak as in this Space"
				className="h-8 w-fit min-w-0 max-w-[10rem] gap-1.5 px-2 py-0 font-normal text-muted-foreground text-xs hover:text-foreground sm:max-w-[13rem]"
				displayValue={`Speaking as ${currentLabel}`}
				icon={UserIcon}
				variant="borderless"
			/>
			<SelectContent align="end" className="min-w-56" side="top">
				{input.humanProfiles.map((profile, index) => (
					<SelectItem
						index={index}
						key={profile.openMeldProfileId}
						value={profile.openMeldProfileId}
					>
						{profile.profileName}
						{profile.isDefault ? " · default" : ""}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
