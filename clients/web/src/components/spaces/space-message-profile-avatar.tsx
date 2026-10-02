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
	responsive?: boolean;
};

const PROFILE_INITIALS_SEPARATOR_PATTERN = /\s+/u;

export function SpaceMessageProfileAvatar(
	input: SpaceMessageProfileAvatarProps
) {
	// Draw at the largest transcript size; CSS scales the slot for narrower panes.
	// This keeps canvas avatars sharp without a resize observer per message.
	const avatar = (
		<SpaceMessageProfileAvatarPresentation
			{...input}
			size={input.responsive ? 32 : 24}
		/>
	);
	return input.responsive ? (
		<span data-slot="message-speaker-avatar">
			<span data-slot="message-speaker-avatar-content">{avatar}</span>
		</span>
	) : (
		avatar
	);
}

function SpaceMessageProfileAvatarPresentation(
	input: SpaceMessageProfileAvatarProps & { size: number }
) {
	const savedProfile = useAgentAvatarProfile(input.profileId);
	if (input.profileKind === "agent") {
		if (input.agentControllerPending && !savedProfile && !input.isCenterAgent) {
			return (
				<span
					aria-hidden="true"
					className="inline-flex shrink-0 rounded-[22%] bg-muted"
					data-testid={`space-agent-profile-pending-avatar-${input.profileId}`}
					style={{ width: input.size, height: input.size }}
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
				size={input.size}
				working={input.working}
			/>
		);
	}

	if (input.profileKind === "human") {
		return (
			<DitherProfileAvatar
				avatarImageUrl={input.avatarImageUrl}
				data-testid={`space-human-profile-avatar-${input.profileId}`}
				profileId={input.profileId}
				profileKind="human"
				profileName={input.displayName}
				size={input.size}
			/>
		);
	}

	return (
		<Avatar
			aria-hidden="true"
			className="after:border-0"
			data-testid={`space-system-profile-avatar-${input.profileId}`}
			style={{ width: input.size, height: input.size }}
		>
			{input.avatarImageUrl ? (
				<AvatarImage
					alt=""
					referrerPolicy="no-referrer"
					src={input.avatarImageUrl}
				/>
			) : null}
			<AvatarFallback style={{ fontSize: (input.size / 24) * 10 }}>
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
