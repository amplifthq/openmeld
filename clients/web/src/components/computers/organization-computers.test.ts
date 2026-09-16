import type {
	LocalRuntimeComputer,
	OrganizationComputersResponse,
	OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveOrganizationComputerGroups } from "./organization-computers";

function buildDirectory(): OrganizationDirectoryResponse {
	return {
		organizationId: "org-1",
		generatedAt: "2026-08-08T00:00:00.000Z",
		members: [
			{
				userId: "user-felix",
				user: { name: "Felix" },
			},
			{
				userId: "user-ashley",
				user: { name: "Ashley" },
			},
			{
				userId: "user-sam",
				user: { name: "Sam" },
			},
		],
		agentProfiles: [
			{
				managedRole: null,
				ownerUserId: "user-felix",
				profileId: "agent-felix",
				profileName: "Builder",
				readiness: {
					routeDeviceId: "device-current",
					runtimeDeviceDisplayName: "Felix's MacBook Pro",
				},
				status: "active",
			},
			{
				managedRole: null,
				ownerUserId: "user-ashley",
				profileId: "agent-scout",
				profileName: "Scout",
				readiness: {
					routeDeviceId: "device-ashley",
					runtimeDeviceDisplayName: "MacBook Pro",
				},
				status: "active",
			},
			{
				managedRole: null,
				ownerUserId: "user-ashley",
				profileId: "agent-researcher",
				profileName: "Researcher",
				readiness: {
					routeDeviceId: "device-ashley",
					runtimeDeviceDisplayName: "MacBook Pro",
				},
				status: "active",
			},
			{
				managedRole: null,
				ownerUserId: "user-sam",
				profileId: "agent-sam",
				profileName: "Reviewer",
				readiness: {
					routeDeviceId: "device-sam",
					runtimeDeviceDisplayName: "MacBook Pro",
				},
				status: "active",
			},
			{
				managedRole: "center_agent",
				ownerUserId: "user-ashley",
				profileId: "agent-center",
				profileName: "Center Agent",
				readiness: {
					routeDeviceId: "device-private",
					runtimeDeviceDisplayName: "Private Mac mini",
				},
				status: "active",
			},
		],
	} as unknown as OrganizationDirectoryResponse;
}

describe("resolveOrganizationComputerGroups", () => {
	it("keeps personal inventory authoritative and groups organization-visible computers by owner", () => {
		const ownedComputers = [
			{
				deviceDisplayName: "Felix's MacBook Pro",
				deviceId: "device-current",
			},
			{
				deviceDisplayName: "Office Mac mini",
				deviceId: "device-office",
			},
		] as LocalRuntimeComputer[];

		const groups = resolveOrganizationComputerGroups({
			currentUserId: "user-felix",
			directory: buildDirectory(),
			ownedComputers,
		});

		expect(groups.map((group) => group.ownerLabel)).toEqual([
			"Felix",
			"Ashley",
			"Sam",
		]);
		expect(groups[0]?.computers.map((computer) => computer.deviceId)).toEqual([
			"device-current",
			"device-office",
		]);
		expect(groups[0]?.computers[1]?.agents).toEqual([]);
		expect(groups[1]?.computers).toEqual([
			expect.objectContaining({
				agents: [
					{ profileId: "agent-researcher", profileName: "Researcher" },
					{ profileId: "agent-scout", profileName: "Scout" },
				],
				deviceDisplayName: "MacBook Pro",
				deviceId: "device-ashley",
				isOwnedByCurrentUser: false,
				routeId: "agent:agent-researcher",
			}),
		]);
		expect(groups[2]?.computers[0]?.deviceDisplayName).toBe("MacBook Pro");
		expect(
			groups
				.flatMap((group) => group.computers)
				.map((computer) => computer.deviceId)
		).not.toContain("device-private");
	});

	it("shows a teammate computer reported by OpenMeld Service before they create an Agent Profile", () => {
		const directory = {
			...buildDirectory(),
			agentProfiles: [],
		} as unknown as OrganizationDirectoryResponse;
		const organizationComputers = {
			computers: [
				{
					computerId: "device-ashley-service",
					deviceDisplayName: "Ashley's MacBook Pro",
					deviceType: "laptop",
					lastSeenAtMs: 1_786_980_000_000,
					localAgents: [],
					osVersion: "25.5.0",
					ownerUserId: "user-ashley",
					platformFamily: "macOS",
					serviceState: "connected",
				},
			],
			generatedAt: "2026-08-18T00:00:00.000Z",
			organizationId: "org-1",
		} satisfies OrganizationComputersResponse;

		const groups = resolveOrganizationComputerGroups({
			currentUserId: "user-felix",
			directory,
			organizationComputers,
			ownedComputers: [],
		});

		expect(
			groups.find((group) => group.ownerUserId === "user-ashley")
		).toMatchObject({
			computers: [
				expect.objectContaining({
					deviceDisplayName: "Ashley's MacBook Pro",
					deviceId: "device-ashley-service",
					routeId: "computer:user-ashley:device-ashley-service",
					isOwnedByCurrentUser: false,
				}),
			],
		});
	});

	it("keeps registration identity separate from current Service liveness", () => {
		const ownedComputers = [
			{
				connectedComputerId: "computer-felix",
				connectionStatus: "connected",
				deviceDisplayName: "Felix's MacBook Pro",
				deviceId: "device-current",
				executionTargets: [],
				isCurrent: true,
			},
		] as unknown as LocalRuntimeComputer[];
		const organizationComputers = {
			computers: [
				{
					computerId: "computer-felix",
					deviceDisplayName: "Felix's MacBook Pro",
					deviceType: "laptop",
					lastSeenAtMs: 1_786_980_000_000,
					localAgents: [],
					osVersion: "25.5.0",
					ownerUserId: "user-felix",
					platformFamily: "macOS",
					serviceState: "connected",
				},
			],
			generatedAt: "2026-08-18T00:00:00.000Z",
			organizationId: "org-1",
		} satisfies OrganizationComputersResponse;

		const [currentUserGroup] = resolveOrganizationComputerGroups({
			currentComputerServiceState: {
				deviceId: "device-current",
				state: "not_connected",
			},
			currentUserId: "user-felix",
			directory: buildDirectory(),
			organizationComputers,
			ownedComputers,
		});

		expect(currentUserGroup?.computers[0]).toMatchObject({
			deviceId: "device-current",
			serviceState: "not_connected",
		});
	});
});
