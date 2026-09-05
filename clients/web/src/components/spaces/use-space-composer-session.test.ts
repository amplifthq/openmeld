import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSpaceComposerSession } from "./use-space-composer-session";

afterEach(cleanup);

const commonInput = {
	files: {
		organizationSlug: "organization",
		profileId: "human-1",
		spaceId: "space-1",
	},
	authoring: {
		composerDraftScope: null,
		isMembersLoading: false,
		membersErrorMessage: null,
		openMeldProfileId: "human-1",
		spaceId: "space-1",
		snapshot: null,
	},
} as const;

describe("useSpaceComposerSession", () => {
	it("keeps main and thread drafts, feedback, and send locks independent", () => {
		const composer = renderHook(() => ({
			main: useSpaceComposerSession(commonInput),
			thread: useSpaceComposerSession(commonInput),
		}));

		act(() => {
			composer.result.current.main.onEditorChange({
				authoredMentions: [],
				selection: { end: 12, start: 12 },
				text: "Main message",
			});
			composer.result.current.main.feedback.setErrorMessage("Main error");
			expect(composer.result.current.main.send.begin()).toBe(true);
			expect(composer.result.current.main.send.begin()).toBe(false);
		});

		expect(composer.result.current.main.authoring.composerText).toBe(
			"Main message"
		);
		expect(composer.result.current.thread.authoring.composerText).toBe("");
		expect(composer.result.current.main.feedback.errorMessage).toBeNull();
		expect(composer.result.current.thread.feedback.errorMessage).toBeNull();
		expect(composer.result.current.main.send.isSending).toBe(true);
		expect(composer.result.current.thread.send.isSending).toBe(false);

		act(() => composer.result.current.main.send.finish());
		expect(composer.result.current.main.send.isSending).toBe(false);
	});

	it("clears only the edited composer's error and blocked target", () => {
		const composer = renderHook(() => ({
			main: useSpaceComposerSession(commonInput),
			thread: useSpaceComposerSession(commonInput),
		}));

		act(() => {
			composer.result.current.main.feedback.setErrorMessage("Main error");
			composer.result.current.main.feedback.setBlockedWakeProfileId("agent-1");
			composer.result.current.thread.feedback.setErrorMessage("Thread error");
			composer.result.current.thread.feedback.setBlockedWakeProfileId(
				"agent-2"
			);
		});
		act(() => {
			composer.result.current.main.onEditorChange({
				authoredMentions: [],
				selection: { end: 1, start: 1 },
				text: "M",
			});
		});

		expect(composer.result.current.main.feedback.errorMessage).toBeNull();
		expect(
			composer.result.current.main.feedback.blockedWakeProfileId
		).toBeNull();
		expect(composer.result.current.thread.feedback.errorMessage).toBe(
			"Thread error"
		);
		expect(composer.result.current.thread.feedback.blockedWakeProfileId).toBe(
			"agent-2"
		);
	});
});
