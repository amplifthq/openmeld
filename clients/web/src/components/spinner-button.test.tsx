import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SpinnerButton } from "./spinner-button";

describe("SpinnerButton", () => {
	afterEach(() => {
		cleanup();
	});

	it("keeps an explicit outcome visible and disables interaction while loading", () => {
		render(
			<SpinnerButton
				buttonState="loading"
				disabled={false}
				loadingLabel="Creating profile…"
			>
				Create profile
			</SpinnerButton>
		);

		const button = screen.getByRole("button", {
			name: "Creating profile…",
		}) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		expect(button.getAttribute("aria-busy")).toBe("true");
	});
});
