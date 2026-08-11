import { buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Link } from "@tanstack/react-router";
import { useCurrentOrganizationSlug } from "#/lib/organizations/organization-context";
import {
	buildOrganizationPeoplePath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";

export function SpaceProfileRequiredState(input: {
	recommendedHumanProfile?: {
		profileId: string;
		profileName: string;
		spaceId: string;
	} | null;
}) {
	const recommendedHumanProfile = input.recommendedHumanProfile ?? null;
	const orgSlug = useCurrentOrganizationSlug();

	return (
		<Card className="w-full max-w-lg border-dashed">
			<CardHeader className="flex flex-col gap-2">
				<p className="font-medium text-muted-foreground text-xs">
					OpenMeld Space
				</p>
				<CardTitle className="text-base">
					{recommendedHumanProfile
						? "Open this Space with your profile"
						: "Choose a profile to open this Space"}
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<p className="max-w-prose text-muted-foreground text-sm">
					{recommendedHumanProfile
						? `OpenMeld needs to know which Human Profile should speak for you in this Space. Continue as ${recommendedHumanProfile.profileName}, or choose another profile in Directory.`
						: "OpenMeld needs to know which Human Profile should speak for you in this Space before it can open the app view."}
				</p>
				<div className="flex flex-col gap-2 sm:flex-row">
					{recommendedHumanProfile ? (
						<Link
							className={buttonVariants({
								size: "sm",
								variant: "default",
							})}
							to={buildOrganizationSpacePath({
								orgSlug,
								search: { profileId: recommendedHumanProfile.profileId },
								spaceId: recommendedHumanProfile.spaceId,
							})}
						>
							Continue as {recommendedHumanProfile.profileName}
						</Link>
					) : null}
					<Link
						className={buttonVariants({ size: "sm", variant: "outline" })}
						to={buildOrganizationPeoplePath(orgSlug)}
					>
						{recommendedHumanProfile
							? "Choose Another Profile"
							: "Choose a Profile"}
					</Link>
				</div>
			</CardContent>
		</Card>
	);
}
