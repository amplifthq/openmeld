import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpaceComposerFile } from "#/lib/spaces/composer-attachment";
import {
	SpaceComposerAttachmentRecovery,
	SpaceComposerFileTray,
} from "./space-composer-attachments";

const LONG_FILE_NAME =
	"quarterly-product-review-with-an-intentionally-long-file-name-for-layout-testing.pdf";

describe("SpaceComposerFileTray", () => {
	afterEach(() => {
		cleanup();
	});

	it("keeps attachments in one scrolling row and announces file failures", () => {
		const onRemove = vi.fn();
		const onRetry = vi.fn();
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
						failurePhase: "stage",
						fileName: "broken.pdf",
						localId: "failed-file",
						status: "failed",
					}),
				]}
				onRemove={onRemove}
				onRetry={onRetry}
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
		expect(screen.queryByText("Request ID: request-file-failed")).toBeNull();

		const removeReadyFile = screen.getByRole("button", {
			name: "Remove launch-brief.pdf",
		});
		fireEvent.click(removeReadyFile);
		expect(onRemove).toHaveBeenCalledWith("ready-file");
		fireEvent.click(
			screen.getByRole("button", { name: "Attachment error: broken.pdf" })
		);
		expect(screen.getByText("Request ID: request-file-failed")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(onRetry).toHaveBeenCalledWith("failed-file");
	});

	it.each([
		["photo.png", "image/png", "image"],
		["photo.jpg", "image/jpeg", "image"],
		["animation.gif", "image/gif", "image"],
		["photo.webp", "image/webp", "image"],
		["diagram.svg", "image/svg+xml", "image"],
		["demo.mp4", "video/mp4", "video"],
		["demo.webm", "video/webm", "video"],
		["report.pdf", "application/pdf", "file"],
		[
			"report.docx",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			"file",
		],
		[
			"budget.xlsx",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"file",
		],
		[
			"slides.pptx",
			"application/vnd.openxmlformats-officedocument.presentationml.presentation",
			"file",
		],
		["page.html", "text/html", "file"],
		["data.csv", "text/csv", "file"],
		["notes.md", "text/markdown", "file"],
		["config.json", "application/json", "file"],
		["recording.mp3", "audio/mpeg", "file"],
		["source.zip", "application/zip", "file"],
		["unknown.bin", "application/octet-stream", "file"],
	])("preserves preview and removal for %s (%s)", (fileName, mimeType, kind) => {
		const onRemove = vi.fn();
		const file = createComposerFile({
			fileName,
			mimeType,
			previewUrl: kind === "file" ? null : "blob:attachment",
		});
		const view = render(
			<SpaceComposerFileTray
				disabled={false}
				files={[file]}
				onRemove={onRemove}
			/>
		);
		expect(
			screen.getAllByRole("group", { name: "Files to send" })
		).toHaveLength(1);
		if (kind === "image") {
			expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
				"blob:attachment"
			);
		}
		if (kind === "video") {
			expect(
				screen.getByRole("button", { name: `Play ${fileName}` })
			).toBeTruthy();
		}
		if (kind === "file") {
			expect(screen.getByRole("img", { name: fileName })).toBeTruthy();
			expect(view.container.querySelector("img,video")).toBeNull();
		}
		fireEvent.click(screen.getByRole("button", { name: `Remove ${fileName}` }));
		expect(onRemove).toHaveBeenCalledWith("ready-file");
	});

	it("keeps failed cleanup and restoration actions available", () => {
		const onRetryCleanup = vi.fn();
		const onRetryRestoration = vi.fn();
		render(
			<SpaceComposerAttachmentRecovery
				cleanup={[
					{
						error: new Error("connection closing"),
						fileName: "broken.png",
						id: "broken-file",
						reason: "removed",
						revision: 3,
						scope: "acme:human:space",
						status: "failed",
					},
				]}
				onRetryCleanup={onRetryCleanup}
				onRetryRestoration={onRetryRestoration}
				restorationError={new Error("connection closing")}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry cleanup" }));
		expect(onRetryCleanup).toHaveBeenCalledWith("broken-file");
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(onRetryRestoration).toHaveBeenCalledOnce();
	});
});

function createComposerFile(
	overrides: Partial<SpaceComposerFile> = {}
): SpaceComposerFile {
	return {
		errorMessage: null,
		errorRequestId: null,
		failurePhase: null,
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
