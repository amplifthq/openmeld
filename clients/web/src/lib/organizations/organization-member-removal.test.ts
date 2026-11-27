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
			new URL(String(url)).searchParams.get("includeDefaultSuccessor")
		).toBe(action === "preview" ? "1" : null);
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

	it("accepts a named organization default and binds it to preparation", async () => {
		const defaultSuccessor = {
			userId: "owner-fixture",
			profileName: "Owner Fixture",
		};
		const spaces = [
			{
				spaceId: "shared-space",
				name: "Shared handoff",
				action: "transfer" as const,
			},
		];
		const memberId = "member-departing";
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				Response.json({
					memberId,
					userId: "user-departing",
					spaces,
					defaultSuccessor,
				})
			)
			.mockResolvedValueOnce(Response.json({ prepared: true }));
		vi.stubGlobal("fetch", fetchMock);
		const input = { organizationId: "org-route", memberId };
		const preview = await previewOrganizationMemberRemoval(input);
		expect(preview.defaultSuccessor).toEqual(defaultSuccessor);
		await prepareOrganizationMemberRemoval({
			...input,
			spaces,
			successorUserId: defaultSuccessor.userId,
			useDefaultSuccessor: true,
		});
		expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
			memberId,
			spaces,
			successorUserId: defaultSuccessor.userId,
			useDefaultSuccessor: true,
		});
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
