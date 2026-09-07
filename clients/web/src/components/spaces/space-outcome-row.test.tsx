import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	resolveSpaceOutcomeRowRecoveryDisplay,
	SpaceOutcomeRow,
} from "./space-outcome-row";
import { resolveSpaceOutcomeRowTone } from "./space-outcome-tone";

const REFERENCED_SPACE_ID = "c".repeat(64);

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		params,
		to,
		...props
	}: {
		children: ReactNode;
		params?: { spaceId: string };
		to: string;
	}) => (
		<a href={params ? to.replace("$spaceId", params.spaceId) : to} {...props}>
			{children}
		</a>
	),
}));

describe("resolveSpaceOutcomeRowTone", () => {
	it("is always muted for wake_stopped, regardless of failureStage", () => {
		expect(
			resolveSpaceOutcomeRowTone({
				failureStage: undefined,
				noticeType: "wake_stopped",
			})
		).toBe("muted");
		expect(
			resolveSpaceOutcomeRowTone({
				failureStage: null,
				noticeType: "wake_stopped",
			})
		).toBe("muted");
	});

	it("is destructive for terminal_failure with an execution stage or an omitted stage", () => {
		expect(
			resolveSpaceOutcomeRowTone({
				failureStage: "execution",
				noticeType: "terminal_failure",
			})
		).toBe("destructive");
		expect(
			resolveSpaceOutcomeRowTone({
				failureStage: undefined,
				noticeType: "terminal_failure",
			})
		).toBe("destructive");
	});

	it("is warning for terminal_failure with a publication stage", () => {
		expect(
			resolveSpaceOutcomeRowTone({
				failureStage: "publication",
				noticeType: "terminal_failure",
			})
		).toBe("warning");
	});

	it("treats a cross-workspace Agent Profile as an execution failure", () => {
		expect(
			resolveSpaceOutcomeRowTone({
				failureStage: "execution",
				noticeType: "terminal_failure",
				reasonCode: "agent_profile.organization_mismatch",
			})
		).toBe("destructive");
	});
});

describe("resolveSpaceOutcomeRowRecoveryDisplay", () => {
	it("resolves a known reasonCode into an actionable recovery for terminal_failure", () => {
		const display = resolveSpaceOutcomeRowRecoveryDisplay({
			noticeType: "terminal_failure",
			reasonCode: "controller.runtime.missing",
			targetLabel: "Codex Local Agent",
		});

		expect(display).toEqual(
			expect.objectContaining({
				actionTarget: "prepare_setup",
				primaryActionLabel: "Connect local agent",
			})
		);
	});

	it("keeps an unmatched reasonCode diagnostic-only instead of inventing a recovery action", () => {
		const display = resolveSpaceOutcomeRowRecoveryDisplay({
			noticeType: "terminal_failure",
			reasonCode: "some.made.up.code",
			targetLabel: "Codex Local Agent",
		});

		expect(display).toEqual({
			actionTarget: null,
			body: "OpenMeld did not receive enough error details to explain why Codex Local Agent could not reply. Open diagnostics for technical details.",
		});
	});

	it("returns null without a reasonCode instead of guessing a classification", () => {
		expect(
			resolveSpaceOutcomeRowRecoveryDisplay({
				noticeType: "terminal_failure",
				reasonCode: null,
				targetLabel: "Codex Local Agent",
			})
		).toBeNull();
		expect(
			resolveSpaceOutcomeRowRecoveryDisplay({
				noticeType: "terminal_failure",
				reasonCode: undefined,
				targetLabel: "Codex Local Agent",
			})
		).toBeNull();
	});

	it("never resolves a recovery action for wake_stopped, even with a reasonCode present", () => {
		expect(
			resolveSpaceOutcomeRowRecoveryDisplay({
				noticeType: "wake_stopped",
				reasonCode: "controller.runtime.missing",
				targetLabel: "Codex Local Agent",
			})
		).toBeNull();
	});
});

describe("SpaceOutcomeRow", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders the notice text directly, with no classified title or cause", () => {
		render(
			<SpaceOutcomeRow
				onOpenDetails={null}
				text="Codex Local Agent could not reply because the local OpenMeld Service is not connected (errorCode: local_service)."
				tone="destructive"
			/>
		);

		expect(
			screen.getByText(
				"Codex Local Agent could not reply because the local OpenMeld Service is not connected (errorCode: local_service)."
			)
		).toBeTruthy();
		expect(
			screen.queryByText("OpenMeld could not complete this request.")
		).toBeNull();
	});

	it("renders Space references inside the notice text", () => {
		render(
			<SpaceOutcomeRow
				onOpenDetails={null}
				spaceReferencesById={
					new Map([
						[
							REFERENCED_SPACE_ID,
							{ name: "Launch Planning", spaceId: REFERENCED_SPACE_ID },
						],
					])
				}
				text={`See /spaces/${REFERENCED_SPACE_ID} for context.`}
				tone="destructive"
			/>
		);

		expect(
			screen.getByRole("link", { name: "Open Space Launch Planning" })
		).toBeTruthy();
	});

	it("wraps the notice on phones and keeps the compact desktop row", () => {
		render(
			<SpaceOutcomeRow
				onOpenDetails={null}
				text="This agent could not reply."
				tone="destructive"
			/>
		);

		const textSpan = screen.getByText("This agent could not reply.");
		expect(textSpan.className).toContain("max-sm:break-words");
		expect(textSpan.className).toContain("sm:truncate");
	});

	it("colors the destructive tone without a full-width danger block", () => {
		render(
			<SpaceOutcomeRow
				onOpenDetails={null}
				text="This agent could not reply."
				tone="destructive"
			/>
		);

		const marker = screen
			.getByText("This agent could not reply.")
			.closest("[data-slot='marker']");
		expect(marker?.className).toContain("text-destructive");
		expect(marker?.className).not.toContain("bg-destructive");
		expect(marker?.className).not.toContain("border-destructive");
	});

	it("keeps a Wake outcome attached to its message without a system divider", () => {
		render(
			<SpaceOutcomeRow
				onOpenDetails={null}
				text="This agent could not reply."
				tone="destructive"
			/>
		);

		const divider = screen
			.getByText("This agent could not reply.")
			.closest("[data-slot='space-system-divider']");
		expect(divider).toBeNull();
	});

	it("colors the warning tone amber for a publication-stage failure", () => {
		render(
			<SpaceOutcomeRow
				onOpenDetails={null}
				text="This agent finished, but OpenMeld could not publish the reply."
				tone="warning"
			/>
		);

		const marker = screen
			.getByText(
				"This agent finished, but OpenMeld could not publish the reply."
			)
			.closest("[data-slot='marker']");
		expect(marker?.className).toContain("text-amber-600");
		expect(marker?.className).toContain("dark:text-amber-400");
	});

	it("vertically centers the icon with the outcome message", () => {
		render(
			<SpaceOutcomeRow
				onOpenDetails={null}
				text="This Agent Profile belongs to another workspace."
				tone="destructive"
			/>
		);

		const marker = screen
			.getByText("This Agent Profile belongs to another workspace.")
			.closest("[data-slot='marker']");
		const icon = marker?.querySelector("[data-slot='marker-icon']");
		expect(marker?.className).toContain("items-center");
		expect(icon?.className).not.toContain("mt-0.5");
	});

	it("colors the muted tone for a stopped Wake instead of red", () => {
		render(
			<SpaceOutcomeRow
				onOpenDetails={null}
				text="Wake was stopped before it reached the agent."
				tone="muted"
			/>
		);

		const marker = screen
			.getByText("Wake was stopped before it reached the agent.")
			.closest("[data-slot='marker']");
		expect(marker?.className).toContain("text-muted-foreground");
		expect(marker?.className).not.toContain("text-destructive");
	});

	it("renders the whole row as a button and calls back when clicked", () => {
		const onOpenDetails = vi.fn();
		render(
			<SpaceOutcomeRow
				onOpenDetails={onOpenDetails}
				text="This agent could not reply."
				tone="destructive"
			/>
		);

		const detailsButton = screen.getByRole("button", {
			name: "Open message details",
		});
		expect(detailsButton.className).toContain("touch-manipulation");
		expect(detailsButton.className).toContain("max-lg:min-h-11");
		const detailsText = screen.getByText("This agent could not reply.");
		expect(detailsText.className).toContain("max-sm:break-words");
		expect(detailsText.className).toContain("sm:truncate");
		fireEvent.click(detailsButton);
		expect(onOpenDetails).toHaveBeenCalledOnce();
	});

	it("is not a button when onOpenDetails is null but keeps the row visible", () => {
		render(
			<SpaceOutcomeRow
				onOpenDetails={null}
				text="This agent could not reply."
				tone="destructive"
			/>
		);

		expect(screen.getByText("This agent could not reply.")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Open message details" })
		).toBeNull();
	});

	it("right-aligns the row when align is end", () => {
		render(
			<SpaceOutcomeRow
				align="end"
				onOpenDetails={null}
				text="This agent could not reply."
				tone="destructive"
			/>
		);

		const row = screen.getByTestId("space-outcome-row");
		expect(row.className).toContain("justify-end");
	});

	it("keeps reply recovery inline while preserving its explanation for assistive technology", async () => {
		const warning =
			"OpenMeld will ask the same Agent conversation to post the reply it already finished. It will not run the task again.";
		render(
			<SpaceOutcomeRow
				onOpenDetails={null}
				onRecoverExecution={async () => ({
					action: "resume_controller_conversation",
					label: "Continue conversation",
					status: "available",
					warning,
				})}
				recoveryRequest={{
					dispatchId: "dispatch-1",
					resultRef: null,
					targetProfileId: "agent-profile-1",
				}}
				text="This agent finished, but OpenMeld could not publish the reply."
				tone="warning"
			/>
		);

		const button = await screen.findByRole("button", {
			name: "Recover reply",
		});
		const warningElement = screen.getByText(warning);
		expect(warningElement.className).toContain("sr-only");
		expect(button.getAttribute("aria-describedby")).toBe(warningElement.id);
		expect(button.parentElement?.className).toContain("inline-flex");
		expect(button.parentElement?.className).toContain("shrink-0");
		expect(button.parentElement?.className).not.toContain("flex-col");
	});
});
