import type { SensitiveOperationAuditEvent } from "@openmeld/schemas";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	groupAuditEventsByDay,
	SensitiveOperationAuditSection,
} from "./sensitive-operation-audit-section";

const { audit } = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock("#/query/sensitive-operations", () => ({
	useMemberAgentSensitiveOperationAudit: audit,
}));
vi.mock("#/lib/member-agents/member-agents-feature", () => ({
	isMemberAgentsEnabled: () => true,
}));

afterEach(cleanup);

const HOUR_MS = 3_600_000;
const NOW = new Date(2026, 9, 20, 15, 0).getTime();

function event(
	id: string,
	createdAtMs: number,
	overrides: Partial<SensitiveOperationAuditEvent> = {}
): SensitiveOperationAuditEvent {
	return {
		id,
		operation: "working_folder_write",
		agentProfileId: "p-1",
		sourceKind: "web_session",
		actorUserId: "u-1",
		chainRootProfileId: null,
		outcome: "succeeded",
		reasonCode: null,
		confirmationId: null,
		createdAtMs,
		...overrides,
	};
}

describe("groupAuditEventsByDay", () => {
	it("labels today, yesterday, and older days", () => {
		const groups = groupAuditEventsByDay(
			[
				event("a", NOW - HOUR_MS),
				event("b", NOW - 2 * HOUR_MS),
				event("c", NOW - 24 * HOUR_MS),
				event("d", NOW - 72 * HOUR_MS),
			],
			NOW
		);
		expect(groups.map((group) => group.label)).toEqual([
			"Today",
			"Yesterday",
			expect.stringContaining("17"),
		]);
		expect(groups[0]?.events.map((item) => item.id)).toEqual(["a", "b"]);
	});
});

describe("SensitiveOperationAuditSection", () => {
	it("shows one-line titles and a status only when a change did not go through", () => {
		vi.setSystemTime(NOW);
		audit.mockReturnValue({
			data: [
				event("a", NOW - HOUR_MS),
				event("b", NOW - 2 * HOUR_MS, {
					operation: "default_project_write",
					outcome: "failed",
				}),
				event("c", NOW - 3 * HOUR_MS, {
					operation: "binding_permission_mode",
					permissionModeChange: {
						bindingId: "binding-a",
						previousMode: "claude-code:auto",
						mode: "claude-code:dontAsk",
						previousRevision: 1,
						revision: 2,
						requestId: "request-a",
					},
				}),
			],
			isPending: false,
			isError: false,
		});
		render(
			<SensitiveOperationAuditSection
				memberAgentId="ma-1"
				profileNames={new Map()}
			/>
		);
		expect(screen.getByText("Working folder changed")).toBeTruthy();
		expect(screen.getByText("Default Project changed")).toBeTruthy();
		expect(screen.getByText("Failed")).toBeTruthy();
		expect(screen.getByText("Auto mode → Don't ask")).toBeTruthy();
		expect(screen.queryByText("Done")).toBeNull();
		expect(screen.getAllByText("1h ago").length).toBe(1);
		vi.useRealTimers();
	});

	it("shows the latest five until Show all", () => {
		audit.mockReturnValue({
			data: Array.from({ length: 7 }, (_, index) =>
				event(`e-${String(index)}`, NOW - index * HOUR_MS)
			),
			isPending: false,
			isError: false,
		});
		render(
			<SensitiveOperationAuditSection
				memberAgentId="ma-1"
				profileNames={new Map()}
			/>
		);
		expect(screen.getAllByText("Working folder changed")).toHaveLength(5);
		fireEvent.click(screen.getByRole("button", { name: "Show all 7" }));
		expect(screen.getAllByText("Working folder changed")).toHaveLength(7);
	});
});
