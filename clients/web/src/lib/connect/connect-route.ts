import {
	buildOrganizationAgentCreationPath,
	buildOrganizationConnectPath,
	buildOrganizationPeoplePath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";
import { buildHumanProfilePath } from "#/lib/profile-routes";
import { buildOpenMeldServiceSettingsPath } from "#/lib/settings-routes";

const LOGIN_CONNECT_PATH_PATTERN = /^\/o\/login\/connect/;

export type ConnectServiceAction = "update_service";
export type ConnectSession = "fresh";

export type ConnectRouteSearch = {
	agentProfileIds?: string;
	connectedComputerId?: string;
	profileId?: string;
	reset?: "this-computer";
	returnTo?: "space" | "agent_creation";
	serviceAction?: ConnectServiceAction;
	session?: ConnectSession;
	spaceId?: string;
};

export type ConnectRouteIntent =
	| {
			connectedComputerId?: string;
			kind: "account_computer_setup";
			returnTo?: "agent_creation";
			profileId?: string;
			resetThisComputer: boolean;
			serviceAction?: ConnectServiceAction;
	  }
	| {
			agentProfileIds: readonly string[];
			connectedComputerId?: string;
			kind: "space_recovery";
			profileId?: string;
			resetThisComputer: boolean;
			serviceAction?: ConnectServiceAction;
			spaceId: string;
	  };

export const DEFAULT_CONNECT_ROUTE_INTENT: ConnectRouteIntent = {
	kind: "account_computer_setup",
	resetThisComputer: false,
};

// Canonical "Connect this computer" entry point. This is the official
// Plugin Connect URL builder used by live Agents, Spaces, and profile surfaces.
export function buildConnectComputerPath(input?: {
	returnTo?: "agent_creation";
	connectedComputerId?: string;
	orgSlug?: string;
	profileId?: string;
	serviceAction?: ConnectServiceAction;
	session?: ConnectSession;
}): string;
export function buildConnectComputerPath(input: {
	agentProfileIds?: readonly string[];
	connectedComputerId?: string;
	orgSlug?: string;
	profileId?: string;
	returnTo: "space";
	serviceAction?: ConnectServiceAction;
	session?: ConnectSession;
	spaceId: string;
}): string;
export function buildConnectComputerPath(input?: {
	agentProfileIds?: readonly string[];
	connectedComputerId?: string;
	orgSlug?: string;
	profileId?: string;
	returnTo?: "space" | "agent_creation";
	serviceAction?: ConnectServiceAction;
	session?: ConnectSession;
	spaceId?: string;
}): string {
	const params = new URLSearchParams();
	if (input?.returnTo === "agent_creation") {
		params.set("returnTo", "agent_creation");
	}
	if (input?.connectedComputerId) {
		params.set("connectedComputerId", input.connectedComputerId);
	}
	if (input?.profileId) {
		params.set("profileId", input.profileId);
	}
	if (input?.returnTo === "space" && input.spaceId) {
		params.set("returnTo", "space");
		params.set("spaceId", input.spaceId);
		if (input.agentProfileIds && input.agentProfileIds.length > 0) {
			params.set("agentProfileIds", input.agentProfileIds.join(","));
		}
	}
	if (input?.session === "fresh") {
		params.set("session", "fresh");
	}
	if (input?.serviceAction === "update_service") {
		params.set("serviceAction", "update_service");
	}
	params.sort();
	return buildOrganizationConnectPath({
		orgSlug: input?.orgSlug ?? "login",
		search: Object.fromEntries(params),
	}).replace(LOGIN_CONNECT_PATH_PATTERN, "/login");
}

export function normalizeConnectRouteSearch(
	search: Record<string, unknown>
): ConnectRouteSearch {
	return {
		agentProfileIds:
			typeof search.agentProfileIds === "string" &&
			search.agentProfileIds.trim()
				? search.agentProfileIds.trim()
				: undefined,
		...(typeof search.connectedComputerId === "string" &&
		search.connectedComputerId.trim()
			? { connectedComputerId: search.connectedComputerId.trim() }
			: {}),
		profileId:
			typeof search.profileId === "string" && search.profileId.trim()
				? search.profileId.trim()
				: undefined,
		reset: search.reset === "this-computer" ? "this-computer" : undefined,
		returnTo:
			search.returnTo === "space" || search.returnTo === "agent_creation"
				? search.returnTo
				: undefined,
		serviceAction:
			search.serviceAction === "update_service" ? "update_service" : undefined,
		session: search.session === "fresh" ? "fresh" : undefined,
		spaceId:
			typeof search.spaceId === "string" && search.spaceId.trim()
				? search.spaceId.trim()
				: undefined,
	};
}

export function resolveConnectRouteIntent(
	search: ConnectRouteSearch
): ConnectRouteIntent {
	const resetThisComputer =
		search.session === "fresh" || search.reset === "this-computer";
	if (search.returnTo === "space" && search.spaceId) {
		return {
			agentProfileIds: parseAgentProfileIdList(search.agentProfileIds),
			...(search.connectedComputerId
				? { connectedComputerId: search.connectedComputerId }
				: {}),
			kind: "space_recovery",
			profileId: search.profileId,
			resetThisComputer,
			serviceAction: search.serviceAction,
			spaceId: search.spaceId,
		};
	}

	return {
		...(search.connectedComputerId
			? { connectedComputerId: search.connectedComputerId }
			: {}),
		kind: "account_computer_setup",
		...(search.returnTo === "agent_creation"
			? { returnTo: "agent_creation" as const }
			: {}),
		profileId: search.profileId,
		resetThisComputer,
		serviceAction: search.serviceAction,
	};
}

export function buildConnectRouteSearch(
	intent: ConnectRouteIntent
): ConnectRouteSearch {
	if (intent.kind === "space_recovery") {
		return {
			agentProfileIds:
				intent.agentProfileIds.length > 0
					? intent.agentProfileIds.join(",")
					: undefined,
			...(intent.connectedComputerId
				? { connectedComputerId: intent.connectedComputerId }
				: {}),
			profileId: intent.profileId,
			returnTo: "space",
			serviceAction: intent.serviceAction,
			session: intent.resetThisComputer ? "fresh" : undefined,
			spaceId: intent.spaceId,
		};
	}

	return {
		...(intent.connectedComputerId
			? { connectedComputerId: intent.connectedComputerId }
			: {}),
		profileId: intent.profileId,
		...(intent.returnTo === "agent_creation"
			? { returnTo: "agent_creation" as const }
			: {}),
		serviceAction: intent.serviceAction,
		session: intent.resetThisComputer ? "fresh" : undefined,
	};
}

export function resolveConnectBackTarget(
	intent: ConnectRouteIntent,
	orgSlug?: string
): string {
	if (
		intent.kind === "account_computer_setup" &&
		intent.returnTo === "agent_creation" &&
		orgSlug
	) {
		return buildOrganizationAgentCreationPath(orgSlug);
	}
	if (intent.kind === "space_recovery") {
		return buildSpaceRouteTarget(intent, orgSlug);
	}
	if (!orgSlug) {
		return "/login";
	}
	return intent.profileId
		? buildHumanProfilePath({ orgSlug, profileId: intent.profileId })
		: buildOrganizationPeoplePath(orgSlug);
}

export function resolveConnectCompletionTarget(
	intent: ConnectRouteIntent,
	orgSlug?: string
): string {
	if (
		intent.kind === "account_computer_setup" &&
		intent.returnTo === "agent_creation" &&
		orgSlug
	) {
		return buildOrganizationAgentCreationPath(orgSlug);
	}
	if (intent.kind === "space_recovery") {
		return buildSpaceRouteTarget(intent, orgSlug);
	}
	return buildComputersSetupCompleteRefreshTarget(orgSlug);
}

export function parseAgentProfileIdList(
	value: string | undefined
): readonly string[] {
	if (!value) {
		return [];
	}

	const seen = new Set<string>();
	for (const profileId of value.split(",")) {
		const normalized = profileId.trim();
		if (normalized) {
			seen.add(normalized);
		}
	}
	return [...seen];
}

function buildComputersSetupCompleteRefreshTarget(orgSlug?: string): string {
	return buildOpenMeldServiceSettingsPath({
		orgSlug,
		refresh: "setup-complete",
	});
}

function buildSpaceRouteTarget(
	input: { profileId?: string; spaceId: string },
	orgSlug?: string
) {
	if (!orgSlug) {
		return "/login";
	}
	return buildOrganizationSpacePath({
		orgSlug,
		search: { profileId: input.profileId },
		spaceId: input.spaceId,
	});
}
