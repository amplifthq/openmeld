import { describe, expect, it, vi } from "vitest";
import { readProfileSpaceHistory } from "./profile-space-history.server";

describe("selected profile space history", () => {
	it("lists spaces through the web OpenMeld boundary using the explicit selected profile", async () => {
		const proxyRequestImpl = vi.fn(
			(input: { request: Request; gatewayUrl: string; webAppUrl: string }) => {
				expect(input.gatewayUrl).toBe("https://gateway.openmeld.test");
				expect(input.webAppUrl).toBe("https://openmeld.test");
				expect(input.request.url).toBe(
					"https://openmeld.test/v1/profiles/11111111-1111-4111-8111-111111111111/spaces?gatewayHost=gateway.openmeld.test&status=active&limit=40"
				);
				expect(input.request.headers.get("cookie")).toBe("session=abc");
				expect(input.request.headers.get("x-openmeld-profile-id")).toBe(
					"11111111-1111-4111-8111-111111111111"
				);

				return Promise.resolve(
					new Response(
						JSON.stringify({
							items: [
								{
									profileId: "11111111-1111-4111-8111-111111111111",
									gatewayHost: "gateway.openmeld.test",
									spaceId: "space-demo",
									spaceName: "Demo Space",
									creatorProfileId: null,
									creatorKind: null,
									spaceCreatedAt: null,
									spaceUpdatedAt: "2026-04-14T08:10:00.000Z",
									lastSeenTs: null,
									pinnedAt: null,
									status: "active",
									lastJoinedAt: "2026-04-14T08:00:00.000Z",
									createdAt: "2026-04-14T08:00:00.000Z",
									updatedAt: "2026-04-14T08:10:00.000Z",
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
			}
		);

		await expect(
			readProfileSpaceHistory({
				gatewayUrl: "https://gateway.openmeld.test",
				webAppUrl: "https://openmeld.test",
				profileId: "11111111-1111-4111-8111-111111111111",
				requestHeaders: new Headers({
					cookie: "session=abc",
				}),
				proxyRequestImpl,
			})
		).resolves.toEqual([
			{
				profileId: "11111111-1111-4111-8111-111111111111",
				gatewayHost: "gateway.openmeld.test",
				spaceId: "space-demo",
				spaceName: "Demo Space",
				creatorProfileId: null,
				creatorKind: null,
				spaceCreatedAt: null,
				spaceUpdatedAt: "2026-04-14T08:10:00.000Z",
				lastSeenTs: null,
				pinnedAt: null,
				status: "active",
				lastJoinedAt: "2026-04-14T08:00:00.000Z",
				createdAt: "2026-04-14T08:00:00.000Z",
				updatedAt: "2026-04-14T08:10:00.000Z",
			},
		]);

		expect(proxyRequestImpl).toHaveBeenCalledTimes(1);
	});
});
