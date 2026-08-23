// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./markdown-editor";

describe("MarkdownEditor", () => {
	it("renders an editable document surface with its formatting toolbar", () => {
		const { container } = render(
			<MarkdownEditor
				ariaLabel="Document content"
				maxChars={20_000}
				onChange={vi.fn()}
				value="# Working notes"
			/>
		);

		const editor = screen.getByLabelText("Document content");
		expect(editor.getAttribute("contenteditable")).toBe("true");
		expect(screen.getByRole("toolbar")).toBeTruthy();
		expect(container.querySelector(".bg-card")).toBeNull();
	});

	it("does not leave an empty toolbar strip above read-only content", () => {
		const { container } = render(
			<MarkdownEditor
				ariaLabel="Proposed document content"
				disabled
				maxChars={20_000}
				onChange={vi.fn()}
				value="# Working notes"
			/>
		);

		expect(
			screen
				.getByLabelText("Proposed document content")
				.getAttribute("contenteditable")
		).toBe("false");
		const toolbar = within(container).getByRole("toolbar");
		expect(toolbar.childElementCount).toBe(0);
		expect(toolbar.classList.contains("empty:hidden")).toBe(true);
	});

	it("measures Space Markdown limits in UTF-8 bytes", () => {
		render(
			<MarkdownEditor
				ariaLabel="Space file contents"
				maxBytes={1024 * 1024}
				onChange={vi.fn()}
				value="Hello, 世界"
			/>
		);

		expect(screen.getByText("13 B / 1 MB")).toBeTruthy();
	});
});
