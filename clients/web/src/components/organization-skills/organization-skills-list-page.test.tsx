import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { OrganizationSkillsListPage } from "./organization-skills-list-page";

const ORGANIZATION_COPY_PATTERN = /Organization/;

const {
	currentOrganizationMock,
	importCurrentOrganizationSkillFromGitHubMock,
	listCurrentOrganizationSkillsMock,
	previewCurrentOrganizationSkillFromGitHubMock,
} = vi.hoisted(() => ({
	currentOrganizationMock: {
		id: "org-acme",
		isPersonal: false,
		name: "Acme",
		slug: "acme",
	},
	importCurrentOrganizationSkillFromGitHubMock: vi.fn(),
	listCurrentOrganizationSkillsMock: vi.fn(),
	previewCurrentOrganizationSkillFromGitHubMock: vi.fn(),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: currentOrganizationMock,
	}),
}));

vi.mock("#/lib/organizations/organization-skills", async (importOriginal) => {
	const original =
		await importOriginal<
			typeof import("#/lib/organizations/organization-skills")
		>();
	return {
		...original,
		importCurrentOrganizationSkillFromGitHub:
			importCurrentOrganizationSkillFromGitHubMock,
		listCurrentOrganizationSkills: listCurrentOrganizationSkillsMock,
		previewCurrentOrganizationSkillFromGitHub:
			previewCurrentOrganizationSkillFromGitHubMock,
	};
});

afterEach(cleanup);

beforeEach(() => {
	Object.assign(currentOrganizationMock, {
		id: "org-acme",
		isPersonal: false,
		name: "Acme",
		slug: "acme",
	});
	listCurrentOrganizationSkillsMock.mockReset();
	previewCurrentOrganizationSkillFromGitHubMock.mockReset();
	importCurrentOrganizationSkillFromGitHubMock.mockReset();
});

describe("OrganizationSkillsListPage", () => {
	it("lists every Skill for the immutable route Organization and filters locally", async () => {
		listCurrentOrganizationSkillsMock.mockResolvedValue({
			canManage: false,
			organizationId: "org-acme",
			skills: [
				skillSummary({
					description: "Review customer signals.",
					id: "risk-review",
					name: "customer-risk-review",
				}),
				skillSummary({
					description: "Prepare the weekly support digest.",
					id: "support-digest",
					name: "support-digest",
				}),
			],
		});
		renderPage();

		expect(await screen.findByText("customer-risk-review")).toBeTruthy();
		expect(screen.getByText("Organization")).toBeTruthy();
		expect(screen.getByText("support-digest")).toBeTruthy();
		expect(document.querySelectorAll("[data-fluid-card-item]")).toHaveLength(2);
		expect(listCurrentOrganizationSkillsMock).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-acme" })
		);
		expect(screen.queryByRole("button", { name: "Create skill" })).toBeNull();

		fireEvent.change(screen.getByRole("textbox", { name: "Search Skills" }), {
			target: { value: "support" },
		});
		await waitFor(() =>
			expect(screen.queryByText("customer-risk-review")).toBeNull()
		);
		expect(screen.getByText("support-digest")).toBeTruthy();
	});

	it("shows install and create actions only from the server permission", async () => {
		listCurrentOrganizationSkillsMock.mockResolvedValue({
			canManage: true,
			organizationId: "org-acme",
			skills: [],
		});
		renderPage();

		expect(
			await screen.findByRole("button", { name: "Create skill" })
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Install from GitHub" })
		).toBeTruthy();
	});

	it("uses personal workspace copy throughout the empty and create states", async () => {
		Object.assign(currentOrganizationMock, {
			id: "org-felix",
			isPersonal: true,
			name: "Felix",
			slug: "felix",
		});
		listCurrentOrganizationSkillsMock.mockResolvedValue({
			canManage: true,
			organizationId: "org-felix",
			skills: [],
		});
		renderPage();

		expect(await screen.findByText("Personal workspace")).toBeTruthy();
		expect(
			await screen.findByText(
				"Manage the optional working methods your Center Agent and local agents use in this personal workspace."
			)
		).toBeTruthy();
		expect(
			await screen.findByText(
				"This is valid. Skills are optional and only appear after you create or install one."
			)
		).toBeTruthy();

		fireEvent.click(
			await screen.findByRole("button", { name: "Create skill" })
		);
		expect(
			screen.getByText(
				"Add an optional working method for this personal workspace."
			)
		).toBeTruthy();
		expect(screen.queryByText(ORGANIZATION_COPY_PATTERN)).toBeNull();
	});

	it("previews the immutable GitHub commit before installing it", async () => {
		const commitSha = "b".repeat(40);
		listCurrentOrganizationSkillsMock.mockResolvedValue({
			canManage: true,
			organizationId: "org-acme",
			skills: [],
		});
		previewCurrentOrganizationSkillFromGitHubMock.mockResolvedValue({
			organizationId: "org-acme",
			preview: {
				files: [
					{
						encoding: "utf8",
						mediaType: "text/markdown",
						path: "references/checklist.md",
						size: 12,
					},
				],
				instructionsCharacters: 42,
				portable: {
					allowedTools: null,
					compatibility: null,
					description: "Review release evidence.",
					license: "MIT",
					metadata: {},
					name: "release-review",
				},
				source: {
					commitSha,
					kind: "github",
					path: "release-review",
					repository: "https://github.com/acme/skills",
				},
				warnings: [
					"Scripts are stored for portability but are not executable in OpenMeld Phase 1.",
				],
			},
		});
		importCurrentOrganizationSkillFromGitHubMock.mockResolvedValue({
			skill: {
				...skillSummary({
					description: "Review release evidence.",
					id: "release-review",
					name: "release-review",
				}),
				maintainerUserIds: [],
				releases: [],
			},
		});
		renderPage();

		fireEvent.click(
			await screen.findByRole("button", { name: "Install from GitHub" })
		);
		fireEvent.change(screen.getByLabelText("GitHub URL"), {
			target: {
				value: "https://github.com/acme/skills/tree/main/release-review",
			},
		});
		fireEvent.click(screen.getByRole("button", { name: "Review skill" }));

		expect(await screen.findByText("release-review")).toBeTruthy();
		expect(screen.getByText(commitSha.slice(0, 12))).toBeTruthy();
		expect(screen.getByText("1")).toBeTruthy();
		expect(screen.getByText("42 characters")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Install skill" }));

		await waitFor(() =>
			expect(importCurrentOrganizationSkillFromGitHubMock).toHaveBeenCalledWith(
				{
					expectedCommitSha: commitSha,
					expectedOrganizationId: "org-acme",
					url: "https://github.com/acme/skills/tree/main/release-review",
				}
			)
		);
	});
});

function renderPage() {
	const rootRoute = createRootRoute();
	const route = createRoute({
		component: OrganizationSkillsListPage,
		getParentRoute: () => rootRoute,
		path: "/o/$orgSlug/center-agent/skills",
	});
	const router = createRouter({
		history: createMemoryHistory({
			initialEntries: [
				`/o/${currentOrganizationMock.slug}/center-agent/skills`,
			],
		}),
		routeTree: rootRoute.addChildren([route]),
	});
	return render(
		<TestQueryClientProvider>
			<RouterProvider router={router} />
		</TestQueryClientProvider>
	);
}

function skillSummary(input: {
	description: string;
	id: string;
	name: string;
}) {
	return {
		activeRelease: {
			createdAt: "2026-07-26T08:00:00.000Z",
			createdByUserId: "owner-1",
			digest: "a".repeat(64),
			id: `release-${input.id}`,
			source: { kind: "created" as const },
		},
		createdAt: "2026-07-26T08:00:00.000Z",
		description: input.description,
		enabled: true,
		id: input.id,
		name: input.name,
		organizationId: "org-acme",
		permissions: { canEdit: false, canManage: false },
		source: { kind: "created" as const },
		updatedAt: "2026-07-26T08:00:00.000Z",
		version: 1,
	};
}
