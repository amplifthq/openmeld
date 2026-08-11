import type {
	LocalRuntimeComputer,
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
});
