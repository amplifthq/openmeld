import {
	createSpaceMemberAgentSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, expect, it } from "vitest";
import type { ComposerDraftAuthoredMention } from "#/lib/composer-draft-storage";
import { SpaceComposer } from "./space-composer";
import type { SpaceComposerEditorHandle } from "./space-composer-editor";
import {
	buildSpaceMentionTargetItems,
	type SpaceComposerAddressingTarget,
} from "./use-space-mention-authoring";

afterEach(cleanup);
const PROFILE_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

it.each([
	"hosted:remote-agent",
	"hosted:center-agent",
	null,
])("does not suggest a Local fallback for %s", (controllerRef) => {
	render(<ComposerHarness controllerRef={controllerRef} />);
	expect(
		screen.queryByRole("button", { name: "Mention only instead" })
	).toBeNull();
});

it("preserves Local Mention Only and visibly switches the implicit recipient without losing text", async () => {
	render(<ComposerHarness controllerRef="builtin:codex" />);
	fireEvent.click(screen.getByRole("button", { name: "Mention only instead" }));
	await waitFor(() =>
		expect(
			screen.queryByRole("button", { name: "Mention only instead" })
		).toBeNull()
	);
	expect(screen.getByRole("textbox").textContent).toContain("Keep this note.");
	expect(screen.getByTestId("reference-count").textContent).toBe("1");
});

it("does not interrupt a Local readiness check with a downgrade prompt", () => {
	render(<ComposerHarness controllerRef="builtin:codex" preparing />);
	expect(
		screen.queryByRole("button", { name: "Mention only instead" })
	).toBeNull();
});

function ComposerHarness(input: {
	controllerRef: string | null;
	preparing?: boolean;
}) {
	const composerRef = useRef<SpaceComposerEditorHandle>(null);
	const [draft, setDraft] = useState<{
		text: string;
		authoredMentions: ComposerDraftAuthoredMention[];
	}>({ text: "Keep this note.", authoredMentions: [] });
	const mentionPickerItems = buildSpaceMentionTargetItems({
		query: "",
		snapshot: createSpaceMembersSnapshot({
			agents: [
				createSpaceMemberAgentSnapshot({
					profileId: PROFILE_ID,
					profileName: "Runner",
					agentControllerRef: input.controllerRef,
				}),
			],
		}),
	});
	const target: SpaceComposerAddressingTarget = {
		agentControllerRef: input.controllerRef,
		profileId: PROFILE_ID,
		profileName: "Runner",
		primaryMentionLabel: "Runner",
		allowedRelations: { wake: true, reference: true, mention: false },
		relation: draft.authoredMentions[0]?.relation ?? "wake",
		wakeAvailability: {
			status: input.preparing ? "preparing" : "blocked",
			reasonCodes: [],
			reasonText: "Cannot confirm reply status.",
		},
	};
	return (
		<>
			<output data-testid="reference-count">
				{
					draft.authoredMentions.filter(
						(mention) => mention.relation === "reference"
					).length
				}
			</output>
			<SpaceComposer
				actions={{ onEditorChange: setDraft, onSubmit: () => undefined }}
				availability={{
					canSendMessage: true,
					fileLimitReached: false,
					isSendingMessage: false,
					sendBlocked: false,
				}}
				centerAgentProfileId={null}
				composerRef={composerRef}
				content={{
					addressingTargets: [target],
					authoredMentions: draft.authoredMentions,
					files: [],
					mentionPickerItems,
					text: draft.text,
				}}
				context={{
					conversationKind: "agent_conversation",
					placement: "conversation",
				}}
			/>
		</>
	);
}
