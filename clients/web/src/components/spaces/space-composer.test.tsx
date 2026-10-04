import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerDraftAuthoredMention } from "#/lib/composer-draft-storage";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { SpaceComposer } from "./space-composer";
import type { SpaceComposerSendOptions } from "./space-composer-device-wait";
import type { SpaceComposerEditorHandle } from "./space-composer-editor";
import { SpaceComposerTaskMenu } from "./space-composer-task-menu";
import {
	SpaceWakeRecommendationScope,
	useSpaceWakeRecommendation,
} from "./space-wake-recommendation";

afterEach(cleanup);

it.each([
	{
		choice: "New task",
		label: "New task",
		supportsCurrentFolder: true,
		selection: { mode: "new" },
	},
	{
		choice: "New task",
		label: "New task",
		supportsCurrentFolder: false,
		selection: { mode: "new" },
	},
	{
		choice: "Isolated project worktree",
		label: "Isolated project task",
		supportsCurrentFolder: false,
		selection: { mode: "new", access: "workspace", workspace: "isolated" },
	},
	{
		choice: "Space context only",
		label: "New Space-only task",
		supportsCurrentFolder: false,
		selection: { mode: "new", access: "space_context", workspace: "isolated" },
	},
] as const)("makes $choice explicit in the Task menu", async (input) => {
	const onChange = vi.fn();
	render(
		<SpaceComposerTaskMenu
			disabled={false}
			onChange={onChange}
			requiresProjectContainer={true}
			sources={[]}
			supportsCurrentFolder={input.supportsCurrentFolder}
			targetProfileId="agent"
		/>
	);
	fireEvent.click(screen.getByRole("button", { name: "Task context" }));
	if (input.choice !== "New task") {
		fireEvent.click(await screen.findByText("Limit task access"));
	}
	fireEvent.click(await screen.findByText(input.choice));
	expect(onChange).toHaveBeenCalledWith({
		label: input.label,
		selection: input.selection,
		targetProfileId: "agent",
	});
});

describe("SpaceComposer sending focus", () => {
	it.each([
		{ placement: "conversation", method: "click", mention: false },
		{ placement: "conversation", method: "Enter", mention: true },
		{ placement: "thread", method: "click", mention: true },
	] as const)("keeps typing after $method in a $placement (mention: $mention)", async ({
		placement,
		method,
		mention,
	}) => {
		render(<SendHarness mention={mention} placement={placement} />);
		const editor = screen.getByRole("textbox");
		const send = screen.getByRole("button", {
			name: placement === "thread" ? "Send reply" : "Send message",
		});
		if (method === "click") {
			// jsdom does not implement the browser's pointer-to-button focus default.
			act(() => send.focus());
			fireEvent.click(send);
		} else {
			act(() => editor.focus());
			fireEvent.keyDown(editor, { key: "Enter" });
		}
		await waitFor(() => expect(document.activeElement).toBe(editor));
		fireEvent.paste(editor, {
			clipboardData: {
				files: [],
				items: [],
				getData: (type: string) =>
					type === "text/plain" ? "Second message" : "",
			},
		});
		await waitFor(() => expect(editor.textContent).toContain("Second message"));
		expect(editor.textContent).not.toContain("First message");
		expect(screen.queryByTestId("space-composer-profile-token")).toBeNull();
	});
});

it("only consumes a recommendation after the send owner stages a message", () => {
	const onSubmit = vi.fn<(options?: SpaceComposerSendOptions) => void>();
	const items: Partial<SpaceTimelineItem>[] = [
		{
			id: "request",
			actorProfileId: "me",
			actorProfileKind: "human",
			wakeTargetProfileIds: ["alex"],
			deliveryState: "sent",
		},
		{
			id: "reply",
			actorProfileId: "alex",
			actorProfileKind: "agent",
			wakeTargetProfileIds: [],
			deliveryState: "sent",
			wakeSourceSignalId: "request",
		},
	];
	render(
		<SpaceWakeRecommendationScope
			items={items as SpaceTimelineItem[]}
			selfProfileId="me"
		>
			<RecommendationStatus />
			<SendHarness
				mention={false}
				onSubmit={onSubmit}
				placement="conversation"
			/>
		</SpaceWakeRecommendationScope>
	);
	fireEvent.click(screen.getByRole("button", { name: "Send message" }));
	expect(screen.getByText("Recommendation available")).toBeTruthy();
	expect(screen.getByRole("textbox").textContent).toContain("First message");
	act(() => onSubmit.mock.calls[0]?.[0]?.onMessageStaged?.("exact-client-id"));
	expect(screen.queryByText("Recommendation available")).toBeNull();
	expect(screen.getByRole("textbox").textContent).toContain("First message");
});

function RecommendationStatus() {
	return useSpaceWakeRecommendation()?.candidate ? (
		<span>Recommendation available</span>
	) : null;
}

function SendHarness(input: {
	placement: "conversation" | "thread";
	mention: boolean;
	onSubmit?: (options?: SpaceComposerSendOptions) => void;
}) {
	const composerRef = useRef<SpaceComposerEditorHandle>(null);
	const [draft, setDraft] = useState<{
		text: string;
		authoredMentions: ComposerDraftAuthoredMention[];
	}>({
		text: input.mention ? "@Runner First message" : "First message",
		authoredMentions: input.mention
			? [
					{
						profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
						relation: "reference",
						text: "@Runner",
						start: 0,
						end: 7,
					},
				]
			: [],
	});
	return (
		<SpaceComposer
			actions={{
				onEditorChange: (change) => setDraft(change),
				onSubmit:
					input.onSubmit ??
					(() => setDraft({ text: "", authoredMentions: [] })),
			}}
			availability={{
				canSendMessage: true,
				fileLimitReached: false,
				isSendingMessage: false,
				sendBlocked: !draft.text,
			}}
			centerAgentProfileId={null}
			composerRef={composerRef}
			content={{
				addressingTargets: [],
				authoredMentions: draft.authoredMentions,
				files: [],
				mentionPickerItems: [],
				text: draft.text,
			}}
			context={{ conversationKind: "space", placement: input.placement }}
		/>
	);
}
