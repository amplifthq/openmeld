import type {
	LocalRuntimeComputer,
	OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";

export type OrganizationComputerAgent = {
	profileId: string;
	profileName: string;
};

export type OrganizationComputer = {
	agents: OrganizationComputerAgent[];
	deviceDisplayName: string;
	deviceId: string;
	isOwnedByCurrentUser: boolean;
	ownedComputer: LocalRuntimeComputer | null;
	ownerLabel: string;
	ownerUserId: string;
	routeId: string;
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

export function formatComputerCount(count: number): string {
	return count === 1 ? "1 Computer" : `${count} Computers`;
}

export function formatAgentCount(count: number): string {
	return count === 1 ? "1 Agent" : `${count} Agents`;
}

export function resolveOrganizationComputerGroups(input: {
	currentUserId: string;
	directory: OrganizationDirectoryResponse | null;
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
			deviceId: computer.deviceId,
			isOwnedByCurrentUser: true,
			ownedComputer: computer,
			ownerLabel: input.ownerLabel,
			ownerUserId: input.currentUserId,
			routeId: computer.deviceId,
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
	return directory.members.flatMap((member) => {
		if (member.userId === input.currentUserId) {
			return [];
		}
		const computers = resolveMemberComputers({
			ownerLabel: member.user.name,
			ownerUserId: member.userId,
			profiles: profilesByOwnerUserId.get(member.userId) ?? [],
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
			deviceId,
			isOwnedByCurrentUser: false,
			ownedComputer: null,
			ownerLabel: input.ownerLabel,
			ownerUserId: input.ownerUserId,
			routeId: buildOrganizationComputerRouteId([agent]),
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
