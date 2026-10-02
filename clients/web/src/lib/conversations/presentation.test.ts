import type { InboxItem } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { presentInboxConversation } from "./presentation";

const item: InboxItem = {
	id: "reply",
	organizationId: "org",
	recipientUserId: "user",
	kind: "agent_reply",
	sourceTarget: { kind: "center_agent", spaceId: "chat", signalId: "signal" },
	title: "Center Agent replied in Original chat",
	contextLabel: "Center Agent",
	preview: "The work is ready.",
	attention: "update",
	importance: "normal",
	resolutionStatus: "not_applicable",
	readAt: null,
	createdAt: "2026-01-01T00:00:00.000Z",
	occurredAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("current conversation names in historical Inbox items", () => {
	it.each([
		{
			title: item.title,
			contextLabel: "Center Agent",
			sourceName: "Original chat",
			kind: "center_agent" as const,
			expected: "Center Agent replied in Issues + PR records",
		},
		{
			title: item.title,
			contextLabel: "Center Agent",
			sourceName: undefined,
			kind: "center_agent" as const,
			expected: "Center Agent replied in Issues + PR records",
		},
		{
			title: "Robin replied to your thread in Original space",
			contextLabel: "Original space",
			sourceName: "Renamed space",
			kind: "space" as const,
			expected: "Robin replied to your thread in Issues + PR records",
		},
		{
			title: "Robin mentioned you in Original space",
			contextLabel: "Original space",
			sourceName: undefined,
			kind: "space" as const,
			expected: "Robin mentioned you in Issues + PR records",
		},
		{
			title: "Agent update in Original space",
			contextLabel: "Original space",
			sourceName: undefined,
			kind: "space" as const,
			expected: "Agent update in Issues + PR records",
		},
		{
			title: "Robin replied in Old…",
			contextLabel: "Old long name",
			sourceName: undefined,
			kind: "space" as const,
			expected: "Robin replied in Issues + PR records",
		},
		{
			title: "Robin replied in Team replied in New York",
			contextLabel: "Team replied in New York",
			sourceName: undefined,
			kind: "space" as const,
			expected: "Robin replied in Issues + PR records",
		},
		{
			title: "Agent replied in New York replied in Original space",
			contextLabel: "Original space",
			sourceName: undefined,
			kind: "space" as const,
			expected: "Agent replied in New York replied in Issues + PR records",
		},
	])("updates $title without changing the underlying event", ({
		title,
		contextLabel,
		sourceName,
		kind,
		expected,
	}) => {
		const original = {
			...item,
			title,
			contextLabel,
			sourceTarget: { kind, spaceId: "chat", signalId: "signal" },
		};
		const displayed = presentInboxConversation(original, {
			name: "Issues + PR records",
			sourceName,
		});
		expect(displayed).toEqual({
			...original,
			title: expected,
			contextLabel: "Issues + PR records",
		});
		expect(original.title).toBe(title);
	});

	it("preserves custom, ambiguous and non-message titles", () => {
		for (const original of [
			{ ...item, title: "Review the launch plan" },
			{ ...item, title: "Robin replied in Team replied in London" },
			{ ...item, kind: "system_issue" as const },
		]) {
			expect(
				presentInboxConversation(original, { name: "Saved chat" }).title
			).toBe(original.title);
		}
		expect(presentInboxConversation(item, undefined)).toBe(item);
	});
});
