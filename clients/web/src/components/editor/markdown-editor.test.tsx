// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./markdown-editor";

afterEach(cleanup);

describe("MarkdownEditor", () => {
	it.each([
		undefined,
		"page",
	] as const)("reports content edits but not focus or selection in %s presentation", async (presentation) => {
		const descriptor = Object.getOwnPropertyDescriptor(
			HTMLElement.prototype,
			"isContentEditable"
		);
		Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
			configurable: true,
			get() {
				return (
					this.closest("[contenteditable]")?.getAttribute("contenteditable") ===
					"true"
				);
			},
		});
		const onChange = vi.fn();
		try {
			render(
				<MarkdownEditor
					ariaLabel="Editable notes"
					maxChars={100}
					onChange={onChange}
					presentation={presentation}
					value="Read this."
				/>
			);
			const editor = screen.getByLabelText("Editable notes");
			vi.useFakeTimers();
			await act(async () => {
				editor.focus();
				const leaf = editor.querySelector("[data-slate-string]")?.firstChild;
				if (!leaf) {
					throw new Error("Missing real Markdown editor text");
				}
				const range = document.createRange();
				range.setStart(leaf, leaf.textContent?.length ?? 0);
				range.collapse(true);
				window.getSelection()?.removeAllRanges();
				window.getSelection()?.addRange(range);
				document.dispatchEvent(new Event("selectionchange"));
				await vi.advanceTimersByTimeAsync(101);
			});
			expect(editor.textContent).toBe("Read this.");
			expect(onChange).not.toHaveBeenCalled();
			await act(async () => {
				fireEvent.paste(editor, {
					clipboardData: {
						files: [],
						items: [],
						types: ["text/plain"],
						getData: (type: string) => (type === "text/plain" ? "EDITED" : ""),
					},
				});
				await vi.advanceTimersByTimeAsync(0);
			});
			vi.useRealTimers();
			await waitFor(() =>
				expect(onChange).toHaveBeenLastCalledWith("Read this.EDITED\n")
			);
			expect(editor.textContent).toBe("Read this.EDITED");
		} finally {
			vi.useRealTimers();
			cleanup();
			if (descriptor) {
				Object.defineProperty(
					HTMLElement.prototype,
					"isContentEditable",
					descriptor
				);
			} else {
				Reflect.deleteProperty(HTMLElement.prototype, "isContentEditable");
			}
		}
	});

	it("keeps page formatting reachable and only discloses the limit near its boundary", () => {
		const { rerender } = render(
			<MarkdownEditor
				ariaLabel="Instructions"
				maxChars={100}
				onChange={vi.fn()}
				presentation="page"
				value="Notes"
			/>
		);
		expect(screen.getAllByRole("toolbar")).toHaveLength(1);
		expect(
			screen.getByLabelText("Instructions").getAttribute("contenteditable")
		).toBe("true");
		expect(screen.queryByText("5 / 100 characters")).toBeNull();
		rerender(
			<MarkdownEditor
				ariaLabel="Instructions"
				maxChars={100}
				onChange={vi.fn()}
				presentation="page"
				value={"a".repeat(101)}
			/>
		);
		expect(
			screen.getByText("101 / 100 characters — too long to save")
		).toBeTruthy();
	});
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
		expect(editor.classList.contains("content-markdown-document")).toBe(true);
		const toolbar = screen.getByRole("toolbar");
		expect(toolbar).toBeTruthy();
		for (const control of toolbar.querySelectorAll("button, [role=radio]")) {
			expect(control.className).toContain("max-lg:min-h-11");
			expect(control.className).toContain("max-lg:min-w-11");
		}
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
