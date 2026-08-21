import type { InboxItem, InboxSourceTarget } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { buildInboxItemSourceNavigation } from "./source-target";

describe("buildInboxItemSourceNavigation", () => {
	it("preserves the exact Space signal and thread target", () => {
		expect(
			buildInboxItemSourceNavigation({
				item: createInboxItem({
					kind: "space",
					signalId: "signal-123",
					spaceId: "space-123",
					threadRootSignalId: "thread-123",
				}),
				orgSlug: "Amplift Team",
			})
		).toEqual({
			href: "/o/Amplift%20Team/spaces/space-123?focusSignalId=signal-123&focusThreadRootSignalId=thread-123",
			openInNewTab: false,
		});
	});

	it("preserves the exact agent interaction target", () => {
		expect(
			buildInboxItemSourceNavigation({
				item: createInboxItem({
					interactionId: "interaction-123",
					kind: "agent_interaction",
					runtimeCoordinatorExecutionId: "execution-123",
					sourceSignalId: "signal-123",
					spaceId: "space-123",
				}),
				orgSlug: "amplift",
			})
		).toEqual({
			href: "/o/amplift/spaces/space-123?focusInteractionId=interaction-123&focusSignalId=signal-123",
			openInNewTab: false,
		});
	});

	it("preserves the exact Center Agent reply target", () => {
		expect(
			buildInboxItemSourceNavigation({
				item: createInboxItem({
					kind: "center_agent",
					signalId: "signal-123",
					spaceId: "space-123",
				}),
				orgSlug: "amplift",
			})
		).toEqual({
			href: "/o/amplift/center-agent/chat?focusSignalId=signal-123",
			openInNewTab: false,
		});
	});

	it("opens the exact Slack message permalink", () => {
		expect(
			buildInboxItemSourceNavigation({
				item: createInboxItem({
					channelId: "C0123456",
					kind: "message_channel",
					messageId: "1720000000.000200",
					permalink:
						"https://amplift.slack.com/archives/C0123456/p1720000000000200?thread_ts=1720000000.000100&cid=C0123456",
					provider: "slack",
					teamId: "T0123456",
					threadRootMessageId: "1720000000.000100",
				}),
				orgSlug: "amplift",
			})
		).toEqual({
			href: "https://amplift.slack.com/archives/C0123456/p1720000000000200?thread_ts=1720000000.000100&cid=C0123456",
			openInNewTab: true,
		});
	});

	it.each([
		[
			{
				kind: "agent_profile_creation_request",
				requestId: "request/with spaces",
			} as const,
			"/o/amplift/agents?view=requests&requestId=request%2Fwith+spaces",
		],
		[
			{ kind: "center_agent_task", taskId: "task/with spaces" } as const,
			"/o/amplift/center-agent/tasks/task%2Fwith%20spaces",
		],
		[
			{ documentId: "document-123", kind: "organization_document" } as const,
			"/o/amplift/documents/document-123",
		],
		[{ kind: "center_agent" } as const, "/o/amplift/center-agent/chat"],
		[
			{ kind: "settings", section: "channels" } as const,
			"/o/amplift/center-agent/channels",
		],
		[
			{ kind: "settings", section: "computers" } as const,
			"/o/amplift/computers",
		],
		[
			{ kind: "settings", section: "notifications" } as const,
			"/o/amplift/settings/notifications",
		],
	])("routes %j to %s", (sourceTarget, expectedPath) => {
		expect(
			buildInboxItemSourceNavigation({
				item: createInboxItem(sourceTarget),
				orgSlug: "amplift",
			})
		).toEqual({ href: expectedPath, openInNewTab: false });
	});
});

function createInboxItem(sourceTarget: InboxSourceTarget): InboxItem {
	return {
		attention: "update",
		contextLabel: "Design Room",
		createdAt: "2026-08-04T01:00:00.000Z",
		id: "item-123",
		importance: "normal",
		kind: "space_message",
		occurredAt: "2026-08-04T01:00:00.000Z",
		organizationId: "organization-123",
		preview: "A new update is ready.",
		readAt: null,
		recipientUserId: "user-123",
		resolutionStatus: "not_applicable",
		sourceTarget,
		title: "New update",
		updatedAt: "2026-08-04T01:00:00.000Z",
	};
}
