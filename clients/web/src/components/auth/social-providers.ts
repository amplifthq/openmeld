import {
	GithubLogoIcon,
	GoogleLogoIcon,
	type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

export type SocialProvider = {
	providerId: "github" | "google";
	name: string;
	icon: PhosphorIcon;
};

export const socialProviders = [
	{
		providerId: "github",
		name: "GitHub",
		icon: GithubLogoIcon,
	},
	{
		providerId: "google",
		name: "Google",
		icon: GoogleLogoIcon,
	},
] as const satisfies readonly SocialProvider[];
