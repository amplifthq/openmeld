import { ThinkingReasoning } from "@openmeld/ui/components/thinking-reasoning";
import { MessageResponse } from "#/components/ai/message-response";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";

export function SpaceAgentReasoning({ item }: { item: SpaceTimelineItem }) {
	const stream = item.agentStreamState;
	if (!stream) {
		return null;
	}
	const processText = stream.progress || stream.thinking;
	if (processText) {
		const processActive = stream.progress
			? stream.progressActive !== false
			: stream.thinkingActive !== false;
		return (
			<ThinkingReasoning
				ariaLabel="Thinking process"
				firstOutputMs={
					stream.progress ? undefined : stream.reasoningState?.firstOutputMs
				}
				label="Thinking process"
				streaming={stream.status === "streaming" && processActive}
				text={processText}
			>
				<MessageResponse isStreaming={processActive} variant="reasoning">
					{processText}
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
