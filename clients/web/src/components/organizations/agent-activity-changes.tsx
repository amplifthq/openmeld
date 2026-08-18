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
	const emptyContent = resolveChangesEmptyContent({
		isError: data.snapshotQuery.isError,
		isPending: data.snapshotQuery.isPending,
		setupState: view?.setupState ?? null,
	});
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
				emptyContent={emptyContent}
				feedItems={view?.feedItems ?? []}
				foldedHeartbeatCount={view?.foldedHeartbeatCount ?? 0}
				nowMs={data.currentTimeMs}
			/>
		</section>
	);
}

function resolveChangesEmptyContent(input: {
	isError: boolean;
	isPending: boolean;
	setupState: "active" | "awaiting_first_session" | "no_projects" | null;
}) {
	if (input.isPending) {
		return "Loading changes…";
	}
	if (input.isError) {
		return "Changes are unavailable.";
	}
	if (
		input.setupState === "no_projects" ||
		input.setupState === "awaiting_first_session"
	) {
		return <AgentActivityEmptySetup setupState={input.setupState} />;
	}
	return "No state changes in the last 4 hours.";
}
