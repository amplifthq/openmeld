import type { DemoScript, VisibleBeatMap } from "../demo-types";
import { ReplyingStatus } from "../space/replying-status";
import { SpaceAgentMessageList } from "../space/space-agent-message-list";
import { SpaceInstructions } from "../space/space-instructions";
import { SpaceMembersCard } from "../space/space-members-card";
import { SpaceSystemFeed } from "../space/space-system-feed";
import { WelcomeMessageThread } from "../space/welcome-message-thread";

type SpaceConversationStageProps = {
	script: DemoScript;
	visibleBeatMap: VisibleBeatMap;
};

export function SpaceConversationStage({
	script,
	visibleBeatMap,
}: SpaceConversationStageProps) {
	if (visibleBeatMap[script.spaceConversationBeat.id] !== true) {
		return null;
	}

	return (
		<section className="motion-safe:fade-in-0 space-y-4 motion-safe:animate-in motion-safe:duration-500 motion-reduce:animate-none sm:space-y-6">
			<SpaceSystemFeed
				feedLines={script.systemFeedLines}
				visibleBeatMap={visibleBeatMap}
			/>
			<SpaceMembersCard
				members={script.spaceMembers}
				title={script.spaceMembersTitle}
			/>
			<SpaceInstructions
				instructions={script.wakeHintLines}
				visibleBeatMap={visibleBeatMap}
			/>
			<WelcomeMessageThread
				isVisible={visibleBeatMap[script.welcomeMessageBeat.id] === true}
				lines={script.welcomeMessageLines}
			/>
			<ReplyingStatus
				replyingStates={script.replyingStates}
				visibleBeatMap={visibleBeatMap}
			/>
			<SpaceAgentMessageList
				messages={script.spaceAgentMessages}
				visibleBeatMap={visibleBeatMap}
			/>
		</section>
	);
}
