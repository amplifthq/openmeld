import { describe, expect, it } from "vitest";
import { resolveAgentProfileActivityPreview } from "./agent-profile-activity-preview";

describe("resolveAgentProfileActivityPreviewContext", () => {
	it.each([
		["Ready Agent", "idle", 0],
		["Working Agent", "working", 0],
		["Queued Agent", "working", 3],
		["Waiting Agent", "paused", 2],
		["Attention Agent", "paused", 1],
		["Checking Agent", "checking", 0],
	] as const)("maps %s to its localhost activity branch", (name, status, count) => {
		const preview = resolveAgentProfileActivityPreview(name, "acme");
		expect(preview?.operationalContext.status).toBe(status);
		expect(preview?.operationalContext.waitingCount).toBe(count);
	});

	it("provides clickable Space, Direct Message, and computer destinations", () => {
		const preview = resolveAgentProfileActivityPreview("Queued Agent", "acme");
		expect(preview?.navigation.current).toEqual({
			href: "/o/acme/spaces",
			source: "space",
			title: "Customer support",
		});
		expect(preview?.navigation.queued).toEqual([
			{
				href: "/o/acme/spaces",
				source: "space",
				title: "Launch planning",
			},
			{
				href: "/o/acme/chats",
				source: "direct_message",
				title: "Bug triage",
			},
			{
				href: "/o/acme/computers",
				source: "computer",
				title: "Sales follow-up",
			},
		]);
	});

	it("does not replace ordinary Core-projected Agent state", () => {
		expect(
			resolveAgentProfileActivityPreview("Release Reviewer", "acme")
		).toBeNull();
	});
});
