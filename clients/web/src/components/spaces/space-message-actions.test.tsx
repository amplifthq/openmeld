import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageDetailsActionButton } from "./space-message-actions";

vi.mock("@phosphor-icons/react", () => ({
	InfoIcon: () => <span data-testid="message-details-info-icon" />,
	WarningCircleIcon: () => <span data-testid="message-details-warning-icon" />,
}));

const WHITESPACE_PATTERN = /\s+/;

describe("MessageDetailsActionButton", () => {
	afterEach(() => {
		cleanup();
	});

	it("uses the info icon when there is no Wake problem", () => {
		render(
			<MessageDetailsActionButton hasWakeProblem={false} onClick={vi.fn()} />
		);

		expect(screen.getByTestId("message-details-info-icon")).toBeTruthy();
		expect(screen.queryByTestId("message-details-warning-icon")).toBeNull();
	});

	it("uses the warning icon when there is a Wake problem", () => {
		render(
			<MessageDetailsActionButton hasWakeProblem={true} onClick={vi.fn()} />
		);

		expect(screen.getByTestId("message-details-warning-icon")).toBeTruthy();
		expect(screen.queryByTestId("message-details-info-icon")).toBeNull();
		const buttonClasses = screen
			.getByRole("button", { name: "Message details" })
			.className.split(WHITESPACE_PATTERN);
		expect(buttonClasses).toContain("bg-transparent");
		expect(buttonClasses).not.toContain("bg-destructive/10");
		expect(buttonClasses).toContain("hover:bg-destructive/10");
	});
});
