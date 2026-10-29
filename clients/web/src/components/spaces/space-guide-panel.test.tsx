import { MAX_SPACE_GUIDE_LENGTH } from "@openmeld/schemas";
import type { SpaceMeta } from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { useSpaceGuideDraft } from "./space-guide-draft";
import { SpaceGuidePanel } from "./space-guide-panel";

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

/** Mirrors Space landing: the draft lives outside the panel. */
function GuideHarness(input: { canEdit: boolean }) {
	const guideDraft = useSpaceGuideDraft("space-1");
	const [panelOpen, setPanelOpen] = useState(true);
	return (
		<>
			<button onClick={() => setPanelOpen((open) => !open)} type="button">
				Toggle panel
			</button>
			{panelOpen ? (
				<SpaceGuidePanel
					canEdit={input.canEdit}
					draft={guideDraft.draft}
					onDraftChange={guideDraft.onDraftChange}
					openMeldProfileId="profile-1"
					spaceId="space-1"
				/>
			) : null}
		</>
	);
}

function renderGuide(input: { canEdit: boolean }) {
	return render(
		<TestQueryClientProvider>
			<GuideHarness canEdit={input.canEdit} />
		</TestQueryClientProvider>
	);
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

	it("offers a retry when the guide cannot load", async () => {
		getMetaMock.mockRejectedValueOnce(new Error("offline"));
		getMetaMock.mockResolvedValueOnce(spaceMeta("Recovered."));

		renderGuide({ canEdit: false });

		fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

		expect(await screen.findByText("Recovered.")).toBeDefined();
	});
});
