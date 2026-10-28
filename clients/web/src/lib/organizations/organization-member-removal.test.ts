import { afterEach, describe, expect, it, vi } from "vitest";
import {
	prepareOrganizationMemberRemoval,
	previewOrganizationMemberRemoval,
} from "./organization-member-removal";

describe("organization member removal", () => {
	afterEach(() => vi.unstubAllGlobals());

	it.each([
		"preview",
		"prepare",
	] as const)("binds the Organization and exact member to %s", async (action) => {
		const spaces = [
			{
				spaceId: "space-private",
				name: "Private planning",
				action: "transfer" as const,
			},
		];
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				Response.json(
					action === "preview"
						? { memberId: "member-departing", userId: "user-departing", spaces }
						: { prepared: true }
				)
			);
		vi.stubGlobal("fetch", fetchMock);
		const input = {
			organizationId: "organization-route",
			memberId: "member-departing",
		};
		if (action === "preview") {
			expect((await previewOrganizationMemberRemoval(input)).spaces).toEqual(
				spaces
			);
		} else {
			await prepareOrganizationMemberRemoval({
				...input,
				spaces,
				successorUserId: "user-successor",
			});
		}
		const [url, request] = fetchMock.mock.calls[0] ?? [];
		expect(String(url)).toContain(
			`/v1/organizations/current/member-removal/${action}`
		);
		expect(
			(request?.headers as Headers).get("x-openmeld-requested-organization-id")
		).toBe("organization-route");
		expect(JSON.parse(String(request?.body))).toEqual(
			action === "preview"
				? { memberId: input.memberId }
				: {
						memberId: input.memberId,
						spaces,
						successorUserId: "user-successor",
					}
		);
	});

	it("rejects a review for another member", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>().mockResolvedValue(
				Response.json({
					memberId: "another-member",
					userId: "another-user",
					spaces: [],
				})
			)
		);
		await expect(
			previewOrganizationMemberRemoval({
				organizationId: "org-route",
				memberId: "member-departing",
			})
		).rejects.toThrow("another member");
	});
});
