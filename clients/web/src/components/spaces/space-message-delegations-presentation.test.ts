import type {
	SpaceMessageDelegatedTask,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	delegatedTaskStatus,
	delegatedWorkSummary,
	delegationCompletionLabel,
} from "./space-message-delegations-presentation";

const child: SpaceMessageDelegatedTask = {
	key: "delegation:0",
	availability: "readable",
	coordinationState: "active",
	role: "primary",
	spaceId: "space",
	sourceSignalId: "request",
	resultSignalId: null,
	targetProfileId: "agent",
	targetLabel: "Reviewer",
	taskPreview: "Review the pinned change.",
	outcome: null,
	progress: null,
};
const progress: WakeProgressItem = {
	clientMessageId: "request",
	sourceSignalId: "request",
	targetProfileId: "agent",
	targetLabel: "Reviewer",
	dispatchId: "dispatch",
	phase: "running",
	terminal: false,
	updatedAtMs: 100,
	message: "Working",
};

describe("declared delegation presentation", () => {
	it.each([
		["queued", "Queued"],
		["running", "Running"],
		["publishing", "Reply pending"],
		["publication_unknown", "Publication unconfirmed"],
		["replied", "Completed"],
		["failed", "Failed"],
		["stopped", "Stopped"],
	] as const)("uses the execution/publication owner's %s state", (phase, label) => {
		expect(
			delegatedTaskStatus({ ...child, progress: { ...progress, phase } })
		).toBe(label);
	});

	it("keeps owner input nonterminal and never interprets active coordination as running", () => {
		expect(delegatedTaskStatus(child)).toBe("Status unavailable");
		expect(
			delegatedTaskStatus({
				...child,
				progress: {
					...progress,
					pendingInteraction: {
						interactionId: "input",
						kind: "permission",
						canRespond: false,
						requestedAtMs: 100,
						expiresAtMs: 200,
						request: null,
					},
				},
			})
		).toBe("Waiting for owner input");
		expect(
			delegatedTaskStatus({ ...child, availability: "unavailable", progress })
		).toBe("Unavailable");
	});

	it("preserves failure against stale running evidence and separates partial completion from final answer ownership", () => {
		const failed: SpaceMessageDelegatedTask = {
			...child,
			progress,
			outcome: {
				status: "failed",
				errorCode: "failed",
				eventId: "failure",
				occurredAtMs: 200,
				publishedSignalId: null,
			},
		};
		const completed: SpaceMessageDelegatedTask = {
			...child,
			key: "delegation:1",
			outcome: {
				status: "succeeded",
				errorCode: null,
				eventId: "success",
				occurredAtMs: 201,
				publishedSignalId: "result",
			},
		};
		const group = {
			delegationId: "delegation",
			coordinatorProfileId: "center",
			completionPolicy: {
				mode: "resume_parent",
				when: "all_terminal",
			} as const,
			children: [completed, failed],
		};
		expect(delegatedTaskStatus(failed)).toBe("Failed");
		expect(delegatedWorkSummary({ groups: [group], nextCursor: null })).toBe(
			"1 completed · 1 failed"
		);
		expect(delegationCompletionLabel(group, "Center Agent")).toBe(
			"Center Agent owns the follow-up after all delegated tasks finish, including failures."
		);
		expect(
			delegationCompletionLabel(
				{ ...group, completionPolicy: { mode: "child_reports_directly" } },
				"Center Agent"
			)
		).toBe("Each Agent reports its own result directly.");
	});
});
