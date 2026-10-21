import { describe, expect, it } from "vitest";
import {
	resolveSpaceStatusIndicators,
	resolveSpaceStatusLabel,
	type SpaceStatusSources,
} from "./space-status-indicators";

const sources: SpaceStatusSources = {
	unreadBySpaceId: new Map([
		["s-unread", { unreadCount: 2, messageUnreadCount: 2 }],
		["s-working", { unreadCount: 1, messageUnreadCount: 1 }],
	]),
	activeWakeSummaryBySpaceId: new Map([
		[
			"s-working",
			{
				spaceId: "s-working",
				activeWakeCount: 1,
				statuses: [
					{
						kind: "working",
						label: "Codex is working",
						description: "",
						status: "active",
					},
				],
			},
		],
		[
			"s-approval",
			{
				spaceId: "s-approval",
				activeWakeCount: 1,
				statuses: [
					{
						kind: "needs_input",
						label: "Codex needs your input",
						description: "",
						status: "pending",
					},
				],
			},
		],
	]),
	attentionById: new Map([["s-approval", { unresolvedActionCount: 1 }]]),
};

describe("resolveSpaceStatusIndicators", () => {
	it("reads one Space as its own sidebar row does", () => {
		expect(resolveSpaceStatusIndicators(["s-idle"], sources)).toEqual({
			unreadCount: 0,
			messageUnreadCount: undefined,
			activeWakeSummary: undefined,
			attentionTone: null,
		});
		expect(
			resolveSpaceStatusLabel(
				resolveSpaceStatusIndicators(["s-unread"], sources)
			)
		).toBe("unread updates");
	});

	it("combines Sessions so work waiting on the member leads the aggregate", () => {
		const combined = resolveSpaceStatusIndicators(
			["s-unread", "s-working", "s-approval", "s-idle"],
			sources
		);
		expect(combined).toMatchObject({
			unreadCount: 3,
			messageUnreadCount: 3,
			attentionTone: "warning",
			activeWakeSummary: { spaceId: "s-approval", activeWakeCount: 2 },
		});
		expect(resolveSpaceStatusLabel(combined)).toBe(
			"Priority attention, unread updates, Codex needs your input; Codex is working"
		);
	});
});
