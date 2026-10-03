import type { DemoAgentSession, VisibleBeatMap } from "../demo-types";
import type { DemoAgentName } from "../shared/demo-agent-icon";
import { ProviderClaudePanel } from "./provider-claude-panel";
import { ProviderCodexPanel } from "./provider-codex-panel";

type ProviderPanelStackProps = {
	agentSessions: readonly DemoAgentSession[];
	closedProviderNames: ReadonlySet<DemoAgentName>;
	onCloseProvider: (profileName: DemoAgentName) => void;
	visibleBeatMap: VisibleBeatMap;
};

function getDesktopRows(activeRows: readonly boolean[]): string {
	return activeRows
		.map((isActive) => (isActive ? "minmax(0,1fr)" : "minmax(0,0fr)"))
		.join(" ");
}

function ProviderPanel(input: {
	session: DemoAgentSession;
	isVisible: boolean;
	isReplyHighlighted: boolean;
	onClose: () => void;
	shouldScrollToBottom: boolean;
}) {
	const {
		isReplyHighlighted,
		isVisible,
		onClose,
		session,
		shouldScrollToBottom,
	} = input;

	switch (session.providerKind) {
		case "codex":
			return (
				<ProviderCodexPanel
					isReplyHighlighted={isReplyHighlighted}
					isVisible={isVisible}
					onClose={onClose}
					session={session}
					shouldScrollToBottom={shouldScrollToBottom}
				/>
			);
		case "claude-code":
			return (
				<ProviderClaudePanel
					isReplyHighlighted={isReplyHighlighted}
					isVisible={isVisible}
					onClose={onClose}
					session={session}
					shouldScrollToBottom={shouldScrollToBottom}
				/>
			);
		default:
			return null;
	}
}

export function ProviderPanelStack({
	agentSessions,
	closedProviderNames,
	onCloseProvider,
	visibleBeatMap,
}: ProviderPanelStackProps) {
	const orderedSessions = [...agentSessions].sort(
		(leftSession, rightSession) => leftSession.order - rightSession.order
	);
	const activeRows = orderedSessions.map(
		(session) =>
			visibleBeatMap[session.beats.panelVisible.id] === true &&
			!closedProviderNames.has(session.profileName)
	);
	const shouldScrollToBottom =
		visibleBeatMap["provider-panels-scroll-bottom"] === true;
	const mobileVisibleSessions: DemoAgentSession[] = [];
	for (const session of orderedSessions) {
		if (
			visibleBeatMap[session.beats.panelVisible.id] === true &&
			!closedProviderNames.has(session.profileName)
		) {
			mobileVisibleSessions.push(session);
		}
	}

	return (
		<>
			<div
				className="hidden h-full min-h-0 lg:grid"
				style={{
					gridTemplateRows: getDesktopRows(activeRows),
					transition: "grid-template-rows 700ms cubic-bezier(0.16, 1, 0.3, 1)",
				}}
			>
				{orderedSessions.map((session, index) => {
					const isVisible = activeRows[index] === true;
					const isReplyHighlighted =
						visibleBeatMap[session.beats.replyHighlight.id] === true;
					const hasActivePanelBelow = activeRows
						.slice(index + 1)
						.some((isActive) => isActive);

					return (
						<div
							className={
								hasActivePanelBelow
									? "min-h-0 overflow-hidden border-border/70 border-b"
									: "min-h-0 overflow-hidden"
							}
							key={session.profileName}
						>
							<ProviderPanel
								isReplyHighlighted={isReplyHighlighted}
								isVisible={isVisible}
								onClose={() => onCloseProvider(session.profileName)}
								session={session}
								shouldScrollToBottom={shouldScrollToBottom}
							/>
						</div>
					);
				})}
			</div>

			<div className="lg:hidden">
				{mobileVisibleSessions.map((session, index) => (
					<div
						className={index > 0 ? "border-border/70 border-t" : undefined}
						key={session.profileName}
					>
						<ProviderPanel
							isReplyHighlighted={
								visibleBeatMap[session.beats.replyHighlight.id] === true
							}
							isVisible={mobileVisibleSessions.length > 0}
							onClose={() => onCloseProvider(session.profileName)}
							session={session}
							shouldScrollToBottom={shouldScrollToBottom}
						/>
					</div>
				))}
			</div>
		</>
	);
}
