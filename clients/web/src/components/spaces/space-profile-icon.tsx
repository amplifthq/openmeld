import { cn } from "@openmeld/ui/lib/utils";
import type { AgentAvatarStyle } from "#/components/agents/remote-agent-avatar";
import { RemoteAgentAvatar } from "#/components/agents/remote-agent-avatar";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import {
	HumanPresenceIndicator,
	useHumanPresence,
} from "#/components/profiles/human-presence";

const SPACE_PROFILE_ICON_SIZE_CLASS_NAMES = {
	inline: "size-3.5",
	lg: "size-16",
	md: "size-12",
	sidebar: "size-7",
	sm: "size-6",
	xs: "size-5",
} as const;
const SPACE_PROFILE_ICON_SIZE_PIXELS = {
	inline: 14,
	lg: 64,
	md: 48,
	sidebar: 28,
	sm: 24,
	xs: 20,
} as const;

export function SpaceProfileIcon(input: {
	className?: string;
	agentControllerRef: string | null;
	avatarImageUrl?: string | null;
	avatarStyle?: AgentAvatarStyle | null;
	avatarModelId?: string | null;
	isCenterAgent?: boolean;
	profileId: string;
	profileKind: "agent" | "human";
	profileName: string;
	showPresence?: boolean;
	size?: keyof typeof SPACE_PROFILE_ICON_SIZE_CLASS_NAMES;
}) {
	const size = input.size ?? "xs";
	const presence = useHumanPresence();

	if (input.profileKind === "agent") {
		return (
			<RemoteAgentAvatar
				agentControllerRef={input.agentControllerRef}
				avatarStyle={input.avatarStyle}
				className={cn(
					SPACE_PROFILE_ICON_SIZE_CLASS_NAMES[size],
					input.className
				)}
				data-testid={`space-profile-icon-${input.profileId}`}
				fallbackTestId={`space-agent-profile-fallback-icon-${input.profileId}`}
				profileId={input.profileId}
				profileName={input.profileName}
				shape={input.isCenterAgent ? "circle" : "rounded-square"}
				size={SPACE_PROFILE_ICON_SIZE_PIXELS[size]}
			/>
		);
	}

	if (input.profileKind === "human") {
		return (
			<span className={cn("relative inline-flex shrink-0", input.className)}>
				<DitherProfileAvatar
					avatarImageUrl={input.avatarImageUrl}
					className={SPACE_PROFILE_ICON_SIZE_CLASS_NAMES[size]}
					data-testid={`space-profile-icon-${input.profileId}`}
					profileId={input.profileId}
					profileKind="human"
					profileName={input.profileName}
					size={SPACE_PROFILE_ICON_SIZE_PIXELS[size]}
				/>
				{input.showPresence !== false && size !== "inline" && (
					<HumanPresenceIndicator
						large={size === "md" || size === "lg"}
						status={presence.get(input.profileId)}
					/>
				)}
			</span>
		);
	}

	return null;
}
