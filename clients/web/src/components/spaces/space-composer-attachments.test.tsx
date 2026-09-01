import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpaceComposerFile } from "#/lib/spaces/composer-attachment";
import { SpaceComposerFileTray } from "./space-composer-attachments";

vi.mock("@phosphor-icons/react", () => ({
	FileIcon: () => <span />,
	PlusIcon: () => <span />,
	XIcon: () => <span />,
}));

const LONG_FILE_NAME =
	"quarterly-product-review-with-an-intentionally-long-file-name-for-layout-testing.pdf";

describe("SpaceComposerFileTray", () => {
	afterEach(() => {
		cleanup();
	});

	it("keeps fixed-width cards in one horizontally scrolling row", () => {
		const onRemove = vi.fn();
		render(
			<SpaceComposerFileTray
				disabled={false}
				files={[
					createComposerFile({ status: "ready" }),
					createComposerFile({
						fileName: LONG_FILE_NAME,
						localId: "uploading-file",
						progress: 42,
						status: "uploading",
					}),
					createComposerFile({
						errorMessage: "OpenMeld couldn’t add this file. Try again.",
						errorRequestId: "request-file-failed",
						fileName: "broken.pdf",
						localId: "failed-file",
						status: "failed",
					}),
				]}
				onRemove={onRemove}
			/>
		);

		const tray = screen.getByRole("group", { name: "Files to send" });
		expect(tray.className).toContain("flex");
		expect(tray.className).toContain("flex-nowrap");
		expect(tray.className).toContain("overflow-x-auto");
		expect(tray.className).toContain("[scrollbar-width:none]");
		expect(tray.className).toContain("[&::-webkit-scrollbar]:hidden");
		expect(tray.className).not.toContain("flex-wrap");
		expect(tray.className).not.toContain("grid-cols-1");

		const cards = Array.from(tray.children) as HTMLElement[];
		expect(cards).toHaveLength(3);
		for (const card of cards) {
			expect(card.className).toContain("w-40");
			expect(card.className).toContain("flex-none");
			expect(card.className).not.toContain("w-fit");
		}

		const readyName = screen.getByText("launch-brief.pdf");
		const readyStatus = screen.getByText("Ready");
		expect(readyName.tagName).toBe("P");
		expect(readyStatus.tagName).toBe("P");
		expect(readyName.compareDocumentPosition(readyStatus)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		const longFileName = screen.getByText(LONG_FILE_NAME);
		expect(longFileName.className).toContain("truncate");
		expect(longFileName.getAttribute("data-slot")).toBe("tooltip-trigger");
		expect(screen.getByText("Uploading…")).toBeTruthy();
		expect(
			screen
				.getByRole("progressbar", {
					name: `${LONG_FILE_NAME} upload progress`,
				})
				.getAttribute("aria-valuenow")
		).toBe("42");
		expect(
			screen.getByText("OpenMeld couldn’t add this file. Try again.")
		).toBeTruthy();
		expect(screen.getByText("Request ID: request-file-failed")).toBeTruthy();

		const removeReadyFile = screen.getByRole("button", {
			name: "Remove launch-brief.pdf",
		});
		expect(removeReadyFile.className).toContain("size-7");
		fireEvent.click(removeReadyFile);
		expect(onRemove).toHaveBeenCalledWith("ready-file");
	});
});

function createComposerFile(
	overrides: Partial<SpaceComposerFile> = {}
): SpaceComposerFile {
	return {
		errorMessage: null,
		errorRequestId: null,
		fileName: "launch-brief.pdf",
		localId: "ready-file",
		mimeType: "application/pdf",
		previewUrl: null,
		progress: 100,
		publishMutationId: "publish-file",
		status: "ready",
		upload: null,
		...overrides,
	};
}
