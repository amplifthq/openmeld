"use client";

import {
	HOSTED_CENTER_AGENT_CONTROLLER_REF,
	HOSTED_REMOTE_AGENT_CONTROLLER_REF,
	parseAgentControllerRef,
} from "@openmeld/agent-runtime";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { hasLocalAgentLogo } from "@openmeld/ui/components/local-agent-logo-utils";
import { cn } from "@openmeld/ui/lib/utils";
import { RobotIcon } from "@phosphor-icons/react";
import { RemoteAgentAvatar } from "./remote-agent-avatar";

export function AgentProfileControllerAvatar(input: {
	agentControllerRef: string | null;
	className?: string;
	profileId: string;
	profileName: string;
	working?: boolean;
	size: number;
}) {
	if (
		input.agentControllerRef === HOSTED_REMOTE_AGENT_CONTROLLER_REF ||
		input.agentControllerRef === HOSTED_CENTER_AGENT_CONTROLLER_REF
	) {
		return (
			<RemoteAgentAvatar
				className={input.className}
				profileName={input.profileName}
				shape={
					input.agentControllerRef === HOSTED_CENTER_AGENT_CONTROLLER_REF
						? "circle"
						: "rounded-square"
				}
				size={input.size}
				working={input.working}
			/>
		);
	}
	const agentId = parseAgentControllerRef(input.agentControllerRef)?.id ?? null;
	const hasControllerLogo = agentId !== null && hasLocalAgentLogo(agentId);
	return (
		<span
			aria-hidden="true"
			className={cn(
				"inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg text-muted-foreground",
				input.className
			)}
			data-testid={`agent-profile-controller-avatar-${input.profileId}`}
			style={{ height: input.size, width: input.size }}
		>
			{hasControllerLogo ? (
				<LocalAgentLogo
					agentId={agentId}
					className="h-[88%] w-[88%] overflow-hidden rounded-[22%]"
					size="md"
				/>
			) : (
				<RobotIcon
					aria-hidden="true"
					className="h-3/5 w-3/5"
					data-testid={`agent-profile-controller-fallback-${input.profileId}`}
				/>
			)}
		</span>
	);
}
