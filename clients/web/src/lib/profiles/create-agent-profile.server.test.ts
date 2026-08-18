import { describe, expect, it, vi } from "vitest";
import {
	createStartAgentProfileFromAuth,
	createStartAgentProfileFromRequest,
} from "./create-agent-profile.server";

describe("create agent profile for start", () => {
	it("creates an agent profile through auth with the request cookie", async () => {
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			expect(String(input)).toBe(
				"https://auth.openmeld.test/v1/profiles/agents"
			);
			expect(init?.method).toBe("POST");
			expect(init?.headers).toBeInstanceOf(Headers);
			const headers = init?.headers as Headers | undefined;
			expect(headers?.get("cookie")).toBe("session=abc");
			expect(headers?.get("x-openmeld-requested-organization-id")).toBe(
				"organization-amplift"
			);
			expect(init?.body).toBe(
				JSON.stringify({
					profileName: "Research Agent",
					creatorProfileId: "11111111-1111-4111-8111-111111111111",
					idempotencyKey: "agent-profile-create:request-123",
				})
			);

			return Promise.resolve(
				new Response(
					JSON.stringify({
						ok: true,
						profile: {
							openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
							profileName: "Research Agent",
							profileHandle: "research-agent",
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
					}),
					{
						status: 201,
						headers: {
							"content-type": "application/json",
						},
					}
				)
			);
		});

		await expect(
			createStartAgentProfileFromAuth({
				requestHeaders: new Headers({
					cookie: "session=abc",
				}),
				authBaseUrl: "https://auth.openmeld.test",
				organizationId: "organization-amplift",
				body: {
					profileName: "Research Agent",
					creatorProfileId: "11111111-1111-4111-8111-111111111111",
					idempotencyKey: "agent-profile-create:request-123",
				},
				fetchImpl: fetchMock,
			})
		).resolves.toEqual(
			expect.objectContaining({
				openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
				profileName: "Research Agent",
				profileKind: "agent",
			})
		);
	});

	it("does not fire a route-catalog nudge on create (binding does not exist yet)", async () => {
		const fetchMock = vi.fn<typeof fetch>(() => {
			return Promise.resolve(
				new Response(
					JSON.stringify({
						ok: true,
						profile: {
							openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
							profileName: "Research Agent",
							profileHandle: "research-agent",
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
					}),
					{
						status: 201,
						headers: {
							"content-type": "application/json",
						},
					}
				)
			);
		});

		await createStartAgentProfileFromRequest({
			requestHeaders: new Headers({
				cookie: "session=abc",
			}),
			authBaseUrl: "https://auth.openmeld.test",
			organizationId: "organization-amplift",
			body: {
				profileName: "Research Agent",
				creatorProfileId: "11111111-1111-4111-8111-111111111111",
			},
			fetchImpl: fetchMock,
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			"https://auth.openmeld.test/v1/profiles/agents"
		);
	});

	it("fails closed when auth returns a malformed create-agent-profile payload", async () => {
		const fetchMock = vi.fn<typeof fetch>(() => {
			return Promise.resolve(
				new Response(
					JSON.stringify({
						ok: true,
						profile: {
							openMeldProfileId: "33333333-3333-4333-8333-333333333333",
							profileName: "Research Agent",
							profileHandle: "research-agent",
							profileKind: "human",
							isDefault: false,
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
						status: 201,
						headers: {
							"content-type": "application/json",
						},
					}
				)
			);
		});

		await expect(
			createStartAgentProfileFromAuth({
				requestHeaders: new Headers(),
				authBaseUrl: "https://auth.openmeld.test",
				organizationId: "organization-amplift",
				body: {
					profileName: "Research Agent",
				},
				fetchImpl: fetchMock,
			})
		).rejects.toThrow(
			"Invalid create agent profile response: expected agent profile"
		);
	});

	it("forwards create-agent requests without local-agent Binding truth", async () => {
		const fetchMock = vi.fn<typeof fetch>((_input, init) => {
			expect(init?.body).toBe(
				JSON.stringify({
					profileName: "Research Agent",
				})
			);

			return Promise.resolve(
				new Response(
					JSON.stringify({
						ok: true,
						profile: {
							openMeldProfileId: "agt_44444444-4444-4444-8444-444444444444",
							profileName: "Research Agent",
							profileHandle: "research-agent",
							profileKind: "agent",
							isDefault: false,
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
						status: 201,
						headers: {
							"content-type": "application/json",
						},
					}
				)
			);
		});

		await expect(
			createStartAgentProfileFromAuth({
				requestHeaders: new Headers(),
				authBaseUrl: "https://auth.openmeld.test",
				organizationId: "organization-amplift",
				body: {
					profileName: "Research Agent",
				},
				fetchImpl: fetchMock,
			})
		).resolves.toEqual(
			expect.objectContaining({
				openMeldProfileId: "agt_44444444-4444-4444-8444-444444444444",
				profileKind: "agent",
			})
		);
	});

	it("preserves the Auth Organization error when profile creation is rejected", async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						ok: false,
						code: "organization.membership_required",
						message: "You do not have access to this organization.",
					}),
					{
						status: 400,
						headers: { "content-type": "application/json" },
					}
				)
			)
		);

		await expect(
			createStartAgentProfileFromAuth({
				requestHeaders: new Headers(),
				authBaseUrl: "https://auth.openmeld.test",
				organizationId: "organization-amplift",
				body: { profileName: "Research Agent" },
				fetchImpl: fetchMock,
			})
		).rejects.toMatchObject({
			message: "You do not have access to this organization.",
			status: 400,
			upstreamCode: "organization.membership_required",
		});
	});
});
