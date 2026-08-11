import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptInput, PromptInputTextarea } from "./prompt-input";

describe("PromptInput", () => {
	afterEach(() => {
		cleanup();
	});

	it("keeps the caller ref attached while autosizing the textarea", async () => {
		let callerTextarea: HTMLTextAreaElement | null = null;
		render(
			<PromptInputHarness
				onTextareaRef={(element) => {
					callerTextarea = element;
				}}
			/>
		);

		const textarea = screen.getByLabelText("Message");
		expect(textarea.parentElement?.className).toContain("rounded-md");
		expect(callerTextarea).toBe(textarea);

		Object.defineProperty(textarea, "scrollHeight", {
			configurable: true,
			value: 128,
		});

		fireEvent.change(textarea, {
			target: { value: "Line one\nLine two\nLine three\nLine four" },
		});

		await waitFor(() => {
			expect((textarea as HTMLTextAreaElement).style.height).toBe("128px");
			expect((textarea as HTMLTextAreaElement).style.overflowY).toBe("hidden");
		});
	});

	it("uses internal scrolling after the textarea reaches the max height", async () => {
		render(<PromptInputHarness maxHeight={160} />);

		const textarea = screen.getByLabelText("Message");
		Object.defineProperty(textarea, "scrollHeight", {
			configurable: true,
			value: 320,
		});

		fireEvent.change(textarea, {
			target: {
				value:
					"Line one\nLine two\nLine three\nLine four\nLine five\nLine six\nLine seven",
			},
		});

		await waitFor(() => {
			expect((textarea as HTMLTextAreaElement).style.height).toBe("160px");
			expect((textarea as HTMLTextAreaElement).style.overflowY).toBe("auto");
		});
	});

	it("submits from Enter after regular text entry", () => {
		const onSubmit = vi.fn();
		render(<PromptInputHarness onSubmit={onSubmit} />);

		fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter" });

		expect(onSubmit).toHaveBeenCalledTimes(1);
	});

	it("does not submit from Enter while the browser is composing IME text", () => {
		const onSubmit = vi.fn();
		render(<PromptInputHarness onSubmit={onSubmit} />);

		fireEvent.keyDown(screen.getByLabelText("Message"), {
			isComposing: true,
			key: "Enter",
		});

		expect(onSubmit).not.toHaveBeenCalled();
	});
});

function PromptInputHarness({
	maxHeight = 240,
	onSubmit,
	onTextareaRef,
}: {
	maxHeight?: number;
	onSubmit?: () => void;
	onTextareaRef?: (element: HTMLTextAreaElement | null) => void;
}) {
	const [value, setValue] = useState("");

	return (
		<PromptInput
			maxHeight={maxHeight}
			onSubmit={onSubmit}
			onValueChange={setValue}
			value={value}
		>
			<PromptInputTextarea aria-label="Message" ref={onTextareaRef} />
		</PromptInput>
	);
}
