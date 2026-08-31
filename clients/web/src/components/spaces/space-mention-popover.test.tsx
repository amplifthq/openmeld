import {
	createSpaceMemberAgentSnapshot,
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceMentionPopover } from "./space-mention-popover";
import { buildSpaceMentionTargetItems } from "./use-space-mention-authoring";

describe("SpaceMentionPopover", () => {
	afterEach(() => {
		cleanup();
	});

	it("uses Dither for the Center Agent mention in an ordinary Space", () => {
		const centerAgentProfileId = "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
		const items = buildSpaceMentionTargetItems({
			query: "@",
			snapshot: createSpaceMembersSnapshot({
				agents: [
					createSpaceMemberAgentSnapshot({
						agentControllerRef: "builtin:codex",
						profileId: centerAgentProfileId,
						profileName: "Center Agent",
					}),
				],
			}),
		});

		render(
			<SpaceMentionPopover
				centerAgentProfileId={centerAgentProfileId}
				composerSelection={{ end: 1, start: 1 }}
				composerText="@"
				onHoverItem={vi.fn()}
				onRequestClose={vi.fn()}
				onSelectItem={vi.fn()}
				state={{
					highlightedIndex: 0,
					items,
					kind: "target_picker",
					query: "@",
				}}
				textareaRef={{ current: null }}
			/>
		);

		expect(screen.getByTestId("space-mention-popover").className).toContain(
			"rounded-md"
		);
		const avatar = screen.getByTestId(
			`space-profile-icon-${centerAgentProfileId}`
		);
		expect(
			avatar.querySelector("canvas")?.getAttribute("data-profile-avatar-seed")
		).toBe(
			`openmeld-dither-profile-avatar:v1:center-agent:${centerAgentProfileId}`
		);
		expect(screen.queryByTestId("local-agent-logo-codex")).toBeNull();
	});

	it("keeps Agent actions explicit while Human Mention needs no second choice", () => {
		const items = buildSpaceMentionTargetItems({
			query: "@",
			snapshot: createSpaceMembersSnapshot({
				agents: [
					createSpaceMemberAgentSnapshot({
						profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
						profileName: "Runner",
					}),
				],
				humans: [
					createSpaceMemberHumanSnapshot({
						profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
						profileName: "Mira",
					}),
				],
			}),
		});
		const onSelectItem = vi.fn();

		const { rerender } = render(
			<SpaceMentionPopover
				composerSelection={{ end: 1, start: 1 }}
				composerText="@"
				onHoverItem={vi.fn()}
				onRequestClose={vi.fn()}
				onSelectItem={onSelectItem}
				state={{
					highlightedIndex: 0,
					items,
					kind: "target_picker",
					query: "@",
				}}
				textareaRef={{ current: null }}
			/>
		);

		expect(screen.getByRole("button", { name: "Wake Runner" })).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Reference Runner" })
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "CC Runner" })).toBeNull();
		const targetList = screen.getByRole("listbox", {
			name: "Mention target options",
		});
		expect(
			within(targetList).queryByRole("button", {
				name: "Reference Runner",
			})
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Wake Mira" })).toBeNull();
		expect(screen.queryByText("⚡")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Reference Runner" }));
		expect(onSelectItem).toHaveBeenCalledWith(0, "reference");

		rerender(
			<SpaceMentionPopover
				composerSelection={{ end: 1, start: 1 }}
				composerText="@"
				onHoverItem={vi.fn()}
				onRequestClose={vi.fn()}
				onSelectItem={onSelectItem}
				state={{
					highlightedIndex: 1,
					items,
					kind: "target_picker",
					query: "@",
				}}
				textareaRef={{ current: null }}
			/>
		);
		expect(screen.queryByRole("button", { name: "Wake Mira" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Reference Mira" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Mention Mira" })).toBeNull();
		expect(screen.queryByRole("button", { name: "CC Mira" })).toBeNull();

		const humanOption = within(targetList)
			.getAllByRole("option")
			.find((option) => option.textContent?.includes("Mira"));
		if (!humanOption) {
			throw new Error("Expected Mira in the Human Mention options.");
		}
		fireEvent.mouseDown(humanOption);
		expect(onSelectItem).toHaveBeenCalledWith(1);
	});

	it("shows member status text using the same status order as the members panel", () => {
		const items = buildSpaceMentionTargetItems({
			query: "@",
			snapshot: createSpaceMembersSnapshot({
				agents: [
					createSpaceMemberAgentSnapshot({
						profileName: "A Offline Agent",
						profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
						agentWakeAvailability: { status: "offline_for_wake" },
					}),
					createSpaceMemberAgentSnapshot({
						profileName: "B Unavailable Agent",
						profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
						agentWakeAvailability: {
							action: "check_status",
							badgeLabel: "Unavailable",
							category: "unavailable",
							isRefreshing: false,
							label: "Unavailable for Wake",
							phase: "unavailable",
							reasonCode: "agent_execution.unavailable",
							status: "unavailable_for_wake",
							summary: "This agent cannot reply right now.",
							tooltip: "Unavailable for Wake",
						},
					}),
					createSpaceMemberAgentSnapshot({
						profileName: "C Available Agent",
						profileId: "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
						agentWakeAvailability: { status: "available_for_wake" },
					}),
				],
				humans: [
					createSpaceMemberHumanSnapshot({
						liveNow: false,
						profileName: "A Away Human",
						profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					}),
					createSpaceMemberHumanSnapshot({
						liveNow: true,
						profileName: "B Live Human",
						profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
					}),
				],
			}),
		});

		render(
			<SpaceMentionPopover
				composerSelection={{ end: 1, start: 1 }}
				composerText="@"
				onHoverItem={vi.fn()}
				onRequestClose={vi.fn()}
				onSelectItem={vi.fn()}
				state={{
					highlightedIndex: 0,
					items,
					kind: "target_picker",
					query: "@",
				}}
				textareaRef={{ current: null }}
			/>
		);

		const targetList = screen.getByRole("listbox", {
			name: "Mention target options",
		});
		expect(screen.queryByText("Mention profiles")).toBeNull();
		expect(screen.queryByText("Choose who to mention.")).toBeNull();
		expect(targetList.textContent).not.toContain("@C Available Agent");

		expect(
			readTextOrder(targetList, [
				"C Available Agent",
				"B Unavailable Agent",
				"A Offline Agent",
				"B Live Human",
				"A Away Human",
			])
		).toEqual([
			"C Available Agent",
			"B Unavailable Agent",
			"A Offline Agent",
			"B Live Human",
			"A Away Human",
		]);
		expect(within(targetList).getByText("Available")).toBeTruthy();
		expect(within(targetList).getByText("Unavailable")).toBeTruthy();
		expect(within(targetList).getByText("Offline")).toBeTruthy();
		expect(within(targetList).queryByText("Agent")).toBeNull();
		for (const profileName of [
			"C Available Agent",
			"B Unavailable Agent",
			"A Offline Agent",
			"B Live Human",
			"A Away Human",
		]) {
			const profileNameElement = within(targetList).getByText(profileName);
			expect(profileNameElement.className).toContain("font-bold");
			expect(profileNameElement.className).toContain("text-sm");
		}

		const availableStatus = getMentionStatus(targetList, "Available");
		expect(availableStatus.className).toContain("before:content-['·']");
		expect(availableStatus.className).toContain("emerald");
		expect(availableStatus.className).not.toContain("border");
		expect(availableStatus.className).not.toContain("bg-");

		const liveStatus = getMentionStatus(targetList, "Live");
		expect(liveStatus.className).toContain("emerald");
		expect(liveStatus.className).not.toContain("border");
		expect(liveStatus.className).not.toContain("bg-");
	});

	it("shows each non-ready agent's server-provided availability summary", () => {
		const summaries = {
			connectLocalAgent: "Connect a local agent before this profile can reply.",
			providerSignIn:
				"Sign in to the selected provider before this agent can reply.",
			wrongWorkspace: "This Agent Profile belongs to a different workspace.",
		} as const;
		const items = buildSpaceMentionTargetItems({
			query: "@",
			snapshot: createSpaceMembersSnapshot({
				agents: [
					createSpaceMemberAgentSnapshot({
						agentWakeAvailability: {
							action: "none",
							badgeLabel: "Wrong workspace",
							category: "unavailable",
							isRefreshing: false,
							label: "Connect local agent",
							phase: "connect_local_agent",
							reasonCode: "agent_profile_binding.missing",
							status: "unavailable_for_wake",
							summary: summaries.connectLocalAgent,
							tooltip: "Connect local agent",
						},
						profileId: "agt_11111111-1111-4111-8111-111111111111",
						profileName: "Connect Local Agent",
					}),
					createSpaceMemberAgentSnapshot({
						agentWakeAvailability: {
							action: "reconnect_binding",
							badgeLabel: "Connect",
							category: "unavailable",
							isRefreshing: false,
							label: "Connect local agent",
							phase: "unavailable",
							reasonCode: "agent_profile.organization_mismatch",
							status: "unavailable_for_wake",
							summary: summaries.wrongWorkspace,
							tooltip: "This Agent Profile belongs to another workspace",
						},
						profileId: "agt_22222222-2222-4222-8222-222222222222",
						profileName: "Wrong Workspace Agent",
					}),
					createSpaceMemberAgentSnapshot({
						agentWakeAvailability: {
							action: "none",
							badgeLabel: "Sign-in needed",
							category: "unavailable",
							isRefreshing: false,
							label: "Sign-in needed",
							phase: "provider_sign_in_needed",
							reasonCode: "controller.auth.unauthenticated",
							status: "unavailable_for_wake",
							summary: summaries.providerSignIn,
							tooltip: "Provider sign-in needed",
						},
						profileId: "agt_33333333-3333-4333-8333-333333333333",
						profileName: "Provider Sign-in Agent",
					}),
					createSpaceMemberAgentSnapshot({
						agentWakeAvailability: { status: "available_for_wake" },
						profileId: "agt_44444444-4444-4444-8444-444444444444",
						profileName: "Ready Agent",
					}),
				],
			}),
		});

		render(
			<SpaceMentionPopover
				composerSelection={{ end: 1, start: 1 }}
				composerText="@"
				onHoverItem={vi.fn()}
				onRequestClose={vi.fn()}
				onSelectItem={vi.fn()}
				state={{
					highlightedIndex: 0,
					items,
					kind: "target_picker",
					query: "@",
				}}
				textareaRef={{ current: null }}
			/>
		);

		const targetList = screen.getByRole("listbox", {
			name: "Mention target options",
		});
		for (const [profileName, summary] of [
			["Connect Local Agent", summaries.connectLocalAgent],
			["Wrong Workspace Agent", summaries.wrongWorkspace],
			["Provider Sign-in Agent", summaries.providerSignIn],
		] as const) {
			const row = getMentionOption(targetList, profileName);
			const summaryElement = within(row).getByTestId(
				"space-mention-availability-summary"
			);
			expect(summaryElement.textContent).toBe(summary);
			expect(summaryElement.className).toContain("text-muted-foreground");
			expect(summaryElement.className).toContain("truncate");
		}

		expect(
			within(getMentionOption(targetList, "Ready Agent")).queryByTestId(
				"space-mention-availability-summary"
			)
		).toBeNull();
	});

	it("orders every agent before every human regardless of status or recency", () => {
		const recentHumanId = "11111111-1111-4111-8111-111111111111";
		const items = buildSpaceMentionTargetItems({
			query: "@",
			recentProfileIds: [recentHumanId],
			snapshot: createSpaceMembersSnapshot({
				agents: [
					createSpaceMemberAgentSnapshot({
						agentWakeAvailability: { status: "offline_for_wake" },
						profileId: "agt_a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
						profileName: "Alpha Offline Agent",
					}),
					createSpaceMemberAgentSnapshot({
						agentWakeAvailability: { status: "available_for_wake" },
						profileId: "agt_c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3",
						profileName: "Zeta Available Agent",
					}),
				],
				humans: [
					createSpaceMemberHumanSnapshot({
						liveNow: true,
						profileId: recentHumanId,
						profileName: "Recent Live Human",
					}),
					createSpaceMemberHumanSnapshot({
						liveNow: false,
						profileId: "22222222-2222-4222-8222-222222222222",
						profileName: "Away Human",
					}),
				],
			}),
		});

		const kinds = items.map((item) => item.suggestion.profileKind);
		const lastAgentIndex = kinds.lastIndexOf("agent");
		const firstHumanIndex = kinds.indexOf("human");

		expect(lastAgentIndex).toBeGreaterThanOrEqual(0);
		expect(firstHumanIndex).toBeGreaterThan(lastAgentIndex);
		// Recency reorders within a kind, never across it: the recently mentioned
		// human still leads the Humans block yet stays behind every agent.
		expect(items[firstHumanIndex]?.suggestion.profileName).toBe(
			"Recent Live Human"
		);
	});

	it("keeps every rendered row aligned with the picker array for mixed statuses", () => {
		const recentHumanId = "11111111-1111-4111-8111-111111111111";
		const items = buildSpaceMentionTargetItems({
			query: "@",
			recentProfileIds: [recentHumanId],
			snapshot: createSpaceMembersSnapshot({
				agents: [
					createSpaceMemberAgentSnapshot({
						agentWakeAvailability: { status: "offline_for_wake" },
						profileId: "agt_a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
						profileName: "Alpha Offline Agent",
					}),
					createSpaceMemberAgentSnapshot({
						agentWakeAvailability: { status: "available_for_wake" },
						profileId: "agt_c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3",
						profileName: "Zeta Available Agent",
					}),
				],
				humans: [
					createSpaceMemberHumanSnapshot({
						liveNow: true,
						profileId: recentHumanId,
						profileName: "Recent Live Human",
					}),
					createSpaceMemberHumanSnapshot({
						liveNow: false,
						profileId: "22222222-2222-4222-8222-222222222222",
						profileName: "Away Human",
					}),
					createSpaceMemberHumanSnapshot({
						liveNow: true,
						profileId: "33333333-3333-4333-8333-333333333333",
						profileName: "Other Live Human",
					}),
				],
			}),
		});

		const onSelectItem = vi.fn();
		render(
			<SpaceMentionPopover
				composerSelection={{ end: 1, start: 1 }}
				composerText="@"
				onHoverItem={vi.fn()}
				onRequestClose={vi.fn()}
				onSelectItem={onSelectItem}
				state={{
					highlightedIndex: 0,
					items,
					kind: "target_picker",
					query: "@",
				}}
				textareaRef={{ current: null }}
			/>
		);

		const targetList = screen.getByRole("listbox", {
			name: "Mention target options",
		});
		const rows = within(targetList).getAllByRole("option");
		expect(rows).toHaveLength(items.length);

		// Mouse-click every visible row and assert the selected profile is exactly
		// the row that was clicked. The popover wires onMouseDown → onSelectItem(
		// absoluteIndex) → items[index] — the identical path Enter uses — so this
		// nails the mouse and keyboard at once, for any mix of agents, humans,
		// statuses, and recency (not just the two-member example).
		for (const [visualIndex, row] of rows.entries()) {
			onSelectItem.mockClear();
			fireEvent.mouseDown(row);
			expect(onSelectItem).toHaveBeenCalledTimes(1);
			const selectedItem = items[onSelectItem.mock.calls[0]?.[0]];
			if (!selectedItem) {
				throw new Error(
					`No mention item resolved for clicked row ${visualIndex}`
				);
			}
			expect(row.textContent ?? "").toContain(
				selectedItem.suggestion.profileName
			);
		}

		// Spell out the exact reported failure: mouse-clicking the visible human
		// must insert that human, never the offset-aliased "@OpenTag Claude Code".
		const recentRow = within(targetList)
			.getByText("Recent Live Human")
			.closest('[role="option"]');
		if (!(recentRow instanceof HTMLElement)) {
			throw new Error("Expected the Recent Live Human row to render");
		}
		onSelectItem.mockClear();
		fireEvent.mouseDown(recentRow);
		expect(onSelectItem).toHaveBeenCalledTimes(1);
		const selected = items[onSelectItem.mock.calls[0]?.[0]];
		expect(selected?.suggestion.profileName).toBe("Recent Live Human");
	});

	it("lets the keyboard own the highlight until the pointer actually moves", () => {
		const items = buildSpaceMentionTargetItems({
			query: "@",
			snapshot: createSpaceMembersSnapshot({
				agents: [
					createSpaceMemberAgentSnapshot({
						agentWakeAvailability: { status: "available_for_wake" },
						profileId: "agt_a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
						profileName: "Alpha Agent",
					}),
				],
				humans: [
					createSpaceMemberHumanSnapshot({
						liveNow: true,
						profileId: "11111111-1111-4111-8111-111111111111",
						profileName: "Human One",
					}),
				],
			}),
		});
		const onHoverItem = vi.fn();

		render(
			<SpaceMentionPopover
				composerSelection={{ end: 1, start: 1 }}
				composerText="@"
				onHoverItem={onHoverItem}
				onRequestClose={vi.fn()}
				onSelectItem={vi.fn()}
				state={{
					highlightedIndex: 0,
					items,
					kind: "target_picker",
					query: "@",
				}}
				textareaRef={{ current: null }}
			/>
		);

		const targetList = screen.getByRole("listbox", {
			name: "Mention target options",
		});
		const secondRow = within(targetList).getAllByRole("option")[1];
		if (!secondRow) {
			throw new Error("Expected a second option row to render");
		}

		// The popover opening/animating under a stationary cursor fires multiple
		// mousemove events whose coordinates never change (the mouse didn't move;
		// rows shifted under it). No matter how many, they must NOT steal the
		// highlight away from the keyboard.
		fireEvent.mouseMove(window, { clientX: 100, clientY: 100 });
		fireEvent.mouseMove(secondRow, { clientX: 100, clientY: 100 });
		fireEvent.mouseMove(window, { clientX: 100, clientY: 100 });
		fireEvent.mouseMove(secondRow, { clientX: 100, clientY: 100 });
		expect(onHoverItem).not.toHaveBeenCalled();

		// A genuine move changes the coordinates; only then does the mouse take
		// over, and hovering a row selects it.
		fireEvent.mouseMove(window, { clientX: 160, clientY: 130 });
		fireEvent.mouseMove(secondRow, { clientX: 160, clientY: 130 });
		expect(onHoverItem).toHaveBeenCalledWith(1);

		// Highlight is state-only: no CSS :hover that would light up whatever row
		// sits under a stationary cursor when the popover opens — the JS pointer
		// gate above cannot govern a CSS :hover (cmdk issue #345).
		for (const row of within(targetList).getAllByRole("option")) {
			expect(row.className).not.toContain("hover:bg-muted");
		}
	});
});

function getMentionStatus(scope: HTMLElement, label: string): HTMLElement {
	const status = within(scope)
		.getByText(label)
		.closest('[data-testid="space-mention-status-badge"]');

	if (!(status instanceof HTMLElement)) {
		throw new Error(`Expected mention status was not rendered: ${label}`);
	}

	return status;
}

function getMentionOption(
	scope: HTMLElement,
	profileName: string
): HTMLElement {
	const option = within(scope)
		.getByText(profileName)
		.closest('[role="option"]');

	if (!(option instanceof HTMLElement)) {
		throw new Error(`Expected mention option was not rendered: ${profileName}`);
	}

	return option;
}

function readTextOrder(
	scope: HTMLElement,
	expectedTexts: readonly string[]
): readonly string[] {
	const textContent = scope.textContent ?? "";
	return expectedTexts
		.map((expectedText) => {
			const index = textContent.indexOf(expectedText);
			if (index === -1) {
				throw new Error(`Expected text was not rendered: ${expectedText}`);
			}
			return { expectedText, index };
		})
		.sort((left, right) => left.index - right.index)
		.map(({ expectedText }) => expectedText);
}
