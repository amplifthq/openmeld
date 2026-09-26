import type {
	OrganizationSkill,
	OrganizationSkillGitHubPreview,
} from "@openmeld/schemas/types";
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
	within,
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
const REVIEW_SKILL_PATTERN = /release-review/;
const HUGE_SKILL_PATTERN = /huge-skill/;

const {
	currentOrganizationMock,
	createCurrentOrganizationSkillMock,
	importCurrentOrganizationSkillFromGitHubMock,
	listCurrentOrganizationSkillsMock,
	previewCurrentOrganizationSkillFromGitHubMock,
	previewCurrentOrganizationSkillRepositoryMock,
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
	previewCurrentOrganizationSkillRepositoryMock: vi.fn(),
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
		previewCurrentOrganizationSkillRepository:
			previewCurrentOrganizationSkillRepositoryMock,
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
	previewCurrentOrganizationSkillRepositoryMock.mockReset();
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
		await act(() =>
			router.navigate({ to: "/o/$orgSlug/skills", params: { orgSlug: "acme" } })
		);
		await screen.findByText("second-skill");
		expect(
			(screen.getByLabelText("Search skills") as HTMLInputElement).value
		).toBe("second");
		expect(viewport.scrollTop).toBe(240);
		await act(() =>
			router.navigate({ to: "/o/$orgSlug/skills", params: { orgSlug: "beta" } })
		);
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
			screen.getByText("Add a working method for your agents.")
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
			skill: createOrganizationSkillFixture({
				id: "release-review",
				name: "release-review",
			}),
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
		expect(screen.getByText("1 file")).toBeTruthy();
		expect(
			screen.getByRole("region", { name: "Import warnings" })
		).toBeTruthy();
		fireEvent.click(screen.getByText("Technical details"));
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
		const { unmount } = renderPage();
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
		// An authentication/account replacement can unmount an in-flight surface.
		// This is distinct from ordinary router navigation, which is guarded below.
		unmount();
		Object.assign(currentOrganizationMock, {
			id: "org-beta",
			slug: "beta",
			name: "Beta",
		});
		const { router } = renderPage();
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

describe("Skill add flow protection", () => {
	beforeEach(() => {
		listCurrentOrganizationSkillsMock.mockImplementation(
			async ({ organizationId }) => ({
				organizationId,
				canManage: true,
				skills: [],
			})
		);
	});

	it.each([
		"cancel",
		"escape",
		"organization",
	] as const)("retains creation input until explicit discard through %s", async (exit) => {
		const { router } = renderPage();
		await openAddAction("Create skill");
		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "unsaved-skill" },
		});
		const leave = () => {
			if (exit === "organization") {
				act(() => {
					router.navigate({
						to: "/o/$orgSlug/skills",
						params: { orgSlug: "beta" },
					});
				});
			} else if (exit === "escape") {
				fireEvent.keyDown(
					screen.getByRole("dialog", { name: "Create skill" }),
					{ key: "Escape" }
				);
			} else {
				fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
			}
		};
		leave();
		let confirmation = await screen.findByRole("dialog", {
			name: "Discard this new skill?",
		});
		expect(within(confirmation).queryByText("Save and leave")).toBeNull();
		fireEvent.click(
			within(confirmation).getByRole("button", { name: "Cancel" })
		);
		await waitFor(() =>
			expect(
				screen.queryByRole("dialog", { name: "Discard this new skill?" })
			).toBeNull()
		);
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
			"unsaved-skill"
		);
		expect(router.state.location.pathname).toBe("/o/acme/skills");
		leave();
		confirmation = await screen.findByRole("dialog", {
			name: "Discard this new skill?",
		});
		fireEvent.click(
			within(confirmation).getByRole("button", { name: "Discard changes" })
		);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(createCurrentOrganizationSkillMock).not.toHaveBeenCalled();
		if (exit === "organization") {
			await waitFor(() =>
				expect(router.state.location.pathname).toBe("/o/beta/skills")
			);
		}
		await openAddAction("Create skill");
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
	});

	it("keeps a committing creation open, prevents duplicate writes and does not wait for catalog refresh", async () => {
		const pending = deferred<{ skill: OrganizationSkill }>();
		createCurrentOrganizationSkillMock.mockReturnValue(pending.promise);
		const { router, queryClient } = renderPage();
		await openAddAction("Create skill");
		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "new-method" },
		});
		fireEvent.change(screen.getByLabelText("Description"), {
			target: { value: "A working method." },
		});
		const submit = screen.getByRole("button", { name: "Create skill" });
		fireEvent.click(submit);
		fireEvent.click(submit);
		await waitFor(() =>
			expect(createCurrentOrganizationSkillMock).toHaveBeenCalledTimes(1)
		);
		fireEvent.keyDown(screen.getByRole("dialog", { name: "Create skill" }), {
			key: "Escape",
		});
		expect(screen.getByRole("dialog", { name: "Create skill" })).toBeTruthy();
		expect(
			(screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
				.disabled
		).toBe(true);
		listCurrentOrganizationSkillsMock.mockReturnValue(
			new Promise(() => undefined)
		);
		const saved = createOrganizationSkillFixture({
			id: "new-method",
			name: "new-method",
		});
		await act(() => pending.resolve({ skill: saved }));
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/o/acme/skills/new-method")
		);
		expect(
			queryClient.getQueryData(
				organizationSkillQueryKeys.detail("org-acme", "new-method")
			)
		).toEqual({ skill: saved });
	});

	it("lets a manager choose a Skill from a multi-Skill repository without installing blocked entries", async () => {
		const commitSha = "a".repeat(40);
		const selectedUrl = `https://github.com/acme/skills/tree/${commitSha}/release-review`;
		previewCurrentOrganizationSkillFromGitHubMock
			.mockRejectedValueOnce(
				Object.assign(new Error("Select a Skill"), {
					upstreamCode: "organization_skill.github_selection_required",
				})
			)
			.mockResolvedValueOnce({
				organizationId: "org-acme",
				preview: previewFixture("release-review", "a"),
			});
		previewCurrentOrganizationSkillRepositoryMock.mockResolvedValue({
			organizationId: "org-acme",
			preview: {
				catalogLimitBytes: 1024,
				commitSha,
				repository: "https://github.com/acme/skills",
				totalDeclaredBytes: 30,
				warnings: [],
				skills: [
					{
						blocker: null,
						fileCount: 1,
						path: "release-review",
						totalBytes: 10,
						url: selectedUrl,
						warnings: [],
					},
					{
						blocker: { code: "too_large", message: "This Skill is too large." },
						fileCount: 2,
						path: "huge-skill",
						totalBytes: 20,
						url: `https://github.com/acme/skills/tree/${commitSha}/huge-skill`,
						warnings: [],
					},
				],
			},
		});
		const { router } = renderPage();
		await openAddAction("Install from GitHub");
		fireEvent.change(screen.getByLabelText("GitHub URL"), {
			target: { value: "https://github.com/acme/skills" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Review skill" }));
		await waitFor(() =>
			expect(
				previewCurrentOrganizationSkillRepositoryMock
			).toHaveBeenCalledTimes(1)
		);
		const selected = await screen.findByRole("button", {
			name: REVIEW_SKILL_PATTERN,
		});
		expect(
			screen.getByRole("button", { name: HUGE_SKILL_PATTERN })
		).toHaveProperty("disabled", true);
		fireEvent.click(selected);
		await screen.findByRole("button", { name: "Install skill" });
		expect(
			previewCurrentOrganizationSkillFromGitHubMock
		).toHaveBeenLastCalledWith({
			expectedOrganizationId: "org-acme",
			url: selectedUrl,
		});
		expect(router.state.location.pathname).toBe("/o/acme/skills");
	});

	it("keeps only the preview for the latest URL and preserves a failed installation for retry", async () => {
		const old = deferred<{
			organizationId: string;
			preview: OrganizationSkillGitHubPreview;
		}>();
		previewCurrentOrganizationSkillFromGitHubMock
			.mockReturnValueOnce(old.promise)
			.mockResolvedValueOnce({
				organizationId: "org-acme",
				preview: previewFixture("new-method", "b"),
			});
		importCurrentOrganizationSkillFromGitHubMock
			.mockRejectedValueOnce(new Error("Network failed"))
			.mockResolvedValueOnce({
				skill: createOrganizationSkillFixture({ id: "new-method" }),
			});
		const { router } = renderPage();
		await openAddAction("Install from GitHub");
		fireEvent.change(screen.getByLabelText("GitHub URL"), {
			target: { value: "https://github.com/acme/old" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Review skill" }));
		await waitFor(() =>
			expect(
				previewCurrentOrganizationSkillFromGitHubMock
			).toHaveBeenCalledTimes(1)
		);
		fireEvent.change(screen.getByLabelText("GitHub URL"), {
			target: { value: "https://github.com/acme/new" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Review skill" }));
		await screen.findByText("new-method");
		await act(() =>
			old.resolve({
				organizationId: "org-acme",
				preview: previewFixture("old-method", "a"),
			})
		);
		expect(screen.queryByText("old-method")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Install skill" }));
		await screen.findByRole("alert");
		expect(screen.getByText("new-method")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Install skill" }));
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/o/acme/skills/new-method")
		);
		for (const [payload] of importCurrentOrganizationSkillFromGitHubMock.mock
			.calls) {
			expect(payload).toEqual({
				expectedOrganizationId: "org-acme",
				expectedCommitSha: "b".repeat(40),
				url: "https://github.com/acme/new",
			});
		}
	});

	it("discards a pending preview on organization navigation without letting its late result replace the next form", async () => {
		const pending = deferred<{
			organizationId: string;
			preview: OrganizationSkillGitHubPreview;
		}>();
		previewCurrentOrganizationSkillFromGitHubMock.mockReturnValue(
			pending.promise
		);
		const { router } = renderPage();
		await openAddAction("Install from GitHub");
		fireEvent.change(screen.getByLabelText("GitHub URL"), {
			target: { value: "https://github.com/acme/old" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Review skill" }));
		act(() => {
			router.navigate({
				to: "/o/$orgSlug/skills",
				params: { orgSlug: "beta" },
			});
		});
		fireEvent.click(
			await screen.findByRole("button", { name: "Discard changes" })
		);
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/o/beta/skills")
		);
		await openAddAction("Install from GitHub");
		fireEvent.change(screen.getByLabelText("GitHub URL"), {
			target: { value: "https://github.com/beta/new" },
		});
		await act(() =>
			pending.resolve({
				organizationId: "org-acme",
				preview: previewFixture("old-method", "a"),
			})
		);
		expect(screen.queryByText("old-method")).toBeNull();
		expect(
			(screen.getByLabelText("GitHub URL") as HTMLInputElement).value
		).toBe("https://github.com/beta/new");
		expect(importCurrentOrganizationSkillFromGitHubMock).not.toHaveBeenCalled();
	});
});

function previewFixture(
	name: string,
	digest: string
): OrganizationSkillGitHubPreview {
	const skill = createOrganizationSkillFixture({
		name,
		referenceContent: "Reference.",
	});
	return {
		portable: skill.bundle.portable,
		instructionsCharacters: skill.bundle.instructions.length,
		files: skill.bundle.files.map(({ content: _content, ...file }) => file),
		source: {
			kind: "github",
			repository: "https://github.com/acme/skills",
			path: name,
			commitSha: digest.repeat(40),
		},
		warnings: [],
	};
}

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
