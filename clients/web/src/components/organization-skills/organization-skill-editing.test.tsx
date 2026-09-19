import type { OrganizationSkill } from "@openmeld/schemas/types";
import { QueryObserver } from "@tanstack/react-query";
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

const { getSkill, updateSkill, getPlatform } = vi.hoisted(() => ({
	getSkill: vi.fn(),
	updateSkill: vi.fn(),
	getPlatform: vi.fn(),
}));

// Native bridge is an external boundary; editing and navigation stay real.
vi.mock("#/desktop/platform", () => ({ getDesktopPlatform: getPlatform }));

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

const originalContentEditable = Object.getOwnPropertyDescriptor(
	HTMLElement.prototype,
	"isContentEditable"
);

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	if (originalContentEditable) {
		Object.defineProperty(
			HTMLElement.prototype,
			"isContentEditable",
			originalContentEditable
		);
	} else {
		Reflect.deleteProperty(HTMLElement.prototype, "isContentEditable");
	}
});
beforeEach(() => {
	// jsdom lacks this browser property; Slate checks the inherited editable state.
	Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
		configurable: true,
		get() {
			return (
				this.closest("[contenteditable]")?.getAttribute("contenteditable") ===
				"true"
			);
		},
	});
	vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
	getSkill.mockReset();
	getPlatform.mockReset().mockReturnValue(null);
	updateSkill
		.mockReset()
		.mockRejectedValue(new Error("The Skill changed. Reload before saving."));
});

describe("Organization Skill editing", () => {
	it.each([
		"pending",
		"failed",
	] as const)("does not turn a saved document into a failed or blocked Save when catalog refresh is %s", async (outcome) => {
		const saved = skillSnapshot({ version: 2, name: "saved-method" });
		updateSkill.mockResolvedValueOnce({ skill: saved });
		const { queryClient, router } = renderEditor([skillSnapshot()]);
		const observer = new QueryObserver(queryClient, {
			queryKey: organizationSkillQueryKeys.list("org-acme"),
			initialData: { organizationId: "org-acme", canManage: true, skills: [] },
			staleTime: Number.POSITIVE_INFINITY,
			retry: false,
			queryFn: () =>
				outcome === "pending"
					? new Promise<never>(() => undefined)
					: Promise.reject(new Error("Catalog unavailable")),
		});
		const unsubscribe = observer.subscribe(() => undefined);
		try {
			fireEvent.change(await screen.findByLabelText("Name"), {
				target: { value: "saved-method" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Save" }));
			await waitFor(() =>
				expect(screen.getByLabelText("Skill save status").textContent).toBe(
					"Saved"
				)
			);
			if (outcome === "failed") {
				await screen.findByText(
					"Your change was saved, but the catalog could not refresh."
				);
			}
			expect(screen.queryByText("Couldn't save")).toBeNull();
			fireEvent.click(screen.getByRole("link", { name: "All Skills" }));
			await waitFor(() =>
				expect(router.state.location.pathname).toBe("/o/acme/skills")
			);
			expect(updateSkill).toHaveBeenCalledTimes(1);
		} finally {
			unsubscribe();
			queryClient.clear();
		}
	});

	it("saves Instructions, two lazily opened references and Properties as one guarded draft", async () => {
		const snapshot = richSnapshot(1);
		snapshot.bundle.files.push({
			...snapshot.bundle.files[0],
			path: "references/second.md",
			content: "Second reference.",
			size: 17,
		});
		snapshot.bundle.portable.metadata = { topic: "support", team: "product" };
		renderEditor([snapshot]);
		await screen.findByLabelText("Name");
		await appendRichText(richEditor("instructions"), "ONE");
		await appendRichText(richEditor("reference"), "TWO");
		const firstEditor = screen.getByLabelText("references/checklist.md", {
			selector: "[data-slate-editor]",
		});
		fireEvent.click(screen.getByText("references/second.md"));
		expect(document.contains(firstEditor)).toBe(true);
		expect(firstEditor.closest("[hidden]")).not.toBeNull();
		await appendRichText(
			screen.getByLabelText("references/second.md"),
			"THREE"
		);
		openReference();
		expect(richEditor("reference")).toBe(firstEditor);
		expect(richEditor("reference").textContent).toBe(
			"reference v1 obsolete.TWO"
		);
		await openContext("Properties");
		fireEvent.change(screen.getByLabelText("License"), {
			target: { value: "MIT" },
		});
		const key = screen.getByLabelText("Metadata key topic");
		key.focus();
		fireEvent.change(key, { target: { value: "category" } });
		expect(screen.getByLabelText("Metadata key category")).toBe(key);
		expect(document.activeElement).toBe(key);
		fireEvent.change(key, { target: { value: "team" } });
		await screen.findByText("A metadata field with that name already exists.");
		fireEvent.change(key, { target: { value: "" } });
		expect(screen.getByRole("dialog").textContent).toContain(
			"Give every metadata field a name in Properties."
		);
		expect(
			(screen.getByRole("button", { name: "Save skill" }) as HTMLButtonElement)
				.disabled
		).toBe(true);
		fireEvent.change(key, { target: { value: "category" } });
		expect(screen.getByLabelText("Properties save status").textContent).toBe(
			"Unsaved changes"
		);
		expect(
			(screen.getByLabelText("Metadata value team") as HTMLInputElement).value
		).toBe("product");
		fireEvent.click(screen.getByText("Close", { selector: "button" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		fireEvent.click(screen.getByRole("link", { name: "All Skills" }));
		fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		await openContext("Properties");
		expect((screen.getByLabelText("License") as HTMLInputElement).value).toBe(
			"MIT"
		);
		fireEvent.click(screen.getByRole("button", { name: "Save skill" }));
		await screen.findByText("OpenMeld couldn't save this Skill. Try again.");
		expect(updateSkill).toHaveBeenCalledTimes(1);
		expect(updateSkill.mock.calls[0]?.[0]).toMatchObject({
			expectedVersion: 1,
			expectedActiveReleaseId: "skill-one-release-1",
			bundle: {
				instructions: "instructions v1 obsolete.ONE\n",
				portable: {
					license: "MIT",
					metadata: { category: "support", team: "product" },
				},
				files: [
					expect.objectContaining({
						path: "references/checklist.md",
						content: "reference v1 obsolete.TWO\n",
					}),
					expect.objectContaining({
						path: "references/second.md",
						content: "Second reference.THREE\n",
					}),
				],
			},
		});
	});

	it.each([
		null,
		"http://lane.localhost:31952",
	])("keeps saved identity and reports actual clipboard outcomes with Web origin %s", async (webOrigin) => {
		if (webOrigin) {
			getPlatform.mockReturnValue({ platform: async () => ({ webOrigin }) });
		}
		const snapshot = richSnapshot(1);
		snapshot.enabled = false;
		const clipboard = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: clipboard },
		});
		try {
			renderEditor([snapshot]);
			fireEvent.change(await screen.findByLabelText("Name"), {
				target: { value: "unsaved-name" },
			});
			await openContext("How agents use this skill");
			expect(
				screen.getByText("first-skill", { selector: "strong" })
			).toBeTruthy();
			expect(
				screen.queryByText("unsaved-name", { selector: "strong" })
			).toBeNull();
			expect(
				screen.getByText(
					"This skill is disabled. A workspace admin must enable it before agents can load it."
				)
			).toBeTruthy();
			expect(document.querySelector("code")?.textContent).not.toContain(
				"skills load"
			);
			fireEvent.click(screen.getByText("Close", { selector: "button" }));
			await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
			await openContext("Copy link", false);
			await screen.findByText("Link copied");
			expect(clipboard).toHaveBeenCalledWith(
				new URL("/o/acme/skills/skill-one", webOrigin ?? window.location.origin)
					.href
			);
			clipboard.mockRejectedValue(new Error("Clipboard unavailable"));
			await openContext("Copy link", false);
			await screen.findByText(
				"Could not copy the link. Copy the page address instead."
			);
			expect(updateSkill).not.toHaveBeenCalled();
		} finally {
			Reflect.deleteProperty(navigator, "clipboard");
		}
	});

	it.each([
		"instructions",
		"reference",
	] as const)("loads clean v2 %s into the real editor before accepting more input", async (surface) => {
		const { queryClient } = renderEditor([richSnapshot(1)]);
		await screen.findByLabelText("Name");
		openReference();
		expect(richEditor(surface).textContent).toBe(`${surface} v1 obsolete.`);
		expect(
			screen
				.getByText("references/checklist.md")
				.closest("button")
				?.getAttribute("aria-expanded")
		).toBe("true");
		act(() =>
			queryClient.setQueryData(
				organizationSkillQueryKeys.detail("org-acme", "skill-one"),
				{ skill: richSnapshot(2) }
			)
		);
		await waitFor(() =>
			expect(richEditor(surface).textContent).toBe(`${surface} v2 replacement.`)
		);
		expect(
			(screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
				.disabled
		).toBe(true);
		const loaded = richEditor(surface);
		expect(loaded.getAttribute("contenteditable")).toBe("true");
		// Focusing/selecting without changing text is not an edit.
		await appendRichText(loaded, "");
		expect(
			(screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
				.disabled
		).toBe(true);
		await appendRichText(loaded, "ADDED");
		expect(document.activeElement).toBe(loaded);
		expect(richEditor(surface)).toBe(loaded);
		expect(richEditor(surface).textContent).toBe(
			`${surface} v2 replacement.ADDED`
		);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(updateSkill).toHaveBeenCalledTimes(1));
		expect(updateSkill.mock.calls[0]?.[0]).toMatchObject({
			expectedVersion: 2,
			expectedActiveReleaseId: "skill-one-release-2",
			bundle: {
				instructions:
					surface === "instructions"
						? "instructions v2 replacement.ADDED\n"
						: "instructions v2 replacement.",
				files: [
					expect.objectContaining({
						path: "references/checklist.md",
						content:
							surface === "reference"
								? "reference v2 replacement.ADDED\n"
								: "reference v2 replacement.",
					}),
				],
			},
		});
		expect(JSON.stringify(updateSkill.mock.calls[0]?.[0])).not.toContain(
			"obsolete"
		);
	});

	it("retains dirty Instructions and reference contents with the v1 baseline after v2 and a conflict", async () => {
		const { queryClient, router } = renderEditor([richSnapshot(1)]);
		await screen.findByLabelText("Name");
		openReference();
		await appendRichText(richEditor("instructions"), "LOCAL-INSTRUCTIONS");
		await appendRichText(richEditor("reference"), "LOCAL-REFERENCE");
		const instructions = richEditor("instructions");
		const reference = richEditor("reference");
		act(() =>
			queryClient.setQueryData(
				organizationSkillQueryKeys.detail("org-acme", "skill-one"),
				{ skill: richSnapshot(2) }
			)
		);
		await inspectVersionTwo();
		expect(richEditor("instructions")).toBe(instructions);
		expect(richEditor("reference")).toBe(reference);
		expect(instructions.textContent).toBe(
			"instructions v1 obsolete.LOCAL-INSTRUCTIONS"
		);
		expect(reference.textContent).toBe("reference v1 obsolete.LOCAL-REFERENCE");
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await screen.findByRole("alert");
		expect(updateSkill.mock.calls[0]?.[0]).toMatchObject({
			expectedVersion: 1,
			expectedActiveReleaseId: "skill-one-release-1",
			bundle: {
				instructions: "instructions v1 obsolete.LOCAL-INSTRUCTIONS\n",
				files: [
					expect.objectContaining({
						content: "reference v1 obsolete.LOCAL-REFERENCE\n",
					}),
				],
			},
		});
		fireEvent.click(screen.getByRole("link", { name: "All Skills" }));
		fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(router.state.location.pathname).toBe("/o/acme/skills/skill-one");
		expect(instructions.textContent).toBe(
			"instructions v1 obsolete.LOCAL-INSTRUCTIONS"
		);
		expect(reference.textContent).toBe("reference v1 obsolete.LOCAL-REFERENCE");
	});

	it("loads canonical saved rich text into both editors before the next edit", async () => {
		updateSkill
			.mockResolvedValueOnce({ skill: richSnapshot(2) })
			.mockResolvedValueOnce({ skill: richSnapshot(3) });
		renderEditor([richSnapshot(1)]);
		await screen.findByLabelText("Name");
		openReference();
		await appendRichText(richEditor("instructions"), "SUBMITTED");
		await appendRichText(richEditor("reference"), "SUBMITTED");
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(richEditor("instructions").textContent).toBe(
				"instructions v2 replacement."
			)
		);
		expect(richEditor("reference").textContent).toBe(
			"reference v2 replacement."
		);
		expect(
			(screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
				.disabled
		).toBe(true);
		await appendRichText(richEditor("instructions"), "NEXT");
		await appendRichText(richEditor("reference"), "NEXT");
		fireEvent.click(screen.getByRole("link", { name: "All Skills" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Save and leave" })
		);
		await screen.findByRole("heading", { name: "Skills catalog" });
		expect(updateSkill).toHaveBeenCalledTimes(2);
		expect(updateSkill.mock.calls[1]?.[0]).toMatchObject({
			expectedVersion: 2,
			expectedActiveReleaseId: "skill-one-release-2",
			bundle: {
				instructions: "instructions v2 replacement.NEXT\n",
				files: [
					expect.objectContaining({
						content: "reference v2 replacement.NEXT\n",
					}),
				],
			},
		});
	});

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
		await inspectVersionTwo();
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

	it.each([
		"instructions",
		"reference",
	] as const)("keeps queued %s edits mounted when Save accepts its earlier submission", async (surface) => {
		const pending = deferred<{ skill: OrganizationSkill }>();
		updateSkill.mockReturnValueOnce(pending.promise);
		renderEditor([richSnapshot(1)]);
		await screen.findByLabelText("Name");
		openReference();
		await appendRichText(richEditor("instructions"), "SUBMITTED");
		await appendRichText(richEditor("reference"), "SUBMITTED");
		const instructions = richEditor("instructions");
		const reference = richEditor("reference");
		// Deliver a real edit in the same event turn after Save captures its
		// submission, before React commits disabled controls. No callback mock.
		await appendRichText(richEditor(surface), "QUEUED", () =>
			fireEvent.click(screen.getByRole("button", { name: "Save" }))
		);
		await waitFor(() => expect(updateSkill).toHaveBeenCalledTimes(1));
		expect(updateSkill.mock.calls[0]?.[0]).toMatchObject({
			bundle: {
				instructions: "instructions v1 obsolete.SUBMITTED\n",
				files: [
					expect.objectContaining({
						content: "reference v1 obsolete.SUBMITTED\n",
					}),
				],
			},
		});
		await act(async () => pending.resolve({ skill: richSnapshot(2) }));
		await waitFor(() =>
			expect(
				(screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
					.disabled
			).toBe(false)
		);
		expect(richEditor("instructions")).toBe(instructions);
		expect(richEditor("reference")).toBe(reference);
		expect(richEditor(surface).textContent).toBe(
			`${surface} v1 obsolete.SUBMITTEDQUEUED`
		);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(updateSkill).toHaveBeenCalledTimes(2));
		expect(updateSkill.mock.calls[1]?.[0]).toMatchObject({
			expectedVersion: 2,
			expectedActiveReleaseId: "skill-one-release-2",
			bundle: {
				instructions: `instructions v1 obsolete.SUBMITTED${surface === "instructions" ? "QUEUED" : ""}\n`,
				files: [
					expect.objectContaining({
						content: `reference v1 obsolete.SUBMITTED${surface === "reference" ? "QUEUED" : ""}\n`,
					}),
				],
			},
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
		await screen.findByRole("heading", { name: skill.name });
		expect(Boolean(screen.queryByLabelText("Name"))).toBe(canEdit);
		expect(
			screen
				.getByLabelText("Instructions", { selector: "[data-slate-editor]" })
				.getAttribute("contenteditable")
		).toBe(String(canEdit));
		expect(Boolean(screen.queryByRole("button", { name: "Save" }))).toBe(
			canEdit
		);
		fireEvent.click(screen.getByRole("button", { name: "More actions" }));
		expect(
			Boolean(await screen.findByRole("menuitem", { name: "Properties" }))
		).toBe(true);
		expect(
			Boolean(screen.queryByRole("menuitem", { name: "Disable skill" }))
		).toBe(canManage);
		expect(
			Boolean(screen.queryByRole("menuitem", { name: "Manage maintainers" }))
		).toBe(canManage);
		expect(
			Boolean(screen.queryByRole("menuitem", { name: "Remove skill" }))
		).toBe(canManage);
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

function richSnapshot(version: number) {
	const suffix = version === 1 ? "v1 obsolete." : `v${version} replacement.`;
	return skillSnapshot({
		version,
		instructions: `instructions ${suffix}`,
		referenceContent: `reference ${suffix}`,
	});
}

const FILES_TAB_NAME = /^Files \(/;

function openReference() {
	const tab = screen.getByRole("tab", { name: FILES_TAB_NAME });
	if (tab.getAttribute("aria-selected") !== "true") {
		fireEvent.click(tab);
	}
	const row = screen.getByText("references/checklist.md").closest("button");
	if (row?.getAttribute("aria-expanded") !== "true") {
		fireEvent.click(screen.getByText("references/checklist.md"));
	}
}

// Drive the real local tabs before finding a visible editing surface.
function richEditor(surface: "instructions" | "reference"): HTMLElement {
	if (surface === "reference") {
		openReference();
	} else {
		const tab = screen.queryByRole("tab", { name: "Instructions" });
		if (tab && tab.getAttribute("aria-selected") !== "true") {
			fireEvent.click(tab);
		}
	}
	return screen.getByLabelText(
		surface === "instructions" ? "Instructions" : "references/checklist.md",
		{ selector: "[data-slate-editor]" }
	);
}

async function openContext(name: string, expectDialog = true) {
	fireEvent.click(screen.getByRole("button", { name: "More actions" }));
	fireEvent.click(await screen.findByRole("menuitem", { name }));
	if (expectDialog) {
		await screen.findByRole("dialog");
	}
}

async function inspectVersionTwo() {
	fireEvent.click(screen.getByRole("button", { name: "More actions" }));
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Version history" })
	);
	fireEvent.click(await screen.findByText("Release details"));
	await screen.findByText("2".repeat(64));
	fireEvent.click(screen.getByText("Close", { selector: "button" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

async function appendRichText(
	editor: HTMLElement,
	text: string,
	beforePaste?: () => void
) {
	const before = editor.textContent;
	vi.useFakeTimers();
	try {
		await act(async () => {
			editor.focus();
			const range = document.createRange();
			const textNode = editor
				.querySelectorAll("[data-slate-string]")
				.item(
					editor.querySelectorAll("[data-slate-string]").length - 1
				)?.firstChild;
			if (!textNode) {
				throw new Error("Missing rich-text leaf");
			}
			range.setStart(textNode, textNode.textContent?.length ?? 0);
			range.collapse(true);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			document.dispatchEvent(new Event("selectionchange"));
			// Flush Slate's throttled DOM selection synchronization before pasting.
			await vi.advanceTimersByTimeAsync(101);
			beforePaste?.();
			if (text) {
				fireEvent.paste(editor, {
					clipboardData: {
						files: [],
						items: [],
						types: ["text/plain"],
						getData: (type: string) => (type === "text/plain" ? text : ""),
					},
				});
			}
			await vi.advanceTimersByTimeAsync(0);
		});
	} finally {
		vi.useRealTimers();
	}
	await waitFor(() => expect(editor.textContent).toBe(`${before}${text}`));
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
