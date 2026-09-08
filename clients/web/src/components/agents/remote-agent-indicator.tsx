import { HOSTED_REMOTE_AGENT_CONTROLLER_REF } from "@openmeld/agent-runtime";
import { CloudIcon } from "@phosphor-icons/react";

export function RemoteAgentIndicator(input: {
	agentControllerRef: string | null;
}) {
	if (input.agentControllerRef !== HOSTED_REMOTE_AGENT_CONTROLLER_REF) {
		return null;
	}
	return (
		<span
			aria-label="Remote Agent"
			className="inline-flex shrink-0 items-center text-muted-foreground"
			role="img"
			title="Remote Agent"
		>
			<CloudIcon aria-hidden="true" className="size-3.5" />
		</span>
	);
}
