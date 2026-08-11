import { describe, expect, it, vi } from "vitest";
import { readCurrentStartProfile } from "./current-profile.server";

describe("current start profile resolver", () => {
	it("resolves the current primary human profile from auth", async () => {
		const fetchMock = vi.fn<typeof fetch>((_input, init) => {
			expect(init?.headers).toBeInstanceOf(Headers);
			const headers = init?.headers as Headers | undefined;
			expect(headers?.get("cookie")).toBe("session=abc");
			expect(headers?.get("content-type")).toBe("application/json");
			expect(init?.method).toBe("POST");
			expect(init?.body).toBe(JSON.stringify({ profileKind: "human" }));

			return Promise.resolve(
				new Response(
					JSON.stringify({
						ok: true,
						profile: {
							openMeldProfileId: "11111111-1111-4111-8111-111111111111",
							profileKind: "human",
							profileName: "Felix",
							profileHandle: "felix",
							ownerUserId: "user-123",
							isDefault: true,
							status: "active",
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
			readCurrentStartProfile({
				requestHeaders: new Headers({
					cookie: "session=abc",
				}),
				authBaseUrl: "https://auth.openmeld.test",
				fetchImpl: fetchMock,
			})
		).resolves.toEqual({
			openMeldProfileId: "11111111-1111-4111-8111-111111111111",
			profileKind: "human",
			profileName: "Felix",
			ownerUserId: "user-123",
		});
		expect(fetchMock).toHaveBeenCalledWith(
			new URL("/v1/profiles/resolve", "https://auth.openmeld.test"),
			expect.objectContaining({
				method: "POST",
			})
		);
	});

	it("fails closed when auth returns a non-human profile", async () => {
		const fetchMock = vi.fn<typeof fetch>(() => {
			return Promise.resolve(
				new Response(
					JSON.stringify({
						ok: true,
						profile: {
							openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
							profileKind: "agent",
							profileName: "Codex",
							profileHandle: "codex",
							ownerUserId: "user-123",
							isDefault: false,
							status: "active",
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
			readCurrentStartProfile({
				requestHeaders: new Headers(),
				authBaseUrl: "https://auth.openmeld.test",
				fetchImpl: fetchMock,
			})
		).rejects.toThrow("Invalid current start profile response");
	});

	it("throws when the auth resolve request fails", async () => {
		const fetchMock = vi.fn<typeof fetch>(() => {
			return Promise.resolve(
				new Response("upstream down", {
					status: 503,
				})
			);
		});

		await expect(
			readCurrentStartProfile({
				requestHeaders: new Headers(),
				authBaseUrl: "https://auth.openmeld.test",
				fetchImpl: fetchMock,
			})
		).rejects.toThrow("Failed to resolve current start profile: 503");
	});
});
