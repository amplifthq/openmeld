// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { reportClientApplicationError } from "#/lib/observability/application-error-client";
import { MarkdownEditor } from "./markdown-editor";

const EDITOR_FAILURE = /The editor stopped working/;

vi.mock("platejs/react", async (importOriginal) => ({
	...(await importOriginal<typeof import("platejs/react")>()),
	usePlateEditor: () => {
		throw new Error("Rich editor failed");
	},
}));
vi.mock("#/lib/observability/application-error-client", () => ({
	reportClientApplicationError: vi.fn(),
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it("keeps Markdown content and its save limit available after the rich editor fails", () => {
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	const onChange = vi.fn();
	const { rerender } = render(
		<MarkdownEditor
			ariaLabel="File contents"
			maxChars={10}
			onChange={onChange}
			value="# Draft"
		/>
	);

	expect(screen.getByText(EDITOR_FAILURE)).toBeTruthy();
	expect(reportClientApplicationError).toHaveBeenCalledWith(
		expect.objectContaining({ message: "Rich editor failed" }),
		"react_caught"
	);
	const fallback = screen.getByRole("textbox", { name: "File contents" });
	expect((fallback as HTMLTextAreaElement).value).toBe("# Draft");
	fireEvent.change(fallback, { target: { value: "# New draft" } });
	expect(onChange).toHaveBeenCalledWith("# New draft");
	rerender(
		<MarkdownEditor
			ariaLabel="File contents"
			disabled
			maxChars={10}
			onChange={onChange}
			value="# New draft"
		/>
	);
	expect((fallback as HTMLTextAreaElement).value).toBe("# New draft");
	expect((fallback as HTMLTextAreaElement).readOnly).toBe(true);
	expect(
		screen.getByText("11 / 10 characters — too long to save")
	).toBeTruthy();
});
