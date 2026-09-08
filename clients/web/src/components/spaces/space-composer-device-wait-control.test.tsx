import {
	createSpaceMemberAgentSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceComposer, type SpaceComposerProps } from "./space-composer";
import { buildSpaceComposerAddressingTargets } from "./use-space-mention-authoring";

const profileId = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function props(): SpaceComposerProps {
	const agent = createSpaceMemberAgentSnapshot({
		profileId,
		profileName: "Runner",
		agentWakeAvailability: { status: "offline_for_wake" },
	});
	agent.deviceWaitTarget = {
		bindingId: "binding-1",
		openMeldServiceRuntimeId: "runtime-1",
	};
	return {
		actions: { onEditorChange: vi.fn(), onSubmit: vi.fn() },
		availability: {
			canSendMessage: true,
			fileLimitReached: false,
			isSendingMessage: false,
			sendBlocked: false,
		},
		composerRef: createRef(),
		content: {
			addressingTargets: buildSpaceComposerAddressingTargets({
				mentions: [{ profileId, relation: "wake" }],
				snapshot: createSpaceMembersSnapshot({ agents: [agent] }),
			}),
			authoredMentions: [],
			files: [],
			mentionPickerItems: [],
			text: "Check the report",
		},
		context: { conversationKind: "space", placement: "conversation" },
		centerAgentProfileId: null,
	};
}
describe("Composer offline waiting submission", () => {
	afterEach(cleanup);
	it("does not unblock another offline Wake in the same message", () => {
		const input = props();
		const selected = input.content.addressingTargets[0];
		if (!selected) {
			throw new Error("Missing selected Agent");
		}
		input.content.addressingTargets = [
			selected,
			{
				...selected,
				profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
				profileName: "Other Agent",
			},
		];
		render(<SpaceComposer {...input} />);
		fireEvent.click(screen.getByRole("checkbox"));
		expect(
			(
				screen.getByRole("button", {
					name: "Send message",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
	});

	it("blocks again if the selected computer changes while composing", () => {
		const input = props();
		const rendered = render(<SpaceComposer {...input} />);
		fireEvent.click(screen.getByRole("checkbox"));
		expect(
			(
				screen.getByRole("button", {
					name: "Send message",
				}) as HTMLButtonElement
			).disabled
		).toBe(false);
		input.content.addressingTargets = input.content.addressingTargets.map(
			(target) => ({
				...target,
				deviceWaitTarget: {
					bindingId: "different-binding",
					openMeldServiceRuntimeId: "different-runtime",
				},
			})
		);
		rendered.rerender(<SpaceComposer {...input} />);
		expect(
			(
				screen.getByRole("button", {
					name: "Send message",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
	});

	it("does not admit missing readiness evidence just because a computer is selected", () => {
		const input = props();
		input.content.addressingTargets = input.content.addressingTargets.map(
			(target) => ({
				...target,
				agentWakeAvailability: undefined,
			})
		);
		render(<SpaceComposer {...input} />);
		fireEvent.click(screen.getByRole("checkbox"));
		expect(
			(
				screen.getByRole("button", {
					name: "Send message",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
	});
	it.each([
		"conversation",
		"thread",
	] as const)("lets an existing offline Wake submit with explicit waiting in %s", (placement) => {
		const input = props();
		input.context.placement = placement;
		render(<SpaceComposer {...input} />);
		const send = screen.getByRole("button", {
			name: placement === "thread" ? "Send reply" : "Send message",
		}) as HTMLButtonElement;
		expect(send.disabled).toBe(true);
		const wait = screen.getByRole("checkbox");
		fireEvent.click(wait);
		expect(send.disabled).toBe(false);
		fireEvent.click(send);
		expect(input.actions.onSubmit).toHaveBeenCalledWith({
			deviceWait: expect.objectContaining({
				targetProfileId: profileId,
				bindingId: "binding-1",
				openMeldServiceRuntimeId: "runtime-1",
			}),
		});
		fireEvent.click(wait);
		expect(send.disabled).toBe(true);
	});
});
