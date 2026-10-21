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
	decision: null,
	grant: null,
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

	const allowedOnce = (overrides: Partial<AgentAccessRequestView> = {}) =>
		request({
			status: "allowed",
			decision: "allow_once",
			grant: { status: "active", revokedAt: null },
			decidedAt: "2026-10-20T10:05:00.000Z",
			...overrides,
		});
	const alwaysAllowed = (overrides: Partial<AgentAccessRequestView> = {}) =>
		allowedOnce({ decision: "always_allow", ...overrides });
	const revokedGrant = {
		status: "revoked",
		revokedAt: "2026-10-20T10:30:00.000Z",
	} as const;

	it("is approved_once in the request's own Direct Message only", () => {
		expect(resolve({ requests: [allowedOnce()] })).toBe("approved_once");
		expect(resolve({ requests: [allowedOnce()], spaceId: "dm_1" })).toBe(
			"approved_once"
		);
		// A new Direct Message asks again.
		expect(resolve({ requests: [allowedOnce()], spaceId: "dm_2" })).toBe(
			"draft"
		);
	});

	it("is always_allowed from an Always allow request whose grant is active", () => {
		expect(resolve({ requests: [alwaysAllowed()] })).toBe("always_allowed");
	});

	it("is revoked when the owner took back an Always allow grant", () => {
		const requests = [alwaysAllowed({ grant: revokedGrant })];
		expect(resolve({ requests })).toBe("revoked");
		expect(resolve({ requests, spaceId: "dm_1" })).toBe("revoked");
		// Another Direct Message never had that answer.
		expect(resolve({ requests, spaceId: "dm_2" })).toBe("draft");
	});

	it("is revoked when the owner took back a one-chat grant in its chat", () => {
		expect(resolve({ requests: [allowedOnce({ grant: revokedGrant })] })).toBe(
			"revoked"
		);
	});

	it("is revoked in the original chat after an upgrade to always and its removal", () => {
		// Upgrading retired the one-chat grant; the standing grant decides.
		const upgraded = allowedOnce({ grant: revokedGrant });
		expect(
			resolve({
				standingGrantProfileIds: ["agt_codex"],
				requests: [upgraded],
				spaceId: "dm_1",
			})
		).toBe("always_allowed");
		// The owner removed the standing grant.
		expect(resolve({ requests: [upgraded], spaceId: "dm_1" })).toBe("revoked");
		expect(resolve({ requests: [upgraded] })).toBe("revoked");
	});

	it("never reads an allowed request without its grant as access", () => {
		expect(resolve({ requests: [alwaysAllowed({ grant: null })] })).toBe(
			"revoked"
		);
	});

	it("leaves revoked for waiting once the viewer asks again", () => {
		expect(
			resolve({
				requests: [
					alwaysAllowed({ id: "old", grant: revokedGrant }),
					request({ id: "new", createdAt: "2026-10-20T11:00:00.000Z" }),
				],
			})
		).toBe("waiting");
	});

	it("follows the owner's answer to the new request after a revoke", () => {
		const old = alwaysAllowed({ id: "old", grant: revokedGrant });
		const later = { id: "new", createdAt: "2026-10-20T11:00:00.000Z" };
		expect(resolve({ requests: [old, allowedOnce(later)] })).toBe(
			"approved_once"
		);
		expect(resolve({ requests: [old, alwaysAllowed(later)] })).toBe(
			"always_allowed"
		);
		expect(
			resolve({
				requests: [
					old,
					request({ ...later, status: "declined", decision: "decline" }),
				],
			})
		).toBe("declined");
	});

	it("is always_allowed with a standing grant even after an older revoke", () => {
		expect(
			resolve({
				standingGrantProfileIds: ["agt_codex"],
				requests: [alwaysAllowed({ grant: revokedGrant })],
			})
		).toBe("always_allowed");
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
			allowedOnce({
				id: "other",
				agentProfileId: "agt_other",
				createdAt: "2026-10-20T12:00:00.000Z",
			}),
			allowedOnce({
				id: "owner",
				viewerRole: "owner",
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
