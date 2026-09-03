import type { AgentProfileOperationalContextInput } from "@openmeld/agent-profile";
import {
	buildOrganizationComputersPath,
	buildOrganizationDirectMessagesPath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";

export type AgentProfileActivityDestination = {
	computerName?: string;
	conversationId?: string;
	href: string;
	source: "computer" | "direct_message" | "space";
	title: string;
};

export type AgentProfileActivityNavigation = {
	current: AgentProfileActivityDestination | null;
	queued: readonly AgentProfileActivityDestination[];
};

export type AgentProfileActivityPreview = {
	navigation: AgentProfileActivityNavigation;
	operationalContext: AgentProfileOperationalContextInput;
};

const PREVIEW_CONTEXTS = [
	{
		match: "ready agent",
		navigation: { current: null, queued: [] },
		operationalContext: {
			currentWorkLocation: null,
			queuedWorkLocations: [],
			recoveryAction: null,
			status: "idle",
			waitingCount: 0,
		},
	},
	{
		match: "working agent",
		navigation: {
			current: { source: "space", title: "Product launch" },
			queued: [],
		},
		operationalContext: {
			currentWorkLocation: "Product launch",
			queuedWorkLocations: [],
			recoveryAction: null,
			status: "working",
			waitingCount: 0,
		},
	},
	{
		match: "queued agent",
		navigation: {
			current: { source: "space", title: "Customer support" },
			queued: [
				{ source: "space", title: "Launch planning" },
				{ source: "direct_message", title: "Bug triage" },
				{ source: "computer", title: "Sales follow-up" },
			],
		},
		operationalContext: {
			currentWorkLocation: "Customer support",
			queuedWorkLocations: ["Launch planning", "Bug triage", "Sales follow-up"],
			recoveryAction: null,
			status: "working",
			waitingCount: 3,
		},
	},
	{
		match: "waiting agent",
		navigation: {
			current: { source: "computer", title: "Research" },
			queued: [
				{ source: "space", title: "Product review" },
				{ source: "direct_message", title: "Competitor notes" },
			],
		},
		operationalContext: {
			currentWorkLocation: "Research",
			queuedWorkLocations: ["Product review", "Competitor notes"],
			recoveryAction: null,
			status: "paused",
			waitingCount: 2,
		},
	},
	{
		match: "attention agent",
		navigation: {
			current: { source: "space", title: "Release room" },
			queued: [{ source: "computer", title: "Post-release checks" }],
		},
		operationalContext: {
			currentWorkLocation: "Release room",
			queuedWorkLocations: ["Post-release checks"],
			recoveryAction: { kind: "skip_interrupted_work" },
			status: "paused",
			waitingCount: 1,
		},
	},
	{
		match: "checking agent",
		navigation: { current: null, queued: [] },
		operationalContext: {
			currentWorkLocation: null,
			queuedWorkLocations: [],
			recoveryAction: null,
			status: "checking",
			waitingCount: 0,
		},
	},
] as const satisfies readonly {
	match: string;
	navigation: {
		current: Omit<AgentProfileActivityDestination, "href"> | null;
		queued: readonly Omit<AgentProfileActivityDestination, "href">[];
	};
	operationalContext: AgentProfileOperationalContextInput;
}[];

export function resolveAgentProfileActivityPreview(
	profileName: string,
	orgSlug: string
): AgentProfileActivityPreview | null {
	const normalizedName = profileName.trim().toLocaleLowerCase("en-US");
	const fixture = PREVIEW_CONTEXTS.find((candidate) =>
		normalizedName.includes(candidate.match)
	);
	if (!fixture) {
		return null;
	}
	return {
		navigation: {
			current: fixture.navigation.current
				? withPreviewHref(fixture.navigation.current, orgSlug)
				: null,
			queued: fixture.navigation.queued.map((destination) =>
				withPreviewHref(destination, orgSlug)
			),
		},
		operationalContext: fixture.operationalContext,
	};
}

function withPreviewHref(
	destination: Omit<AgentProfileActivityDestination, "href">,
	orgSlug: string
): AgentProfileActivityDestination {
	let href = buildOrganizationComputersPath(orgSlug);
	if (destination.source === "space") {
		href = buildOrganizationSpacesPath(orgSlug);
	} else if (destination.source === "direct_message") {
		href = buildOrganizationDirectMessagesPath(orgSlug);
	}
	return { ...destination, href };
}
