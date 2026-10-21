import type { InboxItem, InboxSourceTarget } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	buildInboxAgentInteractionConversationHref,
	buildInboxItemSourceNavigation,
	isInboxItemSourceLocation,
	keepInboxFilters,
} from "./source-target";

describe("buildInboxItemSourceNavigation", () => {
	it("keeps a Direct Message in Chats with its exact thread and signal", () => {
		expect(
			buildInboxItemSourceNavigation({
				orgSlug: "amplift",
				item: createInboxItem({
					kind: "space",
					spaceId: "dm-123",
					signalId: "reply-123",
					threadRootSignalId: "root-123",
					directMessage: true,
				}),
			})
		).toEqual({
			href: "/o/amplift/chats/dm-123?focusSignalId=reply-123&focusThreadRootSignalId=root-123",
			openInNewTab: false,
		});
	});
	it("suppresses only the exact visible Center Agent session", () => {
		const item = createInboxItem({
			kind: "center_agent",
			spaceId: "session-one",
			signalId: "reply",
		});
		for (const spaceId of ["session-one", "session-two"]) {
			expect(
				isInboxItemSourceLocation({
					item,
					orgSlug: "amplift",
					pathname: "/o/amplift/chats/center-agent",
					visibleConversation: {
						kind: "space",
						spaceId,
						threadRootSignalId: null,
					},
				})
			).toBe(spaceId === "session-one");
		}
		expect(
			isInboxItemSourceLocation({
				item,
				orgSlug: "amplift",
				pathname: "/o/amplift/chats/center-agent",
				visibleConversation: null,
			})
		).toBe(false);
	});
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

	it("answers an Agent's question in Inbox and keeps its exact conversation", () => {
		const target = {
			interactionId: "interaction-123",
			kind: "agent_interaction" as const,
			runtimeCoordinatorExecutionId: "execution-123",
			sourceSignalId: "signal-123",
			spaceId: "space-123",
			threadRootSignalId: "root-signal-123",
		};
		expect(
			buildInboxItemSourceNavigation({
				item: createInboxItem(target),
				orgSlug: "amplift",
			})
		).toEqual({
			href: "/o/amplift/inbox?item=item-123",
			openInNewTab: false,
		});
		expect(
			buildInboxAgentInteractionConversationHref({ orgSlug: "amplift", target })
		).toBe(
			"/o/amplift/spaces/space-123?focusInteractionId=interaction-123&focusSignalId=signal-123&focusThreadRootSignalId=root-signal-123"
		);
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
			href: "/o/amplift/chats/center-agent?session=space-123&focusSignalId=signal-123",
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
				kind: "organization_join_request",
				requestId: "request/with spaces",
			} as const,
			"/o/amplift/inbox?requestId=request%2Fwith%20spaces",
		],
		[
			{ kind: "agent_profile", profileId: "profile/with spaces" } as const,
			"/o/amplift/agents?profileId=profile%2Fwith+spaces",
		],
		[
			{
				kind: "agent_profile_creation_request",
				requestId: "request/with spaces",
			} as const,
			"/o/amplift/people/agent-requests?requestId=request%2Fwith+spaces",
		],
		[
			{ documentId: "document-123", kind: "organization_document" } as const,
			"/o/amplift/documents/document-123",
		],
		[{ kind: "center_agent" } as const, "/o/amplift/chats/center-agent"],
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
			"/o/amplift/inbox?appSettings=notifications",
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

describe("isInboxItemSourceLocation", () => {
	it("suppresses a Space thread item only while that exact thread is visible", () => {
		const item = createInboxItem({
			kind: "space",
			signalId: "signal-123",
			spaceId: "space-123",
			threadRootSignalId: "root-signal-123",
		});
		const baseInput = {
			item,
			orgSlug: "amplift",
			pathname: "/o/amplift/spaces/space-123",
		};

		expect(
			isInboxItemSourceLocation({
				...baseInput,
				visibleConversation: {
					kind: "space",
					spaceId: "space-123",
					threadRootSignalId: "root-signal-123",
				},
			})
		).toBe(true);
		expect(
			isInboxItemSourceLocation({
				...baseInput,
				visibleConversation: {
					kind: "space",
					spaceId: "space-123",
					threadRootSignalId: "another-root-signal",
				},
			})
		).toBe(false);
	});

	it("does not suppress Space messages while Files or Graph is visible", () => {
		const item = createInboxItem({
			kind: "space",
			signalId: "signal-123",
			spaceId: "space-123",
		});

		expect(
			isInboxItemSourceLocation({
				item,
				orgSlug: "amplift",
				pathname: "/o/amplift/spaces/space-123",
				visibleConversation: null,
			})
		).toBe(false);
	});

	it("recognizes the exact Direct Message conversation from rendered state", () => {
		const item = createInboxItem({
			kind: "space",
			signalId: "signal-123",
			spaceId: "direct-message-123",
		});

		expect(
			isInboxItemSourceLocation({
				item,
				orgSlug: "amplift",
				pathname: "/o/amplift/chats/direct-message-123",
				visibleConversation: {
					kind: "space",
					spaceId: "direct-message-123",
					threadRootSignalId: null,
				},
			})
		).toBe(true);
	});

	it("suppresses an Agent Interaction only in its exact thread", () => {
		const item = createInboxItem({
			interactionId: "interaction-123",
			kind: "agent_interaction",
			runtimeCoordinatorExecutionId: "execution-123",
			sourceSignalId: "signal-123",
			spaceId: "space-123",
			threadRootSignalId: "root-signal-123",
		});
		const baseInput = {
			item,
			orgSlug: "amplift",
			pathname: "/o/amplift/spaces/space-123",
		};

		expect(
			isInboxItemSourceLocation({
				...baseInput,
				visibleConversation: {
					kind: "space",
					spaceId: "space-123",
					threadRootSignalId: "root-signal-123",
				},
			})
		).toBe(true);
		expect(
			isInboxItemSourceLocation({
				...baseInput,
				visibleConversation: {
					kind: "space",
					spaceId: "space-123",
					threadRootSignalId: null,
				},
			})
		).toBe(false);
	});

	it("suppresses a main-timeline Agent Interaction only on the main timeline", () => {
		const item = createInboxItem({
			interactionId: "interaction-123",
			kind: "agent_interaction",
			runtimeCoordinatorExecutionId: "execution-123",
			sourceSignalId: "signal-123",
			spaceId: "space-123",
			threadRootSignalId: null,
		});

		expect(
			isInboxItemSourceLocation({
				item,
				orgSlug: "amplift",
				pathname: "/o/amplift/spaces/space-123",
				visibleConversation: {
					kind: "space",
					spaceId: "space-123",
					threadRootSignalId: null,
				},
			})
		).toBe(true);
	});

	it("keeps alerts for legacy Agent Interactions without exact thread facts", () => {
		const item = createInboxItem({
			interactionId: "interaction-123",
			kind: "agent_interaction",
			runtimeCoordinatorExecutionId: "execution-123",
			sourceSignalId: "signal-123",
			spaceId: "space-123",
		});

		expect(
			isInboxItemSourceLocation({
				item,
				orgSlug: "amplift",
				pathname: "/o/amplift/spaces/space-123",
				visibleConversation: {
					kind: "space",
					spaceId: "space-123",
					threadRootSignalId: null,
				},
			})
		).toBe(false);
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

describe("keepInboxFilters", () => {
	it("keeps the user's view and filters when an item opens in Inbox", () => {
		expect(
			keepInboxFilters({
				currentPathname: "/o/amplift/inbox",
				currentSearch: "?view=needs-action&unread=true&item=old&requestId=r1",
				href: "/o/amplift/inbox?item=item-123",
			})
		).toBe("/o/amplift/inbox?view=needs-action&unread=true&item=item-123");
	});

	it("never carries a Space's focus into another item in the same Space", () => {
		expect(
			keepInboxFilters({
				currentPathname: "/o/amplift/spaces/space-1",
				currentSearch: "?focusThreadRootSignalId=root&focusInteractionId=i",
				href: "/o/amplift/spaces/space-1?focusSignalId=s",
			})
		).toBe("/o/amplift/spaces/space-1?focusSignalId=s");
	});

	it("leaves a link to another page alone", () => {
		expect(
			keepInboxFilters({
				currentPathname: "/o/amplift/inbox",
				currentSearch: "?view=needs-action",
				href: "/o/amplift/spaces/space-1?focusSignalId=s",
			})
		).toBe("/o/amplift/spaces/space-1?focusSignalId=s");
	});
});
