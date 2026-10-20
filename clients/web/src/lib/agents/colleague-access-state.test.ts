import type { AgentAccessRequestView } from "@openmeld/schemas";
import type { OrganizationProfileDirectoryResponse } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	resolveAgentOwnerName,
	resolveColleagueAccessState,
} from "./colleague-access-state";

const request = (
	overrides: Partial<AgentAccessRequestView> = {}
): AgentAccessRequestView => ({
	id: "req_1",
	kind: "direct_message",
	status: "pending",
	spaceId: "dm_1",
	sourceSignalId: "sig_1",
	agentProfileId: "agt_codex",
	agentProfileName: "Codex",
	ownerUserId: "tali",
	ownerName: "Tali Smoke",
	requesterProfileId: "hp_felix",
	requesterName: "Felix Smoke",
	requesterKind: "member",
	createdAt: "2026-10-20T10:00:00.000Z",
	decidedAt: null,
	viewerRole: "requester",
	availableDecisions: [],
	...overrides,
});

function resolve(
	input: Partial<Parameters<typeof resolveColleagueAccessState>[0]> = {}
) {
	return resolveColleagueAccessState({
		viewerUserId: "felix",
		ownerUserId: "tali",
		profileId: "agt_codex",
		standingGrantProfileIds: [],
		requests: [],
		...input,
	}).state;
}

describe("resolveColleagueAccessState", () => {
	it("is not_required for the viewer's own Agent and an Agent no person owns", () => {
		expect(resolve({ ownerUserId: "felix" })).toBe("not_required");
		expect(resolve({ ownerUserId: null })).toBe("not_required");
	});

	it("is none without a Direct Message and draft with one", () => {
		expect(resolve({ directMessageCount: 0 })).toBe("none");
		expect(resolve({ directMessageCount: 1 })).toBe("draft");
		expect(resolve({ spaceId: "dm_1" })).toBe("draft");
	});

	it("is waiting while the latest request is pending", () => {
		expect(resolve({ requests: [request()] })).toBe("waiting");
	});

	it("is approved_once when the owner allowed a chat without a standing grant", () => {
		expect(resolve({ requests: [request({ status: "allowed" })] })).toBe(
			"approved_once"
		);
	});

	it("is always_allowed with a standing grant, whatever the requests say", () => {
		expect(
			resolve({
				standingGrantProfileIds: ["agt_codex"],
				requests: [request({ status: "declined" })],
			})
		).toBe("always_allowed");
	});

	it("is declined when the owner declined the latest request", () => {
		expect(resolve({ requests: [request({ status: "declined" })] })).toBe(
			"declined"
		);
	});

	it("goes back to draft after a withdrawn or voided request", () => {
		for (const status of ["withdrawn", "voided"] as const) {
			expect(
				resolve({ spaceId: "dm_1", requests: [request({ status })] })
			).toBe("draft");
		}
	});

	it("reads only the latest Direct Message request for this Agent and chat", () => {
		const requests = [
			request({ id: "old", status: "declined" }),
			request({
				id: "new",
				status: "pending",
				createdAt: "2026-10-20T11:00:00.000Z",
			}),
			request({
				id: "join",
				kind: "space_join",
				status: "declined",
				createdAt: "2026-10-20T12:00:00.000Z",
			}),
			request({
				id: "other",
				agentProfileId: "agt_other",
				status: "allowed",
				createdAt: "2026-10-20T12:00:00.000Z",
			}),
			request({
				id: "owner",
				viewerRole: "owner",
				status: "allowed",
				createdAt: "2026-10-20T12:00:00.000Z",
			}),
		];
		expect(resolve({ requests })).toBe("waiting");
		expect(resolve({ requests, spaceId: "dm_2" })).toBe("draft");
	});
});

describe("resolveAgentOwnerName", () => {
	const directory = {
		members: [
			{
				userId: "tali",
				user: { name: "tali@example.test" },
				humanProfile: { profileName: "Tali Smoke" },
			},
		],
		agentProfiles: [{ profileId: "agt_codex", ownerName: "Tali" }],
	} as unknown as OrganizationProfileDirectoryResponse;

	it("names the owner by their Human Profile, then account, then the Agent's owner name", () => {
		const read = (value: OrganizationProfileDirectoryResponse) =>
			resolveAgentOwnerName({
				directory: value,
				agentProfileId: "agt_codex",
				ownerUserId: "tali",
			});
		expect(read(directory)).toBe("Tali Smoke");
		expect(
			read({
				...directory,
				members: [{ userId: "tali", user: { name: "Tali" } }],
			} as unknown as OrganizationProfileDirectoryResponse)
		).toBe("Tali");
		expect(
			read({
				...directory,
				members: [],
			} as unknown as OrganizationProfileDirectoryResponse)
		).toBe("Tali");
	});
});
