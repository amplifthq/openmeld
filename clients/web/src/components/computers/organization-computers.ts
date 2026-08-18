import type {
	LocalRuntimeComputer,
	OrganizationComputerRecord,
	OrganizationComputersResponse,
	OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";

export type OrganizationComputerAgent = {
	profileId: string;
	profileName: string;
};

export type OrganizationComputer = {
	agents: OrganizationComputerAgent[];
	deviceDisplayName: string;
	deviceType: OrganizationComputerRecord["deviceType"];
	deviceId: string;
	isOwnedByCurrentUser: boolean;
	lastSeenAtMs: number | null;
	localAgents: OrganizationComputerRecord["localAgents"];
	osVersion: string | null;
	ownedComputer: LocalRuntimeComputer | null;
	ownerLabel: string;
	ownerUserId: string;
	platformFamily: OrganizationComputerRecord["platformFamily"];
	routeId: string;
	serviceState: OrganizationComputerRecord["serviceState"] | null;
};

export type OrganizationComputerGroup = {
	computers: OrganizationComputer[];
	isCurrentUser: boolean;
	ownerLabel: string;
	ownerUserId: string;
};

type DirectoryAgentProfile =
	OrganizationDirectoryResponse["agentProfiles"][number];
type VisibleOrganizationComputerProfile = DirectoryAgentProfile & {
	readiness: DirectoryAgentProfile["readiness"] & {
		routeDeviceId: string;
		runtimeDeviceDisplayName: string;
	};
};

const COMPUTER_LAST_SEEN_FORMATTER = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeStyle: "short",
});

export function formatComputerCount(count: number): string {
	return count === 1 ? "1 Computer" : `${count} Computers`;
}

export function formatAgentCount(count: number): string {
	return count === 1 ? "1 Agent" : `${count} Agents`;
}

export function formatOrganizationComputerLastSeen(
	lastSeenAtMs: number | null
): string {
	if (lastSeenAtMs === null) {
		return "Last seen unknown";
	}
	return `Last seen ${COMPUTER_LAST_SEEN_FORMATTER.format(new Date(lastSeenAtMs))}`;
}

export function formatOrganizationComputerPlatform(
	computer: OrganizationComputer
): string {
	const deviceType =
		computer.deviceType === "unknown"
			? null
			: `${computer.deviceType.slice(0, 1).toUpperCase()}${computer.deviceType.slice(1)}`;
	const operatingSystem =
		computer.platformFamily === "Unknown"
			? null
			: [computer.platformFamily, computer.osVersion].filter(Boolean).join(" ");
	return [deviceType, operatingSystem, `Owned by ${computer.ownerLabel}`]
		.filter(Boolean)
		.join(" · ");
}

export function resolveOrganizationComputerGroups(input: {
	currentUserId: string;
	directory: OrganizationDirectoryResponse | null;
	organizationComputers?: OrganizationComputersResponse | null;
	ownedComputers: readonly LocalRuntimeComputer[];
}): OrganizationComputerGroup[] {
	const memberNameByUserId = new Map(
		(input.directory?.members ?? []).map((member) => [
			member.userId,
			member.user.name,
		])
	);
	const currentUserLabel =
		memberNameByUserId.get(input.currentUserId)?.trim() || "Your computers";
	return [
		resolveOwnedComputerGroup({
			currentUserId: input.currentUserId,
			directory: input.directory,
			ownedComputers: input.ownedComputers,
			ownerLabel: currentUserLabel,
		}),
		...resolveOtherMemberComputerGroups({
			currentUserId: input.currentUserId,
			directory: input.directory,
			memberNameByUserId,
			organizationComputers: input.organizationComputers ?? null,
		}),
	];
}

function resolveOwnedComputerGroup(input: {
	currentUserId: string;
	directory: OrganizationDirectoryResponse | null;
	ownedComputers: readonly LocalRuntimeComputer[];
	ownerLabel: string;
}): OrganizationComputerGroup {
	const ownedDeviceIds = new Set(
		input.ownedComputers.map((computer) => computer.deviceId)
	);
	const agentsByDeviceId = new Map<string, OrganizationComputerAgent[]>();
	for (const profile of input.directory?.agentProfiles ?? []) {
		if (
			isVisibleOrganizationComputerProfile(profile) &&
			profile.ownerUserId === input.currentUserId &&
			ownedDeviceIds.has(profile.readiness.routeDeviceId)
		) {
			appendComputerAgent(agentsByDeviceId, profile.readiness.routeDeviceId, {
				profileId: profile.profileId,
				profileName: profile.profileName,
			});
		}
	}
	return {
		computers: input.ownedComputers.map((computer) => ({
			agents: sortComputerAgents(agentsByDeviceId.get(computer.deviceId) ?? []),
			deviceDisplayName: computer.deviceDisplayName,
			deviceType: computer.deviceType,
			deviceId: computer.deviceId,
			isOwnedByCurrentUser: true,
			lastSeenAtMs: computer.lastObservedAtMs,
			localAgents: [],
			osVersion: computer.osVersion,
			ownedComputer: computer,
			ownerLabel: input.ownerLabel,
			ownerUserId: input.currentUserId,
			platformFamily: computer.platformFamily,
			routeId: computer.deviceId,
			serviceState: null,
		})),
		isCurrentUser: true,
		ownerLabel: input.ownerLabel,
		ownerUserId: input.currentUserId,
	};
}

function resolveOtherMemberComputerGroups(input: {
	currentUserId: string;
	directory: OrganizationDirectoryResponse | null;
	memberNameByUserId: ReadonlyMap<string, string>;
	organizationComputers: OrganizationComputersResponse | null;
}): OrganizationComputerGroup[] {
	const directory = input.directory;
	if (!directory) {
		return [];
	}
	const profilesByOwnerUserId = groupVisibleProfilesByOwner({
		currentUserId: input.currentUserId,
		directory,
		memberNameByUserId: input.memberNameByUserId,
	});
	const computersByOwnerUserId = groupOrganizationComputersByOwner({
		currentUserId: input.currentUserId,
		organizationComputers: input.organizationComputers,
	});
	return directory.members.flatMap((member) => {
		if (member.userId === input.currentUserId) {
			return [];
		}
		const profiles = profilesByOwnerUserId.get(member.userId) ?? [];
		const reportedComputers = computersByOwnerUserId.get(member.userId);
		const computers = reportedComputers
			? resolveReportedMemberComputers({
					computers: reportedComputers,
					ownerLabel: member.user.name,
					ownerUserId: member.userId,
					profiles,
				})
			: resolveMemberComputers({
					ownerLabel: member.user.name,
					ownerUserId: member.userId,
					profiles,
				});
		return computers.length === 0
			? []
			: [
					{
						computers,
						isCurrentUser: false,
						ownerLabel: member.user.name,
						ownerUserId: member.userId,
					},
				];
	});
}

function groupOrganizationComputersByOwner(input: {
	currentUserId: string;
	organizationComputers: OrganizationComputersResponse | null;
}): ReadonlyMap<string, OrganizationComputerRecord[]> {
	const computersByOwner = new Map<string, OrganizationComputerRecord[]>();
	for (const computer of input.organizationComputers?.computers ?? []) {
		if (computer.ownerUserId === input.currentUserId) {
			continue;
		}
		const computers = computersByOwner.get(computer.ownerUserId) ?? [];
		computers.push(computer);
		computersByOwner.set(computer.ownerUserId, computers);
	}
	return computersByOwner;
}

function resolveReportedMemberComputers(input: {
	computers: readonly OrganizationComputerRecord[];
	ownerLabel: string;
	ownerUserId: string;
	profiles: readonly VisibleOrganizationComputerProfile[];
}): OrganizationComputer[] {
	const agentsByDeviceId = new Map<string, OrganizationComputerAgent[]>();
	for (const profile of input.profiles) {
		appendComputerAgent(agentsByDeviceId, profile.readiness.routeDeviceId, {
			profileId: profile.profileId,
			profileName: profile.profileName,
		});
	}
	return input.computers.map((computer) => ({
		agents: sortComputerAgents(agentsByDeviceId.get(computer.computerId) ?? []),
		deviceDisplayName: computer.deviceDisplayName,
		deviceId: computer.computerId,
		deviceType: computer.deviceType,
		isOwnedByCurrentUser: false,
		lastSeenAtMs: computer.lastSeenAtMs,
		localAgents: computer.localAgents,
		osVersion: computer.osVersion,
		ownedComputer: null,
		ownerLabel: input.ownerLabel,
		ownerUserId: input.ownerUserId,
		platformFamily: computer.platformFamily,
		routeId: `computer:${computer.computerId}`,
		serviceState: computer.serviceState,
	}));
}

function groupVisibleProfilesByOwner(input: {
	currentUserId: string;
	directory: OrganizationDirectoryResponse;
	memberNameByUserId: ReadonlyMap<string, string>;
}) {
	const profilesByOwnerUserId = new Map<
		string,
		VisibleOrganizationComputerProfile[]
	>();
	for (const profile of input.directory.agentProfiles) {
		if (
			profile.ownerUserId === input.currentUserId ||
			!input.memberNameByUserId.has(profile.ownerUserId) ||
			!isVisibleOrganizationComputerProfile(profile)
		) {
			continue;
		}
		const profiles = profilesByOwnerUserId.get(profile.ownerUserId) ?? [];
		profiles.push(profile);
		profilesByOwnerUserId.set(profile.ownerUserId, profiles);
	}
	return profilesByOwnerUserId;
}

function resolveMemberComputers(input: {
	ownerLabel: string;
	ownerUserId: string;
	profiles: readonly VisibleOrganizationComputerProfile[];
}): OrganizationComputer[] {
	const computersByDeviceId = new Map<string, OrganizationComputer>();
	for (const profile of input.profiles) {
		const deviceId = profile.readiness.routeDeviceId;
		const existing = computersByDeviceId.get(deviceId);
		const agent = {
			profileId: profile.profileId,
			profileName: profile.profileName,
		};
		if (existing) {
			existing.agents.push(agent);
			continue;
		}
		computersByDeviceId.set(deviceId, {
			agents: [agent],
			deviceDisplayName: profile.readiness.runtimeDeviceDisplayName,
			deviceType: "unknown",
			deviceId,
			isOwnedByCurrentUser: false,
			lastSeenAtMs: null,
			localAgents: [],
			osVersion: null,
			ownedComputer: null,
			ownerLabel: input.ownerLabel,
			ownerUserId: input.ownerUserId,
			platformFamily: "Unknown",
			routeId: buildOrganizationComputerRouteId([agent]),
			serviceState: null,
		});
	}
	return [...computersByDeviceId.values()].map((computer) => ({
		...computer,
		agents: sortComputerAgents(computer.agents),
		routeId: buildOrganizationComputerRouteId(computer.agents),
	}));
}

function buildOrganizationComputerRouteId(
	agents: readonly OrganizationComputerAgent[]
): string {
	const profileId = [...agents]
		.map((agent) => agent.profileId)
		.sort((left, right) => left.localeCompare(right))[0];
	if (!profileId) {
		throw new Error("Organization computers require a visible Agent Profile.");
	}
	return `agent:${profileId}`;
}

function isVisibleOrganizationComputerProfile(
	profile: DirectoryAgentProfile
): profile is VisibleOrganizationComputerProfile {
	return Boolean(
		profile.status === "active" &&
			profile.managedRole !== "center_agent" &&
			profile.readiness.routeDeviceId?.trim() &&
			profile.readiness.runtimeDeviceDisplayName?.trim()
	);
}

function appendComputerAgent(
	agentsByDeviceId: Map<string, OrganizationComputerAgent[]>,
	deviceId: string,
	agent: OrganizationComputerAgent
) {
	const agents = agentsByDeviceId.get(deviceId) ?? [];
	agents.push(agent);
	agentsByDeviceId.set(deviceId, agents);
}

function sortComputerAgents(
	agents: readonly OrganizationComputerAgent[]
): OrganizationComputerAgent[] {
	return [...agents].sort(
		(left, right) =>
			left.profileName.localeCompare(right.profileName, undefined, {
				sensitivity: "base",
			}) || left.profileId.localeCompare(right.profileId)
	);
}
