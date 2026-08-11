import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	SpaceLandingFailureSurface,
	SpaceLandingLoadingShell,
} from "./space-state-surfaces";

describe("SpaceLandingLoadingShell", () => {
	it("fills the app content pane during bootstrap loading", () => {
		const { container } = render(<SpaceLandingLoadingShell />);
		const shell = container.firstElementChild;

		expect(shell?.classList.contains("h-full")).toBe(true);
		expect(shell?.classList.contains("min-h-0")).toBe(true);
		expect(shell?.classList.contains("w-full")).toBe(true);
		expect(shell?.classList.contains("min-w-0")).toBe(true);
		expect(shell?.classList.contains("flex-1")).toBe(true);
	});

	it("uses the same fixed header height as the loaded conversation header", () => {
		const { container } = render(<SpaceLandingLoadingShell />);

		expect(
			container
				.querySelector("header")
				?.classList.contains("h-[var(--space-conversation-header-height)]")
		).toBe(true);
	});

	it("shows a login recovery action for expired-session failures", () => {
		render(
			<SpaceLandingFailureSurface
				error={{
					code: "auth.unauthenticated",
					message: "authentication required",
					requestId: "req-123",
					status: 401,
					upstreamCode: null,
				}}
				onRetry={async () => undefined}
				spaceId="space-123"
			/>
		);

		expect(
			screen.getByText("Your session expired. Sign in again to continue.")
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Sign in again" }).getAttribute("href")
		).toBe("/login?redirect=%2F");
		expect(screen.queryByText("authentication required")).toBeNull();
		expect(screen.queryByRole("button", { name: "Try Again" })).toBeNull();
	});

	it("explains invalid API responses as an app update or refresh issue", () => {
		render(
			<SpaceLandingFailureSurface
				error={{
					code: "gateway.invalid_response",
					message: "invalid space status response",
					requestId: "req-invalid",
					status: 200,
					upstreamCode: null,
					schemaIssueMessage: "Required",
					schemaIssuePath: "members.wakeableAgentCount",
				}}
				onRetry={async () => undefined}
				spaceId="space-123"
			/>
		);

		expect(screen.getByText("Refresh OpenMeld")).toBeTruthy();
		expect(
			screen.getByText(
				"OpenMeld updated while this page was open. Refresh the app so it can read the latest Space data."
			)
		).toBeTruthy();
		expect(screen.queryByText("Couldn't Load This Space")).toBeNull();
		expect(screen.queryByText("invalid space status response")).toBeNull();
		expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
	});
});
