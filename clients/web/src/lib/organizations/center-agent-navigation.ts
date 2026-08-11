export type CenterAgentSectionId =
	| "apps"
	| "channels"
	| "chat"
	| "memory"
	| "routines"
	| "settings"
	| "skills"
	| "tasks";

const CENTER_AGENT_SECTION_PATH_PATTERN = /^\/o\/[^/]+\/center-agent\/([^/]+)/u;

export function resolveCenterAgentSectionId(
	pathname: string
): CenterAgentSectionId {
	const section = CENTER_AGENT_SECTION_PATH_PATTERN.exec(pathname)?.[1];
	switch (section) {
		case "apps":
		case "channels":
		case "memory":
		case "routines":
		case "settings":
		case "skills":
		case "tasks":
			return section;
		default:
			return "chat";
	}
}
