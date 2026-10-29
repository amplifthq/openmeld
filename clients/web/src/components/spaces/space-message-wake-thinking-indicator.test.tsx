import { createWakeProgressItem } from "@openmeld/space";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveWakeProgressThinkingEntry,
	type SpaceMessageWakeThinkingEntry,
} from "#/lib/spaces/wake-progress-presentation";
import { SpaceMessageWakeThinkingIndicator } from "./space-message-wake-thinking-indicator";

const STARTED_AT_MS = 1_800_000_000_000;

describe("SpaceMessageWakeThinkingIndicator", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(STARTED_AT_MS + 30_000);
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("keeps elapsed time anchored when the same running entry receives progress updates", () => {
		const view = render(
			<SpaceMessageWakeThinkingIndicator
				entries={[createThinkingEntry({ elapsedStartedAtMs: STARTED_AT_MS })]}
			/>
		);

		const indicator = screen.getByTestId("space-wake-thinking-indicator");
		expect(indicator.tagName).toBe("OUTPUT");
		expect(indicator.textContent).toBe("Agent is working · 30s");
		expect(resolveOrbState(indicator)).toBe("solving");

		view.rerender(
			<SpaceMessageWakeThinkingIndicator
				entries={[
					createThinkingEntry({
						elapsedStartedAtMs: STARTED_AT_MS + 20_000,
					}),
				]}
			/>
		);

		expect(
			screen.getByTestId("space-wake-thinking-indicator").textContent
		).toBe("Agent is working · 30s");

		view.rerender(
			<SpaceMessageWakeThinkingIndicator
				entries={[
					createThinkingEntry({
						elapsedStartedAtMs: STARTED_AT_MS + 20_000,
						targetProfileId: "agt_next",
					}),
				]}
			/>
		);

		expect(
			screen.getByTestId("space-wake-thinking-indicator").textContent
		).toBe("Agent is working · 10s");
	});

	it("renders a completed Wake status without an animated progress icon", () => {
		const view = render(
			<SpaceMessageWakeThinkingIndicator
				entries={[
					createThinkingEntry({
						elapsedStartedAtMs: null,
						kind: "status",
						step: {
							description: "OpenMeld accepted the Stop request.",
							kind: "working",
							label: "Stop requested",
							status: "complete",
						},
						text: "Stop requested",
					}),
				]}
			/>
		);

		const status = screen.getByTestId("space-wake-status");
		expect(status.tagName).toBe("OUTPUT");
		expect(status.textContent).toBe("Stop requested");
		expect(view.container.querySelector("svg")).toBeNull();
	});

	it("uses composing for a live output preview without wrapping", () => {
		const previewText =
			"I’m checking the release configuration and running the focused verification now.";

		render(
			<SpaceMessageWakeThinkingIndicator
				entries={[
					createThinkingEntry({
						elapsedStartedAtMs: null,
						kind: "preview",
						text: previewText,
					}),
				]}
			/>
		);

		const indicator = screen.getByTestId("space-wake-thinking-indicator");
		const preview = screen.getByTestId("space-wake-preview-text");

		expect(indicator.tagName).toBe("OUTPUT");
		expect(indicator.textContent).toBe(previewText);
		expect(resolveOrbState(indicator)).toBe("composing");
		expect(indicator.className).toContain("overflow-hidden");
		expect(preview.className).toContain("truncate");
		expect(preview.className).toContain("whitespace-nowrap");
	});

	it.each([
		["running", "Agent · Working… · 45s", "solving"],
		["connecting", "Agent · Connecting…", "breathing"],
	] as const)("preserves authoritative %s after forty-five seconds without visible progress", (phase, label, orbState) => {
		vi.setSystemTime(STARTED_AT_MS + 45_000);

		render(
			<SpaceMessageWakeThinkingIndicator
				entries={resolveWakeProgressThinkingEntry({
					item: createWakeProgressItem({
						clientMessageId: "request-1",
						dispatchId: null,
						sourceSignalId: null,
						targetProfileId: "agt_runner",
						targetLabel: "Agent",
						phase,
						startedAtMs: STARTED_AT_MS,
						updatedAtMs: STARTED_AT_MS,
					}),
					showElapsedTime: true,
				})}
			/>
		);

		expect(
			screen
				.getByTestId("space-wake-thinking-indicator")
				.getAttribute("aria-label")
		).toBe(label);
		expect(
			resolveOrbState(screen.getByTestId("space-wake-thinking-indicator"))
		).toBe(orbState);
	});

	it("keeps connecting requests distinct from working Agents in a grouped summary", () => {
		render(
			<SpaceMessageWakeThinkingIndicator
				entries={(["connecting", "running"] as const).flatMap((phase, index) =>
					resolveWakeProgressThinkingEntry({
						item: createWakeProgressItem({
							clientMessageId: `request-${index}`,
							dispatchId: `dispatch-${index}`,
							sourceSignalId: null,
							targetProfileId: `agt_runner_${index}`,
							targetLabel: "Agent",
							phase,
							updatedAtMs: STARTED_AT_MS,
						}),
						showElapsedTime: false,
					})
				)}
			/>
		);

		expect(
			screen.getByTestId("space-wake-thinking-indicator").textContent
		).toBe("1 agent connecting · 1 agent working");
	});

	it("keeps showing elapsed time after fifty seconds", () => {
		vi.setSystemTime(STARTED_AT_MS + 50_000);

		render(
			<SpaceMessageWakeThinkingIndicator
				entries={[
					createThinkingEntry({
						elapsedStartedAtMs: STARTED_AT_MS,
					}),
				]}
			/>
		);

		expect(
			screen.getByTestId("space-wake-thinking-indicator").textContent
		).toBe("Agent is working · 50s");
	});

	it("right-aligns self message progress without an extra leading offset", () => {
		render(
			<SpaceMessageWakeThinkingIndicator
				align="end"
				entries={[
					createThinkingEntry({
						elapsedStartedAtMs: null,
						step: {
							description: "This agent was included in the Wake.",
							kind: "working",
							label: "Wake started",
							status: "complete",
						},
						text: "Wake started",
					}),
				]}
			/>
		);

		const row = screen.getByTestId("space-wake-thinking-row");
		const indicator = screen.getByTestId("space-wake-thinking-indicator");

		expect(row.firstElementChild?.className).toContain("justify-end");
		expect(indicator.className).toContain("gap-2");
		expect(indicator.className).not.toContain("pl-1");
		expect(
			indicator.querySelector('[data-slot="thinking-indicator-word"]')
				?.textContent
		).toBe("Wake started");
		expect(indicator.textContent).not.toContain("Agent is working");
	});
});

function createThinkingEntry(
	input: Partial<SpaceMessageWakeThinkingEntry> & {
		elapsedStartedAtMs: number | null;
	}
): SpaceMessageWakeThinkingEntry {
	const targetProfileId = input.targetProfileId ?? "agt_runner";
	return {
		elapsedStartedAtMs: input.elapsedStartedAtMs,
		key: input.key ?? `dispatch:${targetProfileId}`,
		kind: input.kind ?? "progress",
		phase: input.phase ?? (input.kind === "preview" ? "writing" : "running"),
		step: input.step ?? {
			description: "OpenMeld is running the agent.",
			kind: "working",
			label: "Agent is working",
			status: "active",
		},
		targetProfileId,
		text: input.text ?? "Agent is working",
	};
}

function resolveOrbState(container: HTMLElement): string | null {
	return (
		container
			.querySelector("canvas")
			?.getAttribute("data-space-agent-orb-state") ?? null
	);
}
