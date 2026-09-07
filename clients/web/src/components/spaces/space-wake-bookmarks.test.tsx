import type { WakeProgressItem } from "@openmeld/schemas/types";
import { createWakeProgressItem } from "@openmeld/space";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	SpaceComposerActiveWakes,
	SpaceWakeBookmarkAnchor,
	SpaceWakeBookmarksProvider,
} from "./space-wake-bookmarks";

const observers = new Map<Element, IntersectionObserverCallback>();
const ATLAS_WORKING = /Atlas is working/;
const OTHER_WORKING = /Other is working/;
const openThread = vi.fn();
class TestIntersectionObserver implements IntersectionObserver {
	root = null;
	rootMargin = "0px";
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
}: {
	items: WakeProgressItem[];
	thread?: string | null;
}) {
	return (
		<SpaceWakeBookmarksProvider
			activeThreadId={thread}
			hasMore={false}
			items={items}
			onOpenThread={openThread}
			onShowConversation={() => undefined}
			profileId="human-qa"
			threadHasAttachments={false}
		>
			{items.map((item) => (
				<SpaceWakeBookmarkAnchor item={item} key={item.clientMessageId}>
					<span>{`Status ${item.targetLabel}`}</span>
				</SpaceWakeBookmarkAnchor>
			))}
			<div data-testid="main-composer">
				<SpaceComposerActiveWakes placement="conversation" />
			</div>
			{thread ? (
				<div data-testid="thread-composer">
					<SpaceComposerActiveWakes placement="thread" />
				</div>
			) : null}
		</SpaceWakeBookmarksProvider>
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
		vi.useFakeTimers();
		vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
	});
	afterEach(() => {
		cleanup();
		observers.clear();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});
	it("hands off only the current person's offscreen work and avoids edge flicker", async () => {
		render(<Fixture items={[wake("Atlas"), wake("Other", "someone-else")]} />);
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
	it("keeps each conversation's work in its own Composer", () => {
		const item = wake("Atlas");
		if (!item.sourceContext) {
			throw new Error("Missing source context");
		}
		item.sourceContext = { ...item.sourceContext, threadId: "thread-current" };
		render(<Fixture items={[item, wake("Other")]} thread="thread-current" />);
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
	it("keeps other Threads in main and returns a closed Thread to main", () => {
		const item = wake("Atlas");
		if (!item.sourceContext) {
			throw new Error("Missing source context");
		}
		item.sourceContext = { ...item.sourceContext, threadId: "thread-target" };
		const view = render(<Fixture items={[item]} thread="thread-current" />);
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
