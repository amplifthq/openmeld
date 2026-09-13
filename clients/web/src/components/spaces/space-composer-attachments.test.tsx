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

	it("keeps attachments in one scrolling row and announces file failures", () => {
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

		expect(screen.getByRole("group", { name: "Files to send" })).toBeTruthy();
		expect(screen.getByRole("img", { name: LONG_FILE_NAME })).toBeTruthy();
		expect(screen.queryByText("Ready")).toBeNull();
		expect(screen.queryByText("Uploading…")).toBeNull();
		expect(screen.queryByRole("progressbar")).toBeNull();
		expect(screen.getByRole("alert").textContent).toBe(
			"OpenMeld couldn’t add this file. Try again."
		);
		expect(screen.getByText("Request ID: request-file-failed")).toBeTruthy();

		const removeReadyFile = screen.getByRole("button", {
			name: "Remove launch-brief.pdf",
		});
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
