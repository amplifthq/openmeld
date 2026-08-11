import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WelcomeNameScreen } from "./welcome-name-screen";

afterEach(cleanup);

describe("WelcomeNameScreen", () => {
	it("renders pre-filled with the default name", () => {
		render(
			<WelcomeNameScreen
				defaultName="Felix"
				isPending={false}
				onSubmit={vi.fn()}
			/>
		);

		const input = screen.getByPlaceholderText("Your name") as HTMLInputElement;
		expect(input.value).toBe("Felix");
	});

	it("submits the edited (trimmed) value on Continue", () => {
		const onSubmit = vi.fn();
		render(
			<WelcomeNameScreen
				defaultName="Felix"
				isPending={false}
				onSubmit={onSubmit}
			/>
		);

		const input = screen.getByPlaceholderText("Your name");
		fireEvent.change(input, { target: { value: "  Felix Chen  " } });
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		expect(onSubmit).toHaveBeenCalledWith("Felix Chen");
	});

	it("does not submit when the trimmed value is empty", () => {
		const onSubmit = vi.fn();
		render(
			<WelcomeNameScreen defaultName="" isPending={false} onSubmit={onSubmit} />
		);

		fireEvent.change(screen.getByPlaceholderText("Your name"), {
			target: { value: "   " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));

		expect(onSubmit).not.toHaveBeenCalled();
	});
});
