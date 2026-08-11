import { describe, expect, it, vi } from "vitest";
import {
	deleteStartAgentProfileFromAuth,
	deleteStartAgentProfileFromRequest,
} from "./delete-agent-profile.server";

function createDeletedAgentProfilePayload() {
	return {
		ok: true,
		profile: {
			openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
			profileName: "Codex",
			profileHandle: "codex",
			profileKind: "agent",
			isDefault: false,
			status: "active",
			ownerUserId: "user-123",
			source: "manual",
			createdByUserId: "user-123",
			creatorProfileId: "11111111-1111-4111-8111-111111111111",
			lastUsedAt: null,
			createdAt: "2026-04-14T07:00:00.000Z",
			updatedAt: "2026-04-14T08:00:00.000Z",
		},
	};
}

describe("delete agent profile for start", () => {
	it("deletes an agent profile through auth with the request cookie", async () => {
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			expect(String(input)).toBe(
				"https://auth.openmeld.test/v1/profiles/agt_33333333-3333-4333-8333-333333333333"
			);
			expect(init?.method).toBe("DELETE");
			expect(init?.headers).toBeInstanceOf(Headers);
			const headers = init?.headers as Headers | undefined;
			expect(headers?.get("cookie")).toBe("session=abc");

			return Promise.resolve(
				new Response(JSON.stringify(createDeletedAgentProfilePayload()), {
					status: 200,
					headers: {
						"content-type": "application/json",
					},
				})
			);
		});

		await expect(
			deleteStartAgentProfileFromAuth({
				requestHeaders: new Headers({
					cookie: "session=abc",
				}),
				authBaseUrl: "https://auth.openmeld.test",
				profileId: "agt_33333333-3333-4333-8333-333333333333",
				fetchImpl: fetchMock,
			})
		).resolves.toEqual(
			expect.objectContaining({
				openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
				profileKind: "agent",
			})
		);
	});

	it("notifies local execution evidence refresh after deleting an agent profile", async () => {
		const fetchMock = vi.fn<typeof fetch>((input) => {
			const url = String(input);
			if (url.includes("/primary-binding")) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							agentProfileId: "agt_33333333-3333-4333-8333-333333333333",
							disabled: true,
							reasonCodes: ["agent_profile_binding.profile_deleted"],
							status: "disabled",
						}),
						{
							status: 200,
							headers: {
								"content-type": "application/json",
							},
						}
					)
				);
			}
			if (url.includes("/route-catalog-sync")) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							ok: true,
							notifiedSessions: 1,
						}),
						{
							status: 200,
							headers: {
								"content-type": "application/json",
							},
						}
					)
				);
			}

			return Promise.resolve(
				new Response(JSON.stringify(createDeletedAgentProfilePayload()), {
					status: 200,
					headers: {
						"content-type": "application/json",
					},
				})
			);
		});

		await deleteStartAgentProfileFromRequest({
			requestHeaders: new Headers({
				cookie: "session=abc",
			}),
			authBaseUrl: "https://auth.openmeld.test",
			gatewayUrl: "https://gateway.openmeld.test",
			profileId: "agt_33333333-3333-4333-8333-333333333333",
			fetchImpl: fetchMock,
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
			"https://gateway.openmeld.test/v1/agent-profiles/route-catalog-sync"
		);
		expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
			JSON.stringify({
				agentProfileIds: ["agt_33333333-3333-4333-8333-333333333333"],
				reason: "agent_profile_deleted",
			})
		);
		const syncHeaders = fetchMock.mock.calls[1]?.[1]?.headers as
			| Headers
			| undefined;
		expect(syncHeaders?.get("cookie")).toBe("session=abc");
	});

	it("still nudges the evidence refresh when auth reports an already removed Agent Profile", async () => {
		const fetchMock = vi.fn<typeof fetch>((input) => {
			const url = String(input);
			if (url.includes("/primary-binding")) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							agentProfileId: "agt_33333333-3333-4333-8333-333333333333",
							disabled: true,
							reasonCodes: ["agent_profile_binding.profile_deleted"],
							status: "disabled",
						}),
						{
							status: 200,
							headers: {
								"content-type": "application/json",
							},
						}
					)
				);
			}
			if (url.includes("/route-catalog-sync")) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							ok: true,
							notifiedSessions: 1,
						}),
						{
							status: 200,
							headers: {
								"content-type": "application/json",
							},
						}
					)
				);
			}
			return Promise.resolve(
				new Response(
					JSON.stringify({
						error: "not_found",
					}),
					{
						status: 404,
						headers: {
							"content-type": "application/json",
						},
					}
				)
			);
		});

		await expect(
			deleteStartAgentProfileFromRequest({
				requestHeaders: new Headers({
					cookie: "session=abc",
				}),
				authBaseUrl: "https://auth.openmeld.test",
				gatewayUrl: "https://gateway.openmeld.test",
				profileId: "agt_33333333-3333-4333-8333-333333333333",
				fetchImpl: fetchMock,
			})
		).rejects.toThrow("Agent Profile was already removed.");

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
			"https://gateway.openmeld.test/v1/agent-profiles/route-catalog-sync"
		);
		expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
			JSON.stringify({
				agentProfileIds: ["agt_33333333-3333-4333-8333-333333333333"],
				reason: "agent_profile_deleted",
			})
		);
	});

	it("fails closed when auth returns a non-agent payload", async () => {
		const fetchMock = vi.fn<typeof fetch>(() => {
			return Promise.resolve(
				new Response(
					JSON.stringify({
						ok: true,
						profile: {
							openMeldProfileId: "11111111-1111-4111-8111-111111111111",
							profileName: "Felix",
							profileHandle: "felix",
							profileKind: "human",
							isDefault: true,
							status: "active",
							ownerUserId: "user-123",
							source: "manual",
							createdByUserId: "user-123",
							creatorProfileId: null,
							lastUsedAt: null,
							createdAt: "2026-04-14T07:00:00.000Z",
							updatedAt: "2026-04-14T08:00:00.000Z",
						},
					}),
					{
						status: 200,
						headers: {
							"content-type": "application/json",
						},
					}
				)
			);
		});

		await expect(
			deleteStartAgentProfileFromAuth({
				requestHeaders: new Headers(),
				authBaseUrl: "https://auth.openmeld.test",
				profileId: "agt_33333333-3333-4333-8333-333333333333",
				fetchImpl: fetchMock,
			})
		).rejects.toThrow(
			"Invalid delete agent profile response: expected agent profile"
		);
	});

	it("reports an auth 404 as an already removed Agent Profile", async () => {
		const fetchMock = vi.fn<typeof fetch>(() => {
			return Promise.resolve(
				new Response(
					JSON.stringify({
						error: "not_found",
					}),
					{
						status: 404,
						headers: {
							"content-type": "application/json",
						},
					}
				)
			);
		});

		await expect(
			deleteStartAgentProfileFromAuth({
				requestHeaders: new Headers(),
				authBaseUrl: "https://auth.openmeld.test",
				profileId: "agt_33333333-3333-4333-8333-333333333333",
				fetchImpl: fetchMock,
			})
		).rejects.toThrow("Agent Profile was already removed.");
	});
});
