import {
	createSpaceMemberAgentSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type { SignalEnvelope } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { buildSpaceTimelineItems } from "#/lib/spaces/timeline";
import {
	SpaceMessageEditingScope,
	useSpaceMessageEditing,
} from "./space-message-editing";
import { buildSpaceMentionTargetItems } from "./use-space-mention-authoring";

vi.mock("#/lib/spaces/api", () => ({ createUnscopedWebSpaceApi: vi.fn() }));
const mutateMessage =
	vi.fn<ReturnType<typeof createUnscopedWebSpaceApi>["mutateMessage"]>();
const agentId = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const original: Extract<SignalEnvelope, { type: "signal.text" }> = {
	v: 1,
	id: "original-message",
	spaceId: "space-1",
	ts: 100,
	profile: { profileId: "human-1", profileName: "Casey", kind: "human" },
	type: "signal.text",
	data: { text: "Keep this request" },
};
function required<T>(value: T | null | undefined): T {
	if (value == null) {
		throw new Error("Missing test fixture");
	}
	return value;
}
const item = required(
	buildSpaceTimelineItems({
		envelopes: [original],
		membersSnapshot: null,
	})[0]
);
const targets = buildSpaceMentionTargetItems({
	query: "",
	snapshot: createSpaceMembersSnapshot({
		agents: [
			createSpaceMemberAgentSnapshot({
				agentControllerRef: "builtin:codex",
				profileId: agentId,
				profileName: "Runner",
			}),
		],
	}),
});
const target = required(targets[0]);

function wrapper({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={new QueryClient()}>
			<SpaceMessageEditingScope
				draftKey=""
				hasDraft={false}
				mentionPickerItems={targets}
				onRestore={() => Promise.resolve()}
				selfProfileId="human-1"
			>
				{children}
			</SpaceMessageEditingScope>
		</QueryClientProvider>
	);
}

describe("one-click first Wake through message editing", () => {
	afterEach(() => {
		cleanup();
		vi.resetAllMocks();
	});
	function setup() {
		vi.mocked(createUnscopedWebSpaceApi, { partial: true }).mockReturnValue({
			mutateMessage,
		});
		return renderHook(() => required(useSpaceMessageEditing()), { wrapper });
	}
	it("edits the original directly without opening an editor and rejects repeated clicks in flight", async () => {
		let rejectRequest!: (error: Error) => void;
		mutateMessage.mockImplementation(
			() =>
				new Promise((_, reject) => {
					rejectRequest = reject;
				})
		);
		const { result } = setup();
		let first!: Promise<boolean>;
		let duplicate!: Promise<boolean>;
		act(() => {
			first = result.current.wake(item, target);
			duplicate = result.current.wake(item, target);
		});
		expect(mutateMessage).toHaveBeenCalledTimes(1);
		expect(mutateMessage).toHaveBeenCalledWith({
			spaceId: "space-1",
			signalId: "original-message",
			body: {
				action: "edit",
				expectedRevision: 0,
				text: "@Runner Keep this request",
				retainedFileIds: [],
				retainedAttachmentIds: [],
				messageEnvelope: {
					text: "@Runner Keep this request",
					activationTargets: [agentId],
					referenceTargets: [],
					mentionTargets: [],
				},
			},
		});
		expect(result.current.edit).toBeNull();
		expect(result.current.changes.get(item.id)).toMatchObject({
			id: item.id,
			createdAtMs: 100,
			wakeTargetProfileIds: [agentId],
		});
		expect(await duplicate).toBe(false);
		await act(async () => {
			rejectRequest(new Error("Connection lost"));
			expect(await first).toBe(false);
		});
		expect(result.current.edit).toBeNull();
		expect(result.current.changes.size).toBe(0);
		expect(result.current.error).toBe("Connection lost");
	});
	it("never rearms an already-woken message or discards an active edit", async () => {
		const { result } = setup();
		await act(async () => {
			expect(
				await result.current.wake(
					{ ...item, wakeTargetProfileIds: [agentId] },
					target
				)
			).toBe(false);
		});
		act(() => result.current.beginEdit(item));
		await act(async () => {
			expect(await result.current.wake(item, target)).toBe(false);
		});
		expect(mutateMessage).not.toHaveBeenCalled();
		expect(result.current.edit?.id).toBe(item.id);
	});
});
