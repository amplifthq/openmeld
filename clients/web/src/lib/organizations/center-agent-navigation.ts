export type CenterAgentSectionId =
	| "plugins"
	| "channels"
	| "chat"
	| "memory"
	| "routines"
	| "settings"
	| "skills";

const CENTER_AGENT_SECTION_PATH_PATTERN = /^\/o\/[^/]+\/center-agent\/([^/]+)/u;

export function resolveCenterAgentSectionId(
	pathname: string
): CenterAgentSectionId {
	const section = CENTER_AGENT_SECTION_PATH_PATTERN.exec(pathname)?.[1];
	switch (section) {
		case "plugins":
		case "channels":
		case "memory":
		case "routines":
		case "settings":
		case "skills":
			return section;
		default:
			return "chat";
	}
}
