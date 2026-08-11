import { describe, expect, it } from "vitest";
import { fetchAuthOrganizations } from "./auth-organizations.server";

describe("fetchAuthOrganizations", () => {
	it("normalizes Better Auth organization records returned during SSR", async () => {
		const requestHeaders = new Headers({ cookie: "session=redacted" });
		const fetchImpl = (url: RequestInfo | URL, init?: RequestInit) => {
			expect(String(url)).toBe(
				"https://auth.openmeld.ai/api/auth/organization/list"
			);
			expect(new Headers(init?.headers).get("cookie")).toBe("session=redacted");

			return Promise.resolve(
				Response.json([
					{
						id: "org_abc123",
						name: "Personal",
						slug: "personal-felix",
						logo: null,
						metadata: { plan: "launch" },
						createdAt: "2026-07-05T04:00:00.000Z",
						customField: "returned-by-better-auth",
					},
				])
			);
		};

		await expect(
			fetchAuthOrganizations({
				betterAuthUrl: "https://auth.openmeld.ai",
				fetchImpl,
				requestHeaders,
			})
		).resolves.toEqual([
			{
				id: "org_abc123",
				isPersonal: false,
				logo: null,
				name: "Personal",
				slug: "personal-felix",
			},
		]);
	});

	it("preserves explicit personal-context string metadata from Better Auth", async () => {
		await expect(
			fetchAuthOrganizations({
				betterAuthUrl: "https://auth.openmeld.ai",
				fetchImpl: () =>
					Promise.resolve(
						Response.json([
							{
								id: "org_personal",
								name: "Felix",
								slug: "felix",
								metadata: '{"personal":true}',
							},
						])
					),
				requestHeaders: new Headers(),
			})
		).resolves.toEqual([
			{
				id: "org_personal",
				isPersonal: true,
				logo: null,
				name: "Felix",
				slug: "felix",
			},
		]);
	});

	it("fails closed when Better Auth omits required organization identity fields", async () => {
		await expect(
			fetchAuthOrganizations({
				betterAuthUrl: "https://auth.openmeld.ai",
				fetchImpl: () =>
					Promise.resolve(
						Response.json([{ id: "org_abc123", name: "Personal" }])
					),
				requestHeaders: new Headers(),
			})
		).rejects.toThrow("Organization list response is invalid.");
	});
});
