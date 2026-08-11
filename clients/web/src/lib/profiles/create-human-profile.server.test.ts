import { describe, expect, it, vi } from "vitest";
import { isSessionExpiredError } from "#/lib/session-expired";
import { createStartHumanProfileFromAuth } from "./create-human-profile.server";

describe("create human profile for start", () => {
	it("creates a human profile through auth with the request cookie", async () => {
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			expect(String(input)).toBe(
				"https://auth.openmeld.test/v1/profiles/humans"
			);
			expect(init?.method).toBe("POST");
			expect(init?.headers).toBeInstanceOf(Headers);
			const headers = init?.headers as Headers | undefined;
			expect(headers?.get("cookie")).toBe("session=abc");
			expect(init?.body).toBe(
				JSON.stringify({
					profileName: "New Human Profile",
					creatorProfileId: "11111111-1111-4111-8111-111111111111",
				})
			);

			return Promise.resolve(
				new Response(
					JSON.stringify({
						ok: true,
						profile: {
							openMeldProfileId: "33333333-3333-4333-8333-333333333333",
							profileName: "New Human Profile",
							profileHandle: "new-human-profile",
							profileKind: "human",
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
			createStartHumanProfileFromAuth({
				requestHeaders: new Headers({
					cookie: "session=abc",
				}),
				authBaseUrl: "https://auth.openmeld.test",
				body: {
					profileName: "New Human Profile",
					creatorProfileId: "11111111-1111-4111-8111-111111111111",
				},
				fetchImpl: fetchMock,
			})
		).resolves.toEqual(
			expect.objectContaining({
				openMeldProfileId: "33333333-3333-4333-8333-333333333333",
				profileName: "New Human Profile",
				profileKind: "human",
			})
		);
	});

	it("fails closed when auth returns a malformed create-human-profile payload", async () => {
		const fetchMock = vi.fn<typeof fetch>(() => {
			return Promise.resolve(
				new Response(
					JSON.stringify({
						ok: true,
						profile: {
							openMeldProfileId: "33333333-3333-4333-8333-333333333333",
							profileName: "New Human Profile",
							profileHandle: "new-human-profile",
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
			createStartHumanProfileFromAuth({
				requestHeaders: new Headers(),
				authBaseUrl: "https://auth.openmeld.test",
				body: {
					profileName: "New Human Profile",
				},
				fetchImpl: fetchMock,
			})
		).rejects.toThrow(
			"Invalid create human profile response: expected human profile"
		);
	});

	it("throws the shared session-expired error when auth returns 401", async () => {
		const fetchMock = vi.fn<typeof fetch>(() => {
			return Promise.resolve(
				new Response(
					JSON.stringify({
						ok: false,
						code: "auth.unauthenticated",
						message: "authentication required",
					}),
					{
						status: 401,
						statusText: "Unauthorized",
						headers: {
							"content-type": "application/json",
						},
					}
				)
			);
		});

		await expect(
			createStartHumanProfileFromAuth({
				requestHeaders: new Headers(),
				authBaseUrl: "https://auth.openmeld.test",
				body: {
					profileName: "New Human Profile",
				},
				fetchImpl: fetchMock,
			})
		).rejects.toSatisfy((error: unknown) => isSessionExpiredError(error));
	});

	it("preserves Auth's disabled capability message", async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						code: "profile.additional_human_profile_creation_disabled",
						message:
							"Creating additional Human Profiles is currently unavailable. Use your default Human Profile, or create an Agent Profile.",
						ok: false,
					}),
					{
						headers: { "content-type": "application/json" },
						status: 409,
					}
				)
			)
		);

		await expect(
			createStartHumanProfileFromAuth({
				authBaseUrl: "https://auth.openmeld.test",
				body: { profileName: "New Human Profile" },
				fetchImpl: fetchMock,
				requestHeaders: new Headers(),
			})
		).rejects.toMatchObject({
			message:
				"Creating additional Human Profiles is currently unavailable. Use your default Human Profile, or create an Agent Profile.",
			status: 409,
			upstreamCode: "profile.additional_human_profile_creation_disabled",
		});
	});

	it("uses a status fallback for a malformed Auth error envelope", async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(JSON.stringify({ message: "untrusted shape" }), {
					headers: { "content-type": "application/json" },
					status: 409,
				})
			)
		);

		await expect(
			createStartHumanProfileFromAuth({
				authBaseUrl: "https://auth.openmeld.test",
				body: { profileName: "New Human Profile" },
				fetchImpl: fetchMock,
				requestHeaders: new Headers(),
			})
		).rejects.toMatchObject({
			message: "Failed to create human profile: 409",
			status: 409,
		});
	});
});
