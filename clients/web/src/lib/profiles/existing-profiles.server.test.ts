import { describe, expect, it, vi } from "vitest";
import { isSessionExpiredError } from "#/lib/session-expired";
import { readStartProfiles } from "./existing-profiles.server";

describe("start profiles resolver", () => {
	it("lists existing profiles from auth", async () => {
		const fetchMock = vi.fn<typeof fetch>((_input, init) => {
			expect(init?.headers).toBeInstanceOf(Headers);
			const headers = init?.headers as Headers | undefined;
			expect(headers?.get("cookie")).toBe("session=abc");
			expect(init?.method).toBe("GET");

			return Promise.resolve(
				new Response(
					JSON.stringify({
						ok: true,
						profiles: [
							{
								openMeldProfileId: "11111111-1111-4111-8111-111111111111",
								profileName: "Felix Human",
								profileHandle: "felix-human",
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
						],
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
			readStartProfiles({
				requestHeaders: new Headers({
					cookie: "session=abc",
				}),
				authBaseUrl: "https://auth.openmeld.test",
				fetchImpl: fetchMock,
			})
		).resolves.toEqual([
			expect.objectContaining({
				openMeldProfileId: "11111111-1111-4111-8111-111111111111",
				profileName: "Felix Human",
			}),
		]);
	});

	it("fails closed when auth returns an invalid profile list payload", async () => {
		const fetchMock = vi.fn<typeof fetch>(() => {
			return Promise.resolve(
				new Response(
					JSON.stringify({
						ok: true,
						profiles: [
							{
								openMeldProfileId: "11111111-1111-4111-8111-111111111111",
								profileName: "Felix Human",
								profileHandle: "felix-human",
								profileKind: "team",
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
						],
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
			readStartProfiles({
				requestHeaders: new Headers(),
				authBaseUrl: "https://auth.openmeld.test",
				fetchImpl: fetchMock,
			})
		).rejects.toThrow("Invalid start profiles response");
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
			readStartProfiles({
				requestHeaders: new Headers(),
				authBaseUrl: "https://auth.openmeld.test",
				fetchImpl: fetchMock,
			})
		).rejects.toSatisfy((error: unknown) => isSessionExpiredError(error));
	});

	it("uses product-facing copy for transient auth profile failures", async () => {
		const fetchMock = vi.fn<typeof fetch>(() => {
			return Promise.resolve(
				new Response(JSON.stringify({ ok: false }), {
					status: 500,
					statusText: "Internal Server Error",
					headers: {
						"content-type": "application/json",
					},
				})
			);
		});

		await expect(
			readStartProfiles({
				requestHeaders: new Headers(),
				authBaseUrl: "https://auth.openmeld.test",
				fetchImpl: fetchMock,
			})
		).rejects.toThrow(
			"OpenMeld could not load your profiles right now. Try again."
		);
	});
});
