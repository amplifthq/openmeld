import type { BotAvatarInteraction } from "@openmeld/ui/components/bot-avatar";
import { RemoteAgentAvatar } from "#/components/agents/remote-agent-avatar";

export function CenterAgentChatAvatar({
	profileName,
	profileId,
	avatarStyle,
	botInteraction,
	working = false,
	size = 24,
}: {
	profileName?: string;
	profileId?: string;
	avatarStyle?: import("@openmeld/schemas/types").AuthProfileView["avatarStyle"];
	botInteraction?: BotAvatarInteraction;
	working?: boolean;
	size?: 24 | 28 | 32 | 48 | 56;
}) {
	return profileName ? (
		<RemoteAgentAvatar
			avatarStyle={avatarStyle}
			botInteraction={botInteraction}
			profileId={profileId}
			profileName={profileName}
			shape="circle"
			size={size}
			working={working}
		/>
	) : (
		<span className="shrink-0" style={{ width: size, height: size }} />
	);
}
