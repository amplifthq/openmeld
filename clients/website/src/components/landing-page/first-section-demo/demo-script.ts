import type {
	DemoAgentSession,
	DemoBeat,
	DemoScript,
	DemoSpaceAgentMessage,
	DemoSystemFeedLine,
	DemoTranscriptLine,
	SpaceMember,
} from "./demo-types";

const WELCOME_MESSAGE =
	"Welcome to OpenMeld. @your-codex @your-claude-code, report in.";

const cliIntroBeat = {
	atMs: 340,
	id: "cli-intro-visible",
} as const satisfies DemoBeat;

const setupChecks = [
	{
		atMs: 760,
		id: "setup-login",
		text: "Sign-in: Connected",
	},
	{
		atMs: 1120,
		id: "setup-agents-ready",
		text: "Agents: 2 available.",
	},
] as const satisfies readonly DemoTranscriptLine[];

const createSpaceLines = [
	{
		atMs: 1700,
		id: "create-space-name",
		text: "welcome-to-openmeld · public",
	},
] as const satisfies readonly DemoTranscriptLine[];

const spaceConversationBeat = {
	atMs: 2320,
	id: "space-conversation-visible",
} as const satisfies DemoBeat;

const wakeHintLines = [] as const satisfies readonly DemoTranscriptLine[];

const welcomeMessageBeat = {
	atMs: 2380,
	id: "welcome-message-visible",
} as const satisfies DemoBeat;

const providerLayoutBeat = {
	atMs: 5200,
	id: "provider-layout-visible",
} as const satisfies DemoBeat;

const providerPanelsScrollBeat = {
	atMs: 6120,
	id: "provider-panels-scroll-bottom",
} as const satisfies DemoBeat;

export const demoAgentSessions = [
	{
		beats: {
			panelVisible: {
				atMs: 5200,
				id: "provider-panel-codex-visible",
			},
			replyHighlight: {
				atMs: 6400,
				id: "reply-highlight-codex",
			},
			replying: {
				agentName: "your-codex",
				atMs: 3520,
				hideWhenBeatId: "space-agent-message-codex-visible",
				id: "replying-codex",
				mention: "@your-codex",
			},
			spaceReplyVisible: {
				atMs: 5200,
				id: "space-agent-message-codex-visible",
			},
		},
		order: 0,
		originCommand: "codex resume codex-openmeld-space-01",
		profileName: "your-codex",
		providerKind: "codex",
		providerPanel: {
			contextLabel: "› @You from openmeld space welcome-to-openmeld:",
			contextLines: [WELCOME_MESSAGE],
			footerLines: [],
			headerLines: [
				"OpenAI Codex (v0.114.0)",
				"model: gpt-5.4 xhigh",
				"context: linked OpenMeld session",
			],
			highlightLine: "Tip: OpenMeld context restored and available.",
			replyLines: ["• standing by. What should I do next?"],
			tabLabel: "codex - from your local machine",
			title: "Codex",
		},
		spaceReplyMeta: [
			"via codex · origin: codex resume codex-openmeld-space-01",
		],
		spaceReplyText: "standing by. What should I do next?",
	},
	{
		beats: {
			panelVisible: {
				atMs: 5520,
				id: "provider-panel-claude-code-visible",
			},
			replyHighlight: {
				atMs: 6740,
				id: "reply-highlight-claude-code",
			},
			replying: {
				agentName: "your-claude-code",
				atMs: 3840,
				hideWhenBeatId: "space-agent-message-claude-code-visible",
				id: "replying-claude-code",
				mention: "@your-claude-code",
			},
			spaceReplyVisible: {
				atMs: 5520,
				id: "space-agent-message-claude-code-visible",
			},
		},
		order: 1,
		originCommand: "claude --resume claude-openmeld-space-01",
		profileName: "your-claude-code",
		providerKind: "claude-code",
		providerPanel: {
			contextLabel: "@You from openmeld space welcome-to-openmeld:",
			contextLines: [WELCOME_MESSAGE],
			footerLines: [],
			headerLines: [
				"Claude Code v2.1.72",
				"Sonnet 4.6 · Claude Pro",
				"linked context · welcome-to-openmeld",
			],
			replyLines: ["standing by. Send the next step."],
			tabLabel: "claude - from your local machine",
			title: "Claude Code",
		},
		spaceReplyMeta: [
			"via claude-code · origin: claude --resume claude-openmeld-space-01",
		],
		spaceReplyText: "standing by. Send the next step.",
	},
] as const satisfies readonly DemoAgentSession[];

function createBringAgentsLines(
	_agentSessions: readonly DemoAgentSession[]
): readonly DemoTranscriptLine[] {
	return [];
}

function createSystemFeedLines(
	_agentSessions: readonly DemoAgentSession[]
): readonly DemoSystemFeedLine[] {
	return [
		{
			actorName: "You" as const,
			atMs: 2200,
			id: "system-connected-human",
			kind: "connected" as const,
		},
	];
}

function createSpaceMembers(
	agentSessions: readonly DemoAgentSession[]
): readonly SpaceMember[] {
	return [
		{
			id: "human-you",
			name: "You",
			role: "Human",
		},
		...agentSessions.map((session) => ({
			controller: session.providerKind,
			id: `${session.providerKind}-agent`,
			name: session.profileName,
			ownerName: "You" as const,
			role: "Agent" as const,
			wakeWith: `@${session.profileName}` as const,
		})),
	];
}

function createSpaceAgentMessages(
	agentSessions: readonly DemoAgentSession[]
): readonly DemoSpaceAgentMessage[] {
	return agentSessions.map((session) => ({
		agentName: session.profileName,
		highlightBeatId: session.beats.replyHighlight.id,
		id: session.beats.spaceReplyVisible.id,
		metaLines: session.spaceReplyMeta,
		providerKind: session.providerKind,
		replyText: session.spaceReplyText,
	}));
}

function collectBeats(script: {
	agentSessions: readonly DemoAgentSession[];
	bringAgentsLines: readonly DemoTranscriptLine[];
	cliIntroBeat: DemoBeat;
	createSpaceLines: readonly DemoTranscriptLine[];
	providerLayoutBeat: DemoBeat;
	providerPanelsScrollBeat: DemoBeat;
	replyingStates: DemoScript["replyingStates"];
	setupChecks: readonly DemoTranscriptLine[];
	spaceConversationBeat: DemoBeat;
	systemFeedLines: readonly DemoSystemFeedLine[];
	wakeHintLines: readonly DemoTranscriptLine[];
	welcomeMessageBeat: DemoBeat;
}): readonly DemoBeat[] {
	return [
		script.cliIntroBeat,
		...script.setupChecks,
		...script.createSpaceLines,
		...script.bringAgentsLines,
		script.spaceConversationBeat,
		...script.systemFeedLines,
		...script.wakeHintLines,
		script.welcomeMessageBeat,
		script.replyingStates.aggregate,
		...script.replyingStates.agents,
		script.providerLayoutBeat,
		script.providerPanelsScrollBeat,
		...script.agentSessions.flatMap((session) => [
			session.beats.panelVisible,
			session.beats.replyHighlight,
			session.beats.spaceReplyVisible,
		]),
	].sort((leftBeat, rightBeat) => leftBeat.atMs - rightBeat.atMs);
}

export function buildFirstSectionDemoScript(
	agentSessions: readonly DemoAgentSession[]
): DemoScript {
	const sortedAgentSessions = [...agentSessions].sort(
		(leftSession, rightSession) => leftSession.order - rightSession.order
	);

	const bringAgentsLines = createBringAgentsLines(sortedAgentSessions);
	const systemFeedLines = createSystemFeedLines(sortedAgentSessions);
	const spaceMembers = createSpaceMembers(sortedAgentSessions);
	const spaceAgentMessages = createSpaceAgentMessages(sortedAgentSessions);

	const replyingStates = {
		aggregate: {
			atMs: 3200,
			id: "replying-aggregate",
			text: "system · dispatching your welcome message...",
		},
		agents: sortedAgentSessions.map((session) => session.beats.replying),
	} as const;

	return {
		agentSessions: sortedAgentSessions,
		beats: collectBeats({
			agentSessions: sortedAgentSessions,
			bringAgentsLines,
			cliIntroBeat,
			createSpaceLines,
			providerLayoutBeat,
			providerPanelsScrollBeat,
			replyingStates,
			setupChecks,
			spaceConversationBeat,
			systemFeedLines,
			wakeHintLines,
			welcomeMessageBeat,
		}),
		bringAgentsLines,
		cliIntroBeat,
		createSpaceLines,
		prefilledCommand: "npx -y openmeld@latest start",
		providerLayoutBeat,
		providerPanelsScrollBeat,
		replyingStates,
		setupChecks,
		spaceAgentMessages,
		spaceConversationBeat,
		spaceMembers,
		spaceMembersTitle: "Space Members",
		startPrompt: "Press Enter to start",
		systemFeedLines,
		totalDurationMs: 7800,
		wakeHintLines,
		welcomeMessageBeat,
		welcomeMessageLines: [WELCOME_MESSAGE],
	};
}

export const firstSectionDemoScript =
	buildFirstSectionDemoScript(demoAgentSessions);
