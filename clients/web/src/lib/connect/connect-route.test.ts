import { describe, expect, it } from "vitest";
import {
	buildConnectComputerPath,
	parseAgentProfileIdList,
	resolveConnectBackTarget,
	resolveConnectCompletionTarget,
} from "./connect-route";

describe("buildConnectComputerPath", () => {
	it("fails closed to sign-in when no organization scope is available", () => {
		expect(buildConnectComputerPath()).toBe("/login");
		expect(buildConnectComputerPath({ session: "fresh" })).toBe(
			"/login?session=fresh"
		);
	});

	it("builds the organization Plugin Connect path", () => {
		expect(buildConnectComputerPath({ orgSlug: "acme" })).toBe(
			"/o/acme/connect"
		);
	});

	it("uses session=fresh for new Plugin Connect setup sessions", () => {
		expect(
			buildConnectComputerPath({
				orgSlug: "acme",
				profileId: "human-1",
				session: "fresh",
			})
		).toBe("/o/acme/connect?profileId=human-1&session=fresh");
	});

	it("keeps the selected computer identity on reconnect", () => {
		expect(
			buildConnectComputerPath({
				connectedComputerId: "computer-existing",
				orgSlug: "acme",
				session: "fresh",
			})
		).toBe(
			"/o/acme/connect?connectedComputerId=computer-existing&session=fresh"
		);
	});

	it("preserves the OpenMeld Service update intent with a fresh session", () => {
		expect(
			buildConnectComputerPath({
				orgSlug: "acme",
				serviceAction: "update_service",
				session: "fresh",
			})
		).toBe("/o/acme/connect?serviceAction=update_service&session=fresh");
	});

	it("keeps Space recovery context with a fresh session", () => {
		expect(
			buildConnectComputerPath({
				agentProfileIds: ["agt_2", "agt_1"],
				orgSlug: "acme",
				profileId: "human-1",
				returnTo: "space",
				session: "fresh",
				spaceId: "space-123",
			})
		).toBe(
			"/o/acme/connect?agentProfileIds=agt_2%2Cagt_1&profileId=human-1&returnTo=space&session=fresh&spaceId=space-123"
		);
	});
});

describe("parseAgentProfileIdList", () => {
	it("deduplicates and trims profile ids", () => {
		expect(parseAgentProfileIdList(" agt_1,agt_2,agt_1,, ")).toEqual([
			"agt_1",
			"agt_2",
		]);
	});
});

describe("connect route targets", () => {
	it("returns account computer setup to the selected Human Profile", () => {
		const intent = {
			kind: "account_computer_setup",
			profileId: "human-1",
			resetThisComputer: false,
		} as const;

		expect(resolveConnectBackTarget(intent, "acme")).toBe(
			"/o/acme/people?profileId=human-1"
		);
		expect(resolveConnectCompletionTarget(intent, "acme")).toBe(
			"/o/acme/computers?focus=service&refresh=setup-complete"
		);
	});

	it("returns Space recovery to the originating Space", () => {
		const intent = {
			agentProfileIds: ["agt_1"],
			kind: "space_recovery",
			profileId: "human-1",
			resetThisComputer: false,
			spaceId: "space-123",
		} as const;

		expect(resolveConnectBackTarget(intent, "acme")).toBe(
			"/o/acme/spaces/space-123?profileId=human-1"
		);
		expect(resolveConnectCompletionTarget(intent, "acme")).toBe(
			"/o/acme/spaces/space-123?profileId=human-1"
		);
	});
});
