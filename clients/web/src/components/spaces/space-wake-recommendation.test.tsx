import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createComposerDraftRecord,
	readComposerDraft,
	writeComposerDraft,
} from "#/lib/composer-draft-storage";
import {
	readComposerFileDrafts,
	removeComposerFileDraft,
	saveComposerFileDraft,
} from "#/lib/spaces/composer-file-drafts";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import {
	findRecentWakeExchange,
	SpaceWakeRecommendationScope,
	useSpaceWakeRecommendation,
} from "./space-wake-recommendation";

const MESSAGE_DISMISS_LABEL = /Dismiss message/;
const ANY_DISMISS_LABEL = /Dismiss (message|composer)/;

function message(
	id: string,
	actorProfileId: string,
	overrides: Partial<SpaceTimelineItem> = {}
): SpaceTimelineItem {
	return {
		id,
		actorProfileId,
		actorProfileKind: "human",
		wakeTargetProfileIds: [],
		deliveryState: "sent",
		...overrides,
	} as SpaceTimelineItem;
}
const source = message("request", "me", { wakeTargetProfileIds: ["alex"] });
const reply = message("reply", "alex", {
	actorProfileKind: "agent",
	wakeSourceSignalId: "request",
});

describe("recent completed Wake recommendation", () => {
	it("recommends my previous Agent only after its own reply", () => {
		expect(findRecentWakeExchange([source], "me")).toBeNull();
		expect(findRecentWakeExchange([source, reply], "me")).toEqual({
			profileId: "alex",
			exchangeId: "request",
		});
		expect(findRecentWakeExchange([source, reply], "someone-else")).toBeNull();
	});
	it("does not guess among multiple Agents or carry a suggestion across a new unfinished Wake", () => {
		expect(
			findRecentWakeExchange(
				[
					source,
					reply,
					message("next", "me", { wakeTargetProfileIds: ["blair"] }),
				],
				"me"
			)
		).toBeNull();
		expect(
			findRecentWakeExchange(
				[{ ...source, wakeTargetProfileIds: ["alex", "blair"] }, reply],
				"me"
			)
		).toBeNull();
	});
	it("does not treat another reply, a recalled reply, or failed delivery as completion", () => {
		expect(
			findRecentWakeExchange(
				[source, { ...reply, wakeSourceSignalId: "another" }],
				"me"
			)
		).toBeNull();
		expect(
			findRecentWakeExchange([source, { ...reply, recalledAt: 123 }], "me")
		).toBeNull();
		expect(
			findRecentWakeExchange(
				[source, { ...reply, deliveryState: "failed" }],
				"me"
			)
		).toBeNull();
	});
});

beforeEach(() => sessionStorage.clear());
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function Controls() {
	const recommendation = useSpaceWakeRecommendation();
	return (
		<>
			<input aria-label="Draft" defaultValue="Keep my draft" />
			{recommendation?.candidate ? (
				<button onClick={recommendation.dismiss} type="button">
					Dismiss composer
				</button>
			) : null}
			<button
				onClick={() =>
					recommendation?.recordSend(
						recommendation.candidate?.profileId ?? null,
						"outgoing"
					)
				}
				type="button"
			>
				Stage message
			</button>
			{recommendation?.nudge ? (
				<button onClick={recommendation.dismissNudge} type="button">
					Dismiss message {recommendation.nudge.messageId}
				</button>
			) : null}
		</>
	);
}

function Session({
	items = [source, reply],
	spaceId = "space-a",
	selfProfileId = "me",
	orgSlug = "org-a",
}: {
	items?: SpaceTimelineItem[];
	spaceId?: string;
	selfProfileId?: string;
	orgSlug?: string;
}) {
	return (
		<SpaceWakeRecommendationScope
			items={items}
			orgSlug={orgSlug}
			selfProfileId={selfProfileId}
			spaceId={spaceId}
		>
			<Controls />
		</SpaceWakeRecommendationScope>
	);
}

describe("session-scoped Wake choices", () => {
	it("remembers dismissal after remount and supplementary replies without changing the draft", async () => {
		const scope = {
			kind: "space" as const,
			ownerAccountId: "account",
			profileId: "me",
			spaceId: "space-a",
		};
		const draft = createComposerDraftRecord({
			text: "Unsent words",
			authoredMentions: [],
			replyToSignalId: "request",
		});
		writeComposerDraft(scope, draft);
		await saveComposerFileDraft({
			id: "preserved-file",
			scope: "org-a:me:space-a",
			file: new File(["attachment"], "draft.txt"),
			publishMutationId: "preserved-upload",
		});
		const filesBefore = await readComposerFileDrafts("org-a:me:space-a");
		const view = render(<Session />);
		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: "Unsent words" },
		});
		fireEvent.click(screen.getByText("Dismiss composer"));
		expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
			"Unsent words"
		);
		view.unmount();
		const reopened = render(
			<Session items={[source, reply, { ...reply, id: "supplement" }]} />
		);
		expect(screen.queryByText("Dismiss composer")).toBeNull();
		expect(readComposerDraft(scope)).toEqual(draft);
		expect(await readComposerFileDrafts("org-a:me:space-a")).toEqual(
			filesBefore
		);
		await removeComposerFileDraft("preserved-file");
		const nextSource = message("new-request", "me", {
			wakeTargetProfileIds: ["alex"],
		});
		reopened.rerender(<Session items={[source, reply, nextSource]} />);
		expect(screen.queryByText("Dismiss composer")).toBeNull();
		reopened.rerender(
			<Session
				items={[
					source,
					reply,
					nextSource,
					{ ...reply, id: "new-reply", wakeSourceSignalId: "new-request" },
				]}
			/>
		);
		expect(screen.getByText("Dismiss composer")).toBeTruthy();
	});

	it.each([
		"space",
		"profile",
		"organization",
	])("isolates choices by %s while navigating", (scope) => {
		const view = render(<Session />);
		fireEvent.click(screen.getByText("Dismiss composer"));
		view.rerender(
			<Session
				items={[
					{ ...source, actorProfileId: scope === "profile" ? "other" : "me" },
					reply,
				]}
				orgSlug={scope === "organization" ? "org-b" : "org-a"}
				selfProfileId={scope === "profile" ? "other" : "me"}
				spaceId={scope === "space" ? "space-b" : "space-a"}
			/>
		);
		expect(screen.getByText("Dismiss composer")).toBeTruthy();
		view.rerender(<Session />);
		expect(screen.queryByText("Dismiss composer")).toBeNull();
	});

	it("moves a suggestion only to the staged message and remembers its dismissal", () => {
		const view = render(<Session />);
		fireEvent.click(screen.getByText("Stage message"));
		expect(screen.queryByText("Dismiss composer")).toBeNull();
		view.rerender(
			<Session
				items={[
					source,
					reply,
					message("unrelated", "me", { clientMessageId: "other-tab" }),
				]}
			/>
		);
		expect(screen.queryByText(MESSAGE_DISMISS_LABEL)).toBeNull();
		const pending = message("local-id", "me", {
			clientMessageId: "outgoing",
			deliveryState: "pending",
		});
		view.rerender(<Session items={[source, reply, pending]} />);
		expect(screen.queryByText(MESSAGE_DISMISS_LABEL)).toBeNull();
		view.unmount();
		const canonical = {
			...pending,
			id: "server-id",
			deliveryState: "sent" as const,
		};
		const reopened = render(<Session items={[source, reply, canonical]} />);
		expect(screen.getByText("Dismiss message server-id")).toBeTruthy();
		fireEvent.click(screen.getByText("Dismiss message server-id"));
		reopened.unmount();
		render(<Session items={[source, reply, canonical]} />);
		expect(screen.queryByText(ANY_DISMISS_LABEL)).toBeNull();
	});

	it("does not repeat a used recommendation on later ordinary messages", () => {
		const view = render(<Session />);
		fireEvent.click(screen.getByText("Stage message"));
		view.rerender(
			<Session
				items={[
					source,
					reply,
					message("sent", "me", { clientMessageId: "outgoing" }),
				]}
			/>
		);
		expect(screen.getByText("Dismiss message sent")).toBeTruthy();
		fireEvent.click(screen.getByText("Stage message"));
		view.rerender(
			<Session
				items={[
					source,
					reply,
					message("next", "me", { clientMessageId: "next" }),
				]}
			/>
		);
		expect(screen.queryByText(ANY_DISMISS_LABEL)).toBeNull();
	});

	it("keeps dismissal usable when browser storage is unavailable", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("Unavailable");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("Unavailable");
		});
		render(<Session />);
		fireEvent.click(screen.getByText("Dismiss composer"));
		expect(screen.queryByText("Dismiss composer")).toBeNull();
		expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
			"Keep my draft"
		);
	});
});
