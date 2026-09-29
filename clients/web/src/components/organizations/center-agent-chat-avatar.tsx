import { RemoteAgentAvatar } from "#/components/agents/remote-agent-avatar";

export function CenterAgentChatAvatar({
	profileName,
	profileId,
	avatarStyle,
	working = false,
}: {
	profileName?: string;
	profileId?: string;
	avatarStyle?: import("@openmeld/schemas/types").AuthProfileView["avatarStyle"];
	working?: boolean;
}) {
	return profileName ? (
		<RemoteAgentAvatar
			avatarStyle={avatarStyle}
			profileId={profileId}
			profileName={profileName}
			shape="circle"
			size={24}
			working={working}
		/>
	) : (
		<span className="size-6 shrink-0" />
	);
}
