import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPACE_FILE_HTML_PREVIEW_MAX_BYTES } from "./space-file-html-document";
import { SpaceFileHtmlPreview } from "./space-file-html-preview";

const defaults = {
	bytes: new TextEncoder().encode("<h1>Saved report</h1>").buffer,
	draft: null,
	fileName: "report.html",
	hasUnsavedChanges: false,
	isError: false,
	isLoading: false,
	newTabUrl: "/file-preview?spaceId=space&fileId=report&revision=1",
	onDownload: vi.fn(),
	onRetry: vi.fn(),
	sourceEditor: (
		<textarea aria-label="File contents" defaultValue="<h1>Saved report</h1>" />
	),
};

describe("SpaceFileHtmlPreview", () => {
	afterEach(cleanup);
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("previews without scripts by default and keeps the new tab isolated", () => {
		render(<SpaceFileHtmlPreview {...defaults} />);
		const frame = screen.getByTitle("HTML preview: report.html");
		expect(frame.getAttribute("sandbox")).toBe("");
		expect(frame.getAttribute("srcdoc")).toContain("Saved report");
		const link = screen.getByRole("link", { name: "Open in new tab" });
		expect(link.getAttribute("href")).toBe(defaults.newTabUrl);
		expect(link.getAttribute("rel")).toBe("noopener noreferrer");
		fireEvent.click(screen.getByRole("button", { name: "Source" }));
		expect(screen.getByRole("textbox", { name: "File contents" })).toBeTruthy();
		expect(screen.queryByTitle("HTML preview: report.html")).toBeNull();
	});

	it("previews the draft without writing or downloading it", () => {
		render(
			<SpaceFileHtmlPreview
				{...defaults}
				draft="<h1>Draft report</h1>"
				hasUnsavedChanges
			/>
		);
		expect(
			screen.getByTitle("HTML preview: report.html").getAttribute("srcdoc")
		).toContain("Draft report");
		expect(screen.getByText("Unsaved changes")).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Open saved version in new tab" })
				.getAttribute("href")
		).toBe(defaults.newTabUrl);
		expect(defaults.onDownload).not.toHaveBeenCalled();
	});

	it.each([
		{ bytes: new Uint8Array([0xff]).buffer, message: "isn’t UTF-8" },
		{
			bytes: new ArrayBuffer(SPACE_FILE_HTML_PREVIEW_MAX_BYTES + 1),
			message: "up to 2 MiB",
		},
	])("keeps the original downloadable when preview is unsupported", ({
		bytes,
		message,
	}) => {
		render(
			<SpaceFileHtmlPreview {...defaults} bytes={bytes} sourceEditor={null} />
		);
		expect(screen.getByRole("alert").textContent).toContain(message);
		expect(screen.queryByRole("link", { name: "Open in new tab" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Download file" }));
		expect(defaults.onDownload).toHaveBeenCalledOnce();
	});

	it("shows a failed revision read instead of an old preview", () => {
		render(<SpaceFileHtmlPreview {...defaults} isError />);
		expect(screen.queryByTitle("HTML preview: report.html")).toBeNull();
		expect(screen.queryByRole("link", { name: "Open in new tab" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(defaults.onRetry).toHaveBeenCalledOnce();
	});
});
