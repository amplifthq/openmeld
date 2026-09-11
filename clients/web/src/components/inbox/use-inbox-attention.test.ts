import { describe, expect, it } from "vitest";
import { resolveInboxAttention } from "./use-inbox-attention";

describe("Inbox attention", () => {
	it.each([
		[0, 0, 0, null],
		[0, 3, 3, "warning"],
		[2, 0, 2, "danger"],
		[2, 3, 5, "danger"],
		[100, 3, 103, "danger"],
	] as const)("counts %i actions plus %i urgent updates", (actions, urgent, count, tone) => {
		expect(
			resolveInboxAttention({
				summary: {
					organizationId: "org",
					totalUnreadCount: 200,
					unresolvedActionCount: actions,
					unreadUrgentUpdateCount: urgent,
				},
				pending: false,
				unavailable: false,
			})
		).toMatchObject({ count, tone });
	});
	it("does not present missing or failed data as a confirmed count", () => {
		const summary = {
			organizationId: "org",
			totalUnreadCount: 0,
			unresolvedActionCount: 0,
		};
		expect(
			resolveInboxAttention({ summary, pending: false, unavailable: false })
		).toMatchObject({ count: null, tone: null });
		expect(
			resolveInboxAttention({
				summary: { ...summary, unreadUrgentUpdateCount: 4 },
				pending: false,
				unavailable: true,
			})
		).toMatchObject({ count: null, tone: null });
		expect(
			resolveInboxAttention({
				summary: undefined,
				pending: true,
				unavailable: false,
			})
		).toEqual({ count: null, tone: null, label: "Inbox", status: null });
	});
	it("keeps the last confirmed count while refreshing", () => {
		expect(
			resolveInboxAttention({
				summary: {
					organizationId: "org",
					totalUnreadCount: 4,
					unresolvedActionCount: 0,
					unreadUrgentUpdateCount: 4,
				},
				pending: true,
				unavailable: false,
			})
		).toMatchObject({
			count: 4,
			tone: "warning",
			label: "Inbox, 4 unread urgent updates",
		});
	});
	it("explains a mixed total without implying every item is urgent or actionable", () => {
		expect(
			resolveInboxAttention({
				summary: {
					organizationId: "org",
					totalUnreadCount: 20,
					unresolvedActionCount: 2,
					unreadUrgentUpdateCount: 3,
				},
				pending: false,
				unavailable: false,
			}).label
		).toBe("Inbox, 2 pending items, 3 unread urgent updates");
	});
});
