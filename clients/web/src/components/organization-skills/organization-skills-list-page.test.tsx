import type { OrganizationSkill } from "@openmeld/schemas/types";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
	useParams,
} from "@tanstack/react-router";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizationSkillQueryKeys } from "#/query/organizations/organization-skills";
import { createOrganizationSkillFixture } from "#/test-support/organization-skill";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { OrganizationSkillsListPage } from "./organization-skills-list-page";

const ORGANIZATION_COPY_PATTERN = /Organization/;

const {
	currentOrganizationMock,
	createCurrentOrganizationSkillMock,
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
	createCurrentOrganizationSkillMock: vi.fn(),
	importCurrentOrganizationSkillFromGitHubMock: vi.fn(),
	listCurrentOrganizationSkillsMock: vi.fn(),
	previewCurrentOrganizationSkillFromGitHubMock: vi.fn(),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => {
		const { orgSlug } = useParams({ strict: false });
		return {
			storageScope: "account-one",
			currentOrganization: {
				...currentOrganizationMock,
				id: `org-${orgSlug}`,
				slug: orgSlug,
			},
		};
	},
}));

vi.mock("#/lib/organizations/organization-skills", async (importOriginal) => {
	const original =
		await importOriginal<
			typeof import("#/lib/organizations/organization-skills")
		>();
	return {
		...original,
		createCurrentOrganizationSkill: createCurrentOrganizationSkillMock,
		importCurrentOrganizationSkillFromGitHub:
			importCurrentOrganizationSkillFromGitHubMock,
		listCurrentOrganizationSkills: listCurrentOrganizationSkillsMock,
		previewCurrentOrganizationSkillFromGitHub:
			previewCurrentOrganizationSkillFromGitHubMock,
	};
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

beforeEach(() => {
	vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
	Object.assign(currentOrganizationMock, {
		id: "org-acme",
		isPersonal: false,
		name: "Acme",
		slug: "acme",
	});
	listCurrentOrganizationSkillsMock.mockReset();
	createCurrentOrganizationSkillMock.mockReset();
	previewCurrentOrganizationSkillFromGitHubMock.mockReset();
	importCurrentOrganizationSkillFromGitHubMock.mockReset();
});

describe("OrganizationSkillsListPage", () => {
	it("restores catalog filters and scroll after opening a Skill, without transferring them to another organization", async () => {
		listCurrentOrganizationSkillsMock.mockImplementation(
			async ({ organizationId }) => ({
				canManage: false,
				organizationId,
				skills: [
					skillSummary({
						id: "one",
						name: "first-skill",
						description: "First method.",
					}),
					skillSummary({
						id: "two",
						name: "second-skill",
						description: "Second method.",
						enabled: false,
					}),
				],
			})
		);
		const { router, container } = renderPage();
		await screen.findByText("first-skill");
		fireEvent.click(
			screen.getByRole("combobox", { name: "Filter skills by status" })
		);
		fireEvent.click(await screen.findByRole("option", { name: "Disabled" }));
		expect(screen.queryByText("first-skill")).toBeNull();
		fireEvent.change(screen.getByLabelText("Search skills"), {
			target: { value: "second" },
		});
		const viewport = container.querySelector<HTMLElement>(
			'[data-slot="scroll-area-viewport"]'
		);
		if (!viewport) {
			throw new Error("Missing catalog scroll viewport");
		}
		viewport.scrollTop = 240;
		fireEvent.scroll(viewport);
		fireEvent.click(screen.getByText("second-skill"));
		await screen.findByRole("heading", { name: "two" });
		viewport.scrollTop = 0;
		await act(() => router.navigate({ to: "/o/acme/skills" }));
		await screen.findByText("second-skill");
		expect(
			(screen.getByLabelText("Search skills") as HTMLInputElement).value
		).toBe("second");
		expect(viewport.scrollTop).toBe(240);
		await act(() => router.navigate({ to: "/o/beta/skills" }));
		await screen.findByText("first-skill");
		expect(
			(screen.getByLabelText("Search skills") as HTMLInputElement).value
		).toBe("");
		fireEvent.change(screen.getByLabelText("Search skills"), {
			target: { value: "no-match" },
		});
		fireEvent.click(
			await screen.findByRole("button", { name: "Clear filters" })
		);
		expect(screen.getAllByRole("listitem")).toHaveLength(2);
	});

	it("retains cached rows when background refresh fails", async () => {
		listCurrentOrganizationSkillsMock.mockResolvedValue({
			organizationId: "org-acme",
			canManage: false,
			skills: [
				skillSummary({
					id: "one",
					name: "first-skill",
					description: "First method.",
				}),
			],
		});
		const { queryClient } = renderPage();
		await screen.findByText("first-skill");
		listCurrentOrganizationSkillsMock.mockRejectedValue(new Error("Offline"));
		await act(() =>
			queryClient.refetchQueries({
				queryKey: organizationSkillQueryKeys.list("org-acme"),
			})
		);
		await screen.findByText("Could not refresh skills.");
		expect(screen.getByText("first-skill")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
	});
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
		expect(
			screen.getByText("Reusable instructions for agents in this workspace.")
		).toBeTruthy();
		expect(
			screen
				.getByText("customer-risk-review")
				.closest("a")
				?.getAttribute("href")
		).toBe("/o/acme/skills/risk-review");
		expect(screen.getByText("support-digest")).toBeTruthy();
		expect(screen.getAllByRole("listitem")).toHaveLength(2);
		expect(listCurrentOrganizationSkillsMock).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-acme" })
		);
		expect(screen.queryByRole("button", { name: "Create skill" })).toBeNull();

		fireEvent.change(screen.getByRole("textbox", { name: "Search skills" }), {
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

		fireEvent.click(await screen.findByRole("button", { name: "Add skill" }));
		expect(
			await screen.findByRole("menuitem", { name: "Create skill" })
		).toBeTruthy();
		expect(
			screen.getByRole("menuitem", { name: "Install from GitHub" })
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

		expect(
			await screen.findByText(
				"Reusable instructions for agents in this workspace."
			)
		).toBeTruthy();
		expect(
			await screen.findByText(
				"Add a skill to give your agents a reusable way to work."
			)
		).toBeTruthy();

		await openAddAction("Create skill");
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
		const { router } = renderPage();

		await openAddAction("Install from GitHub");
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
		await waitFor(() =>
			expect(router.state.location.pathname).toBe(
				"/o/acme/skills/release-review"
			)
		);
	});

	it("opens the canonical detail after creating a Skill", async () => {
		listCurrentOrganizationSkillsMock.mockResolvedValue({
			canManage: true,
			organizationId: "org-acme",
			skills: [],
		});
		createCurrentOrganizationSkillMock.mockResolvedValue({
			skill: createOrganizationSkillFixture({ id: "created-skill" }),
		});
		const { router } = renderPage();
		await openAddAction("Create skill");
		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "new-skill" },
		});
		fireEvent.change(screen.getByLabelText("Description"), {
			target: { value: "A shared working method." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create skill" }));
		await waitFor(() =>
			expect(router.state.location.pathname).toBe(
				"/o/acme/skills/created-skill"
			)
		);
		expect(createCurrentOrganizationSkillMock).toHaveBeenCalledWith({
			expectedOrganizationId: "org-acme",
			name: "new-skill",
			description: "A shared working method.",
			instructions: "",
		});
	});

	it("does not let an old Organization's delayed creation navigate or overwrite a new draft", async () => {
		listCurrentOrganizationSkillsMock.mockImplementation(
			async ({ organizationId }) => ({
				canManage: true,
				organizationId,
				skills: [],
			})
		);
		const pending = deferred<{ skill: OrganizationSkill }>();
		createCurrentOrganizationSkillMock.mockReturnValueOnce(pending.promise);
		const { router } = renderPage();
		await openAddAction("Create skill");
		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "acme-draft" },
		});
		fireEvent.change(screen.getByLabelText("Description"), {
			target: { value: "Acme method." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create skill" }));
		await waitFor(() =>
			expect(createCurrentOrganizationSkillMock).toHaveBeenCalledTimes(1)
		);
		await act(async () => {
			await router.navigate({
				to: "/o/$orgSlug/skills",
				params: { orgSlug: "beta" },
			});
		});
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		await openAddAction("Create skill");
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "beta-draft" },
		});
		await act(async () =>
			pending.resolve({
				skill: createOrganizationSkillFixture({ id: "acme-result" }),
			})
		);
		expect(router.state.location.pathname).toBe("/o/beta/skills");
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
			"beta-draft"
		);
	});
});

async function openAddAction(name: string) {
	fireEvent.click(await screen.findByRole("button", { name: "Add skill" }));
	fireEvent.click(await screen.findByRole("menuitem", { name }));
	await screen.findByRole("dialog");
}

function renderPage() {
	const queryClient = createTestQueryClient();
	const rootRoute = createRootRoute();
	const route = createRoute({
		component: OrganizationSkillsListPage,
		getParentRoute: () => rootRoute,
		path: "/o/$orgSlug/skills",
	});
	const detail = createRoute({
		getParentRoute: () => rootRoute,
		path: "/o/$orgSlug/skills/$skillId",
		component: () => <h1>{detail.useParams().skillId}</h1>,
	});
	const router = createRouter({
		history: createMemoryHistory({
			initialEntries: [`/o/${currentOrganizationMock.slug}/skills`],
		}),
		routeTree: rootRoute.addChildren([route, detail]),
	});
	const rendered = render(
		<TestQueryClientProvider queryClient={queryClient}>
			<div data-slot="scroll-area-viewport">
				<RouterProvider router={router} />
			</div>
		</TestQueryClientProvider>
	);
	return { ...rendered, router, queryClient };
}

function skillSummary(input: {
	description: string;
	id: string;
	name: string;
	enabled?: boolean;
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
		enabled: input.enabled ?? true,
		id: input.id,
		name: input.name,
		organizationId: "org-acme",
		permissions: { canEdit: false, canManage: false },
		source: { kind: "created" as const },
		updatedAt: "2026-07-26T08:00:00.000Z",
		version: 1,
	};
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {
		throw new Error("Deferred promise is not initialized.");
	};
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}
