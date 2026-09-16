import { RemoteAgentAvatar } from "#/components/agents/remote-agent-avatar";

export function CenterAgentChatAvatar({
	profileName,
	working = false,
}: {
	profileName?: string;
	working?: boolean;
}) {
	return profileName ? (
		<RemoteAgentAvatar
			profileName={profileName}
			shape="circle"
			size={24}
			working={working}
		/>
	) : (
		<span className="size-6 shrink-0" />
	);
}
