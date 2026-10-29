import { MAX_SPACE_GUIDE_LENGTH } from "@openmeld/schemas";
import type { SpaceMeta } from "@openmeld/schemas/types";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Link,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnsavedChangesGuard } from "#/components/forms/unsaved-changes-guard";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { useSpaceGuideDraft } from "./space-guide-draft";
import { SpaceGuidePanel } from "./space-guide-panel";
import {
	saveSpaceGuideBeforeLeaving,
	useSpaceGuideSaver,
} from "./space-guide-save";

const CHARACTER_COUNT_TEXT = /characters/;

const { getMetaMock, toastSuccessMock, updateMetaMock } = vi.hoisted(() => ({
	getMetaMock: vi.fn(),
	toastSuccessMock: vi.fn(),
	updateMetaMock: vi.fn(),
}));

vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: () => ({
		getMeta: getMetaMock,
		updateMeta: updateMetaMock,
	}),
}));

vi.mock("#/query/spaces/retry", () => ({
	shouldRetrySpaceQuery: () => false,
}));

vi.mock("sonner", () => ({
	toast: { success: toastSuccessMock },
}));

function spaceMeta(guide?: string): SpaceMeta {
	return { ...(guide === undefined ? {} : { guide }) } as SpaceMeta;
}

/**
 * Mirrors Space landing: the draft and its leave guard live outside the
 * panel, and switching Space tabs unmounts the panel.
 */
function GuideHarness(input: { canEdit: boolean }) {
	const guideDraft = useSpaceGuideDraft("space-1");
	const guideSaver = useSpaceGuideSaver({
		onSaved: guideDraft.onSaved,
		openMeldProfileId: "profile-1",
		spaceId: "space-1",
	});
	const [panelOpen, setPanelOpen] = useState(true);
	return (
		<>
			<UnsavedChangesGuard
				allowSamePageNavigation
				description="Your changes to this Space's guide haven't been saved."
				hasUnsavedChanges={guideDraft.hasUnsavedChanges}
				onDiscard={guideDraft.discard}
				onSave={() => saveSpaceGuideBeforeLeaving(guideDraft.draft, guideSaver)}
				saving={guideSaver.isPending}
			/>
			<Link to="/privacy">Leave Space</Link>
			<button onClick={() => setPanelOpen((open) => !open)} type="button">
				Toggle panel
			</button>
			{panelOpen ? (
				<SpaceGuidePanel
					canEdit={input.canEdit}
					draft={guideDraft.draft}
					onDraftChange={guideDraft.onDraftChange}
					openMeldProfileId="profile-1"
					saver={guideSaver}
					spaceId="space-1"
				/>
			) : null}
		</>
	);
}

function renderGuide(input: { canEdit: boolean }) {
	const rootRoute = createRootRoute({
		component: () => (
			<TestQueryClientProvider>
				<Outlet />
			</TestQueryClientProvider>
		),
	});
	const spaceRoute = createRoute({
		component: () => <GuideHarness canEdit={input.canEdit} />,
		getParentRoute: () => rootRoute,
		path: "/space",
	});
	const elsewhereRoute = createRoute({
		component: () => <h1>Somewhere else</h1>,
		getParentRoute: () => rootRoute,
		path: "/privacy",
	});
	const router = createRouter({
		history: createMemoryHistory({ initialEntries: ["/space"] }),
		routeTree: rootRoute.addChildren([spaceRoute, elsewhereRoute]),
	});
	render(<RouterProvider router={router} />);
	return router;
}

describe("SpaceGuidePanel", () => {
	beforeEach(() => {
		getMetaMock.mockReset();
		updateMetaMock.mockReset();
		toastSuccessMock.mockReset();
	});

	afterEach(cleanup);

	it("shows the guide read-only to members who are not owners", async () => {
		getMetaMock.mockResolvedValue(spaceMeta("Keep decisions reversible."));

		renderGuide({ canEdit: false });

		expect(await screen.findByText("Keep decisions reversible.")).toBeDefined();
		expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
	});

	it("lets an owner write the first guide from the empty state", async () => {
		getMetaMock.mockResolvedValue(spaceMeta());
		updateMetaMock.mockResolvedValue(spaceMeta("Escalate blockers."));

		renderGuide({ canEdit: true });

		fireEvent.click(
			await screen.findByRole("button", { name: "Write a guide" })
		);
		fireEvent.change(screen.getByLabelText("Space guide"), {
			target: { value: "Escalate blockers." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(await screen.findByText("Escalate blockers.")).toBeDefined();
		expect(updateMetaMock).toHaveBeenCalledWith({
			spaceId: "space-1",
			guide: "Escalate blockers.",
		});
		expect(toastSuccessMock).toHaveBeenCalledWith("Guide saved.");
		expect(screen.queryByLabelText("Space guide")).toBeNull();
	});

	it("keeps an unsaved edit when the panel unmounts and returns", async () => {
		getMetaMock.mockResolvedValue(spaceMeta("Old rules."));

		renderGuide({ canEdit: true });

		fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
		fireEvent.change(screen.getByLabelText("Space guide"), {
			target: { value: "New rules, not saved yet." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Toggle panel" }));
		expect(screen.queryByLabelText("Space guide")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Toggle panel" }));

		const editor = (await screen.findByLabelText(
			"Space guide"
		)) as HTMLTextAreaElement;
		expect(editor.value).toBe("New rules, not saved yet.");
		expect(updateMetaMock).not.toHaveBeenCalled();
	});

	it("rereads the guide each time the panel opens", async () => {
		getMetaMock.mockResolvedValueOnce(spaceMeta("First version."));
		getMetaMock.mockResolvedValueOnce(spaceMeta("Changed elsewhere."));

		renderGuide({ canEdit: false });

		expect(await screen.findByText("First version.")).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: "Toggle panel" }));
		fireEvent.click(screen.getByRole("button", { name: "Toggle panel" }));

		expect(await screen.findByText("Changed elsewhere.")).toBeDefined();
	});

	it("shows no running count and blocks saving only past the cap", async () => {
		getMetaMock.mockResolvedValue(spaceMeta("Short."));

		renderGuide({ canEdit: true });

		fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
		expect(screen.queryByText(CHARACTER_COUNT_TEXT)).toBeNull();

		fireEvent.change(screen.getByLabelText("Space guide"), {
			target: { value: "g".repeat(MAX_SPACE_GUIDE_LENGTH + 1) },
		});

		expect(screen.getByRole("alert").textContent).toContain(
			"Shorten it to 100,000 or fewer to save."
		);
		expect(
			(screen.getByRole("button", { name: "Save" }) as HTMLButtonElement)
				.disabled
		).toBe(true);
	});

	it("keeps the edit open and shows the error when saving fails", async () => {
		getMetaMock.mockResolvedValue(spaceMeta("Old rules."));
		updateMetaMock.mockRejectedValue(new Error("Only a Space owner can edit."));

		renderGuide({ canEdit: true });

		fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
		expect(screen.getByLabelText("Space guide")).toBeDefined();
	});

	it("asks before an in-app link leaves an unsaved edit", async () => {
		getMetaMock.mockResolvedValue(spaceMeta("Old rules."));

		const router = renderGuide({ canEdit: true });

		fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
		fireEvent.change(screen.getByLabelText("Space guide"), {
			target: { value: "New rules." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Toggle panel" }));
		fireEvent.click(screen.getByRole("link", { name: "Leave Space" }));

		expect(await screen.findByRole("dialog")).toBeDefined();
		expect(router.state.location.pathname).toBe("/space");

		fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

		expect(await screen.findByText("Somewhere else")).toBeDefined();
	});

	it("can save an unsaved edit and then leave", async () => {
		getMetaMock.mockResolvedValue(spaceMeta("Old rules."));
		updateMetaMock.mockResolvedValue(spaceMeta("New rules."));

		const router = renderGuide({ canEdit: true });

		fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
		fireEvent.change(screen.getByLabelText("Space guide"), {
			target: { value: "New rules." },
		});
		fireEvent.click(screen.getByRole("link", { name: "Leave Space" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Save and leave" })
		);

		expect(await screen.findByText("Somewhere else")).toBeDefined();
		expect(updateMetaMock).toHaveBeenCalledWith({
			spaceId: "space-1",
			guide: "New rules.",
		});
		expect(router.state.location.pathname).toBe("/privacy");
	});

	it("saves a newer edit only after a save in flight, then leaves", async () => {
		getMetaMock.mockResolvedValue(spaceMeta("Old rules."));
		let finishFirstSave: (meta: SpaceMeta) => void = () => undefined;
		updateMetaMock.mockReturnValueOnce(
			new Promise<SpaceMeta>((resolve) => {
				finishFirstSave = resolve;
			})
		);
		updateMetaMock.mockResolvedValueOnce(spaceMeta("Version B."));

		const router = renderGuide({ canEdit: true });

		fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
		const editor = screen.getByLabelText("Space guide");
		fireEvent.change(editor, { target: { value: "Version A." } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		fireEvent.change(editor, { target: { value: "Version B." } });
		fireEvent.click(screen.getByRole("link", { name: "Leave Space" }));

		// The dialog shares the editor's save, so it waits for version A.
		const saveAndLeave = (await screen.findByRole("button", {
			name: "Saving…",
		})) as HTMLButtonElement;
		expect(saveAndLeave.disabled).toBe(true);
		expect(updateMetaMock).toHaveBeenCalledTimes(1);

		await act(async () => {
			finishFirstSave(spaceMeta("Version A."));
			await Promise.resolve();
		});
		fireEvent.click(
			await screen.findByRole("button", { name: "Save and leave" })
		);

		expect(await screen.findByText("Somewhere else")).toBeDefined();
		expect(updateMetaMock.mock.calls.map(([request]) => request.guide)).toEqual(
			["Version A.", "Version B."]
		);
		expect(router.state.location.pathname).toBe("/privacy");
	});

	it("stays on the Space when saving before leaving fails", async () => {
		getMetaMock.mockResolvedValue(spaceMeta("Old rules."));
		updateMetaMock.mockRejectedValue(new Error("Only a Space owner can edit."));

		const router = renderGuide({ canEdit: true });

		fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
		fireEvent.change(screen.getByLabelText("Space guide"), {
			target: { value: "New rules." },
		});
		fireEvent.click(screen.getByRole("link", { name: "Leave Space" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Save and leave" })
		);

		expect(
			await screen.findByText(
				"OpenMeld couldn't save your changes. Fix the error and try again."
			)
		).toBeDefined();
		expect(router.state.location.pathname).toBe("/space");
	});

	it("does not ask before leaving when the edit has no changes", async () => {
		getMetaMock.mockResolvedValue(spaceMeta("Old rules."));

		renderGuide({ canEdit: true });

		fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
		fireEvent.click(screen.getByRole("link", { name: "Leave Space" }));

		expect(await screen.findByText("Somewhere else")).toBeDefined();
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("keeps text typed while a save is in flight", async () => {
		getMetaMock.mockResolvedValue(spaceMeta("Old rules."));
		let finishSave: (meta: SpaceMeta) => void = () => undefined;
		updateMetaMock.mockReturnValue(
			new Promise<SpaceMeta>((resolve) => {
				finishSave = resolve;
			})
		);

		renderGuide({ canEdit: true });

		fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
		const editor = screen.getByLabelText("Space guide");
		fireEvent.change(editor, { target: { value: "Version A." } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		fireEvent.change(editor, { target: { value: "Version A. Then B." } });
		await act(async () => {
			finishSave(spaceMeta("Version A."));
			await Promise.resolve();
		});

		await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
		expect(
			(screen.getByLabelText("Space guide") as HTMLTextAreaElement).value
		).toBe("Version A. Then B.");
	});

	it("offers a retry when the guide cannot load", async () => {
		getMetaMock.mockRejectedValueOnce(new Error("offline"));
		getMetaMock.mockResolvedValueOnce(spaceMeta("Recovered."));

		renderGuide({ canEdit: false });

		fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

		expect(await screen.findByText("Recovered.")).toBeDefined();
	});
});
