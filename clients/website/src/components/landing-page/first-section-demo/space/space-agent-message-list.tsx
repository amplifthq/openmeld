import type { DemoSpaceAgentMessage, VisibleBeatMap } from "../demo-types";
import { SpaceAgentMessageItem } from "./space-agent-message-item";

type SpaceAgentMessageListProps = {
	messages: readonly DemoSpaceAgentMessage[];
	visibleBeatMap: VisibleBeatMap;
};

export function SpaceAgentMessageList({
	messages,
	visibleBeatMap,
}: SpaceAgentMessageListProps) {
	const visibleMessages = messages.filter(
		(message) => visibleBeatMap[message.id] === true
	);

	if (visibleMessages.length === 0) {
		return null;
	}

	return (
		<section className="space-y-6 sm:space-y-7">
			{visibleMessages.map((message) => (
				<SpaceAgentMessageItem
					isReplyHighlighted={visibleBeatMap[message.highlightBeatId] === true}
					key={message.id}
					message={message}
				/>
			))}
		</section>
	);
}
