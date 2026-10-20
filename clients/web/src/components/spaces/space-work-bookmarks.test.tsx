import type {
	SpaceInputQueueResponse,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import { createWakeProgressItem } from "@openmeld/space";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	SpaceComposerWorkBookmarks,
	SpaceWakeBookmarkAnchor,
	SpaceWorkBookmarksProvider,
} from "./space-work-bookmarks";

const observers = new Map<Element, IntersectionObserverCallback>();
const ATLAS_WORKING = /Atlas.*View (working agent|Thread)/;
const OTHER_WORKING = /Other.*View working agent/;
const QUEUED_MESSAGE = /queued message/;
const ATLAS_QUEUE = /Atlas.*2 queued messages.*View Thread/;
const SHOW_WORK = /Show work and queued messages/;
const openThread = vi.fn();
const queued: SpaceInputQueueResponse["items"][number] = {
	inputId: "queued-follow-up",
	authorProfileId: "human-qa",
	target: { dispatchId: "dispatch-Atlas", targetProfileId: "agent-Atlas" },
	threadId: "thread-target",
	text: "Check the remaining changes",
	state: "queued",
	blocked: false,
};
class TestIntersectionObserver implements IntersectionObserver {
	root = null;
	rootMargin = "0px";
	readonly scrollMargin = "0px 0px 0px 0px";
	thresholds = [0, 0.3, 0.6, 1];
	private target: Element | null = null;
	private readonly callback: IntersectionObserverCallback;
	constructor(callback: IntersectionObserverCallback) {
		this.callback = callback;
	}
	observe(target: Element) {
		this.target = target;
		observers.set(target, this.callback);
	}
	unobserve(target: Element) {
		observers.delete(target);
	}
	disconnect() {
		if (this.target) {
			observers.delete(this.target);
		}
	}
	takeRecords() {
		return [];
	}
}

function wake(id: string, profileId = "human-qa"): WakeProgressItem {
	return createWakeProgressItem({
		clientMessageId: id,
		dispatchId: `dispatch-${id}`,
		phase: "running",
		sourceSignalId: `signal-${id}`,
		targetLabel: id,
		targetProfileId: `agent-${id}`,
		updatedAtMs: Date.now(),
		startedAtMs: Date.now(),
		sourceContext: {
			profileId,
			profileKind: "human",
			profileName: "QA",
			threadId: null,
			messagePreview: `Request ${id}`,
		},
	});
}
function Fixture({
	items,
	thread = null,
	queuedItems = [],
	threadHasAttachments = false,
}: {
	items: WakeProgressItem[];
	thread?: string | null;
	queuedItems?: SpaceInputQueueResponse["items"];
	threadHasAttachments?: boolean;
}) {
	return (
		<SpaceWorkBookmarksProvider
			activeThreadId={thread}
			hasMore={false}
			items={items}
			onOpenThread={openThread}
			onShowConversation={() => undefined}
			profileId="human-qa"
			queuedItems={queuedItems}
			threadHasAttachments={threadHasAttachments}
		>
			{items.map((item) => (
				<SpaceWakeBookmarkAnchor item={item} key={item.clientMessageId}>
					<span>{`Status ${item.targetLabel}`}</span>
				</SpaceWakeBookmarkAnchor>
			))}
			<div data-testid="main-composer">
				<SpaceComposerWorkBookmarks placement="conversation" />
			</div>
			{thread ? (
				<div data-testid="thread-composer">
					<SpaceComposerWorkBookmarks placement="thread" />
				</div>
			) : null}
		</SpaceWorkBookmarksProvider>
	);
}

async function visibility(label: string, ratio: number) {
	const target = screen.getByText(`Status @${label}`).parentElement;
	if (!target) {
		throw new Error("Missing status anchor");
	}
	const rect = new DOMRect(0, 0, 100, 30);
	const entry: IntersectionObserverEntry = {
		target,
		time: 0,
		isIntersecting: ratio > 0,
		intersectionRatio: ratio,
		boundingClientRect: rect,
		intersectionRect: rect,
		rootBounds: rect,
	};
	await act(async () => {
		observers.get(target)?.(
			[entry],
			new TestIntersectionObserver(() => undefined)
		);
		await vi.advanceTimersByTimeAsync(350);
	});
}

describe("Composer offscreen Wake bookmarks", () => {
	beforeEach(() => {
		openThread.mockReset();
		vi.useFakeTimers();
		vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
	});
	it("finds a closed Thread from its queued input even without an active Wake", () => {
		const view = render(<Fixture items={[]} queuedItems={[queued]} />);
		fireEvent.click(
			screen.getByRole("button", { name: "1 queued message. View Thread" })
		);
		expect(openThread).toHaveBeenCalledWith("thread-target");
		view.rerender(
			<Fixture items={[]} queuedItems={[queued]} thread="thread-target" />
		);
		expect(screen.queryByRole("button", { name: QUEUED_MESSAGE })).toBeNull();
		view.rerender(
			<Fixture items={[]} queuedItems={[queued]} thread="thread-other" />
		);
		expect(
			within(screen.getByTestId("main-composer")).getByRole("button", {
				name: QUEUED_MESSAGE,
			})
		).toBeTruthy();
		view.rerender(<Fixture items={[]} />);
		expect(screen.queryByRole("button", { name: QUEUED_MESSAGE })).toBeNull();
	});
	it("merges queued inputs with their original work in one navigation entry", async () => {
		const item = wake("Atlas");
		if (!item.sourceContext) {
			throw new Error("Missing source context");
		}
		item.sourceContext = { ...item.sourceContext, threadId: "thread-target" };
		render(
			<Fixture
				items={[item]}
				queuedItems={[queued, { ...queued, inputId: "second-follow-up" }]}
			/>
		);
		// A visible parent status must not hide the closed Thread's Queue.
		expect(screen.getByRole("button", { name: ATLAS_QUEUE })).toBeTruthy();
		await visibility("Atlas", 0);
		expect(
			screen.getAllByRole("button", {
				name: ATLAS_QUEUE,
			})
		).toHaveLength(1);
		fireEvent.click(
			screen.getByRole("button", {
				name: ATLAS_QUEUE,
			})
		);
		expect(openThread).toHaveBeenCalledWith("thread-target");
	});
	it("keeps main and other authors' queue out of Thread discovery and preserves attachment protection", () => {
		render(
			<Fixture
				items={[]}
				queuedItems={[
					queued,
					{ ...queued, inputId: "main", threadId: null },
					{
						...queued,
						inputId: "someone-else",
						authorProfileId: "other",
						threadId: "thread-other",
					},
				]}
				threadHasAttachments
			/>
		);
		fireEvent.click(
			screen.getByRole("button", { name: "1 queued message. View Thread" })
		);
		expect(openThread).not.toHaveBeenCalled();
	});
	it("lists other work and queued Threads together and uses the selected Thread", async () => {
		render(<Fixture items={[wake("Other")]} queuedItems={[queued]} />);
		await visibility("Other", 0);
		fireEvent.click(screen.getByRole("button", { name: SHOW_WORK }));
		const queueRow = screen.getByText(queued.text).closest("button");
		if (!queueRow) {
			throw new Error("Missing queue navigation row");
		}
		fireEvent.click(queueRow);
		expect(openThread).toHaveBeenCalledWith("thread-target");
	});
	it("keeps an open Queue entry usable when its Wake projection arrives", () => {
		const queuedItems = [
			queued,
			{
				...queued,
				inputId: "other-thread-input",
				threadId: "thread-other",
				text: "Review the other Thread",
			},
		];
		const view = render(<Fixture items={[]} queuedItems={queuedItems} />);
		fireEvent.click(screen.getByRole("button", { name: SHOW_WORK }));
		const item = wake("Atlas");
		if (!item.sourceContext) {
			throw new Error("Missing source context");
		}
		item.sourceContext = { ...item.sourceContext, threadId: "thread-target" };
		view.rerender(<Fixture items={[item]} queuedItems={queuedItems} />);
		const queueRow = screen.getByText(queued.text).closest("button");
		if (!queueRow) {
			throw new Error("Missing Queue navigation row");
		}
		expect(queueRow.disabled).toBe(false);
		fireEvent.click(queueRow);
		expect(openThread).toHaveBeenCalledWith("thread-target");
	});
	it.each([
		["queued", "1 queued message"],
		["claimed", "Confirming delivery…"],
		["unconfirmed", "Queue needs attention"],
	] as const)("describes %s input without inventing a working state", (state, label) => {
		render(<Fixture items={[]} queuedItems={[{ ...queued, state }]} />);
		expect(
			screen.getByRole("button", { name: `${label}. View Thread` })
		).toBeTruthy();
		expect(screen.queryByText("Working…")).toBeNull();
	});
	afterEach(() => {
		cleanup();
		observers.clear();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});
	it("hands off only the current person's offscreen work and avoids edge flicker", async () => {
		const atlas = wake("Atlas");
		vi.setSystemTime(Date.now() + 60_000);
		render(<Fixture items={[atlas, wake("Other", "someone-else")]} />);
		expect(screen.queryByRole("button", { name: ATLAS_WORKING })).toBeNull();
		await visibility("Atlas", 1);
		expect(screen.queryByRole("button", { name: ATLAS_WORKING })).toBeNull();
		await visibility("Atlas", 0.4);
		expect(screen.queryByRole("button", { name: ATLAS_WORKING })).toBeNull();
		await visibility("Atlas", 0);
		expect(screen.getByRole("button", { name: ATLAS_WORKING })).toBeTruthy();
		expect(screen.queryByRole("button", { name: OTHER_WORKING })).toBeNull();
		await visibility("Atlas", 0.4);
		expect(screen.getByRole("button", { name: ATLAS_WORKING })).toBeTruthy();
		await visibility("Atlas", 1);
		expect(screen.queryByRole("button", { name: ATLAS_WORKING })).toBeNull();
	});
	it("keeps each conversation's work in its own Composer", async () => {
		const item = wake("Atlas");
		if (!item.sourceContext) {
			throw new Error("Missing source context");
		}
		item.sourceContext = { ...item.sourceContext, threadId: "thread-current" };
		render(<Fixture items={[item, wake("Other")]} thread="thread-current" />);
		await visibility("Atlas", 0);
		await visibility("Other", 0);
		expect(
			within(screen.getByTestId("main-composer")).queryByRole("button", {
				name: ATLAS_WORKING,
			})
		).toBeNull();
		expect(
			within(screen.getByTestId("main-composer")).getByRole("button", {
				name: OTHER_WORKING,
			})
		).toBeTruthy();
		expect(
			within(screen.getByTestId("thread-composer")).getByRole("button", {
				name: ATLAS_WORKING,
			})
		).toBeTruthy();
		expect(
			within(screen.getByTestId("thread-composer")).queryByRole("button", {
				name: OTHER_WORKING,
			})
		).toBeNull();
	});
	it("removes a finished Wake rather than retaining a local working state", async () => {
		const item = wake("Atlas");
		const view = render(<Fixture items={[item]} />);
		await visibility("Atlas", 0);
		view.rerender(<Fixture items={[]} />);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(350);
		});
		expect(screen.queryByRole("button", { name: ATLAS_WORKING })).toBeNull();
	});
	it("keeps other Threads in main and returns a closed Thread to main", async () => {
		const item = wake("Atlas");
		if (!item.sourceContext) {
			throw new Error("Missing source context");
		}
		item.sourceContext = { ...item.sourceContext, threadId: "thread-target" };
		const view = render(<Fixture items={[item]} thread="thread-current" />);
		await visibility("Atlas", 0);
		expect(
			within(screen.getByTestId("main-composer")).getByRole("button", {
				name: ATLAS_WORKING,
			})
		).toBeTruthy();
		expect(
			within(screen.getByTestId("thread-composer")).queryByRole("button", {
				name: ATLAS_WORKING,
			})
		).toBeNull();
		view.rerender(<Fixture items={[item]} thread="thread-target" />);
		expect(
			within(screen.getByTestId("main-composer")).queryByRole("button", {
				name: ATLAS_WORKING,
			})
		).toBeNull();
		view.rerender(<Fixture items={[item]} />);
		expect(
			within(screen.getByTestId("main-composer")).getByRole("button", {
				name: ATLAS_WORKING,
			})
		).toBeTruthy();
	});
});
