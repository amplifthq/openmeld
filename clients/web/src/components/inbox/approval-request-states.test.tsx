import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
	ApprovalRequestErrors,
	ApprovalRequestUnavailable,
} from "./approval-request-states";

afterEach(cleanup);

it("offers the same Refresh request recovery when a request can't load or refresh", () => {
	const onRefresh = vi.fn();
	render(
		<>
			<ApprovalRequestUnavailable message="Gone." onRefresh={onRefresh} />
			<ApprovalRequestErrors
				error="Not saved."
				onRefresh={onRefresh}
				refetchFailed
			/>
		</>
	);
	expect(screen.getAllByRole("alert").map((node) => node.textContent)).toEqual([
		"Gone.",
		"Not saved.",
		"Couldn’t refresh this request. Confirm its current status before responding.",
	]);
	for (const button of screen.getAllByRole("button", {
		name: "Refresh request",
	})) {
		fireEvent.click(button);
	}
	expect(onRefresh).toHaveBeenCalledTimes(2);
});
