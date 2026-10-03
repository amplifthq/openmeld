import type { DemoAgentName } from "./shared/demo-agent-icon";

export type DemoProviderKind = "claude-code" | "codex";
export type DemoPlayerStatus = "completed" | "idle" | "playing";

type SetupBeatId =
	| "setup-agents-ready"
	| "setup-login"
	| "setup-service-ready"
	| "setup-skills-ready";

type CreateSpaceBeatId =
	| "create-space-mode"
	| "create-space-name"
	| "create-space-security";

type BringAgentsBeatId =
	| "bring-agents-broadcast"
	| "bring-agents-claude-code"
	| "bring-agents-codex";

type SystemBeatId =
	| "system-added-claude-code"
	| "system-added-codex"
	| "system-connected-human"
	| "system-joined-human";

type AgentSessionBeatId =
	| `provider-panel-${DemoProviderKind}-visible`
	| `replying-${DemoProviderKind}`
	| `reply-highlight-${DemoProviderKind}`
	| `space-agent-message-${DemoProviderKind}-visible`;

export type BeatId =
	| AgentSessionBeatId
	| BringAgentsBeatId
	| CreateSpaceBeatId
	| SetupBeatId
	| SystemBeatId
	| "chat-prompt-visible"
	| "cli-intro-visible"
	| "provider-layout-visible"
	| "provider-panels-scroll-bottom"
	| "replying-aggregate"
	| "space-conversation-visible"
	| "wake-hint-visible"
	| "welcome-message-visible";

export type VisibleBeatMap = Partial<Record<BeatId, true>>;

export type DemoBeat = {
	atMs: number;
	id: BeatId;
};

export type DemoTranscriptLine = DemoBeat & {
	text: string;
};

export type DemoSystemFeedLine =
	| ({
			actorName: "You";
			agentName: DemoAgentName;
			kind: "added";
			wakeWith: `@${DemoAgentName}`;
	  } & DemoBeat)
	| ({
			actorName: "You";
			kind: "connected" | "joined";
	  } & DemoBeat);

export type DemoReplyingState = DemoBeat & {
	agentName: DemoAgentName;
	hideWhenBeatId: BeatId;
	mention: `@${DemoAgentName}`;
};

export type DemoProviderPanel = {
	contextLabel: string;
	contextLines: readonly string[];
	footerLines: readonly string[];
	headerLines: readonly string[];
	highlightLine?: string;
	replyLines: readonly string[];
	tabLabel: string;
	title: string;
};

export type DemoAgentSession = {
	beats: {
		panelVisible: DemoBeat;
		replyHighlight: DemoBeat;
		replying: DemoReplyingState;
		spaceReplyVisible: DemoBeat;
	};
	order: 0 | 1 | 2;
	originCommand: string;
	profileName: DemoAgentName;
	providerKind: DemoProviderKind;
	providerPanel: DemoProviderPanel;
	spaceReplyMeta: readonly string[];
	spaceReplyText: string;
};

export type DemoSpaceAgentMessage = {
	agentName: DemoAgentName;
	highlightBeatId: BeatId;
	id: BeatId;
	metaLines: readonly string[];
	providerKind: DemoProviderKind;
	replyText: string;
};

export type DemoHumanMember = {
	id: string;
	name: "You";
	role: "Human";
};

export type DemoAgentMember = {
	controller: DemoProviderKind;
	id: string;
	name: DemoAgentName;
	ownerName: "You";
	role: "Agent";
	wakeWith: `@${DemoAgentName}`;
};

export type SpaceMember = DemoAgentMember | DemoHumanMember;

export type DemoScript = {
	agentSessions: readonly DemoAgentSession[];
	beats: readonly DemoBeat[];
	bringAgentsLines: readonly DemoTranscriptLine[];
	cliIntroBeat: DemoBeat;
	createSpaceLines: readonly DemoTranscriptLine[];
	prefilledCommand: string;
	providerLayoutBeat: DemoBeat;
	providerPanelsScrollBeat: DemoBeat;
	replyingStates: {
		aggregate: DemoTranscriptLine;
		agents: readonly DemoReplyingState[];
	};
	setupChecks: readonly DemoTranscriptLine[];
	spaceAgentMessages: readonly DemoSpaceAgentMessage[];
	spaceConversationBeat: DemoBeat;
	spaceMembers: readonly SpaceMember[];
	spaceMembersTitle: string;
	startPrompt: string;
	systemFeedLines: readonly DemoSystemFeedLine[];
	totalDurationMs: number;
	wakeHintLines: readonly DemoTranscriptLine[];
	welcomeMessageBeat: DemoBeat;
	welcomeMessageLines: readonly string[];
};
