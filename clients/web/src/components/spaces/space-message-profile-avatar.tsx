import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@openmeld/ui/components/avatar";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { hasLocalAgentLogo } from "@openmeld/ui/components/local-agent-logo-utils";
import { RobotIcon } from "@phosphor-icons/react";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";

type SpaceMessageProfileAvatarProps = {
	agentControllerRef: string | null;
	agentControllerPending?: boolean;
	avatarImageUrl?: string | null;
	displayName: string;
	isCenterAgent?: boolean;
	profileId: string;
	profileKind: "agent" | "human" | "system";
};

const PROFILE_INITIALS_SEPARATOR_PATTERN = /\s+/u;

export function SpaceMessageProfileAvatar(
	input: SpaceMessageProfileAvatarProps
) {
	if (input.profileKind === "agent") {
		if (input.isCenterAgent) {
			return (
				<DitherProfileAvatar
					className="size-6"
					data-testid={`space-center-agent-profile-avatar-${input.profileId}`}
					profileId={input.profileId}
					profileKind="center-agent"
					profileName={input.displayName}
					size={24}
				/>
			);
		}

		if (input.agentControllerPending) {
			return (
				<span
					aria-hidden="true"
					className="inline-flex h-5 w-5 shrink-0 rounded-[5px] bg-muted"
					data-testid={`space-agent-profile-pending-avatar-${input.profileId}`}
				/>
			);
		}

		const agentControllerRef = input.agentControllerRef;
		if (agentControllerRef !== null && hasLocalAgentLogo(agentControllerRef)) {
			return (
				<span
					aria-hidden="true"
					className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground"
					data-testid={`space-agent-profile-avatar-${input.profileId}`}
				>
					<LocalAgentLogo agentId={agentControllerRef} size="md" />
				</span>
			);
		}

		return (
			<span
				aria-hidden="true"
				className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground"
				data-testid={`space-agent-profile-avatar-${input.profileId}`}
			>
				<RobotIcon
					aria-hidden="true"
					className="h-5 w-5"
					data-testid={`space-agent-profile-fallback-avatar-${input.profileId}`}
				/>
			</span>
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
