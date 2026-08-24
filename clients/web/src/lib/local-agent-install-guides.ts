import { BUILTIN_AGENT_CONTROLLER_DISPLAY_ORDER } from "@openmeld/schemas";

export const LOCAL_AGENTS_GUIDE_PATH = "/guides/local-agents";

export type LocalAgentInstallGuideId =
	| "claude-code"
	| "codex"
	| "cursor"
	| "grok-build"
	| "opencode";

export type LocalAgentInstallGuide = {
	agentId: LocalAgentInstallGuideId;
	displayName: string;
	installSteps: readonly string[];
	officialDocsUrl?: string;
	officialInstallUrl: string;
	postInstallNote: string;
	summary: string;
	verifyCommand?: string;
};

export const LOCAL_AGENT_INSTALL_GUIDES = {
	"claude-code": {
		agentId: "claude-code",
		displayName: "Claude Code",
		installSteps: [
			"Install Claude Code with the official installer: curl -fsSL https://claude.ai/install.sh | bash",
			"Open a project folder in Terminal and run claude.",
			"Complete the sign-in prompt with a Claude or Console account.",
		],
		officialDocsUrl: "https://code.claude.com/docs/en/quickstart",
		officialInstallUrl: "https://code.claude.com/docs/en/quickstart",
		postInstallNote:
			"OpenMeld verifies Claude Code by finding a launchable claude executable and checking claude --version. Run Claude Code once and finish sign-in before you check again.",
		summary:
			"Anthropic's terminal coding agent for working with code through Claude.",
		verifyCommand: "claude --version",
	},
	codex: {
		agentId: "codex",
		displayName: "Codex",
		installSteps: [
			"If you already use the ChatGPT app on this computer, open it and make sure you are signed in. OpenMeld can use the Codex included with ChatGPT.",
			"If you do not use the ChatGPT app, install Codex from OpenAI.",
			"Open Codex once and sign in with your ChatGPT account.",
		],
		officialDocsUrl: "https://developers.openai.com/codex/cli",
		officialInstallUrl: "https://developers.openai.com/codex/cli",
		postInstallNote:
			"OpenMeld checks every Codex installation it can safely control. If ChatGPT includes a working signed-in Codex, OpenMeld uses it automatically. You do not need to choose an installation unless you want to change it.",
		summary: "OpenAI's coding agent for local coding workflows.",
	},
	cursor: {
		agentId: "cursor",
		displayName: "Cursor CLI",
		installSteps: [
			"Install Cursor CLI with the official installer: curl https://cursor.com/install -fsS | bash",
			"Make sure ~/.local/bin is on your PATH, then run cursor-agent login.",
			"Complete Cursor CLI sign-in in your browser. Cursor IDE sign-in does not sign in Cursor CLI.",
		],
		officialDocsUrl: "https://cursor.com/docs/cli/acp",
		officialInstallUrl: "https://cursor.com/docs/cli/installation",
		postInstallNote:
			"OpenMeld verifies Cursor CLI by finding a launchable cursor-agent executable, checking cursor-agent --version, and reading cursor-agent status. OpenMeld runs Cursor through Agent Client Protocol (ACP).",
		summary:
			"Cursor’s command-line coding agent, connected through its structured Agent Client Protocol interface.",
		verifyCommand: "cursor-agent status",
	},
	"grok-build": {
		agentId: "grok-build",
		displayName: "Grok Build",
		installSteps: [
			"Install Grok Build with the official installer: curl -fsSL https://x.ai/cli/install.sh | bash",
			"Open a project folder in Terminal and run grok login.",
			"Complete Grok sign-in, then run grok once to confirm your account can start a session.",
		],
		officialDocsUrl: "https://docs.x.ai/build/overview",
		officialInstallUrl: "https://docs.x.ai/build/overview",
		postInstallNote:
			"OpenMeld verifies Grok Build by finding a launchable grok executable and checking its version. OpenMeld uses your existing cached Grok sign-in and never opens a login browser from the background service.",
		summary:
			"xAI's terminal coding agent, connected through its Agent Client Protocol interface.",
		verifyCommand: "grok --version",
	},
	opencode: {
		agentId: "opencode",
		displayName: "OpenCode",
		installSteps: [
			"Install OpenCode with the official installer: curl -fsSL https://opencode.ai/install | bash",
			"Open a project folder in Terminal and run opencode.",
			"Connect the model provider you want to use from the OpenCode terminal app.",
		],
		officialDocsUrl: "https://opencode.ai/docs/",
		officialInstallUrl: "https://opencode.ai/docs/",
		postInstallNote:
			"OpenMeld verifies OpenCode by finding a launchable opencode executable and checking opencode --version. Run OpenCode once and finish provider setup before you check again.",
		summary:
			"An open-source terminal coding agent with multiple model providers.",
		verifyCommand: "opencode --version",
	},
} as const satisfies Record<LocalAgentInstallGuideId, LocalAgentInstallGuide>;

export const LOCAL_AGENT_INSTALL_GUIDE_IDS = Object.freeze(
	BUILTIN_AGENT_CONTROLLER_DISPLAY_ORDER.filter(isLocalAgentInstallGuideId)
);

export function listLocalAgentInstallGuides(): readonly LocalAgentInstallGuide[] {
	return LOCAL_AGENT_INSTALL_GUIDE_IDS.map(
		(agentId) => LOCAL_AGENT_INSTALL_GUIDES[agentId]
	);
}

export function getLocalAgentInstallGuide(
	agentId: string
): LocalAgentInstallGuide | null {
	if (isLocalAgentInstallGuideId(agentId)) {
		return LOCAL_AGENT_INSTALL_GUIDES[agentId];
	}
	return null;
}

export function buildLocalAgentGuideDetailPath(
	agentId: LocalAgentInstallGuideId
): `${typeof LOCAL_AGENTS_GUIDE_PATH}/${LocalAgentInstallGuideId}` {
	return `${LOCAL_AGENTS_GUIDE_PATH}/${agentId}`;
}

function isLocalAgentInstallGuideId(
	agentId: string
): agentId is LocalAgentInstallGuideId {
	return Object.hasOwn(LOCAL_AGENT_INSTALL_GUIDES, agentId);
}
