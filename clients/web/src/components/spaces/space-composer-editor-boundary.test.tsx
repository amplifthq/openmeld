import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { reportClientApplicationError } from "#/lib/observability/application-error-client";
import { SpaceComposer } from "./space-composer";
import type { SpaceComposerEditorHandle } from "./space-composer-editor";

const EDITOR_FAILURE = /The message editor stopped working/;

vi.mock("./space-composer-editor", async () => {
	const { useLayoutEffect, useState } = await import("react");
	return {
		SpaceComposerEditor: () => {
			const [, setRevision] = useState(0);
			useLayoutEffect(() => setRevision((revision) => revision + 1));
			return null;
		},
	};
});
vi.mock("#/lib/observability/application-error-client", () => ({
	reportClientApplicationError: vi.fn(),
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it("keeps the conversation and a plain-text draft usable when the rich editor fails", () => {
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	const onEditorChange = vi.fn();
	const onSubmit = vi.fn();
	render(
		<SpaceComposer
			actions={{ onEditorChange, onSubmit }}
			availability={{
				canSendMessage: true,
				fileLimitReached: false,
				isSendingMessage: false,
				sendBlocked: false,
			}}
			centerAgentProfileId={null}
			composerRef={createRef<SpaceComposerEditorHandle>()}
			content={{
				addressingTargets: [],
				authoredMentions: [
					{
						end: 5,
						profileId: "profile-1",
						relation: "mention",
						start: 0,
						text: "Saved",
					},
				],
				files: [],
				mentionPickerItems: [],
				text: "Saved draft",
			}}
			context={{ conversationKind: "space", placement: "conversation" }}
			slots={{ beforeInput: <span>Conversation remains open</span> }}
		/>
	);

	expect(screen.getByText("Conversation remains open")).toBeTruthy();
	expect(reportClientApplicationError).toHaveBeenCalledWith(
		expect.objectContaining({
			message: expect.stringContaining("Maximum update depth exceeded"),
		}),
		"react_caught"
	);
	expect(screen.getByText(EDITOR_FAILURE)).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Mention a member" })).toBeNull();
	const fallback = screen.getByRole("textbox", { name: "Message this space" });
	expect((fallback as HTMLTextAreaElement).value).toBe("Saved draft");
	fireEvent.change(fallback, { target: { value: "Next message" } });
	expect(onEditorChange).toHaveBeenCalledWith({
		authoredMentions: [],
		selection: { start: 12, end: 12 },
		text: "Next message",
	});
	fireEvent.click(screen.getByRole("button", { name: "Send message" }));
	expect(onSubmit).toHaveBeenCalledOnce();
});
