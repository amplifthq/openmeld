import { ThinkingReasoning } from "@openmeld/ui/components/thinking-reasoning";
import { MessageResponse } from "#/components/ai/message-response";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";

export function SpaceAgentReasoning({ item }: { item: SpaceTimelineItem }) {
	const stream = item.agentStreamState;
	if (!stream) {
		return null;
	}
	if (stream.progress) {
		return (
			<ThinkingReasoning
				ariaLabel="Live progress"
				label="Progress"
				streaming={
					stream.status === "streaming" && stream.progressActive !== false
				}
				text={stream.progress}
			>
				<MessageResponse
					isStreaming={stream.progressActive !== false}
					variant="reasoning"
				>
					{stream.progress}
				</MessageResponse>
			</ThinkingReasoning>
		);
	}
	if (stream.thinking) {
		return (
			<ThinkingReasoning
				firstOutputMs={stream.reasoningState?.firstOutputMs}
				streaming={
					stream.status === "streaming" && stream.thinkingActive !== false
				}
				text={stream.thinking}
			>
				<MessageResponse
					isStreaming={stream.thinkingActive !== false}
					variant="reasoning"
				>
					{stream.thinking}
				</MessageResponse>
			</ThinkingReasoning>
		);
	}
	const status = stream.reasoningState?.status;
	const notices = {
		disabled: "Live reasoning is turned off by this Agent’s owner.",
		unavailable: "This Agent connection doesn’t support live reasoning.",
		waiting: "Waiting for reasoning output…",
		streaming: null,
	};
	const notice = status ? notices[status] : null;
	return notice ? (
		<p
			className="text-muted-foreground text-xs"
			data-slot="reasoning-stream-status"
		>
			{notice}
		</p>
	) : null;
}
