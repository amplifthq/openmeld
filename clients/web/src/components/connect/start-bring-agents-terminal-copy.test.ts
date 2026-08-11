import type { PrepareSessionSnapshot } from "@openmeld/schemas/types";
import { getSetupFlowCopy } from "@openmeld/start";
import { describe, expect, it, vi } from "vitest";
import {
	resolveTerminalStatusText,
	resolveTerminalStepSummary,
} from "./start-bring-agents-setup-page";

vi.mock("@tanstack/react-router", () => ({
	Link: () => null,
	useNavigate: () => () => undefined,
}));

function buildSnapshot(
	status: "connected" | "disconnected" | "never_connected"
): PrepareSessionSnapshot {
	const now = "2026-05-08T00:00:00.000Z";
	return {
		prepareSessionId: "prepare-session-1",
		ownerUserId: "user-1",
		humanProfileId: "12345678-1234-1234-1234-1234567890ab",
		deviceId: "device-1",
		runtimeLane: "prod",
		targetSpaceId: null,
		sessionRevision: 0,
		blockers: [],
		lifecycleStatus: "active",
		phase: "waiting_for_terminal",
		steps: [],
		localAgentCatalog: null,
		localReadinessSnapshot: null,
		selectedLocalAgentIds: [],
		terminalConnection: {
			status,
			connectionId: status === "connected" ? "connection-1" : null,
			connectionEpoch: status === "connected" ? 1 : null,
			connectedAt: status === "connected" ? now : null,
			lastSeenAt: status === "connected" ? now : null,
			disconnectedAt: null,
			disconnectReason: null,
		},
		diagnosticCorrelationId: "diag-1",
		createdAt: now,
		updatedAt: now,
		completedAt: null,
		expiresAt: "2026-05-08T01:00:00.000Z",
	};
}

describe("terminal disconnected copy", () => {
	it("keeps a recently disconnected Terminal in the automatic reconnect state", () => {
		const setupCopy = getSetupFlowCopy("setup");
		const disconnectedAt = "2026-05-08T00:00:00.000Z";
		const snapshot = {
			...buildSnapshot("disconnected"),
			terminalConnection: {
				...buildSnapshot("disconnected").terminalConnection,
				disconnectedAt,
			},
		};
		const nowMs = Date.parse(disconnectedAt) + 10_000;

		expect(resolveTerminalStepSummary({ nowMs, setupCopy, snapshot })).toBe(
			setupCopy.connectTerminalReconnectingSummary
		);
		expect(
			resolveTerminalStatusText({
				nowMs,
				setupCopy,
				snapshot,
				webSocketStatus: "connecting",
			})
		).toBe(setupCopy.connectTerminalReconnectingSummary);
	});

	it("offers a fresh command after the automatic reconnect window ends", () => {
		const setupCopy = getSetupFlowCopy("setup");
		const disconnectedAt = "2026-05-08T00:00:00.000Z";
		const snapshot = {
			...buildSnapshot("disconnected"),
			terminalConnection: {
				...buildSnapshot("disconnected").terminalConnection,
				disconnectedAt,
			},
		};

		expect(
			resolveTerminalStatusText({
				nowMs: Date.parse(disconnectedAt) + 30_000,
				setupCopy,
				snapshot,
				webSocketStatus: "connecting",
			})
		).toBe("Terminal disconnected. Run a fresh setup command.");
	});

	it("renders the disconnected sentence exactly once in the status text", () => {
		const setupCopy = getSetupFlowCopy("setup");

		const statusText = resolveTerminalStatusText({
			setupCopy,
			snapshot: buildSnapshot("disconnected"),
			webSocketStatus: "connecting",
		});

		expect(statusText).toBe(
			"Terminal disconnected. Run a fresh setup command."
		);
		expect(statusText).not.toContain(
			"Terminal disconnected. Terminal disconnected."
		);
		expect(statusText.match(/Terminal disconnected\./g)).toHaveLength(1);
	});

	it("keeps the step summary and status text aligned on a single sentence", () => {
		const setupCopy = getSetupFlowCopy("setup");
		const snapshot = buildSnapshot("disconnected");

		expect(resolveTerminalStepSummary({ setupCopy, snapshot })).toBe(
			setupCopy.connectTerminalDisconnectedSummary
		);
		expect(
			resolveTerminalStatusText({
				setupCopy,
				snapshot,
				webSocketStatus: "connecting",
			})
		).toBe(setupCopy.connectTerminalDisconnectedSummary);
	});

	it("does not print the disconnected copy for the update flow more than once", () => {
		const setupCopy = getSetupFlowCopy("update_service");

		const statusText = resolveTerminalStatusText({
			setupCopy,
			snapshot: buildSnapshot("disconnected"),
			webSocketStatus: "connecting",
		});

		expect(statusText).toBe(
			"Terminal disconnected. Run a fresh update command."
		);
		expect(statusText.match(/Terminal disconnected\./g)).toHaveLength(1);
	});

	it("reports the completed session instead of reconnecting when the terminal exits after setup completes", () => {
		const setupCopy = getSetupFlowCopy("setup");
		const disconnectedAt = "2026-05-08T00:00:00.000Z";
		const base = buildSnapshot("disconnected");
		const snapshot = {
			...base,
			completedAt: disconnectedAt,
			lifecycleStatus: "completed" as const,
			phase: "ready" as const,
			terminalConnection: {
				...base.terminalConnection,
				disconnectedAt,
				disconnectReason: "completed",
			},
		};
		const nowMs = Date.parse(disconnectedAt) + 10_000;

		expect(resolveTerminalStepSummary({ nowMs, setupCopy, snapshot })).toBe(
			setupCopy.connectTerminalCompleteSummary
		);
		expect(
			resolveTerminalStatusText({
				nowMs,
				setupCopy,
				snapshot,
				webSocketStatus: "connecting",
			})
		).toBe(setupCopy.connectTerminalCompleteSummary);
	});

	it("waits instead of reporting disconnection before the terminal ever connects", () => {
		const setupCopy = getSetupFlowCopy("setup");
		const snapshot = buildSnapshot("never_connected");

		expect(resolveTerminalStepSummary({ setupCopy, snapshot })).toBe(
			setupCopy.connectTerminalPendingSummary
		);
		expect(
			resolveTerminalStatusText({
				setupCopy,
				snapshot,
				webSocketStatus: "connecting",
			})
		).toBe(
			"Run the command in Terminal. OpenMeld is waiting for this computer."
		);
		expect(
			resolveTerminalStatusText({
				setupCopy,
				snapshot,
				webSocketStatus: "connecting",
			})
		).not.toContain("Terminal disconnected.");
	});
});
