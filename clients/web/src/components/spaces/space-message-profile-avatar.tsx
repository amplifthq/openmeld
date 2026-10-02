import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@openmeld/ui/components/avatar";
import type { AgentAvatarStyle } from "#/components/agents/remote-agent-avatar";
import { RemoteAgentAvatar } from "#/components/agents/remote-agent-avatar";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { useAgentAvatarProfile } from "#/query/profiles/agent-avatar-context";

type SpaceMessageProfileAvatarProps = {
	agentControllerRef: string | null;
	agentControllerPending?: boolean;
	avatarImageUrl?: string | null;
	avatarStyle?: AgentAvatarStyle | null;
	avatarModelId?: string | null;
	displayName: string;
	isCenterAgent?: boolean;
	working?: boolean;
	profileId: string;
	profileKind: "agent" | "human" | "system";
};

const PROFILE_INITIALS_SEPARATOR_PATTERN = /\s+/u;

export function SpaceMessageProfileAvatar(
	input: SpaceMessageProfileAvatarProps
) {
	const savedProfile = useAgentAvatarProfile(input.profileId);
	if (input.profileKind === "agent") {
		if (input.agentControllerPending && !savedProfile && !input.isCenterAgent) {
			return (
				<span
					aria-hidden="true"
					className="inline-flex size-6 shrink-0 rounded-[22%] bg-muted"
					data-testid={`space-agent-profile-pending-avatar-${input.profileId}`}
				/>
			);
		}

		return (
			<RemoteAgentAvatar
				agentControllerRef={input.agentControllerRef}
				avatarImageUrl={input.avatarImageUrl}
				avatarStyle={input.avatarStyle}
				data-testid={`${input.isCenterAgent ? "space-center-agent-profile-avatar" : "space-agent-profile-avatar"}-${input.profileId}`}
				fallbackTestId={
					input.isCenterAgent
						? undefined
						: `space-agent-profile-fallback-avatar-${input.profileId}`
				}
				modelId={input.avatarModelId}
				profileId={input.profileId}
				profileName={input.displayName}
				shape={input.isCenterAgent ? "circle" : "rounded-square"}
				size={24}
				working={input.working}
			/>
		);
	}

	if (input.profileKind === "human") {
		return (
			<DitherProfileAvatar
				avatarImageUrl={input.avatarImageUrl}
				className="size-6"
				data-testid={`space-human-profile-avatar-${input.profileId}`}
				profileId={input.profileId}
				profileKind="human"
				profileName={input.displayName}
				size={24}
			/>
		);
	}

	return (
		<Avatar
			aria-hidden="true"
			className="size-6 after:border-0"
			data-testid={`space-system-profile-avatar-${input.profileId}`}
		>
			{input.avatarImageUrl ? (
				<AvatarImage
					alt=""
					referrerPolicy="no-referrer"
					src={input.avatarImageUrl}
				/>
			) : null}
			<AvatarFallback className="text-[10px]">
				{buildProfileInitials(input.displayName)}
			</AvatarFallback>
		</Avatar>
	);
}

function buildProfileInitials(displayName: string): string {
	const segments = displayName
		.trim()
		.split(PROFILE_INITIALS_SEPARATOR_PATTERN)
		.filter(Boolean);
	if (segments.length === 0) {
		return "?";
	}

	return segments
		.slice(0, 2)
		.map((segment) => segment.charAt(0).toUpperCase())
		.join("");
}
