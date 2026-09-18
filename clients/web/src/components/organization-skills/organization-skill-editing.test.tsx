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
	updateSkill
		.mockReset()
		.mockRejectedValue(new Error("The Skill changed. Reload before saving."));
});

describe("Organization Skill editing", () => {
	it.each([
		"instructions",
		"reference",
	] as const)("loads clean v2 %s into the real editor before accepting more input", async (surface) => {
		const { queryClient } = renderEditor([richSnapshot(1)]);
		await screen.findByLabelText("Name");
		openReference();
		expect(richEditor(surface).textContent).toBe(`${surface} v1 obsolete.`);
		expect(
			screen.getByText("references/checklist.md").closest("details")?.open
		).toBe(true);
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
		await screen.findByText("222222222222");
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

function richSnapshot(version: number) {
	const suffix = version === 1 ? "v1 obsolete." : `v${version} replacement.`;
	return skillSnapshot({
		version,
		instructions: `instructions ${suffix}`,
		referenceContent: `reference ${suffix}`,
	});
}

function openReference() {
	fireEvent.click(screen.getByText("references/checklist.md"));
}

function richEditor(surface: "instructions" | "reference"): HTMLElement {
	const region = document
		.querySelector(
			surface === "instructions"
				? "#skill-instructions-heading"
				: "#skill-files-heading"
		)
		?.closest("section");
	const editor = region?.querySelector("[data-slate-editor]");
	if (!(editor instanceof HTMLElement)) {
		throw new Error(`Missing real ${surface} editor`);
	}
	return editor;
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
			fireEvent.paste(editor, {
				clipboardData: {
					files: [],
					items: [],
					types: ["text/plain"],
					getData: (type: string) => (type === "text/plain" ? text : ""),
				},
			});
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
