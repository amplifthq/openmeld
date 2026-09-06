import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApplicationErrorState } from "./application-error-state";

vi.mock("#/components/openmeld-logo-weak", () => ({
	OpenMeldLogo: () => null,
}));
afterEach(cleanup);

it("starts with collapsed details and keeps recovery available", () => {
	const retry = vi.fn();
	const back = vi
		.spyOn(window.history, "back")
		.mockImplementation(() => undefined);
	vi.spyOn(window.history, "length", "get").mockReturnValue(2);
	render(
		<ApplicationErrorState
			details="Full debug details"
			message="Unexpected error"
			onAction={retry}
		/>
	);
	expect(document.querySelector("details")?.open).toBe(false);
	fireEvent.click(screen.getByRole("button", { name: "Refresh page" }));
	expect(retry).toHaveBeenCalledOnce();
	fireEvent.click(screen.getByRole("button", { name: "Go back" }));
	expect(back).toHaveBeenCalledOnce();
	vi.restoreAllMocks();
});

it("shows failure honestly, then confirms a user retry with the report ID", async () => {
	const report = vi
		.fn()
		.mockRejectedValueOnce(new Error("Offline"))
		.mockResolvedValueOnce("report-123");
	render(
		<ApplicationErrorState message="Unexpected error" onReport={report} />
	);
	fireEvent.click(screen.getByRole("button", { name: "Send error report" }));
	await waitFor(() =>
		expect(
			screen.getByText(
				"The report could not be sent. Check your connection and try again."
			)
		).toBeTruthy()
	);
	fireEvent.click(screen.getByRole("button", { name: "Try sending again" }));
	await waitFor(() =>
		expect(screen.getByText("Report ID: report-123")).toBeTruthy()
	);
	expect(
		screen.getByRole("button", { name: "Report sent" }).hasAttribute("disabled")
	).toBe(true);
	expect(report).toHaveBeenCalledTimes(2);
});
