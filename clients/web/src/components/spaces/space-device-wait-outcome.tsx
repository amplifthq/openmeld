import { Button } from "@openmeld/ui/components/button";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { createContext, type ReactNode, useContext } from "react";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";

export type ComposeExpiredDeviceWait = (input: {
	sourceSignalId: string;
	targetProfileId: string;
}) => void;

const ComposeAgainContext = createContext<ComposeExpiredDeviceWait | undefined>(
	undefined
);

export function SpaceDeviceWaitOutcomeScope(input: {
	children: ReactNode;
	onComposeAgain?: ComposeExpiredDeviceWait;
}) {
	return (
		<ComposeAgainContext.Provider value={input.onComposeAgain}>
			{input.children}
		</ComposeAgainContext.Provider>
	);
}

export function SpaceDeviceWaitOutcome(input: {
	notices: readonly SpaceTimelineItem[];
	sourceItem: SpaceTimelineItem;
}) {
	const composeAgain = useContext(ComposeAgainContext);
	const expired = input.notices.find(
		(notice) =>
			notice.systemNoticeType === "terminal_failure" &&
			notice.systemNoticeReasonCode === "wake.device_wait.expired" &&
			notice.replyToSignalId === input.sourceItem.id &&
			Boolean(notice.systemNoticeTargetProfileId)
	);
	const targetProfileId = expired?.systemNoticeTargetProfileId;
	if (!targetProfileId) {
		return null;
	}
	return (
		<div className="flex min-w-0 flex-wrap items-center gap-2 text-muted-foreground text-xs">
			<span>Wait expired. Task did not run.</span>
			{composeAgain ? (
				<TooltipHint content="Review and send a new task">
					<Button
						onClick={() =>
							composeAgain({
								sourceSignalId: input.sourceItem.id,
								targetProfileId,
							})
						}
						size="xs"
						type="button"
						variant="ghost"
					>
						Send again
					</Button>
				</TooltipHint>
			) : null}
		</div>
	);
}
