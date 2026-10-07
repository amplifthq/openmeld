import { DesktopIcon, MoonIcon, SunDimIcon } from "@phosphor-icons/react";

export const THEME_CHOICES = [
	{
		value: "light",
		label: "Light",
		description: "Use the light appearance.",
		icon: SunDimIcon,
	},
	{
		value: "dark",
		label: "Dark",
		description: "Use the dark appearance.",
		icon: MoonIcon,
	},
	{
		value: "system",
		label: "System",
		description: "Follow your operating system appearance.",
		icon: DesktopIcon,
	},
] as const;
