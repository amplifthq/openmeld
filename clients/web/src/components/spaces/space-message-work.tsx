import type { ReactNode } from "react";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { SpaceAgentToolActivity } from "./space-agent-tool-activity";

/** Keep live and settled work in the same place, before the answer body. */
export function SpaceMessageWork(input: {
	item: SpaceTimelineItem;
	status: ReactNode;
}) {
	return (
		<>
			{input.status}
			{input.item.agentStreamState?.status !== "streaming" &&
			(input.item.agentActivity || input.item.agentPublicProgress) ? (
				<SpaceAgentToolActivity item={input.item} placement="message" />
			) : null}
		</>
	);
}
