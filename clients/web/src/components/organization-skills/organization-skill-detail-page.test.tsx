import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { OrganizationSkillDetailPage } from "./organization-skill-detail-page";

const getCurrentOrganizationSkillMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: {
			id: "organization-1",
			name: "Acme",
			slug: "acme",
		},
	}),
}));

vi.mock("#/lib/organizations/organization-skills", async (importOriginal) => ({
	...(await importOriginal()),
	getCurrentOrganizationSkill: getCurrentOrganizationSkillMock,
}));

describe("OrganizationSkillDetailPage", () => {
	beforeEach(() => {
		getCurrentOrganizationSkillMock.mockReset().mockResolvedValue({
			skill: {
				activeRelease: {
					createdAt: "2026-08-24T01:00:00.000Z",
					createdByUserId: "user-1",
					digest: "a".repeat(64),
					id: "release-1",
					source: { kind: "created" },
				},
				bundle: {
					files: [],
					instructions: "Review every supported viewport.",
					portable: {
						allowedTools: null,
						compatibility: null,
						description: "Keep every compact control reachable.",
						license: null,
						metadata: {},
						name: "responsive-product-audit-across-every-supported-screen-size",
					},
				},
				createdAt: "2026-08-24T01:00:00.000Z",
				description: "Keep every compact control reachable.",
				enabled: true,
				id: "skill-1",
				maintainerUserIds: ["user-1"],
				name: "responsive-product-audit-across-every-supported-screen-size",
				organizationId: "organization-1",
				permissions: { canEdit: true, canManage: false },
				releases: [
					{
						createdAt: "2026-08-24T01:00:00.000Z",
						createdByUserId: "user-1",
						digest: "a".repeat(64),
						id: "release-1",
						source: { kind: "created" },
					},
				],
				source: { kind: "created" },
				updatedAt: "2026-08-24T01:00:00.000Z",
				version: 1,
			},
		});
	});

	afterEach(cleanup);

	it("opens directly into one document with a persistent action bar rather than a metadata form", async () => {
		const root = createRootRoute();
		const detail = createRoute({
			getParentRoute: () => root,
			path: "/o/$orgSlug/skills/$skillId",
			component: () => <OrganizationSkillDetailPage skillId="skill-1" />,
		});
		const router = createRouter({
			history: createMemoryHistory({
				initialEntries: ["/o/acme/skills/skill-1"],
			}),
			routeTree: root.addChildren([detail]),
		});
		render(
			<TestQueryClientProvider>
				<RouterProvider router={router} />
			</TestQueryClientProvider>
		);

		const heading = await screen.findByRole("heading", {
			name: "responsive-product-audit-across-every-supported-screen-size",
		});
		expect(heading.contains(screen.getByLabelText("Name"))).toBe(true);
		expect(screen.getAllByLabelText("Description")).toHaveLength(1);
		expect(
			screen
				.getByLabelText("Instructions", { selector: "[data-slate-editor]" })
				.getAttribute("contenteditable")
		).toBe("true");
		expect(screen.queryByLabelText("License")).toBeNull();
		expect(screen.queryByText("Metadata")).toBeNull();
		expect(screen.getByRole("tab", { name: "Files (0)" })).toBeDefined();
		const save = screen.getByRole("button", { name: "Save" });
		const actions = save.closest('[data-slot="skill-document-actions"]');
		expect(
			actions?.contains(screen.getByRole("link", { name: "All Skills" }))
		).toBe(true);
		expect(
			actions?.contains(screen.getByRole("button", { name: "More actions" }))
		).toBe(true);
	});
});
