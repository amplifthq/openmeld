export const LOCAL_AGENTS_GUIDE_PATH = "/guides/local-agents";

export type LocalAgentInstallGuideId =
	| "claude-code"
	| "codex"
	| "cursor"
	| "opencode";

export type LocalAgentInstallGuide = {
	agentId: LocalAgentInstallGuideId;
	displayName: string;
	installSteps: readonly string[];
	officialDocsUrl?: string;
	officialInstallUrl: string;
	postInstallNote: string;
	summary: string;
	verifyCommand: string;
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
		displayName: "Codex CLI",
		installSteps: [
			"Install Codex CLI with the official installer: curl -fsSL https://chatgpt.com/codex/install.sh | sh",
			"Open a project folder in Terminal and run codex.",
			"Complete the first-run sign-in prompt with your ChatGPT account or API key.",
		],
		officialDocsUrl: "https://developers.openai.com/codex/cli",
		officialInstallUrl: "https://developers.openai.com/codex/cli",
		postInstallNote:
			"OpenMeld verifies Codex by finding a launchable codex executable and checking codex --version. A bundled Codex desktop app binary can also work. Run Codex once and finish sign-in before you check again.",
		summary: "OpenAI's terminal coding agent for local coding workflows.",
		verifyCommand: "codex --version",
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

export const LOCAL_AGENT_INSTALL_GUIDE_IDS = [
	"codex",
	"claude-code",
	"cursor",
	"opencode",
] as const satisfies readonly LocalAgentInstallGuideId[];

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
