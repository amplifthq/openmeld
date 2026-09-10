import {
	createSpaceMemberAgentSnapshot,
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import "fake-indexeddb/auto";
import { createPlateEditor } from "platejs/react";
import { createRef, StrictMode, useLayoutEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import {
	SpaceComposerEditor,
	type SpaceComposerEditorHandle,
	SpaceComposerEditorKit,
} from "./space-composer-editor";
import { getEditorFocusReadiness } from "./space-composer-focus";
import { SpaceInlineMessageEditor } from "./space-inline-message-editor";
import {
	SpaceMessageEditingScope,
	useSpaceMessageEditing,
} from "./space-message-editing";
import type { SpaceComposerAddressingTarget } from "./use-space-mention-authoring";
import {
	buildSpaceComposerAddressingTargets,
	buildSpaceMentionTargetItems,
} from "./use-space-mention-authoring";

const AGENT_PROFILE_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HUMAN_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const FELIX_OPTION_NAME = /Felix/;
const RUNNER_OPTION_NAME = /Runner/;
const ALL_OPTION_NAME = /@all/;
const BOTH_OPTION_NAME = /Both/;

const INLINE_MESSAGE = {
	id: "inline-message",
	spaceId: "space-1",
	text: "Keep this existing message",
	wakeTargetProfileIds: [],
	attachments: [],
} as unknown as SpaceTimelineItem;
function InlineRecommendationHarness() {
	const editing = useSpaceMessageEditing();
	return editing?.edit ? (
		<SpaceInlineMessageEditor
			bodySize={{ width: 500, height: 30 }}
			item={INLINE_MESSAGE}
		/>
	) : (
		<button
			onClick={() => editing?.beginEdit(INLINE_MESSAGE, AGENT_PROFILE_ID)}
			type="button"
		>
			Wake Runner?
		</button>
	);
}

describe("SpaceComposerEditor", () => {
	afterEach(cleanup);

	it("opens a recommended inline edit once under repeated mount effects", async () => {
		render(
			<StrictMode>
				<QueryClientProvider client={new QueryClient()}>
					<SpaceMessageEditingScope
						draftKey=""
						hasDraft={false}
						mentionPickerItems={createMentionPickerItems()}
						onRestore={() => Promise.resolve()}
						orgSlug="test"
						selfProfileId={HUMAN_PROFILE_ID}
					>
						<InlineRecommendationHarness />
					</SpaceMessageEditingScope>
				</QueryClientProvider>
			</StrictMode>
		);
		fireEvent.click(screen.getByRole("button", { name: "Wake Runner?" }));
		expect(
			await screen.findByRole("combobox", { name: "Find a member to mention" })
		).toBeTruthy();
		fireEvent.click(
			await screen.findByRole("option", { name: RUNNER_OPTION_NAME })
		);
		expect(
			await screen.findByRole("button", { name: "Save & wake" })
		).toBeTruthy();
		expect(screen.getAllByTestId("space-composer-profile-token")).toHaveLength(
			1
		);
		expect(
			screen.getByRole("textbox", { name: "Edit message" }).textContent
		).toContain(INLINE_MESSAGE.text);
	});

	it("opens the shared mention picker at the start of an existing message", async () => {
		const composerRef = createRef<SpaceComposerEditorHandle>();
		const onChange = vi.fn();
		render(
			<SpaceComposerEditor
				addressingTargets={[]}
				ariaLabel="Edit message"
				authoredMentions={[]}
				composerRef={composerRef}
				inline
				mentionPickerItems={createMentionPickerItems()}
				onChange={onChange}
				onSend={vi.fn()}
				placeholder="Message"
				text="Keep this existing message"
			/>
		);
		await act(() => {
			composerRef.current?.selectTextRange({ start: 0, end: 0 });
		});
		await act(() => {
			composerRef.current?.insertMentionTrigger();
		});
		expect(
			await screen.findByRole("combobox", { name: "Find a member to mention" })
		).toBeTruthy();
		fireEvent.click(
			await screen.findByRole("option", { name: RUNNER_OPTION_NAME })
		);
		await waitFor(() =>
			expect(onChange.mock.lastCall?.[0].text).toContain(
				"Keep this existing message"
			)
		);
		await waitFor(() =>
			expect(onChange.mock.lastCall?.[0].authoredMentions[0]).toMatchObject({
				profileId: AGENT_PROFILE_ID,
				relation: "wake",
				start: 0,
			})
		);
	});

	it("accepts a Wake suggestion as an ordinary token without sending", async () => {
		const composerRef = createRef<SpaceComposerEditorHandle>();
		const onChange = vi.fn();
		const onSend = vi.fn();
		render(
			<SpaceComposerEditor
				addressingTargets={[]}
				ariaLabel="Message"
				authoredMentions={[]}
				composerRef={composerRef}
				mentionPickerItems={createMentionPickerItems()}
				onChange={onChange}
				onSend={onSend}
				placeholder="Message"
				text="Continue with the first option"
			/>
		);
		act(() =>
			composerRef.current?.acceptWakeRecommendation?.(AGENT_PROFILE_ID)
		);
		await waitFor(() =>
			expect(onChange.mock.lastCall?.[0].authoredMentions).toEqual([
				expect.objectContaining({
					profileId: AGENT_PROFILE_ID,
					relation: "wake",
					start: 0,
				}),
			])
		);
		expect(onChange.mock.lastCall?.[0].text).toContain(
			"Continue with the first option"
		);
		expect(onSend).not.toHaveBeenCalled();
	});

	it("keeps @all open for an audience choice and inserts ordinary People and Agent tokens", async () => {
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
				placeholder="Message"
				text=""
			/>
		);
		act(() => composerRef.current?.insertMentionTrigger());
		const search = await screen.findByRole("combobox", {
			name: "Find a member to mention",
		});
		fireEvent.change(search, { target: { value: "all" } });
		fireEvent.click(
			await screen.findByRole("option", { name: ALL_OPTION_NAME })
		);
		expect(
			screen.getByRole("combobox", { name: "Find a member to mention" })
		).toBeTruthy();
		fireEvent.click(
			await screen.findByRole("option", { name: BOTH_OPTION_NAME })
		);
		await waitFor(() => {
			const mentions = onChange.mock.lastCall?.[0].authoredMentions;
			expect(mentions).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						profileId: HUMAN_PROFILE_ID,
						relation: "mention",
					}),
					expect.objectContaining({
						profileId: AGENT_PROFILE_ID,
						relation: "wake",
					}),
				])
			);
		});
	});

	it.each([
		"",
		"Hello ",
		"请帮忙",
		"確認して",
		"확인",
		"Hello:",
		"（",
	])("opens mentions immediately after %j without requiring a space", (prefix) => {
		const editor = createPlateEditor({
			plugins: SpaceComposerEditorKit,
			value: [{ type: "p", children: [{ text: prefix }] }],
		});
		editor.tf.select({ path: [0, 0], offset: prefix.length });
		editor.tf.insertText("@");
		expect(
			editor.children[0].children.some(
				(node) => "type" in node && node.type === "mention_input"
			)
		).toBe(true);
	});

	it("keeps an email address as ordinary text", () => {
		const editor = createPlateEditor({
			plugins: SpaceComposerEditorKit,
			value: [{ type: "p", children: [{ text: "felix" }] }],
		});
		editor.tf.select({ path: [0, 0], offset: 5 });
		editor.tf.insertText("@");
		editor.tf.insertText("example.com");
		expect(editor.api.string([0])).toBe("felix@example.com");
		expect(
			editor.children[0].children.some(
				(node) => "type" in node && node.type === "mention_input"
			)
		).toBe(false);
	});

	it.each([
		"button",
		"escape",
	])("preserves a literal @ and search text when dismissed with %s", async (method) => {
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
				placeholder="Message"
				text=""
			/>
		);
		act(() => composerRef.current?.insertMentionTrigger());
		const input = await screen.findByRole("combobox", {
			name: "Find a member to mention",
		});
		fireEvent.change(input, { target: { value: "just text" } });
		if (method === "button") {
			fireEvent.click(screen.getByRole("button", { name: "Close mentions" }));
		} else {
			fireEvent.keyDown(input, { key: "Escape", keyCode: 27, which: 27 });
		}
		await waitFor(() => {
			expect(
				screen.queryByRole("combobox", { name: "Find a member to mention" })
			).toBeNull();
			expect(onChange).toHaveBeenLastCalledWith(
				expect.objectContaining({ text: "@just text", authoredMentions: [] })
			);
		});
	});

	it("renders a restored mention with parentheses in its display name without parsing the name as a literal", () => {
		const profileName = "Felix Lu Codex GPT-5.6 Sol (1)";
		const mentionText = `@${AGENT_PROFILE_ID}`;
		const authoredMentions = [
			{
				start: 0,
				end: mentionText.length,
				text: mentionText,
				profileId: AGENT_PROFILE_ID,
				relation: "wake" as const,
			},
		];
		const snapshot = createSpaceMembersSnapshot({
			agents: [
				createSpaceMemberAgentSnapshot({
					profileId: AGENT_PROFILE_ID,
					profileName,
				}),
			],
		});
		render(
			<SpaceComposerEditor
				addressingTargets={buildSpaceComposerAddressingTargets({
					mentions: authoredMentions,
					snapshot,
				})}
				ariaLabel="Message this space"
				authoredMentions={authoredMentions}
				mentionPickerItems={buildSpaceMentionTargetItems({
					query: "",
					snapshot,
				})}
				onChange={vi.fn()}
				onSend={vi.fn()}
				placeholder="Message"
				text={`${mentionText} Reply with the test marker.`}
			/>
		);
		const token = screen.getByTestId("space-composer-profile-token");
		expect(within(token).getByText(profileName)).toBeTruthy();
		expect(
			screen.getByRole("combobox", {
				name: `Change relation for ${profileName}`,
			}).textContent
		).toBe("Wake");
		expect(token.textContent).not.toContain(AGENT_PROFILE_ID);
	});

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
		const relation = within(editor).getByRole("combobox", {
			name: "Change relation for Runner",
		});
		expect(relation).toBeTruthy();
		expect(relation.tagName).toBe("BUTTON");
		expect(relation.textContent).toBe("Wake");
		const visibleParts = Array.from(token.children).map((element) =>
			element.getAttribute("data-slot")
		);
		expect(visibleParts.slice(0, 3)).toEqual([
			"space-composer-profile-token-at",
			"space-composer-profile-token-icon",
			"space-composer-profile-token-name",
		]);
		expect(within(token).getByText("Runner").className).not.toContain(
			"max-w-40"
		);
	});

	it("removes an inline profile token from its hover and focus control", async () => {
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

		const removeButton = screen.getByRole("button", {
			name: "Remove Runner from message",
		});
		expect(removeButton.className).toContain("absolute");
		expect(removeButton.className).toContain("opacity-0");
		expect(removeButton.className).toContain(
			"group-hover/profile-token:opacity-100"
		);
		expect(removeButton.className).toContain("focus-visible:opacity-100");

		fireEvent.click(removeButton);

		await waitFor(() => {
			expect(screen.queryByTestId("space-composer-profile-token")).toBeNull();
			expect(onChange).toHaveBeenLastCalledWith(
				expect.objectContaining({
					authoredMentions: [],
					text: "review this.",
				})
			);
		});
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
		const onSend = vi.fn();
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
				onSend={onSend}
				placeholder="To wake an agent, type @, then pick the agent."
				text="@Runner review this."
			/>
		);

		fireEvent.click(
			screen.getByRole("combobox", {
				name: "Change relation for Runner",
			})
		);
		fireEvent.keyDown(screen.getByRole("option", { name: "Reference" }), {
			key: "Enter",
		});
		expect(onSend).not.toHaveBeenCalled();

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

	it("keeps Reference selectable while disabling Wake for a blocked Agent", () => {
		render(
			<SpaceComposerEditor
				addressingTargets={[createBlockedAgentTarget()]}
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
				onChange={vi.fn()}
				onSend={vi.fn()}
				placeholder="To wake an agent, type @, then pick the agent."
				text="@Runner review this."
			/>
		);

		const relation = screen.getByRole("combobox", {
			name: "Change relation for Runner",
		});
		fireEvent.click(relation);
		expect(
			screen
				.getByRole("option", { name: "Wake — Unavailable" })
				.getAttribute("aria-disabled")
		).toBe("true");
		expect(
			screen
				.getByRole("option", { name: "Reference" })
				.getAttribute("aria-disabled")
		).not.toBe("true");
		expect(
			screen
				.getByRole("textbox", { name: "Message this space" })
				.getAttribute("contenteditable")
		).toBe("true");
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
				mentionPickerItems={createMentionPickerItems("Runner (QA) (wake)")}
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
		expect(
			runnerOption.querySelector(
				'[data-slot="space-agent-availability-indicator-dot"]'
			)
		).not.toBeNull();
		const memberOptions = screen.getByRole("listbox", {
			name: "Member options",
		});
		const sharedLayoutGroup = memberOptions.querySelector(
			'[data-slot="shared-layout-group"]'
		);
		const sharedLayoutItem = runnerOption.closest(
			'[data-slot="shared-layout-item"]'
		);
		expect(sharedLayoutGroup?.className).toContain("p-1.5");
		expect(sharedLayoutItem?.parentElement?.className).toContain("gap-1");
		expect(
			sharedLayoutGroup?.querySelectorAll(
				'[data-slot="shared-layout-background"]'
			)
		).toHaveLength(1);
		expect(runnerOption.className).not.toContain("hover:bg-accent");
		expect(runnerOption.className).not.toContain(
			"data-[active-item=true]:bg-accent"
		);
		fireEvent.mouseDown(runnerOption);
		fireEvent.click(runnerOption);

		await waitFor(() => {
			expect(screen.getByTestId("space-composer-profile-token")).toBeTruthy();
			expect(onChange).toHaveBeenLastCalledWith({
				authoredMentions: [
					{
						end: 26,
						profileId: AGENT_PROFILE_ID,
						relation: "wake",
						start: 7,
						text: "@Runner (QA) (wake)",
					},
				],
				selection: expect.any(Object),
				text: "Before @Runner (QA) (wake) ",
			});
		});
	});

	it("uses the Center Agent identity in the member picker", async () => {
		const composerRef = createRef<SpaceComposerEditorHandle>();
		render(
			<SpaceComposerEditor
				addressingTargets={[]}
				ariaLabel="Message this space"
				authoredMentions={[]}
				centerAgentProfileId={AGENT_PROFILE_ID}
				composerRef={composerRef}
				mentionPickerItems={createMentionPickerItems()}
				onChange={vi.fn()}
				onSend={vi.fn()}
				placeholder="To wake an agent, type @, then pick the agent."
				text=""
			/>
		);

		act(() => composerRef.current?.insertMentionTrigger());

		const runnerOption = await screen.findByRole("option", {
			name: RUNNER_OPTION_NAME,
		});
		const avatar = within(runnerOption).getByTestId(
			`space-profile-icon-${AGENT_PROFILE_ID}`
		);
		expect(avatar.getAttribute("data-slot")).toBe("fluid-avatar");
		expect(avatar.getAttribute("data-shape")).toBe("circle");
		expect(
			within(runnerOption).queryByTestId("local-agent-logo-codex")
		).toBeNull();
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

	it("inserts a duplicate Agent appearance as an inline Reference token", async () => {
		const composerRef = createRef<SpaceComposerEditorHandle>();
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
			const tokens = screen.getAllByTestId("space-composer-profile-token");
			expect(tokens).toHaveLength(2);
			expect(
				within(tokens[1] as HTMLElement).getByText("Reference")
			).toBeTruthy();
			expect(onChange).toHaveBeenLastCalledWith({
				authoredMentions: [
					{
						end: 7,
						profileId: AGENT_PROFILE_ID,
						relation: "wake",
						start: 0,
						text: "@Runner",
					},
					{
						end: 22,
						profileId: AGENT_PROFILE_ID,
						relation: "reference",
						start: 15,
						text: "@Runner",
					},
				],
				selection: expect.any(Object),
				text: "@Runner first. @Runner ",
			});
		});
	});

	it("keeps pasted member names as literal text without selecting recipients", async () => {
		const onChange = vi.fn();
		render(
			<SpaceComposerEditor
				addressingTargets={[createAgentTarget(), createHumanTarget()]}
				ariaLabel="Message this space"
				authoredMentions={[]}
				mentionPickerItems={createMentionPickerItems()}
				onChange={onChange}
				onSend={vi.fn()}
				placeholder="To wake an agent, type @, then pick the agent."
				text=""
			/>
		);
		const editor = screen.getByRole("textbox", {
			name: "Message this space",
		});

		fireEvent.paste(editor, {
			clipboardData: {
				files: [],
				getData: (type: string) =>
					type === "text/plain" ? "Ask @Runner and tell @Felix. @Runner" : "",
			},
		});

		await waitFor(() => {
			expect(
				screen.queryAllByTestId("space-composer-profile-token")
			).toHaveLength(0);
			expect(onChange).toHaveBeenLastCalledWith({
				authoredMentions: [],
				selection: expect.any(Object),
				text: "Ask @Runner and tell @Felix. @Runner",
			});
		});
	});

	it("copies an inline profile as ordinary public @Name text", () => {
		const composerRef = createRef<SpaceComposerEditorHandle>();
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
		const structuredCopy = setData.mock.calls.find(
			([type]) => type !== "text/plain"
		);
		expect(structuredCopy).toBeTruthy();
		expect(JSON.parse(String(structuredCopy?.[1]))).toEqual({
			authoredMentions: [
				{
					end: 11,
					profileId: AGENT_PROFILE_ID,
					relation: "wake",
					start: 4,
					text: "@Runner",
				},
			],
			text: "Ask @Runner now.",
			version: 1,
		});
	});

	it("preserves an internal Reference when its inline token is pasted", async () => {
		const onChange = vi.fn();
		render(
			<SpaceComposerEditor
				addressingTargets={[createAgentTarget()]}
				ariaLabel="Message this space"
				authoredMentions={[]}
				mentionPickerItems={createMentionPickerItems()}
				onChange={onChange}
				onSend={vi.fn()}
				placeholder="To wake an agent, type @, then pick the agent."
				text=""
			/>
		);
		const editor = screen.getByRole("textbox", {
			name: "Message this space",
		});
		const clipboardPayload = JSON.stringify({
			authoredMentions: [
				{
					end: 7,
					profileId: AGENT_PROFILE_ID,
					relation: "reference",
					start: 0,
					text: "@Runner",
				},
			],
			text: "@Runner",
			version: 1,
		});

		fireEvent.paste(editor, {
			clipboardData: {
				files: [],
				getData: (type: string) => {
					if (type === "text/plain") {
						return "@Runner";
					}
					return type === "application/x-openmeld-space-composer+json"
						? clipboardPayload
						: "";
				},
			},
		});

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
				text: "@Runner",
			});
		});
	});

	it("drops recipient identity when plain pasted text replaces a selected token", async () => {
		const composerRef = createRef<SpaceComposerEditorHandle>();
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
				text="@Runner"
			/>
		);
		const editor = screen.getByRole("textbox", {
			name: "Message this space",
		});
		act(() => {
			getComposerEditorHandle(composerRef).selectTextRange({
				end: 7,
				start: 0,
			});
		});

		fireEvent.paste(editor, {
			clipboardData: {
				files: [],
				getData: (type: string) => (type === "text/plain" ? "@Runner" : ""),
			},
		});

		await waitFor(() => {
			expect(onChange).toHaveBeenLastCalledWith({
				authoredMentions: [],
				selection: expect.any(Object),
				text: "@Runner",
			});
		});
	});

	it("keeps Shift+Enter in the draft and sends with Enter", () => {
		const composerRef = createRef<SpaceComposerEditorHandle>();
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
		const composerRef = createRef<SpaceComposerEditorHandle>();
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

	it("focuses a restored external draft after its Slate nodes reach the DOM", async () => {
		const view = render(<RestoredDraftHarness text="" />);

		view.rerender(<RestoredDraftHarness text="Restored draft" />);

		await waitFor(() => {
			expect(document.activeElement).toBe(
				screen.getByRole("textbox", { name: "Message this space" })
			);
		});
	});

	it("bounds focus retries when Slate operations are empty but the DOM range is invalid", () => {
		const selection = {
			anchor: { offset: 14, path: [0, 0] },
			focus: { offset: 14, path: [0, 0] },
		};
		const toDOMRange = vi.fn(() => {
			throw new Error(
				'Cannot resolve a DOM node from Slate node: {"text":"Restored draft"}'
			);
		});

		expect(
			getEditorFocusReadiness(
				{
					api: { toDOMRange } as never,
					operations: [],
					selection,
				},
				1
			)
		).toBe("retry");
		expect(
			getEditorFocusReadiness(
				{
					api: { toDOMRange } as never,
					operations: [],
					selection,
				},
				0
			)
		).toBe("cancel");
		expect(toDOMRange).toHaveBeenCalledTimes(2);
		expect(toDOMRange).toHaveBeenLastCalledWith(selection);
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
				getData: (type: string) =>
					type === "text/plain" ? "Hello from the browser" : "",
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

function RestoredDraftHarness(input: { text: string }) {
	const composerRef = useRef<SpaceComposerEditorHandle>(null);
	useLayoutEffect(() => {
		if (input.text) {
			composerRef.current?.selectTextRange({
				end: input.text.length,
				start: input.text.length,
			});
		}
	}, [input.text]);

	return (
		<SpaceComposerEditor
			addressingTargets={[]}
			ariaLabel="Message this space"
			authoredMentions={[]}
			composerRef={composerRef}
			mentionPickerItems={[]}
			onChange={vi.fn()}
			onSend={vi.fn()}
			placeholder="To wake an agent, type @, then pick the agent."
			text={input.text}
		/>
	);
}

function createAgentTarget(): SpaceComposerAddressingTarget {
	return {
		allowedRelations: { mention: false, reference: true, wake: true },
		primaryMentionLabel: "Runner",
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

function createBlockedAgentTarget(): SpaceComposerAddressingTarget {
	return {
		...createAgentTarget(),
		wakeAvailability: {
			reasonCodes: ["service.not_running"],
			reasonText: "Connect your computer before Runner can reply.",
			status: "blocked",
		},
	};
}

function createHumanTarget(): SpaceComposerAddressingTarget {
	return {
		allowedRelations: { mention: true, reference: false, wake: false },
		primaryMentionLabel: "Felix",
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

function createMentionPickerItems(profileName = "Runner") {
	return buildSpaceMentionTargetItems({
		query: "",
		snapshot: createSpaceMembersSnapshot({
			agents: [
				createSpaceMemberAgentSnapshot({
					agentControllerRef: "builtin:codex",
					profileId: AGENT_PROFILE_ID,
					profileName,
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
	current: SpaceComposerEditorHandle | null;
}): SpaceComposerEditorHandle {
	const current = input.current;
	if (!current) {
		throw new Error("Expected the structured Composer editor handle.");
	}
	return current;
}
