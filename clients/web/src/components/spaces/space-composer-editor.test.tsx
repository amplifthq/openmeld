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
import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createPlateEditor } from "platejs/react";
import { createRef, useLayoutEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	resolveAgentRequestRelationLabel,
	SpaceComposerEditor,
	type SpaceComposerEditorHandle,
	SpaceComposerEditorKit,
} from "./space-composer-editor";
import { getEditorFocusReadiness } from "./space-composer-focus";
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
const CODEX_REQUEST_OPTION_NAME = /Asks Felix/;
const MENTION_ONLY_OPTION_NAME = /^Mention only\s*— Won’t wake the agent$/;

describe("SpaceComposerEditor", () => {
	afterEach(() => {
		cleanup();
		localStorage.removeItem("openmeld.space.message-send-shortcut");
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

	it("offers a colleague's Agent outside the Space under its owner and inserts its name as text", async () => {
		const composerRef = createRef<SpaceComposerEditorHandle>();
		const onChange = vi.fn();
		const onSelect = vi.fn();
		const codex = {
			agentControllerRef: null,
			availability: null,
			avatarUrl: null,
			mentionName: "Felix's Codex",
			ownerName: "Felix",
			ownerUserId: "felix",
			profileHandle: null,
			profileId: "agt_codex",
			profileName: "Codex",
		};
		render(
			<SpaceComposerEditor
				addressingTargets={[]}
				agentRequestMentions={{ items: [codex], onSelect }}
				ariaLabel="Message"
				authoredMentions={[]}
				composerRef={composerRef}
				mentionPickerItems={createMentionPickerItems()}
				onChange={onChange}
				onSend={vi.fn()}
				placeholder="Message"
				text=""
			/>
		);
		await act(() => {
			composerRef.current?.insertMentionTrigger();
		});
		expect(
			await screen.findByText("Felix's Agents · not in this Space")
		).toBeTruthy();
		const option = await screen.findByRole("option", {
			name: CODEX_REQUEST_OPTION_NAME,
		});
		expect(option.textContent).toContain("Asks Felix");
		fireEvent.click(option);
		await waitFor(() =>
			expect(onChange.mock.lastCall?.[0].text).toContain("@Felix's Codex")
		);
		expect(onChange.mock.lastCall?.[0].authoredMentions).toEqual([]);
		expect(onSelect).toHaveBeenCalledWith(codex);
	});

	it("says a colleague's unavailable Agent is unavailable, in the shared wording", () => {
		const availability = {
			action: "none",
			badgeLabel: "Unavailable",
			category: "unavailable",
			isRefreshing: false,
			label: "Unavailable for Wake",
			phase: "unavailable",
			reasonCode: null,
			status: "unavailable_for_wake",
			summary: "This Agent is unavailable for Wake.",
			tooltip: "Unavailable for Wake",
		} as const;
		expect(
			resolveAgentRequestRelationLabel({ availability, ownerName: "Tali" })
		).toBe("Unavailable");
		expect(
			resolveAgentRequestRelationLabel({
				availability: {
					...availability,
					badgeLabel: "Available",
					category: "available",
					status: "available_for_wake",
				},
				ownerName: "Tali",
			})
		).toBe("Asks Tali");
		expect(
			resolveAgentRequestRelationLabel({
				availability: null,
				ownerName: "Tali",
			})
		).toBe("Asks Tali");
	});

	it.each([
		"close",
		"Backspace",
		"empty Backspace",
	])("dismisses the ghost with %s without accepting it or changing text", (method) => {
		const composerRef = createRef<SpaceComposerEditorHandle>();
		const onDismiss = vi.fn();
		const onAccept = vi.fn();
		const onSend = vi.fn();
		const text = method === "empty Backspace" ? "" : "Keep this draft";
		render(
			<SpaceComposerEditor
				addressingTargets={[]}
				ariaLabel="Message"
				authoredMentions={[]}
				composerRef={composerRef}
				mentionPickerItems={createMentionPickerItems()}
				onChange={vi.fn()}
				onSend={onSend}
				placeholder="Message"
				text={text}
				wakeRecommendation={{
					profileId: AGENT_PROFILE_ID,
					onAccept,
					onDismiss,
				}}
			/>
		);
		act(() => composerRef.current?.selectTextRange({ start: 0, end: 0 }));
		if (method === "close") {
			fireEvent.click(
				screen.getByRole("button", { name: "Dismiss Wake suggestion" })
			);
		} else {
			fireEvent.keyDown(screen.getByRole("textbox"), { key: "Backspace" });
		}
		expect(onDismiss).toHaveBeenCalledTimes(1);
		expect(onAccept).not.toHaveBeenCalled();
		expect(onSend).not.toHaveBeenCalled();
		expect(screen.getByRole("textbox").textContent).toContain(text);
	});

	it.each([
		{ start: 4, end: 4, isComposing: false },
		{ start: 0, end: 4, isComposing: false },
		{ start: 0, end: 0, isComposing: true },
	])("preserves normal Backspace behavior for selection $start-$end (IME: $isComposing)", ({
		start,
		end,
		isComposing,
	}) => {
		const composerRef = createRef<SpaceComposerEditorHandle>();
		const onDismiss = vi.fn();
		render(
			<SpaceComposerEditor
				addressingTargets={[]}
				ariaLabel="Message"
				authoredMentions={[]}
				composerRef={composerRef}
				mentionPickerItems={createMentionPickerItems()}
				onChange={vi.fn()}
				onSend={vi.fn()}
				placeholder="Message"
				text="Keep this draft"
				wakeRecommendation={{
					profileId: AGENT_PROFILE_ID,
					onAccept: vi.fn(),
					onDismiss,
				}}
			/>
		);
		act(() => composerRef.current?.selectTextRange({ start, end }));
		fireEvent.keyDown(screen.getByRole("textbox"), {
			key: "Backspace",
			isComposing,
		});
		expect(onDismiss).not.toHaveBeenCalled();
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

	it("keeps short Wake checks quiet and removes the indicator when ready", () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			const target = createAgentTarget();
			const editorProps = {
				addressingTargets: [
					{
						...target,
						wakeAvailability: {
							...target.wakeAvailability,
							status: "preparing" as const,
						},
					},
				],
				ariaLabel: "Message this space",
				authoredMentions: [
					{
						start: 0,
						end: 7,
						text: "@Runner",
						profileId: AGENT_PROFILE_ID,
						relation: "wake" as const,
					},
				],
				mentionPickerItems: [],
				onChange: vi.fn(),
				onSend: vi.fn(),
				placeholder: "Message this space",
				text: "@Runner review this.",
			};
			const view = render(<SpaceComposerEditor {...editorProps} />);
			expect(screen.queryByLabelText("Checking availability")).toBeNull();
			act(() => vi.advanceTimersByTime(1000));
			expect(screen.getByLabelText("Checking availability")).toBeTruthy();
			view.rerender(
				<SpaceComposerEditor {...editorProps} addressingTargets={[target]} />
			);
			expect(screen.queryByLabelText("Checking availability")).toBeNull();
			expect(editorProps.onChange).not.toHaveBeenCalled();
			view.unmount();
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps @all open for an audience choice and inserts one group token", async () => {
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
			const change = onChange.mock.lastCall?.[0];
			const mentions = change?.authoredMentions;
			expect(change?.text).toBe("@all");
			expect(
				screen.getAllByTestId("space-composer-audience-token")
			).toHaveLength(1);
			expect(screen.queryByTestId("space-composer-profile-token")).toBeNull();
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
			screen.getByRole("button", {
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
		const relation = within(editor).getByRole("button", {
			name: "Change relation for Runner",
		});
		expect(relation).toBeTruthy();
		expect(relation.tagName).toBe("BUTTON");
		expect(relation.textContent).toBe("Wake");
		const visibleParts = Array.from(token.children).map((element) =>
			element.getAttribute("data-slot")
		);
		expect(visibleParts.slice(0, 3)).toEqual([
			"space-profile-mention-token-at",
			"space-profile-mention-token-icon",
			"space-composer-profile-token-name",
		]);
		expect(within(token).getByText("Runner").className).not.toContain(
			"max-w-40"
		);
	});

	it("opens composed Agent details without sending or changing the draft", async () => {
		const onChange = vi.fn();
		const onSend = vi.fn();
		render(
			<QueryClientProvider
				client={
					new QueryClient({ defaultOptions: { queries: { retry: false } } })
				}
			>
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
					mentionPickerItems={createMentionPickerItems()}
					onChange={onChange}
					onSend={onSend}
					placeholder="Message"
					text="@Runner review this"
				/>
			</QueryClientProvider>
		);
		fireEvent.click(
			screen.getByRole("button", { name: "View Runner's profile" })
		);
		expect(await screen.findByRole("dialog")).toBeTruthy();
		expect(within(screen.getByRole("dialog")).getByText("Runner")).toBeTruthy();
		expect(
			screen.getByRole("textbox", { name: "Message this space" }).textContent
		).toContain("review this");
		expect(
			screen.getByRole("button", { name: "Change relation for Runner" })
				.textContent
		).toBe("Wake");
		expect(onSend).not.toHaveBeenCalled();
		for (const [change] of onChange.mock.calls) {
			expect(change).toMatchObject({
				text: "@Runner review this",
				authoredMentions: [
					{
						end: 7,
						profileId: AGENT_PROFILE_ID,
						relation: "wake",
						start: 0,
						text: "@Runner",
					},
				],
			});
		}
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
			within(editor).queryByRole("button", {
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
			screen.getByRole("button", {
				name: "Change relation for Runner",
			})
		);
		fireEvent.click(
			screen.getByRole("menuitemradio", {
				name: MENTION_ONLY_OPTION_NAME,
			})
		);
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

	it.each([
		"",
		"Remember this.",
	])("makes an implicit Direct Message recipient a visible Reference without losing draft %s", async (text) => {
		const onChange = vi.fn();
		const composerRef = createRef<SpaceComposerEditorHandle>();
		render(
			<SpaceComposerEditor
				addressingTargets={[createBlockedAgentTarget()]}
				ariaLabel="Message this space"
				authoredMentions={[]}
				composerRef={composerRef}
				mentionPickerItems={createMentionPickerItems()}
				onChange={onChange}
				onSend={vi.fn()}
				placeholder="Message"
				text={text}
			/>
		);
		act(() => composerRef.current?.setAgentMentionOnly?.([AGENT_PROFILE_ID]));
		await waitFor(() =>
			expect(onChange).toHaveBeenLastCalledWith(
				expect.objectContaining({
					text: `@Runner ${text}`,
					authoredMentions: [
						expect.objectContaining({
							profileId: AGENT_PROFILE_ID,
							relation: "reference",
						}),
					],
				})
			)
		);
		act(() => composerRef.current?.setAgentMentionOnly?.([AGENT_PROFILE_ID]));
		expect(screen.getAllByTestId("space-composer-profile-token")).toHaveLength(
			1
		);
	});

	it("changes one Agent to Mention only while preserving another Agent's Wake and the draft", async () => {
		const onChange = vi.fn();
		const composerRef = createRef<SpaceComposerEditorHandle>();
		const secondId = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
		render(
			<SpaceComposerEditor
				addressingTargets={[
					createAgentTarget(),
					{
						...createAgentTarget(),
						profileId: secondId,
						profileName: "Pepper",
					},
				]}
				ariaLabel="Message this space"
				authoredMentions={[
					{
						profileId: AGENT_PROFILE_ID,
						relation: "wake",
						text: "@Runner",
						start: 0,
						end: 7,
					},
					{
						profileId: secondId,
						relation: "wake",
						text: "@Pepper",
						start: 8,
						end: 15,
					},
				]}
				composerRef={composerRef}
				mentionPickerItems={[]}
				onChange={onChange}
				onSend={vi.fn()}
				placeholder="Message"
				text="@Runner @Pepper review this."
			/>
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Change relation for Pepper" })
		);
		fireEvent.click(
			screen.getByRole("menuitemradio", {
				name: MENTION_ONLY_OPTION_NAME,
			})
		);
		await waitFor(() =>
			expect(onChange).toHaveBeenLastCalledWith(
				expect.objectContaining({
					text: "@Runner @Pepper review this.",
					authoredMentions: [
						expect.objectContaining({
							profileId: AGENT_PROFILE_ID,
							relation: "wake",
						}),
						expect.objectContaining({
							profileId: secondId,
							relation: "reference",
						}),
					],
				})
			)
		);
		act(() => composerRef.current?.setAgentMentionOnly?.([AGENT_PROFILE_ID]));
		await waitFor(() =>
			expect(onChange).toHaveBeenLastCalledWith(
				expect.objectContaining({
					authoredMentions: [
						expect.objectContaining({ relation: "reference" }),
						expect.objectContaining({ relation: "reference" }),
					],
				})
			)
		);
	});

	it.each([
		false,
		true,
	])("keeps Reference selectable and permits offline Wake only with a waiting target (%s)", async (canWait) => {
		const target = createBlockedAgentTarget();
		target.agentWakeAvailability = createSpaceMemberAgentSnapshot({
			profileId: AGENT_PROFILE_ID,
			agentWakeAvailability: { status: "offline_for_wake" },
		}).agentWakeAvailability;
		if (canWait) {
			target.deviceWaitTarget = {
				bindingId: "binding-1",
				openMeldServiceRuntimeId: "runtime-1",
			};
		}
		const onChange = vi.fn();
		render(
			<SpaceComposerEditor
				addressingTargets={[target]}
				ariaLabel="Message this space"
				authoredMentions={[
					{
						end: 7,
						profileId: AGENT_PROFILE_ID,
						relation: "reference",
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

		const relation = screen.getByRole("button", {
			name: "Change relation for Runner",
		});
		fireEvent.click(relation);
		const wakeOption = screen.getByRole("menuitemradio", {
			name: canWait ? "Wake when online" : "Wake — Offline",
		});
		expect(wakeOption.getAttribute("aria-disabled") === "true").toBe(!canWait);
		expect(
			screen
				.getByRole("menuitemradio", { name: MENTION_ONLY_OPTION_NAME })
				.getAttribute("aria-disabled")
		).not.toBe("true");
		expect(
			screen
				.getByRole("textbox", { name: "Message this space" })
				.getAttribute("contenteditable")
		).toBe("true");
		if (canWait) {
			fireEvent.click(wakeOption);
			await waitFor(() =>
				expect(onChange).toHaveBeenLastCalledWith(
					expect.objectContaining({
						authoredMentions: [
							expect.objectContaining({
								profileId: AGENT_PROFILE_ID,
								relation: "wake",
							}),
						],
					})
				)
			);
		}
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
		expect(avatar.getAttribute("data-avatar-icon")).toBe("agent");
		expect(avatar.getAttribute("data-avatar-shape")).toBe("circle");
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
				within(token).queryByRole("button", {
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
				within(tokens[1] as HTMLElement).getByText("Mention only")
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

	it.each([
		"enter",
		"modifier-enter",
	])("keeps draft lines and sends with the selected shortcut: %s", (shortcut) => {
		localStorage.setItem("openmeld.space.message-send-shortcut", shortcut);
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
		fireEvent.keyDown(editor, { key: "Enter", isComposing: true });
		expect(onSend).not.toHaveBeenCalled();

		fireEvent.keyDown(editor, { key: "Enter" });
		if (shortcut === "modifier-enter") {
			expect(onSend).not.toHaveBeenCalled();
			fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
		}
		expect(onSend).toHaveBeenCalledOnce();
		if (shortcut === "modifier-enter") {
			fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
			expect(onSend).toHaveBeenCalledTimes(2);
		}
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

	it("does not write a draft when only the caret moves after restoration", async () => {
		const composerRef = createRef<SpaceComposerEditorHandle>();
		const onChange = vi.fn();
		const props = {
			addressingTargets: [],
			ariaLabel: "Message this space",
			authoredMentions: [],
			composerRef,
			mentionPickerItems: [],
			onChange,
			onSend: vi.fn(),
			placeholder: "Message",
		};
		const view = render(<SpaceComposerEditor {...props} text="" />);
		view.rerender(<SpaceComposerEditor {...props} text="My edited draft" />);
		await act(() => {
			composerRef.current?.selectTextRange({ start: 3, end: 3 });
		});
		expect(screen.getByText("My edited draft")).toBeTruthy();
		expect(onChange).not.toHaveBeenCalled();
	});

	it("cancels deferred draft focus when the user focuses another input", () => {
		const frames: FrameRequestCallback[] = [];
		const animationFrame = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((callback) => {
				frames.push(callback);
				return frames.length;
			});
		try {
			const view = render(
				<>
					<input aria-label="Search messages" />
					<RestoredDraftHarness text="" />
				</>
			);
			view.rerender(
				<>
					<input aria-label="Search messages" />
					<RestoredDraftHarness text="Restored draft" />
				</>
			);
			const search = screen.getByRole("textbox", { name: "Search messages" });
			expect(frames.length).toBeGreaterThan(0);
			act(() => {
				search.focus();
				for (const frame of frames.splice(0)) {
					frame(0);
				}
			});
			expect(document.activeElement).toBe(search);
		} finally {
			animationFrame.mockRestore();
		}
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
