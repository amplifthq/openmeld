"use client";

import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { hasLocalAgentLogo } from "@openmeld/ui/components/local-agent-logo-utils";
import { cn } from "@openmeld/ui/lib/utils";
import { RobotIcon } from "@phosphor-icons/react";

export function AgentProfileControllerAvatar(input: {
	agentControllerRef: string | null;
	className?: string;
	profileId: string;
	size: number;
}) {
	const agentId = parseAgentControllerRef(input.agentControllerRef)?.id ?? null;
	const hasControllerLogo = agentId !== null && hasLocalAgentLogo(agentId);
	return (
		<span
			aria-hidden="true"
			className={cn(
				"inline-flex shrink-0 items-center justify-center text-muted-foreground",
				input.className
			)}
			data-testid={`agent-profile-controller-avatar-${input.profileId}`}
			style={{ height: input.size, width: input.size }}
		>
			{hasControllerLogo ? (
				<LocalAgentLogo agentId={agentId} className="h-full w-full" size="md" />
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
