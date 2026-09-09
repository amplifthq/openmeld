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
const WAIT_DURATION_HINT = /wait up to 24 hours/u;
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
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("does not silently choose between offline Agents or unblock another Wake", () => {
		const input = props();
		const selected = input.content.addressingTargets[0];
		if (!selected) {
			throw new Error("Missing test target");
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
		expect(screen.queryByRole("button", { name: "Send and wait" })).toBeNull();
		expect(
			(
				screen.getByRole("button", {
					name: "Send message",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		expect(
			screen.getByText(
				"To wait for a computer, send to one offline Agent at a time."
			)
		).toBeTruthy();
	});

	it("pins the current binding and starts the 24 hours only when clicked", () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1_900_000_000_000);
		const input = props();
		const rendered = render(<SpaceComposer {...input} />);
		now.mockReturnValue(1_900_010_000_000);
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
		fireEvent.click(screen.getByRole("button", { name: "Send and wait" }));
		expect(input.actions.onSubmit).toHaveBeenCalledExactlyOnceWith({
			deviceWait: {
				targetProfileId: profileId,
				bindingId: "different-binding",
				openMeldServiceRuntimeId: "different-runtime",
				deadlineAtMs: 1_900_010_000_000 + 24 * 60 * 60_000,
			},
		});
	});

	it("does not offer waiting without current readiness evidence", () => {
		const input = props();
		input.content.addressingTargets = input.content.addressingTargets.map(
			(target) => ({ ...target, agentWakeAvailability: undefined })
		);
		render(<SpaceComposer {...input} />);
		expect(screen.queryByRole("button", { name: "Send and wait" })).toBeNull();
		expect(
			(
				screen.getByRole("button", {
					name: "Send message",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
	});

	it("leaves a Reference as a Reference on ordinary send", () => {
		const input = props();
		input.content.addressingTargets = input.content.addressingTargets.map(
			(target) => ({ ...target, relation: "reference" })
		);
		render(<SpaceComposer {...input} />);
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		expect(input.actions.onSubmit).toHaveBeenCalledExactlyOnceWith();
	});

	it("shows no wait settings when the target is online", () => {
		const input = props();
		input.content.addressingTargets = buildSpaceComposerAddressingTargets({
			mentions: [{ profileId, relation: "wake" }],
			snapshot: createSpaceMembersSnapshot({
				agents: [
					{
						...createSpaceMemberAgentSnapshot({
							profileId,
							agentWakeAvailability: { status: "available_for_wake" },
						}),
						deviceWaitTarget: {
							bindingId: "binding-1",
							openMeldServiceRuntimeId: "runtime-1",
						},
					},
				],
			}),
		});
		render(<SpaceComposer {...input} />);
		expect(screen.queryByRole("button", { name: "Send and wait" })).toBeNull();
		expect(screen.queryByRole("checkbox")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		expect(input.actions.onSubmit).toHaveBeenCalledExactlyOnceWith();
	});

	it.each([
		"conversation",
		"thread",
	] as const)("submits one explicitly waiting Wake from %s without configuration", (placement) => {
		const input = props();
		input.context.placement = placement;
		render(<SpaceComposer {...input} />);
		expect(screen.queryByRole("checkbox")).toBeNull();
		expect(screen.queryByRole("combobox")).toBeNull();
		expect(screen.queryByLabelText("Start by")).toBeNull();
		expect(screen.getByText(WAIT_DURATION_HINT)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Send and wait" }));
		expect(input.actions.onSubmit).toHaveBeenCalledExactlyOnceWith({
			deviceWait: expect.objectContaining({
				targetProfileId: profileId,
				bindingId: "binding-1",
				openMeldServiceRuntimeId: "runtime-1",
			}),
		});
	});

	it("keeps waiting disabled while attachments upload or another Wake is blocked", () => {
		const input = props();
		input.availability.sendBlocked = true;
		const view = render(<SpaceComposer {...input} />);
		expect(
			(
				screen.getByRole("button", {
					name: "Send and wait",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		input.availability.sendBlocked = false;
		const selected = input.content.addressingTargets[0];
		if (!selected) {
			throw new Error("Missing test target");
		}
		input.content.addressingTargets = [
			...input.content.addressingTargets,
			{
				...selected,
				profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
				deviceWaitTarget: undefined,
				agentWakeAvailability: undefined,
			},
		];
		view.rerender(<SpaceComposer {...input} />);
		expect(
			(
				screen.getByRole("button", {
					name: "Send and wait",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
	});
});
