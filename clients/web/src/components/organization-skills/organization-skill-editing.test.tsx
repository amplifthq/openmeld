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
import { createOrganizationSkillFixture as skillSnapshot } from "#/test-support/organization-skill";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { OrganizationSkillDetailPage } from "./organization-skill-detail-page";

const { getSkill, updateSkill } = vi.hoisted(() => ({
	getSkill: vi.fn(),
	updateSkill: vi.fn(),
}));

vi.mock("#/lib/organizations/organization-skills", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("#/lib/organizations/organization-skills")
	>()),
	getCurrentOrganizationSkill: getSkill,
	updateCurrentOrganizationSkill: updateSkill,
}));

// Only the authorized account projection is supplied by the harness. Navigation,
// Query, the editor, and the shared UnsavedChangesGuard all run unchanged.
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => {
		const { orgSlug } = useParams({ strict: false });
		return {
			currentOrganization: {
				id: `org-${orgSlug}`,
				slug: orgSlug,
				name: orgSlug,
			},
		};
	},
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
beforeEach(() => {
	vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
	getSkill.mockReset();
	updateSkill
		.mockReset()
		.mockRejectedValue(new Error("The Skill changed. Reload before saving."));
});

describe("Organization Skill editing", () => {
	it("keeps a dirty v1 draft paired with its v1 concurrency baseline after v2 is fetched", async () => {
		const v1 = skillSnapshot();
		const { queryClient } = renderEditor([v1]);
		fireEvent.change(await screen.findByLabelText("Name"), {
			target: { value: "my-draft" },
		});
		const v2 = skillSnapshot({ version: 2, name: "someone-elses-update" });
		act(() =>
			queryClient.setQueryData(
				organizationSkillQueryKeys.detail("org-acme", v1.id),
				{ skill: v2 }
			)
		);
		await screen.findByText("222222222222");
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(updateSkill).toHaveBeenCalled());
		expect(updateSkill.mock.calls[0]?.[0]).toMatchObject({
			expectedOrganizationId: "org-acme",
			skillId: "skill-one",
			expectedVersion: 1,
			expectedActiveReleaseId: "skill-one-release-1",
			bundle: { portable: { name: "my-draft" } },
		});
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
			"my-draft"
		);
	});

	it("preserves the draft and its guard when a background refresh fails", async () => {
		const v1 = skillSnapshot();
		const { queryClient } = renderEditor([v1]);
		fireEvent.change(await screen.findByLabelText("Name"), {
			target: { value: "offline-draft" },
		});
		getSkill.mockRejectedValue(new Error("Temporary network failure"));
		await act(() =>
			queryClient.refetchQueries({
				queryKey: organizationSkillQueryKeys.detail("org-acme", v1.id),
				exact: true,
			})
		);
		await waitFor(() =>
			expect(
				queryClient.getQueryState(
					organizationSkillQueryKeys.detail("org-acme", v1.id)
				)?.status
			).toBe("error")
		);
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
			"offline-draft"
		);
		fireEvent.click(screen.getByRole("link", { name: "All Skills" }));
		fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
		fireEvent.click(await screen.findByRole("button", { name: "Save" }));
		await waitFor(() => expect(updateSkill).toHaveBeenCalled());
		expect(updateSkill.mock.calls[0]?.[0]).toMatchObject({
			expectedVersion: 1,
			expectedActiveReleaseId: "skill-one-release-1",
			bundle: { portable: { name: "offline-draft" } },
		});
	});

	it("adopts a refreshed snapshot consistently when the editor is clean", async () => {
		const v1 = skillSnapshot();
		const { queryClient } = renderEditor([v1]);
		await screen.findByLabelText("Name");
		const v2 = skillSnapshot({ version: 2, name: "new-server-name" });
		act(() =>
			queryClient.setQueryData(
				organizationSkillQueryKeys.detail("org-acme", v1.id),
				{ skill: v2 }
			)
		);
		await waitFor(() =>
			expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
				"new-server-name"
			)
		);
		expect(
			(
				screen.getByRole("button", {
					name: "Save",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
	});

	it.each([
		{ id: "skill-two", orgSlug: "acme" },
		{ id: "skill-one", orgSlug: "beta" },
	])("isolates the cached editor for $orgSlug/$id", async ({ id, orgSlug }) => {
		const { router } = renderEditor([
			skillSnapshot(),
			skillSnapshot({ id, orgSlug, name: "second-skill" }),
		]);
		await screen.findByLabelText("Name");
		await act(() => router.navigate({ to: `/o/${orgSlug}/skills/${id}` }));
		await waitFor(() =>
			expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
				"second-skill"
			)
		);
		expect(
			(
				screen.getByRole("button", {
					name: "Save",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
	});

	it("adopts the saved canonical bundle and advances the baseline for the next Save", async () => {
		updateSkill.mockResolvedValue({
			skill: skillSnapshot({ version: 2, name: "saved-name" }),
		});
		renderEditor([skillSnapshot()]);
		fireEvent.change(await screen.findByLabelText("Name"), {
			target: { value: "  saved-name  " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
				"saved-name"
			)
		);
		expect(
			(
				screen.getByRole("button", {
					name: "Save",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		fireEvent.change(screen.getByLabelText("Description"), {
			target: { value: "My next edit." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(updateSkill).toHaveBeenCalledTimes(2));
		expect(updateSkill.mock.calls[1]?.[0]).toMatchObject({
			expectedVersion: 2,
			expectedActiveReleaseId: "skill-one-release-2",
		});
	});

	it("preserves queued input during Save without downgrading a newer cached release", async () => {
		const pending = deferred<{ skill: OrganizationSkill }>();
		updateSkill.mockReturnValueOnce(pending.promise);
		const { queryClient } = renderEditor([skillSnapshot()]);
		fireEvent.change(await screen.findByLabelText("Name"), {
			target: { value: "submitted-name" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(updateSkill).toHaveBeenCalledTimes(1));
		// An already queued editor callback may arrive after controls disable.
		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "newer-local-input" },
		});
		act(() =>
			queryClient.setQueryData(
				organizationSkillQueryKeys.detail("org-acme", "skill-one"),
				{ skill: skillSnapshot({ version: 3, name: "another-editor" }) }
			)
		);
		await act(async () =>
			pending.resolve({
				skill: skillSnapshot({ version: 2, name: "submitted-name" }),
			})
		);
		await waitFor(() =>
			expect(
				(
					screen.getByRole("button", {
						name: "Save",
					}) as HTMLButtonElement
				).disabled
			).toBe(false)
		);
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
			"newer-local-input"
		);
		expect(
			queryClient.getQueryData(
				organizationSkillQueryKeys.detail("org-acme", "skill-one")
			)
		).toMatchObject({ skill: { version: 3 } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(updateSkill).toHaveBeenCalledTimes(2));
		expect(updateSkill.mock.calls[1]?.[0]).toMatchObject({
			expectedVersion: 2,
			expectedActiveReleaseId: "skill-one-release-2",
			bundle: { portable: { name: "newer-local-input" } },
		});
	});

	it.each([
		{ role: "member", canEdit: false, canManage: false },
		{ role: "maintainer", canEdit: true, canManage: false },
		{ role: "manager", canEdit: true, canManage: true },
	])("keeps $role controls limited to the server permissions", async ({
		canEdit,
		canManage,
	}) => {
		const skill = skillSnapshot();
		skill.permissions = { canEdit, canManage };
		renderEditor([skill]);
		expect(
			((await screen.findByLabelText("Name")) as HTMLInputElement).disabled
		).toBe(!canEdit);
		expect(Boolean(screen.queryByRole("button", { name: "Save" }))).toBe(
			canEdit
		);
		expect(
			Boolean(
				screen.queryByRole("switch", { name: "Enable Organization Skill" })
			)
		).toBe(canManage);
		expect(Boolean(screen.queryByRole("button", { name: "Maintainers" }))).toBe(
			canManage
		);
		expect(Boolean(screen.queryByRole("button", { name: "Remove" }))).toBe(
			canManage
		);
	});
});

function renderEditor(skills: OrganizationSkill[]) {
	const queryClient = createTestQueryClient();
	for (const skill of skills) {
		queryClient.setQueryData(
			organizationSkillQueryKeys.detail(skill.organizationId, skill.id),
			{ skill }
		);
	}
	const root = createRootRoute();
	const detail = createRoute({
		getParentRoute: () => root,
		path: "/o/$orgSlug/skills/$skillId",
		component: () => (
			<OrganizationSkillDetailPage skillId={detail.useParams().skillId} />
		),
	});
	const list = createRoute({
		getParentRoute: () => root,
		path: "/o/$orgSlug/skills",
		component: () => <h1>Skills catalog</h1>,
	});
	const router = createRouter({
		history: createMemoryHistory({
			initialEntries: ["/o/acme/skills/skill-one"],
		}),
		routeTree: root.addChildren([detail, list]),
	});
	render(
		<TestQueryClientProvider queryClient={queryClient}>
			<RouterProvider router={router} />
		</TestQueryClientProvider>
	);
	return { queryClient, router };
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
