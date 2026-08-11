import { Marker, MarkerContent } from "./primitives/marker";
import { MessageScrollerItem } from "./primitives/message-scroller";

export function SpaceConversationCompactionMarker(input: { id: string }) {
	return (
		<MessageScrollerItem messageId={input.id}>
			<Marker
				className="px-3 py-2"
				data-conversation-compaction-marker="true"
				variant="separator"
			>
				<MarkerContent>Conversation compacted</MarkerContent>
			</Marker>
		</MessageScrollerItem>
	);
}
