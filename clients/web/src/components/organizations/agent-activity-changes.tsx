import { AgentActivityChangesFeed } from "./agent-activity-changes-feed";
import { AgentActivityEmptySetup } from "./agent-activity-empty-setup";
import {
	useAgentActivityData,
	useAgentActivityView,
} from "./agent-activity-page";

const FOUR_HOURS_MS = 4 * 60 * 60_000;
const EMPTY_FILTERS = { provider: null, status: null };

export function AgentActivityChanges() {
	const data = useAgentActivityData();
	const view = useAgentActivityView(EMPTY_FILTERS, FOUR_HOURS_MS);
	return (
		<section
			aria-labelledby="agent-activity-changes-heading"
			className="grid gap-3"
		>
			<div>
				<h2 className="font-medium text-xl" id="agent-activity-changes-heading">
					Changes
				</h2>
				<p className="text-muted-foreground text-sm">
					State transitions across the latest Activity evidence.
				</p>
			</div>
			<AgentActivityChangesFeed
				emptyContent={
					data.snapshotQuery.isSuccess ? <AgentActivityEmptySetup /> : undefined
				}
				feedItems={view?.feedItems ?? []}
				foldedHeartbeatCount={view?.foldedHeartbeatCount ?? 0}
				nowMs={data.currentTimeMs}
			/>
		</section>
	);
}
