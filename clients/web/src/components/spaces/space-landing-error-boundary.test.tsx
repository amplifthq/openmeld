import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useLayoutEffect, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { reportClientApplicationError } from "#/lib/observability/application-error-client";
import { SpaceLandingErrorBoundary } from "./space-landing-error-boundary";

vi.mock("#/lib/observability/application-error-client", () => ({
	reportClientApplicationError: vi.fn(),
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it("keeps the app shell usable when conversation rendering fails and retries locally", () => {
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	let shouldFail = true;
	function Conversation() {
		const [, setRevision] = useState(0);
		useLayoutEffect(() => {
			if (shouldFail) {
				setRevision((revision) => revision + 1);
			}
		});
		return <div>Conversation restored</div>;
	}
	const view = render(
		<>
			<nav>Other conversations</nav>
			<SpaceLandingErrorBoundary key="first-conversation">
				<Conversation />
			</SpaceLandingErrorBoundary>
		</>
	);
	expect(screen.getByText("Other conversations")).toBeTruthy();
	expect(screen.getByText("This conversation stopped working.")).toBeTruthy();
	expect(reportClientApplicationError).toHaveBeenCalledWith(
		expect.objectContaining({
			message: expect.stringContaining("Maximum update depth exceeded"),
		}),
		"react_caught"
	);

	shouldFail = false;
	fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	expect(screen.getByText("Conversation restored")).toBeTruthy();

	shouldFail = true;
	view.rerender(
		<>
			<nav>Other conversations</nav>
			<SpaceLandingErrorBoundary key="second-conversation">
				<div>Another conversation</div>
			</SpaceLandingErrorBoundary>
		</>
	);
	expect(screen.getByText("Another conversation")).toBeTruthy();
});
