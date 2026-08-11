import {
	hasLocalAgentLogo,
	LocalAgentLogo,
} from "@openmeld/ui/components/local-agent-logo";
import { cn } from "@openmeld/ui/lib/utils";
import { RobotIcon } from "@phosphor-icons/react";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";

const SPACE_PROFILE_ICON_SIZE_CLASS_NAMES = {
	sm: "size-6",
	xs: "size-5",
} as const;
const SPACE_PROFILE_ICON_SIZE_PIXELS = {
	sm: 24,
	xs: 20,
} as const;

export function SpaceProfileIcon(input: {
	className?: string;
	agentControllerRef: string | null;
	avatarImageUrl?: string | null;
	isCenterAgent?: boolean;
	profileId: string;
	profileKind: "agent" | "human";
	profileName: string;
	size?: keyof typeof SPACE_PROFILE_ICON_SIZE_CLASS_NAMES;
}) {
	const size = input.size ?? "xs";

	if (input.profileKind === "agent" && input.isCenterAgent) {
		return (
			<DitherProfileAvatar
				className={cn(
					"after:border-0",
					SPACE_PROFILE_ICON_SIZE_CLASS_NAMES[size],
					input.className
				)}
				data-testid={`space-profile-icon-${input.profileId}`}
				profileId={input.profileId}
				profileKind="center-agent"
				profileName={input.profileName}
				size={SPACE_PROFILE_ICON_SIZE_PIXELS[size]}
			/>
		);
	}

	if (input.profileKind === "human") {
		return (
			<DitherProfileAvatar
				avatarImageUrl={input.avatarImageUrl}
				className={cn(
					"after:border-0",
					SPACE_PROFILE_ICON_SIZE_CLASS_NAMES[size],
					input.className
				)}
				data-testid={`space-profile-icon-${input.profileId}`}
				profileId={input.profileId}
				profileKind="human"
				profileName={input.profileName}
				size={SPACE_PROFILE_ICON_SIZE_PIXELS[size]}
			/>
		);
	}

	const controllerLogoRef =
		input.agentControllerRef !== null &&
		hasLocalAgentLogo(input.agentControllerRef)
			? input.agentControllerRef
			: null;

	return (
		<span
			aria-hidden="true"
			className={cn(
				"inline-flex shrink-0 items-center justify-center text-muted-foreground",
				SPACE_PROFILE_ICON_SIZE_CLASS_NAMES[size],
				input.className
			)}
			data-testid={`space-profile-icon-${input.profileId}`}
		>
			{controllerLogoRef ? (
				<LocalAgentLogo
					agentId={controllerLogoRef}
					className="h-full w-full"
					size={size}
				/>
			) : (
				<RobotIcon
					aria-hidden="true"
					className="h-full w-full"
					data-testid={`space-agent-profile-fallback-icon-${input.profileId}`}
				/>
			)}
		</span>
	);
}
