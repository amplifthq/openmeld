const KNOWN_CLIENT_LABELS: Readonly<Record<string, string>> = {
	codex: "Codex",
	"claude-code": "Claude Code",
	"openmeld-cli": "OpenMeld CLI",
};

export function formatCenterAgentInteractionClient(client: string): string {
	return KNOWN_CLIENT_LABELS[client] ?? client;
}
