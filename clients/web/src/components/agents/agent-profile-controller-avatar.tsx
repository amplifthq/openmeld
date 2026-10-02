"use client";

import type { AgentAvatarStyle } from "./remote-agent-avatar";
import { RemoteAgentAvatar } from "./remote-agent-avatar";

export function AgentProfileControllerAvatar(input: {
	agentControllerRef: string | null;
	avatarStyle?: AgentAvatarStyle | null;
	modelId?: string | null;
	className?: string;
	profileId: string;
	profileName: string;
	working?: boolean;
	size: number;
}) {
	return (
		<RemoteAgentAvatar
			{...input}
			data-testid={`agent-profile-controller-avatar-${input.profileId}`}
			fallbackTestId={`agent-profile-controller-fallback-${input.profileId}`}
		/>
	);
}
