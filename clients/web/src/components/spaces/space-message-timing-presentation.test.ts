import type {
	GetSpaceMessageDetailsResponse,
	WakeTiming,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	buildMessageTimingExport,
	buildMessageTimingPresentation,
	formatTimingDuration,
} from "./space-message-timing-presentation";

type WakeTarget =
	GetSpaceMessageDetailsResponse["wakeContext"]["targets"][number];

const T0 = Date.parse("2026-05-13T00:00:00.000Z");
const iso = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

const runningTiming: WakeTiming = {
	modelVersion: "openmeld.wake_timing.v1",
	factSource: "platform_observed",
	state: "in_progress",
	asOf: iso(1000),
	lastEvidenceAt: iso(880),
	milestones: [],
	segments: [
		segment("routing", 0, 2),
		segment("queue", 2, 4, "runtime_coordinator.head_queued"),
		segment("delivery", 4, 5),
		segment("startup", 5, 65, "runtime.local_queue.waiting_workspace_conflict"),
		segment("agent_run", 65, 400, "provider.unknown_reason"),
		segment("waiting_for_input", 400, null),
	],
	totals: {
		endToEndMs: 1_000_000,
		byKind: {
			routing: 2000,
			queue: 2000,
			delivery: 1000,
			startup: 60_000,
			agent_run: 335_000,
			waiting_for_input: 600_000,
			result_delivery: 0,
			publishing: 0,
			not_recorded: 0,
		},
	},
};

describe("Message Details timing presentation", () => {
	it("groups an in-progress Wake by attribution without inventing missing time", () => {
		const [presentation] = buildMessageTimingPresentation([
			target({ targetLabel: "@agt_opaque", timing: runningTiming }),
			target({ targetProfileId: "agt-no-timing" }),
		]);

		expect(presentation).toMatchObject({
			targetName: "Agent",
			statusLabel: "16m 40s so far",
			lastUpdateLabel: "Last update 2m ago",
			summaryRows: [
				{ group: "agent_run", label: "Agent run", durationMs: 335_000 },
				{
					group: "waiting_for_input",
					label: "Waiting for input",
					durationMs: 600_000,
				},
				{
					group: "queued_and_starting",
					label: "Queued and starting",
					durationMs: 62_000,
				},
				{
					group: "openmeld",
					label: "OpenMeld routing and delivery",
					durationMs: 3000,
				},
			],
		});
		expect(
			presentation?.segments.map((row) => [row.label, row.detail, row.isOpen])
		).toEqual([
			["Routing the request", null, false],
			["Queued for the Agent", "Waiting for earlier tasks", false],
			["Delivering to the computer", null, false],
			[
				"Starting on the computer",
				"Waiting for another task in its folder",
				false,
			],
			["Agent run", null, false],
			["Waiting for input", null, true],
		]);
	});

	it("exports only targets with timing and keeps the recorded facts intact", () => {
		const details = {
			query: { spaceId: "space-1", signalId: "sig-1" },
			message: { signalId: "sig-1" },
			wakeContext: {
				targets: [
					target({ targetLabel: "Codex", timing: runningTiming }),
					target({ targetProfileId: "agt-no-timing" }),
				],
			},
		} as unknown as GetSpaceMessageDetailsResponse;

		expect(JSON.parse(buildMessageTimingExport(details))).toEqual({
			spaceId: "space-1",
			signalId: "sig-1",
			targets: [
				{
					targetProfileId: "agt-codex",
					targetLabel: "Codex",
					timing: runningTiming,
				},
			],
		});
	});

	it.each([
		[0, "<1s"],
		[999, "<1s"],
		[3250, "3.2s"],
		[59_999, "59s"],
		[60_000, "1m"],
		[669_000, "11m 9s"],
		[3_600_000, "1h"],
		[5_460_000, "1h 31m"],
		[90_000_000, "1d 1h"],
	])("formats %i ms as %s", (durationMs, expected) => {
		expect(formatTimingDuration(durationMs)).toBe(expected);
	});
});

function segment(
	kind: WakeTiming["segments"][number]["kind"],
	startSeconds: number,
	endSeconds: number | null,
	reasonCode: string | null = null
): WakeTiming["segments"][number] {
	return {
		kind,
		startedAt: iso(startSeconds),
		endedAt: endSeconds === null ? null : iso(endSeconds),
		durationMs: ((endSeconds ?? 1000) - startSeconds) * 1000,
		reasonCode,
	};
}

function target(input: {
	targetLabel?: string;
	targetProfileId?: string;
	timing?: WakeTiming;
}): WakeTarget {
	return {
		targetProfileId: input.targetProfileId ?? "agt-codex",
		targetLabel: input.targetLabel ?? null,
		...(input.timing ? { timing: input.timing } : {}),
	};
}
