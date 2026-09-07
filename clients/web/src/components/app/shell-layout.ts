export type AppShellSection =
	| "newAgent"
	| "agentActivity"
	| "agents"
	| "centerAgent"
	| "computers"
	| "connect"
	| "directMessages"
	| "documents"
	| "home"
	| "inbox"
	| "onboarding"
	| "organizations"
	| "people"
	| "projects"
	| "settings"
	| "space"
	| "start";
export type AppOuterRailDestination =
	| "newAgent"
	| "agentActivity"
	| "agents"
	| "computers"
	| "directMessages"
	| "documents"
	| "home"
	| "people"
	| "projects"
	| "settings"
	| "spaces";
type AppShellStaticDataKey = AppShellSection;

declare module "@tanstack/react-router" {
	// biome-ignore lint/style/useConsistentTypeDefinitions: TanStack Router staticData uses interface declaration merging.
	interface StaticDataRouteOption {
		appShellSection?: AppShellSection;
	}
}

export const APP_PAGE_FRAME_CLASS_NAME = "max-w-7xl";
export const APP_PAGE_FRAME_PADDING_CLASS_NAME = "px-4 sm:px-6 lg:px-8";
export const APP_SPACE_FRAME_CLASS_NAME = "max-w-[96rem]";

export const appShellStaticData = {
	newAgent: { appShellSection: "newAgent" },
	agentActivity: { appShellSection: "agentActivity" },
	agents: { appShellSection: "agents" },
	centerAgent: { appShellSection: "centerAgent" },
	computers: { appShellSection: "people" },
	connect: { appShellSection: "connect" },
	directMessages: { appShellSection: "directMessages" },
	documents: { appShellSection: "documents" },
	home: { appShellSection: "home" },
	inbox: { appShellSection: "inbox" },
	onboarding: { appShellSection: "onboarding" },
	organizations: { appShellSection: "organizations" },
	people: { appShellSection: "people" },
	projects: { appShellSection: "projects" },
	settings: { appShellSection: "settings" },
	space: { appShellSection: "space" },
	start: { appShellSection: "start" },
} as const satisfies Record<
	AppShellStaticDataKey,
	{ appShellSection: AppShellSection }
>;

export function resolveAppShellFrameClassName(
	section: AppShellSection
): string {
	return section === "space" || section === "directMessages"
		? APP_SPACE_FRAME_CLASS_NAME
		: APP_PAGE_FRAME_CLASS_NAME;
}

export function resolveAppShellSectionFromMatches(
	matches: readonly {
		staticData: {
			appShellSection?: AppShellSection;
		};
	}[]
): AppShellSection {
	for (let index = matches.length - 1; index >= 0; index -= 1) {
		const section = matches[index]?.staticData.appShellSection;
		if (section) {
			return section;
		}
	}

	throw new Error(
		"AppShell requires an active route with staticData.appShellSection."
	);
}

export function resolveAppOuterRailDestinationFromMatches(
	matches: readonly {
		staticData: {
			appShellSection?: AppShellSection;
		};
	}[]
): AppOuterRailDestination | null {
	const section = resolveAppShellSectionFromMatches(matches);

	switch (section) {
		case "newAgent":
		case "agentActivity":
		case "agents":
		case "computers":
		case "directMessages":
		case "documents":
		case "home":
		case "people":
		case "projects":
		case "settings":
			return section;
		case "centerAgent":
			return "directMessages";
		case "onboarding":
		case "organizations":
		case "inbox":
			return null;
		case "connect":
		case "space":
			return "spaces";
		default:
			throw new Error(
				`AppOuterRail cannot render for the "${section}" app shell section.`
			);
	}
}
