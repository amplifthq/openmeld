import { BUILTIN_AGENT_CONTROLLER_DISPLAY_ORDER } from "@openmeld/schemas";

export const LOCAL_AGENTS_GUIDE_PATH = "/guides/local-agents";

export type LocalAgentInstallGuideId =
  | "antigravity"
  | "claude-code"
  | "codex"
  | "cursor"
  | "grok-build"
  | "opencode";

export type LocalAgentInstallGuide = {
  agentId: LocalAgentInstallGuideId;
  displayName: string;
  officialDocsUrl?: string;
  officialInstallUrl: string;
  summary: string;
};

export const LOCAL_AGENT_INSTALL_GUIDES = {
  antigravity: {
    agentId: "antigravity",
    displayName: "Antigravity",
    officialDocsUrl: "https://antigravity.google/docs/cli-install?hl=en",
    officialInstallUrl: "https://antigravity.google/docs/cli-install?hl=en",
    summary: "Google's terminal coding agent for local development work.",
  },
  "claude-code": {
    agentId: "claude-code",
    displayName: "Claude Code",
    officialDocsUrl: "https://code.claude.com/docs/en/quickstart",
    officialInstallUrl: "https://code.claude.com/docs/en/quickstart",
    summary:
      "Anthropic's terminal coding agent for working with code through Claude.",
  },
  codex: {
    agentId: "codex",
    displayName: "Codex",
    officialDocsUrl: "https://developers.openai.com/codex/cli",
    officialInstallUrl: "https://developers.openai.com/codex/cli",
    summary: "OpenAI's coding agent for local coding workflows.",
  },
  cursor: {
    agentId: "cursor",
    displayName: "Cursor CLI",
    officialDocsUrl: "https://cursor.com/docs/cli/acp",
    officialInstallUrl: "https://cursor.com/docs/cli/installation",
    summary:
      "Cursor’s command-line coding agent, connected through its structured Agent Client Protocol interface.",
  },
  "grok-build": {
    agentId: "grok-build",
    displayName: "Grok Build",
    officialDocsUrl: "https://docs.x.ai/build/overview",
    officialInstallUrl: "https://docs.x.ai/build/overview",
    summary:
      "xAI's terminal coding agent, connected through its Agent Client Protocol interface.",
  },
  opencode: {
    agentId: "opencode",
    displayName: "OpenCode",
    officialDocsUrl: "https://opencode.ai/docs/",
    officialInstallUrl: "https://opencode.ai/docs/",
    summary:
      "An open-source terminal coding agent with multiple model providers.",
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
