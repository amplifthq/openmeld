import {
	createSpaceMemberAgentSnapshot,
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	SpaceComposerEditor,
	type SpaceComposerEditorHandle,
} from "./space-composer-editor";
import type { SpaceComposerAddressingTarget } from "./use-space-mention-authoring";
import { buildSpaceMentionTargetItems } from "./use-space-mention-authoring";

const AGENT_PROFILE_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HUMAN_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const FELIX_OPTION_NAME = /Felix/;
const RUNNER_OPTION_NAME = /Runner/;

describe("SpaceComposerEditor", () => {
	afterEach(cleanup);

	it("renders an Agent as an inline profile token with its relation beside the name", () => {
		render(
			<SpaceComposerEditor
				addressingTargets={[createAgentTarget()]}
				ariaLabel="Message this space"
				authoredMentions={[
					{
						end: 11,
						profileId: AGENT_PROFILE_ID,
						relation: "wake",
						start: 4,
						text: "@Runner",
					},
				]}
				mentionPickerItems={[]}
				onChange={vi.fn()}
				onSend={vi.fn()}
				placeholder="To wake an agent, type @, then pick the agent."
				text="Ask @Runner to review this."
			/>
		);

		const editor = screen.getByRole("textbox", {
			name: "Message this space",
		});
		expect(editor.getAttribute("contenteditable")).toBe("true");
		const token = within(editor).getByTestId("space-composer-profile-token");
		expect(within(token).getByText("Runner")).toBeTruthy();
		expect(
			within(editor).getByRole("combobox", {
				name: "Change relation for Runner",
			})
		).toBeTruthy();
	});

	it("keeps Human Mention inline without inventing a Wake or Reference selector", () => {
		render(
			<SpaceComposerEditor
				addressingTargets={[createHumanTarget()]}
				ariaLabel="Message Felix"
				authoredMentions={[
					{
						end: 6,
						profileId: HUMAN_PROFILE_ID,
						relation: "mention",
						start: 0,
						text: "@Felix",
					},
				]}
				mentionPickerItems={[]}
				onChange={vi.fn()}
				onSend={vi.fn()}
				placeholder="Message Felix…"
				text="@Felix take a look."
			/>
		);

		const editor = screen.getByRole("textbox", { name: "Message Felix" });
		const token = within(editor).getByTestId("space-composer-profile-token");
		expect(within(token).getByText("Felix")).toBeTruthy();
		expect(
			within(editor).queryByRole("combobox", {
				name: "Change relation for Felix",
			})
		).toBeNull();
	});

	it("persists an inline Agent relation change through the existing draft contract", async () => {
		const onChange = vi.fn();
		render(
			<SpaceComposerEditor
				addressingTargets={[createAgentTarget()]}
				ariaLabel="Message this space"
				authoredMentions={[
					{
						end: 7,
						profileId: AGENT_PROFILE_ID,
						relation: "wake",
						start: 0,
						text: "@Runner",
					},
				]}
				mentionPickerItems={[]}
				onChange={onChange}
				onSend={vi.fn()}
				placeholder="To wake an agent, type @, then pick the agent."
				text="@Runner review this."
			/>
		);

		fireEvent.change(
			screen.getByRole("combobox", {
				name: "Change relation for Runner",
			}),
			{ target: { value: "reference" } }
		);

		await waitFor(() => {
			expect(onChange).toHaveBeenLastCalledWith({
				authoredMentions: [
					{
						end: 7,
						profileId: AGENT_PROFILE_ID,
						relation: "reference",
						start: 0,
						text: "@Runner",
					},
				],
				selection: expect.any(Object),
				text: "@Runner review this.",
			});
		});
	});

	it("opens the member picker from the @ control and inserts an Agent Wake token", async () => {
		const composerRef = createRef<SpaceComposerEditorHandle>();
		const onChange = vi.fn();
		render(
			<SpaceComposerEditor
				addressingTargets={[]}
				ariaLabel="Message this space"
				authoredMentions={[]}
				composerRef={composerRef}
				mentionPickerItems={createMentionPickerItems()}
				onChange={onChange}
				onSend={vi.fn()}
				placeholder="To wake an agent, type @, then pick the agent."
				text="Before "
			/>
		);

		act(() => composerRef.current?.insertMentionTrigger());

		const search = await screen.findByRole("combobox", {
			name: "Find a member to mention",
		});
		expect(search).toBeTruthy();
		const runnerOption = await screen.findByRole("option", {
			name: RUNNER_OPTION_NAME,
		});
		fireEvent.mouseDown(runnerOption);
		fireEvent.click(runnerOption);

		await waitFor(() => {
			expect(screen.getByTestId("space-composer-profile-token")).toBeTruthy();
			expect(onChange).toHaveBeenLastCalledWith({
				authoredMentions: [
					{
						end: 14,
						profileId: AGENT_PROFILE_ID,
						relation: "wake",
						start: 7,
						text: "@Runner",
					},
				],
				selection: expect.any(Object),
				text: "Before @Runner ",
			});
		});
	});

	it("inserts a Human Mention token without an Agent relation control", async () => {
		const composerRef = createRef<SpaceComposerEditorHandle>();
		const onChange = vi.fn();
		render(
			<SpaceComposerEditor
				addressingTargets={[]}
				ariaLabel="Message this space"
				authoredMentions={[]}
				composerRef={composerRef}
				mentionPickerItems={createMentionPickerItems()}
				onChange={onChange}
				onSend={vi.fn()}
				placeholder="To wake an agent, type @, then pick the agent."
				text=""
			/>
		);

		act(() => composerRef.current?.insertMentionTrigger());
		const felixOption = await screen.findByRole("option", {
			name: FELIX_OPTION_NAME,
		});
		fireEvent.mouseDown(felixOption);
		fireEvent.click(felixOption);

		await waitFor(() => {
			const token = screen.getByTestId("space-composer-profile-token");
			expect(within(token).getByText("Felix")).toBeTruthy();
			expect(
				within(token).queryByRole("combobox", {
					name: "Change relation for Felix",
				})
			).toBeNull();
			expect(onChange).toHaveBeenLastCalledWith({
				authoredMentions: [
					{
						end: 6,
						profileId: HUMAN_PROFILE_ID,
						relation: "mention",
						start: 0,
						text: "@Felix",
					},
				],
				selection: expect.any(Object),
				text: "@Felix ",
			});
		});
	});

	it("keeps a duplicate Agent appearance as plain text and only one Wake token", async () => {
		const composerRef = createRef<
			HTMLTextAreaElement | SpaceComposerEditorHandle
		>();
		const onChange = vi.fn();
		render(
			<SpaceComposerEditor
				addressingTargets={[createAgentTarget()]}
				ariaLabel="Message this space"
				authoredMentions={[
					{
						end: 7,
						profileId: AGENT_PROFILE_ID,
						relation: "wake",
						start: 0,
						text: "@Runner",
					},
				]}
				composerRef={composerRef}
				mentionPickerItems={createMentionPickerItems()}
				onChange={onChange}
				onSend={vi.fn()}
				placeholder="To wake an agent, type @, then pick the agent."
				text="@Runner first. "
			/>
		);

		act(() =>
			getComposerEditorHandle(composerRef).selectTextRange({
				end: 15,
				start: 15,
			})
		);
		act(() => getComposerEditorHandle(composerRef).insertMentionTrigger());
		const duplicateRunnerOption = await screen.findByRole("option", {
			name: RUNNER_OPTION_NAME,
		});
		fireEvent.mouseDown(duplicateRunnerOption);
		fireEvent.click(duplicateRunnerOption);

		await waitFor(() => {
			expect(
				screen.getAllByTestId("space-composer-profile-token")
			).toHaveLength(1);
			expect(onChange).toHaveBeenLastCalledWith({
				authoredMentions: [
					{
						end: 7,
						profileId: AGENT_PROFILE_ID,
						relation: "wake",
						start: 0,
						text: "@Runner",
					},
				],
				selection: expect.any(Object),
				text: "@Runner first. @Runner ",
			});
		});
	});

	it("copies an inline profile as ordinary public @Name text", () => {
		const composerRef = createRef<
			HTMLTextAreaElement | SpaceComposerEditorHandle
		>();
		render(
			<SpaceComposerEditor
				addressingTargets={[createAgentTarget()]}
				ariaLabel="Message this space"
				authoredMentions={[
					{
						end: 11,
						profileId: AGENT_PROFILE_ID,
						relation: "wake",
						start: 4,
						text: "@Runner",
					},
				]}
				composerRef={composerRef}
				mentionPickerItems={createMentionPickerItems()}
				onChange={vi.fn()}
				onSend={vi.fn()}
				placeholder="To wake an agent, type @, then pick the agent."
				text="Ask @Runner now."
			/>
		);
		const editor = screen.getByRole("textbox", {
			name: "Message this space",
		});
		const setData = vi.fn();

		act(() => {
			getComposerEditorHandle(composerRef).selectTextRange({
				end: 16,
				start: 0,
			});
		});
		fireEvent.copy(editor, {
			clipboardData: {
				files: [],
				getData: vi.fn(),
				setData,
			},
		});

		expect(setData).toHaveBeenCalledWith("text/plain", "Ask @Runner now.");
	});

	it("keeps Shift+Enter in the draft and sends with Enter", () => {
		const composerRef = createRef<
			HTMLTextAreaElement | SpaceComposerEditorHandle
		>();
		const onSend = vi.fn();
		render(
			<SpaceComposerEditor
				addressingTargets={[]}
				ariaLabel="Message this space"
				authoredMentions={[]}
				composerRef={composerRef}
				mentionPickerItems={[]}
				onChange={vi.fn()}
				onSend={onSend}
				placeholder="To wake an agent, type @, then pick the agent."
				text="Hello"
			/>
		);
		const editor = screen.getByRole("textbox", {
			name: "Message this space",
		});

		act(() => {
			getComposerEditorHandle(composerRef).selectTextRange({
				end: 5,
				start: 5,
			});
		});
		const shiftEnterAccepted = fireEvent.keyDown(editor, {
			key: "Enter",
			shiftKey: true,
		});

		expect(shiftEnterAccepted).toBe(false);
		expect(onSend).not.toHaveBeenCalled();

		fireEvent.keyDown(editor, { key: "Enter" });
		expect(onSend).toHaveBeenCalledOnce();
	});

	it("clears stale tokens when the existing draft is cleared after send", async () => {
		const composerRef = createRef<
			HTMLTextAreaElement | SpaceComposerEditorHandle
		>();
		const props = {
			addressingTargets: [createAgentTarget()],
			ariaLabel: "Message this space",
			composerRef,
			mentionPickerItems: createMentionPickerItems(),
			onChange: vi.fn(),
			onSend: vi.fn(),
			placeholder: "To wake an agent, type @, then pick the agent.",
		};
		const view = render(
			<SpaceComposerEditor
				{...props}
				authoredMentions={[
					{
						end: 7,
						profileId: AGENT_PROFILE_ID,
						relation: "wake",
						start: 0,
						text: "@Runner",
					},
				]}
				text="@Runner review this."
			/>
		);

		expect(screen.getByTestId("space-composer-profile-token")).toBeTruthy();
		view.rerender(
			<SpaceComposerEditor {...props} authoredMentions={[]} text="" />
		);

		await waitFor(() => {
			expect(screen.queryByTestId("space-composer-profile-token")).toBeNull();
			expect(
				screen.getByText("To wake an agent, type @, then pick the agent.")
			).toBeTruthy();
		});

		act(() => getComposerEditorHandle(composerRef).insertMentionTrigger());
		const optionAfterClear = await screen.findByRole("option", {
			name: RUNNER_OPTION_NAME,
		});
		fireEvent.mouseDown(optionAfterClear);
		fireEvent.click(optionAfterClear);

		await waitFor(() => {
			expect(screen.getByTestId("space-composer-profile-token")).toBeTruthy();
		});
	});

	it("accepts plain browser text input through the contenteditable surface", async () => {
		const onChange = vi.fn();
		render(
			<SpaceComposerEditor
				addressingTargets={[]}
				ariaLabel="Message this space"
				authoredMentions={[]}
				mentionPickerItems={[]}
				onChange={onChange}
				onSend={vi.fn()}
				placeholder="To wake an agent, type @, then pick the agent."
				text=""
			/>
		);
		const editor = screen.getByRole("textbox", {
			name: "Message this space",
		});
		const range = document.createRange();
		range.selectNodeContents(editor);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		document.dispatchEvent(new Event("selectionchange"));
		fireEvent.paste(editor, {
			clipboardData: {
				files: [],
				getData: () => "Hello from the browser",
			},
		});

		await waitFor(() => {
			expect(onChange).toHaveBeenLastCalledWith({
				authoredMentions: [],
				selection: expect.any(Object),
				text: "Hello from the browser",
			});
		});
	});
});

function createAgentTarget(): SpaceComposerAddressingTarget {
	return {
		allowedRelations: { mention: false, reference: true, wake: true },
		profileId: AGENT_PROFILE_ID,
		profileName: "Runner",
		relation: "wake",
		wakeAvailability: {
			reasonCodes: [],
			reasonText: null,
			status: "ready",
		},
	};
}

function createHumanTarget(): SpaceComposerAddressingTarget {
	return {
		allowedRelations: { mention: true, reference: false, wake: false },
		profileId: HUMAN_PROFILE_ID,
		profileName: "Felix",
		relation: "mention",
		wakeAvailability: {
			reasonCodes: [],
			reasonText: null,
			status: "unsupported",
		},
	};
}

function createMentionPickerItems() {
	return buildSpaceMentionTargetItems({
		query: "",
		snapshot: createSpaceMembersSnapshot({
			agents: [
				createSpaceMemberAgentSnapshot({
					profileId: AGENT_PROFILE_ID,
					profileName: "Runner",
				}),
			],
			humans: [
				createSpaceMemberHumanSnapshot({
					profileId: HUMAN_PROFILE_ID,
					profileName: "Felix",
				}),
			],
		}),
	});
}

function getComposerEditorHandle(input: {
	current: HTMLTextAreaElement | SpaceComposerEditorHandle | null;
}): SpaceComposerEditorHandle {
	const current = input.current;
	if (!(current && "insertMentionTrigger" in current)) {
		throw new Error("Expected the structured Composer editor handle.");
	}
	return current;
}
